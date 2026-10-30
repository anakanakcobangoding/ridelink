import "dotenv/config";
import { createHash, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { FixedWindowRateLimiter } from "./src/rate-limiter.js";
import { RoomError, RoomService } from "./src/room-service.js";
import {
  ERROR_MESSAGES,
  MUSIC_CLIENT_EVENTS,
  PROTOCOL_VERSION,
  ROOM_CLIENT_EVENTS,
  WEBRTC_CLIENT_EVENTS,
  roomCommandSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomResumeSchema,
  webrtcAnswerSchema,
  webrtcIceCandidateSchema,
  webrtcIceConfigSchema,
  webrtcMicrophoneStateSchema,
  webrtcOfferSchema,
  webrtcRestartRequestSchema,
  musicGetStateSchema,
  musicNextSchema,
  musicPauseSchema,
  musicPlaySchema,
  musicPreviousSchema,
  musicSeekSchema,
  musicSelectSchema,
} from "./src/protocol.js";

function integerFromEnv(env, key, fallback, min, max) {
  const parsed = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${key} configuration`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const corsValue = env.SIGNALING_CORS_ORIGIN ?? env.WEB_ORIGIN ?? "http://localhost:3000";
  const corsOrigins = corsValue.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (corsOrigins.length === 0 || corsOrigins.includes("*")) throw new Error("SIGNALING_CORS_ORIGIN must be an explicit origin allowlist");

  const stunUrls = (env.STUN_URLS ?? "stun:stun.l.google.com:19302").split(",").map((url) => url.trim()).filter(Boolean);
  const turnUrls = (env.TURN_URLS ?? "").split(",").map((url) => url.trim()).filter(Boolean);
  const turnSharedSecret = env.TURN_SHARED_SECRET ?? "";
  if (turnSharedSecret && turnSharedSecret.length < 32) throw new Error("TURN_SHARED_SECRET must contain at least 32 characters");
  if ([...stunUrls, ...turnUrls].some((url) => !/^(stun|stuns|turn|turns):/i.test(url))) throw new Error("ICE URLs must use STUN or TURN schemes");

  return {
    // Railway injects PORT. Keep SIGNALING_PORT as the local-development fallback.
    port: integerFromEnv({ PORT: env.PORT ?? env.SIGNALING_PORT }, "PORT", 4000, 1, 65535),
    corsOrigins,
    roomTtlMs: integerFromEnv(env, "ROOM_TTL_SECONDS", 28_800, 60, 604_800) * 1000,
    reconnectGraceMs: integerFromEnv(env, "ROOM_RECONNECT_GRACE_SECONDS", 45, 5, 600) * 1000,
    maxParticipants: integerFromEnv(env, "ROOM_MAX_PARTICIPANTS", 2, 1, 2),
    sessionTokenTtlMs: integerFromEnv(env, "SESSION_TOKEN_TTL_SECONDS", 28_800, 60, 604_800) * 1000,
    stunUrls,
    turnUrls,
    turnSharedSecret,
    turnCredentialTtlSeconds: integerFromEnv(env, "TURN_CREDENTIAL_TTL_SECONDS", 600, 60, 86_400),
    payloadMaxBytes: 16 * 1024,
    rateLimits: {
      create: { limit: 8, windowMs: 15 * 60 * 1000 },
      join: { limit: 20, windowMs: 5 * 60 * 1000 },
      webrtc: { limit: 300, windowMs: 60 * 1000 },
      iceConfig: { limit: 20, windowMs: 60 * 1000 },
      music: { limit: 60, windowMs: 10 * 1000 },
    },
  };
}

function success(data) {
  return { ok: true, protocolVersion: PROTOCOL_VERSION, data };
}

function errorResponse(code, retryAfterMs) {
  const response = {
    ok: false,
    protocolVersion: PROTOCOL_VERSION,
    error: { code, message: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR },
  };
  if (retryAfterMs) response.error.retryAfterMs = retryAfterMs;
  return response;
}

function publicParticipant(participant) {
  return {
    participantId: participant.participantId,
    nickname: participant.nickname,
    connectionStatus: participant.connectionStatus,
    microphoneEnabled: participant.microphoneEnabled,
    joinedAt: participant.joinedAt,
    lastSeenAt: participant.lastSeenAt,
  };
}

function createTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function getClientIp(socket) {
  return socket.conn.remoteAddress || socket.handshake.address || "unknown";
}

export function createSignalingServer({ config = loadConfig(), repository, now = Date.now } = {}) {
  const httpServer = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({ service: "ridelink-signaling", status: "ok", protocolVersion: PROTOCOL_VERSION }));
      return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  const io = new Server(httpServer, {
    cors: { origin: config.corsOrigins, methods: ["GET", "POST"], credentials: false },
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      callback(null, !origin || config.corsOrigins.includes(origin));
    },
    maxHttpBufferSize: config.payloadMaxBytes,
    serveClient: false,
  });
  const roomService = new RoomService({
    repository,
    config,
    now,
    publish: (event, roomCode, payload) => io.to(roomCode).emit(event, { protocolVersion: PROTOCOL_VERSION, ...payload }),
    disconnectSocket: (socketId) => io.sockets.sockets.get(socketId)?.disconnect(true),
  });
  const limiter = new FixedWindowRateLimiter({ limits: config.rateLimits, now });
  const cleanupTimer = setInterval(() => {
    roomService.cleanupExpired();
    limiter.prune();
  }, 1000);
  cleanupTimer.unref?.();

  io.on("connection", (socket) => {
    socket.onAny((event) => {
      if ((event.startsWith("room:") && !ROOM_CLIENT_EVENTS.includes(event)) || (event.startsWith("webrtc:") && !WEBRTC_CLIENT_EVENTS.includes(event)) || (event.startsWith("music:") && !MUSIC_CLIENT_EVENTS.includes(event))) {
        socket.emit("room:error", errorResponse("INVALID_EVENT").error);
      }
    });

    socket.on("room:create", (payload, ack) => {
      const limited = limiter.consume("create", getClientIp(socket));
      if (!limited.allowed) return reject(socket, ack, "RATE_LIMITED", limited.retryAfterMs);
      const parsed = roomCreateSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error, "nickname"));
      if (socket.data.roomAuth) return reject(socket, ack, "SESSION_ACTIVE");

      try {
        const created = roomService.create(parsed.data.nickname, socket.id);
        attachSession(roomService, socket, created, ack);
      } catch {
        reject(socket, ack, "INTERNAL_ERROR");
      }
    });

    socket.on("room:join", (payload, ack) => {
      const limited = limiter.consume("join", getClientIp(socket));
      if (!limited.allowed) return reject(socket, ack, "RATE_LIMITED", limited.retryAfterMs);
      const parsed = roomJoinSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error, "nickname"));
      if (socket.data.roomAuth) return reject(socket, ack, "SESSION_ACTIVE");

      try {
        const joined = roomService.join(parsed.data.roomCode, parsed.data.nickname, socket.id);
        attachSession(roomService, socket, joined, ack);
      } catch (error) {
        rejectRoomError(socket, ack, error);
      }
    });

    socket.on("room:resume", async (payload, ack) => {
      const parsed = roomResumeSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error));
      if (socket.data.roomAuth) return reject(socket, ack, "SESSION_ACTIVE");

      let auth;
      try {
        const resumed = roomService.resume(parsed.data.roomCode, parsed.data.token, socket.id);
        auth = {
          roomCode: resumed.room.roomCode,
          participantId: resumed.participant.participantId,
          tokenHash: resumed.tokenHash,
          socketId: socket.id,
        };
        socket.data.roomAuth = auth;
        await socket.join(resumed.room.roomCode);
        const room = roomService.getState(assertRoomMembership(socket, auth));
        acknowledge(ack, success({ room, participant: publicParticipant(resumed.participant) }));
      } catch (error) {
        socket.data.roomAuth = null;
        if (auth) roomService.disconnect(auth);
        rejectRoomError(socket, ack, error);
      }
    });

    socket.on("room:get-state", (payload, ack) => {
      const parsed = roomCommandSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error));
      try {
        acknowledge(ack, success({ room: roomService.getState(assertRoomMembership(socket, socket.data.roomAuth)) }));
      } catch (error) {
        rejectRoomError(socket, ack, error);
      }
    });

    socket.on("room:leave", async (payload, ack) => {
      const parsed = roomCommandSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error));
      const auth = socket.data.roomAuth;
      try {
        const result = roomService.leave(assertRoomMembership(socket, auth));
        socket.data.roomAuth = null;
        await socket.leave(result.roomCode);
        acknowledge(ack, success({ roomCode: result.roomCode, closed: result.closed }));
      } catch (error) {
        rejectRoomError(socket, ack, error);
      }
    });

    socket.on("webrtc:get-ice-config", (payload, ack) => {
      const limited = limiter.consume("iceConfig", socket.id);
      if (!limited.allowed) return reject(socket, ack, "SIGNALING_RATE_LIMITED", limited.retryAfterMs);
      const parsed = webrtcIceConfigSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error));
      try {
        const auth = assertRoomMembership(socket, socket.data.roomAuth);
        roomService.getState(auth);
        const turnAvailable = config.turnUrls.length > 0 && Boolean(config.turnSharedSecret);
        if (parsed.data.iceTransportPolicy === "relay" && !turnAvailable) return reject(socket, ack, "TURN_NOT_CONFIGURED");

        const iceServers = config.stunUrls.length > 0 ? [{ urls: config.stunUrls }] : [];
        let credentialsExpireAt = null;
        if (turnAvailable) {
          const sessionExpiresAt = roomService.getSessionExpiry(auth);
          const expiresAtSeconds = Math.floor(Math.min(
            now() + config.turnCredentialTtlSeconds * 1000,
            sessionExpiresAt,
          ) / 1000);
          const username = `${expiresAtSeconds}:${auth.participantId}`;
          const credential = createHmac("sha1", config.turnSharedSecret).update(username).digest("base64");
          iceServers.push({ urls: config.turnUrls, username, credential });
          credentialsExpireAt = expiresAtSeconds * 1000;
        }

        acknowledge(ack, success({
          iceServers,
          iceTransportPolicy: parsed.data.iceTransportPolicy,
          turnAvailable,
          credentialsExpireAt,
          notice: turnAvailable ? null : "TURN belum dikonfigurasi; sebagian jaringan mungkin tidak dapat tersambung.",
        }));
      } catch (error) {
        rejectRoomError(socket, ack, error);
      }
    });

    socket.on("webrtc:microphone-state", (payload, ack) => {
      const limited = limiter.consume("webrtc", socket.id);
      if (!limited.allowed) return reject(socket, ack, "SIGNALING_RATE_LIMITED", limited.retryAfterMs);
      const parsed = webrtcMicrophoneStateSchema.safeParse(payload);
      if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error));
      try {
        const participant = roomService.setMicrophoneState(assertRoomMembership(socket, socket.data.roomAuth), parsed.data.microphoneEnabled);
        acknowledge(ack, success({ microphoneEnabled: participant.microphoneEnabled }));
      } catch (error) {
        rejectRoomError(socket, ack, error);
      }
    });

    socket.on("music:get-state", (payload, ack) => {
      const limited = limiter.consume("music", socket.id);
      if (!limited.allowed) return rejectMusic(socket, ack, "MUSIC_RATE_LIMITED", limited.retryAfterMs);
      const parsed = musicGetStateSchema.safeParse(payload);
      if (!parsed.success) return rejectMusic(socket, ack, getValidationError(payload, parsed.error));
      try {
        const state = roomService.getMusicState(assertRoomMembership(socket, socket.data.roomAuth));
        socket.emit("music:state", { protocolVersion: PROTOCOL_VERSION, state });
        acknowledge(ack, success({ state }));
      } catch (error) {
        rejectMusicError(socket, ack, error);
      }
    });

    const musicCommands = {
      "music:play": musicPlaySchema,
      "music:pause": musicPauseSchema,
      "music:seek": musicSeekSchema,
      "music:next": musicNextSchema,
      "music:previous": musicPreviousSchema,
      "music:select": musicSelectSchema,
    };
    for (const [event, schema] of Object.entries(musicCommands)) {
      socket.on(event, (payload, ack) => {
        const limited = limiter.consume("music", socket.id);
        if (!limited.allowed) return rejectMusic(socket, ack, "MUSIC_RATE_LIMITED", limited.retryAfterMs);
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return rejectMusic(socket, ack, getValidationError(payload, parsed.error));
        try {
          const state = roomService.applyMusicCommand(assertRoomMembership(socket, socket.data.roomAuth), event, parsed.data);
          acknowledge(ack, success({ state }));
        } catch (error) {
          rejectMusicError(socket, ack, error);
        }
      });
    }

    const signalSchemas = {
      "webrtc:offer": webrtcOfferSchema,
      "webrtc:answer": webrtcAnswerSchema,
      "webrtc:ice-candidate": webrtcIceCandidateSchema,
      "webrtc:restart-request": webrtcRestartRequestSchema,
    };
    for (const [event, schema] of Object.entries(signalSchemas)) {
      socket.on(event, (payload, ack) => {
        const limited = limiter.consume("webrtc", socket.id);
        if (!limited.allowed) return reject(socket, ack, "SIGNALING_RATE_LIMITED", limited.retryAfterMs);
        const parsed = schema.safeParse(payload);
        if (!parsed.success) return reject(socket, ack, getValidationError(payload, parsed.error));
        try {
          const auth = assertRoomMembership(socket, socket.data.roomAuth);
          const peer = roomService.resolvePeer(auth);
          const peerSocket = io.sockets.sockets.get(peer.socketId);
          if (!peerSocket?.connected || !peerSocket.rooms.has(peer.roomCode)) throw new RoomError("PEER_NOT_AVAILABLE");
          peerSocket.emit(event, { protocolVersion: PROTOCOL_VERSION, ...parsed.data, participantId: auth.participantId });
          acknowledge(ack, success({ delivered: true }));
        } catch (error) {
          rejectRoomError(socket, ack, error);
        }
      });
    }

    socket.on("disconnect", () => {
      if (socket.data.roomAuth) roomService.disconnect(socket.data.roomAuth);
    });
  });

  return {
    httpServer,
    io,
    roomService,
    config,
    listen(port = config.port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          httpServer.off("error", reject);
          resolve(httpServer.address());
        });
      });
    },
    async close() {
      clearInterval(cleanupTimer);
      roomService.shutdown();
      await new Promise((resolve) => io.close(resolve));
    },
  };
}

async function attachSession(roomService, socket, session, ack) {
  const auth = {
    roomCode: session.room.roomCode,
    participantId: session.participant.participantId,
    tokenHash: createTokenHash(session.token),
    socketId: socket.id,
  };
  socket.data.roomAuth = auth;
  try {
    await socket.join(session.room.roomCode);
    const room = roomService.getState(assertRoomMembership(socket, auth));
    acknowledge(ack, success({
      room,
      participant: publicParticipant(session.participant),
      session: { token: session.token, expiresAt: session.participant.tokenExpiresAt },
    }));
  } catch (error) {
    try { roomService.leave(auth); } catch { /* The session may already have been replaced or removed. */ }
    socket.data.roomAuth = null;
    rejectRoomError(socket, ack, error);
  }
}

function getValidationError(payload, validationError, expectedField) {
  if (typeof payload?.protocolVersion !== "number") return "INVALID_PAYLOAD";
  if (payload.protocolVersion !== PROTOCOL_VERSION) return "PROTOCOL_VERSION_UNSUPPORTED";
  if (expectedField === "nickname" && validationError.issues.some((issue) => issue.path[0] === "nickname")) return "INVALID_NICKNAME";
  return "INVALID_PAYLOAD";
}

function assertRoomMembership(socket, auth) {
  if (!auth || !socket.rooms.has(auth.roomCode)) throw new RoomError("UNAUTHORIZED");
  return auth;
}

function acknowledge(ack, response) {
  if (typeof ack === "function") ack(response);
}

function reject(socket, ack, code, retryAfterMs) {
  const response = errorResponse(code, retryAfterMs);
  acknowledge(ack, response);
  socket.emit("room:error", { protocolVersion: PROTOCOL_VERSION, ...response.error });
}

function rejectRoomError(socket, ack, error) {
  if (error instanceof RoomError) return reject(socket, ack, error.code, error.retryAfterMs);
  reject(socket, ack, "INTERNAL_ERROR");
}

function rejectMusic(socket, ack, code, retryAfterMs) {
  const response = errorResponse(code, retryAfterMs);
  acknowledge(ack, response);
  socket.emit("music:error", { protocolVersion: PROTOCOL_VERSION, ...response.error });
}

function rejectMusicError(socket, ack, error) {
  if (error instanceof RoomError) return rejectMusic(socket, ack, error.code, error.retryAfterMs);
  rejectMusic(socket, ack, "INTERNAL_ERROR");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const config = loadConfig();
  const server = createSignalingServer({ config });
  let shuttingDown = false;
  server.listen().then(() => {
    console.log(`RideLink signaling listening on port ${config.port}`);
  }).catch(() => {
    console.error("RideLink signaling failed to start.");
    process.exitCode = 1;
  });
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await server.close();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
