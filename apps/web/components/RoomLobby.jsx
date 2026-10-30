"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { roomClient } from "../lib/room-client.js";

function ArrowIcon() {
  return <span aria-hidden="true" className="arrow-icon">↗</span>;
}

export default function RoomLobby() {
  const router = useRouter();
  const [createName, setCreateName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  async function submitRoom(action, nickname) {
    setPending(action);
    setError("");
    try {
      const result = action === "create"
        ? await roomClient.createRoom(nickname)
        : await roomClient.joinRoom(roomCode, nickname);
      router.push(`/room/${encodeURIComponent(result.room.roomCode)}`);
    } catch (reason) {
      setError(reason.message || "Tidak dapat membuka room. Coba lagi.");
    } finally {
      setPending("");
    }
  }

  return (
    <>
      <div className="room-actions" aria-label="Aksi room">
        <article className="action-card action-card-primary">
          <div className="action-heading">
            <span className="action-number">01</span>
            <span className="action-icon create-icon" aria-hidden="true">＋</span>
          </div>
          <h2>Buat room</h2>
          <p>Mulai perjalanan baru dan undang satu rider.</p>
          <form onSubmit={(event) => { event.preventDefault(); submitRoom("create", createName); }}>
            <label className="room-code-label" htmlFor="create-nickname">NAMA PANGGILAN</label>
            <input className="room-input" id="create-nickname" name="nickname" type="text" value={createName} onChange={(event) => setCreateName(event.target.value)} minLength={2} maxLength={24} autoComplete="nickname" required />
            <button className="action-button button-primary" type="submit" disabled={Boolean(pending)}>
              {pending === "create" ? "Membuat room…" : "Buat room"} <ArrowIcon />
            </button>
          </form>
        </article>

        <article className="action-card">
          <div className="action-heading">
            <span className="action-number">02</span>
            <span className="action-icon join-icon" aria-hidden="true">⌁</span>
          </div>
          <h2>Gabung room</h2>
          <p>Masukkan kode dari rider yang membuat room.</p>
          <form onSubmit={(event) => { event.preventDefault(); submitRoom("join", joinName); }}>
            <label className="room-code-label" htmlFor="join-nickname">NAMA PANGGILAN</label>
            <input className="room-input" id="join-nickname" name="nickname" type="text" value={joinName} onChange={(event) => setJoinName(event.target.value)} minLength={2} maxLength={24} autoComplete="nickname" required />
            <label className="room-code-label room-code-label-spaced" htmlFor="room-code">KODE ROOM</label>
            <div className="join-row">
              <input id="room-code" name="roomCode" type="text" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} placeholder="ABCDE-FGHIJ" autoComplete="off" autoCapitalize="characters" spellCheck="false" maxLength={11} pattern="[A-Za-z0-9-]{10,11}" aria-describedby="join-help" required />
              <button className="join-button" type="submit" disabled={Boolean(pending)} aria-label="Gabung room" title="Gabung room"><ArrowIcon /></button>
            </div>
            <p className="sr-only" id="join-help">Masukkan kode room dengan 10 karakter.</p>
          </form>
        </article>
      </div>
      <p className="room-lobby-error" aria-live="polite">{error}</p>
      <p className="phase-note"><span aria-hidden="true">◷</span> Room privat · Maksimal 2 rider</p>
    </>
  );
}
