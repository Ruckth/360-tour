# Start villa cache outage study

One seeded local run passed on the integrated Start build at `57cffab4` with the cache race fix `ded6bb50` applied. The harness used Bun 1.4.5, Node 22.22.3, Nitro's Node server, a fresh anonymous Convex backend with the `demo-resort` fixture, and a dedicated Clerk test owner. The browser signed in and provided a real Clerk Convex JWT for the catalog writes. The loopback proxy withheld only anonymous SSR villa detail reads and kept the authenticated mutation path available.

| Observation | HTTP | Document response (ms) | Cumulative detail reads | Withheld reads | Result |
|---|---:|---:|---:|---:|---|
| Warm page | 200 | 9.4 | 1 | 0 | Existing cached villa |
| Authenticated edit | 200 | 9.2 | 2 | 0 | New content visible 648.3 ms after starting the write and poll |
| Warm page during outage | 200 | 3,021.2 | 3 | 1 | Last confirmed content served after the read deadline |
| Unknown villa during outage | 503 | 13.2 | 3 | 1 | `Retry-After: 30`, with no additional detail read during backoff |
| Backend recovered | 200 | 5.6 | 4 | 1 | Latest committed content visible 30,337.9 ms after restoring the proxy |
| Archived | 404 | 3.7 | 5 | 1 | Authoritative absence observed |
| Archived during a second outage | 404 | 3.6 | 5 | 1 | Cached absence preserved |
| Reactivated | 200 | 4.5 | 6 | 1 | Latest committed content restored |

Durations use the runner's monotonic clock and include reading the full document. The edit and recovery intervals include polling. This run exercises the local memory cache. It supplies no measurement of Vercel Runtime Cache propagation across instances.

Reproduce from a disposable prepared worktree using the repository's dedicated Clerk test configuration.

```sh
bun run worktree:setup
mkdir -p output/cache-study
START_VILLA_CACHE_STUDY=1 node scripts/heavy.mjs node scripts/local-integration.mjs --start -- \
  env START_VILLA_CACHE_STUDY_OUT="$PWD/output/cache-study/study.json" \
  bun run bench:browser start-villa-cache
```

The output path must be new. The harness stops the app and backend and cleans up its run-owned Clerk identities.

## Vercel Preview outage

A dedicated prebuilt Start Preview on the same Vercel project repeated the outage against real hosting. It ran on Node 22 in `iad1` behind Vercel Authentication with no aliases, kept apart from the Phase 2 validation Preview and the room latency pair. Its server and browser used the isolated QA Convex origin `posh-blackbird-279` with its existing anonymous `pool-villa` data. The function was built from `369c9fdc` with `START_VILLA_FAULT_FIXTURE=1`. Only that build swaps the identity hook in `src/lib/server/villa-read-fault.ts` for the fixture. That fixture also requires Preview plus a token digest and run name, which were set only on this deployment. Requests that carry the token still make each allowlisted anonymous villa read to Convex, then fail it after 4 s, past the reader's 3 s deadline, so nothing from that read is cached. The fixture prefixes its Runtime Cache keys and tags with the run name, so other Previews sharing the cache stay separate. It exposes process identity and read counts only. The probe made anonymous GETs only and no backend writes. The evidence files hold no URLs, deployment IDs, cookies or tokens.

[`warm-process.json`](start-villa-preview-outage/warm-process.json) used one function process throughout. Every recovery poll carried the same process identity.

| Observation | HTTP | `x-villa-cache` | Document response (ms) | Upstream / held reads | Result |
|---|---:|---|---:|---:|---|
| Healthy | 200 | `hit` | 3,233.6 | 0 / 0 | A fresh process got a Runtime Cache hit written by another instance |
| Warm page during outage | 200 | `stale; read-error` | 3,782.4 | 2 / 2 | Fifth faulted poll, 27.2 s in, after the 60 s entry expired; last-good title |
| Unknown villa during backoff | 503 | `unavailable` | 606.8 | 2 / 2 | `Retry-After: 30`, no new read |
| Healthy reads resumed | 200 | `stale; backoff` ×12, then `miss` | 661.1 | 4 / 2 | Fresh upstream content 30,960 ms after removing the fault |
| Unknown villa after recovery | 404 | `miss`, then `hit` | 409.6, 553.5 | 5 / 2 | Authoritative miss, then the cached absence |
| Unknown villa, held read outside backoff | 503 | `unavailable` | 3,548.1 | 6 / 3 | `Retry-After: 30` after a real held read |

