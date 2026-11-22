# Catalog reads, writes and live tour updates

The most expensive catalog read in the fixed database fixture was the featured-review list. It loaded up to 200 ranked reviews before it knew whether six eligible reviews were available. The new implementation walks the same index in rank order, checks the property's availability and stops at six accepted reviews or 200 examined reviews.

| Fixed fixture | Documents before → after | Read bytes before → after |
| --- | ---: | ---: |
| 200 reviews across active villas | 205 → 11 | 144,600 → 8,800 |
| 200 mixed active, draft and archived reviews | 209 → 20 | 148,414 → 16,114 |
| 80 high-ranked, ineligible reviews first | 214 → 100 | 153,268 → 73,468 |
| First 200 reviews all ineligible | 201 → 201 | 140,940 → 140,940 |
| 2,000 mixed reviews | 209 → 20 | 148,474 → 16,174 |

The mixed fixture saved 89.1% of physical read bytes and returned the same ordered result. Adding ten times as many unrelated villas and scenes left the selected villa's ten-scene read at 11 documents and 7,692 bytes. Creating, editing, reordering and deleting scenes retained the same write counts. The indexed single-property tour read remained small, so this change kept its scene documents intact. [Transaction counters for all 41 fixtures](catalog-read-costs.json)

A separate correctness fix applies the configured order before the public 50-scene limit. A legacy 51-scene villa whose first configured scene was created last now shows that scene first. The first implementation read 103 documents to detect and then reread that legacy tour. The follow-up at `a91cef15` uses one bounded index scan, dropping the fixture to 52 reads with the same 16,451-byte response and configured opening scene.

| Tour fixture | Documents before → after | Read bytes before → after | Index queries before → after |
| --- | ---: | ---: | ---: |
| 1 scene, no hotspots | 2 → 2 | 1,140 → 1,140 | 2 → 2 |
| 10 scenes, 4 hotspots each | 11 → 11 | 7,692 → 7,692 | 2 → 2 |
| 50 scenes, 4 hotspots each | 51 → 51 | 34,732 → 34,732 | 2 → 2 |
| 50 scenes, 20 hotspots each | 51 → 51 | 128,332 → 128,332 | 2 → 2 |
| 51 legacy scenes, configured opening scene created last | 103 → 52 | 44,825 → 22,895 | 3 → 2 |

The prior values come from the [original fixed-fixture counters](catalog-read-costs.json). The follow-up uses the same Convex test transaction counters. Reproduce with `PHASE3_BASELINE_REPORT=1 VITEST_MAX_WORKERS=1 bun run vitest run --reporter=verbose convex/phase3CatalogBaseline.test.ts`. All six measured writer cases retained their exact read and write counters. A 50-scene test still reads over 2 MiB in both guest and editor queries. Adding a 51st scene to that same fixture produces the explicit recovery error. Staff can reduce legacy tours within the 500-scene and 2 MiB recovery budget.

**Production inventory, 22 November 2026 at 05:54:46 UTC.** The production deployment serving the public domain contained three villas and five persisted tour scenes. Grouped by villa, the counts and aggregate Convex document sizes were 2 scenes / 587 bytes, 2 / 580 and 1 / 203. All three fit the public 50-scene limit. To repeat the read-only check, use the Convex CLI's `data properties` and `data tourScenes` commands with `--deployment wary-toad-189 --limit 501 --format json`. Check that each result is complete, resolve every scene's property and sum `getDocumentSize` from `convex/values` over each group. A table at the CLI limit requires a complete paginated inventory or a private export. Repeat against the verified target before switching entries.

The scan-only recovery guard read the indexed scene range before a positive room-size change. The 50-scene rename fixture moved from 4 to 54 documents read, 2,667 to 35,492 bytes and 4 to 5 ranges. Its three writes retained the same bytes. The two-scene growing rename read 6 documents and 1,885 bytes over 5 ranges. The 51-scene boundary rename read 55 documents. A large 50-scene fixture passed a growing rename with fewer than 10 documents read because the initial prefix already exceeded the legacy budget. A non-growing rename retained four ranges without an indexed scene scan. Create, hotspot edit, reorder, price update and delete counters stayed at the values above. The additional range lets Convex check the full set of scenes and serialize concurrent growth without a stored count or backfill.

