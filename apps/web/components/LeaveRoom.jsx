"use client";

export default function LeaveRoom({ onLeave, disabled = false }) {
  return (
    <button className="leave-room-button" type="button" onClick={onLeave} disabled={disabled}>
      <span aria-hidden="true">←</span> Keluar dari room
    </button>
  );
}
