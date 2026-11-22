# Warm reopen with the original benchmark driver

The three cohorts used independent revision builds, one seeded local backend, the 390 × 844 touch profile, 4× CPU throttling, 150 ms RTT and 1.6 Mbps down. Open-to-response ends at the first changed panorama frame after a real touch drag. The release ceilings are 6,758.5 ms for the cold direct median and 222.5 ms for the warm reopen median.

Each arm ran 4 groups in rotated order. The table gives medians in milliseconds over successful observations. Every timed failure remains in the archive. These are exploratory comparisons. The release decision requires two 50-group batches on the shipping revision.

| Implementation | Direct | Click | Reopen | Reopen drag | Reopen WebGL ready | Failed |
|---|---:|---:|---:|---:|---:|---:|
| Historical Stage D | 8,141.0 | 3,220.3 | 227.5 | 16.8 | — | 0 |
| Early canvas and direct intro | 6,708.1 | 2,755.1 | 281.1 | 94.5 | 93.7 | 0 |
| Oriented image bitmap | 6,659.4 | 2,775.8 | 274.8 | 93.6 | 111.4 | 0 |
| Linear filtering on bundled 2K | 6,688.7 | 2,700.5 | 245.0 | 59.1 | 94.9 | 0 |
| Bitmap and linear filtering | 6,568.9 | 2,710.1 | 249.3 | 60.6 | 115.3 | 1 |
| Shader warm-up | 6,822.4 | 2,757.3 | 296.8 | 96.4 | 94.1 | 0 |
| Bitmap, linear filtering and shader warm-up | 6,602.0 | 2,687.2 | 241.9 | 60.4 | 106.2 | 0 |

The historical control ran its original Stage D browser driver. The other arms used the unchanged Stage E benchmark, which also checks that the requested panorama is visible, input is unlocked and no previous mount or early neighbor occupies the initial network window. The shader arm here used the original implementation. Its private Three.js program-field access failed typechecking. A subsequent source revision holds the material until close and removes that access.

## Failed observations

- `round3-bitmapLinear` exited 1. direct page.waitForFunction: Timeout 60000ms exceeded.

## Reference image

Each implementation reopened the confirmed living-room scene in a separate browser run. Chromium captured the same 374 × 495 CSS-pixel center region before the trusted drag. PSNR and the number of differing pixels compare the composited images with the control. This comparison covers one pose.

| Implementation | PSNR dB | Differing pixels |
|---|---:|---:|
| Early canvas and direct intro | 120 | 0 |
| Oriented image bitmap | 120 | 0 |
| Linear filtering on bundled 2K | 120 | 0 |
| Bitmap and linear filtering | 120 | 0 |
| Shader warm-up | 120 | 0 |
| Bitmap, linear filtering and shader warm-up | 120 | 0 |

Archive SHA-256 `ef61e048c131d26100d3f057bde0166f50f7a060ab292717439489fe0a62bb60`. [Observations, source diffs and reference images](tour-renderer-comparison-inputs.tar.gz) · [Stage E1](tour-entry-stage-e1.md)