### Growing room renames on the local backend

The scan-only recovery candidate missed the +5% p95 write guard at both fixture sizes. The control `44e7550b` and candidate `b4dac46c` each completed 100 independent growing renames at each size. The edit changed the first room from a short name to a longer name. A separate untimed write reset the name before every sample. Both arms used draft villas with 2 or 50 ordinary rooms, local Convex, real Clerk test-tenant staff tokens, Next 16.2.6, Node 22.22.3, Bun 1.4.5 and the Convex 1.50.0 client on Darwin arm64. The mutation result and exact normalized audit fields matched on every edit. The fixture and audit digest matched across arms.

| Fixture | HTTP p95, control → candidate | Change | Handler p95, control → candidate | Native read documents / bytes, control → candidate |
| --- | ---: | ---: | ---: | ---: |
| 2 rooms | 28.10 → 30.84 ms | +9.73% | 4.17 → 5.40 ms | 6 / 1,260 → 8 / 1,780 |
| 50 rooms | 28.59 → 31.76 ms | +11.10% | 4.23 → 6.42 ms | 6 / 1,260 → 56 / 14,534 |

The arms alternated first position and took turns issuing measurements. The two halves independently exceeded the guard at both sizes. A separate held-read browser test was completing at release, and no compiler was observed then. The timed edits ran on 22 November 2026 from 12:36:57 to approximately 12:37:35 ICT. The 10-CPU host's one-minute load average fell from 7.19 at release to 4.32 near completion. Neither arm recorded an OCC retry. These writes ran serially and measure overhead, not contention.

The [diagnostic report](catalog/room-rename-diagnostic.json) records native execution/handler durations and physically read and written bytes alongside the HTTP samples. The [raw archive](catalog/room-rename-diagnostic.tar.gz) has SHA-256 `01bbc421f330b508177d660cafdf63663c13b0a598b29f5068c29af123445810`. Reproduce using two disposable `scripts/local-integration.mjs` sessions with separate `BENCH_SPANS_OUT` paths. After the launcher separator, run `env BENCH_ROOM_RENAME_ARM=<control-or-candidate> BENCH_ROOM_RENAME_PAIR_DIR=<new-shared-directory> BENCH_ROOM_RENAME_OUT=<unique-path> bun run bench:browser room-rename`. Create the empty `release` file in the shared directory only after both `fixture-*-ready` markers appear. Use the nearest-rank p95 separately at each room count.

The certified-count follow-up `186fea6d` skips the room range after the ordinary count is known and reuses the room already read for history. Its repeat compared control `4c88ed5b` with candidate `0d46e516`, with the same runtime and response checks. Both arms completed 100 steady edits per size and 10 separate first-uncertified edits per size. The disposable harness cleared the optional count outside each first-uncertified timing window. The first-uncertified p95 uses only ten samples and is descriptive.

| Fixture | HTTP p95, control → candidate | Handler p95, control → candidate | Native read documents / bytes, control → candidate |
| --- | ---: | ---: | ---: |
| 2 rooms, steady | 28.91 → 31.62 ms (+9.40%) | 4.18 → 6.02 ms | 6 / 1,260 → 5 / 1,258 |
| 50 rooms, steady | 28.65 → 30.50 ms (+6.44%) | 4.22 → 5.98 ms | 6 / 1,260 → 5 / 1,684 |
| 2 rooms, first uncertified | 28.23 → 27.06 ms | 3.92 → 5.49 ms | 6 / 1,260 → 8 / 2,103 |
| 50 rooms, first uncertified | 28.85 → 29.34 ms | 4.39 → 5.85 ms | 6 / 1,260 → 56 / 15,709 |

