# Expanded Stage C tour-entry baseline

The expanded run on integrated revision `716c40e1df7251a96dc256c1e3b3b6977b8d7b1c` completed 300 opens with zero failures. Both batches passed the frozen direct p95 ceiling. Warm reopen passed narrowly, with 0.2 ms to spare in batch 1. Direct median remained **8,092.0 ms**, above the **6,758.5 ms** target. Use this result as the Stage C control for Phase 4.

| Entry | Frozen Phase 1 median / p95 ms | Original Stage C median / p95 ms | Expanded Stage C median / p95 ms |
|---|---:|---:|---:|
| Direct | 8,448.1 / 8,548.1 | 8,185.4 / 11,235.0 | 8,092.0 / 8,336.8 |
| Click | 3,699.9 / 3,813.6 | 3,180.1 / 3,774.5 | 3,075.9 / 3,137.2 |
| Reopen | 211.9 / 327.9 | 241.8 / 912.3 | 221.1 / 309.8 |

The earlier runs each recorded 40 observations per path. The expanded run recorded 100 per path. The medians moved by −4.2%, −16.9% and +4.3% respectively from Phase 1 to the expanded run. Each revision retains its own observations and distributions. The application revision and ambient host load changed between Stage C measurements, so these comparisons do not isolate an application change.

| Entry | Original batch 1 median / p95 ms | Original batch 2 median / p95 ms | Expanded batch 1 median / p95 ms | Expanded batch 2 median / p95 ms |
|---|---:|---:|---:|---:|
| Direct | 8,174.9 / 8,358.2 | 8,216.8 / 11,235.0 | 8,091.4 / 8,327.6 | 8,092.0 / 8,581.9 |
| Click | 3,180.1 / 3,615.4 | 3,186.7 / 3,815.4 | 3,085.8 / 3,146.4 | 3,067.6 / 3,137.2 |
| Reopen | 246.4 / 912.3 | 238.5 / 498.5 | 222.3 / 314.4 | 215.6 / 287.7 |

The original Stage C direct p95 crossed the 8,975.5 ms ceiling only in its second batch. The expanded measurement's slowest direct open was 8,704.4 ms. Expanded batch median spreads were below 0.1% for direct, 0.6% for click and 3.1% for reopen. Warm reopen passed the 222.5 ms median ceiling in both batches, with only 0.2 ms of headroom in batch 1.

## Timing evidence

Direct room hydration took 4,627.3 ms at the median. The viewer import started a median 0.8 ms later and the viewer module was ready 2,118.3 ms after hydration. From the live rooms resolving to the first texture request, the median was 346.6 ms, p95 was 377.8 ms and the maximum was 578.1 ms. The original run's four slow direct opens spent 2,323.0–7,465.7 ms in that interval. The longer delay did not recur in this run.

Median browser TTFB was 699.6 ms. Native Node request-to-headers time was 4.2 ms. The direct SSR windows logged 86 cache hits and 14 stale responses. The archive joins all 300 server windows to their browser run IDs.

The fixture kept the same active villa throughout collection. Later cache changes through `86a3b5cd` added ordering checks for edits, archives, competing fills and outage recovery. For a resident positive entry with unchanged origin content, both revisions use the same two parallel generation lookups and data lookup and return the cached response. Stale entries refresh in the background. The guest renderer, assets and mobile harness are identical across these two revisions. The times above belong to the measured revision. Hosted tests separately exercised the newer cache paths. [Hosted cache acceptance](start-villa-preview-outage/swr/attempt6-86a3b5cd-passed.json)

## Profile and host observations

The run used two batches of 50 three-path groups. Each group started a fresh Chromium process. Chromium 148.0.7778.96, SwiftShader, Node 22.22.3, the Bun lock, demo-resort scene seed, and first 2048 WebP matched the original Stage C measurement. The viewport was 390×844 with touch and DPR 2, 4× CPU throttling, 150 ms RTT, and 1.6 Mbps download. The candidate includes the audited stale-while-revalidate cache and uses the normal room navigation path.

The local Start server used benchmark-only gzip for static assets. The main entry, viewer and canvas transferred 228,090, 4,109 and 230,361 encoded bytes for 744,327, 12,618 and 872,298 decoded bytes. The median direct HTML body was 102,318 bytes with identity encoding. Use the archived local result for Phase 4 comparison on the same profile.

The measured opens ran from 11:25:01 to 12:10:49 ICT on 22 November 2026. The original Stage C run included a pause after competing jobs appeared. Its observations remain in the original archive. For this repeat, 72 host snapshots taken at approximately 30-second intervals cover the run from group 22 onward. The selected compute processes outside the benchmark tree peaked at 155.4% CPU, with at most one above 80% at any sampled instant. Spotlight reached 187.4%. These snapshots did not show the sustained multi-core overlap seen in the original run. They cannot establish load between samples or before monitoring began. All 300 observations are included.

## Replay

Extract the expanded input archive into an empty directory. Run the versioned reporter from the repository with that directory's paths.

```sh
node scripts/bench/tour-entry-report.mjs --control-only \
  --runs <extracted-directory>/runs --spans <extracted-directory>/spans.json
```

[Expanded statistical report](tour-entry-start-repeat-report.md) · [Raw run inputs and host observations](tour-entry-start-repeat-inputs.tar.gz) · [Original Stage C report](tour-entry-start.md) · [Frozen Phase 1 budgets](tour-entry.md)
