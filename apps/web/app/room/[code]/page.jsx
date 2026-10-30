"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import ConnectionStatus from "../../../components/ConnectionStatus.jsx";
import InviteRoom from "../../../components/InviteRoom.jsx";
import IntercomPanel from "../../../components/IntercomPanel.jsx";
import MusicPlayer from "../../../components/MusicPlayer.jsx";
import LeaveRoom from "../../../components/LeaveRoom.jsx";
import ParticipantList from "../../../components/ParticipantList.jsx";
import RoomHeader from "../../../components/RoomHeader.jsx";
import NavigationPanel from "../../../components/navigation/NavigationPanel.jsx";
import { useRoom } from "../../../hooks/useRoom.js";
import { roomClient } from "../../../lib/room-client.js";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.code || "";
  const { room, currentParticipantId, connectionStatus, loading, error, closed, setError } = useRoom(roomCode);
  const [leaving, setLeaving] = useState(false);

  async function leaveRoom() {
    setLeaving(true);
    setError("");
    try {
      await roomClient.leaveRoom(roomCode);
      router.replace("/");
    } catch (reason) {
      setError(reason.message || "Tidak dapat keluar dari room.");
      setLeaving(false);
    }
  }

  return (
    <main className="room-page-shell">
      <RoomHeader roomCode={room?.roomCode || roomCode} connectionStatus={connectionStatus} />
      <section className="room-page-content" aria-labelledby="room-page-title">
        <div className="room-page-intro">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> RUANG PERJALANAN PRIVAT</p>
            <h1 id="room-page-title">Perjalanan<br /><span>bersama.</span></h1>
            <p className="room-page-description">Bagikan kode room kepada satu rider untuk bergabung.</p>
          </div>
          {room ? <div className="room-state-chip"><span className="room-state-dot" /> {room.participants.length >= room.capacity ? "ROOM PENUH" : "MENUNGGU RIDER"}</div> : null}
        </div>

        {loading ? (
          <section className="room-panel room-loading" role="status" aria-live="polite">
            <span className="loading-marker" aria-hidden="true" /> Memulihkan sesi room…
          </section>
        ) : null}

        {!loading && room ? (
          <div className="room-dashboard-grid">
            <div className="room-dashboard-main">
              <ParticipantList room={room} currentParticipantId={currentParticipantId} />
              <IntercomPanel room={room} currentParticipantId={currentParticipantId} signalingStatus={connectionStatus} />
              <MusicPlayer room={room} signalingStatus={connectionStatus} />
              <NavigationPanel />
              <section className="room-panel room-safety-note">
                <span className="safety-icon" aria-hidden="true">!</span>
                <p>Aktifkan mikrofon dan audio hanya saat berhenti di tempat aman. Jangan mengoperasikan layar saat berkendara.</p>
              </section>
            </div>
            <aside className="room-dashboard-aside">
              <InviteRoom roomCode={room.roomCode} />
              <section className="room-panel room-connection-panel">
                <p className="room-kicker">KONEKSI ROOM</p>
                <ConnectionStatus status={connectionStatus} />
                <p className="connection-hint">Status ini menunjukkan koneksi signaling. Status panggilan WebRTC ditampilkan di panel intercom.</p>
              </section>
            </aside>
          </div>
        ) : null}

        {!loading && !room ? (
          <section className="room-panel room-problem-panel" role="alert">
            <span className="problem-symbol" aria-hidden="true">!</span>
            <h2>{closed ? "Room tidak tersedia" : "Tidak dapat memuat room"}</h2>
            <p>{error || "Sesi room belum tersedia pada tab ini."}</p>
            <Link className="action-button button-primary room-home-link" href="/">Kembali ke beranda <span aria-hidden="true">↗</span></Link>
          </section>
        ) : null}

        {error && room ? <p className="room-inline-error" role="alert">{error}</p> : null}
        {room ? <div className="room-page-actions"><p>Room berakhir otomatis setelah masa aktifnya habis.</p><LeaveRoom onLeave={leaveRoom} disabled={leaving || connectionStatus !== "connected"} /></div> : null}
      </section>
      <footer className="footer room-page-footer"><span>© 2026 RIDELINK</span><span>PERHATIKAN JALAN. GUNAKAN SAAT BERHENTI.</span></footer>
    </main>
  );
}
