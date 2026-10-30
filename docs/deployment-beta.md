# RideLink beta deployment

This guide prepares the existing npm-workspaces monorepo for a Vercel web deployment and a separate Railway Socket.IO service. No Vercel/Railway project, provider account, domain, TURN service, or external deployment has been created from this repository. Configure account-owned secrets in each provider dashboard; do not commit them.

## Deployment shape

- Vercel serves `apps/web` as a Next.js App Router application. Its `/api/navigation/route` and `/api/navigation/geocode` handlers use the Node.js runtime and call ORS server-side.
- Railway runs `apps/signaling/server.js` as a long-running Node.js service. It serves `/health` and Socket.IO on the same HTTP server and supports WebSocket upgrades at Socket.IO's default `/socket.io` path.
- The browser connects directly to Railway using `NEXT_PUBLIC_SIGNALING_URL`. On an HTTPS page, set that URL to the public Railway `https://` origin; Socket.IO negotiates WSS. Do not point Vercel API routes or the browser at `localhost` in production.
- Room/session state and signaling rate limits are process-local memory. Run exactly one Railway replica for this beta. A restart, deploy, crash, or rollback loses all active room state and reconnect tokens; horizontal scaling needs a shared repository and Socket.IO adapter first.

Node.js 20.9 or newer is required by the installed Next.js release. Use Node.js 22 for both deployments. The web workspace's build script uses webpack explicitly.

## Vercel project

1. Import the RideLink Git repository as a Vercel project.
2. Set **Root Directory** to `apps/web`; choose the Next.js framework preset and Node.js `22.x`. Keep the default Next.js output directory and automatic install detection. The app `vercel.json` sets `npm run build`; it does not replace Next.js output with a static export.
3. Keep monorepo files outside the app root available to the build step. Vercel detects npm workspaces and the root `package-lock.json`; do not run a subdirectory-only install that ignores the workspace lockfile.
4. Add these variables to the Production environment and Preview only when you intend previews to connect to an explicitly allowed signaling origin:

| Variable | Value / handling |
| --- | --- |
| `NEXT_PUBLIC_SIGNALING_URL` | Railway public HTTPS domain, e.g. `https://ridelink-signaling.up.railway.app`. This is public configuration, not a secret. |
| `NEXT_PUBLIC_MAPTILER_API_KEY` | MapTiler browser key. Restrict allowed HTTP referrers to the production domain and any intentionally enabled preview domains. |
| `NEXT_PUBLIC_MAP_STYLE_URL` | Optional; leave empty when using the MapTiler Streets style configured by the app. |
| `OPENROUTESERVICE_API_KEY` | Private Vercel server environment variable; never prefix with `NEXT_PUBLIC_`. |
| `OPENROUTESERVICE_BASE_URL` | Optional. Defaults in code to `https://api.heigit.org`. |

5. Attach a custom domain in Vercel if desired, wait for its HTTPS certificate, then use that exact origin in Railway's `SIGNALING_CORS_ORIGIN`.

