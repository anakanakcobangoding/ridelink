"use client";

import { useState } from "react";

export default function InviteRoom({ roomCode }) {
  const [feedback, setFeedback] = useState("");

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(roomCode);
      setFeedback("Kode room disalin.");
    } catch {
      const input = document.getElementById("invite-room-code");
      input?.focus();
      input?.select();
      setFeedback("Pilih kode lalu salin dari menu browser.");
    }
  }

  return (
    <section className="room-panel invite-panel" aria-labelledby="invite-title">
      <div className="room-panel-heading">
        <div>
          <p className="room-kicker">UNDANG RIDER KEDUA</p>
          <h2 id="invite-title">Kode room</h2>
        </div>
        <span className="invite-lock" aria-hidden="true">⌑</span>
      </div>
      <div className="invite-code-row">
        <label className="sr-only" htmlFor="invite-room-code">Kode room undangan</label>
        <input id="invite-room-code" className="invite-code-input" value={roomCode} readOnly onClick={(event) => event.currentTarget.select()} />
        <button className="copy-code-button" type="button" onClick={copyCode}>Salin kode</button>
      </div>
      <p className="invite-hint">Bagikan kode ini langsung kepada rider yang akan bergabung.</p>
      <p className="invite-feedback" aria-live="polite">{feedback}</p>
    </section>
  );
}