The steady rename now reads fewer documents than the control at both sizes. It retains three writes. The first-uncertified edit adds one property write. All 440 timed completions succeeded with zero observed OCC retries and equivalent normalized audit results. The steady write latency gate still failed on the combined samples. The two-room halves measured +4.58% and +21.95%, and the 50-room halves measured +6.21% and +20.73%. The timed interval was 12:46:13–12:46:57 ICT on 22 November 2026. A separate TypeScript compiler, held-read Chromium/backend and a deployment client were active at release. The result establishes the physical read reduction. A controlled repeat still needs to explain the latency gap before release.

The [certified-count report](catalog/room-rename-certified.json) records both paths. The [raw archive](catalog/room-rename-certified.tar.gz) has SHA-256 `d9dd5a96b779490e149b0bacb3d065a406f8be9576dfeb33d54c9d7f39e9f59e`. To include the first-uncertified path when reproducing, set `BENCH_ROOM_RENAME_FIRST=1` on the parent integration launcher and its child command.

The [paired attribution script](../../../scripts/bench/room-rename-attribution.mjs) takes the extracted directory from either rename archive. It matches by fixture, phase and repeat, then reports median and p95 for each arm and for paired differences. Every timed window contains exactly one successful uncached room update. Setup writes, resets and history reads occur outside the measured window.

| Certified steady fixture | Paired handler median difference, first / second half | Completion less handler | HTTP less completion |
| --- | ---: | ---: | ---: |
| 2 rooms | +0.74 / +1.21 ms | +0.12 / +0.10 ms | +0.28 / +0.51 ms |
| 50 rooms | +1.00 / +0.83 ms | +0.12 / +0.12 ms | +0.79 / +0.72 ms |

The handler gap persisted in both halves. The physical counters rule out a whole-tour scan on the steady path. The handler still reads a separate property document, checks the byte delta and sizes the audit envelope. Ordinary fixture logs retain exact snapshots and never enter the digest fallback. These completion metrics cannot separate the property read from JavaScript or isolate overhead. The follow-up should repeat two identical controls in randomized small blocks, then compare with the candidate in swapped deployment order. A separate diagnostic can mark the property read, byte checks, room write and audit update. Those markers should remain off for budget measurements.

### Scene-certificate comparison

A certificate on the scene already read removes the distinct parent lookup and room growth sizing from a steady ordinary rename. It replaces the experimental property count. Each scene needs its own proof once, so an old two-room villa can pay for two scans across two first edits. A first uncertified edit to an ordinary 50-room villa can scan up to 50 rows and writes its marker with the existing room change. New rooms and complete clones already have membership evidence. A large ordinary tour whose prefix exceeds 2 MiB stays uncertified and keeps the bounded check on growing edits. Oversized accepted tours still validate headroom in the edit transaction.

Keeping the parent count could certify the whole villa once. Parallelizing its read with the audit-index read could hide some wait, with an extra index lookup on every rename and a wider shared dependency on unrelated property changes. Keeping a separate room-size summary would add another invariant. The scene certificate avoids both and retains the exact audit size traversal. The scope of the import repair changes from one property document to every potentially affected scene. The [operator runbook](../../architecture/tour-certificate-recovery.md) handles that work while writes are paused. Production names describe current-schema import and recovery bounds. The architecture scorecard still rejects code that refers to retired schema or migration paths.

Use the same backend build process and fixture source on both arms. First run A/A with the same source revision in independent deployments. Then run A/B in both port orientations and alternate which app binds first. Reserve two disjoint loopback port triples for cloud, site and app, and use `BENCH_ROOM_RENAME_PORTS=cloud,site,app` on each integration launcher. The launcher checks the bindings before startup. Swap the exact triples for the second A/B. Set `BENCH_ROOM_RENAME_BLOCK=5` on both child commands. For every five paired repeats, reverse which arm goes first. Every repeat includes the two room counts, and fixture order also alternates. Use `BENCH_ROOM_RENAME_REPEATS=250` per size for the next decision series. Sample active processes and load at release, every five seconds during timing, and at completion. The initial 100-sample calibration below is retained separately. Keep the ten optional uncertified observations separate. Record runtime, source, lock, fixture digest, port assignment, release/completion times and competing processes.

