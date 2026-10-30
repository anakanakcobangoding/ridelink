import { isValidCoordinate, normalizeRoute } from "./route-normalizer.js";

const ORS_BASE = process.env.OPENROUTESERVICE_BASE_URL || "https://api.heigit.org";
const MAX_RESPONSE_BYTES = 2_000_000;

export class NavigationProviderError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}

async function providerFetch(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new NavigationProviderError("PROVIDER_RESPONSE_TOO_LARGE");
    if (!response.ok) throw new NavigationProviderError(response.status === 429 ? "PROVIDER_RATE_LIMITED" : "ROUTING_UNAVAILABLE");
    try { return JSON.parse(text); } catch { throw new NavigationProviderError("ROUTING_UNAVAILABLE"); }
  } catch (error) {
    if (error?.name === "AbortError") throw new NavigationProviderError("PROVIDER_TIMEOUT", 504);
    if (error instanceof NavigationProviderError) throw error;
    throw new NavigationProviderError("ROUTING_UNAVAILABLE");
  } finally { clearTimeout(timer); }
}

function getKey() {
  const key = process.env.OPENROUTESERVICE_API_KEY;
  if (!key) throw new NavigationProviderError("PROVIDER_NOT_CONFIGURED", 503);
  return key;
}

export async function requestRoute(start, end) {
  if (!isValidCoordinate(start) || !isValidCoordinate(end)) throw new NavigationProviderError("INVALID_COORDINATE", 400);
  const data = await providerFetch(`${ORS_BASE}/openrouteservice/v2/directions/driving-car/geojson`, {
    method: "POST",
    headers: { Authorization: getKey(), "Content-Type": "application/json", Accept: "application/geo+json" },
    body: JSON.stringify({ coordinates: [start, end], instructions: true, language: "id", instructions_format: "text", geometry: true }),
  });
  return normalizeRoute(data, { coordinates: end });
}

export async function searchPlaces(query, near) {
  if (typeof query !== "string" || query.trim().length < 3 || query.length > 120) throw new NavigationProviderError("INVALID_QUERY", 400);
  const url = new URL(`${ORS_BASE}/pelias/v1/search`);
  url.searchParams.set("text", query.trim());
  url.searchParams.set("size", "5");
  url.searchParams.set("lang", "id");
  if (isValidCoordinate(near)) url.searchParams.set("focus.point.lat", String(near[1]));
  if (isValidCoordinate(near)) url.searchParams.set("focus.point.lon", String(near[0]));
  const result = await providerFetch(url, { headers: { Authorization: getKey(), Accept: "application/json" } });
  return (result.features || []).slice(0, 5).flatMap((feature) => {
    const coordinate = feature?.geometry?.coordinates;
    if (!isValidCoordinate(coordinate)) return [];
    const properties = feature.properties || {};
    return [{ id: String(feature.id || `${coordinate[0]},${coordinate[1]}`).slice(0, 160), label: String(properties.label || properties.name || "Lokasi").slice(0, 180), coordinates: coordinate }];
  });
}
