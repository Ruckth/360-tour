# Shared-generation Start controlled Preview comparison

Both controlled p95 TTFB gates passed.

Start ran at `0075819d` against the same immutable Next control from `d65172b4`. Both protected Previews, in `iad1`, used the same public Convex fixture and Clerk test publishable key. The run verifies native origin cache state and requires hosted shared storage on every accepted Start sample. The first preflight recorded an early repeat miss. A separate namespace then returned one verified miss and five consecutive hits. Those probes are outside these figures.

| Class | Next verified | Start verified | Next median / p95 TTFB (ms) | Start median / p95 TTFB (ms) | p95 change |
|---|---:|---:|---:|---:|---:|
| Hit | 100 | 100 | 717.6 / 932.9 | 460.2 / 541.8 | −41.9% |
| Miss | 100 | 100 | 770.3 / 997.7 | 521.1 / 601.6 | −39.7% |

Each arm recorded 228 verified origin responses, including 26 primes and two warmups. The runner stopped after the controlled checkpoint. The synchronous cache policy’s complete natural replay is separately recorded for [the earlier build](./room-preview-results.md). The two datasets remain separate.

[Scrubbed per-request results](./room-preview-generation-results.json.gz).
