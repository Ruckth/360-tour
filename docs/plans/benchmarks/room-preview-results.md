# Phase 2 room Preview comparison before stale-while-revalidate

This run measured the original hard-expiry cache on `d65172b4`. Both controlled p95 TTFB checks passed. The natural replay failed and prompted the change to stale-while-revalidate. The release protocol and cache policy are recorded in [Controlled Preview room cache](./room-preview-cache.md).

Both protected, immutable Preview builds came from `d65172b4`. They used the same public Convex Preview data, Clerk test publishable key, and `iad1` function region. The runner reached both from the `sin1` edge and sent anonymous `GET /rooms/pool-villa?tour=1` requests with no cookie jar or followed redirects. Each class got 100 verified samples per build, with alternating arm order and the same one-second cadence. The Vercel CLI authenticated Preview access. Curl measured each request from a fresh connection. The wait columns subtract connection and TLS setup.

| Cache class | Next median / p95 TTFB | Start median / p95 TTFB | Next / Start p95 wait | p95 TTFB change |
|---|---:|---:|---:|---:|
| Verified hit | 727.8 / 813.0 ms | 440.0 / 529.1 ms | 734.3 / 432.0 ms | −34.9% |
| Verified miss | 751.3 / 974.1 ms | 475.2 / 604.7 ms | 863.5 / 461.1 ms | −37.9% |

The runner verified 229 origin responses for each app before natural replay. That includes 200 measured requests, 27 primes, and two warmups per app. It rejected zero samples. Region, namespace echo, and the native application cache class were checked for every measured request. The instrumented responses were private and no-store. Next emitted a locale preference cookie, which the runner discarded. Start emitted no cookies.

Next's build marks both the ordinary room route and the instrumented sibling dynamic. The control uses the same room render and Next's own cache. Start uses Vercel Runtime Cache. Next streamed matching substantive room HTML behind its Suspense boundary. Start exposed that HTML directly. In an offline Chromium check with JavaScript disabled, both captures contained one room heading and only Start displayed it. Start added the canonical `https://tour.helpgueststay.com/rooms/pool-villa`. The comparator accepted only that exact canonical addition. No prerender fallback is indicated by the controlled TTFB results.

For the protected Preview protocol and rebuild setup, see [Controlled Preview room cache](./room-preview-cache.md). The measurement runner used `--region iad1 --canonical-origin https://tour.helpgueststay.com --samples 100 --natural-requests 100` with the verified deployment IDs.

## Natural cache replay

Each arm received the same 100-request sequence using seed `20261122`, a 20-second mean gap and a 90-second cap. The runner counted both fresh hits and stale responses served without blocking on a data refresh.

| Build | Verified requests | Fresh hits | Stale responses | Misses | Cache hit rate | Origin responses |
|---|---:|---:|---:|---:|---:|---:|
| Next | 100 / 100 | 70 | 29 | 1 | 99.0% | 100 |
| Start | 100 / 100 | 69 | 0 | 31 | 69.0% | 100 |

Start changed the natural hit rate by −30.0 percentage points against a maximum loss of 2 points. Next served stale cache entries while refreshing them. Start’s hard TTL made requests after expiry wait for fresh data. This result blocked cutover on this revision. The later [hosted archive and outage tests](./start-villa-cache-study.md) exercise the replacement policy.

[Scrubbed per-request timings and gate output](./room-preview-results.json.gz).
