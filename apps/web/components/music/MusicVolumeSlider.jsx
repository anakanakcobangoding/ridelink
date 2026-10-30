"use client";

export default function MusicVolumeSlider({ volume, muted, onVolumeChange, onMuteToggle }) {
  return (
    <div className="music-volume-control">
      <button type="button" className="music-mute-button" aria-label={muted || volume === 0 ? "Aktifkan musik lokal" : "Mute musik lokal"} aria-pressed={muted || volume === 0} onClick={onMuteToggle}>
        {muted || volume === 0 ? "Musik mati" : "Musik lokal"}
      </button>
      <label htmlFor="music-local-volume">Volume lokal</label>
      <input id="music-local-volume" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => onVolumeChange(Number(event.target.value))} aria-label="Volume lokal" />
      <output htmlFor="music-local-volume">{Math.round(volume * 100)}%</output>
    </div>
  );
}
