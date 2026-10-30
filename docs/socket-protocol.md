# RideLink Socket.IO Protocol

Protocol version: **1** (`protocolVersion: 1`). The wire format is JSON. The signaling service is independent from Next.js; a Flutter client can connect to the same Socket.IO endpoint and use the same event names and payloads.

## Connection and authentication

- Connect to `SIGNALING_URL` over HTTPS/WSS in production. Local development uses `http://localhost:4000`.
- The Socket.IO handshake does not use Next.js cookies. Connect first, then authenticate a participant with `room:create`, `room:join`, or `room:resume`.
- The server returns a 256-bit bearer token only in the create/join acknowledgment. Store it in platform-secure storage (Flutter: Keychain/Keystore-backed storage); never include it in a URL, logs, analytics, or shared invite text.
- The server stores only a SHA-256 fingerprint of that token. A valid token can resume and take over its participant session; the previous socket is disconnected and loses authorization. Send it only over TLS/WSS.
- A client that receives the Socket.IO server disconnect caused by a takeover should stop automatic resume attempts for that tab/device session. Reconnecting the old socket with the same bearer token would take the session back.
- `roomCode` is an invitation identifier, not a session credential. Knowing it does not authorize `room:get-state` or `room:leave`.
- Room state is in memory and disappears on process restart. This MVP does not support horizontal scaling. Replace `MemoryRoomRepository` with a shared repository (for example Redis) before running multiple signaling instances.

## Request and acknowledgment format

All client-to-server commands include `protocolVersion`. Use Socket.IO acknowledgments for commands:

```json
{
  "ok": true,
  "protocolVersion": 1,
  "data": {}
}
```

Errors have one stable shape:

```json
{
  "ok": false,
  "protocolVersion": 1,
  "error": {
    "code": "ROOM_FULL",
    "message": "Room sudah penuh."
  }
}
```

`retryAfterMs` may also be present for `RATE_LIMITED`. Messages are user-facing and contain no internal exception detail. Push events from the server include `protocolVersion: 1` in their JSON payload. Inputs are strict schemas; extra properties are rejected. The Socket.IO maximum payload size is 16 KiB.

## Client → Server commands

### `room:create`

Creates a private room and its first participant. Limited by client network address.

```json
{ "protocolVersion": 1, "nickname": "Rider Satu" }
```

Nickname is normalized with Unicode NFKC, trimmed, and must contain 2–24 Unicode letters/numbers plus spaces, `.`, `_`, or `-` (first character must be a letter or number).

Success `data`:

```json
{
  "room": {
    "roomCode": "ABCD2-EFGH3",
    "createdAt": 1793250000000,
    "expiresAt": 1793278800000,
    "capacity": 2,
    "participants": [
      {
        "participantId": "8c4c1a36-8d5b-4a8e-b8ea-6c43111f3204",
        "nickname": "Rider Satu",
        "connectionStatus": "online",
        "joinedAt": 1793250000000,
        "lastSeenAt": 1793250000000
      }
    ]
  },
  "participant": { "participantId": "8c4c1a36-8d5b-4a8e-b8ea-6c43111f3204", "nickname": "Rider Satu", "connectionStatus": "online", "joinedAt": 1793250000000, "lastSeenAt": 1793250000000 },
  "session": { "token": "<43-character-base64url-token>", "expiresAt": 1793278800000 }
}
```

The room code contains 50 random bits from a cryptographic random source. `room:create` returns `RATE_LIMITED`, `INVALID_NICKNAME`, `SESSION_ACTIVE`, `PROTOCOL_VERSION_UNSUPPORTED`, or `INVALID_PAYLOAD` on failure.

### `room:join`

Adds a participant to an existing, unexpired room. A participant reconnecting within the grace period keeps their seat reserved.

```json
{ "protocolVersion": 1, "roomCode": "ABCD2-EFGH3", "nickname": "Rider Dua" }
```

Success `data` has the same `room`, `participant`, and `session` fields as `room:create`. Failure codes: `ROOM_NOT_FOUND`, `ROOM_EXPIRED`, `ROOM_FULL`, `INVALID_NICKNAME`, `RATE_LIMITED`, `SESSION_ACTIVE`, `PROTOCOL_VERSION_UNSUPPORTED`, and `INVALID_PAYLOAD`.

### `room:resume`

Restores or transfers a participant session to this socket. This operation is serialized by Node's event loop; the last valid resume processed owns the session. The old socket is disconnected and can no longer issue authorized room commands. Resuming does not make another participant.

