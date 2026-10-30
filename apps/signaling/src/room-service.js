import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MemoryRoomRepository } from "./room-repository.js";
import { createInitialMusicState, getCurrentMusicPosition, MUSIC_CATALOG } from "./music-catalog.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_BYTES = 10;
const EXPIRED_CODE_RETENTION_MS = 60_000;

export class RoomError extends Error {
  constructor(code, retryAfterMs) {
    super(code);
    this.name = "RoomError";
    this.code = code;
    if (retryAfterMs) this.retryAfterMs = retryAfterMs;
  }
}

const hashToken = (token) => createHash("sha256").update(token).digest("hex");

function createRoomCode() {
  const bytes = randomBytes(CODE_BYTES);
  const code = [...bytes].map((byte) => CODE_ALPHABET[byte & 31]).join("");
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export class RoomService {
  constructor({
    repository = new MemoryRoomRepository(),
    config,
    publish = () => {},
    disconnectSocket = () => {},
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  }) {
    this.repository = repository;
    this.config = config;
    this.publish = publish;
    this.disconnectSocket = disconnectSocket;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.reconnectTimers = new Map();
    this.disconnectTimers = new Set();
    this.expiredCodes = new Map();
  }

  create(nickname, socketId) {
    let roomCode;
    do { roomCode = createRoomCode(); } while (this.repository.get(roomCode));

    const now = this.now();
    const room = {
      roomCode,
      createdAt: now,
      expiresAt: now + this.config.roomTtlMs,
      capacity: this.config.maxParticipants,
      participants: new Map(),
      musicState: createInitialMusicState(now),
    };
    const session = this.#createParticipant(room, nickname, socketId, now);
    this.repository.set(room);
    return { room, ...session };
  }

  join(roomCode, nickname, socketId) {
    const room = this.#getJoinableRoom(roomCode);
    if (room.participants.size >= room.capacity) throw new RoomError("ROOM_FULL");

    const now = this.now();
    const session = this.#createParticipant(room, nickname, socketId, now);
    this.publish("room:participant-joined", room.roomCode, this.#publicParticipant(session.participant));
    this.#publishState(room);
    return { room, ...session };
  }

  resume(roomCode, token, socketId) {
    const room = this.#getJoinableRoom(roomCode);
    const tokenHash = hashToken(token);
    const participant = [...room.participants.values()].find((item) => item.tokenHash === tokenHash);
    if (!participant) throw new RoomError("UNAUTHORIZED");
    if (participant.tokenExpiresAt <= this.now()) {
      this.#expireParticipantSession(room, participant);
      throw new RoomError("UNAUTHORIZED");
    }

    const previousSocketId = participant.socketId;
    this.#clearReconnectTimer(participant.participantId);
    participant.socketId = socketId;
    participant.connectionStatus = "online";
    participant.lastSeenAt = this.now();

    if (previousSocketId && previousSocketId !== socketId) this.disconnectSocket(previousSocketId);
    this.publish("room:participant-reconnected", room.roomCode, this.#publicParticipant(participant));
    this.#publishState(room);
    return { room, participant, previousSocketId, tokenHash };
  }

  getState(auth) {
    const { room, participant } = this.#authorize(auth);
    participant.lastSeenAt = this.now();
    return this.#publicRoom(room);
  }

  getSessionExpiry(auth) {
    return this.#authorize(auth).participant.tokenExpiresAt;
  }

  resolvePeer(auth) {
    const { room, participant } = this.#authorize(auth);
    const peer = [...room.participants.values()].find((item) => item.participantId !== participant.participantId);
    if (!peer || peer.connectionStatus !== "online" || !peer.socketId) throw new RoomError("PEER_NOT_AVAILABLE");
    return {
      roomCode: room.roomCode,
      participantId: peer.participantId,
      socketId: peer.socketId,
      connectionStatus: peer.connectionStatus,
    };
  }

  setMicrophoneState(auth, enabled) {
    const { room, participant } = this.#authorize(auth);
    participant.microphoneEnabled = enabled;
    participant.lastSeenAt = this.now();
    this.publish("webrtc:microphone-state", room.roomCode, {
      participantId: participant.participantId,
      microphoneEnabled: enabled,
    });
    this.#publishState(room);
    return this.#publicParticipant(participant);
  }

  getMusicState(auth) {
    const { room, participant } = this.#authorize(auth);
    participant.lastSeenAt = this.now();
    return this.#publicMusicState(room.musicState, this.now());
  }

  applyMusicCommand(auth, event, payload) {
    const { room, participant } = this.#authorize(auth);
    const state = room.musicState;
    if (payload.expectedRevision !== state.revision) {
      this.publish("music:state", room.roomCode, { state: this.#publicMusicState(state, this.now()) });
      throw new RoomError("MUSIC_CONFLICT");
    }

    const now = this.now();
    const currentPosition = getCurrentMusicPosition(state, now);
    const currentTrack = MUSIC_CATALOG.find((track) => track.trackId === state.trackId);
    if (!currentTrack) throw new RoomError("MUSIC_TRACK_NOT_FOUND");

    if (event === "music:play") {
      state.positionSeconds = currentPosition >= currentTrack.durationSeconds ? 0 : currentPosition;
      state.isPlaying = true;
    } else if (event === "music:pause") {
      state.positionSeconds = currentPosition;
      state.isPlaying = false;
    } else if (event === "music:seek") {
      if (!Number.isFinite(payload.positionSeconds) || payload.positionSeconds < 0 || payload.positionSeconds > currentTrack.durationSeconds) {
        throw new RoomError("MUSIC_POSITION_INVALID");
      }
      state.positionSeconds = payload.positionSeconds;
    } else if (event === "music:next" || event === "music:previous") {
      const delta = event === "music:next" ? 1 : -1;
      state.currentTrackIndex = (state.currentTrackIndex + delta + state.playlist.length) % state.playlist.length;
      state.trackId = state.playlist[state.currentTrackIndex].trackId;
      state.positionSeconds = 0;
    } else if (event === "music:select") {
      const selectedIndex = state.playlist.findIndex((track) => track.trackId === payload.trackId && MUSIC_CATALOG.some((catalogTrack) => catalogTrack.trackId === track.trackId));
      if (selectedIndex < 0) throw new RoomError("MUSIC_TRACK_NOT_FOUND");
      state.currentTrackIndex = selectedIndex;
      state.trackId = state.playlist[selectedIndex].trackId;
      state.positionSeconds = 0;
    } else {
      throw new RoomError("INVALID_EVENT");
    }

    state.updatedAt = now;
    state.revision += 1;
    participant.lastSeenAt = now;
    const publicState = this.#publicMusicState(state, now);
    this.publish("music:state", room.roomCode, { state: publicState });
    return publicState;
  }

  leave(auth) {
    const { room, participant } = this.#authorize(auth);
    const publicParticipant = this.#publicParticipant(participant);
    this.#removeParticipant(room, participant);
    this.publish("room:participant-left", room.roomCode, { ...publicParticipant, reason: "left" });

    if (room.participants.size === 0) {
      this.#closeRoom(room, "empty");
      return { roomCode: room.roomCode, closed: true };
    }

    this.#publishState(room);
    return { roomCode: room.roomCode, closed: false, room: this.#publicRoom(room) };
  }

  disconnect(auth) {
    const room = this.repository.get(auth.roomCode);
    const participant = room?.participants.get(auth.participantId);
    if (!participant || participant.socketId !== auth.socketId || participant.connectionStatus !== "online") return;

    participant.connectionStatus = "reconnecting";
    participant.socketId = null;
    participant.lastSeenAt = this.now();
    this.publish("room:participant-disconnected", room.roomCode, this.#publicParticipant(participant));
    this.#publishState(room);

    this.#clearReconnectTimer(participant.participantId);
    const timer = this.setTimer(() => this.#expireDisconnected(room.roomCode, participant.participantId), this.config.reconnectGraceMs);
    timer.unref?.();
    this.reconnectTimers.set(participant.participantId, timer);
  }

  cleanupExpired() {
    const now = this.now();
    for (const room of [...this.repository.values()]) {
      if (room.expiresAt <= now) {
        this.#closeRoom(room, "expired");
        continue;
      }
      for (const participant of [...room.participants.values()]) {
        if (participant.tokenExpiresAt <= now) this.#expireParticipantSession(room, participant);
      }
    }
    for (const [code, expiresAt] of this.expiredCodes) {
      if (expiresAt <= now) this.expiredCodes.delete(code);
    }
  }

  isExpiredCode(roomCode) {
    return (this.expiredCodes.get(roomCode) ?? 0) > this.now();
  }

  shutdown() {
    for (const timer of this.reconnectTimers.values()) this.clearTimer(timer);
    this.reconnectTimers.clear();
    for (const timer of this.disconnectTimers) this.clearTimer(timer);
    this.disconnectTimers.clear();
  }

  #createParticipant(room, nickname, socketId, now) {
    const participantId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const participant = {
      participantId,
      nickname,
      connectionStatus: "online",
      microphoneEnabled: false,
      joinedAt: now,
      lastSeenAt: now,
      socketId,
      tokenHash,
      tokenExpiresAt: now + this.config.sessionTokenTtlMs,
    };
    room.participants.set(participantId, participant);
    return { participant, token };
  }

  #getJoinableRoom(roomCode) {
    const room = this.repository.get(roomCode);
    if (!room) throw new RoomError(this.isExpiredCode(roomCode) ? "ROOM_EXPIRED" : "ROOM_NOT_FOUND");
    if (room.expiresAt <= this.now()) {
      this.#closeRoom(room, "expired");
      throw new RoomError("ROOM_EXPIRED");
    }
    return room;
  }

  #authorize(auth) {
    const room = this.repository.get(auth?.roomCode);
    const participant = room?.participants.get(auth?.participantId);
    if (!room || !participant || participant.socketId !== auth.socketId || participant.tokenHash !== auth.tokenHash || participant.tokenExpiresAt <= this.now()) {
      throw new RoomError("UNAUTHORIZED");
    }
    if (room.expiresAt <= this.now()) {
      this.#closeRoom(room, "expired");
      throw new RoomError("ROOM_EXPIRED");
    }
    return { room, participant };
  }

  #expireDisconnected(roomCode, participantId) {
    this.reconnectTimers.delete(participantId);
    const room = this.repository.get(roomCode);
    const participant = room?.participants.get(participantId);
    if (!room || !participant || participant.connectionStatus !== "reconnecting") return;

    const publicParticipant = this.#publicParticipant(participant);
    this.#removeParticipant(room, participant);
    this.publish("room:participant-left", room.roomCode, { ...publicParticipant, connectionStatus: "disconnected", reason: "reconnect_timeout" });
    if (room.participants.size === 0) this.#closeRoom(room, "empty");
    else this.#publishState(room);
  }

  #expireParticipantSession(room, participant) {
    const publicParticipant = this.#publicParticipant(participant);
    const socketId = participant.socketId;
    this.#removeParticipant(room, participant);
    this.publish("room:participant-left", room.roomCode, { ...publicParticipant, connectionStatus: "disconnected", reason: "session_expired" });
    if (room.participants.size === 0) this.#closeRoom(room, "empty");
    else this.#publishState(room);
    if (socketId) this.#disconnectAfterBroadcast(socketId);
  }

  #removeParticipant(room, participant) {
    this.#clearReconnectTimer(participant.participantId);
    room.participants.delete(participant.participantId);
  }

  #closeRoom(room, reason) {
    this.repository.delete(room.roomCode);
    if (reason === "expired") this.expiredCodes.set(room.roomCode, this.now() + EXPIRED_CODE_RETENTION_MS);
    this.publish("room:closed", room.roomCode, { roomCode: room.roomCode, reason, closedAt: this.now() });
    for (const participant of room.participants.values()) {
      this.#clearReconnectTimer(participant.participantId);
      if (participant.socketId) this.#disconnectAfterBroadcast(participant.socketId);
    }
  }

  #disconnectAfterBroadcast(socketId) {
    const timer = this.setTimer(() => {
      this.disconnectTimers.delete(timer);
      this.disconnectSocket(socketId);
    }, 100);
    timer.unref?.();
    this.disconnectTimers.add(timer);
  }

  #clearReconnectTimer(participantId) {
    const timer = this.reconnectTimers.get(participantId);
    if (timer) this.clearTimer(timer);
    this.reconnectTimers.delete(participantId);
  }

  #publishState(room) {
    this.publish("room:state", room.roomCode, this.#publicRoom(room));
  }

  #publicRoom(room) {
    return {
      roomCode: room.roomCode,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      capacity: room.capacity,
      participants: [...room.participants.values()].map((participant) => this.#publicParticipant(participant)),
      musicState: this.#publicMusicState(room.musicState, this.now()),
    };
  }

  #publicMusicState(state, now) {
    return {
      ...state,
      positionSeconds: getCurrentMusicPosition(state, now),
      updatedAt: now,
      playlist: state.playlist.map((track) => ({ ...track })),
    };
  }

  #publicParticipant(participant) {
    return {
      participantId: participant.participantId,
      nickname: participant.nickname,
      connectionStatus: participant.connectionStatus,
      microphoneEnabled: participant.microphoneEnabled,
      joinedAt: participant.joinedAt,
      lastSeenAt: participant.lastSeenAt,
    };
  }
}