Replay each pair using `node scripts/bench/room-rename-attribution.mjs <extracted-directory> aa` or `ab`. The script checks normalized fixture and audit equality and reports HTTP median/p95, native handler/completion measures and paired deltas. A/A must show absolute arm drift of at most 3% on median and 5% on p95 at each size before interpreting A/B. The +5% A/B p95 guard must pass for both sizes in both port orientations. If A/A fails, A/B changes verdict after swapping, or a build overlaps timing, retain the inputs and call the release evidence inconclusive. Repeat the whole affected pair in an uncontested interval. Keep failed and interrupted measurements, logs and raw spans under their own labels, outside the acceptance aggregate.

The first exact-source A/A calibration at `5180174b` completed 100 observations per size and arm on 22 November 2026 from 13:17:33 to 13:18:11 ICT. The two-room p95 was 27.83 ms on the control deployment and 32.14 ms on its identical peer (+15.48%). The 50-room p95 was 28.66 ms and 28.45 ms (−0.75%). Both arm medians met the 3% calibration bound, while the two-room p95 missed its 5% bound. Native paired median handler differences were +0.24 ms and +0.21 ms, respectively. Retain all samples and treat the run as a failed calibration. [Raw calibration](catalog/room-rename-aa-calibration.tar.gz)

The next A/B attempt collected no timed observations. Both control listener ports were open, but its anonymous CLI stalled before the function-bundle readiness message. The peer remained at the release barrier and both processes were stopped. Successful leading logs from the same revision show the function-bundling message immediately after the dashboard prelude. The subsequent pair can opt in to the dashboard-free local launcher using `BENCH_ROOM_RENAME_DASHBOARD_FREE=1`. Both arms must use that setting together. It preserves the same loopback backend and avoids a dashboard that the timing fixture does not use.

The decision series used control `b2be3a00` and scene-certificate candidate `142087a3`, Node 22.22.3, Bun 1.4.5, Convex client 1.50.0 and the native backend build `2026-11-21-cf39368` on macOS ARM64. The 250-observation calibration used the exact same `b2be3a00` source on both arms. The authenticated test asserted identical fixtures, mutation results and normalized audit rows between arms in each comparison. A/A retained 500 windows per arm. Both A/B orientations retained 520 per arm, including ten separately reported first-uncertified edits at each size. The control used the same timing harness with the original rename endpoint and no certificate.


| Pair and sampling time (ICT) | 2-room HTTP p95, control → peer | 50-room HTTP p95, control → peer | 2-room HTTP median change | 50-room HTTP median change |
| --- | ---: | ---: | ---: | ---: |
| A/A 13:56:46–13:58:29 | 29.802 → 30.022 ms (+0.74%) | 29.325 → 29.332 ms (+0.02%) | +0.24% | +2.21% |
| A/B 14:00:08–14:01:56 | 30.003 → 28.812 ms (−3.97%) | 30.317 → 29.665 ms (−2.15%) | −3.46% | −3.43% |
| A/B swapped 14:05:18–14:07:07 | 30.551 → 29.534 ms (−3.33%) | 30.579 → 30.432 ms (−0.48%) | −1.91% | −1.13% |

The A/A calibration passed both drift limits. Both A/B orientations met the +5% steady HTTP p95 budget at both sizes. The initial peer bound cloud/site/app ports `43310/43311/43312`, the control `43210/43211/43212`. The swapped candidate used the control's initial triple. Timed windows avoided builds and active hosted timing runs. A five-second A/A snapshot at 13:56:52 caught one short Vercel domain lookup, absent on other snapshots. The two A/B windows showed no Vercel or Next build processes in the snapshots. Background OS workers and the paired browser fixtures were present.

