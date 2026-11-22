# Corrected controlled room Preview TTFB

Both controlled p95 TTFB gates passed with 100 verified samples per class and build. Document equivalence and same-region gates passed.

Both protected Preview arms used the same exact source revision and immutable deployments as the [corrected natural replay](./room-preview-corrected-natural.md), which records source provenance. Controlled sampling began after the natural replay and rotated separate test-only namespaces. Each accepted observation required actual Next or Start origin execution in `iad1`, the response’s matching namespace and native cache-state header, a private/no-store room document, and shared cache storage on Start. Next’s document-based observation is used only by the natural comparator.

| Class | Next verified | Start verified | Next median / p95 TTFB (ms) | Start median / p95 TTFB (ms) | Start p95 change |
|---|---:|---:|---:|---:|---:|
| Hit | 100 | 100 | 685.6 / 910.7 | 437.1 / 485.2 | −46.7% |
| Miss | 100 | 100 | 718.7 / 930.6 | 482.3 / 545.1 | −41.4% |

The gate allows up to +5% p95 TTFB per class. Medians are descriptive. Curl used a fresh connection per request and measured wall time to first byte, including connection and TLS setup. The CLI process overhead is outside this metric.

| Build | All origin responses | Measured hit attempts | Measured miss attempts | Primes | Warmups |
|---|---:|---:|---:|---:|---:|
| Next | 228 | 100 | 100 | 26 | 2 |
| Start | 231 | 100 | 101 | 28 | 2 |

The raw report retains four rejected Start responses with an unconfirmed cache write. Three were primes and one was a measured miss attempt.

[Scrubbed timings, origin counts, cache classes and gate output](./room-preview-corrected-timing.json.gz).
