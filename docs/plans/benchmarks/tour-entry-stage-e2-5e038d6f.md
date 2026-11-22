# Stage E2 mobile tour entry on 5e038d6f

The first exact-source run completed 300 of 300 opens, with zero initial-panorama violations. Both batches passed every absolute latency limit. The canonical verdict was **inconclusive** because warm reopen medians spread by 5.2%, above the frozen 5% convergence limit.

| Entry | Frozen Stage A decision limit | Stage D pooled median / p95 | E2 batch 1 median / p95 | E2 batch 2 median / p95 | E2 pooled median / p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct | Median ≤6,758.5 ms and p95 ≤8,975.5 ms | 8,079.00 / 8,173.80 ms | 6,182.75 / 6,431.20 ms | 6,198.40 / 6,355.20 ms | 6,191.20 / 6,401.70 ms |
| Click | Descriptive | 3,092.70 / 3,172.90 ms | 2,727.95 / 2,799.70 ms | 2,758.10 / 2,844.60 ms | 2,735.60 / 2,833.60 ms |
| Reopen | Median ≤222.5 ms | 215.55 / 305.30 ms | 183.65 / 198.30 ms | 193.25 / 205.70 ms | 189.75 / 203.60 ms |

Each batch retained all 50 observations per cohort. The harness completed with exit 0. The shared reporter exited 1 for `noisy-control` on reopen. The release grader exited 2, with no split absolute gates and no sample-integrity issues. The historical [E1 attempt](tour-entry-stage-e1.md) and this first E2 attempt are retained separately.

## Warm convergence

| Warm latency bins | ≤180 ms | >180–190 ms | >190–200 ms | >200–220 ms | >220 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Batch 1 | 12 | 19 | 17 | 2 | 0 |
| Batch 2 | 4 | 16 | 24 | 6 | 0 |

The warm CPU cache marker occurred between the trusted tap and usable frame in 50/50 and 49/50 opens. The unmarked batch 2 group 40 took 211.40 ms and issued no fresh living WebP request. The observed marker frequency offers little separation into hit and miss populations. Warm open to observed usability shifted from 118.75 to 128.50 ms across batches, while trusted drag to changed frame was 56.50 and 56.40 ms. The 9.60 ms endpoint median difference remains a convergence miss.

## Host conditions and fixture

The first measured navigation started at 20:30:45.023 ICT on 22 November 2026. The last changed frame arrived at 21:12:16.815. Eighty-three host snapshots at about 30-second intervals recorded peak outside compute of 16.3%. No observed outside process exceeded 80% CPU. Applying the same neighboring-quiet-window rule used for D and E1 flags zero groups and leaves all results unchanged.

The sealed Start-only revision `5e038d6f7cf573bcd73c6988189baa82577e8a06` ran on macOS ARM64 with Bun 1.4.5, Node 22.22.3, Chromium 148.0.7778.96 and SwiftShader. The touch viewport was 390 × 844 at DPR 2, 4× CPU throttling, 150 ms RTT, 1.6 Mbps down and 750 Kbps up. The demo-resort seed and built living 2048 WebP matched D. The local production server supplied identity HTML and gzip static JavaScript. Each of the 100 new browser processes ran direct, click and reopen in order. Direct and click used separate cold contexts, while reopen primed and reused the same tab. The disposable backend and app persisted across the two batches.

Every cold or click visit completed only the intended living 2048 panorama through its independently observed usable boundary. The reopen guard includes CDP starts and any unfinished transfer from the priming open. The endpoint remains the first trusted drag that changes a rendered expected-room view. The screenshot, context restore, pending-transfer intervention and preload checks are retained [separately](tour-entry-stage-e2-5e038d6f-functional.md).

In pooled observations, direct live confirmation to the first 2048 request was 5.99 ms versus 351.05 ms on D. Direct open to first draw was 6,093.30 ms versus 7,846.40 ms. Warm open to first draw was 109.90 ms versus 176.25 ms. These are integrated series differences across the compared revisions.

## Replay

Extract the timed archive into `output/stage-e-final-5e038d6f-p50` in a worktree at the measured revision. The shared report and canonical verdict replay byte-for-byte with the raw SHA-checked files; the 2×50 inputs and unchanged rule are also captured in the separate replication design.

```sh
out=output/stage-e-final-5e038d6f-p50
node scripts/bench/tour-entry-report.mjs --control-only --runs "$out/runs" \
  --spans "$out/spans.json" --json "$out/report.json" --md "$out/report.md"
node scripts/bench/tour-release-gates.mjs "$out/report.json" "$out/runs"
```

The archive contains the original 100 browser groups, 300 joined backend windows, host snapshots, per-file hashes, statistical and release reports, and sensitivity calculations. Archive SHA-256 `e211a5a614cf6ad42d242b606f608f9a0d266716c98afc7f44581b2ebea0d17b`. [E2 first run inputs](tour-entry-stage-e2-5e038d6f-inputs.tar.gz) · [Final D comparator](tour-entry-stage-d-final.md) · [Frozen thresholds](tour-entry.md)
