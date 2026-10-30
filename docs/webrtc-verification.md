# RideLink WebRTC Verification

## Automated browser verification

Install the matching test browser once, then run the local end-to-end scenario:

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

The Playwright test starts a separate signaling process and Next.js dev server. It opens two isolated Chromium contexts with fake microphone devices and browser-granted microphone permission. It verifies room creation/join, peer and ICE connected states, a live remote audio receiver and playing remote `<audio>` element, increasing inbound and outbound audio RTP byte counters, microphone mute/unmute, and closure of both peer connections and both local microphone tracks after one participant leaves. The remaining participant's remote audio element is detached as well.

This demonstrates that Chromium exchanged and played synthetic WebRTC audio media in a local direct ICE session. It does not prove intelligible acoustic sound from physical speakers/headsets, operation across the public internet, mobile network traversal, TURN relay, Safari compatibility, or background playback.

## TURN readiness

TURN is **not configured by default** in `.env.example`. Configure these variables only in the signaling service environment:

- `TURN_URLS`: one or more `turn:` / `turns:` URLs, including transport parameters as required by the service.
- `TURN_SHARED_SECRET`: private coturn REST API shared secret of at least 32 characters.
- `TURN_CREDENTIAL_TTL_SECONDS`: temporary credential lifetime, capped to the room session expiry.
- `STUN_URLS`: optional STUN URLs; the development default is not an availability guarantee.

The authenticated `webrtc:get-ice-config` command returns ICE servers and short-lived TURN credentials. The secret is never sent to the web client. With TURN configured, the room diagnostic “Diagnostik relay-only” option rebuilds the peer connection using relay-only policy. Confirm the UI reports `TURN Tersedia` and `Pasangan ICE relay`; a successful direct candidate does not test TURN. Never put TURN secrets in `NEXT_PUBLIC_*` variables.

Without an operated TURN service and successful relay testing, do not rely on calls between separate mobile networks or restrictive NATs.

## Manual test on two iPhones

Run this checklist **only while both motorcycles are stopped in a safe place**. Never operate a phone while riding.

1. Deploy the frontend over HTTPS and signaling over WSS with the production origin in `SIGNALING_CORS_ORIGIN`. Configure TURN before testing across separate networks.
2. On both iPhones, open the same HTTPS site in Safari. Connect each Bluetooth headset before opening the room and note the headset model and iOS version.
3. iPhone A creates a room. iPhone B joins using the invitation code. Confirm both names and the two-person room state are visible.
4. On each phone, tap **Enable microphone** and accept Safari's microphone prompt. Confirm permission is granted, local track is `live / enabled`, and peer and ICE states become connected.
5. Speak one at a time and confirm the other rider hears clear audio through the expected headset. Check that the remote audio element is not blocked and that inbound/outbound audio byte counters increase on both devices.
6. Tap mute and unmute on each phone in turn. Confirm the local status changes and the other rider hears silence and then speech again.
7. Test with each iPhone on a different cellular network. Record whether the selected candidate pair says `direct` or `relay`; a direct connection on the same Wi-Fi does not establish mobile-network reliability.
8. While still stopped, move Safari to the background and separately lock each screen. Record when audio stops, whether it resumes, and whether returning to Safari restores the connection. iOS may suspend browser capture or playback.
9. Have one rider leave. Confirm the remaining Safari tab shows the other participant gone and its peer connection closes. Rejoin only if continuing the test.

Record the date, iOS/Safari versions, headset models, network operators, candidate route, status transitions, and observed audio behavior. Physical-device testing has **not been performed as part of this verification**; fill in results only after the checklist is run on real devices.