```json
{ "protocolVersion": 1, "roomCode": "ABCD2-EFGH3", "token": "<stored-bearer-token>" }
```

Success `data` contains `room` and `participant`; it does not issue a new token. Failure codes: `UNAUTHORIZED`, `ROOM_NOT_FOUND`, `ROOM_EXPIRED`, `SESSION_ACTIVE`, `PROTOCOL_VERSION_UNSUPPORTED`, and `INVALID_PAYLOAD`.

### `room:get-state`

Returns the current room snapshot for the authenticated socket. The client cannot supply a participant ID or choose another participant's role.

```json
{ "protocolVersion": 1 }
```

Success: `{ "room": { ...roomState } }`. Failure: `UNAUTHORIZED`, `ROOM_EXPIRED`, `PROTOCOL_VERSION_UNSUPPORTED`, or `INVALID_PAYLOAD`.

### `room:leave`

Revokes this participant's token and removes them from the room. When the last participant leaves, the room closes and is deleted.

```json
{ "protocolVersion": 1 }
```

Success: `{ "roomCode": "ABCD2-EFGH3", "closed": false }` (or `closed: true` when empty). Failure: `UNAUTHORIZED`, `ROOM_EXPIRED`, `PROTOCOL_VERSION_UNSUPPORTED`, or `INVALID_PAYLOAD`.

## Server → Client push events

Every push payload includes `protocolVersion: 1`.

| Event | Payload | Meaning |
| --- | --- | --- |
| `room:state` | Room state object | Authoritative snapshot after a membership or connection change. |
| `room:participant-joined` | Participant object | A rider joined. A following `room:state` is authoritative. |
| `room:participant-disconnected` | Participant object with `connectionStatus: "reconnecting"` | Socket disconnected; seat remains reserved during grace. |
| `room:participant-reconnected` | Participant object with `connectionStatus: "online"` | Valid token resumed before expiry. |
| `room:participant-left` | Participant object plus `reason: "left"`, `"reconnect_timeout"`, or `"session_expired"` | Participant was removed; timeout/expiry payload uses `connectionStatus: "disconnected"`. |
| `room:closed` | `{ "roomCode": "...", "reason": "empty" or "expired", "closedAt": 1793278800000 }` | Room no longer exists; clear local session. |
| `room:error` | `{ "code": "...", "message": "...", "retryAfterMs"?: 1000 }` | Error notification in addition to a command acknowledgment when applicable. |

Participants expose only `participantId`, `nickname`, `connectionStatus`, `joinedAt`, and `lastSeenAt`. No token, socket ID, network address, or private credential is broadcast.

For voice intercom, participant snapshots also include `microphoneEnabled` (boolean). Older clients may ignore this optional field.

Room snapshots also include `musicState` when the room was created by a Stage 4 server. Treat it as a versioned snapshot and ignore it if its `revision` is older than the current music state.

## WebRTC voice signaling

WebRTC commands require the same authenticated socket created by `room:create`/`room:join` or resumed by `room:resume`. They do not accept a room ID, sender ID, receiver ID, role, bearer token, or TURN secret in the payload. The server reads the current participant from socket authorization, verifies that socket is still a member of the room, and derives the other participant as the sole receiver. A peer must be online on a socket joined to the same room. Offers, answers, and ICE candidates are JSON only; microphone media never goes through Socket.IO.

Every request includes `protocolVersion: 1` and uses an acknowledgment. A successful relay returns `{ "ok": true, "protocolVersion": 1, "data": { "delivered": true } }`. The receiving peer gets the same event name with the server-derived `participantId` added to its payload. This ID is informational; the receiver should still match it to the other participant in current room state.

All descriptions and candidates have strict Zod schemas. SDP is limited to 12 KiB, candidate text to 4 KiB, and the Socket.IO packet limit remains 16 KiB. The server rate limits WebRTC signaling per socket. Extra fields, including client-supplied room/participant routing fields, are rejected.

### `webrtc:get-ice-config`

Authenticated client request:

```json
{ "protocolVersion": 1, "iceTransportPolicy": "all" }
```

`iceTransportPolicy` is optional and may be `all` or `relay`. Success returns `iceServers`, the selected policy, `turnAvailable`, `credentialsExpireAt`, and a non-sensitive `notice`. STUN URLs are public connection helpers. If TURN is configured, the server issues a coturn REST username of the form `<unix-expiry>:<participantId>` and a short-lived HMAC-SHA1 password; the shared secret never leaves the signaling server. Credential lifetime is capped by the session expiry. Requesting `relay` without TURN returns `TURN_NOT_CONFIGURED`.

