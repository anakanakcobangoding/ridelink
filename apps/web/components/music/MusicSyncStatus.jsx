"use client";

const STATUS = {
  synchronizing: "Menyelaraskan posisi",
  synced: "Tersinkron",
  buffering: "Memuat audio",
  "autoplay-blocked": "Perlu sentuhan untuk memutar",
  offline: "Menunggu koneksi room",
  error: "Audio bermasalah",
};

const DUCKING_STATUS = {
  idle: "Musik normal",
  ducking: "Menurunkan musik untuk navigasi",
  ducked: "Musik direndahkan untuk navigasi",
  restoring: "Memulihkan volume musik",
};

export default function MusicSyncStatus({ status, error, onEnablePlayback, canEnablePlayback, duckingState = "idle", audioContextState = "uninitialized" }) {
  const audioSuspended = audioContextState === "suspended" && canEnablePlayback;
  const needsGesture = status === "autoplay-blocked" || audioSuspended;
  return (
    <div className={`music-sync-status music-sync-${status || "synchronizing"}`} role={error ? "alert" : "status"} aria-live="polite">
      <span className="music-sync-dot" aria-hidden="true" />
      <span>{error || STATUS[status] || STATUS.synchronizing}</span>
      <span className={`music-ducking-state music-ducking-${duckingState}`} data-ducking-state={duckingState}>{DUCKING_STATUS[duckingState] || DUCKING_STATUS.idle}</span>
      {needsGesture ? <button type="button" onClick={onEnablePlayback}>Aktifkan audio</button> : null}
    </div>
  );
}
