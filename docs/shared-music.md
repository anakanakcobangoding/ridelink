# Shared Music MVP

RideLink uses synchronized local playback. The Node signaling server owns the catalogue and room playback clock. Each browser downloads the catalogued static WAV directly from the RideLink HTTPS origin and plays it locally; the server does not relay or transcode audio and Socket.IO carries no file bytes.

The current catalogue contains two short, 18-second procedural melodies generated specifically for RideLink. They are original demo assets, not recordings or third-party songs:

- `Open Road Loop` — `apps/web/public/audio/ridelink-demo-loop.wav`
- `Coastal Miles` — `apps/web/public/audio/ridelink-demo-coastal.wav`

Catalogue IDs, duration, source paths, and metadata are defined in `apps/signaling/src/music-catalog.js`. To add music, place a file owned by RideLink or cleared for distribution in `apps/web/public/audio/`, then add its fixed ID and metadata to that server catalogue. Do not add user-provided URLs or proxy third-party streams.

Room state contains the shared playlist, selected track, `isPlaying`, `positionSeconds`, server `updatedAt`, and monotonic `revision`. Commands carry `expectedRevision`; concurrent stale commands are rejected with `MUSIC_CONFLICT` and clients apply the newer broadcast state. Playback position advances from server time while playing. The browser corrects material drift (0.75 seconds threshold, 2.5-second cooldown); this is approximate synchronization and not sample-accurate.

Volume and mute are per browser and stored locally. The player computes `effectiveVolume = userVolume × duckingGain`; navigation ducking is implemented in [audio-ducking.md](./audio-ducking.md). Music uses an `<audio>` element separate from the remote WebRTC audio element and is not added to the microphone stream. Safari can reject autoplay; the rider must tap **Aktifkan audio**. iOS may limit script-controlled media volume or change Bluetooth routing in call mode; the local slider and ducking have not been verified on iPhone. Background and locked-screen playback depend on iOS and remain unverified.

Run `npm run test:e2e` for two-context tests that play the real static demo WAV, check `currentTime` advancement and correction, exercise autoplay rejection/recovery, next/previous/seek, local mute independence, buffering indicator events, audio resource cleanup, and navigation ducking measured from the local output analyser while the other rider remains at normal gain. The separate WebRTC e2e test continues to validate voice connectivity during playback. These automated tests use Chromium and do not establish physical iPhone/Bluetooth behavior or intelligibility through real speakers.
