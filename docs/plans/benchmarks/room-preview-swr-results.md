# Start stale-while-revalidate Preview comparison

The controlled p95 TTFB, document equivalence and region gates passed. The natural replay gate remains inconclusive because 29 Next origin responses omitted both instrumentation headers. The frozen unknown ceiling is 5%.

Both immutable Preview arms and the runner used [verified uploads from `aea4cc51`](./room-preview-source-attestation.md). The new Next control classifies blocking outage recovery separately, as does Start. Start also includes shared generations, stale-while-revalidate and background recovery bookkeeping. Both arms used the same public Convex Preview fixture, test Clerk configuration and `iad1` origin region. The runner waited for the [intermediate SWR comparison](./room-preview-swr-controlled-results.md) to finish before sending measured traffic to the matched arms. No observations from earlier candidates were pooled.

Both pilots observed cold prime miss → fresh hit → nonblocking stale response after 65 s → refreshed hit. The earlier local pilot on `39e8e931` counted exactly two detail reads, including one refresh. The hosted pilot on `aea4cc51` required verified shared cache storage and true origin execution. It used a private/no-store route and a fresh namespace reserved for that pilot.

| Controlled cache class | Next verified | Start verified | Next median / p95 TTFB (ms) | Start median / p95 TTFB (ms) | p95 change |
|---|---:|---:|---:|---:|---:|
| Hit | 100 | 100 | 688.3 / 899.0 | 452.1 / 512.9 | −42.9% |
| Miss | 100 | 100 | 718.4 / 931.1 | 517.8 / 634.5 | −31.9% |

The gate allows at most +5% p95 TTFB per class. Median is descriptive. Curl measured a fresh connection per request. Next recorded 228 controlled origin responses and Start recorded 230. Each had 26 primes and two warmups. Two Start miss attempts returned an unconfirmed cache write and were excluded from the verified classes.

## Natural cache replay

The separately scheduled replay used seed `20261122`, 100 requests per arm, a 20-second mean gap and a 90-second cap. Both fresh hits and nonblocking stale responses count as served from cache. Each accepted miss records an observed fetch. A recovery response counts as a known non-hit. Unknown observations stay visible and are excluded from verified hit-rate denominators.

| Build | Verified / total | Fresh hits | Nonblocking stale | Fetches | Outage recovery | Unknown | Observed hit rate | Origin responses |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Next | 71 / 100 | 56 | 14 | 1 | 0 | 29 | 98.6% | 100 |
| Start | 100 / 100 | 70 | 29 | 1 | 0 | 0 | 99.0% | 100 |

The observed difference between the verified rates was +0.4 percentage points. The frozen gate allows a loss of 2 points and at most 5% unverified responses in either arm. Next had 29% unverified responses. All 29 returned HTTP 200 from the measured origin with private/no-store and lacked both the echoed namespace and cache observation. Their inter-request idle gaps were 29.53–90.10 seconds and TTFB was 2,689.9–3,962.0 ms. Verified Next responses had gaps at most 28.26 seconds and TTFB at most 975.3 ms.

Start had no verified misses within a conservative 45-second upper age bound of a confirmed write. Its observed and optimistic hit rates were both 99.0%.

[Scrubbed per-request timings and gate output](./room-preview-swr-results.json.gz).
