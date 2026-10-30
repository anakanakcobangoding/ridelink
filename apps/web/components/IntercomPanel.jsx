"use client";

import { useIntercom } from "../hooks/useIntercom.js";
import AudioPermissionNotice from "./AudioPermissionNotice.jsx";
import ConnectionDiagnostics from "./ConnectionDiagnostics.jsx";
import MicrophoneButton from "./MicrophoneButton.jsx";
import PeerConnectionStatus from "./PeerConnectionStatus.jsx";

function RiderVoiceState({ label, participant, local, microphoneEnabled, connectionStatus }) {
  return (
    <article className="voice-rider-card">
      <div className="voice-rider-avatar" aria-hidden="true">{participant?.nickname?.slice(0, 1).toUpperCase() || "—"}</div>
      <div className="voice-rider-copy">
        <span className="voice-rider-label">{label}{local ? <span className="you-tag">KAMU</span> : null}</span>
        <strong>{participant?.nickname || "Menunggu rider"}</strong>
        <span className="voice-rider-microphone">{microphoneEnabled ? "Mikrofon aktif" : "Mikrofon mati"}</span>
      </div>
      <PeerConnectionStatus status={connectionStatus} />
    </article>
  );
}

export default function IntercomPanel({ room, currentParticipantId, signalingStatus }) {
  const {
    state,
    audioRef,
    peer,
    enableMicrophone,
    toggleMute,
    enableRemoteAudio,
    retryConnection,
    setRelayOnly,
  } = useIntercom({ room, currentParticipantId, signalingStatus });
  const localConnectionStatus = state.connectionStatus;
  const participants = [...(room?.participants ?? [])].sort((left, right) => left.joinedAt - right.joinedAt).slice(0, 2);
  const riders = Array.from({ length: 2 }, (_, index) => {
    const participant = participants[index] ?? null;
    const local = participant?.participantId === currentParticipantId;
    const connectionStatus = !participant
      ? "waiting"
      : participant.connectionStatus !== "online"
        ? participant.connectionStatus === "reconnecting" ? "reconnecting" : "disconnected"
        : localConnectionStatus;
    const microphoneEnabled = local
      ? state.microphoneEnabled
      : participant?.participantId === peer?.participantId
        ? state.peerMicrophoneEnabled || Boolean(participant?.microphoneEnabled)
        : Boolean(participant?.microphoneEnabled);
    return { label: index === 0 ? "Rider A" : "Rider B", participant, local, connectionStatus, microphoneEnabled };
  });

  return (
    <section className="room-panel intercom-panel" aria-labelledby="intercom-title">
      <div className="room-panel-heading intercom-heading">
        <div>
          <p className="room-kicker">VOICE INTERCOM</p>
          <h2 id="intercom-title">Suara antar rider</h2>
        </div>
        <PeerConnectionStatus status={state.connectionStatus} iceState={state.iceConnectionState} />
      </div>

      <div className="voice-riders">
        {riders.map((rider) => <RiderVoiceState key={rider.label} {...rider} />)}
      </div>

      <div className="intercom-controls">
        <MicrophoneButton microphoneStatus={state.microphoneStatus} microphoneEnabled={state.microphoneEnabled} onEnable={enableMicrophone} onToggle={toggleMute} />
      </div>

      <AudioPermissionNotice microphoneStatus={state.microphoneStatus} remoteAudioBlocked={state.remoteAudioBlocked} error={state.error} onEnableAudio={enableRemoteAudio} />
      <audio ref={audioRef} className="sr-only" autoPlay playsInline aria-label="Suara rider lain" />
      <ConnectionDiagnostics state={state} socketStatus={signalingStatus} roomMembership={Boolean(room)} onRetry={retryConnection} onRelayOnlyChange={setRelayOnly} />
    </section>
  );
}
