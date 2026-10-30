"use client";

const STATUS_LABELS = {
  connecting: "Menghubungkan",
  connected: "Terhubung",
  reconnecting: "Mencoba tersambung kembali",
  disconnected: "Terputus",
};

export default function ConnectionStatus({ status }) {
  const label = STATUS_LABELS[status] || STATUS_LABELS.connecting;
  return (
    <div className={`connection-status connection-${status || "connecting"}`} role="status" aria-live="polite">
      <span className="connection-indicator" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
