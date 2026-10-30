"use client";

export default function AudioPermissionNotice({ microphoneStatus, remoteAudioBlocked, error, onEnableAudio }) {
  const needsMicrophone = microphoneStatus === "permission-required" || microphoneStatus === "denied" || microphoneStatus === "unavailable" || microphoneStatus === "device-disconnected";
  const message = microphoneStatus === "permission-required"
    ? "Aktifkan mikrofon setelah berhenti di tempat yang aman. Safari akan meminta izin pada perangkat ini."
    : microphoneStatus === "requesting"
      ? "Menunggu izin mikrofon dari browser…"
      : error || (needsMicrophone ? "Mikrofon belum aktif." : "Pemrosesan audio mengikuti kemampuan browser dan headset.");

  return (
    <div className="audio-permission-notice" role={error ? "alert" : "status"} aria-live="polite">
      <span className="safety-icon" aria-hidden="true">i</span>
      <div className="audio-notice-copy">
        <strong>{remoteAudioBlocked ? "Aktifkan audio masuk" : needsMicrophone ? "Izin mikrofon diperlukan" : "Audio browser"}</strong>
        <p>{remoteAudioBlocked ? "Browser membatasi autoplay. Ketuk untuk mulai mendengar rider lain." : message}</p>
      </div>
      {remoteAudioBlocked ? <button className="audio-enable-button" type="button" onClick={onEnableAudio}>Aktifkan audio</button> : null}
    </div>
  );
}
