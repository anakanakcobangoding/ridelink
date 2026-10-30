"use client";

const LABELS = {
  waiting: "Waiting for rider",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  disconnected: "Disconnected",
  failed: "Connection failed",
};

export default function PeerConnectionStatus({ status, iceState }) {
  return (
    <div className={`peer-connection-status peer-status-${status || "waiting"}`} role="status" aria-live="polite">
      <span className="peer-connection-dot" aria-hidden="true" />
      <span>{LABELS[status] || LABELS.waiting}</span>
      {iceState && iceState !== "new" ? <small>ICE {iceState}</small> : null}
    </div>
  );
}
