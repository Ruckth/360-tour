# Stage E functional pilot

The Start-only pilot opened the seeded pool villa on a direct URL, a room-page tap and a same-tab reopen. Each open showed the confirmed living panorama, passed the independent canvas usability check, and responded to a trusted touch drag. The forced pending-neighbor case verified a browser cancellation before the next trusted open. All functional commands exited 0 on provisional revision `25ce96839892171601db13b1b4842a7898f9eb5f`.

## Mobile image and input

The in-page usability observation requires the intended room to be requested, shown and drawn, with current data confirmed and the viewer ready and unlocked. The canvas must be visible through its ancestor chain and receive the actual drag-point hit test. This observation uses the page's performance clock. CDP supplies request starts and terminal events. A started request can count at the cutoff even while its response is pending.

| Entry | Open to observed usability | First rendition through cutoff | Neighbor start after cutoff | Bright center pixels | Screenshot upper-bound delay after cutoff |
| --- | ---: | --- | ---: | ---: | ---: |
| Direct | 6,884.6 ms | Living 2048 WebP | 14.9 ms | 100% | 644.1 ms |
| Click | 2,653.3 ms | Living 2048 WebP | 10.3 ms | 100% | 192.4 ms |
| Reopen | 202.5 ms | Living 2048 from the same-tab warm path | 13.6 ms | 100% | 170.5 ms |

Each screenshot was requested after the observed usable boundary and captured before the trusted drag. Its recorded time bounds capture completion. The image matched `pv-living` on the draw before input and the changed frame after input. A second drag changed the composited pixels. The added screenshot work and concurrent functional jobs make these diagnostic timings ineligible for the frozen Stage E latency gates.

The forced-transfer probe throttled only the pool 2048 WebP to 1,024 bytes/s. It received HTTP 200 and was still pending when the first viewer closed. Chromium reported `Network.loadingFailed` with `canceled: true` and `net::ERR_ABORTED` 30.46 ms before the second trusted tap. Neither open sent a second living 2048 request, counting all CDP starts including aborted starts. The same-tab reopen drew the expected room with no previous neighbor transfer pending.

## Render and desktop checks

The SwiftShader viewer drew zero frames while idle for 3,011.4 ms. After real WebGL context loss and restoration, its canvas returned to the original mean brightness of 114.179 before input. The following drag moved the camera. Each of the eleven visits, including the original and ten reopens, held five observed GPU texture handles while open and zero after close.

At 1440 × 900, desktop loaded the 4096 WebP first and the master on explicit request. The Pool Area hotspot stayed about 119.94 × 44 CSS pixels with an 11.99 px effective font size. Its projected center moved 1.50 px between the two detail levels. The original screenshots and their recorded hashes are in the archive.

## Source and evidence

The isolated production Start harness used Bun 1.4.5, Node 22.22.3, Chromium 148.0.7778.96 with SwiftShader, gzip static JavaScript and identity HTML. The shaped mobile context used 390 × 844, touch, DPR 2, 4× CPU throttle, 150 ms RTT, 1.6 Mbps down and 750 Kbps up. The demo-resort scene fixture and the built living 2048 asset matched D. The built asset SHA-256 is `cf031d551093b61886bdcc90741a1bfadc99a4b3029f7eeb3a6e8c807b121fc9`.

The three browser outcomes join to server span windows by exact run ID. Each window records one `catalog/properties:getTourRooms` completion. The direct window records a successful room document and an SSR villa cache hit with no recovery. In this diagnostic open, the first living 2048 request began 12.25 ms after live-room confirmation. The final 100-group D baseline had a 351.05 ms median for that span. The pilot did not estimate a series-wide speedup.

The archive includes raw pixel and request observations, browser cancellation, matching backend windows, GPU counters, desktop screenshots and hashes, and exit codes. It excludes private fixture logs and authentication data. SHA-256 `89f60ef26249a50f62ceba5ae5a465e59be9146c4cea842e1a7248c41ecc17fa`. [Functional pilot archive](tour-entry-stage-e-functional-inputs.tar.gz) · [Frozen budgets](tour-entry.md)
