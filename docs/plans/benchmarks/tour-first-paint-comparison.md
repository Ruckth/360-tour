# Direct entry and the first panorama transfer

The three cohorts used independent revision builds, one seeded local backend, the 390 × 844 touch profile, 4× CPU throttling, 150 ms RTT and 1.6 Mbps down. Open-to-response ends at the first changed panorama frame after a real touch drag. The release ceilings are 6,758.5 ms for the cold direct median and 222.5 ms for the warm reopen median.

Each arm ran 4 groups in rotated order. The table gives medians in milliseconds over successful observations. Every timed failure remains in the archive. These are exploratory comparisons. The release decision requires two 50-group batches on the shipping revision.

| Implementation | Direct | Click | Reopen | Reopen drag | Reopen WebGL ready | Failed |
|---|---:|---:|---:|---:|---:|---:|
| Direct intro with the covered gallery eager at low priority | 6,724.1 | 2,737.8 | 194.5 | 56.1 | 91.4 | 0 |
| Start gallery after the first panorama draw or early close | 6,243.7 | 2,795.8 | 189.0 | 57.6 | 85.2 | 0 |
| Confirm live rooms and stage the first image during viewer loading | 6,692.5 | 2,662.5 | 189.8 | 56.5 | 87.7 | 0 |
| Confirm live rooms during viewer loading | 6,765.0 | 2,860.8 | 203.7 | 56.8 | 90.5 | 0 |

The four cold opens for the first-draw gallery were 6,587, 6,190, 6,282 and 6,205 ms. Its median improved by 480 ms against the matched eager-gallery control. Warm reopens also met the target. The two watch alternatives added a shared room subscription and offered less cold headroom. The release candidate uses the first-draw gallery and gives the room photo ordinary priority when a guest closes before the panorama draws. The gallery quality setting remains 82. The fixture serves the original 1,200-pixel photo, so these measurements do not predict how much time the 828-pixel hosted optimized asset will save.

The selected pilot used `6ff7008f`. The early-close correction in `5b8a0246` is included in release `649de22d582358c9092e0e7c9e1835ad1af952ea`, tree `ece4ca5b9512bfbe62897f14ea196db797ca6531`. It passed the Sentry and local restore checks. Its opt-in cancellation probe expected a second network request even when the correct image came from the CPU cache. Release `3dbc571ebe5fd25a822b9404fafa7fd048adbc71` updates that single test. Its deployed application, timed workload and budgets are identical.

Archive SHA-256 `69920421ad7bb17d0f990ff62fd4fa04a5885abd11cc3a2137cf8c7abc4e3e48`. [Observations, source diffs and gallery request traces](tour-first-paint-comparison-inputs.tar.gz) · [Stage E1](tour-entry-stage-e1.md)
