"use client";

import { useState } from "react";

function formatTime(seconds = 0) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export default function MusicControls({ track, isPlaying, positionSeconds, disabled, onPlay, onPause, onNext, onPrevious, onSeek }) {
  const [draft, setDraft] = useState(positionSeconds);
  const [editing, setEditing] = useState(false);
  function commitSeek(value = draft) {
    setEditing(false);
    onSeek(value);
  }

  return (
    <div className="music-controls">
      <div className="music-progress-labels"><span>{formatTime(editing ? draft : positionSeconds)}</span><span>{formatTime(track?.durationSeconds)}</span></div>
      <input
        className="music-progress"
        aria-label="Posisi lagu"
        type="range"
        min="0"
        max={track?.durationSeconds ?? 0}
        step="0.25"
        value={Math.min(track?.durationSeconds ?? 0, editing ? draft : positionSeconds)}
        disabled={disabled || !track}
        onPointerDown={(event) => { setEditing(true); setDraft(Number(event.currentTarget.value)); }}
        onChange={(event) => { setEditing(true); setDraft(Number(event.target.value)); }}
        onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
        onKeyUp={(event) => commitSeek(Number(event.currentTarget.value))}
      />
      <div className="music-transport-controls">
        <button type="button" className="music-transport-button" aria-label="Track sebelumnya" onClick={onPrevious} disabled={disabled || !track}>|‹</button>
        <button type="button" className="music-play-button" onClick={isPlaying ? onPause : onPlay} disabled={disabled || !track} aria-label={isPlaying ? "Jeda musik" : "Putar musik"}>
          {isPlaying ? "Jeda" : "Putar"}
        </button>
        <button type="button" className="music-transport-button" aria-label="Track berikutnya" onClick={onNext} disabled={disabled || !track}>›|</button>
      </div>
    </div>
  );
}
