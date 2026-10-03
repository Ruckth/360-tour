# Codebase optimization implementation

Implemented on 3 October 2026 using Kiro CLI (`claude-opus-5.5`, high effort), followed by independent Standards and Spec audits and regression fixes. The initial baseline was `ae5c123`; the final branch also incorporates `abe7717` from `main`, preserving the newer Luna default, optional Sol response validation, and optional guest details for manual service bookings. See [the plan](./codebase-optimization.md) and [the audit](./codebase-optimization-audit.md).

## Resulting behavior

- Saved-answer and curated Q&A readers/writers remain permanently retired. Authenticated legacy writers refuse changes; queued translation, generation, and deletion workers cannot recreate or delete historical archives. Business facts now have an authenticated editor, approval/status controls, property scope, and validation. Missing-information review resolves against an approved fact or structured source; Resolve, Ignore, and Reopen share a 100-row transaction budget, bounded Undo IDs, honest remaining-count metadata, and a Run again action. Property scope is applied in the index before bounding reads.
- Client modules consume the active locale's messages. Server localization loads dictionaries separately; importing pure formatting helpers no longer imports all 11 dictionaries. Optional chat loads on launcher intent/activation, with a usable `/chat` link and preserved property context. Locale, PDF, keyboard, routing, and booking behavior remain covered.
- Tours load the current panorama before prefetching likely neighbors, with two prefetch slots and a five-texture default cache. One completion owner installs/disposes a load; live claims survive prefetch promotion, and teardown epochs isolate late results. Requested, shown, and outgoing rooms are tracked separately. The outgoing panorama stays pinned during loading/failure, navigation locks until readiness, and the full crossfade runs under demand rendering. Retry and reopen work. Reduced-motion guests receive a stationary poster, including preference changes while the page is open; constrained connections avoid video downloads.
- LINE, Facebook, Instagram, and WhatsApp share the typed resolver. Adapters retain signature checks, event claims, deduplication, staff takeover, reply windows, delivery, and server capabilities. The 22-second outer deadline covers preliminary lookup and generation; an expired lookup cannot launch a late booking action. Already-started late results are recorded without another delivery. A random turn ID correlates claim, model/tools, and delivery without logging guest text or credentials. AI-unavailable replies use channel-appropriate booking navigation and record unsupported policy questions for review.
- Chat cache, keyboard measurement, heartbeat, browser handoff, and transport recovery have internal modules. The public hook uses a lifecycle token for restart/unmount, clears pending recovery and keyboard waits, unsubscribes watches, and rejects late storage/navigation/state updates. Hidden tabs stop heartbeats and resume immediately. Presence-only writes are throttled only where the existing sort/online semantics permit it; message-less sessions and changed context still write. Calendar event transformations have a shared tested helper; vendor components remain scoped.
- Validation includes all application entrypoints plus separate test/script and Convex typechecks. Playwright uses a disconnected demo server, never `convex dev`; disabled credentials are explicit empty overrides so dotenv cannot restore them. A demo-build stamp binds reuse to the exact `BUILD_ID` and configuration. CI runs browser smoke coverage and retains failure artifacts. `happy-dom` is a development-only dependency for mounted public-hook lifecycle regressions; existing runtime dependencies were not upgraded.

## Validation

Node 22.22.3, pnpm 10.30.3, Chromium through Playwright 1.60.0:

| Final check | Result |
| --- | --- |
| `pnpm verify` | Application, test/script, Convex typechecks; lint; **94 unit files / 889 tests**; default Turbopack production build pass |
| `E2E_PORT=3217 pnpm exec playwright test --reporter=line` | **63 browser tests pass**, disconnected production build |
| Independent fix re-review | No remaining blocking findings; 33 focused tests independently pass |
| Merge-specific model/provider/retirement checks | 129 focused tests and all typechecks pass |
| Held neighbor panorama | Final current room usable before release; baseline waits for the held neighbor |

The mounted hook regressions cover recovery and keyboard timer cleanup, subscription teardown, late session creation, restart/late response, and late handoff. Browser cases verify canvas paint while an incoming image is held, failure/retry/reopen, a crossfade longer than 300 ms after idle, active locale navigation, mobile keyboard behavior, chat handoff, and reduced-motion styles/media. An actual LINE POST test verifies correlated stage IDs, privacy, and one delivery/action after redelivery. A deterministic regression preserves generated IDs through privacy scrubbing.

## Measurements

These are local comparisons with fixed fixtures, not production percentiles. Baseline is `ae5c123`; final measurements use the merged implementation. Raw benchmark results are in [benchmarks](./benchmarks/).

