import { io } from "socket.io-client";

export const ROOM_PROTOCOL_VERSION = 1;
const STORAGE_PREFIX = "ridelink.room.session.";
let socket;
let activeRoomCode = null;
let activeParticipantId = null;
let hasBoundSession = false;
let resumeInFlight = null;
const volatileSessions = new Map();

export class RoomClientError extends Error {
  constructor(error) {
    super(error?.message || "Tidak dapat terhubung ke layanan room.");
    this.name = "RoomClientError";
    this.code = error?.code || "CONNECTION_ERROR";
    this.retryAfterMs = error?.retryAfterMs;
  }
}

function getSocket() {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SIGNALING_URL || (process.env.NODE_ENV === "production" ? window.location.origin : "http://localhost:4000");
    socket = io(url, { autoConnect: false, reconnection: true, reconnectionAttempts: Infinity, timeout: 10_000 });
    socket.on("disconnect", (reason) => {
      hasBoundSession = false;
      if (reason === "io server disconnect" && activeRoomCode) {
        clearSession(activeRoomCode);
        activeRoomCode = null;
        activeParticipantId = null;
      }
    });
    socket.on("connect", () => { hasBoundSession = false; });
  }
  return socket;
}

function canonicalCode(code) {
  const normalized = String(code || "").replaceAll("-", "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(normalized)) throw new RoomClientError({ code: "INVALID_PAYLOAD", message: "Kode room harus berisi 10 karakter." });
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

function storageKey(code) {
  return `${STORAGE_PREFIX}${canonicalCode(code)}`;
}

function readSession(code) {
  const key = storageKey(code);
  if (volatileSessions.has(key)) return volatileSessions.get(key);
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function saveSession(code, session) {
  const key = storageKey(code);
  volatileSessions.set(key, session);
  try {
    sessionStorage.setItem(key, JSON.stringify(session));
  } catch {
    // The in-memory copy still supports navigation in this tab; a reload will require joining again.
  }
}

function clearSession(code) {
  const key = storageKey(code);
  volatileSessions.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable in restricted browser contexts. */ }
}

async function connect() {
  const currentSocket = getSocket();
  if (currentSocket.connected) return currentSocket;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error("Waktu koneksi habis.")), 12_000);
    const onConnect = () => finish(null);
    const onError = (error) => finish(error);
    const finish = (error) => {
      clearTimeout(timeout);
      currentSocket.off("connect", onConnect);
      currentSocket.off("connect_error", onError);
      if (error) reject(new RoomClientError({ code: "CONNECTION_ERROR", message: "Tidak dapat tersambung ke layanan room. Periksa koneksi lalu coba lagi." }));
      else resolve();
    };
    currentSocket.once("connect", onConnect);
    currentSocket.once("connect_error", onError);
    currentSocket.connect();
  });
  return currentSocket;
}

function request(event, payload) {
  return new Promise((resolve, reject) => {
    getSocket().timeout(12_000).emit(event, { protocolVersion: ROOM_PROTOCOL_VERSION, ...payload }, (timeoutError, response) => {
      if (timeoutError) return reject(new RoomClientError({ code: "CONNECTION_ERROR", message: "Layanan tidak merespons. Coba lagi." }));
      if (!response?.ok) return reject(new RoomClientError(response?.error));
      resolve(response.data);
    });
  });
}

async function createOrJoin(event, payload) {
  await connect();
  const result = await request(event, payload);
  saveSession(result.room.roomCode, result.session);
  activeRoomCode = result.room.roomCode;
  activeParticipantId = result.participant.participantId;
  hasBoundSession = true;
  return result;
}

export const roomClient = {
  createRoom(nickname) {
    return createOrJoin("room:create", { nickname });
  },

  joinRoom(roomCode, nickname) {
    return createOrJoin("room:join", { roomCode: canonicalCode(roomCode), nickname });
  },

  async restoreRoom(roomCode) {
    const normalizedCode = canonicalCode(roomCode);
    if (resumeInFlight) return resumeInFlight;
    resumeInFlight = (async () => {
      await connect();
      if (hasBoundSession && activeRoomCode === normalizedCode) {
        const result = await request("room:get-state", {});
        return { room: result.room, participantId: activeParticipantId };
      }

      const session = readSession(normalizedCode);
      if (!session?.token) throw new RoomClientError({ code: "SESSION_MISSING", message: "Sesi room ini tidak tersimpan di tab ini. Bergabung kembali dari beranda." });
      const result = await request("room:resume", { roomCode: normalizedCode, token: session.token });
      activeRoomCode = normalizedCode;
      activeParticipantId = result.participant.participantId;
      hasBoundSession = true;
      return { room: result.room, participantId: activeParticipantId };
    })().catch((error) => {
      if (["ROOM_EXPIRED", "ROOM_NOT_FOUND", "UNAUTHORIZED"].includes(error.code)) clearSession(normalizedCode);
      throw error;
    }).finally(() => { resumeInFlight = null; });
    return resumeInFlight;
  },

  async getState() {
    return (await request("room:get-state", {})).room;
  },

  async command(event, payload = {}) {
    await connect();
    return request(event, payload);
  },

  async leaveRoom(roomCode) {
    const code = canonicalCode(roomCode);
    await request("room:leave", {});
    clearSession(code);
    activeRoomCode = null;
    activeParticipantId = null;
    hasBoundSession = false;
    getSocket().disconnect();
  },

  forgetRoom(roomCode) {
    const code = canonicalCode(roomCode);
    clearSession(code);
    if (activeRoomCode === code) {
      activeRoomCode = null;
      activeParticipantId = null;
      hasBoundSession = false;
    }
  },

  on(event, callback) {
    const currentSocket = getSocket();
    currentSocket.on(event, callback);
    return () => currentSocket.off(event, callback);
  },

  ensureConnected() {
    const currentSocket = getSocket();
    if (!currentSocket.connected) currentSocket.connect();
    return currentSocket.connected;
  },
};
