# Viewer module preload experiment

Preloading the five viewer modules reduced median navigation to a drag-responsive panorama from **7,420.4 ms to 6,707.1 ms** on the mobile profile. All five matched pairs improved. Removing the hints again returned the time to 7,421.5 ms. These are direct-open pilot results. The release comparison also measures click-to-open, warm reopen and cold tails.

| Measurement (ms) | Control | With preload |
| --- | ---: | ---: |
| Hydration | 4,639.8 | 5,563.3 |
| Viewer import duration | 2,145.7 | 105.1 |
| Origin-confirmed rooms | 6,819.7 | 5,898.8 |
| First mobile panorama request | 6,831.2 | 5,910.3 |
| First sphere draw | 7,248.6 | 6,483.8 |
| Navigation to drag-responsive frame | 7,420.4 | 6,707.1 |

Both arms ran one Start build from `a1ff0490bfb1190aa3012be273e080dee7222b3f`, with the same seeded villa, browser, 2048-pixel asset, network and CPU settings. On this route the server emits viewer hints for a single `tour=1` value. A duplicate `tour=1&tour=1` opens the same viewer while omitting the hints. The browser followed the same three sign-in middleware redirects in both arms. The final fixture response contained five viewer hints in the single-value arm and zero in the duplicate-value arm, in both HTML and serialized route data. The HTTP response and early hints contained zero viewer links in both arms.

Chromium fetched all five modules before the import mark in every preload sample. In the control and restored control, it fetched them after the viewer requested the import. Every module transferred once. Both arms confirmed the same active scene and drew a changed frame after a trusted drag. Earlier module transfer delayed room-page hydration while shortening the wait for the viewer import. The median difference in the full interaction was 713.3 ms (9.6%).

The earlier loopback proxy pilot at `66a429bf` produced 12 successful opens but failed to remove the preload from the final browser document after a Clerk redirect. Both arms fetched the modules at parser time. Its 6,725.3 and 6,715.9 ms medians cannot measure the effect.

[Download all 12 observations, document checks and per-chunk transfers](tour-viewer-preload.json.gz).
