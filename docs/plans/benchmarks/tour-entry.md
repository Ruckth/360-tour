# Phase 1 tour-entry baseline

A visitor opening `/rooms/pool-villa?tour=1` waited **8,448 ms** at the median before a touch drag changed the visible panorama. Tapping Explore after room-page load took **3,700 ms**. Reopening in the same tab took **212 ms**. All three begin at the visitor's action. A benchmark hook records the first draw with a changed camera yaw and frame number. A second gesture and a cropped pixel comparison confirm that the displayed image moves.

The harness installs a browser hook before navigation. Room, lazy viewer, live scene, texture and sphere-draw code publish marks only while that hook exists. Native server and Convex collection activates for the isolated loopback integration profile.

## Where the wait occurs

On direct entry, the browser requested the viewer JavaScript after the room's hydration effect. A separate same-build experiment preloaded the two chunks discovered in a control navigation. Across five alternated pairs, the median moved from **8,243 to 6,930 ms**. Removing the preload returned the next observation to **8,176 ms**. The experiment recorded 0 duplicate viewer transfers. Earlier viewer discovery competes with the initial room load. The room hydration mark moved from 4,419 to 5,177 ms while viewer readiness moved from 7,551 to 5,958 ms. Phase 4 will test how early to request these chunks against the full acceptance budget.

| Direct-entry milestone | Median elapsed ms | Median segment ms |
| --- | ---: | ---: |
| room_hydrated | 4,361 | 3,625 |
| viewer_module_ready | 7,426 | 3,062 |
| document_first_byte | 710 | 710 |
| first_panorama_response_end | 8,149 | 332 |
| texture_request_start | 7,818 | 310 |
| changed_frame | 8,448 | 200 |
| first_scene_drawn | 8,223 | 74 |
| viewer_mounted | 7,478 | 48 |
| drag_started | 8,254 | 30 |
| rooms_resolved | 7,503 | 25 |
| viewer_module_start | 4,364 | 3 |
| texture_available | 8,150 | 2 |

The segments are ranked by their median duration. Each sample assigns elapsed time once, in milestone order. Script fetches, other downloads and main-thread work can overlap. The renderer hook measures draw submission. The native trace shows browser image decode, upload and compositing activity, including work on other page images. Use the user-timing marks to inspect the interval for this scene. The screenshot check starts after timing ends.

On direct entry the median number of panorama requests started before the drag was 2. The first-scene 2048 rendition was available while the neighboring pool scene had already started loading in the traced visit. Across the matched direct controls the medians were 1 completed and 1 still in flight. Phase 4 will test deferring that neighboring request until after the first usable frame.

## Matched observations

The first 120 opens all succeeded. Warm-reopen control medians differed by 7.5% between batches, above the 5% noise rule. That series remains inconclusive. The repeat below doubled the number of pairs per batch on the same measured revision and device profile. [Initial report](tour-entry-initial-report.md) · [Initial raw runs](tour-entry-initial-inputs.tar.gz)

| Arm | Entry | Samples | Median ms | p95 ms | Failed opens |
| --- | --- | ---: | ---: | ---: | ---: |
| control | direct | 40 | 8,448 | 8,548 | 0 |
| control | click | 40 | 3,700 | 3,814 | 0 |
| control | reopen | 40 | 212 | 328 | 0 |
| delay1000 | direct | 40 | 9,478 | 9,587 | 0 |
| delay1000 | click | 40 | 3,702 | 3,729 | 0 |
| delay1000 | reopen | 40 | 214 | 333 | 0 |

Both experiment arms measured all three entry paths. The delayed arm held the first panorama request for 1,000 ms on direct entry. Across 40 pairs, texture acquisition moved by 1,003 ms and the responsive frame by 1,060 ms. Click and reopen provide undelayed controls. The linked full report gives their paired differences, batch medians, nearest-rank p95, counts, cache mix and sign tests.

The median server request-to-headers time was 8 ms and browser TTFB was 710 ms. The first is read from the document's Server-Timing header. The second includes navigation and the emulated network. Server cache observations were 36 ssr-hit, 1 ssr-miss, 3 ssr-stale. Sparse cache-miss samples are descriptive. Phase 2 will measure 100 verified hits and 100 verified misses separately on Preview. The raw span file includes observed Convex completion, handler time and database reads alongside cached replies.

## Frozen acceptance budgets

The thresholds below apply to subsequent candidate changes. [Reviewed four-phase plan](../tanstack-bun-performance.html)