References: [Vercel npm monorepos](https://vercel.com/docs/monorepos), [Vercel Next.js](https://vercel.com/docs/frameworks/full-stack/nextjs), [Vercel Hobby use and quotas](https://vercel.com/docs/plans/hobby), and [Next.js response headers](https://nextjs.org/docs/app/api-reference/config/next-config-js/headers).

The app sends baseline security headers including HSTS on production, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and a `Permissions-Policy` that allows microphone and geolocation only to this origin. A Content Security Policy is not yet enforced; test a CSP with MapLibre's worker, WebGL, MapTiler tile/style/font hosts, and the Railway Socket.IO host before enabling one.

The navigation API rate limits use in-memory maps in each serverless instance. They are abuse safeguards, not a global quota or durable rate limiter; multiple function instances can each have their own counter. ORS remains the authoritative quota boundary. Add a shared rate-limit store before opening the beta to broad public traffic.

## Railway signaling service

Create a persistent Node.js service from the same Git repository. This project uses npm workspaces; configure the service from the repository root (not an isolated `apps/signaling` source archive) so it can use the root lockfile and workspace package.

Set service commands in Railway's service settings:

```sh
npm ci --omit=dev --workspace=@ridelink/signaling
npm run start:signaling
```

Set the health check path to `/health`, expose the service with Railway public networking, select one region close to the beta riders, and keep the replica count at **one**. The server binds to `0.0.0.0`, reads Railway's injected `PORT` (with `SIGNALING_PORT` retained as the local fallback), handles `SIGTERM`/`SIGINT`, and logs only its listening port. It does not log session tokens or TURN credentials.

Configure these Railway variables:

| Variable | Value / handling |
| --- | --- |
| `SIGNALING_CORS_ORIGIN` | Exact comma-separated production origins, e.g. `https://ridelink.example`. Do not use `*`. Add a Vercel preview origin only if that preview needs access. |
| `ROOM_TTL_SECONDS` | Optional; default `28800`. |
| `ROOM_RECONNECT_GRACE_SECONDS` | Optional; default `45`. |
| `ROOM_MAX_PARTICIPANTS` | Must remain `2`. |
| `SESSION_TOKEN_TTL_SECONDS` | Optional; default `28800`. |
| `STUN_URLS` | STUN URL list; defaults to Google's public STUN endpoint. |
| `TURN_URLS` | Optional TURN/TURNS URL list. Empty means no relay service is configured. |
| `TURN_SHARED_SECRET` | Optional private coturn REST shared secret, at least 32 characters. Store only in Railway variables. |
| `TURN_CREDENTIAL_TTL_SECONDS` | Optional; defaults to `600`. |

Railway injects `PORT`; do not set a conflicting fixed production port. `SIGNALING_CORS_ORIGIN` is an origin list, not a URL path. Browser credentials/cookies are disabled. Requests without an `Origin` are accepted for native clients such as a future Flutter app; such clients still need a valid room session token for room events.

`WEB_ORIGIN` is still accepted by the server as a legacy fallback only when `SIGNALING_CORS_ORIGIN` is absent; use `SIGNALING_CORS_ORIGIN` for new services.

Railway's former `railway.json` / `railway.toml` Config as Code is deprecated and is scheduled to stop being read on December 1, 2026; new services cannot opt into it. Use the service settings above or Railway's current IaC workflow after the Railway project and Git source are known. This repository intentionally does not add a legacy Railway config file.

References: [Railway Socket.IO deployment guide](https://docs.railway.com/guides/socketio), [Railway npm monorepos](https://docs.railway.com/deployments/monorepo), [Railway health checks](https://docs.railway.com/deployments/healthchecks), and [Railway Infrastructure as Code](https://docs.railway.com/infrastructure-as-code).

## Environment files

`.env.example` documents the names and local defaults used by the code. For local development, copy it to the app-specific local files. In hosted environments, enter variables into Vercel or Railway dashboards. Never commit `.env`, `.env.local`, real API keys, or TURN secrets. `.gitignore` excludes those local secret files.

| Group | Variables |
| --- | --- |
| Browser-visible Vercel build values | `NEXT_PUBLIC_SIGNALING_URL`, `NEXT_PUBLIC_MAPTILER_API_KEY`, optional `NEXT_PUBLIC_MAP_STYLE_URL` |
| Vercel server only | `OPENROUTESERVICE_API_KEY`, optional `OPENROUTESERVICE_BASE_URL` |
| Railway signaling | `PORT` (platform-injected), local fallback `SIGNALING_PORT`, `SIGNALING_CORS_ORIGIN`, `ROOM_TTL_SECONDS`, `ROOM_RECONNECT_GRACE_SECONDS`, `ROOM_MAX_PARTICIPANTS`, `SESSION_TOKEN_TTL_SECONDS`, `STUN_URLS`, `TURN_URLS`, `TURN_SHARED_SECRET`, `TURN_CREDENTIAL_TTL_SECONDS` |

## Map and routing provider setup

1. Create a MapTiler Cloud account and a browser API key. Configure allowed HTTP referrers for the final HTTPS domain, keep the visible MapTiler/OSM attribution, and inspect account usage. The Free plan currently lists 5,000 map sessions/month and 100,000 API requests/month, and is for testing, personal/non-commercial use or R&D for commercial products. Free usage pauses at quota; it does not silently become a paid plan.
2. Create an OpenRouteService account and API key under the plan that fits the beta. Store the key only in Vercel as `OPENROUTESERVICE_API_KEY`. The current Standard limits list 2,000 Directions requests/day and 40/minute, and 1,000 Geocoding requests/day and 100/minute. The app also applies per-instance safeguards of 10 routes/minute and 20 geocoding requests/minute; these counters are not global across Vercel instances.
3. ORS uses the HeiGIT API host configured in `OPENROUTESERVICE_BASE_URL`. The app proxies only fixed route/geocode endpoints, validates inputs, applies timeouts and bounded response size, and returns normalized provider errors. It is not an arbitrary URL proxy.
4. The current environment has no provider key. Builds and fixture-based browser tests do not verify a live MapTiler map, ORS geocoding, ORS routing, or Indonesian road coverage. Check attribution and quota terms again before beta use.

The patched MapLibre v6 line uses ESM and a bundled worker URL, which are configured in `MapView`. MapLibre v6 requires WebGL2; older devices/browser versions without WebGL2 will not render the map and need a device smoke check.

References: [MapTiler Cloud plans](https://www.maptiler.com/cloud/pricing/), [MapTiler Cloud terms](https://www.maptiler.com/terms/cloud/), [MapTiler key restrictions](https://docs.maptiler.com/guides/developer/credentials/api-key/), [ORS Standard plans](https://openrouteservice.org/plans/), and [ORS API restrictions](https://openrouteservice.org/restrictions/).

## WebRTC, HTTPS, and TURN

- Microphone and geolocation require a secure context; test through Vercel HTTPS, not a LAN `http://` URL on iPhone.
- The WebRTC client requests ICE configuration only after room authorization. STUN-only is the current default. A direct candidate pair working in a local Chromium test does not prove two cellular networks can connect.
- TURN credentials are generated temporarily by signaling from `TURN_URLS`, `TURN_SHARED_SECRET`, participant identity, and expiry. Do not place TURN credentials in Vercel variables or frontend source. No TURN server is included or provisioned; relay-only mode remains unavailable until a TURN service is configured.
- In Safari, microphone selection, autoplay, Bluetooth call-mode routing, and background/locked-screen behavior remain device-dependent. A user gesture may be needed to resume playback. The web beta cannot promise background intercom continuity.

## Deployment order

1. Push the repository to a Git provider used by both hosting projects.
2. Create the Railway signaling service, configure the root-workspace install/start commands, exact `SIGNALING_CORS_ORIGIN`, `PORT`-based service, health check and one replica. Deploy and copy its public HTTPS URL.
3. Create the Vercel project with `apps/web` as the root, set the Railway URL and provider variables, attach the HTTPS domain, and deploy.
4. Update Railway `SIGNALING_CORS_ORIGIN` to the final Vercel HTTPS origin, redeploy signaling, then check that both the health endpoint and a browser Socket.IO connection work.
5. Complete the smoke tests below with two devices on separate internet connections before inviting beta users.

## Smoke tests

Run this on a stationary setup; do not operate a phone while riding.

1. Check signaling health: `curl -fsS https://<railway-domain>/health` should return `status: "ok"` and the expected protocol version.
2. Open the Vercel HTTPS origin on two separate devices. Confirm browser console has no mixed-content, CORS, Socket.IO, or WebGL worker errors; verify expected security headers in the response.
3. Device A creates a room; device B joins it. Verify participant state on both clients and confirm a third join is rejected. Copying only the room code must not take over an existing session.
4. Grant microphone permission on both devices, start intercom, and check Socket.IO, Peer, ICE, selected candidate pair, and incoming/outgoing audio bytes. Test mute/unmute and leaving/rejoining. Repeat using separate mobile networks. Without TURN, record a failed pair as an unsupported network path rather than a pass.
5. Start the shared demo track on one device; enable playback on the other after its gesture. Confirm synchronization and independent volume. Speak an internal browser navigation instruction; only that device's music should duck and restore.
6. Set a MapTiler key and ORS key. Confirm map tiles, MapTiler/OSM attribution, place search, route line, and maneuver instructions. Then inspect provider dashboards for quota consumption. Without keys, those provider checks are not applicable and the interface remains in demo/fallback mode.
7. With no active beta users, redeploy signaling and verify health returns. Existing rooms are expected to be gone because state is in memory.
8. For device compatibility, repeat on two physical iPhones in Safari with Bluetooth headsets while stationary. Test foreground, background, locked screen, call audio mode, mute, and separate mobile networks. Do not mark these checks passed from Chromium results.

## Rollback and troubleshooting

- **Vercel:** use the deployment list to promote the last known-good deployment. Verify the production `NEXT_PUBLIC_SIGNALING_URL` after rollback; public build variables are compiled into the deployment.
- **Railway:** redeploy/rollback to the last known-good service deployment, then check `/health`, environment variables, port, CORS origin, and WebSocket upgrade. The service restart or rollback clears its in-memory room state either way.
- **Health check fails:** confirm service binds `0.0.0.0` and uses Railway `PORT`; inspect startup logs for the generic start error. Do not set a fixed port that disagrees with the Railway public target port.
- **Socket.IO connects but room operations fail:** verify exact Vercel origin in `SIGNALING_CORS_ORIGIN`, protocol version, session storage, and the server logs. Do not paste session tokens into issue reports.
- **WebRTC stays on checking/failed:** compare ICE diagnostics and test both endpoints on different networks. Configure TURN privately if relay is needed; STUN alone cannot traverse every NAT/firewall combination.
- **Map appears blank:** check MapTiler referrer restrictions, map API key, WebGL2 support, browser worker errors, map attribution, and quota. **ORS key does not belong in the browser.**
- **Routing returns 503/429/504:** check Vercel `OPENROUTESERVICE_API_KEY`, ORS dashboard quota, the 12-second provider timeout, and the per-instance rate guard.

## Cost, free tiers, and beta limits

- Vercel Hobby currently costs $0 but is for personal/non-commercial use. Vercel Pro is currently $20/month before applicable tax; choose an eligible plan if RideLink's use is commercial. Check current usage limits before launch.
- Railway Free currently provides a limited service resource envelope (0.5 GB RAM / 1 vCPU and one replica) with a monthly resource credit; new accounts may receive a one-time trial credit. Railway Hobby currently has a $5/month minimum that includes $5 resource usage, with usage beyond that charged separately. Monitor usage and set budget/spend alerts before leaving beta services running.
- MapTiler Free and ORS Standard have the quotas and usage restrictions listed above. None is unlimited. A user loading a map creates provider usage; tile panning can consume requests.
- No package will activate billing by itself; no account, key, paid plan, TURN service, or cloud deployment was created for this task. Provider plans and terms change, so recheck the linked official pages and dashboards before each beta expansion.

## Security review notes

- The Socket.IO protocol remains version 1. Room operations and signaling are authenticated by a bearer session, schemas validate events, CORS is allowlisted, the payload limit is 16 KiB, and server-side rate limits apply.
- Session tokens are stored in browser `sessionStorage` and in memory, transmitted only over HTTPS/WSS after deployment, and are not logged. Room state and rate-limit counters are volatile.
- API keys: MapTiler key is public and must be origin-restricted; ORS key and TURN shared secret are server-only. Production must never use localhost signaling.
- `npm audit` is part of the deployment validation. A critical MapLibre DOM sanitizer advisory was found during this audit; the dependency has been upgraded to a patched v6 release and the app import/worker integration migrated. Re-run audit on each release.
- HSTS, frame, content-type, referrer, and microphone/geolocation policy headers are configured for the web app. CSP and shared/global API rate limiting remain beta hardening work.
