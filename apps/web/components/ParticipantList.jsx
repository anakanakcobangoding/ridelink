"use client";

const STATUS = {
  online: { label: "Online", className: "participant-online" },
  reconnecting: { label: "Menyambung kembali", className: "participant-reconnecting" },
  disconnected: { label: "Offline", className: "participant-offline" },
};

export default function ParticipantList({ room, currentParticipantId }) {
  const participants = room?.participants ?? [];
  const slots = Array.from({ length: room?.capacity ?? 2 }, (_, index) => participants[index] ?? null);

  return (
    <section className="room-panel participant-panel" aria-labelledby="participants-title">
      <div className="room-panel-heading">
        <div>
          <p className="room-kicker">DALAM PERJALANAN</p>
          <h2 id="participants-title">Rider</h2>
        </div>
        <span className="participant-count">{participants.length}/{room?.capacity ?? 2}</span>
      </div>
      <ul className="participant-list">
        {slots.map((participant, index) => {
          if (!participant) {
            return (
              <li className="participant-row participant-empty" key={`empty-${index}`}>
                <span className="participant-avatar" aria-hidden="true">{index + 1}</span>
                <span className="participant-details"><strong>Menunggu rider</strong><small>Slot masih tersedia</small></span>
                <span className="participant-status-text">Kosong</span>
              </li>
            );
          }

          const status = STATUS[participant.connectionStatus] || STATUS.disconnected;
          const isCurrent = participant.participantId === currentParticipantId;
          return (
            <li className="participant-row" key={participant.participantId}>
              <span className="participant-avatar" aria-hidden="true">{participant.nickname.slice(0, 1).toUpperCase()}</span>
              <span className="participant-details">
                <strong>{participant.nickname}{isCurrent ? <span className="you-tag">KAMU</span> : null}</strong>
                <small>{new Date(participant.joinedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} bergabung</small>
              </span>
              <span className={`participant-status ${status.className}`}><span className="participant-status-dot" />{status.label}</span>
            </li>
          );
        })}
      </ul>
      {participants.length >= (room?.capacity ?? 2) ? <p className="room-full-note">Room penuh · hanya dua rider yang dapat bergabung.</p> : null}
    </section>
  );
}
