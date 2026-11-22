# Stage E2 matched replication on 5e038d6f

The independent replication passed the canonical mobile tour release gate on exact `5e038d6f7cf573bcd73c6988189baa82577e8a06`. Both batches passed the frozen absolute budgets and the 5% convergence rule. All 300 opens completed with zero initial-panorama violations. The first exact run remains inconclusive on warm convergence. Each study was graded on its own batches under the same rule. [First study](tour-entry-stage-e2-5e038d6f.md) · [Pre-sampling design](tour-entry-stage-e2-5e038d6f-replication-design.md)

| Entry | Frozen limit | Replication batch 1 median / p95 | Replication batch 2 median / p95 | Replication pooled median / p95 |
| --- | --- | ---: | ---: | ---: |
| Direct | Median ≤6,758.5 ms and p95 ≤8,975.5 ms | 6,193.10 / 6,291.30 ms | 6,192.35 / 6,259.50 ms | 6,192.95 / 6,286.80 ms |
| Click | Descriptive | 2,752.10 / 2,793.10 ms | 2,761.65 / 2,833.80 ms | 2,758.05 / 2,803.90 ms |
| Reopen | Median ≤222.5 ms | 183.70 / 198.00 ms | 189.00 / 198.40 ms | 185.85 / 198.10 ms |

The two batch tails use nearest rank. Each cohort contains exactly 50 opens per batch. The pooled row also uses nearest rank and reports a descriptive distribution for the replication. The harness, shared report and release grader all exited 0. Direct median spread was 0.01%, click 0.35% and reopen 2.9%.

## Warm behavior across both studies

The table preserves all four batch medians and warm distributions. A hit counts only if the CPU cache marker appears after the trusted tap and through the observed usable boundary.

| Study and batch | Median / p95 | Fresh CPU marks | ≤180 ms | >180–190 ms | >190–200 ms | >200–220 ms | >220 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| First, batch 1 | 183.65 / 198.30 ms | 50/50 | 12 | 19 | 17 | 2 | 0 |
| First, batch 2 | 193.25 / 205.70 ms | 49/50 | 4 | 16 | 24 | 6 | 0 |
| Replication, batch 1 | 183.70 / 198.00 ms | 50/50 | 8 | 26 | 16 | 0 | 0 |
| Replication, batch 2 | 189.00 / 198.40 ms | 50/50 | 6 | 24 | 19 | 1 | 0 |

The first study's warm spread was 5.2%. Its only unmarked warm open issued no fresh living panorama request. Across the first study, median warm usable latency shifted 118.75 to 128.50 ms, while median trusted drag to changed frame remained 56.50 and 56.40 ms. In the replication, median usable latency shifted 118.20 to 122.00 ms and the drag span measured 56.45 and 55.80 ms. The cache marker offers too few unmarked opens to establish a cache-miss population. The replicated first-frame gain is observable alongside some between-batch movement in the pre-input interval.

## Exact conditions

The replication used a fresh isolated production Start build and local Convex seed under the same exact SHA, Bun 1.4.5, Node 22.22.3, Chromium 148.0.7778.96 and SwiftShader. Each new browser group measured direct, click and reopen in that fixed order. Browser cache disabled for direct/click and same-tab priming for reopen matched the first run. The server, seeded room and 2048 asset, gzip static JS, identity HTML, mobile device, CPU and network shaping matched the original plan. Each visitor endpoint remained a rendered expected-room frame changed by trusted touch. The browser evaluated the independent visible/interactive boundary separately and recorded pending requests. No diagnostic intervention ran in the scored fixture.

The browser navigation began at 21:15:00.313 ICT on 22 November 2026. The last changed frame arrived at 21:56:31.241. Eighty-three host snapshots recorded at most 17.7% outside compute and no outside process above 80% CPU. Stage D's neighboring-quiet-window sensitivity flags zero groups. All latency and correctness results therefore include every collected row. These snapshots describe the observed machine state at the sampled instants.

For comparison with Stage D, median direct confirmation to the initial 2048 request was 6.00 ms in the replication versus 351.05 ms on D. Direct open to first panorama draw was 6,097.80 versus 7,846.40 ms. Warm open to first draw was 107.65 versus 176.25 ms. These integrated spans do not isolate any single source change. [Final D baseline](tour-entry-stage-d-final.md) · [Exact E2 functional evidence](tour-entry-stage-e2-5e038d6f-functional.md) · [Paired quality record](tour-quality-33cc45f1.md)

## Replay

Extract the archive into `output/stage-e-final-5e038d6f-p50-replication` in a worktree at the measured revision. The raw report, gate and host-overlap summary replayed byte-for-byte. The archive retains all 100 groups, 300 server windows, host snapshots, hashes and reports.

```sh
out=output/stage-e-final-5e038d6f-p50-replication
node scripts/bench/tour-entry-report.mjs --control-only --runs "$out/runs" \
  --spans "$out/spans.json" --json "$out/report.json" --md "$out/report.md"
node scripts/bench/tour-release-gates.mjs "$out/report.json" "$out/runs"
```

Archive SHA-256 `0c95d3fd2b991e711f78506ee4f9542975d3d85205f277feb03d183e12a0188d`. [Replication inputs](tour-entry-stage-e2-5e038d6f-replication-inputs.tar.gz)