| Measurement | Baseline | Final |
| --- | ---: | ---: |
| Home JavaScript encoded bytes, five fresh 390×844 contexts, reduced motion, 3-second idle window, unthrottled localhost | 564,409 | 323,517 (**42.7% less**) |
| Home decoded JavaScript bytes, same run | 1,903,241 | 1,091,388 |
| Hero video bytes with reduced motion, same window | 4,426,553 | 0 |
| Home initial manifest JavaScript, gzip estimate | 474,873 | 294,138 (**38.1% less**) |
| Locale dictionaries detected in initial manifest chunks | 11 | 0 |
| Garden tour click to usable controls, five-run localhost median | 2,629 ms | 1,277 ms |

The manifest script excludes lazy chunks and estimates compression; resource timing measures the browser's actual script downloads. The active dictionary still arrives in the server-rendered page. Neither metric represents total page transfer or LCP.

A separate desktop chat benchmark uses 1280×800, CPU 4×, 1.6 Mbps/150 ms RTT, five cold contexts, and six seconds of idle time after page load. The widget was already fetched in the baseline; final chat fetches its chunk on activation. Median first click to a visible panel changes from **65 ms to 694 ms**; idle script downloads drop from 31 to 24 requests and 564,409 to 323,517 encoded bytes. This trades about 0.63 seconds on first activation for less startup work. See the raw home-chat files for individual samples.

The mobile tour benchmark separately uses 390×844, DPR 2/touch, CPU 4×, 1.6 Mbps download, 150 ms RTT, cold contexts and warm reopens. It records control readiness, panorama bytes, and idle WebGL draw calls; headless SwiftShader is not a phone GPU. Five cold and five warm final samples completed:

| Mobile tour metric (median) | Baseline | Final |
| --- | ---: | ---: |
| Cold click to usable controls | 13,609 ms | 6,628 ms (**51.3% faster**) |
| Panorama encoded bytes before usable | 2,021,766 | 710,658 |
| Panoramas before usable | 2 | 1 |
| Cold idle draw calls/second | 86 | 0 |
| Warm click to usable controls | 1,845 ms | 1,860 ms |
| Warm idle draw calls/second | 99 | 1 |

Warm latency is effectively unchanged in these small samples. One initial final benchmark attempt showed the recoverable panorama-error UI and produced no timing artifact; its cause was not reproduced. The subsequent instrumented complete run had five cold/five warm successful samples with no panorama HTTP/request failure logged. Failed attempts are not included as successful latency samples.

Messaging benchmark fixtures use 25 ms fake Convex RTT and a 400 ms fake model response, not a live provider. The LINE typed-policy path drops from 12 to 7 Convex calls and two model requests to one, with one delivery. Booking drops from 9 to 6 calls. Prices postback intentionally goes through the concierge rather than returning retired fixed copy, so its fixture rises from 6 to 7 calls and requires one model request. Provider latency and real webhook acknowledgement behavior remain unmeasured.

Reproduce using demo production servers in separate baseline/final checkouts:

```sh
pnpm bench:routes --json /tmp/route-js.json
BENCH_BASE_URL=http://localhost:3104 BENCH_RUNS=5 BENCH_OUT=/tmp/tour.json pnpm exec playwright test -c playwright.bench.config.ts -g 'tour open'
BENCH_BASE_URL=http://localhost:3104 BENCH_RUNS=5 BENCH_OUT=/tmp/home-chat.json pnpm exec playwright test -c playwright.bench.config.ts -g 'home idle'
BENCH_OUT=/tmp/messaging.json pnpm bench:messaging
```

## Limits and deferred work

No Convex deployment, environment update, migration, seed, live booking, or external channel delivery was performed. Authenticated/live provider parity, production query costs/subscription reruns/OCC rate, LCP, device GPU memory, and production latency percentiles need representative integration/traffic measurements. The local fixtures establish bounded cache ownership and write behavior; they do not measure production memory or database traffic.

Presence-table splitting, summary tables, extra inbox indexes, durable webhook queues, provider relocation/replacement, panorama asset variants, and broad calendar rewrites remain deferred without evidence. Background recovery retains its existing bounded nested polling budget (up to roughly 300 transcript reads over ten minutes while active); restart/unmount now cancels it immediately. The failed-navigation UI offers Retry or Close. No automatic transaction retry was added.

Implementation used an isolated worktree. The original checkout's existing files and local artifacts were retained. Of 269 recorded files, 268 matched the starting hashes; the original `convex/chatAi.ts` had an unconfirmed concurrent no-key fallback edit and was left untouched. The initial related snapshot is preserved in `cd3f103`.