The first run, [`process-recycled.json`](start-villa-preview-outage/process-recycled.json), used the probe's earlier step order. It also showed warm last-good (200, `stale; read-error`, 3,855.8 ms) and a 503 during backoff in the warm process. After a 31 s idle wait, Vercel sent the next faulted unknown-villa request to a new process. That process answered 503 with `Retry-After: 30` in 5,453.7 ms, including cold start. Without saved data it kept answering 503 for the known villa until its own backoff ended, and served fresh content 30,415 ms after the fault was removed. That run's warm-process recovery is inconclusive, so recovery polls now follow the outage directly.

Durations use the runner's monotonic clock from Bangkok to `iad1` and include reading the full document. No Preview run included authenticated archive or reactivation. Those cases rely on the local run above, which also covers committed edits. The Preview run's last-good data matched the healthy content, so it does not separate stale from newly committed edits. Cross-instance Runtime Cache sharing was observed, but propagation delay was not measured.

Reproduce with a prepared worktree and the Vercel CLI linked to the project. Build `.vercel/output` with `NITRO_PRESET=vercel START_VILLA_FAULT_FIXTURE=1` and the QA origin's public `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` and `VITE_CLERK_PUBLISHABLE_KEY`. Stage it with a minimal `package.json`, `{"framework":null}` and `.vercel/project.json`. Generate a private token. Deploy with `vercel deploy --prebuilt --environment preview` and deployment-only `--env` values: `VILLA_FAULT_TOKEN_SHA256`, `VILLA_FAULT_RUN`, `NEXT_PUBLIC_CONVEX_URL`, and every `disabledProviderKeys` entry set empty. Mint the mode-600 bypass cookie jar as in `tests/e2e/preview-qa.md`. Write a mode-600 target manifest with `isolation: "dedicated-villa-outage-fixture"`, `app` and `commit`, then run:

```sh
VILLA_OUTAGE_TARGET=… VILLA_OUTAGE_TOKEN_FILE=… E2E_PREVIEW_VERCEL_COOKIE_JAR=… \
  VILLA_OUTAGE_OUT=new.json node tests/bench/start-villa-preview-outage.mjs
```

Afterwards, delete the token and jar, then remove the deployment.

## Hosted authenticated acceptance

[`authenticated-acceptance.json`](start-villa-preview-outage/authenticated-acceptance.json) measured source `508d1ca5`, which includes the shared-generation cache fix. A remote Vercel build ran with `START_PREVIEW=1`, `START_SSR_RUNTIME=bun` and `START_VILLA_FAULT_FIXTURE=1` on the new branch name `perf-phase2-outage-validation`. That created and seeded a fresh Convex Preview. The deployment was protected, had no aliases, and carried a private marker plus the commit SHA and branch in its metadata. The fault token digest, run name and blank provider keys were set only on that deployment. Push invalidation was off, so visibility measured the real 60 s TTL. A run-owned Clerk test owner was granted only on that Preview's `ADMIN_EMAILS`. It wrote through `catalog.properties.update` and `adminProperties.setStatus` with a `convex` JWT from a Clerk Backend session. The runner refuses any other preview name, the shared and production backends, and the earlier QA backend. The first read in the fresh namespace was a `miss`. One worker answered all 110 recorded responses.

| Step | HTTP | `x-villa-cache` | Content | Measured |
|---|---:|---|---|---|
| Edit | 200 | `hit` ×17, then `miss` | seeded → edited | visible 61,421 ms after the write |
| Second edit committed, then outage after expiry | 200 | `hit` ×11, then `stale; read-error` | edited (last-good) | 3,637.0 ms; the newer edit was never shown |
| Unknown villa in backoff | 503 | `unavailable` | — | `Retry-After: 30`, no new held read |
| Recovery | 200 | `stale; backoff` ×13, then `miss` | edited → newer edit | 32,449 ms after the outage response |
| Archive | 404 | `hit` ×18, then `miss` | absent | 62,868 ms after the write |
| Outage after the cached absence expired | 404 | `hit` ×11, then `miss; read-error` | absent | 3,629.6 ms; no last-good villa resurrected |
| Recovery while archived | 404 | `miss; backoff` ×13, then `miss` | absent | 32,268 ms |
| Reactivate | 200 | `hit` ×17, then `miss` | newer edit | visible 59,764 ms after the write |
| Unknown villa | 404 | `miss` | absent | authoritative miss |

