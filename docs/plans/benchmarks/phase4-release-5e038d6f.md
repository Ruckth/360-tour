# Phase 4 release verification

The Phase 4 source is `5e038d6f7cf573bcd73c6988189baa82577e8a06`. Its sole parent, `93b08fd084679fba52431ab2abed0afabcc4abe2`, retains both frontend entries. The previous production deployment used the Phase 3 merge `c7e07a2256d08c0a7ebff201a1c625b711046692`.

## Mobile tour performance

The accepted repeat completed 300 of 300 opens. On the constrained mobile fixture the median direct link took 6.193 seconds to respond to a trusted drag, 26.7% faster than the original 8.448-second control and 23.3% faster than Phase 3's 8.079 seconds. A warm reopen took 186 ms. The gallery optimization saves a different number of bytes on Vercel because the hosted image optimizer delivers a smaller photo. [Original control](tour-entry.md) · [Phase 3 control](tour-entry-stage-d-final.md) · [Replication and raw inputs](tour-entry-stage-e2-5e038d6f-replication.md)

| Independent repeat | Direct median | Direct p95 | Tap-to-open median | Warm reopen median |
| --- | ---: | ---: | ---: | ---: |
| Batch 1, 50 per cohort | 6,193.10 ms | 6,291.30 ms | 2,752.10 ms | 183.70 ms |
| Batch 2, 50 per cohort | 6,192.35 ms | 6,259.50 ms | 2,761.65 ms | 189.00 ms |
| Frozen limits, applied in each batch | 6,758.5 ms | 8,975.5 ms | Descriptive | 222.5 ms |

The earlier 300 opens on the same release also met the absolute limits. Their warm medians of 183.65 and 193.25 ms exceeded the 5% repeatability limit, so that study remains inconclusive. The fresh repeat used the same profile, code, generator and thresholds. Its warm spread was 2.89%. Both reports preserve every observation. [First study](tour-entry-stage-e2-5e038d6f.md) · [Replication design](tour-entry-stage-e2-5e038d6f-replication-design.md)

## What guests experience

Opening a direct tour shows the villa's loading screen and Close link in the initial HTML. Only the current panorama can start before the first usable frame. Neighbor downloads wait for a drawn, visible panorama and an interactive canvas. Closing before the first draw reveals the room's usual high-priority gallery image. After a draw, the covered image loads at low priority. In the protected deployment both paths decoded the same 32,757-byte AVIF. [Hosted results](phase4-hosted-and-restore-5e038d6f.json)

A same-tab reopen can reuse an 8 MiB CPU copy of the first bundled mobile panorama. Chromium recorded a fresh cache hit and zero panorama requests through the usable frame, after confirming that it had canceled the previous neighbor download. Eleven visits released all observed GPU handles on close. Separate initial-view comparisons matched the reference pixels on first open, warm reopen and context restore. The first-tilt comparison used one sweep per arm. [Functional probes](tour-entry-stage-e2-5e038d6f-functional.md) · [Image quality](tour-quality-33cc45f1.md)

## Application and restore checks

| Check | Observed result |
| --- | --- |
| Local release | 4,341 tests across 381 files, 815 booking tests, 86 authenticated E2Es and 16 standalone smoke tests passed. The fresh and retained local development lifecycles passed. All recorded commands exited zero. [Release battery](release-battery-5e038d6f-20261122203046/README.md) |
| Initial route JavaScript | Home 206,911, room 204,855, property 333,033 and checkout 406,567 Brotli bytes. Each is within its route limit. [Bundle record](release-battery-5e038d6f-20261122203046/start-route-budgets.json) |
| Protected hosted deployment | The dual-entry checkpoint and Start-only release each passed 61 HTTP comparisons, with 59 matches and two improvements. Signed-in booking, checkout, chat, live-tour and access checks passed. The release reused a dedicated, already-seeded test backend with identical Convex source and dependencies. [Hosted results](phase4-hosted-and-restore-5e038d6f.json) |
| Production data compatibility | An isolated restore of the production export matched every digest across 133 tables and zero storage files both before and after deployment of the candidate backend. The certificate accepted the existing data. [Restore certificate record](phase4-hosted-and-restore-5e038d6f.json) |
| Forward and rollback rehearsal | All 25 steps passed on the exact Phase 3 to Phase 4 pair. Both restores matched 100 tables and two blobs in the seeded rehearsal. Start and Next each served the villa after the corresponding switch. [Rehearsal](../../architecture/evidence/phase4/final-rehearsal-r20261122130842-c41978.md) |
| Error reporting | The local Sentry receiver captured scrubbed server and browser events. Strict source maps linked 260 of 260 client files and 481 of 483 server files, with the two allowed generated files and zero coverage failures. Hosted symbolication was outside this proof. [Sentry record](start-sentry-final-649de22d.md) · [Matched build](phase4-build-comparison-5e038d6f.json) |

The first Stage E candidate missed the cold and reopen median targets. Its 300 observations remain archived. A later provisional release exposed a route-budget classification error. The final classifier counts the server-rendered intro toward ordinary route bytes and continues to flag any chunk containing a renderer module. All 307 public files in the matched builds were byte-identical. The only server difference was Nitro's generated asset timestamps. [First Stage E run](tour-entry-stage-e1.md) · [Provisional battery](release-battery-3dbc571e-20261122200558/README.md) · [Build comparison](phase4-build-comparison-5e038d6f.json)

## Independent implementation reviews

Both reviewers approved the two-commit source range before the pull request. Scores measure implementation readiness. The pull request carries its own CI result, followed by live staging and promotion records.

| Category | Astra 6.2 | Info Opus 5.5 |
| --- | ---: | ---: |
| Measurement | 9 | 9 |
| TanStack Start | 9 | 9 |
| Bun and checks | 10 | 9 |
| Database | 9 | 9 |
| Backend | 9 | 9 |
| Frontend | 9 | 8.5 |
| Cutover | 9 | 9 |

Astra recomputed the replication medians and p95s from all 300 opens and verified the 100 input hashes. Info verified the criteria and generator against the original inconclusive attempt. Info's frontend score reflects two costs that still merit measurement on a physical phone. Tilting far enough to require mipmaps uploads the full texture once, and Safari's idle-capture fallback can copy pixels during a drag.
