# Navigation provider setup and usage

## Environment

Copy `.env.example` values into `apps/web/.env.local` for local use. The browser reads only `NEXT_PUBLIC_MAPTILER_API_KEY`. Set a MapTiler key with allowed HTTP origins for `localhost` during development and the exact production web origin when deployed. Rotate keys if exposed outside RideLink. `OPENROUTESERVICE_API_KEY` and optional `OPENROUTESERVICE_BASE_URL` belong in the private Next.js server environment only.

No provider key or account is included in this repository. When keys are absent, the map uses a blank MapLibre style for map-click destination selection; address search and live routing show an explicit configuration error. This is not live map/routing coverage.

## Provider terms checked 2026-10-29

- **MapLibre GL JS** is the open-source WebGL renderer; it does not supply map data or a tile service. The application uses its attribution control and GeoJSON source/layer APIs. [MapLibre GL JS docs](https://maplibre.org/maplibre-gl-js/docs/)
- **MapTiler Free** lists 5,000 map sessions/month and 100,000 API requests/month. Free service pauses until the next month at quota; it does not automatically upgrade. Free is for testing, personal/non-commercial use and R&D for commercial product applications. MapTiler says attribution is required while maps display, including its logo, linked copyright text, and OpenStreetMap attribution. Tile results may be held only in temporary client-side cache for one end-user; server-side map content caching/proxying is prohibited without agreement. Keep browser tile requests direct to MapTiler. [Pricing](https://www.maptiler.com/cloud/pricing/), [Cloud terms](https://www.maptiler.com/terms/cloud/), [General terms](https://www.maptiler.com/terms/), [API key security](https://docs.maptiler.com/guides/developer/credentials/api-key/), [browser cache behavior](https://docs.maptiler.com/guides/maps-apis/maps-platform/how-are-the-tile-requests-cached-in-web-browser/), [attribution requirements](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/)
- **OpenRouteService / HeiGIT** Standard plan currently lists 2,000 Directions/day and 40/minute, and 1,000 Geocoding/day and 100/minute. Route and Geocoding endpoints also have request-size/feature restrictions. Keep autocomplete debounced; do not calculate on every GPS update. The application limits this process to 10 route requests/minute and 20 geocoding requests/minute per detected client IP as an additional local safeguard; provider quotas remain authoritative. Requests use the new `https://api.heigit.org/openrouteservice/v2/...` and `https://api.heigit.org/pelias/v1/...` host paths after the 2026 migration. [Plans](https://openrouteservice.org/plans/), [API restrictions](https://openrouteservice.org/restrictions/), [migration notice](https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912), [Terms of Service](https://openrouteservice.org/terms-of-service/)

OpenRouteService derives routing from OpenStreetMap data. The service disclaims data completeness/accuracy; routing availability and quality must be checked on intended roads in Indonesia before real rides. No live provider request or Indonesia route was tested in this environment because no key was supplied. ORS results are CC-BY 4.0 and need the provider/OSM attribution shown in the panel. Geocoding attribution/data source requirements also apply. For MapTiler maps, the in-map attribution control links MapTiler and OSM.

Free terms and quotas change; review provider terms and account dashboards before deploying or increasing use. RideLink does not purchase a plan, enable billing, or create provider credentials.

## Route model (protocol version 1)

```json
{
  "routeId": "opaque-client-route-id",
  "geometry": { "type": "LineString", "coordinates": [[106.82, -6.17], [106.83, -6.16]] },
  "distanceMeters": 1400,
  "durationSeconds": 240,
  "steps": [{
    "stepIndex": 1,
    "distanceMeters": 250,
    "durationSeconds": 42,
    "maneuverType": "turn",
    "maneuverModifier": null,
    "maneuverLocation": [106.822, -6.17],
    "instruction": "Turn left",
    "name": ""
  }],
  "destination": { "coordinates": [106.83, -6.16] },
  "attribution": "© openrouteservice.org by HeiGIT | Map data © OpenStreetMap contributors"
}
```

Coordinates are `[longitude, latitude]`. `maneuverType` is `depart`, `continue`, `turn`, or `arrive`; provider instructions and names remain provider data. Flutter can consume this shape without knowing ORS response nesting. Route and geocode endpoints return `Cache-Control: no-store`; location and routes are never added to room Socket.IO messages or persistent storage.

## Internal instruction lifecycle

The browser event target emits `navigation:instruction-start`, `navigation:instruction-end`, `navigation:instruction-error`, and `navigation:instruction-cancel`. `start`/`end` come from actual `SpeechSynthesisUtterance` events. Cancel/error are emitted when canceling or speech playback fails. Payloads never include coordinates or provider credentials. Stage 5 only exposes these events; it does not change music volume or implement ducking.
