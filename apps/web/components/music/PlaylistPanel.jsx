"use client";

export default function PlaylistPanel({ playlist = [], currentTrackId, disabled, onSelect }) {
  return (
    <section className="music-playlist" aria-label="Playlist RideLink">
      <div className="music-subheading"><p className="room-kicker">PLAYLIST ROOM</p><span>{playlist.length} track</span></div>
      <ol>
        {playlist.map((track, index) => (
          <li key={track.trackId}>
            <button type="button" className={`music-track-row ${currentTrackId === track.trackId ? "music-track-current" : ""}`} aria-current={currentTrackId === track.trackId ? "true" : undefined} onClick={() => onSelect(track.trackId)} disabled={disabled}>
              <span className="music-track-index">{String(index + 1).padStart(2, "0")}</span>
              <span className="music-track-copy"><strong>{track.title}</strong><small>{track.artist}</small></span>
              <span className="music-track-duration">{Math.floor(track.durationSeconds / 60)}:{String(track.durationSeconds % 60).padStart(2, "0")}</span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
