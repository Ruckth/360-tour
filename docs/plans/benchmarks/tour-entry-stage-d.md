# Stage D mobile benchmark on the provisional parent-count revision

Revision `b32967478940a440f4cdebc8480a8b2ce11e83e0` completed **120 of 120 opens** on the shaped mobile profile. Cold direct p95 passed in both batches. The direct median exceeded its frozen target. Warm reopen's pooled median passed, but batch 1 exceeded the warm limit by 1.0 ms. This measurement covers the provisional parent-count implementation. The final per-scene marker implementation requires a separate run.

| Entry | Frozen Phase 1 median / p95 ms | Retained Stage C median / p95 ms | Provisional Stage D median / p95 ms |
|---|---:|---:|---:|
| Direct | 8,448.1 / 8,548.1 | 8,092.0 / 8,336.8 | 8,089.2 / 8,199.3 |
| Click | 3,699.9 / 3,813.6 | 3,075.9 / 3,137.2 | 3,102.4 / 3,151.5 |
| Reopen | 211.9 / 327.9 | 221.1 / 309.8 | 222.2 / 319.4 |

| Entry | D batch 1 median / p95 ms | D batch 2 median / p95 ms | Median spread |
|---|---:|---:|---:|
| Direct | 8,085.5 / 8,199.3 | 8,094.0 / 8,193.2 | 0.1% |
| Click | 3,093.5 / 3,151.3 | 3,107.4 / 3,151.5 | 0.4% |
| Reopen | 223.5 / 320.9 | 221.6 / 287.0 | 0.9% |

Both batches exceeded the 6,758.5 ms direct median target and met the 8,975.5 ms direct p95 ceiling. Only batch 2 met the 222.5 ms warm median ceiling. The frozen expansion rule applies to a split direct p95 verdict. This run's split was on the warm median, so the final-source run will use 50 groups per batch to give that boundary more observations.

The retained C control contains 100 opens per path and D contains 40. Using the first 20 groups of each C batch as a size-matched sensitivity check gives C medians of 8,095.3 ms direct, 3,084.8 ms click and 218.3 ms reopen. Neither comparison establishes a visitor-visible gain from D. Both source revisions retain separate distributions.

## Fresh scene confirmation and first texture request

| Timing span | C median / p95 ms | D median / p95 ms |
|---|---:|---:|
| Direct viewer mount → rooms resolved | 24.5 / 36.8 | 23.4 / 34.4 |
| Click viewer mount → rooms resolved | 28.4 / 36.3 | 23.6 / 34.4 |
| Reopen viewer mount → rooms resolved | 34.1 / 42.2 | 32.8 / 42.7 |
| Direct confirmation → CDP first seeded 2048 request | 351.4 / 382.8 | 355.9 / 371.1 |
| Direct hydration → viewer ready | 2,118.3 / 2,127.0 | 2,132.8 / 2,141.0 |

D measures confirmation from the earliest `rooms_update` or `rooms_verified` mark to the CDP start of the first request for `pool-villa-living-2048.webp`. All 120 normal-path opens recorded `rooms_update`. The held snapshot verification branch recorded zero marks. C uses the later `rooms_resolved` effect as a proxy. Use the common mount-to-resolved span for a comparison with identical browser marks.

Each open recorded one `getTourRooms` completion. The three uncached D direct executions read three documents and 1,757 bytes, with a 4.2 ms median handler time. The five uncached C direct executions read three documents and 1,733 bytes, with a 3.6 ms median handler time. The scene sample is deliberately small. Use the separate database load study to judge read budgets. Every direct and click open started two panorama requests before input in both revisions. Reopen started zero.

## Reopen drag-to-frame

| Sample | n | Min / median / p95 / max ms | Above 100 ms |
|---|---:|---:|---:|
| Retained C | 100 | 13.4 / 16.7 / 106.3 / 142.9 | 10 |
| D batch 1 | 20 | 15.4 / 17.4 / 112.0 / 144.1 | 5 |
| D batch 2 | 20 | 13.3 / 17.0 / 106.6 / 106.8 | 2 |
| D pooled | 40 | 13.3 / 17.0 / 107.2 / 144.1 | 7 |

## Inputs and run conditions

Bun 1.4.5, Node 22.22.3, Chromium 148.0.7778.96 with SwiftShader and the C lockfile matched. The 390×844 touch viewport used DPR 2, 4× CPU throttling, 150 ms RTT, 1.6 Mbps down and 750 Kbps up. The build used production Start and opt-in gzip for static assets. The local HTML response retained identity encoding.

The demo-resort scene rows SHA-256 was `0a3ee6becb9d826b29ede6e50f1ec92e681fe6eb8ca6923e73014542070ec4b6` in both sources. The full D seed-source hash differs because it initializes the parent scene-count metadata. The actual built first WebP SHA-256 matched C at `cf031d551093b61886bdcc90741a1bfadc99a4b3029f7eeb3a6e8c807b121fc9`.

The isolated backend and Start build finished at 12:49:20 ICT. Collection waited for the machine hold to release. The first timed navigation began at 12:50:19 and the final changed frame arrived at 13:08:35 on 22 November 2026. Thirty-six host snapshots from 12:50:39 through 13:08:11 showed outside compute at most 101.1% CPU and at most one outside process above 80% at a sampled instant. The snapshots cover observed instants. All 120 opens and server windows are in the archive.

[Statistical report](tour-entry-stage-d-report.md) · [Raw inputs and host snapshots](tour-entry-stage-d-inputs.tar.gz) · [Retained Stage C](tour-entry-start-repeat.md) · [Frozen Phase 1 budgets](tour-entry.md)
