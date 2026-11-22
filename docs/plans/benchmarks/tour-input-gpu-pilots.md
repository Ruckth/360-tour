# Mobile tour input and initial WebGL work

Four matched observations per implementation separated the delay before the first camera movement from time spent drawing the changed panorama. The driver recorded each trusted pointer event and the send and acknowledgement time of each browser command. All source variants used fresh browser contexts and the same loopback fixture. Source diffs and individual observations are archived below.

| Warm reopen implementation | Median response ms | Drag to changed frame ms |
|---|---:|---:|
| Presentation and module-loader candidate | 309.7 | 89.8 |
| Initialize the empty canvas during room verification | 277.1 | 73.3 |
| Avoid the hotspot backdrop filter | 299.5 | 91.3 |
| Avoid all tour-control backdrop filters | 295.6 | 91.0 |
| Disable speculative downloads (diagnostic) | 321.7 | 93.2 |
| Opaque WebGL surface | 333.1 | 89.8 |
| Desynchronized opaque WebGL surface | 346.0 | 89.0 |
| Stage D source under the newer observer | 316.4 | 123.6 |

The incoming move had a browser timestamp within a few milliseconds of touch start. On a traced run of the candidate, Chrome received the move at +0.8 ms, its compositor handled it at +44.3 ms, and the renderer dispatched it at +48.6 ms. A 93.4 ms WebGL command-buffer task overlapped this interval. The trace does not identify a single command inside that GPU batch. The four Stage D comparisons started another panorama before the stricter usable boundary and are diagnostic controls.

| Texture and image-loading experiment | Direct median ms | Reopen median ms | Warm drag to changed frame ms |
|---|---:|---:|---:|
| Control | 6858.0 | 313.5 | 94.7 |
| SSR tour intro and lower gallery priority | 6582.2 | 309.6 | 93.1 |
| Wait for browser image decoding | — | 313.1 | 88.7 |
| Linear minification on the bundled 2048 panorama | — | 289.5 | 52.1 |
| Release the previous detached WebGL context immediately | — | 333.2 | 121.2 |

On the control, one instrumented GPU run recorded 36.1 ms in the renderer’s base-level texture upload. In a separate paired run, linear minification removed GPU mipmap generation and shortened delivery of the first movement. This experiment did not establish visual equivalence across viewports. The release budgets still require full batches on the selected source. The added DOM instrumentation and the shorter warm-only process differ from the historical full driver.

The protected Preview delivered a 32,757-byte AVIF for the gallery photo. The local fixture transfers approximately 220,204 bytes. The SSR intro changes which content is visible before hydration and presents a link to close it while the viewer loads.

Archive SHA-256 `16e525dd9d870950b613da7a81047f3f8ecc5cee3eb1901b479875f4be68ed73`. [Individual observations and source diffs](tour-input-gpu-pilots.tar.gz) · [Presentation and loader comparison](tour-response-pilot.md)
