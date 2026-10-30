export function isValidCoordinate(value) {
  return Array.isArray(value) && value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

export function haversineMeters(a, b) {
  const rad = Math.PI / 180;
  const lat1 = a[1] * rad;
  const lat2 = b[1] * rad;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function maneuverType(type, modifier) {
  const names = { 0: "turn", 1: "turn", 2: "turn", 3: "turn", 4: "turn", 5: "turn", 6: "continue", 7: "turn", 8: "turn", 9: "turn", 10: "arrive", 11: "depart", 12: "turn", 13: "turn" };
  return { type: names[type] || "continue", modifier: typeof modifier === "string" ? modifier : null };
}

export function normalizeRoute(payload, destination) {
  const feature = payload?.features?.[0];
  const geometry = feature?.geometry;
  const properties = feature?.properties;
  const coordinates = geometry?.type === "LineString" ? geometry.coordinates : [];
  if (coordinates.length < 2 || coordinates.some((coordinate) => !isValidCoordinate(coordinate))) throw new Error("Rute dari penyedia tidak valid.");
  const providerSegments = properties?.segments || [];
  const steps = providerSegments.flatMap((segment) => segment.steps || []).map((step, index) => {
    const pointIndex = Number(step.way_points?.[0] ?? 0);
    const location = coordinates[Math.max(0, Math.min(coordinates.length - 1, pointIndex))];
    const maneuver = maneuverType(step.type, step.maneuver?.modifier);
    return {
      stepIndex: index,
      distanceMeters: Math.max(0, Number(step.distance) || 0),
      durationSeconds: Math.max(0, Number(step.duration) || 0),
      maneuverType: maneuver.type,
      maneuverModifier: maneuver.modifier,
      maneuverLocation: [...location],
      instruction: typeof step.instruction === "string" ? step.instruction : "Lanjutkan perjalanan.",
      name: typeof step.name === "string" && step.name !== "-" ? step.name : "",
    };
  });
  const summary = providerSegments.reduce((total, segment) => ({ distance: total.distance + (Number(segment.distance) || 0), duration: total.duration + (Number(segment.duration) || 0) }), { distance: 0, duration: 0 });
  if (steps.length) steps[steps.length - 1].maneuverType = "arrive";
  return {
    routeId: globalThis.crypto?.randomUUID?.() || `route-${Date.now()}`,
    geometry: { type: "LineString", coordinates },
    distanceMeters: Number(properties?.summary?.distance) || summary.distance,
    durationSeconds: Number(properties?.summary?.duration) || summary.duration,
    steps,
    destination: { ...destination },
    attribution: "© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors",
  };
}

function projectToSegment(point, a, b) {
  const latScale = 111320;
  const lonScale = Math.cos(point[1] * Math.PI / 180) * 111320;
  const px = point[0] * lonScale;
  const py = point[1] * latScale;
  const ax = a[0] * lonScale;
  const ay = a[1] * latScale;
  const bx = b[0] * lonScale;
  const by = b[1] * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const fraction = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  const coordinate = [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
  return { distance: haversineMeters(point, coordinate), coordinate, fraction };
}

export function projectProgress(route, coordinate, minimumDistanceMeters = 0) {
  const points = route?.geometry?.coordinates || [];
  if (!isValidCoordinate(coordinate) || points.length < 2) return null;
  let best = null;
  let travelled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const segmentLength = haversineMeters(points[index], points[index + 1]);
    const projected = projectToSegment(coordinate, points[index], points[index + 1]);
    if (!best || projected.distance < best.distance) best = { ...projected, distanceAlongMeters: travelled + segmentLength * projected.fraction, segmentIndex: index };
    travelled += segmentLength;
  }
  best.distanceAlongMeters = Math.max(best.distanceAlongMeters, Math.min(route.distanceMeters || best.distanceAlongMeters, minimumDistanceMeters));
  const steps = route.steps || [];
  let nextManeuver = null;
  let stepDistance = 0;
  for (const step of steps) {
    stepDistance += step.distanceMeters || 0;
    if (step.maneuverType !== "depart" && stepDistance >= best.distanceAlongMeters - 12) {
      nextManeuver = { ...step, distanceToManeuverMeters: Math.max(0, stepDistance - best.distanceAlongMeters) };
      break;
    }
  }
  return { ...best, nextManeuver, arrived: best.distanceAlongMeters >= route.distanceMeters - 25 || (nextManeuver?.maneuverType === "arrive" && nextManeuver.distanceToManeuverMeters <= 25) };
}
