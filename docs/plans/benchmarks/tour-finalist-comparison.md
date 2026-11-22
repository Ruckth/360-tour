# Warm tour reopen with image reuse and adaptive filtering

The three cohorts used independent revision builds, one seeded local backend, the 390 × 844 touch profile, 4× CPU throttling, 150 ms RTT and 1.6 Mbps down. Open-to-response ends at the first changed panorama frame after a real touch drag. The release ceilings are 6,758.5 ms for the cold direct median and 222.5 ms for the warm reopen median.

Each arm ran 4 groups in rotated order. The table gives medians in milliseconds over successful observations. Every timed failure remains in the archive. These are exploratory comparisons. The release decision requires two 50-group batches on the shipping revision.

| Implementation | Direct | Click | Reopen | Reopen drag | Reopen WebGL ready | Failed |
|---|---:|---:|---:|---:|---:|---:|
| Adaptive filtering | 6,945.5 | 2,838.7 | 246.7 | 59.0 | 94.6 | 0 |
| Decoded image reuse with trilinear filtering | 6,694.6 | 2,797.5 | 240.1 | 95.5 | 88.1 | 0 |
| Decoded image reuse and adaptive filtering | 6,912.9 | 2,767.6 | 197.3 | 57.7 | 97.7 | 0 |

## Reference image

Each implementation reopened the confirmed living-room scene in a separate browser run. Chromium captured the same 374 × 495 CSS-pixel center region before the trusted drag. PSNR and the number of differing pixels compare the composited images with the control. This comparison covers one pose.

| Implementation | PSNR dB | Differing pixels |
|---|---:|---:|
| Adaptive filtering | 120 | 0 |
| Decoded image reuse with trilinear filtering | 120 | 0 |
| Decoded image reuse and adaptive filtering | 120 | 0 |

Archive SHA-256 `39bf55e23cce5bce367598832654d00c70d54d6a1687d6217a4bd4ba219c59c4`. [Observations, source diffs and reference images](tour-finalist-comparison-inputs.tar.gz) · [Stage E1](tour-entry-stage-e1.md)