Teardown restored the seeded name and active status, removed the owner grant and deleted the run-owned Clerk users. The Vercel deployment was then removed by exact name. The Convex Preview follows its normal preview expiry. The run issued its requests sequentially. It did not exercise overlapping stale completions, which `0075819d` addresses later. `tests/bench/start-villa-preview-acceptance.ts` takes a mode-600 target manifest (`isolation: "dedicated-villa-outage-acceptance"`) and `VILLA_ACCEPTANCE_EXPECT_SHA`. It verifies the deployment metadata and refuses to run against any other SHA.

### Stale-while-revalidate acceptance (prepared)

`tests/bench/start-villa-preview-swr-acceptance.ts` targets Start's SWR cache (from `10730a5c`). It needs a deployment built from the final SHA on a new disposable preview name matching `perf-phase2-{outage,swr}-validation` (optionally suffixed `-2`…`-9`). Setup refuses any backend whose fixture villa has `contentEditedAt` set, so a reused backend fails before any write. Decisions use the fixture's per-worker `getBySlug` counters (`detail`, `detailHeld` in `x-villa-fault-ledger`), not cache header wording. Any change of worker fails the run.

Requests are sequential, because concurrent bursts were routed to a second, cold instance. Under a held read, every response must finish below the 3 s origin deadline. That is the causal proof that nothing waited on the origin. The 2 s stale budget is reported per leg as a distribution. Each response also records its idle gap, so a cold start or idle wake is not mistaken for blocking.

Origin detail reads are asserted per transition, following `aea4cc51`:

| Transition | Origin detail reads |
|---|---:|
| Changed content (edit, archive, reactivation) | 2: one read, then a re-read after the generation rotation |
| Unchanged content | 1 |
| Refresh held past the deadline | 1: it fails before any rotation |
| During backoff | 0 |
| First 404 on an empty key, cold negative (`2822f6a5`) | 2: the null read, then a publishing read after the rotation |
| Cached repeat | 0 |

The response that starts a refresh must have started exactly one read. The runner then sends nothing for 5.5 s, the 5 s in-flight bound plus margin. A second read in that time is therefore the same refresh's re-read, never a parallel refresh.

The runner requires each of the following:

1. **Edit.** The refresh-starting response is stale. The edit is fresh within the 60 s freshness window plus 15 s.
2. **Held refresh.** Exactly one held read, and every in-flight follow-up is immediate and stale. Follow-ups count as in flight only if they ended before the starter's start plus 3 s. Immediate stale alone does not prove failure. Five seconds later, a faulted request and then a tokenless request must still show the last edit, and the tokenless request must start no read. The newer committed edit must stay hidden.
3. **Global backoff.** A new unknown slug without the token answers 503 with `Retry-After` and starts no read. Probes with fresh slugs show the backoff ending 28–42 s after the held refresh. The newer edit then appears.
4. **Archive.** After the first 404, every response is 404. That includes immediate stale 404s during a held refresh, the tokenless backoff check with no read, and the unchanged refresh after backoff.
5. **Reactivation.** Exactly one stale 404 starts the changed refresh. After the quiet wait, the response is 200 with the latest edit.
6. **Cold negatives.** A second seeded villa, `garden-suite`, is archived before its key is ever read. A brand-new unknown slug is also requested. Each must return a fenced first 404 with 2 reads, then a cached 404 with 0 reads. Teardown reactivates `garden-suite`. Sometimes storage cannot read a generation back. The source then bypasses the cache for 5 s, answering with `bypass` after one uncached read. Such a response is recorded and must be a 404 with exactly one read. The still-empty key is retried once after the window, and the fenced contract must hold there. A second bypass fails the run.

The global-backoff probes use unknown slugs only. The room's refresh after backoff is then attributed to the room's own refresh-starting response.

