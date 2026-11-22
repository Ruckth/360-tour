# Viewer rendering and desktop legibility

On the seeded pool villa, a lost WebGL context restored its panorama before the guest touched the screen. Ten close-and-reopen cycles released all observed GPU texture handles each time. The desktop hotspot retained its world position and rendered at 12 CSS pixels. These are functional checks on `dbb2b2c7`. Mobile entry latency has a separate throttled benchmark.

| Observed behavior | Before | After |
| --- | ---: | ---: |
| Canvas brightness after a context reset, before input, 0–255 | 4.08 after 8 seconds | 114.18, matching the initial image |
| Pool Area label, effective CSS font size | 0.39 px | 11.99 px |
| Hotspot button bounds on screen | 2.99 × 1.62 px | 119.94 × 44 px |
| Hotspot center in the initial desktop image | (766.2, 498.9) | (765.3, 498.9) |

The reset control at `0d0c2ef6` removed the redraw listener from the settled demand-rendered scene. Chromium restored the actual WebGL context, but the canvas remained dark. With the listener, the canvas redrew without input and a browser drag changed the camera yaw. The viewer rendered zero frames during 3.0 seconds of idle observation. It held five texture handles per open and zero after every close, including after the forced loss and recovery. [GPU handle and frame observations](tour-render/candidate/resources.json)

The old hotspot component scaled its HTML button by distance from the camera. The position was correct, but the room's panorama coordinates put the button hundreds of units away. Removing the distance scale preserves the projected position and the CSS dimensions. The 1440 × 900 comparison uses the same seeded scene, a fixed drag toward the pool doorway, desktop font, reduced-motion preference and SwiftShader renderer. The 4096-pixel image loaded first and the 8192-pixel original loaded on request. Across these two detail levels, the corrected button center moved 1.27 px as the camera damping settled. Outside the hotspot and screen-edge controls, the mean absolute channel difference between the before and after images was 0.66 on the entry image and 0.47 at full detail, on a 0–255 scale.

| Desktop reference | Previous scale at `dcf20fec` | Screen-sized label at `dbb2b2c7` |
| --- | --- | --- |
| Initial detail | [Before](tour-render/control/entry.png) | [After](tour-render/candidate/entry.png) |
| Full detail | [Before](tour-render/control/full.png) | [After](tour-render/candidate/full.png) |
| Projected bounds and image hashes | [Before](tour-render/control/desktop.json) | [After](tour-render/candidate/desktop.json) |

The same Start build passed all eight Playwright entries for loading, rendition fallback, retry, a real uploaded panorama, the authenticated hotspot editor and Clerk setup. A fresh browser measured initial emitted JavaScript at 206,751 Brotli bytes on home, 203,497 on the room, 339,818 on the property editor and 420,686 on checkout. Checkout used 485,842 gzip bytes against the 546,446-byte limit. The ordinary room and checkout requested zero renderer chunks. [Browser and build measurements](tour-render/candidate/route-bytes.json)
