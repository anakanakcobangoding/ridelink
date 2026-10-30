import { roomClient } from "./room-client.js";

const AUDIO_CONSTRAINTS = Object.freeze({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
});

const START_STATE = Object.freeze({
  microphoneStatus: "permission-required",
  microphoneEnabled: false,
  connectionStatus: "waiting",
  connectionState: "new",
  iceConnectionState: "new",
  signalingState: "stable",
  remoteAudioBlocked: false,
  turnAvailable: false,
  iceTransportPolicy: "all",
  candidateType: "unknown",
  peerMicrophoneEnabled: false,
  microphonePermission: "unknown",
  localAudioTrackState: "none",
  selectedCandidatePair: "unavailable",
  incomingAudioBytes: 0,
  outgoingAudioBytes: 0,
  error: "",
});

function makeId() {
  return globalThis.crypto.randomUUID();
}

function deviceErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Izin mikrofon ditolak. Izinkan mikrofon untuk situs ini lalu coba lagi.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "Mikrofon tidak ditemukan. Sambungkan mikrofon atau headset lalu coba lagi.";
  }
  if (error?.name === "NotReadableError" || error?.name === "AbortError") {
    return "Mikrofon sedang dipakai aplikasi lain atau tidak tersedia.";
  }
  return "Mikrofon tidak dapat diaktifkan pada browser ini.";
}

export class WebRTCIntercomClient {
  constructor({ onState, onRemoteStream, getAudioElement }) {
    this.onState = onState;
    this.onRemoteStream = onRemoteStream;
    this.getAudioElement = getAudioElement;
    this.state = { ...START_STATE };
    this.peer = null;
    this.peerConnection = null;
    this.buildPromise = null;
    this.localStream = null;
    this.remoteStream = null;
    this.iceServers = null;
    this.subscriptions = [];
    this.signalQueue = Promise.resolve();
    this.pendingSignals = [];
    this.pendingCandidates = new Map();
    this.pendingCandidateCount = 0;
    this.seenMessageIds = new Set();
    this.ignoredNegotiations = new Set();
    this.retiredNegotiations = new Set();
    this.candidateKeys = new Set();
    this.currentNegotiationId = null;
    this.localNegotiationId = null;
    this.remoteNegotiationId = null;
    this.pendingRestartId = null;
    this.makingOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.ignoreOffer = false;
    this.recoveryTimer = null;
    this.statsTimer = null;
    this.recoveryAttempt = 0;
    this.rebuildUsed = false;
    this.deviceChangeHandler = null;
    this.closed = false;
    this.relayOnly = false;
  }

