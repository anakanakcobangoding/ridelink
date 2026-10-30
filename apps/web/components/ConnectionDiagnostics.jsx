"use client";

export default function ConnectionDiagnostics({ state, socketStatus, roomMembership, onRetry, onRelayOnlyChange }) {
  return (
    <section className="connection-diagnostics" aria-labelledby="diagnostics-title">
      <div className="diagnostics-heading">
        <div>
          <p className="room-kicker">STATUS WEBRTC</p>
          <h3 id="diagnostics-title">Diagnostik koneksi</h3>
        </div>
        <span className="candidate-badge">{state.candidateType === "unknown" ? "ICE —" : `ICE ${state.candidateType}`}</span>
      </div>
      <dl className="diagnostics-grid">
        <div><dt>Socket.IO</dt><dd>{socketStatus}</dd></div>
        <div><dt>Room</dt><dd>{roomMembership ? "joined" : "not joined"}</dd></div>
        <div><dt>Izin mic</dt><dd>{state.microphonePermission}</dd></div>
        <div><dt>Track lokal</dt><dd>{state.localAudioTrackState}</dd></div>
        <div><dt>Peer</dt><dd>{state.connectionState}</dd></div>
        <div><dt>ICE</dt><dd>{state.iceConnectionState}</dd></div>
        <div><dt>Signaling</dt><dd>{state.signalingState}</dd></div>
        <div><dt>Pasangan ICE</dt><dd>{state.selectedCandidatePair}</dd></div>
        <div><dt>ICE candidate</dt><dd>{state.candidateType}</dd></div>
        <div><dt>TURN</dt><dd>{state.turnAvailable ? "Tersedia" : "Belum dikonfigurasi"}</dd></div>
        <div><dt>Audio masuk</dt><dd>{state.incomingAudioBytes.toLocaleString()} B</dd></div>
        <div><dt>Audio keluar</dt><dd>{state.outgoingAudioBytes.toLocaleString()} B</dd></div>
      </dl>
      <label className="relay-mode-control">
        <input type="checkbox" checked={state.iceTransportPolicy === "relay"} disabled={!state.turnAvailable} onChange={(event) => onRelayOnlyChange(event.target.checked)} />
        <span>Diagnostik relay-only</span>
      </label>
      {!state.turnAvailable ? <p className="diagnostics-notice">Mode relay-only perlu konfigurasi TURN di signaling server.</p> : null}
      <button className="diagnostics-retry-button" type="button" onClick={onRetry} disabled={state.connectionStatus === "connected" || state.connectionStatus === "waiting"}>Retry Connection</button>
    </section>
  );
}