Thresholds come from `VILLA_SWR_FRESH_MS`, `VILLA_SWR_BACKOFF_MS`, `VILLA_SWR_IMMEDIATE_MS` and `VILLA_SWR_BURST`. Setup and teardown are shared with the blocking runner in `tests/bench/villa-preview-target.ts`.

### Stale-while-revalidate acceptance results

Each attempt used its own freshly seeded Convex Preview and protected Vercel deployment, built remotely from the listed source. Each was torn down: villas restored, the owner grant removed, run-owned Clerk users deleted, and the deployment removed by exact name. The runner revision is this file's commit.

| Attempt | Source | Result | Detail |
|---|---|---|---|
| [1](start-villa-preview-outage/swr/attempt1-b1958145-worker-changed.json) | `b1958145` | inconclusive at edit | Concurrent bursts reached a second instance. Its first answer took 2,489 ms: a cold start, not origin blocking. Coalescing is now checked with sequential follow-ups. |
| [2](start-villa-preview-outage/swr/attempt2-b1958145-reactivation-stale.json) | `b1958145` | failed at reactivation | 1.5 s after the stale 404 that started the refresh, the room still answered a stale 404. |
| [3](start-villa-preview-outage/swr/attempt3-aea4cc51-attribution.json) | `aea4cc51` | runner attribution | The room's refresh started inside the backoff probe loop. Probes now use unknown slugs only. |
| [4](start-villa-preview-outage/swr/attempt4-2822f6a5-passed.json) | `2822f6a5` | passed | |
| [5](start-villa-preview-outage/swr/attempt5-2137050b-unknown-one-read.json) | `2137050b` | failed at the last cold unknown 404 | The response was `bypass` (storage could not read the generation back), with one uncached read. Bypass is now recorded and retried once. |
| [6](start-villa-preview-outage/swr/attempt6-86a3b5cd-passed.json) | `86a3b5cd` | **passed** | No storage bypass occurred. |

Attempt 6 ran on one worker for 108 responses, all under the 2 s budget. Origin detail reads matched every transition: edit 2, held refresh 1, tokenless request in backoff 0, new unknown slug in backoff 0, room refresh after backoff 2, archive 2, held archived refresh 1, archived refresh after backoff 1, reactivation 2, cold archive 2 then 0, unknown slug 2 then 0. Every refresh-starting response began exactly one read.

| Step | Measured |
|---|---|
| Edit | Stale `seeded` served 754 ms after the write by the response that started the refresh. Fresh `edited` 7,070 ms after the write, after the 5.5 s quiet wait. |
| Held refresh | Starter 400 ms. All 3 follow-ups (551–572 ms) finished inside the in-flight window and were stale. The warm fallback (664 ms) and the tokenless request (326 ms, no read) still showed the last edit 8.1 s after the held refresh started. |
| Global backoff | A new unknown slug got 503 in 624 ms with no read. Backoff ended 35,493 ms after the held refresh started. The newer edit appeared after one stale starter. |
| Archive | 404 61,195 ms after the write. A held refresh served immediate stale 404s (322–415 ms, 3 follow-ups in flight). 404 continued through backoff and the unchanged refresh 40.1 s later. |
| Reactivation | One stale 404 (334 ms) started the changed refresh. After the quiet wait: 200 with the latest edit, 62,445 ms after the write. |
| Cold negatives | Archived `garden-suite` and a new unknown slug each gave a fenced 404 (`miss`, 2 reads), then a cached 404 (`hit`, 0 reads). |

Per-leg response time, attempt 6 (ms):

| Leg | n | min | p50 | p95 | max |
|---|---:|---:|---:|---:|---:|
| healthy | 1 | 739 | 739 | 739 | 739 |
| edit | 2 | 380 | 434 | 434 | 434 |
| held refresh | 16 | 326 | 572 | 714 | 714 |
| global backoff | 15 | 321 | 446 | 624 | 624 |
| archive | 52 | 312 | 422 | 653 | 813 |
| reactivate | 18 | 321 | 345 | 654 | 654 |
| cold archive | 2 | 364 | 621 | 621 | 621 |
| unknown slug | 2 | 587 | 618 | 618 | 618 |
