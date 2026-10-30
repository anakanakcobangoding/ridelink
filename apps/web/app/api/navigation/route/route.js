import { requestRoute } from "../../../../lib/navigation/ors-client.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;
const limits = new Map();

function limited(request, key) {
  const now = Date.now();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const id = `${key}:${ip}`;
  const current = limits.get(id);
  if (current && current.until > now && current.count >= 10) return true;
  limits.set(id, current && current.until > now ? { ...current, count: current.count + 1 } : { count: 1, until: now + 60_000 });
  if (limits.size > 2000) {
    for (const [entry, value] of limits) if (value.until <= now) limits.delete(entry);
    while (limits.size > 3000) limits.delete(limits.keys().next().value);
  }
  return false;
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: { code: "FORBIDDEN", message: "Permintaan tidak diizinkan." } }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json") || Number(request.headers.get("content-length") || 0) > 4096) return Response.json({ error: { code: "INVALID_REQUEST", message: "Permintaan tidak valid." } }, { status: 400 });
  if (limited(request, "route")) return Response.json({ error: { code: "RATE_LIMITED", message: "Terlalu banyak permintaan rute. Coba beberapa saat lagi." } }, { status: 429 });
  try {
    const rawBody = await request.text();
    if (rawBody.length > 4096) return Response.json({ error: { code: "INVALID_REQUEST", message: "Permintaan tidak valid." } }, { status: 413 });
    let body;
    try { body = JSON.parse(rawBody); } catch { return Response.json({ error: { code: "INVALID_REQUEST", message: "Permintaan tidak valid." } }, { status: 400 }); }
    const route = await requestRoute(body?.start, body?.end);
    return Response.json({ route }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    const codes = new Set(["INVALID_COORDINATE", "PROVIDER_NOT_CONFIGURED", "PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "ROUTING_UNAVAILABLE"]);
    const code = codes.has(error?.code) ? error.code : "ROUTING_UNAVAILABLE";
    const messages = { INVALID_COORDINATE: "Koordinat tidak valid.", PROVIDER_NOT_CONFIGURED: "Routing live belum dikonfigurasi; pilih lokasi pada peta untuk menyimpan tujuan.", PROVIDER_TIMEOUT: "Layanan rute terlalu lama merespons.", PROVIDER_RATE_LIMITED: "Kuota routing sementara tercapai.", ROUTING_UNAVAILABLE: "Rute belum dapat dihitung. Periksa lokasi dan coba lagi." };
    return Response.json({ error: { code, message: messages[code] } }, { status });
  }
}