Steady native growth edits read 4 documents and 931 bytes in the candidate versus 6 and 1,260 bytes in the control, at each size and in both bindings. They wrote three documents on both paths, with zero observed OCC retries. Paired candidate-minus-control native handler medians were +0.245/+0.204 ms (2/50 rooms) in the first orientation and +0.236/+0.249 ms in the swap. The corresponding native completion changes were +0.226/+0.216 ms and +0.210/+0.221 ms. These results establish the end-to-end budget for this workload and expose a small native handler cost despite the lower read count.

For first uncertified growth, candidate reads were 6 documents/1,428 bytes on the two-room fixture and 54/15,286 on the 50-room fixture. All still wrote three documents, with no observed OCC retries. From the ten 50-room observations per arm, the candidate's paired handler median was +0.642 ms in the first orientation and +0.868 ms in the swap, with HTTP p95 30.683 → 28.940 ms and 29.621 → 30.222 ms. The larger first-edit scan is a separately measured cost for uncertified data. These small diagnostic samples carry no p95 budget verdict.

The deterministic archive contains all six timing files and six span files, the three exact replay reports, exit states and sanitized process snapshots. Its SHA-256 is `415629c0df82e6abae81867f5df22f52011d2a3b102f6b0bab45da5e6a3fb600`. Extract the archive and pass its `aa`, `ab` or `swap` directory to the script above, using replay mode `ab` for the swap. [Raw scene-certificate inputs and reports](catalog/room-rename-scene-certificate.tar.gz)

The other untimed attempts were the original launcher with an overbroad Playwright filter, an idle 100-observation calibration setup stopped before release, the control startup timeout described above, the 13:40 ready A/A held for hosted CLI jobs, and a ready swapped A/B setup released from the machine queue for a separate functional build. Each collected zero rename timings. Both later held pairs started successfully and exited on request before any samples were triggered.

## Isolated backend timings

Each backend had a separate local deployment, 200 inserted reviews, the same public responses and a run-owned authenticated staff session. Each group issued one review update, immediately queried featured reviews, repeated the query warm, then exercised checkout and inbox. The load levels were one reader and a burst of ten readers. The ten-reader group still issued one write per batch. End-to-end timing includes the local HTTP round trip, authentication where applicable and client decoding.

| First alternating series, nearest-rank p95 | Control ms | Candidate ms |
| --- | ---: | ---: |
| Featured reviews after an edit, 1 reader | 19.42 | 13.37 |
| Featured reviews after an edit, 10 readers | 25.53 | 8.47 |
| Featured reviews warm, 1 reader | 2.15 | 1.47 |
| Featured reviews warm, 10 readers | 2.95 | 2.04 |
| Checkout, 1 / 10 readers | 22.33 / 24.12 | 22.10 / 23.03 |
| Inbox, 1 / 10 readers | 21.91 / 22.41 | 24.01 / 23.40 |
| Review write before 1 / 10 readers | 40.60 / 28.38 | 34.51 / 35.80 |

For one reader the median uncached featured query used 202 documents and 113,769 bytes on the control and nine documents and 5,220 bytes on the candidate. Backend completion p95 fell from 15.92 to 11.09 ms. Handler p95 fell from 6.77 to 5.48 ms. The backend reports database traffic and execution duration separately. It does not expose exclusive database elapsed time for these calls.

The expanded paired run used control `6863add2` and candidate `b7a6f039` with the same lockfile, Node 22.22.3 on Darwin arm64 and Convex JavaScript client 1.50.0. Each arm had 200 separate edits at each reader count, 400 measurement windows and 9,200 operations. The fixture had 200 reviews and a 350 ms edit cadence. The launcher alternated the first arm within each pair. Each ten-reader burst followed one edit. Each recorded operation completed successfully. The authenticated staff guardrails exercised `pos/orders:listOpenOrders` and `messaging/adminChat:listSessions`.

