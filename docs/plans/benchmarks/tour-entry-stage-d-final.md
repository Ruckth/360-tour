# Stage D mobile benchmark on the per-scene certificate revision

Final Stage D completed **300 of 300 opens**. Both batches passed the cold direct p95 and warm reopen median budgets and missed the 20% cold direct median improvement target. The cold direct median remained close to the retained Start-only Stage C control. The direct-entry gain remains a Stage E gate.

| Entry | Frozen Phase 1 median / p95 ms | Retained C median / p95 ms | Final D median / p95 ms |
|---|---:|---:|---:|
| Direct | 8,448.1 / 8,548.1 | 8,092.0 / 8,336.8 | 8,079.0 / 8,173.8 |
| Click | 3,699.9 / 3,813.6 | 3,075.9 / 3,137.2 | 3,092.7 / 3,172.9 |
| Reopen | 211.9 / 327.9 | 221.1 / 309.8 | 215.6 / 305.3 |

Each entry has 100 opens in D, split into two batches of 50 independently launched browser groups. Medians and nearest-rank p95s below cover all observations.

| Entry | D batch 1 median / p95 ms | D batch 2 median / p95 ms | Frozen verdict |
|---|---:|---:|---|
| Direct | 8,079.3 / 8,117.1 | 8,079.0 / 8,262.4 | Median fails ≤6,758.5. p95 passes ≤8,975.5 in both batches |
| Click | 3,082.6 / 3,161.7 | 3,099.6 / 3,180.3 | Diagnostic |
| Reopen | 216.8 / 311.9 | 215.3 / 304.0 | Median passes ≤222.5 in both batches |
| Failed opens | 0 / 150 | 0 / 150 | Pass |

The two batch medians differed by under 1% for each entry, within the 5% repeatability rule. The original Stage D run on the parent-count revision remains archived. Database read, writer tail and stale-scene correctness use their separate acceptance studies. [Frozen control and gates](tour-entry.md) · [Stage C repeat](tour-entry-start-repeat.md) · [Provisional Stage D](tour-entry-stage-d.md)

## Scene confirmation and first panorama request

| Timing span | C median / p95 ms | Final D median / p95 ms |
|---|---:|---:|
| Direct viewer mount → rooms resolved | 24.5 / 36.8 | 22.2 / 37.2 |
| Click viewer mount → rooms resolved | 28.4 / 36.3 | 26.2 / 37.1 |
| Reopen viewer mount → rooms resolved | 34.1 / 42.2 | 33.8 / 42.9 |
| Direct live confirmation → CDP first 2048 request | 351.4 / 382.8 (resolved effect proxy) | 351.0 / 369.7 |
| Direct hydration → viewer module ready | 2,118.3 / 2,127.0 | 2,129.8 / 2,141.1 |

D starts the confirmation span at the earliest `rooms_update` or `rooms_verified` mark. All 300 opens recorded `rooms_update`. The ordinary fixture recorded zero `rooms_verified` marks. C recorded the later `rooms_resolved` effect. The common mount-to-resolved spans use identical marks. D confirms the roughly 350 ms interval after live confirmation on the same expected `pv-living` scene.

Each open logged one `getTourRooms` completion. Six uncached executions read three documents and 1,779 bytes, returned 395 bytes and ran a 4.2 ms median handler. This is a small uncached sample. The dedicated database benchmark provides its own load-based gate. Every direct or click open began two panorama requests before input. Every reopen began zero.

| Warm reopen drag → changed frame | n | Min / median / p95 / max ms | Above 100 ms |
|---|---:|---:|---:|
| Retained C | 100 | 13.4 / 16.7 / 106.3 / 142.9 | 10 |
| D batch 1 | 50 | 13.3 / 16.6 / 107.7 / 108.6 | 7 |
| D batch 2 | 50 | 14.3 / 17.2 / 121.6 / 126.0 | 5 |
| D pooled | 100 | 13.3 / 16.9 / 107.7 / 126.0 | 12 |

## Host overlap sensitivity

Ninety-two snapshots at approximately 30-second intervals covered the measured window. Two clusters had a single off-harness Node process above 80% CPU, with peaks of 187.3% and 107.5%. A separate T3 local Convex codegen fixture was observed during the first cluster. The second workload was recorded by executable name. The intervals between neighboring quiet snapshots conservatively flag batch 2 groups 16–20 and 26–29. All nine groups remain in the primary results. The slowest direct observation was batch 2 group 18 at 8,454.6 ms. The overlap sample establishes coincidence at observed instants.

| Batch 2 entry | All 50 median / p95 ms | 41 unflagged median / p95 ms |
|---|---:|---:|
| Direct | 8,079.0 / 8,262.4 | 8,073.1 / 8,179.4 |
| Click | 3,099.6 / 3,180.3 | 3,092.2 / 3,152.2 |
| Reopen | 215.3 / 304.0 | 215.1 / 303.5 |

The sensitivity results leave every frozen gate verdict unchanged.

## Source and conditions

Measured exact source `0c1d9d119e2d12709133d57f3f42e3fb0bbc1f9d`. Bun 1.4.5 installed cleanly from the frozen lock `878653941cf07e2d78bf1856d5c6bac12327daaa662fe8af0e4e420ed40af387`. Node was 22.22.3. Chromium was 148.0.7778.96 with SwiftShader on macOS ARM64. The touch profile was 390×844, DPR 2, 4× CPU throttling, 150 ms RTT, 1.6 Mbps down and 750 Kbps up. The production Start harness used opt-in gzip for assets and identity HTML. For the first direct open, the initial entry was 228,178 gzip / 744,495 decoded bytes and the renderer module was 230,377 gzip / 872,327 decoded bytes. Both responses carried `Content-Encoding: gzip`.

The seeded room list and visitor-visible scene matched C and provisional D. The final revision records per-scene certificate metadata and includes the release package layout pins. The seed source hash was `81e19fdf3238ab255ba86ab536fffaad9171b124c7becc7d8110a46786167737`. The built `pool-villa-living-2048.webp` SHA-256 remained `cf031d551093b61886bdcc90741a1bfadc99a4b3029f7eeb3a6e8c807b121fc9`. The first startup attempt built successfully and stopped before opening a browser because the scalar output argument was filtered from its environment. The retry passed the argument positionally. The successful fixture was ready at 13:42:40 ICT. The 300 measured opens ran from 14:07:24 to 14:52:58 ICT on 22 November 2026.

```sh
export VITEST_MAX_WORKERS=2
out="$PWD/output/stage-d-final-0c1d9d11-p50"
mkdir -m 700 "$out"
BENCH_SPANS_OUT="$out/spans.json" BENCH_START_WIRE_GZIP=1 \
  node scripts/heavy.mjs node scripts/local-integration.mjs --start -- \
  node scripts/bench/tour-entry-pairs.mjs --control-only --pairs 50 --out "$out/runs"
node scripts/bench/tour-entry-report.mjs --control-only --runs "$out/runs" \
  --spans "$out/spans.json" --json "$out/report.json" --md "$out/report.md"
```

[Raw inputs and host snapshots](tour-entry-stage-d-final-inputs.tar.gz) · [Statistical report](tour-entry-stage-d-final-report.md) · [Machine-readable gates and overlap distributions](tour-entry-stage-d-final.json)
