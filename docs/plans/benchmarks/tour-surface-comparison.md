# Initial canvas sizing and warm reopen

The three cohorts used independent revision builds, one seeded local backend, the 390 × 844 touch profile, 4× CPU throttling, 150 ms RTT and 1.6 Mbps down. Open-to-response ends at the first changed panorama frame after a real touch drag. The release ceilings are 6,758.5 ms for the cold direct median and 222.5 ms for the warm reopen median.

Each arm ran 3 groups in rotated order. The table gives medians in milliseconds over successful observations. Every timed failure remains in the archive. These are exploratory comparisons. The release decision requires two 50-group batches on the shipping revision.

| Implementation | Direct | Click | Reopen | Reopen drag | Reopen WebGL ready | Failed |
|---|---:|---:|---:|---:|---:|---:|
| Early canvas, default observer | 6,575.3 | 2,720.9 | 280.2 | 91.9 | 96.8 | 0 |
| Immediate resize observation | 6,761.3 | 2,872.5 | 264.3 | 97.3 | 89.8 | 0 |
| Immediate observation and root camera | 6,685.4 | 2,951.9 | 264.3 | 93.0 | 91.6 | 0 |
| Immediate observation and early upload | 6,905.5 | 2,997.1 | 287.3 | 54.5 | 142.5 | 0 |
| Immediate observation and shader warm-up | 6,657.6 | 2,965.5 | 282.9 | 96.2 | 87.4 | 0 |
| Immediate observation and 1.25 touch pixel ratio | 6,600.6 | 2,882.4 | 258.5 | 92.4 | 86.1 | 0 |
| Linear filtering on bundled 2K | 6,666.2 | 2,938.2 | 232.1 | 56.1 | 89.3 | 0 |
| Immediate observation and CPU image reuse | 6,681.3 | 2,931.4 | 215.5 | 91.0 | 84.7 | 0 |
| Immediate observation and CPU mip chain | 6,611.4 | 3,006.3 | 229.6 | 93.6 | 86.2 | 0 |

## Reference image

Each implementation reopened the confirmed living-room scene in a separate browser run. Chromium captured the same 374 × 495 CSS-pixel center region before the trusted drag. PSNR and the number of differing pixels compare the composited images with the control. This comparison covers one pose.

| Implementation | PSNR dB | Differing pixels |
|---|---:|---:|
| Early canvas, default observer | 120 | 0 |
| Immediate resize observation | 120 | 0 |
| Immediate observation and root camera | 120 | 0 |
| Immediate observation and early upload | 120 | 0 |
| Immediate observation and shader warm-up | 120 | 0 |
| Immediate observation and 1.25 touch pixel ratio | 59.4307 | 98718 |
| Linear filtering on bundled 2K | 120 | 0 |
| Immediate observation and CPU image reuse | 120 | 0 |
| Immediate observation and CPU mip chain | 120 | 0 |

Archive SHA-256 `7cb48c654eba27dfb15a79248f5e6af5e8d67efb58d7fd5f8ff13614998af8e4`. [Observations, source diffs and reference images](tour-surface-comparison-inputs.tar.gz) · [Stage E1](tour-entry-stage-e1.md)
