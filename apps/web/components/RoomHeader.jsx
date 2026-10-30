import Link from "next/link";
import ConnectionStatus from "./ConnectionStatus.jsx";

export default function RoomHeader({ roomCode, connectionStatus }) {
  return (
    <header className="room-topbar">
      <Link className="brand" href="/" aria-label="Kembali ke beranda">
        <span className="brand-icon" aria-hidden="true">⌁</span>
        <span>ride<span className="brand-light">link</span></span>
      </Link>
      <div className="room-topbar-meta">
        <span className="room-topbar-code">ROOM {roomCode}</span>
        <ConnectionStatus status={connectionStatus} />
      </div>
    </header>
  );
}
