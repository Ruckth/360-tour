# Start route-initial JavaScript: browser and manifest cross-check

`scripts/bench/start-route-js-size.mjs` checks the four budgeted Start routes against the build's TanStack Start manifest and Vite client graph, then loads each route in Chromium and compares what the browser actually fetched with that same build. Measured from `4796d7f7` in the isolated local integration harness (fresh anonymous Convex, `demo-resort` seed, dedicated Clerk test owner). Two production Start builds were measured: one served uncompressed (default local Nitro) and one with `BENCH_START_WIRE_GZIP=1` (Nitro precompressed gzip, matching Next's local wire). Bytes are only compared within one build; each run records its build identity in its artifact.

## Run it

```sh
VITEST_MAX_WORKERS=2 node scripts/heavy.mjs node scripts/local-integration.mjs --start -- \
  sh -c 'node scripts/bench/start-route-js-size.mjs --browser-origin "$E2E_BASE_URL" --auth \
    --json output/start-route-js/browser-crosscheck.json'
```

Add `BENCH_START_WIRE_GZIP=1` before `node` for gzip on the wire. Without `--browser-origin` the script checks only the manifest and emitted files. `--auth` signs the harness's `E2E_OWNER_EMAIL` test user in once (test-tenant Clerk keys only), in a context that is not measured. It finds the seeded property editor and reuses that session for each measured staff load. `--property-id` still works for anonymous runs that skip the staff routes.

## What a load must prove

Each load uses a new browser context (empty HTTP cache, service workers blocked, 390×844). It counts only after the route's view is mounted, then waits until no same-origin JavaScript has been in flight or finished for 500 ms.

| Load | Readiness proof |
|---|---|
| Guest home `/` | `section#villas` visible |
| Ordinary room `/rooms/pool-villa` | `room_hydrated` mark; tour viewer must **not** mount |
| Direct room `/rooms/pool-villa?tour=1` | `room_hydrated` mark and tour viewer attached |
| Owner property editor `/admin/properties/$id` | "360 rooms" tab visible (renders only after the authenticated property query returns) |
| Checkout `/admin/checkout` | "Frequent" catalog tab visible (needs the authenticated catalog) |

## Checks

- **Graph mapping.** Static set = the route's manifest closure (route chain preloads and scripts plus static imports). Dynamic set = observed chunks outside it but reachable through dynamic imports. Anything else is unexpected. The sets never overlap, so no file is counted twice.
- **Errors fail the run:** a static chunk the browser never fetched, an unexpected chunk, more than one request for a chunk, a failed or non-OK request, or a fetched chunk without a ResourceTiming entry. So are browser decoded bytes that differ from the emitted file (not the same build), an uncompressed response whose wire size differs from the file, and a renderer chunk (Three.js/React Three/tour) on the ordinary room or checkout. The standard ceilings are applied to the manifest closure and to the observed static set. Brotli limits are 285 KiB for home and room, 430 KiB for the property editor and 534 KiB for checkout. Checkout also has a 546,446-byte gzip limit.
- **Reported, not failed:** ResourceTiming transfer/encoded/decoded bytes, served `content-encoding`, and wire vs cache delivery. Cache delivery means CDP disk, prefetch or service-worker flags, or zero transfer size. Also reported: local raw, level-9 gzip and default Brotli totals, third-party scripts (file name only, never counted), and time to readiness. Encoded bytes are compared exactly only for uncompressed responses. Nitro's gzip level and size threshold differ from the local level-9 reference.
- **Sanitized artifact:** the property ID is replaced with `$id`. No emails, hosts, cookies or tokens are written.

## Results

All loads passed with zero errors in both builds: no missing, unexpected, duplicate or failed same-origin JavaScript, and every decoded size equal to its emitted file. Every same-origin script came over the wire (no cache answers in fresh contexts). The ordinary room, checkout, home and property editor fetched no renderer chunk. The direct tour fetched the two renderer chunks, `TourCanvas` and `TourViewer`, dynamically.

Gzip-on-the-wire build (`wire-gzip.json`, manifest `_tanstack-start-manifest_v-CWP2QROB.mjs`):

| Load | Set | Chunks | Local raw | Local gzip | Local Brotli | Browser encoded | Browser transfer | Encodings | Ceiling |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| Home | static | 21 | 781,193 | 242,675 | 206,528 | 244,565 | 250,865 | gzip 9, identity 12 | 291,840 Br |
| Home | dynamic | 7 | 84,832 | 26,159 | 23,661 | 26,794 | 28,894 | gzip 4, identity 3 | – |
| Ordinary room | static | 20 | 770,452 | 239,210 | 203,341 | 240,603 | 246,603 | gzip 8, identity 12 | 291,840 Br |
| Direct room | static | 20 | 770,452 | 239,210 | 203,341 | 240,603 | 246,603 | gzip 8, identity 12 | – |
| Direct room | dynamic | 5 | 885,992 | 234,417 | 194,785 | 235,549 | 237,049 | gzip 2, identity 3 | – |
| Property editor | static | 77 | 1,211,481 | 392,643 | 339,789 | 397,444 | 420,544 | gzip 35, identity 42 | 440,320 Br |
| Checkout | static | 95 | 1,539,767 | 485,814 | 420,711 | 492,504 | 521,004 | gzip 45, identity 50 | 546,816 Br; 546,446 gz |

The ordinary room, property editor and checkout loaded nothing dynamically before settling. Home's dynamic loads are the booking date picker and its calendar, format and label helpers, plus site settings. In the uncompressed build (`wire-identity.json`) every chunk count and raw total is identical, encoded bytes equal raw bytes, and local gzip/Brotli totals differ by under 0.1% because chunk contents differ slightly between builds.

All four routes are under their Brotli ceilings: home 70.8%, room 69.7%, property editor 77.2%, checkout 76.9%. Checkout's gzip total is at 88.9% of its gzip limit, and its gzip wire bytes would be at 90.1%. Third-party scripts are Clerk's `clerk.browser.js` and `ui.browser.js`, each requested twice, plus Clerk UI chunks. They are listed, not counted, and are outside these budgets.

## Limits

These are local production builds on loopback; hosted Vercel compression (Brotli) and CDN delivery are not measured here. Use the same script with `--vercel` on a local Vercel build, and measure hosted transfer on the Preview. Readiness and timings come from one load per route, not a latency study.
