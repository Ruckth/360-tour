# Stage C TanStack Start tour-entry baseline

The expanded 300-open measurement on the later integrated revision is the current Stage C control. This record preserves the original 120 opens. [Expanded measurement](tour-entry-start-repeat.md)

The control measures navigation or a trusted tap through the first rendered panorama frame that responds to a trusted drag. The same checks confirm the requested room, frame sequence, camera motion and visible pixel change in both stages. The experiment used two batches of 20 observations per entry path, with a fresh Chromium process per three-path group.

| Entry | Samples | Failed opens | Stage A median ms | Stage C median ms | Stage C p95 ms | Stage C median change |
|---|---:|---:|---:|---:|---:|---:|
| Direct | 40 | 0 | 8,448.1 | 8,185.4 | 11,235.0 | -3.1% |
| Click | 40 | 0 | 3,699.9 | 3,180.1 | 3,774.5 | -14.0% |
| Reopen | 40 | 0 | 211.9 | 241.8 | 912.3 | +14.1% |

| Entry | Batch 1 median / p95 ms | Batch 2 median / p95 ms | Median spread |
|---|---:|---:|---:|
| Direct | 8,174.9 / 8,358.2 | 8,216.8 / 11,235.0 | 0.5% |
| Click | 3,180.1 / 3,615.4 | 3,186.7 / 3,815.4 | 0.2% |
| Reopen | 246.4 / 912.3 | 238.5 / 498.5 | 3.3% |

All three medians converged within the 5% repeated-control rule. The Stage A comparisons remain descriptive because the stages were measured separately, with different framework builds and HTML transfer behavior.

The direct p95 exceeded the frozen 8,975.5 ms ceiling in batch 2. Warm reopen also exceeded the 222.5 ms median ceiling in both batches. The Stage C direct median remains above the planned 6,758.5 ms target. Stage C establishes a control for later work and does not close these performance gates.

The launcher paused between batch 2 groups 10 and 11, from approximately 10:35 to 10:39:46 ICT, after unrelated CPU and browser jobs appeared. The local server remained running. All original observations are included. A sensitivity calculation omitted the two visibly contested groups, batch 2 groups 9 and 10. The resulting 38 direct opens had a median of 8,180.4 ms and the same 11,235.0 ms p95. The warm p95 remained 912.3 ms. Four direct opens exceeded the ceiling. Their longest extra wait came after the live rooms resolved and before the first texture request. The batch disagreement leaves the direct tail unresolved and calls for an expanded quiet repeat before using it as release evidence.

## Stage C direct-entry measurements

| Metric | Median |
|---|---:|
| Browser TTFB | 702.1 ms |
| Native Node request to headers | 5.6 ms |
| Room hydration | 4,658.7 ms |
| Hydration to viewer import start | 1.0 ms |
| Hydration to viewer module ready | 2,122.5 ms |
| Viewer module ready | 6,783.4 ms |
| Panorama requests started before input | 2 |
| Panorama responses completed before input | 1 |
| Panorama requests in flight at input | 1 |

- Main entry transferred 227,683 encoded bytes for 743,349 decoded bytes. Chromium reported gzip.
- Viewer module transferred 4,099 encoded bytes for 12,618 decoded bytes. Chromium reported gzip.
- Renderer transferred 230,361 encoded bytes for 872,298 decoded bytes. Chromium reported gzip.

Direct requests used the same persistent local runtime cache and shared local backend across the two batches. Observed cache states included 32 ssr-hit, 8 ssr-miss. The span file pairs each run ID with its local HTTP, cache and Convex completion windows. Timing the same production query remains a separate server-side measurement.

## Where the slow direct opens waited

| Median milestone | 36 opens within the direct p95 ceiling | 4 opens above the ceiling |
|---|---:|---:|
| Room hydration | 4,652.4 ms | 4,691.1 ms |
| Viewer module ready | 6,776.1 ms | 6,826.1 ms |
| Live rooms resolved | 6,821.6 ms | 6,863.3 ms |
| Live rooms resolved → texture request | 365.8 ms | 3,623.1 ms |
| Texture request → texture available | 643.8 ms | 339.7 ms |
| Texture available → first scene drawn | 83.8 ms | 89.9 ms |
| Trusted drag → changed frame | 212.2 ms | 365.1 ms |

The slow opens waited 2,323.0 to 7,465.7 ms between the live-room mark and the first texture request. None of the 40 direct opens recorded an in-flight same-origin JavaScript request in that interval. Two of the four slow opens had a runtime-cache hit and two had a miss. Three scene completions were cached and the other took 9.8 ms. The extra delay happened after the scene query returned. The existing marks bound the delay but cannot attribute it to canvas initialization or browser scheduling.