  start() {
    if (this.subscriptions.length > 0) return;
    for (const event of ["webrtc:offer", "webrtc:answer", "webrtc:ice-candidate", "webrtc:restart-request"]) {
      this.subscriptions.push(roomClient.on(event, (payload) => this.#receiveSignal(event, payload)));
    }
    this.subscriptions.push(roomClient.on("webrtc:microphone-state", (payload) => {
      if (payload.participantId === this.peer?.participantId) this.#setState({ peerMicrophoneEnabled: payload.microphoneEnabled });
    }));
    this.subscriptions.push(roomClient.on("disconnect", (reason) => {
      if (reason === "io server disconnect" || reason === "io client disconnect") {
        this.#stopLocalMedia({ publish: false });
        this.#clearRecovery();
        this.#closePeerConnection();
        this.#setState({ connectionStatus: "disconnected", microphoneStatus: "permission-required", microphoneEnabled: false });
      }
    }));
    this.subscriptions.push(roomClient.on("room:participant-reconnected", (participant) => {
      if (participant.participantId === this.peer?.participantId) void this.retryConnection({ automatic: true, force: true });
    }));
    this.deviceChangeHandler = () => {
      if (this.localStream && this.localStream.getAudioTracks().every((track) => track.readyState !== "live")) {
        this.#setState({ microphoneStatus: "device-disconnected", microphoneEnabled: false, error: "Mikrofon terputus. Sambungkan kembali lalu aktifkan mikrofon." });
        void this.#publishMicrophoneState(false);
      }
    };
    navigator.mediaDevices?.addEventListener?.("devicechange", this.deviceChangeHandler);
    void this.#readMicrophonePermission();
  }

  async setPeer(participant) {
    if (this.closed) return;
    if (!participant) {
      this.peer = null;
      this.#clearRecovery();
      this.#stopLocalMedia({ notify: true });
      this.#closePeerConnection();
      this.#setState({ connectionStatus: "waiting", connectionState: "new", iceConnectionState: "new", signalingState: "stable", peerMicrophoneEnabled: false, candidateType: "unknown" });
      return;
    }

    const polite = String(this.localParticipantId) > String(participant.participantId);
    if (this.peer?.participantId === participant.participantId) {
      this.peer = { ...participant, polite };
      this.#setState({ peerMicrophoneEnabled: Boolean(participant.microphoneEnabled) });
      if (!this.peerConnection) await this.#buildPeerConnection();
      return;
    }

    this.#closePeerConnection();
    this.peer = { ...participant, polite };
    this.remoteNegotiationId = null;
    this.localNegotiationId = null;
    this.currentNegotiationId = null;
    this.ignoredNegotiations.clear();
    this.retiredNegotiations.clear();
    this.pendingCandidates.clear();
    this.pendingCandidateCount = 0;
    this.candidateKeys.clear();
    this.#setState({ connectionStatus: "connecting", connectionState: "new", iceConnectionState: "new", signalingState: "stable", peerMicrophoneEnabled: Boolean(participant.microphoneEnabled), error: "" });
    await this.#buildPeerConnection();
  }

  setCurrentParticipantId(participantId) {
    this.localParticipantId = participantId;
    if (this.peer) this.peer = { ...this.peer, polite: String(participantId) > String(this.peer.participantId) };
  }

  async enableMicrophone() {
    if (this.state.microphoneEnabled && this.localStream?.getAudioTracks().some((track) => track.readyState === "live")) return;
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.#setState({ microphoneStatus: "unavailable", error: "Mikrofon memerlukan HTTPS dan browser yang mendukung getUserMedia." });
      return;
    }

    this.#setState({ microphoneStatus: "requesting", error: "" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
      if (this.closed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.localStream?.getTracks().forEach((track) => track.stop());
      this.localStream = stream;
      for (const track of stream.getAudioTracks()) {
        track.enabled = true;
        track.onended = () => {
          if (!this.closed) {
            this.#setState({ microphoneStatus: "device-disconnected", microphoneEnabled: false, error: "Mikrofon terputus. Sambungkan kembali lalu aktifkan mikrofon." });
            void this.#publishMicrophoneState(false);
          }
        };
        this.#attachLocalTrack(track);
      }
      this.#setState({ microphoneStatus: "enabled", microphoneEnabled: true, localAudioTrackState: this.#getLocalTrackState(), error: "" });
      await this.#publishMicrophoneState(true);
    } catch (error) {
      this.#setState({ microphoneStatus: error?.name === "NotAllowedError" || error?.name === "SecurityError" ? "denied" : "unavailable", microphoneEnabled: false, error: deviceErrorMessage(error) });
    }
  }

  async toggleMute() {
    const tracks = this.localStream?.getAudioTracks() ?? [];
    if (tracks.length === 0 || tracks.some((track) => track.readyState !== "live")) {
      this.#setState({ microphoneStatus: "device-disconnected", microphoneEnabled: false, error: "Mikrofon tidak tersedia. Aktifkan mikrofon kembali." });
      return;
    }
    const enabled = !this.state.microphoneEnabled;
    for (const track of tracks) track.enabled = enabled;
    this.#setState({ microphoneStatus: enabled ? "enabled" : "muted", microphoneEnabled: enabled, localAudioTrackState: this.#getLocalTrackState(), error: "" });
    await this.#publishMicrophoneState(enabled);
  }

  async enableRemoteAudio() {
    const audio = this.getAudioElement?.();
    if (!audio || !this.remoteStream) return;
    audio.muted = false;
    audio.srcObject = this.remoteStream;
    try {
      await audio.play();
      this.#setState({ remoteAudioBlocked: false, error: "" });
    } catch {
      this.#setState({ remoteAudioBlocked: true, error: "Browser memerlukan sentuhan untuk memutar audio rider lain." });
    }
  }

  async retryConnection({ automatic = false, force = false } = {}) {
    if (!this.peer || this.closed) return;
    if (!automatic) {
      this.recoveryAttempt = 0;
      this.rebuildUsed = false;
    }
    if (this.state.connectionState === "connected" && !force) return;
    this.#setState({ connectionStatus: "reconnecting", error: "" });
    if (this.recoveryAttempt >= 3) {
      if (this.rebuildUsed) {
        this.#setState({ connectionStatus: "failed", error: "Koneksi belum pulih. Periksa jaringan lalu tekan Retry Connection." });
        return;
      }
      this.rebuildUsed = true;
      this.recoveryAttempt = 0;
      await this.#buildPeerConnection();
      return;
    }

    const delay = automatic ? Math.min(8000, 1000 * (2 ** this.recoveryAttempt)) : 0;
    this.recoveryAttempt += 1;
    this.#clearRecovery();
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.#requestIceRestart();
    }, delay);
  }

  async setRelayOnly(enabled) {
    if (this.relayOnly === enabled) return;
    this.relayOnly = enabled;
    this.#setState({ iceTransportPolicy: enabled ? "relay" : "all", connectionStatus: this.peer ? "connecting" : "waiting", error: "" });
    if (this.peer) await this.#buildPeerConnection();
  }

  destroy() {
    this.#stopLocalMedia({ notify: false });
    this.closed = true;
    this.#clearRecovery();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    if (this.deviceChangeHandler) navigator.mediaDevices?.removeEventListener?.("devicechange", this.deviceChangeHandler);
    this.#closePeerConnection();
  }

  async #buildPeerConnection() {
    const peerId = this.peer?.participantId;
    if (!peerId || this.closed) return;
    if (this.buildPromise) return this.buildPromise;
    const operation = this.#createPeerConnection(peerId);
    this.buildPromise = operation;
    try {
      await operation;
    } finally {
      if (this.buildPromise === operation) this.buildPromise = null;
      if (!this.closed && this.peer && this.peer.participantId !== peerId && !this.peerConnection) void this.#buildPeerConnection();
    }
  }

  async #createPeerConnection(peerId) {
    try {
      const config = await roomClient.command("webrtc:get-ice-config", { iceTransportPolicy: this.relayOnly ? "relay" : "all" });
      if (this.closed || this.peer?.participantId !== peerId) return;
      this.iceServers = config.iceServers;
      this.#setState({ turnAvailable: config.turnAvailable, iceTransportPolicy: config.iceTransportPolicy, error: config.notice || "" });
      this.#closePeerConnection();
      const peerConnection = new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy });
      this.peerConnection = peerConnection;
      this.#startStatsPolling(peerConnection);
      peerConnection.onnegotiationneeded = () => this.#enqueue(() => this.#negotiate());
      peerConnection.onicecandidate = (event) => {
        if (!event.candidate || !this.currentNegotiationId) return;
        const candidate = event.candidate.toJSON();
        void this.#sendSignal("webrtc:ice-candidate", {
          negotiationId: this.currentNegotiationId,
          messageId: makeId(),
          candidate,
        });
      };
      peerConnection.ontrack = (event) => this.#receiveTrack(event);
      peerConnection.onconnectionstatechange = () => this.#handleConnectionState(peerConnection);
      peerConnection.oniceconnectionstatechange = () => this.#handleIceState(peerConnection);
      peerConnection.onsignalingstatechange = () => this.#setState({ signalingState: peerConnection.signalingState });
      peerConnection.onicegatheringstatechange = () => this.#setState({ iceGatheringState: peerConnection.iceGatheringState });

      for (const track of this.localStream?.getAudioTracks() ?? []) this.#attachLocalTrack(track);
      this.#setState({ connectionStatus: "connecting", connectionState: peerConnection.connectionState, iceConnectionState: peerConnection.iceConnectionState, signalingState: peerConnection.signalingState });
      const pending = this.pendingSignals.splice(0);
      for (const item of pending) this.#receiveSignal(item.event, item.payload);
    } catch (error) {
      if (this.peer?.participantId === peerId) {
        this.#setState({ connectionStatus: "failed", error: error?.code === "TURN_NOT_CONFIGURED" ? error.message : error?.message || "Tidak dapat menyiapkan koneksi suara." });
      }
    }
  }

  #attachLocalTrack(track) {
    if (!this.peerConnection) return;
    const sender = this.peerConnection.getSenders().find((item) => item.track?.kind === track.kind);
    if (sender) {
      void sender.replaceTrack(track).catch((error) => this.#setState({ error: error.message || "Tidak dapat mengganti track mikrofon." }));
    } else {
      this.peerConnection.addTrack(track, this.localStream);
    }
  }

  #receiveTrack(event) {
    if (event.track.kind !== "audio") return;
    const incoming = event.streams[0] ?? new MediaStream([event.track]);
    if (this.remoteStream !== incoming) {
      this.remoteStream = incoming;
      const audio = this.getAudioElement?.();
      if (audio) {
        audio.muted = false;
        audio.srcObject = incoming;
        void audio.play().then(() => this.#setState({ remoteAudioBlocked: false })).catch(() => this.#setState({ remoteAudioBlocked: true }));
      }
      this.onRemoteStream?.(incoming);
    }
  }

  #receiveSignal(event, payload) {
    if (this.closed || !payload || payload.protocolVersion !== 1) return;
    if (!this.peer || payload.participantId !== this.peer.participantId) return;
    if (payload.messageId && this.seenMessageIds.has(payload.messageId)) return;
    if (payload.messageId) {
      this.seenMessageIds.add(payload.messageId);
      if (this.seenMessageIds.size > 500) this.seenMessageIds.delete(this.seenMessageIds.values().next().value);
    }
    if (!this.peerConnection) {
      if (this.pendingSignals.length < 32) this.pendingSignals.push({ event, payload });
      return;
    }
    this.#enqueue(() => this.#handleSignal(event, payload));
  }

  async #handleSignal(event, payload) {
    const pc = this.peerConnection;
    if (!pc || payload.participantId !== this.peer?.participantId) return;
    if (event === "webrtc:restart-request") {
      if (this.retiredNegotiations.has(payload.negotiationId)) return;
      if (this.pendingRestartId === payload.negotiationId || this.currentNegotiationId === payload.negotiationId) return;
      this.pendingRestartId = payload.negotiationId;
      pc.restartIce();
      return;
    }
    if (event === "webrtc:ice-candidate") {
      await this.#applyCandidate(payload.negotiationId, payload.candidate);
      return;
    }

    const description = payload.description;
    const negotiationId = payload.negotiationId;
    if (event === "webrtc:offer") {
      if (this.retiredNegotiations.has(negotiationId)) return;
      if (negotiationId === this.remoteNegotiationId && pc.signalingState === "stable") {
        if (pc.localDescription?.type === "answer") {
          await this.#sendSignal("webrtc:answer", { negotiationId, messageId: makeId(), description: pc.localDescription.toJSON() });
        }
        return;
      }
      const readyForOffer = !this.makingOffer && (pc.signalingState === "stable" || this.isSettingRemoteAnswerPending);
      const offerCollision = description.type === "offer" && !readyForOffer;
      this.ignoreOffer = !this.peer.polite && offerCollision;
      if (this.ignoreOffer) {
        this.ignoredNegotiations.add(negotiationId);
        if (this.ignoredNegotiations.size > 100) this.ignoredNegotiations.delete(this.ignoredNegotiations.values().next().value);
        return;
      }

      if (this.remoteNegotiationId && this.remoteNegotiationId !== negotiationId) this.#retireNegotiation(this.remoteNegotiationId);
      this.currentNegotiationId = negotiationId;
      this.remoteNegotiationId = negotiationId;
      this.localNegotiationId = negotiationId;
      const rtcDescription = typeof RTCSessionDescription === "function" ? new RTCSessionDescription(description) : description;
      await pc.setRemoteDescription(rtcDescription);
      await this.#flushCandidates(negotiationId);
      await pc.setLocalDescription();
      await this.#sendSignal("webrtc:answer", {
        negotiationId,
        messageId: makeId(),
        description: pc.localDescription.toJSON(),
      });
      return;
    }

    if (event === "webrtc:answer") {
      if (negotiationId !== this.localNegotiationId || this.retiredNegotiations.has(negotiationId)) return;
      if (pc.signalingState === "stable" && pc.remoteDescription?.type === "answer") return;
      this.isSettingRemoteAnswerPending = true;
      try {
        const rtcDescription = typeof RTCSessionDescription === "function" ? new RTCSessionDescription(description) : description;
        await pc.setRemoteDescription(rtcDescription);
      } finally {
        this.isSettingRemoteAnswerPending = false;
      }
      if (this.remoteNegotiationId && this.remoteNegotiationId !== negotiationId) this.#retireNegotiation(this.remoteNegotiationId);
      this.remoteNegotiationId = negotiationId;
      await this.#flushCandidates(negotiationId);
    }
  }

  async #applyCandidate(negotiationId, candidateInit) {
    if (this.ignoredNegotiations.has(negotiationId) || this.retiredNegotiations.has(negotiationId)) return;
    const key = `${negotiationId}:${candidateInit.candidate}`;
    if (this.candidateKeys.has(key)) return;
    this.candidateKeys.add(key);
    if (this.candidateKeys.size > 500) this.candidateKeys.delete(this.candidateKeys.values().next().value);
    if (!this.peerConnection.remoteDescription || negotiationId !== this.remoteNegotiationId) {
      const queue = this.pendingCandidates.get(negotiationId) ?? [];
      if (queue.length < 100 && this.pendingCandidateCount < 200) {
        queue.push(candidateInit);
        this.pendingCandidateCount += 1;
      }
      this.pendingCandidates.set(negotiationId, queue);
      return;
    }
    try {
      const candidate = typeof RTCIceCandidate === "function" ? new RTCIceCandidate(candidateInit) : candidateInit;
      await this.peerConnection.addIceCandidate(candidate);
    } catch (error) {
      if (!this.ignoreOffer) this.#setState({ error: error?.message || "ICE candidate tidak dapat diterapkan." });
    }
  }

  async #flushCandidates(negotiationId) {
    const queue = this.pendingCandidates.get(negotiationId) ?? [];
    this.pendingCandidates.delete(negotiationId);
    this.pendingCandidateCount = Math.max(0, this.pendingCandidateCount - queue.length);
    for (const candidate of queue) await this.#applyCandidate(negotiationId, candidate);
  }

  async #negotiate() {
    const pc = this.peerConnection;
    if (!pc || !this.peer || this.closed || pc.signalingState !== "stable") return;
    const negotiationId = this.pendingRestartId ?? makeId();
    this.pendingRestartId = null;
    this.currentNegotiationId = negotiationId;
    this.localNegotiationId = negotiationId;
    this.makingOffer = true;
    try {
      await pc.setLocalDescription();
      if (pc.localDescription?.type !== "offer") return;
      await this.#sendSignal("webrtc:offer", {
        negotiationId,
        messageId: makeId(),
        description: pc.localDescription.toJSON(),
      });
    } catch (error) {
      this.#setState({ connectionStatus: "failed", error: error?.message || "Negosiasi WebRTC gagal." });
    } finally {
      this.makingOffer = false;
    }
  }

  async #sendSignal(event, payload) {
    try {
      await roomClient.command(event, payload);
    } catch (error) {
      this.#setState({ error: error?.message || "Signaling peer gagal." });
    }
  }

  async #requestIceRestart() {
    const pc = this.peerConnection;
    if (!pc || !this.peer || this.closed) return;
    const negotiationId = makeId();
    this.pendingRestartId = negotiationId;
    await this.#sendSignal("webrtc:restart-request", { negotiationId, messageId: makeId() });
    try {
      pc.restartIce();
    } catch {
      this.#setState({ error: "Browser tidak dapat memulai ulang ICE. Coba buat koneksi ulang." });
    }
    const expectedPc = pc;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      if (this.peerConnection === expectedPc && this.state.connectionState !== "connected") void this.retryConnection({ automatic: true });
    }, Math.min(12_000, 4000 * this.recoveryAttempt));
  }

  #handleConnectionState(pc) {
    if (this.peerConnection !== pc) return;
    const state = pc.connectionState;
    this.#setState({
      connectionState: state,
      connectionStatus: state === "connected" ? "connected" : state === "failed" ? "reconnecting" : state === "disconnected" ? "reconnecting" : state === "closed" ? "disconnected" : "connecting",
    });
    if (state === "connected") {
      this.recoveryAttempt = 0;
      this.rebuildUsed = false;
      this.#clearRecovery();
      void this.#readCandidateType(pc);
    }
    if (state === "failed") this.#scheduleRecovery(0);
    if (state === "disconnected") this.#scheduleRecovery(2500);
  }

  #handleIceState(pc) {
    if (this.peerConnection !== pc) return;
    this.#setState({ iceConnectionState: pc.iceConnectionState });
    if (pc.iceConnectionState === "failed") this.#scheduleRecovery(0);
    if (pc.iceConnectionState === "disconnected") this.#scheduleRecovery(2500);
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") this.#clearRecovery();
  }

  #scheduleRecovery(delay) {
    if (this.recoveryTimer || this.closed) return;
    this.#setState({ connectionStatus: "reconnecting" });
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.retryConnection({ automatic: true });
    }, delay);
  }

  async #readCandidateType(pc) {
    try {
      const stats = await pc.getStats();
      let selectedPair;
      for (const report of stats.values()) {
        if (report.type === "candidate-pair" && (report.selected || (report.nominated && report.state === "succeeded"))) {
          selectedPair = report;
          break;
        }
      }
      if (!selectedPair) return;
      const localCandidate = stats.get(selectedPair.localCandidateId);
      const remoteCandidate = stats.get(selectedPair.remoteCandidateId);
      this.#setState({ candidateType: localCandidate?.candidateType || remoteCandidate?.candidateType || "unknown" });
    } catch {
      this.#setState({ candidateType: "unknown" });
    }
  }

  async #readMicrophonePermission() {
    try {
      const permission = await navigator.permissions?.query?.({ name: "microphone" });
      if (permission) {
        this.#setState({ microphonePermission: permission.state });
        permission.onchange = () => this.#setState({ microphonePermission: permission.state });
      }
    } catch {
      this.#setState({ microphonePermission: "unsupported" });
    }
  }

  #getLocalTrackState() {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return "none";
    return `${track.readyState}${track.enabled ? " / enabled" : " / muted"}`;
  }

  #startStatsPolling(pc) {
    if (this.statsTimer) clearInterval(this.statsTimer);
    const read = async () => {
      if (this.peerConnection !== pc) return;
      try {
        const stats = await pc.getStats();
        let incomingAudioBytes = 0;
        let outgoingAudioBytes = 0;
        let selectedPair;
        for (const report of stats.values()) {
          if (report.type === "inbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) incomingAudioBytes += report.bytesReceived ?? 0;
          if (report.type === "outbound-rtp" && (report.kind === "audio" || report.mediaType === "audio")) outgoingAudioBytes += report.bytesSent ?? 0;
          if (report.type === "transport" && report.selectedCandidatePairId) selectedPair = stats.get(report.selectedCandidatePairId);
          if (!selectedPair && report.type === "candidate-pair" && (report.selected || (report.nominated && report.state === "succeeded"))) selectedPair = report;
        }
        const localCandidate = selectedPair && stats.get(selectedPair.localCandidateId);
        const remoteCandidate = selectedPair && stats.get(selectedPair.remoteCandidateId);
        const localType = localCandidate?.candidateType;
        const remoteType = remoteCandidate?.candidateType;
        const route = localType === "relay" || remoteType === "relay" ? "relay" : localType || remoteType ? "direct" : "unavailable";
        this.#setState({
          localAudioTrackState: this.#getLocalTrackState(),
          selectedCandidatePair: route,
          candidateType: localType || remoteType || "unknown",
          incomingAudioBytes,
          outgoingAudioBytes,
        });
      } catch {
        // getStats is optional diagnostics; connection media must continue if a browser rejects it.
      }
    };
    void read();
    this.statsTimer = setInterval(() => void read(), 1000);
  }

  #retireNegotiation(negotiationId) {
    this.retiredNegotiations.add(negotiationId);
    if (this.retiredNegotiations.size > 100) this.retiredNegotiations.delete(this.retiredNegotiations.values().next().value);
  }

  #enqueue(operation) {
    this.signalQueue = this.signalQueue.then(operation).catch((error) => {
      this.#setState({ error: error?.message || "Pesan signaling tidak dapat diproses." });
    });
  }

  async #publishMicrophoneState(enabled) {
    try { await roomClient.command("webrtc:microphone-state", { microphoneEnabled: enabled }); } catch { /* Leaving a room revokes this socket; room state already records departure. */ }
  }

  #clearRecovery() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
  }

  #stopLocalMedia({ notify = true, publish = true } = {}) {
    if (!this.localStream) return;
    const wasEnabled = this.state.microphoneEnabled;
    this.localStream.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.localStream = null;
    if (wasEnabled && publish && !this.closed) void this.#publishMicrophoneState(false);
    if (notify) this.#setState({ microphoneStatus: "permission-required", microphoneEnabled: false, localAudioTrackState: "none" });
  }

  #closePeerConnection() {
    const pc = this.peerConnection;
    if (!pc) return;
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.onicegatheringstatechange = null;
    pc.close();
    this.peerConnection = null;
    this.remoteStream = null;
    const audio = this.getAudioElement?.();
    if (audio) audio.srcObject = null;
    this.onRemoteStream?.(null);
    this.pendingCandidates.clear();
    this.pendingCandidateCount = 0;
    this.#setState({ selectedCandidatePair: "unavailable", incomingAudioBytes: 0, outgoingAudioBytes: 0, localAudioTrackState: this.#getLocalTrackState() });
  }

  #setState(patch) {
    this.state = { ...this.state, ...patch };
    this.onState?.(this.state);
  }
}