| Guard | Requirement under the same profile |
| --- | --- |
| Cold direct-entry median | ≤ 6,758.5 ms, 20% below control |
| Cold direct-entry p95 | ≤ 8,975.5 ms |
| Warm reopen median | ≤ 222.5 ms |
| Failed opens | 0 in each cohort in both batches |
| Database | ≥30% fewer bytes or documents on the selected query, zero additional single-villa documents as unrelated rows grow, and ≤5% regression in write p95 |
| Backend | ≥20% lower p95 on the measured operation across 100 calls, with checkout and inbox p95 within +5% |
| Initial JavaScript | Home and room ≤285 KiB Brotli, editor ≤430 KiB, checkout ≤534 KiB Brotli and ≤546,446 bytes gzip |

The production build passed the existing route-size checks.

| Next route | Initial chunks | Raw bytes | Gzip bytes | Brotli bytes | Locale dictionaries |
| --- | ---: | ---: | ---: | ---: | --- |
| `/[locale]/(home)` | 20 | 1,018,826 | 301,097 | 263,676 | None |
| `/[locale]/rooms/[id]` | 20 | 1,015,484 | 299,394 | 262,173 | None |
| `/admin/checkout` | 34 | 1,810,851 | 540,880 | 472,376 | None |
| `/admin/properties/[id]` | 30 | 1,502,397 | 453,703 | 396,848 | None |

Chromium 148.0.7778.96 used SwiftShader, a 390 × 844 touch viewport, DPR 2, 4× CPU throttle, 150 ms RTT and 1.6 Mbps download. Local Node v22.22.3 ran the production build at `65b85959d132a98ad0c1d9c438486de4a3d74fe9` against an isolated demo-resort seed. Direct and post-load click each use a fresh browser context with the cache disabled. Reopen primes a tab and reuses it. The local server and data cache persist during each matched series.

The historical 3 October fixture timed a click until the controls appeared. Its medians were 6,628 ms cold and 1,860 ms warm. A single smoke run of that same check gave 3,697 ms and 182 ms on the November fixture with a 34,012-byte first mobile panorama. The comparison above uses navigation or trusted tap through a changed frame. [Historical click series](final-tour.json)

## Reproduce

Use the repository's Node 22 worktree setup and dedicated Clerk test configuration. This command builds the app and seeds a private, disposable Convex backend. Choose an empty output directory for each run.

```sh
export VITEST_MAX_WORKERS=2
out="$PWD/output/tour-baseline"
mkdir -p -m 700 "$out"
BENCH_SPANS_OUT="$out/matrix-spans.json" node scripts/heavy.mjs node scripts/local-integration.mjs -- \
  node scripts/bench/tour-entry-pairs.mjs --pairs 20 --out "$out/pairs"
node scripts/bench/tour-entry-report.mjs --runs "$out/pairs" --spans "$out/matrix-spans.json" \
  --json "$out/report.json" --md "$out/report.md"
```

The paired launcher reverses A/B order across pairs and batches. Compare at least 20 observations per arm per cohort across two batches. Re-run if a control median drifts by more than 5%. If the p95 verdict flips between batches, expand to 50 pairs per batch. Performance credit requires the measurable span and visitor-visible result to move together.

Run the diagnostic preload and traces in separate harness invocations so their server spans have distinct run IDs.

```sh
BENCH_SPANS_OUT="$out/viewer-spans.json" node scripts/heavy.mjs node scripts/local-integration.mjs -- \
  env BENCH_VIEWER_PROBE=1 BENCH_RUNS=5 BENCH_VIEWER_OUT="$out/viewer.json" \
  pnpm bench:browser tour-open-interaction --grep 'tour viewer chunk preload experiment'
BENCH_SPANS_OUT="$out/smoke-spans.json" node scripts/heavy.mjs node scripts/local-integration.mjs -- \
  env BENCH_RUNS=1 BENCH_BATCH=smoke BENCH_OUT="$out/smoke.json" \
  BENCH_TRACE_PATH="$out/playwright.zip" BENCH_CHROME_TRACE_PATH="$out/chrome.json" \
  pnpm bench:browser tour-open-interaction --grep 'tour entry to first responsive frame'
node scripts/bench/tour-trace.mjs "$out/chrome.json" "$out/trace.json.gz"
```

The baseline archive contains the original measured JSON and native timing spans. Extract it into an empty directory and run the same reporter against its `pairs/` and `matrix-spans.json`. The downloadable Chromium timeline retains browser event names, timing and tracks. Raw private browser traces stay in the local output directory.

[Full statistical report](tour-entry-report.md) · [Raw observations and server spans](tour-entry-inputs.tar.gz) · [Chromium timeline](tour-entry-trace.json.gz)
