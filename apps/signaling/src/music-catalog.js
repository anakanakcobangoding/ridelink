export const MUSIC_CATALOG = Object.freeze([
  Object.freeze({
    trackId: "ridelink-original-loop",
    title: "Open Road Loop",
    artist: "RideLink Original Demo",
    durationSeconds: 18,
    sourceUrl: "/audio/ridelink-demo-loop.wav",
    license: "Original procedurally synthesized RideLink demo audio",
  }),
  Object.freeze({
    trackId: "ridelink-coastal-loop",
    title: "Coastal Miles",
    artist: "RideLink Original Demo",
    durationSeconds: 18,
    sourceUrl: "/audio/ridelink-demo-coastal.wav",
    license: "Original procedurally synthesized RideLink demo audio",
  }),
]);

export function createInitialMusicState(now) {
  return {
    trackId: MUSIC_CATALOG[0].trackId,
    isPlaying: false,
    positionSeconds: 0,
    updatedAt: now,
    revision: 1,
    playlist: MUSIC_CATALOG.map((track) => ({ ...track })),
    currentTrackIndex: 0,
  };
}

export function getCurrentMusicPosition(state, now) {
  if (!state.isPlaying) return Math.min(state.positionSeconds, MUSIC_CATALOG.find((track) => track.trackId === state.trackId)?.durationSeconds ?? 0);
  const duration = MUSIC_CATALOG.find((track) => track.trackId === state.trackId)?.durationSeconds ?? 0;
  return Math.min(duration, Math.max(0, state.positionSeconds + Math.max(0, now - state.updatedAt) / 1000));
}
