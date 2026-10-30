import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, test } from "node:test";
import { io as createClient } from "socket.io-client";
import { createSignalingServer, loadConfig } from "../server.js";

const active = new Set();

function testConfig(overrides = {}) {
  return {
    ...loadConfig({ SIGNALING_PORT: "4000", SIGNALING_CORS_ORIGIN: "http://localhost:3000" }),
    roomTtlMs: 60_000,
    reconnectGraceMs: 100,
    sessionTokenTtlMs: 60_000,
    rateLimits: {
      create: { limit: 8, windowMs: 60_000 },
      join: { limit: 20, windowMs: 60_000 },
      music: { limit: 60, windowMs: 10_000 },
    },
    ...overrides,
  };
}

test("Railway PORT overrides SIGNALING_PORT while local development keeps its fallback", () => {
  const base = { SIGNALING_CORS_ORIGIN: "https://ridelink.example" };
  assert.equal(loadConfig({ ...base, PORT: "8123", SIGNALING_PORT: "4000" }).port, 8123);
  assert.equal(loadConfig({ ...base, SIGNALING_PORT: "4001" }).port, 4001);
  assert.equal(loadConfig(base).port, 4000);
});

async function openServer(overrides) {
  const server = createSignalingServer({ config: testConfig(overrides) });
  const address = await server.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${address.port}`;
  active.add(server);
  return { server, url };
}

async function connect(url, options = {}) {
  const socket = createClient(url, { autoConnect: false, reconnection: false, transports: ["websocket"], ...options });
  active.add(socket);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("socket connection timed out")), 1500);
    socket.once("connect", () => { clearTimeout(timeout); resolve(); });
    socket.once("connect_error", (error) => { clearTimeout(timeout); reject(error); });
    socket.connect();
  });
  return socket;
}

function request(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function ok(response) {
  assert.equal(response?.ok, true, JSON.stringify(response));
  return response.data;
}

function fail(response, code) {
  assert.equal(response?.ok, false, JSON.stringify(response));
  assert.equal(response.error.code, code);
}

function waitFor(socket, event, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = (payload) => { clearTimeout(timeout); resolve(payload); };
    socket.once(event, listener);
  });
}

async function createRoom(url, nickname = "Rider Satu") {
  const socket = await connect(url);
  const data = ok(await request(socket, "room:create", { protocolVersion: 1, nickname }));
  return { socket, ...data };
}

afterEach(async () => {
  for (const item of active) if (typeof item.disconnect === "function") item.disconnect();
  for (const item of active) if (item.httpServer && typeof item.close === "function") await item.close();
  active.clear();
});

test("room:create returns a cryptographic room code and temporary bearer token", async () => {
  const { url, server } = await openServer();
  const created = await createRoom(url);
  assert.match(created.room.roomCode, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(created.room.participants.length, 1);
  assert.equal(created.room.participants[0].nickname, "Rider Satu");
  assert.match(created.session.token, /^[A-Za-z0-9_-]{43}$/);
  const stored = [...server.roomService.repository.values()][0].participants.values().next().value;
  assert.equal(stored.token, undefined);
  assert.notEqual(stored.tokenHash, created.session.token);
});

test("two clients join the same room and receive consistent participant state", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const secondSocket = await connect(url);
  const joinedEvent = waitFor(first.socket, "room:participant-joined");
  const second = ok(await request(secondSocket, "room:join", {
    protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua",
  }));
  assert.equal(second.room.participants.length, 2);
  assert.equal((await joinedEvent).participantId, second.participant.participantId);
  const state = await request(first.socket, "room:get-state", { protocolVersion: 1 });
  assert.deepEqual(ok(state).room.participants.map((participant) => participant.nickname), ["Rider Satu", "Rider Dua"]);
});

test("a third participant is rejected with ROOM_FULL", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const second = await connect(url);
  ok(await request(second, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const third = await connect(url);
  fail(await request(third, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Tiga" }), "ROOM_FULL");
});

test("joining an unknown room returns ROOM_NOT_FOUND", async () => {
  const { url } = await openServer();
  const socket = await connect(url);
  fail(await request(socket, "room:join", { protocolVersion: 1, roomCode: "ABCDEFGHJK", nickname: "Rider Dua" }), "ROOM_NOT_FOUND");
});

test("invalid nickname is rejected", async () => {
  const { url } = await openServer();
  const socket = await connect(url);
  fail(await request(socket, "room:create", { protocolVersion: 1, nickname: "R!" }), "INVALID_NICKNAME");
});

test("expired rooms cannot be joined", async () => {
  const { url, server } = await openServer({ roomTtlMs: 30 });
  const created = await createRoom(url);
  await new Promise((resolve) => setTimeout(resolve, 45));
  server.roomService.cleanupExpired();
  const joiner = await connect(url);
  fail(await request(joiner, "room:join", { protocolVersion: 1, roomCode: created.room.roomCode, nickname: "Rider Dua" }), "ROOM_EXPIRED");
});

test("leaving removes a participant, and leaving the last participant closes the room", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const secondSocket = await connect(url);
  const second = ok(await request(secondSocket, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const leftEvent = waitFor(first.socket, "room:participant-left");
  ok(await request(secondSocket, "room:leave", { protocolVersion: 1 }));
  assert.equal((await leftEvent).participantId, second.participant.participantId);
  assert.equal(ok(await request(first.socket, "room:get-state", { protocolVersion: 1 })).room.participants.length, 1);

  const closedEvent = waitFor(first.socket, "room:closed");
  ok(await request(first.socket, "room:leave", { protocolVersion: 1 }));
  assert.equal((await closedEvent).reason, "empty");
  fail(await request(secondSocket, "room:resume", { protocolVersion: 1, roomCode: first.room.roomCode, token: second.session.token }), "ROOM_NOT_FOUND");
});

test("disconnect is visible and reconnect restores the same participant", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const secondSocket = await connect(url);
  const second = ok(await request(secondSocket, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const disconnected = waitFor(first.socket, "room:participant-disconnected");
  secondSocket.disconnect();
  assert.equal((await disconnected).connectionStatus, "reconnecting");

  const reconnectedSocket = await connect(url);
  const reconnected = ok(await request(reconnectedSocket, "room:resume", {
    protocolVersion: 1, roomCode: first.room.roomCode, token: second.session.token,
  }));
  assert.equal(reconnected.participant.participantId, second.participant.participantId);
  assert.equal(reconnected.room.participants.length, 2);
  assert.equal(reconnected.room.participants.find((item) => item.participantId === second.participant.participantId).connectionStatus, "online");
});

test("invalid and expired session tokens cannot resume", async () => {
  const { url } = await openServer({ sessionTokenTtlMs: 35 });
  const created = await createRoom(url);
  const invalid = await connect(url);
  fail(await request(invalid, "room:resume", { protocolVersion: 1, roomCode: created.room.roomCode, token: "x".repeat(43) }), "UNAUTHORIZED");
  await new Promise((resolve) => setTimeout(resolve, 45));
  const expired = await connect(url);
  fail(await request(expired, "room:resume", { protocolVersion: 1, roomCode: created.room.roomCode, token: created.session.token }), "UNAUTHORIZED");
});

test("an online session is removed when its token expires", async () => {
  const { url, server } = await openServer({ sessionTokenTtlMs: 30 });
  const created = await createRoom(url);
  const closed = waitFor(created.socket, "room:closed");
  await new Promise((resolve) => setTimeout(resolve, 45));
  server.roomService.cleanupExpired();
  assert.equal((await closed).reason, "empty");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(created.socket.connected, false);
});

test("simultaneous resumes serialize to one current socket without duplicating participants", async () => {
  const { url } = await openServer();
  const created = await createRoom(url);
  const sockets = await Promise.all([connect(url), connect(url)]);
  const results = await Promise.all(sockets.map((socket) => request(socket, "room:resume", {
    protocolVersion: 1, roomCode: created.room.roomCode, token: created.session.token,
  })));
  assert.ok(results.some((result) => result.ok));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const currentSockets = sockets.filter((socket) => socket.connected);
  assert.equal(currentSockets.length, 1);
  assert.equal(ok(await request(currentSockets[0], "room:get-state", { protocolVersion: 1 })).room.participants.length, 1);
});

test("a disconnected participant is removed after grace and an empty room is closed", async () => {
  const { url } = await openServer({ reconnectGraceMs: 15 });
  const created = await createRoom(url);
  created.socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 35));
  const probe = await connect(url);
  fail(await request(probe, "room:join", { protocolVersion: 1, roomCode: created.room.roomCode, nickname: "Rider Dua" }), "ROOM_NOT_FOUND");
});

test("unauthorized state and leave events are rejected", async () => {
  const { url } = await openServer();
  const socket = await connect(url);
  fail(await request(socket, "room:get-state", { protocolVersion: 1 }), "UNAUTHORIZED");
  fail(await request(socket, "room:leave", { protocolVersion: 1 }), "UNAUTHORIZED");
});

test("join attempts are rate limited per client address", async () => {
  const { url } = await openServer({ rateLimits: { create: { limit: 8, windowMs: 60_000 }, join: { limit: 1, windowMs: 60_000 } } });
  const socket = await connect(url);
  fail(await request(socket, "room:join", { protocolVersion: 1, roomCode: "ABCDEFGHJK", nickname: "Rider Dua" }), "ROOM_NOT_FOUND");
  const limited = await request(socket, "room:join", { protocolVersion: 1, roomCode: "ABCDEFGHJK", nickname: "Rider Dua" });
  fail(limited, "RATE_LIMITED");
  assert.ok(limited.error.retryAfterMs > 0);
});

test("room creation attempts are rate limited per client address", async () => {
  const { url } = await openServer({ rateLimits: { create: { limit: 1, windowMs: 60_000 }, join: { limit: 20, windowMs: 60_000 } } });
  const first = await connect(url);
  ok(await request(first, "room:create", { protocolVersion: 1, nickname: "Rider Satu" }));
  const second = await connect(url);
  fail(await request(second, "room:create", { protocolVersion: 1, nickname: "Rider Dua" }), "RATE_LIMITED");
});

test("concurrent joins cannot exceed room capacity", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const contenders = await Promise.all([connect(url), connect(url)]);
  const outcomes = await Promise.all(contenders.map((socket, index) => request(socket, "room:join", {
    protocolVersion: 1, roomCode: first.room.roomCode, nickname: `Rider ${index + 2}`,
  })));
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 1);
  assert.equal(outcomes.filter((outcome) => !outcome.ok && outcome.error.code === "ROOM_FULL").length, 1);
  assert.equal(ok(await request(first.socket, "room:get-state", { protocolVersion: 1 })).room.participants.length, 2);
});

test("leaving revokes the old session token", async () => {
  const { url } = await openServer();
  const created = await createRoom(url);
  const otherSocket = await connect(url);
  ok(await request(otherSocket, "room:join", { protocolVersion: 1, roomCode: created.room.roomCode, nickname: "Rider Dua" }));
  ok(await request(created.socket, "room:leave", { protocolVersion: 1 }));
  const replacementSocket = await connect(url);
  fail(await request(replacementSocket, "room:resume", {
    protocolVersion: 1, roomCode: created.room.roomCode, token: created.session.token,
  }), "UNAUTHORIZED");
});

test("unsupported protocol versions and unknown room events are rejected", async () => {
  const { url } = await openServer();
  const socket = await connect(url);
  const versionError = waitFor(socket, "room:error");
  fail(await request(socket, "room:create", { protocolVersion: 99, nickname: "Rider" }), "PROTOCOL_VERSION_UNSUPPORTED");
  assert.equal((await versionError).code, "PROTOCOL_VERSION_UNSUPPORTED");
  const invalidEvent = waitFor(socket, "room:error");
  socket.emit("room:admin", { protocolVersion: 1, participantId: "fake" });
  assert.equal((await invalidEvent).code, "INVALID_EVENT");
});

test("health endpoint reports signaling readiness and protocol version", async () => {
  const { url } = await openServer();
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: "ridelink-signaling", status: "ok", protocolVersion: 1 });
});

test("websocket connections with an origin outside the allowlist are rejected", async () => {
  const { url } = await openServer();
  await assert.rejects(connect(url, { extraHeaders: { Origin: "https://untrusted.example" } }));
});

test("authenticated signaling relays offer only to the other room participant", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const secondSocket = await connect(url);
  const second = ok(await request(secondSocket, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const relayedOffer = waitFor(secondSocket, "webrtc:offer");
  const response = ok(await request(first.socket, "webrtc:offer", {
    protocolVersion: 1,
    negotiationId: "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
    messageId: "b3cbb1fa-659e-4b3c-9ef0-7771d86a0be3",
    description: { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n" },
  }));
  const signal = await relayedOffer;
  assert.equal(response.delivered, true);
  assert.equal(signal.participantId, first.participant.participantId);
  assert.equal(signal.negotiationId, "57b5f2d6-0b49-4df9-a8ea-428b2ee24226");
  assert.equal(signal.toParticipantId, undefined);
  assert.equal(signal.roomCode, undefined);
  assert.equal(second.participant.nickname, "Rider Dua");
});

test("unauthorized and forged signaling payloads are rejected", async () => {
  const { url } = await openServer();
  const socket = await connect(url);
  const baseOffer = {
    protocolVersion: 1,
    negotiationId: "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
    messageId: "b3cbb1fa-659e-4b3c-9ef0-7771d86a0be3",
    description: { type: "offer", sdp: "v=0\r\n" },
  };
  fail(await request(socket, "webrtc:offer", baseOffer), "UNAUTHORIZED");
  fail(await request(socket, "webrtc:offer", { ...baseOffer, participantId: "forged" }), "INVALID_PAYLOAD");
});

test("signaling waits for a second participant and enforces strict descriptions", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const noPeer = await request(first.socket, "webrtc:offer", {
    protocolVersion: 1,
    negotiationId: "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
    messageId: "b3cbb1fa-659e-4b3c-9ef0-7771d86a0be3",
    description: { type: "offer", sdp: "v=0\r\n" },
  });
  fail(noPeer, "PEER_NOT_AVAILABLE");
  const malformed = await request(first.socket, "webrtc:offer", {
    protocolVersion: 1,
    negotiationId: "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
    messageId: "b3cbb1fa-659e-4b3c-9ef0-7771d86a0be3",
    description: { type: "answer", sdp: "v=0\r\n" },
  });
  fail(malformed, "INVALID_PAYLOAD");
});

test("microphone state is server-owned and broadcast to the room", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const second = await connect(url);
  ok(await request(second, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const microphoneEvent = waitFor(second, "webrtc:microphone-state");
  const stateEvent = waitFor(second, "room:state");
  ok(await request(first.socket, "webrtc:microphone-state", { protocolVersion: 1, microphoneEnabled: true }));
  assert.deepEqual(await microphoneEvent, { protocolVersion: 1, participantId: first.participant.participantId, microphoneEnabled: true });
  assert.equal((await stateEvent).participants.find((participant) => participant.participantId === first.participant.participantId).microphoneEnabled, true);
});

test("ICE config is authenticated, reports missing TURN, and rejects relay-only without it", async () => {
  const { url } = await openServer();
  const created = await createRoom(url);
  const config = ok(await request(created.socket, "webrtc:get-ice-config", { protocolVersion: 1, iceTransportPolicy: "all" }));
  assert.equal(config.turnAvailable, false);
  assert.equal(config.iceTransportPolicy, "all");
  assert.ok(config.iceServers.some((server) => server.urls.some((iceUrl) => iceUrl.startsWith("stun:"))));
  assert.match(config.notice, /TURN belum dikonfigurasi/);
  fail(await request(created.socket, "webrtc:get-ice-config", { protocolVersion: 1, iceTransportPolicy: "relay" }), "TURN_NOT_CONFIGURED");
  const unauthorized = await connect(url);
  fail(await request(unauthorized, "webrtc:get-ice-config", { protocolVersion: 1 }), "UNAUTHORIZED");
});

test("TURN credentials are temporary coturn REST credentials and stay server generated", async () => {
  const secret = "server-only-test-secret-that-is-long-enough";
  const { url } = await openServer({
    stunUrls: ["stun:stun.example.test:3478"],
    turnUrls: ["turn:relay.example.test:3478?transport=udp"],
    turnSharedSecret: secret,
    turnCredentialTtlSeconds: 120,
  });
  const created = await createRoom(url);
  const config = ok(await request(created.socket, "webrtc:get-ice-config", { protocolVersion: 1 }));
  const turnServer = config.iceServers.find((server) => server.urls.some((iceUrl) => iceUrl.startsWith("turn:")));
  assert.ok(turnServer);
  const expectedCredential = createHmac("sha1", secret).update(turnServer.username).digest("base64");
  assert.equal(turnServer.credential, expectedCredential);
  assert.match(turnServer.username, /^\d+:/);
  assert.ok(config.credentialsExpireAt <= created.session.expiresAt);
  assert.ok(config.credentialsExpireAt > Date.now());
});

test("WebRTC signaling has its own per-socket rate limit", async () => {
  const { url } = await openServer({ rateLimits: {
    create: { limit: 8, windowMs: 60_000 },
    join: { limit: 20, windowMs: 60_000 },
    webrtc: { limit: 1, windowMs: 60_000 },
    iceConfig: { limit: 20, windowMs: 60_000 },
  } });
  const created = await createRoom(url);
  const payload = {
    protocolVersion: 1,
    negotiationId: "57b5f2d6-0b49-4df9-a8ea-428b2ee24226",
    messageId: "b3cbb1fa-659e-4b3c-9ef0-7771d86a0be3",
    description: { type: "offer", sdp: "v=0\r\n" },
  };
  fail(await request(created.socket, "webrtc:offer", payload), "PEER_NOT_AVAILABLE");
  fail(await request(created.socket, "webrtc:offer", { ...payload, messageId: "b8c40804-11c9-48a3-83b1-32a916c62b1d" }), "SIGNALING_RATE_LIMITED");
});

test("music starts paused with the server-owned licensed demo catalog", async () => {
  const { url } = await openServer();
  const created = await createRoom(url);
  const state = created.room.musicState;
  assert.equal(state.isPlaying, false);
  assert.equal(state.positionSeconds, 0);
  assert.equal(state.revision, 1);
  assert.equal(state.trackId, state.playlist[0].trackId);
  assert.equal(state.playlist[0].sourceUrl, "/audio/ridelink-demo-loop.wav");
});

test("play, pause, seek, next, and previous publish authoritative increasing revisions", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const secondSocket = await connect(url);
  ok(await request(secondSocket, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const initial = ok(await request(first.socket, "music:get-state", { protocolVersion: 1 })).state;
  assert.equal(initial.revision, 1);
  const playEvent = waitFor(secondSocket, "music:state");
  const played = ok(await request(first.socket, "music:play", { protocolVersion: 1, expectedRevision: initial.revision })).state;
  assert.equal(played.isPlaying, true);
  assert.equal(played.revision, 2);
  assert.equal((await playEvent).state.revision, 2);

  const paused = ok(await request(secondSocket, "music:pause", { protocolVersion: 1, expectedRevision: played.revision })).state;
  assert.equal(paused.isPlaying, false);
  const seeked = ok(await request(first.socket, "music:seek", { protocolVersion: 1, expectedRevision: paused.revision, positionSeconds: 5.5 })).state;
  assert.equal(seeked.positionSeconds, 5.5);
  const next = ok(await request(first.socket, "music:next", { protocolVersion: 1, expectedRevision: seeked.revision })).state;
  assert.equal(next.currentTrackIndex, 1);
  assert.notEqual(next.trackId, seeked.trackId);
  assert.equal(next.revision, seeked.revision + 1);
  const previous = ok(await request(secondSocket, "music:previous", { protocolVersion: 1, expectedRevision: next.revision })).state;
  assert.equal(previous.currentTrackIndex, 0);
  assert.equal(previous.trackId, seeked.trackId);
  assert.equal(previous.revision, next.revision + 1);
  const selected = ok(await request(first.socket, "music:select", { protocolVersion: 1, expectedRevision: previous.revision, trackId: "ridelink-coastal-loop" })).state;
  assert.equal(selected.currentTrackIndex, 1);
});

test("stale concurrent music commands lose by expected revision and receive current state", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const secondSocket = await connect(url);
  ok(await request(secondSocket, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const initial = first.room.musicState;
  const [played, paused] = await Promise.all([
    request(first.socket, "music:play", { protocolVersion: 1, expectedRevision: initial.revision }),
    request(secondSocket, "music:pause", { protocolVersion: 1, expectedRevision: initial.revision }),
  ]);
  assert.equal([played, paused].filter((response) => response.ok).length, 1);
  const conflict = [played, paused].find((response) => !response.ok);
  fail(conflict, "MUSIC_CONFLICT");
  assert.equal(ok(await request(first.socket, "music:get-state", { protocolVersion: 1 })).state.revision, 2);
});

test("music events require room authorization and reject invalid positions", async () => {
  const { url } = await openServer();
  const created = await createRoom(url);
  const stranger = await connect(url);
  fail(await request(stranger, "music:play", { protocolVersion: 1, expectedRevision: 1 }), "UNAUTHORIZED");
  fail(await request(created.socket, "music:seek", { protocolVersion: 1, expectedRevision: 1, positionSeconds: 20 }), "MUSIC_POSITION_INVALID");
  fail(await request(created.socket, "music:select", { protocolVersion: 1, expectedRevision: 1, trackId: "https-injected" }), "MUSIC_TRACK_NOT_FOUND");
  fail(await request(created.socket, "music:play", { protocolVersion: 1, expectedRevision: 1, trackId: "https://evil.example/audio.mp3" }), "INVALID_PAYLOAD");
});

test("music commands are rate limited", async () => {
  const { url } = await openServer({ rateLimits: {
    create: { limit: 8, windowMs: 60_000 },
    join: { limit: 20, windowMs: 60_000 },
    music: { limit: 1, windowMs: 60_000 },
  } });
  const created = await createRoom(url);
  ok(await request(created.socket, "music:play", { protocolVersion: 1, expectedRevision: 1 }));
  fail(await request(created.socket, "music:pause", { protocolVersion: 1, expectedRevision: 2 }), "MUSIC_RATE_LIMITED");
});

test("a resumed participant fetches the latest shared music state", async () => {
  const { url } = await openServer();
  const first = await createRoom(url);
  const secondSocket = await connect(url);
  const second = ok(await request(secondSocket, "room:join", { protocolVersion: 1, roomCode: first.room.roomCode, nickname: "Rider Dua" }));
  const played = ok(await request(first.socket, "music:play", { protocolVersion: 1, expectedRevision: 1 })).state;
  secondSocket.disconnect();
  const resumedSocket = await connect(url);
  ok(await request(resumedSocket, "room:resume", { protocolVersion: 1, roomCode: first.room.roomCode, token: second.session.token }));
  const current = ok(await request(resumedSocket, "music:get-state", { protocolVersion: 1 })).state;
  assert.equal(current.revision, played.revision);
  assert.equal(current.isPlaying, true);
});