| Expanded series, nearest-rank p95 | Samples per arm | Control ms | Candidate ms | Change | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Featured reviews after an edit, 1 reader | 200 | 15.120 | 10.023 | -33.7% | Pass |
| Featured reviews after an edit, 10 readers | 2,000 | 15.876 | 10.580 | -33.4% | Pass |
| Featured reviews warm, 1 reader | 200 | 0.833 | 0.931 | +11.7% | Descriptive |
| Featured reviews warm, 10 readers | 2,000 | 2.280 | 2.081 | -8.7% | Descriptive |
| Checkout, 1 reader | 200 | 21.856 | 20.986 | -4.0% | Pass |
| Checkout, 10 readers | 2,000 | 23.860 | 23.004 | -3.6% | Pass |
| Inbox, 1 reader | 200 | 21.383 | 21.874 | +2.3% | Pass |
| Inbox, 10 readers | 2,000 | 24.528 | 22.870 | -6.8% | Pass |
| Review write, 1 reader | 200 | 34.448 | 34.597 | +0.4% | Pass |
| Review write, 10 readers | 200 | 34.034 | 33.274 | -2.2% | Pass |

Post-edit featured p95 fell by at least 20% at both reader counts. Checkout, inbox and review-write p95 stayed within the +5% guard at both reader counts. The warm single-reader p95 rose by 0.10 ms (+11.7%) and the ten-reader warm p95 fell by 0.20 ms. Warm reads use Convex's result cache and are reported separately from the changed-handler gate.

| Fresh featured backend spans | 1 reader control → candidate | 10 readers control → candidate |
| --- | ---: | ---: |
| Completion p95, ms | 14.07 → 8.78 | 14.07 → 8.78 |
| Handler p95, ms | 7.58 → 4.99 | 7.62 → 5.16 |
| Median database read documents | 202 → 9 | 202 → 9 |
| Median database read bytes | 113,770 → 5,221 | 113,770 → 5,221 |
| Median returned bytes | 3,010 → 3,010 | 3,010 → 3,010 |

The fresh path saved 95.4% of database read bytes at both reader counts. Each arm logged 9,200 backend completions, including all 400 review writes. Every reported OCC retry count was zero at this edit cadence. The reports keep handler and end-to-end completion durations separate. Convex provides document and byte counters without exclusive database elapsed time for these calls.

### Reproduce the expanded report

The archive contains the four original sanitized JSON inputs. Its tar entries are sorted with fixed permissions, ownership and timestamps. The gzip timestamp is zero. The archive SHA-256 is `5b1ef6ac8d8066fa17712104fd2b094730dd491651b01fe0ca6f885702fda6e6`. The report records the full revisions, lock hash and each input SHA-256. Replay from the repository root.

```sh
archive=docs/plans/benchmarks/catalog
expanded=$(mktemp -d)
tar -xzf "$archive/expanded-load-runs.tar.gz" -C "$expanded"
node scripts/bench/backend-load-report.mjs \
  "$expanded/control/expanded-samples.json" "$expanded/control/expanded-spans.json" \
  "$expanded/candidate/expanded-samples.json" "$expanded/candidate/expanded-spans.json" \
  > "$expanded/replay.json"
cmp "$archive/expanded-load-results.json" "$expanded/replay.json"
```

[Expanded report](catalog/expanded-load-results.json) · [Expanded raw inputs](catalog/expanded-load-runs.tar.gz)

The initial sequential run passed the timing thresholds. Reversing the order changed the outcome. The smaller alternating run re-established the post-edit gain but missed the single-reader inbox and ten-reader write guards with just ten independent ten-reader writes. Those early runs remain available with their source revisions and input hashes. [Initial comparisons](catalog/initial-load-results.json) · [Raw diagnostic inputs](catalog/initial-load-runs.tar.gz)

## Live tour correctness

A browser opens one live rooms subscription. It keeps an already confirmed scene on screen after disconnect, locks camera and navigation, and waits for current server data to re-enable them. On a new open or identity change, a retained SDK value needs a fresh server delivery or a matching authoritative read before the first scene is displayed. A second watcher of an already-live query can receive no delivery until a later edit, so the matching read covers that case.

