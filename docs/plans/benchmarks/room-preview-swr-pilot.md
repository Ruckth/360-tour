# Start post-expiry cache pilot

Both exact-source pilots passed on `39e8e931`. A fresh namespace isolated the route from ordinary cache data and other tests. The local runner used the production Nitro build, a fresh Convex demo-resort fixture, and an isolated loopback read counter. The hosted runner reached the protected Start Preview in `iad1` via the Vercel CLI and required the native shared-storage header. No shared Convex writes were made.

| Request | Expected cache | Local cache / detail reads since start | Preview cache / TTFB |
|---|---|---|---|
| cold-prime | miss | miss / 1 | miss / 2672.2 ms |
| fresh-hit | hit | hit / 1 | hit / 714.9 ms |
| expired-stale | stale | stale / 2 | stale / 2387.8 ms |
| refreshed-hit | hit | hit / 2 | hit / 754.2 ms |

The stale probe started 65 seconds after the confirmed prime. The refreshed hit followed five seconds later. Neither fresh hit caused a Convex read in the local fixture. The stale probe caused exactly one refresh. The hosted response was served by shared storage and had no outage recovery qualifier. Individual TTFB values are diagnostics. The matched Preview comparison measures the performance gates.

The [earlier synchronous-expiry build](./room-preview-results.md) recorded 69% natural cache-served responses against 99% on Next. These pilots verify the new post-expiry behavior without pooling any earlier responses with the new candidate. See [Controlled Preview room cache](./room-preview-cache.md) for commands.
