import { searchPlaces } from "../../../../lib/navigation/ors-client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const limits = new Map();

export async function GET(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: { code: "FORBIDDEN", message: "Permintaan tidak diizinkan." } }, { status: 403 });
  const now = Date.now();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const item = limits.get(ip);
  if (item && item.until > now && item.count >= 20) return Response.json({ error: { code: "RATE_LIMITED", message: "Pencarian terlalu sering. Tunggu sebentar." } }, { status: 429 });
  limits.set(ip, item && item.until > now ? { ...item, count: item.count + 1 } : { count: 1, until: now + 60_000 });
  if (limits.size > 2000) {
    for (const [key, value] of limits) if (value.until <= now) limits.delete(key);
    while (limits.size > 3000) limits.delete(limits.keys().next().value);
  }
  try {
    const url = new URL(request.url);
    const near = [Number(url.searchParams.get("lon")), Number(url.searchParams.get("lat"))];
    const places = await searchPlaces(url.searchParams.get("q") || "", near);
    return Response.json({ places }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const code = error?.code === "INVALID_QUERY" || error?.code === "PROVIDER_NOT_CONFIGURED" || error?.code === "PROVIDER_TIMEOUT" || error?.code === "PROVIDER_RATE_LIMITED" ? error.code : "GEOCODING_UNAVAILABLE";
    const status = Number.isInteger(error?.status) ? error.status : 502;
    const messages = { INVALID_QUERY: "Masukkan minimal 3 karakter.", PROVIDER_NOT_CONFIGURED: "Pencarian alamat belum dikonfigurasi. Pilih tujuan dengan mengetuk peta.", PROVIDER_TIMEOUT: "Pencarian lokasi terlalu lama merespons.", PROVIDER_RATE_LIMITED: "Kuota pencarian sementara tercapai.", GEOCODING_UNAVAILABLE: "Pencarian alamat belum tersedia." };
    return Response.json({ error: { code, message: messages[code] } }, { status });
  }
}
