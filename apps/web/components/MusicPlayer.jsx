"use client";

import { useRef } from "react";
import { useMusicSync } from "../hooks/useMusicSync.js";
import MusicControls from "./music/MusicControls.jsx";
import PlaylistPanel from "./music/PlaylistPanel.jsx";
import MusicSyncStatus from "./music/MusicSyncStatus.jsx";
import MusicVolumeSlider from "./music/MusicVolumeSlider.jsx";
import { useAudioDucking } from "../hooks/useAudioDucking.js";

export default function MusicPlayer({ room, signalingStatus }) {
  const audioRef = useRef(null);
  const audioDucking = useAudioDucking({ audioRef });
  const player = useMusicSync({ room, signalingStatus, audioRef, audioDucking });
  const currentTrack = player.currentTrack;
  const disabled = signalingStatus !== "connected" || !player.musicState;

  return (
    <section className="room-panel music-player" aria-labelledby="music-player-title">
      <div className="room-panel-heading music-player-heading">
        <div>
          <p className="room-kicker">MUSIK BERSAMA</p>
          <h2 id="music-player-title">Shared music</h2>
        </div>
        <MusicSyncStatus
          status={player.syncStatus}
          error={player.error}
          canEnablePlayback={Boolean(player.musicState?.isPlaying)}
          onEnablePlayback={player.enablePlayback}
          duckingState={player.duckingState}
          audioContextState={player.audioContextState}
        />
      </div>

      <div className="music-now-playing">
        <div className="music-record-art" aria-hidden="true"><span>RL</span></div>
        <div className="music-track-heading">
          <strong>{currentTrack?.title || "Memuat playlist…"}</strong>
          <span>{currentTrack?.artist || "RideLink"}</span>
        </div>
        <span className="music-revision">REV {player.musicState?.revision ?? "—"}</span>
      </div>

      <MusicControls
        track={currentTrack}
        isPlaying={Boolean(player.musicState?.isPlaying)}
        positionSeconds={player.positionSeconds}
        disabled={disabled}
        onPlay={player.play}
        onPause={player.pause}
        onNext={player.next}
        onPrevious={player.previous}
        onSeek={player.seek}
      />

      <PlaylistPanel playlist={player.musicState?.playlist ?? []} currentTrackId={player.musicState?.trackId} disabled={disabled} onSelect={player.selectTrack} />
      <MusicVolumeSlider
        volume={player.userVolume}
        muted={player.localMuted}
        onVolumeChange={player.setUserVolume}
        onMuteToggle={() => player.setLocalMuted((muted) => !muted)}
      />
      <audio
        ref={audioRef}
        className="sr-only"
        preload="metadata"
        playsInline
        aria-label="Musik bersama RideLink"
        onWaiting={player.onBuffering}
        onStalled={player.onBuffering}
        onPlaying={player.onPlaying}
        onCanPlay={player.onCanPlay}
        onPause={player.onPaused}
        onEnded={player.onEnded}
        onError={player.onMediaError}
      />
    </section>
  );
}