In the next profiling run, mark when the viewer commits the canvas, when React Three Fiber creates its context, and when the scene commits. Correlate those marks and the first texture request with the Chromium main-thread and GPU tracks. If the first request is waiting on canvas initialization, test starting only the selected room's validated rendition while the canvas initializes. Reuse that load in the scene and compare the measured gap, direct p95, duplicate transfers and one-current-room request bound. For warm reopens, include context recreation in the same trace. Two slow warm reopens added delay before texture start with no new JavaScript or panorama requests inside the timed window.

## Initial route JavaScript

The manifest sizes are from the same emitted local Start build. Brotli and gzip sizes here use the bundle budget reporter's offline compression settings.

| Start path | Chunks | Raw bytes | Gzip bytes | Brotli bytes |
|---|---:|---:|---:|---:|
| `/` | 21 | 780,215 | 242,313 | 206,363 |
| `/rooms/pool-villa` | 20 | 769,474 | 238,855 | 203,123 |
| `/admin/properties/$id` | 77 | 1,209,355 | 391,899 | 339,227 |
| `/admin/checkout` | 95 | 1,537,640 | 485,075 | 420,120 |

All four route budgets passed. The room omitted the renderer and the server-only canary stayed out of the client.

## Encoding and profile

The raw application base is `ccf2208cc2a2b614b382582f4464219ccbff1a92`. Benchmark commit `53f97020` adds local instrumentation and opt-in asset compression. No image, renderer, preloading, subscription or application changes were applied. The run used Bun 1.4.5, Node 22.22.3, Chromium 148.0.7778.96 with SwiftShader, a 390×844 touch viewport, DPR 2, 4× CPU throttle, 150 ms RTT, 1.6 Mbps download and 750 Kbps upload. The demo-resort room-seed and first-scene 2048 WebP hashes match Stage A exactly.

An uncompressed Nitro diagnostic passed all three entry paths at 21,110.4, 8,007.7 and 586.4 ms with other gates running. Its main entry and canvas transferred 743,349 and 872,298 bytes of JavaScript without compression. The timed Stage C build used Nitro's default-level gzip precompression for static assets to match Stage A's JavaScript encoding. Chromium observed gzip on the main entry, viewer and canvas. Nitro's local HTML response retained identity encoding. The local HTML encoding differs from the deployed response and qualifies the cross-stage comparison.

The Vercel Preview bound to `ccf2208c` served the same content categories with HTTP 200 and negotiated encoding. These were response transfer checks with curl. The shaped browser timing samples came from the local loopback harness. [Vercel deployment dpl_GoqSNQ9YTdaCfdZPQveUtYYLAHgg](https://360-tour-6jz7x436x-rugbykritsakorn-9882s-projects.vercel.app)

| Vercel asset | Identity bytes | Gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| Direct room HTML | 106,896 | 23,148 | 22,683 |
| Main entry | 743,549 | 229,512 | 232,798 |
| Tour viewer | 12,618 | 4,111 | 4,317 |
| Tour canvas | 872,298 | 232,984 | 237,566 |

## Reproduce

Use the repository's worktree setup and dedicated Clerk test configuration. Build and seed one fresh isolated backend through the local integration harness. Use an empty output directory.

```sh
export VITEST_MAX_WORKERS=2
out="$PWD/output/stage-c-matrix"
mkdir -m 700 "$out"
BENCH_SPANS_OUT="$out/spans.json" BENCH_START_WIRE_GZIP=1 \
  node scripts/heavy.mjs node scripts/local-integration.mjs --start -- \
  node scripts/bench/tour-entry-pairs.mjs --control-only --pairs 20 --out "$out/runs"
node scripts/bench/tour-entry-report.mjs --control-only --runs "$out/runs" \
  --spans "$out/spans.json" --json "$out/report.json" --md "$out/report.md"
node scripts/bench/start-route-js-size.mjs --json "$out/route-js.json"
```

The direct p95 repeat uses the same launcher and a new output directory, with 50 independent three-path groups per batch. Reserve approximately 50 minutes of quiet browser time.

```sh
export VITEST_MAX_WORKERS=2
out="$PWD/output/stage-c-repeat-50"
mkdir -m 700 "$out"
BENCH_SPANS_OUT="$out/spans.json" BENCH_START_WIRE_GZIP=1 \
  node scripts/heavy.mjs node scripts/local-integration.mjs --start -- \
  node scripts/bench/tour-entry-pairs.mjs --control-only --pairs 50 --out "$out/runs"
node scripts/bench/tour-entry-report.mjs --control-only --runs "$out/runs" \
  --spans "$out/spans.json" --json "$out/report.json" --md "$out/report.md"
```

[Full statistical report](tour-entry-start-report.md) · [Raw observations and server spans](tour-entry-start-inputs.tar.gz) · [Frozen Stage A baseline](tour-entry.md)
