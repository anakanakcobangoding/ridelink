import { z } from "zod";

export const PROTOCOL_VERSION = 1;
const versioned = { protocolVersion: z.literal(PROTOCOL_VERSION) };
const nicknamePattern = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,23}$/u;
const uuidSchema = z.string().uuid();
const signalingBase = { ...versioned, negotiationId: uuidSchema, messageId: uuidSchema };
const roomCodeSchema = z.string().min(10).max(11).regex(/^[A-Z0-9]{5}-?[A-Z0-9]{5}$/i)
  .transform((value) => {
    const normalized = value.replaceAll("-", "").toUpperCase();
    return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
  });

export const roomCreateSchema = z.object({
  ...versioned,
  nickname: z.string().max(64).transform((value) => value.normalize("NFKC").trim())
    .refine((value) => [...value].length >= 2 && [...value].length <= 24 && nicknamePattern.test(value), "invalid nickname"),
}).strict();

export const roomJoinSchema = z.object({
  ...versioned,
  roomCode: roomCodeSchema,
  nickname: z.string().max(64).transform((value) => value.normalize("NFKC").trim())
    .refine((value) => [...value].length >= 2 && [...value].length <= 24 && nicknamePattern.test(value), "invalid nickname"),
}).strict();

export const roomResumeSchema = z.object({
  ...versioned,
  roomCode: roomCodeSchema,
  token: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export const roomCommandSchema = z.object(versioned).strict();
const sessionDescriptionSchema = z.object({
  type: z.literal("offer").or(z.literal("answer")),
  sdp: z.string().min(1).max(12_000),
}).strict();
const iceCandidateSchema = z.object({
  candidate: z.string().max(4096),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(255).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional(),
}).strict();

export const webrtcOfferSchema = z.object({
  ...signalingBase,
  description: sessionDescriptionSchema.extend({ type: z.literal("offer") }),
}).strict();
export const webrtcAnswerSchema = z.object({
  ...signalingBase,
  description: sessionDescriptionSchema.extend({ type: z.literal("answer") }),
}).strict();
export const webrtcIceCandidateSchema = z.object({ ...signalingBase, candidate: iceCandidateSchema }).strict();
export const webrtcRestartRequestSchema = z.object({ ...versioned, negotiationId: uuidSchema, messageId: uuidSchema }).strict();
export const webrtcMicrophoneStateSchema = z.object({ ...versioned, microphoneEnabled: z.boolean() }).strict();
export const webrtcIceConfigSchema = z.object({
  ...versioned,
  iceTransportPolicy: z.enum(["all", "relay"]).default("all"),
}).strict();

const musicCommandBase = { ...versioned, expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) };
export const musicGetStateSchema = z.object(versioned).strict();
export const musicPlaySchema = z.object(musicCommandBase).strict();
export const musicPauseSchema = z.object(musicCommandBase).strict();
export const musicSeekSchema = z.object({ ...musicCommandBase, positionSeconds: z.number().finite().min(0).max(86_400) }).strict();
export const musicNextSchema = z.object(musicCommandBase).strict();
export const musicPreviousSchema = z.object(musicCommandBase).strict();
export const musicSelectSchema = z.object({ ...musicCommandBase, trackId: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/) }).strict();

export const WEBRTC_CLIENT_EVENTS = Object.freeze([
  "webrtc:offer",
  "webrtc:answer",
  "webrtc:ice-candidate",
  "webrtc:restart-request",
  "webrtc:microphone-state",
  "webrtc:get-ice-config",
]);
export const MUSIC_CLIENT_EVENTS = Object.freeze([
  "music:get-state",
  "music:play",
  "music:pause",
  "music:seek",
  "music:next",
  "music:previous",
  "music:select",
]);
export const ROOM_CLIENT_EVENTS = Object.freeze([
  "room:create",
  "room:join",
  "room:resume",
  "room:leave",
  "room:get-state",
  ...WEBRTC_CLIENT_EVENTS,
  ...MUSIC_CLIENT_EVENTS,
]);

export const ERROR_MESSAGES = Object.freeze({
  INVALID_PAYLOAD: "Data yang dikirim tidak valid.",
  PROTOCOL_VERSION_UNSUPPORTED: "Versi aplikasi tidak didukung. Muat ulang aplikasi.",
  INVALID_NICKNAME: "Nama panggilan harus berisi 2–24 karakter yang valid.",
  ROOM_NOT_FOUND: "Room tidak ditemukan.",
  ROOM_FULL: "Room sudah penuh.",
  ROOM_EXPIRED: "Room sudah kedaluwarsa.",
  RATE_LIMITED: "Terlalu banyak percobaan. Coba lagi sebentar.",
  UNAUTHORIZED: "Sesi tidak valid atau sudah berakhir.",
  SESSION_ACTIVE: "Sesi ini sudah aktif pada koneksi ini.",
  INVALID_EVENT: "Event tidak dikenal.",
  PEER_NOT_AVAILABLE: "Rider lain belum tersambung ke signaling.",
  SIGNALING_RATE_LIMITED: "Terlalu banyak pesan koneksi. Tunggu sebentar lalu coba lagi.",
  TURN_NOT_CONFIGURED: "Mode relay belum tersedia karena TURN belum dikonfigurasi.",
  MUSIC_CONFLICT: "Kontrol musik berubah di perangkat lain. Status terbaru sedang disinkronkan.",
  MUSIC_TRACK_NOT_FOUND: "Track musik tidak tersedia.",
  MUSIC_POSITION_INVALID: "Posisi lagu tidak valid.",
  MUSIC_RATE_LIMITED: "Terlalu banyak kontrol musik. Tunggu sebentar lalu coba lagi.",
  INTERNAL_ERROR: "Terjadi kesalahan. Coba lagi.",
});
