# Stage E1 mobile tour entry on Start-only revision 29532306

The candidate completed 300 of 300 visitor opens and passed the independent initial-panorama gate in every cohort. Direct entry and post-load clicks improved over Stage D, while same-tab reopen slowed. Both batches missed the frozen direct and reopen median limits. The direct p95 passed in batch 1 and missed in batch 2, which overlapped unrelated local work. The canonical release verdict is `inconclusive`.

## Frozen budgets

| Entry | Frozen Stage A decision limit | Stage D pooled median / p95 | E1 batch 1 median / p95 | E1 batch 2 median / p95 | E1 pooled median / p95 |
| --- | --- | ---: | ---: | ---: | ---: |
| Direct | Median ≤6,758.5 ms and p95 ≤8,975.5 ms | 8,079.0 / 8,173.8 ms | 6,894.45 / 7,169.70 ms | 6,914.80 / 10,085.60 ms | 6,897.00 / 7,510.30 ms |
| Click | Descriptive | 3,092.7 / 3,172.9 ms | 2,786.60 / 2,868.30 ms | 2,797.30 / 2,861.80 ms | 2,791.40 / 2,861.80 ms |
| Reopen | Median ≤222.5 ms | 215.55 / 305.30 ms | 342.65 / 362.50 ms | 340.10 / 398.30 ms | 341.75 / 380.30 ms |

Each batch has 50 observations in each entry cohort. Both batches passed the zero-failure requirement. The direct median improved by 14.63% from D and 18.36% from Stage A. It remained 138.50 ms above its frozen limit in the pooled report. The click median improved by 9.74% from D. The reopen median rose by 58.55% from D and exceeded its limit by 119.25 ms pooled. The harness completed with exit 0. The release grader exited 2 for the split direct p95 verdict and recorded zero sample-integrity issues.

## Host overlap sensitivity

The first measured navigation started at 17:19:34.913 ICT on 22 November 2026. The last changed frame arrived at 18:03:07.694. The 87 host snapshots were spaced about 30 seconds apart. Batch 1 had no observed competing compute process above 80%. In batch 2, unrelated work registered up to 593.9% combined outside compute, with one observed outside process above 80% at a time.

The same conservative method used for D flags browser group intervals that intersect a contiguous cluster of snapshots with an outside process above 80%, bounded by the previous and next snapshots without such a process. It flags batch 2 groups 29–33 and 39–43. The archive keeps all rows and all host snapshots, including intervals when several workers were individually below 80%.

| Batch 2 entry | All 50 median / p95 | 40 unflagged median / p95 |
| --- | ---: | ---: |
| Direct | 6,914.80 / 10,085.60 ms | 6,890.40 / 7,389.40 ms |
| Click | 2,797.30 / 2,861.80 ms | 2,787.05 / 2,830.60 ms |
| Reopen | 340.10 / 398.30 ms | 338.60 / 374.00 ms |

The unflagged batch 2 direct tail falls inside its budget and both median misses persist. The quiet first batch also missed the two medians. The sensitivity subset is descriptive and the full two-batch series determines the archived verdict.

## First correct panorama and working drag

Every cold direct or click visit began and completed exactly the seeded living 2048 WebP through the independently observed usable boundary. Warm reopen used the primed rendition without an old transfer crossing the next open. The cutoff precedes the trusted drag and requires a visible, hit-testable canvas, confirmed live data, ready/unlocked state and the expected displayed room. CDP retains pending request starts as well as completed resources. The measured endpoint stays the first new expected-room frame that follows trusted touch input and changes camera yaw. A separate drag confirms visible pixel movement after timing.

| Timing span | Stage D pooled median | E1 pooled median |
| --- | ---: | ---: |
| Direct live confirmation → first current 2048 request | 351.05 ms | 8.99 ms |
| Direct current request → response end | 642.53 ms | 492.57 ms |
| Direct open → first sphere draw | 7,846.40 ms | 6,641.35 ms |
| Reopen open → first sphere draw | 176.25 ms | 179.15 ms |
| Reopen trusted drag → changed frame | 16.90 ms | 130.05 ms |

The warm delay is concentrated after input in this comparison. E1 measures the integrated source, so the timing cannot assign that delay to any individual change. An independent functional run on `fb683213ec3b1e642f099f5f068b2ddb212a3398` passed all three cutoff/pixel/drag visits, native pending-transfer cancellation 35.32 ms before reopen, context restore, eleven texture-handle checks, desktop screenshot and anchor checks, and four SSR preload probe arms. The diff to E1 changes the runbook, deployment validation, dev CLI and tests. Browser source and lockfile are identical. This functional archive remains separate from the 300 release outcomes.

## Provenance and replay

E1 used the sealed Start-only source `295323064cf4b6f5fb30595ae2129f17c3ffdaca` on macOS ARM64. It used local Bun 1.4.5, Node 22.22.3 and Chromium 148.0.7778.96 with SwiftShader. The screen was 390 × 844 with touch, DPR 2, 4× CPU throttling, 150 ms RTT, 1.6 Mbps down and 750 Kbps up. The two batches used the same production Start wire settings as D, with gzip static JavaScript and identity HTML. The matched D raw profile differs only in source revision and the retirement lockfile hash. The scene seed and built first WebP SHA-256 match.

A new Chromium process ran direct, click and reopen in that order for each group. Direct and click used separate fresh cold contexts. Reopen primed, closed and reopened within one cache-enabled tab. The same isolated backend and app server persisted throughout the series. The timed harness used no pixel screenshot insertion, preload intervention, trace or imposed image delay. The three previous ready attempts on `ba9b91ad`, `fb683213` and `c4f26bd5` were stopped unreleased as the retirement source changed. Each retained zero samples.

Extract the timed archive into `output/stage-e-final-29532306-p50` in a worktree at the measured revision. The shared reporter reproduces the statistical report and the canonical CLI applies frozen budgets to its raw SHA-checked inputs.

```sh
out=output/stage-e-final-29532306-p50
node scripts/bench/tour-entry-report.mjs --control-only --runs "$out/runs" \
  --spans "$out/spans.json" --json "$out/report.json" --md "$out/report.md"
node scripts/bench/tour-release-gates.mjs "$out/report.json" "$out/runs"
```

The archive carries the original 100 browser groups, 300 joined backend windows, host observations, file hashes, source labels, reports and overlap calculations. Report paths are normalized to the portable extraction layout. The statistical and gate reports replay byte-for-byte with that layout, and each member hash was verified after extraction. Timed archive SHA-256 `06012d08b5677435fbbf19c5f9f897ff4f3722b873b74bb69019a9096f04fb22`. Functional archive SHA-256 `18bd8e45a5715bae6f1aa748914c0955ee0f16dada5a2aba8861f0d99ff29e00`. [E1 timed inputs](tour-entry-stage-e1-inputs.tar.gz) · [Code-equivalent functional preflight](tour-entry-stage-e1-functional-inputs.tar.gz) · [Final D comparison](tour-entry-stage-d-final.md) · [Frozen Stage A budgets](tour-entry.md)