With a 150 ms WebSocket RTT fixture, two open tabs followed the first room after reorder, preserved a still-valid explicit selection and cleared an archived tour. A warm reopen with the archive delivery held for 1.5 s requested no panorama. One anonymous tab and ten anonymous tabs both caused one fresh reevaluation after an independent price or description edit. Neither edit delivered a changed scene result. A real scene edit produced one or ten guest updates, respectively. The Phase 1 server-handler timing was about 4 ms on an 8.45 s direct entry. Eliminating that work alone would save less than 0.1% of the recorded median. [Next live results](catalog/live-next.json) · [Start live results](catalog/live-start.json) · [Subscription fanout](tour-query-updates.json)


The extended suite at clean revision `0da03820` added a held application read across a reconnect and a separate offline mount within the same test. Start passed all seven Playwright tests, including setup. Its held-read assertion recorded zero stale confirmations and zero offline mount reads. Next passed six tests and timed out in the added case. The timeout was traced to a refused WebSocket upgrade in Node. The earlier paired observations remain available above.

On `2c8f8b67`, both Next and Start passed ten independent held-read cases apiece. The proxy retained the replacement connection’s real upgrade response and subsequent deliveries while the application resolved an HTTP read that had already observed the active villa. Across all 20 runs, that read confirmed zero stale scenes and an offline mount made zero reads. Each frontend also passed the full six-scenario suite and the separate Clerk setup. Every observed live edit reached the UI within one rendered frame. Reverting the connection check let the old read confirm stale scenes and failed the corresponding assertion. The integrated source at `59090337` has identical watch logic and the same test. [Per-entry results and negative control](live-tour-freshness.json)

## Measured revisions

The columns below are the Git tree IDs for the complete backend and application source directories. Compare them with `git rev-parse '<revision>:convex' '<revision>:src'` to identify the code tested even when a benchmark and its integration commit have different commit IDs.

| Experiment | Measured revision | Convex tree | Application tree | Matching integration revision |
| --- | --- | --- | --- | --- |
| Featured-review control | `6863add2` | `3ee2698355ca` | `f7969a2e1fbd` | Control |
| Featured-review candidate | `b7a6f039` | `4ce65fe625dc` | `d6589edcae07` | `b7a6f039` |
| Single indexed scene scan | `a91cef15` | `e828bbf46f36` | `d6589edcae07` | `fd6c0156` |
| Rename controls | `44e7550b`, `4c88ed5b` | `e828bbf46f36` | `d6589edcae07` | `fd6c0156` |
| Rename with full growth check | `b4dac46c` | `68eec443558a` | `ffd3dbe81dfa` | `62ad8d17` |
| Rename with property count | `186fea6d`, `0d46e516` | `3d9e4fb2db9b` | `ffd3dbe81dfa` | `ca81d0ee`, `aa93dfad`, `b3296747` |
| Calibrated scene rename, control | `b2be3a00` | `e828bbf46f36` | `d6589edcae07` | Phase 2 rename handler used for the comparison with `b875941a` |
| Calibrated scene rename, candidate | `142087a3` | `d141b5734c59` | `ffd3dbe81dfa` | All deployed backend functions match `b875941a`. The backend-tree difference is in `properties.test.ts`. |
| Held read across reconnect | `2c8f8b67` | `e828bbf46f36` | `fa923c74b01e` | Both tour source directories and the Playwright spec match `b875941a`. |
| Native certificate repair | `87409241` | `6c0135e90988` | `ffd3dbe81dfa` | Deployed backend functions match `b875941a`. The generated API declaration and `properties.test.ts` changed. |

## Release checks

The database commit is based on the merged Phase 2 revision `f8eb63e7`. The complete Convex tree (`e68ed03789b1`) is identical across the Stage D benchmark, the production-export restore, and both release commits. The checkout change after Stage D is confined to the customer-display dialog. The guest room and tour source, package lock and benchmark workload match the Stage D run. [Mobile measurements](tour-entry-stage-d-final.md) · [Production-data restore](../../architecture/tour-certificate-recovery.md)

