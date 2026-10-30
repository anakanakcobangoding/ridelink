"use client";

export default function MicrophoneButton({ microphoneStatus, microphoneEnabled, onEnable, onToggle }) {
  const requesting = microphoneStatus === "requesting";
  const hasLiveMicrophone = microphoneEnabled || microphoneStatus === "muted";
  const label = requesting
    ? "Meminta izin mikrofon…"
    : hasLiveMicrophone
      ? microphoneEnabled ? "Mute microphone" : "Unmute microphone"
      : microphoneStatus === "device-disconnected" ? "Aktifkan kembali mikrofon" : "Enable microphone";

  return (
    <button
      className={`microphone-button ${microphoneEnabled ? "microphone-active" : ""}`}
      type="button"
      onClick={hasLiveMicrophone ? onToggle : onEnable}
      disabled={requesting}
      aria-pressed={hasLiveMicrophone ? microphoneEnabled : undefined}
    >
      <span className="microphone-glyph" aria-hidden="true">{microphoneEnabled ? "●" : "◌"}</span>
      <span>{label}</span>
    </button>
  );
}
