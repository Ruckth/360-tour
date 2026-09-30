# Convex query optimization: implementation report

Final coordinator validation (after all 10 audit-fix items): Node 22.22.3 `pnpm verify` passed, including 72 files / 558 unit tests and the default production build; separate Convex typecheck passed. Booking/home/chat Chromium E2E: 41 passed using a local demo server. See [independent review and validation](./convex-query-optimization-review.md).

Date: 2026-09-30 · Base: `6473a2b` · First implementation: `64cb008` · Spec: [convex-query-optimization-audit.md](./convex-query-optimization-audit.md)

All changes are local to this branch. Nothing was deployed, migrated or seeded, and no Convex dev/deploy command was run. The second half of this report lists the fixes made after the independent review of `64cb008`.

## Status by finding

| ID  | Status | Summary |
| --- | --- | --- |
| F1 | Done | One overlap helper for every availability/booking check. It reads all relevant bookings with no max-stay assumption, counts reads against a shared per-invocation budget, and refuses (throws) instead of answering from a partial read. |
| F2 | Done | Admin calendar finds overlapping stays and host blocks per villa with two-sided scans under the shared budget, validates the range (max 62 days), and reports `complete: false` on any truncation, including a 101st villa. |
| F3 | Done | iCal remove/relabel/prune run in batches until finished. A `deletingAt` lifecycle, a per-sync `syncTicket` (fetch-to-apply) and a `syncGeneration` (prune) guard against stale syncs, URL changes and removal. |
| F4 | Done | Booking funnel and chat card load the selected villa's blocked nights per month. Months still loading or that failed count as unavailable and show a retry. The server validates ranges and a shared read budget, and the legacy whole-catalog call is bounded too. |
| F5 | Done (first round) | Per-call reuse of latest-message and villa lookups, two filter indexes, heartbeat writes only changed fields, transcript no longer reads the session. Presence split deferred (needs metrics). |
| F6 | Done | List previews plus `adminGetAnswerDetail`. Saving questions requires the ids the editor loaded, so unseen questions are never deleted. |
| F7 | Done | Scope-first approved AI context; exact approved answers resolved from scope rows and full candidate ranges; curated exact matches via a variants table merged with the legacy scan until cutover; unknown-group suggestions in their own query; concierge reads in parallel. |
| F8 | Done | Normalized phone/email fields and indexes, confirmation-code index, guest-name search index; lead dedup via a full-key index. |
| F9 | Done | Data migrations run on `@convex-dev/migrations` (batching, progress, resume, dry run), with per-transaction read/write guards. |
| F10 | Partly done | Done: selected-staff schedule reads; social-proof rebuild as a component migration. Deferred (need metrics): review rating deltas, `countUpcoming` early exit, `findOpenSlots` read reuse, index cleanup. |

## Changes

### Shared read budget (`convex/lib/readBudget.ts`)

