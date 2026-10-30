import test from "node:test";
import assert from "node:assert/strict";
import { isValidCoordinate, normalizeRoute, projectProgress } from "../apps/web/lib/navigation/route-normalizer.js";

const fixture = {
  type: "FeatureCollection",
  features: [{
    type: "Feature",
    geometry: { type: "LineString", coordinates: [[106.82, -6.17], [106.821, -6.17], [106.822, -6.17]] },
    properties: {
      summary: { distance: 220, duration: 60 },
      segments: [{ distance: 220, duration: 60, steps: [
        { type: 11, instruction: "Depart", distance: 0, duration: 0, way_points: [0, 0] },
        { type: 0, instruction: "Belok kiri", distance: 110, duration: 30, way_points: [1, 1] },
        { type: 10, instruction: "Arrive at destination", distance: 110, duration: 30, way_points: [2, 2] },
      ] }],
    },
  }],
};

test("coordinate validation rejects invalid GPS and provider data", () => {
  assert.equal(isValidCoordinate([106.82, -6.17]), true);
  assert.equal(isValidCoordinate([181, 0]), false);
  assert.equal(isValidCoordinate(["106", -6]), false);
});

test("route normalizer returns stable internal model with maneuver locations", () => {
  const route = normalizeRoute(fixture, { coordinates: [106.822, -6.17] });
  assert.equal(route.geometry.type, "LineString");
  assert.equal(route.distanceMeters, 220);
  assert.equal(route.steps[1].maneuverType, "turn");
  assert.deepEqual(route.steps[1].maneuverLocation, [106.821, -6.17]);
  assert.equal(route.steps.at(-1).maneuverType, "arrive");
});

test("progress projects GPS onto the route and advances to next maneuver", () => {
  const route = normalizeRoute(fixture, { coordinates: [106.822, -6.17] });
  const progress = projectProgress(route, [106.8215, -6.17]);
  assert.ok(progress.distance < 1);
  assert.ok(progress.distanceAlongMeters > 100);
  assert.equal(progress.nextManeuver.maneuverType, "arrive");
  assert.ok(progress.nextManeuver.distanceToManeuverMeters >= 0);
});

test("progress returns null for invalid location", () => {
  const route = normalizeRoute(fixture, { coordinates: [106.822, -6.17] });
  assert.equal(projectProgress(route, [NaN, -6]), null);
});

test("progress floor prevents short GPS noise from moving along-route progress backwards", () => {
  const route = normalizeRoute(fixture, { coordinates: [106.822, -6.17] });
  const forward = projectProgress(route, [106.8215, -6.17]);
  const slightlyBackward = projectProgress(route, [106.8214, -6.17], forward.distanceAlongMeters - 15);
  assert.ok(slightlyBackward.distanceAlongMeters >= forward.distanceAlongMeters - 15);
});

test("normalizer rejects empty or malformed route geometry", () => {
  assert.throws(() => normalizeRoute({ features: [] }, { coordinates: [0, 0] }), /tidak valid/);
});