The default STUN URL is for development. Public STUN availability is not guaranteed. Production should use an operated TURN provider or coturn with TLS/TCP and UDP endpoints as appropriate, and set `STUN_URLS`, `TURN_URLS`, `TURN_SHARED_SECRET`, and `TURN_CREDENTIAL_TTL_SECONDS` in the signaling server environment. Do not use a permanent TURN username/password in frontend variables. The relay-only checkbox in Connection Diagnostics requests this policy for a new peer connection; it is a diagnostic mode, not a promise of relay availability.

### `webrtc:offer`

```json
{
  "protocolVersion": 1,
  "negotiationId": "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
  "messageId": "b3cbb1fa-659e-4b3c-9ef0-7771d86a0be3",
  "description": { "type": "offer", "sdp": "v=0\\r\\n..." }
}
```

The server relays it only to the other online participant. The receiver's event payload adds `participantId` for the authenticated sender.

### `webrtc:answer`

```json
{
  "protocolVersion": 1,
  "negotiationId": "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
  "messageId": "da5a287c-62d9-49e5-a83a-01ab6017175d",
  "description": { "type": "answer", "sdp": "v=0\\r\\n..." }
}
```

The negotiation ID must match the associated offer. A stale answer is ignored by the client.

### `webrtc:ice-candidate`

```json
{
  "protocolVersion": 1,
  "negotiationId": "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
  "messageId": "e168e51d-77d0-4d05-a441-0cc73649eac5",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0,
    "usernameFragment": "optional"
  }
}
```

Candidates are associated with a negotiation. The client queues candidates received before its remote description, ignores duplicates, and discards candidates from ignored or retired negotiations.

### `webrtc:restart-request`

```json
{
  "protocolVersion": 1,
  "negotiationId": "29f57a67-64a6-4cf4-93f6-e3c576a20355",
  "messageId": "3d13d63a-32f6-4b02-a95d-125e968f7474"
}
```

The peer is asked to call `restartIce()` and renegotiate. Both sides may make an offer; browser clients resolve glare using Perfect Negotiation.

### `webrtc:microphone-state`

```json
{ "protocolVersion": 1, "microphoneEnabled": true }
```

The server updates that participant's public room state and sends `webrtc:microphone-state` to the room with the server-derived `participantId` and boolean. This is presence metadata only; it is not microphone audio.

## Perfect Negotiation roles and recovery

Roles are deterministic for every participant pair: the participant whose UUID string sorts later is **polite**; the other is **impolite**. This is independent of who created the room and avoids random timers. Clients use the browser Perfect Negotiation pattern (`makingOffer`, `isSettingRemoteAnswerPending`, and `ignoreOffer`) for offer collisions. Each offer/answer/candidate set has a UUID `negotiationId`, and every packet has a `messageId` for duplicate suppression. Room/socket authentication remains the only signaling authorization.

On ICE `disconnected`, clients allow a short recovery window before requesting an ICE restart. Failed recovery uses bounded exponential retries, then rebuilds one peer connection; automatic attempts stop after that so a broken network cannot cause an unlimited restart loop. A manual Retry Connection starts a fresh bounded attempt. When a participant resumes its room session, the server emits `room:participant-reconnected`; clients restart ICE. The browser retains the local audio track when possible and replaces the sender track if a new microphone track is acquired.

On peer removal or room close, the client closes the peer connection and detaches the remote audio stream. On page exit it stops local microphone tracks. No recording or server-side audio storage is implemented. WebRTC uses standard DTLS-SRTP media encryption; signaling still requires WSS in production.

## Browser audio and microphone behavior

The web client requests `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })` only after the user's microphone button gesture. Those audio processing options are requests to the browser, not guarantees. Permission denial, missing devices, secure-context requirements, and track/device loss are shown in the UI. Microphone mute toggles the audio track's `enabled` flag.

There is one React-owned remote `<audio>` element. It is never assigned the local microphone stream. If Safari blocks autoplay, the rider gets an explicit Enable Audio gesture. The site does not select Bluetooth output devices or promise iOS background/locked-screen behavior. Manual Safari/iPhone, headset, and network-handoff testing is still required.

## Shared music protocol