Convex limits one transaction to 32,000 documents scanned, 4,096 index ranges plus gets, 16 MiB read and 16,000 documents written ([limits](https://docs.convex.dev/production/state/limits)).

`ReadBudget` counts documents, ranges and bytes (UTF-8 JSON size). `readBudget(ctx)` returns the budget of the current invocation: it is keyed on the handler's `ctx`, so every helper called with that `ctx` adds to the same totals. The limits leave headroom: 16,000 documents, 2,000 ranges, 8 MiB.

- `readRangeWithinBudget` reads a whole index range or throws `ReadBudgetExceeded`, never returning part of it.
- `reserveWrites` caps one invocation at 12,000 writes.
- `convex-test` does not enforce production limits; these counters are what keep calls inside them.

Paths under the budget:

- booking overlap and night checks
- availability reads, including the legacy whole-catalog call
- the admin calendar
- the iCal export
- exact approved-answer lookup
- approved AI context
- curated exact lookup
- migration batches

Other reads keep their existing fixed `take` bounds (chat lists, knowledge lists, search), which are well under the limits.

A total budget does not bound how many reads run at once, and Convex caps concurrent I/O per invocation at 1,000. Budgeted helpers therefore never fan out over data-sized arrays. Per-item reads run one at a time and check the range budget before each read starts, so once the budget is spent nothing further is launched. The only concurrent reads left are fixed pairs, such as the two index ranges of an overlap scan.

### F1 Booking overlap (`convex/lib/stayOverlap.ts`)

- `lockstepOverlap` reads two index ranges that each contain every overlapping row: rows starting before `to`, newest first, and rows ending after `from`, soonest first. Once either range is exhausted the answer is complete; cost is about 2 × the smaller side, with no max-length assumption.
  - Used for bookings (`by_property_checkIn` + `by_property_checkOut`) and host blocks (`by_property_start` + new `dateBlocks.by_propertyId_and_end`).
  - `OVERLAP_SCAN_LIMIT` is 1,000 rows per side, and the shared budget also applies. When the scan is incomplete, correctness checks throw and the calendar reports `complete: false`.
- `findBlockingNight` reads every availability row in the range (a night can have several), refusing more than 20 rows per night. `nightRows` does the same for one night, for the writers.
- `blockBookingDates` is the single place a booking's nights are validated and held, inside the caller's transaction. It checks overlapping confirmed/completed bookings on the bookings table, then every row of every night, before writing any row.
  - Callers: payment confirmation, checkout hold, admin confirm/create/edit.
  - `markBookingPaid` no longer runs a separate availability check followed by a second overlap scan inside the hold. The hold validates, and a conflict throws before anything is marked paid.
  - `editBooking` for a stay that holds dates now relies on the hold alone instead of `assertStayFree` plus the hold.
- `releaseBookingDates`, `writeDateBlockRows` and `releaseDateBlockRows` have explicit row bounds and throw beyond them.

### F2 Admin calendar (`adminBookings.listForAdmin`)

- Validates `from < to` and at most 62 days (the widest calendar view is about 43 days).
- Reads 101 villas and shows 100; a 101st sets `complete: false`.
- Per villa, sequentially under one budget:
  - booking overlap scan
  - two-sided host-block scan, so a long block that has no availability rows is still found behind any number of expired blocks
  - every availability row in range, up to 20 per night
- Budget exhaustion, a per-villa scan limit or the villa overflow sets `complete: false`, and `AdminBookingsView` shows an alert.

### F3 iCal (`convex/ical.ts`; schema `icalSources.deletingAt`, `syncGeneration`, `syncTicket`)

- `beginSync` allocates a new `syncTicket` before the feed is fetched and returns the URL to fetch.
  - `applySource(sourceId, ticket, dates)` and `recordSyncError(sourceId, ticket, message)` only write while that ticket is current. The ticket is required; there is no bypass.
  - A later sync, a URL change or `removeSource` bumps the ticket. So a slow fetch of an old URL can't apply, even if the URL was changed back (A → B → A), an older sync can't overwrite a newer one in either finishing order, and a stale error can't overwrite a newer success.
  - A platform-only change keeps the ticket: the feed URL is the same, and applied rows get the current platform.
- `syncGeneration` (bumped by each applied sync and by URL changes) stops a superseded background prune.
- Remove, relabel and prune run in batches of 200 until done; `applySource` checks each night through the bounded `nightRows`.
- `getExport` counts reads against the shared budget and the 5,000-row cap, refusing rather than exporting a partial calendar.

### F4 Availability (`convex/availability.ts`, `src/lib/booking/*`, funnel and chat card)

- Server:
  - Every range is validated: end ≥ start, at most 366 dates.
  - Rows are read in full (at most 20 per night) under the shared budget, and blocked dates are de-duplicated.
  - `getForProperty` returns only `{ date, status, source }`.
  - `getBlockedDatesByProperty(propertyIds)` accepts at most 100 ids and 3,100 villa-dates, active villas only. Without `propertyIds` (clients from before this deploy) it reads at most 100 active villas and refuses on a 101st or when the budget runs out. The old full-year catalog request is served only while it fits the budget; otherwise the old client gets an error.
- Client:
  - `BlockedMonthsStore` loads blocked nights per villa and month; `useVillaBlockedMonths` wraps it.
  - Months still loading (`pendingMonths`) or whose load failed (`failedMonths`) are unknown. Their days are disabled in both the booking funnel and the chat booking card, the stay can't continue or open booking, and a localized error with a "Try again" button calls `retry`.
  - A failed month is not silently retried or treated as free. A late response from an older attempt can't overwrite a retry.
  - `useStayBlockedDates` checks every listed villa only for the chosen stay, in budget-sized batches. Unknown results mark no villa as taken; the booking mutation re-checks atomically on the server.
- The session cache stores only the villa list (version 2). The new strings are in all 11 locales (`Booking.availabilityLoadFailed`, `Booking.retryAvailability`).

### F5 Admin chat (`convex/adminChat.ts`, `convex/chat.ts`, schema)

- `createSessionLookups`: one latest-message read and one villa read per session per call, shared by filters and row decoration.
- Indexes `chatSessions.by_adminStatus_and_latestMessageAt` and `by_channel_and_latestMessageAt` serve the non-empty list for resolved/archived and single-channel filters. `open` keeps the default index because `undefined` means open.
- `touchSession` writes `lastSeenAt` plus only fields that changed, and looks up the villa only when it changes.
- `listTranscriptMessages` no longer reads the session.

### F6 Knowledge list/detail (`convex/chatKnowledge.ts`, `AnswerFormDialog`, `QuestionsView`)

- List rows carry at most 10 approved questions (primary always included, index `chatQuestions.by_answerId_and_status_and_isPrimary`), 3 suggested and 10 rejected, plus `questionsTruncated`.
- `adminGetAnswerDetail` returns every approved question up to the 1,000 edit limit. The edit dialog mounts only after it loads.
- `adminUpdateAnswer` requires `baseQuestionIds` when editing questions and deletes only questions from that list. Questions added meanwhile are kept (demoted from primary).

### F7 Knowledge resolution

- `getApprovedContext` (logic in `approvedContextFor`) caps nothing before an answer's eligibility is known:
  - this villa's scope rows (custom slug, real villa, multi-villa) and its legacy approved answers (`answer.propertyId`) are read in full within the budget
  - answers are joined one at a time, reusing the legacy answers already read
  - answers for every villa (no villa id, no scope rows) are read newest first until 30 are found, and aren't read at all when this villa alone has 30

  Every read is counted, and the range budget is checked before it starts. If the budget runs out it throws "Too much approved knowledge to build the AI context safely." instead of returning a partial context. Precedence, the approved-only rule, other-villa exclusion, the 30-answer limit and legacy `answer.propertyId` handling are unchanged.
- `getExactCandidates` no longer selects a capped candidate set first. It reads, in full and within the budget:
  1. this villa's scope rows (custom slug, real villa, multi-villa), then each scoped answer's questions with this wording (`by_answerId_and_normalizedQuestion`)
  2. approved questions with this wording and this villa's id
  3. approved questions with this wording and no villa id (global, custom or multi-villa)

  Scoped answers' question ranges and answer documents are read one at a time, checking the range budget before each. Each answer document is read and counted once, however many of its questions match; scope rows are cached per call. Ranking is unchanged: villa, then every-villa answers; within a rank the AI trigger, then primary, then newest. Other villas' scoped answers never match. If the ranges don't fit the budget it throws "Too many answers share this question to pick one safely." rather than guessing; callers treat a failed lookup as no exact answer.
- Curated exact matches:
  - Table `curatedChatQuestionVariants` (index `by_normalizedVariant_and_propertySlug`), kept in sync by every curated writer and the seed.
  - `resolveCuratedExact` reads the full variant and English-question ranges for the global and session-villa scopes within the budget, so archived rows can't crowd out an active one. Items found through variant rows are then read one at a time, with the range budget checked first, skipping items already read through the English index.
  - Until the variants backfill is verified and the cutover deploy removes it, the legacy score-ordered scan is always merged in and de-duplicated, not only when the index finds nothing. Ranking stays the scan's own (villa scope, then score, then newest), so a new indexed global item can't outrank a villa-scoped legacy one.
- `adminSuggestAnswersForUnknownGroups` computes suggestions separately from `adminListUnknownGroups`.
- `generateConciergeReply` runs its four independent reads in parallel; AI-pause checks and booking tool writes are unchanged.

### F8 Search and leads

- `bookings.guestPhoneDigits` / `guestEmailNormalized` (optional, written on create/edit), indexes `by_guestPhoneDigits`, `by_guestEmailNormalized`, `by_confirmationCode`, search index `search_guestName`.
- `searchBookings`:
  - Exact phone, email and code match bookings of any age.
  - Names match on word prefix through the search index, with no typo tolerance.
  - Substring matches cover the newest 1,000 bookings, as before.
- `findGuests` adds exact lookups; `stays` is labelled "bookings found".
- `recordLead` uses `leads.by_email_and_source_and_propertyId` with `.first()`.

### F9 Migrations (`convex/migrations.ts`, `convex/convex.config.ts`)

- `@convex-dev/migrations@0.3.4` is installed. It is the newest release whose peer range accepts the project's `convex@1.34.1`; 0.3.5+ require `convex@^1.35`. The component is registered in `convex/convex.config.ts`.
- `migrations.runner()` is exported as `run`. `runQueryOptimizationBackfills` runs this rollout's backfills in order. Status: `npx convex run --component migrations lib:getStatus`.
- Every migration is idempotent and keeps its previous entrypoint name:
  - `backfillChatMessages`: batch size 1. One session's embedded array is at most 8,192 messages, so at most 8,193 writes per batch.
  - `backfillChatSessionAdminMetadata`: batch size 4 × at most 501 messages read. `messageCount` above 500 stays a logged lower bound.
  - `recomputeAllSocialProof`: one villa per batch.
  - `backfillBookingGuestLookup`: 100 per batch.
  - `backfillCuratedQuestionVariants`: 50 per batch.
- The component lets callers override `batchSize`. Each `migrateOne` therefore counts its reads (`readBudget`) and writes (`reserveWrites`) for the transaction. An oversized batch fails with an explicit error, leaving nothing half-written, and the migration resumes from the failed batch when run again with the safe size (tested).
- iCal remove/relabel/prune are not data migrations. They are operational cleanups tied to one feed's lifecycle, and they self-schedule in 200-row batches with lifecycle guards.
- `recomputeSocialProof` reads one villa's reviews in full, the same read the review editor does on every change; that assumes a villa's reviews fit one transaction. The review-counter redesign is deferred (F10).

### F10

- `adminServices.listSchedule` reads only the selected people's appointments when 10 or fewer are selected.

### Generated code and types

- `convex/_generated/api.d.ts` was edited by hand for the new `lib` modules and `components.migrations`, because codegen contacts the deployment. Regenerate it in the normal deploy flow.
- `types/convex-migrations-test.d.ts` (mapped with tsconfig `paths` in both tsconfigs) types `@convex-dev/migrations/test`. That entry ships as TypeScript source with a `vite/client` reference, whose `ImportMeta.glob` clashes with our test files' declarations. vitest still loads the real module.

## Fixes after review of `64cb008`

| # | Finding | Fix | Regression |
| --- | --- | --- | --- |
| 1 | Calendar dropped a mirror-less long host block behind 100 expired blocks and claimed `complete`; a 101st villa was ignored | Two-sided block scan (new `by_propertyId_and_end`); `take(101)` villas, overflow → incomplete | `shows a mirror-less long host block behind 101 expired blocks`, `says the view is incomplete when there are more villas than it shows` |
| 2 | No shared transaction budget; legacy catalog path unbounded | Per-invocation `ReadBudget` across availability, calendar, overlap, night reads, export, exact lookups; legacy path bounded (≤100 villas + budget); night-row and write bounds in writers | `counts documents, bytes and ranges…`, `refuses availability and marks the calendar incomplete once reads pass the byte budget`, `bounds the legacy whole-catalog availability call` |
| 3 | iCal fetch race (A → B → A accepted a stale fetch; stale errors) | `beginSync` tickets, required on apply/error, bumped by sync/URL change/remove | `sync tickets` suite in `ical.test.ts` (A → B → A, both finishing orders, stale errors, platform change, delete race) |
| 4 | Custom/multi-villa exact answer lost behind 102 other custom scopes | Scope-first, full-range exact lookup within budget; explicit error if it can't fit | `finds the custom-scoped answer behind 102 other custom scopes…` |
| 5 | Indexed curated match returned early and could bypass a scoped legacy match; `take(20)` crowded by archived rows | Legacy scan merged until cutover; full budgeted ranges | `keeps a villa's legacy translated item ahead…`, `finds the active item behind 25 archived items…` |
| 6 | Legacy message backfill could exceed 16,000 writes; metadata backfill could exceed 32,000 reads; component not used | Migrations component, safe batch sizes, per-transaction read/write guards | `moves embedded messages… once`, `refuses a batch that would pass the write limit, then resumes…`, component-run backfill tests |
| 7 | Failed month load treated as free with no error or retry | `BlockedMonthsStore`: failed or pending months stay unavailable, with a visible localized retry in both UIs | `tests/unit/booking-blocked-months-store.test.ts` (navigation, villa switch, failure, retry, stale attempt) |
| 8 | Payment ran the overlap scan twice | Validation consolidated into the hold (`blockBookingDates`), no skip flag | `checks a payment with one overlap scan and one read per night` (asserts 2 + nights ranges) |
| 9 (P2, follow-up) | A total budget didn't bound concurrent I/O: `getExactCandidates` read every scoped answer's questions with one `Promise.all`, and `exactCuratedCandidates` fetched every variant's item with one `Promise.all` and checked the budget only afterwards. About 1,001 scoped answers or variants could launch more than 1,000 concurrent reads (and more than 4,096 ranges) before any guard ran | Both loops now read one item at a time and check the range budget before starting each read. Answer documents are read and counted once. Variant items already read through the English index are skipped | `exact-match reads run one at a time and stop at the budget` in `knowledgeScale.test.ts`: an instrumented `ctx.db` counts reads in flight and reads started. 40 scoped answers and 40 translated curated items never run more than the two fixed paired ranges at once, and with the range budget 10 short of its limit no more than 10 reads start before `ReadBudgetExceeded`. With the previous `Promise.all` code these three tests fail |
| 10 (P1, final spec review) | `getApprovedContext` still took the 200 newest-*created* scope rows, and the 200 newest global answers, before checking eligibility. A recently edited old answer for this villa was dropped behind 200 newer scope rows: the real-villa legacy fallback found it but rejected it because it had scope rows, and custom or multi-villa scopes had no fallback at all. An older answer for every villa was also crowded out by 200 answers scoped to other retreats | Full budgeted reads of this villa's scope ranges and legacy answers; global answers read newest first until 30 eligible are found; explicit refusal when the budget runs out | `approved AI context reads every eligible answer` in `knowledgeScale.test.ts`: old real and multi-villa answers updated last, behind 201 newer-created scope rows; old custom-scoped answer behind 201; older every-villa answer behind 201 answers for other retreats; budget exhaustion (20 × ~500 KB answers, and a spent range budget) rejects instead of returning partial context. All 4 fail against `9058413` (answers missing, partial context returned) and pass now |

Behavior change from fix 8: a payment that hits an OTA or host block now fails with "Some of these dates are blocked…" instead of "These dates are no longer available…". Both are refusals raised before anything is marked paid.

## Tests and checks

- With the `64cb008` versions of the changed modules temporarily restored (new schema kept), 27 of the new or updated tests fail and all pass now. The earlier 24 base-commit regressions still pass. Some iCal tests fail on `64cb008` partly because `applySource` now requires a ticket; the A → B → A test covers the behavior itself.
- Under Node 22.22.3 (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`):
  - `pnpm verify` passes: typecheck, lint, 72 test files / 551 tests, Turbopack `next build` (exit 0, 111/111 pages).
  - `tsc -p convex/tsconfig.json` (the config Convex type-checks with) passes.
  - During prerender the build fetches from the deployment configured in `.env.local` and logs `[villas] list failed … Server Error` before serving its fallback. That deployment doesn't run this branch. Whether the same log appears at the base commit was not checked.
- Follow-up fix 9 (bounded concurrency) was checked under Node 22 with `pnpm typecheck`, `pnpm lint` (no errors; one warning, in the coordinator's `.audit-e2e.config.ts`) and the affected suites: `knowledgeScale`, `chatKnowledge`, `chatSuggestions`, `knowledgeAdmin`, `chatAi` and `line`, 84 tests passing. `getExactCandidates` and `exactCuratedCandidates` are exported only so the instrumented tests can call them with a wrapped `ctx`. The full verify/build was left to the coordinator's final run.
- Fix 10 (approved context) was checked under Node 22.22.3:
  - `pnpm typecheck` passes.
  - `tsc --noEmit -p convex/tsconfig.json` passes.
  - `pnpm lint` passes with no warnings.
  - The affected suites pass: `knowledgeScale`, `chatKnowledge`, `knowledgeAdmin`, `chatAi`, `chatSuggestions`, and the `line`, `facebook`, `instagram` and `whatsapp` webhooks, 94 tests.

  `approvedContextFor` is exported so the budget test can call it with a spent budget. The coordinator's final verify/build and E2E evidence are in the review document.
- The earlier webpack-only route-export error in `src/app/api/whatsapp/webhook/route.ts` comes from the base commit and was not changed.

## Rollout

1. Deploy schema, code and the component together (`convex/convex.config.ts` adds `migrations`). All schema changes are additive, and new indexes on existing fields need no data changes.
2. Backfills, dry run first:
   - `npx convex run migrations:run '{"fn": "migrations:backfillCuratedQuestionVariants", "dryRun": true}'`
   - `npx convex run migrations:runQueryOptimizationBackfills` (curated variants, then booking guest lookup)
   - `npx convex run --component migrations lib:getStatus --watch` until both are `success`. A rerun skips finished migrations; `reset: true` restarts one.
   - Optional, only for legacy data: `migrations:backfillChatMessages`, `migrations:backfillChatSessionAdminMetadata`, `migrations:recomputeAllSocialProof`, via `migrations:run` with `fn`.
3. Verify on the deployment:
   - Old bookings are found by phone.
   - The calendar reports `complete`.
   - Removing a feed leaves no rows.
   - The answer list and edit dialog work.
   - Curated translated questions match.
4. Cutover, in a later deploy after verification:
   - Remove the legacy scan merge in `resolveCuratedExact`.
   - Optionally drop the raw `by_guestPhone` lookup in `findGuests`.
   - Remove the no-`propertyIds` path of `getBlockedDatesByProperty`.
5. Old browser tabs:
   - Admin tabs that edit questions get "Reload the page…".
   - Old booking tabs call the bounded whole-catalog path, which errors once the catalog's rows no longer fit the budget. Those tabs then fall back to their existing demo-inventory notice (or their cached villa list) until reloaded.

## Limitations and deferred work

- No production metrics: no p95, documents or bytes read, rerun counts or table sizes. `convex-test` confirms logic and read accounting, not latency, OCC or subscription cost, and there are no savings claims. The budget's byte count is our UTF-8 JSON estimate, not Convex's internal measure, so the 8 MiB limit keeps a 2× margin.
- Deferred, pending measured signals as the spec requires:
  - presence split
  - digest/summary tables and aggregates
  - review counters
  - `countUpcoming` early exit
  - `findOpenSlots` read reuse
  - pending-variants badge
  - index cleanup
- Explicit limits that refuse or flag instead of truncating:
  - overlap scan: 1,000 rows per side
  - rows per night: 20
  - shared budget: 16,000 documents, 2,000 ranges, 8 MiB
  - writes: 12,000
  - feed nights: 400
  - export rows: 5,000
  - calendar: 62 days, 100 villas
  - availability range: 366 dates
  - multi-villa read: 100 ids, 3,100 villa-dates
- Substring booking search still covers the newest 1,000 bookings.
- Legacy chats without `latestMessageAt` stay out of the default non-empty list until `backfillChatSessionAdminMetadata` runs.