The local Next production build at `75cd92c9` put checkout at 546,812 gzip bytes, 366 above the 546,446-byte ceiling. The QR renderer was in the initial bundle even before a cashier requested a pairing link. The first corrected build at `731721c9` moved it into an 8,360-byte gzip chunk loaded on demand. The final dialog also retains the URL and clipboard action when the renderer download fails. The local cashier browser test opened the real dialog, created a link, saw the SVG and copied the same URL on both frontends.

| Initial route JS at `ace4dfae` | Next gzip / Brotli bytes | Start gzip / Brotli bytes |
| --- | ---: | ---: |
| Home | 302,895 / 265,096 | 242,763 / 206,700 |
| Room | 301,257 / 263,608 | 239,312 / 203,489 |
| Property editor | 455,956 / 398,840 | 384,834 / 333,022 |
| Checkout | **537,461 / 468,783** | **469,567 / 406,570** |

Both builds passed the four existing ceilings. Next checkout has 8,985 gzip bytes of headroom. The original overage, the first corrected measurement and the final route totals are retained alongside the hosted checks. [Release measurements and Preview workflows](catalog/phase3-release-checks.json)

At `ace4dfae`, all 4,216 unit, DOM, backend and repository tests passed across 371 files, with at most two Vitest workers. The fast checks, unused dependency check, generated route tree and all 32 architecture checks passed. The 814-case booking UI suite ran on `75cd92c9`; the browser tests on the corrected release exercised the changed cashier dialog. Both production builds and all 85 Start end-to-end tests passed. The Next smoke suite passed all 16 cases.

The first full Next run on `ace4dfae` passed 81 cases, skipped the three Start-only cases and received HTTP 429 from Clerk during a mobile chat test. That case and its authentication setup passed on a separate run. Earlier overlapping runs also reached the test tenant's sign-in limit. Subsequent release suites used one browser worker and ran their sign-ins sequentially.

A fresh protected Start deployment at `ace4dfae` passed all 61 HTTP parity rows against the saved Next control, with 59 matches and two improvements. A separate real Clerk workflow on the same seeded Preview passed owner/cashier/non-staff access, sign-out, read-only checkout, booking through payment handoff, restored chat and live tour changes. Fixture cleanup and removal of the temporary users and owner grant succeeded. No live customer account or payment was used.

The final full Next rerun on the same `ace4dfae` completed at 15:33 ICT with 82 passing cases, three Start-only skips and zero failures. Both entry suites passed all six live-tour scenarios and the authenticated QR and clipboard check.

### Phase 3 publication

[PR 98](https://github.com/Ruckth/360-tour/pull/98) merged on 22 November 2026 as `c7e07a2256d08c0a7ebff201a1c625b711046692`. Its tree matches the audited head `4942af86e4909e08d5746018bba3b8220c31eb46`. The parallel CI workflow from PR 97 exposed a keyboard focus defect when the guest chat composer was disabled on open. The overlay now focuses its Close button in that case. The focused regression and six Next launcher checks passed. A desktop browser confirmed focus on Close on the exact hosted Start Preview. The tour entry benchmarks never activate the chat widget.

Local verification passed 4,217 tests across 371 files and both production builds. The phase architecture checks passed 32/32. The exact hosted Preview passed 61/61 route comparisons, including 59 matches and two improvements. Its separate real Clerk test covered roles, checkout, booking handoff, chat and live tour changes, and teardown passed. After the initial parallel sign-ins reached Clerk's rate limit, each real-Clerk CI job used one worker. Both jobs, all eight booking UI shards and the aggregate check passed. [GitHub run](https://github.com/Ruckth/360-tour/actions/runs/45005742288)

Both independent reviewers scored all seven Phase 3 categories 9/10 at the published head. The verified production restore with the same backend matched all 133 table digests and zero storage files. The two later application and CI commits kept the measured Convex and tour code unchanged. The cold-direct median target remains assigned to Stage E.