Music uses synchronized local playback: each participant downloads and plays the same static catalogue file from the HTTPS web origin. Socket.IO carries only state and commands; the signaling server does not proxy, stream, or transcode audio. The server owns the catalogue and validates its `trackId`; clients cannot submit an arbitrary URL. Volume and mute are local-only and never appear in room state.

### Music state

`music:state` is a server push with `{ "protocolVersion": 1, "state": { ... } }`. A room snapshot also contains this state. Example:

```json
{
  "protocolVersion": 1,
  "state": {
    "trackId": "ridelink-original-loop",
    "isPlaying": true,
    "positionSeconds": 4.5,
    "updatedAt": 1793250004500,
    "revision": 7,
    "playlist": [
      {
        "trackId": "ridelink-original-loop",
        "title": "Open Road Loop",
        "artist": "RideLink Original Demo",
        "durationSeconds": 18,
        "sourceUrl": "/audio/ridelink-demo-loop.wav",
        "license": "Original procedurally synthesized RideLink demo audio"
      }
    ],
    "currentTrackIndex": 0
  }
}
```

`updatedAt` is server epoch time in milliseconds. The supplied `positionSeconds` is anchored to that timestamp; while playing, estimate current position as `positionSeconds + max(0, serverNow - updatedAt) / 1000`, clamped to track duration. While paused, position does not advance. Snapshots normalize position and timestamp to their server creation time. Revisions increase on each accepted playback command; ignore any push or response with a revision below the latest applied revision.

### `music:get-state`

Authenticated request and ack; also sends a `music:state` push to that socket for the common client subscription path:

```json
{ "protocolVersion": 1 }
```

Success data: `{ "state": { ...musicState } }`. Use this on room entry and after reconnect. Failure codes include `UNAUTHORIZED`, `MUSIC_RATE_LIMITED`, `PROTOCOL_VERSION_UNSUPPORTED`, and `INVALID_PAYLOAD`.

### Playback commands

All playback commands require the client's latest `expectedRevision`. Stale commands fail with `MUSIC_CONFLICT`; the server emits the authoritative `music:state` so both clients can reconcile. Commands are serialized by the Node signaling process. Per-socket music rate limit is 60 commands per 10 seconds, including `music:get-state`.

| Client event | Strict JSON payload | Result |
| --- | --- | --- |
| `music:play` | `{ "protocolVersion": 1, "expectedRevision": 7 }` | Starts the current track from its server-derived position; a finished track restarts at zero. |
| `music:pause` | `{ "protocolVersion": 1, "expectedRevision": 7 }` | Freezes position using server time. |
| `music:seek` | `{ "protocolVersion": 1, "expectedRevision": 7, "positionSeconds": 8.25 }` | Sets position between zero and current track duration. |
| `music:next` | `{ "protocolVersion": 1, "expectedRevision": 7 }` | Advances to the next server playlist item; playback continues if it was playing. |
| `music:previous` | `{ "protocolVersion": 1, "expectedRevision": 7 }` | Moves to the previous playlist item (wraps at either end). |
| `music:select` | `{ "protocolVersion": 1, "expectedRevision": 7, "trackId": "ridelink-coastal-loop" }` | Selects a track only if its ID is in the server catalogue. This event supports playlist selection. |

Every success ack has `{ "ok": true, "protocolVersion": 1, "data": { "state": { ...musicState } } }`; accepted changes are broadcast as `music:state` to both participants. Commands contain no audio data or source URL. The server rejects extra fields.

### `music:error`

Music errors are pushed only to the requesting socket and are also returned in the command ack:

```json
{ "protocolVersion": 1, "code": "MUSIC_CONFLICT", "message": "Kontrol musik berubah di perangkat lain. Status terbaru sedang disinkronkan." }
```

`retryAfterMs` may be included on `MUSIC_RATE_LIMITED`. Stable music error codes are `MUSIC_CONFLICT`, `MUSIC_TRACK_NOT_FOUND`, `MUSIC_POSITION_INVALID`, `MUSIC_RATE_LIMITED`, `UNAUTHORIZED`, `INVALID_PAYLOAD`, and `INTERNAL_ERROR`.

### Playback and Flutter client behavior

