# Start SWR controlled Preview comparison

The run ended early after both immutable Preview hosts became unavailable. The verified latency observations below are descriptive. Both p95 gates require 100 verified observations per class and arm and remain inconclusive for this candidate.

Start ran at `b1958145` against the same immutable Next control from `d65172b4`. Both protected Previews, in `iad1`, used the same public Convex fixture and Clerk test publishable key. The run verifies native origin cache state and requires hosted shared storage on every accepted Start sample. The separate hosted pilot verified cold miss, fresh hit, an expired stale response and a refreshed hit on this same deployment. Those probes are outside these figures.

| Class | Next verified | Start verified | Next median / p95 TTFB (ms) | Start median / p95 TTFB (ms) | p95 change |
|---|---:|---:|---:|---:|---:|
| Hit | 59 | 61 | 699.6 / 930.0 | 433.1 / 525.4 | −43.5% |
| Miss | 59 | 62 | 728.6 / 840.9 | 471.6 / 516.1 | −38.6% |

Two consecutive read-only provider checks by immutable ID and host confirmed both deployments were unavailable. The runner preserved the measured rows and stopped. It recorded 48 control and 43 Start transport rejections after the interrupted comparison and never started natural replay. There were 135 Next and 141 Start verified origin responses across measured samples, warmups and primes.

[Scrubbed per-request results](./room-preview-swr-controlled-results.json.gz).