Use one local media element/player per room page, separate from the WebRTC remote audio element. After receiving state, resolve catalogue `sourceUrl` against the configured HTTPS web origin, load the track, and play/pause based on server state. Since browser autoplay can reject remote starts, show a user gesture to resume local playback; this does not change shared state. On `waiting`/buffering, expose that status. Periodically compare local `currentTime` to the server-derived expected position and seek only when drift is material (web MVP threshold: 0.75 seconds with a 2.5-second correction cooldown). A new server revision resets that cooldown. This is best-effort playback sync, not sample-accurate timing.

On `ended`, issue one `music:next` with the latest revision; if both clients report ended, one wins and the stale command reconciles via `MUSIC_CONFLICT`. A reconnecting client first requests `music:get-state`. Dispose its local player when leaving the room or on `room:closed`.

Flutter clients use the same event payloads and server catalogue. Resolve the server-provided relative `sourceUrl` against the configured RideLink web origin; never accept a URL from user input. Keep volume and mute in local preferences only. The current catalogue contains two original procedurally synthesized RideLink demo loops, served from the web app. Add user-owned/licensed files under its static `/audio/` path and add their metadata to the signaling server catalogue; do not accept arbitrary client-provided URLs or use Spotify/YouTube/Jockie audio without official rights and integration.

## Flutter implementation notes

Flutter clients use the same command event names, versioned JSON payloads, acknowledgments, and server-derived peer route. Store the room token in Keychain/Keystore-backed storage. Determine the polite role by comparing the two participant UUID strings lexicographically. Use a Flutter WebRTC package for the peer connection, pass the authenticated `webrtc:get-ice-config` response to its ICE configuration, and implement the same negotiation ID/candidate queue and retry rules. Never send audio frames over Socket.IO. Socket.IO messages carry only SDP, candidates, and microphone state metadata.

## Error codes

| Code | Meaning |
| --- | --- |
| `ROOM_NOT_FOUND` | No live room matches this code. |
| `ROOM_FULL` | Both room seats are occupied, including a seat reserved during reconnect grace. |
| `ROOM_EXPIRED` | The room TTL elapsed. Expired-code status is retained briefly for a useful response. |
| `INVALID_NICKNAME` | Nickname is outside the documented format. |
| `RATE_LIMITED` | Create/join attempt limit reached; retry delay may be provided. |
| `UNAUTHORIZED` | Token is missing, invalid, expired, revoked, or no longer owns this socket. |
| `SESSION_ACTIVE` | This socket already has a room session; use its current session or leave first. |
| `INVALID_PAYLOAD` | Payload shape or field validation failed. |
| `PROTOCOL_VERSION_UNSUPPORTED` | Client protocol version is unsupported. |
| `INVALID_EVENT` | Unknown client event under the `room:` namespace. |
| `INTERNAL_ERROR` | Generic server error; no internal details are returned. |
| `PEER_NOT_AVAILABLE` | The other room participant has not joined or is not connected to signaling. |
| `SIGNALING_RATE_LIMITED` | WebRTC signaling event limit reached; retry after `retryAfterMs`. |
| `TURN_NOT_CONFIGURED` | Relay-only ICE was requested without configured TURN. |
| `MUSIC_CONFLICT` | Another control changed the playback revision first; apply the latest `music:state` and retry if needed. |
| `MUSIC_TRACK_NOT_FOUND` | Track ID is not present in the server-owned playlist. |
| `MUSIC_POSITION_INVALID` | Seek position is outside the selected track duration. |
| `MUSIC_RATE_LIMITED` | Music command limit reached; retry after `retryAfterMs`. |

## Flutter example

Use the Socket.IO client for Dart, connect to the configured signaling URL, and use the same JSON contract. Keep the returned token in platform secure storage.

```dart
socket.emitWithAck('room:join', {
  'protocolVersion': 1,
  'roomCode': roomCode,
  'nickname': nickname,
}, ack: (response) {
  if (response['ok'] == true) {
    secureStorage.write(key: 'ridelink-room-token', value: response['data']['session']['token']);
    // Navigate with roomCode; never put the token in the route.
  } else {
    final code = response['error']['code'];
    // Map stable error codes to native UI.
  }
});

socket.on('room:state', (payload) {
  if (payload['protocolVersion'] != 1) return;
  // Replace the local participant list with the authoritative snapshot.
});
```

Before deployment, set an explicit `SIGNALING_CORS_ORIGIN` allowlist for web origins. Native Flutter clients may not send an `Origin` header; when present, it is still checked. For deployments behind a reverse proxy, ensure client IP forwarding and rate limiting are configured at the trusted edge; this MVP deliberately does not trust arbitrary `X-Forwarded-For` headers.
