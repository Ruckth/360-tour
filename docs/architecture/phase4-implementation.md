# Phase 4 implementation and rollout

**Current status:** independently reviewed and production-backend accepted at source `49b3de8`; all 32 gates and final integration passed. `.arch-phase` is **4**, and PR 84 targets `main`. The completion section records root operations; earlier sections preserve implementation-time evidence.

The implementation starts at the required parent `161541b147c5e6943e4f4430c0ae70e71912839a` and incorporates parent follow-ups `17ba250`, `3eb40dd` and `b3909c9` through normal Git updates (the final update is a merge) in the prepared isolated checkout. The original stacked base was `t3/phase3f-local-dev-preview` / [PR 83](https://github.com/Ruckth/360-tour/pull/83), now merged. The initial implementation held `.arch-phase` at **3** until root acceptance. Convex remains the lockfile-pinned **1.50.0**. Parent Preview reuse, guarded dev/Preview startup, retention protections and bounded test workers remain intact.

Root owns independent reviews, CI/Preview acceptance, all shared/live data operations, production acceptance and merges. The implementation agent performed no shared, Preview or production backend operation, business-provider request, reset, retention deletion or merge; root operations are recorded in the completion section.

## Metrics and measured behavior

| Measurement | Fixed parent | Phase 4 |
| --- | ---: | ---: |
| Phase 3 static gates | 30/30 | 30/30 |
| `no-login-without-returns` | 52 | 0 |
| No-login registered endpoints with explicit returns | 1/53 | 53/53 |
| `phase4-tests` | 0 | 1 |
| Inbox documents read for ten external-channel rows, each linked to a different villa | 40 | 20 after initialization |
| Same inbox before initialization, including readiness check | — | 41; identical ten rows |
| Inbox after adding sixty unrelated processing conversations | — | 20; identical ten rows |
| Review create with 1,003 existing initialized reviews | linear source scan | 3 document reads, including the replacement's database read |
| Release two stay-owned nights among 300 unrelated feed rows | date-range scan | 4 document reads, including deletion reads; zero on repeat |
| App tables | 74 | 74 |

The exact named test **`lists the inbox within the read budget`** lives in `convex/queryScale.test.ts`. It uses `ctx.meta.getTransactionMetrics()` from real Convex database transactions, including source reads, joins and readiness. The baseline was independently run against the exact parent's `adminChat.ts`, archived under ignored `output/phase4/` without another checkout. After initialization, ten conversation rows plus ten distinct property reads satisfy at most one additional document read per returned row. It also proves dry-run nonmutation, idempotent initialization and sparse indexed filtering. A second test resumes an existing filtered cursor across initialization without duplicates or dropped rows.

`phase4Performance.test.ts` measures write-path reads with the same real counter. Convex counts the existing document read by replacement/deletion, so these totals include that work. Tests cover concurrent review creates, edit rounding, exact initialization from rounded stored averages, final deletion, repeated deletion, transaction rollback, oversized initialization refusal and booking-release rollback/idempotence.

## Response contracts and privacy

All 53 current `public*`, `guest*` and `device*` registrations declare returns. Fifty-two declarations are added; `messaging/chat:sendMessage` already declared its return. Validators live in each owning domain's `validators.ts`. Appropriate shapes are shared with catalog/auth/messaging table schemas, service public fields, availability status, public settings fields and the existing booking coupon snapshot. The shared appointment audit validator defines the same historical payload for its retained and canonical storage.

No blanket `v.any`, unsafe production cast, forwarding endpoint, inventory exemption or weakened record guard is added. Public property, scene, review, snippet, user and guest-message readers select their published fields. In particular, `getSocialProof` excludes the new private exact rating sum. Existing property-active checks, self identity lookup, guest-token hashing, device-token behavior, booking access tokens, signed proposal checks, one-use handoffs and display leases remain. Integer satang/BPS rules and each existing absent/optional/null distinction remain: public villa copy still normalizes translations to `[]` and edit time to `null`; the older property API preserves omitted optional copy; absent records stay `null` or empty lists according to their established contract.

`phase4Returns.test.ts` inventories every no-login endpoint and exercises the harness's actual registered return validation by fault-injecting an invalid handler result. The underlying `convex-test` 0.0.53 implementation has no `record` validation case. The one record response (`getBlockedDatesByProperty`) is therefore checked for its exact declared record/array/string validator in the harness **and tested against an actual isolated Convex 1.50.0 backend**: an invalid `{ wrong: 1234567 }` response is rejected by the real return validator. That fault exists only in a disposable source copy; no RPC is added and no fault is deployed remotely. Local CLI codegen and `function-spec` are run against that same isolated backend with real application auth configuration restored before capture.

The existing functional suites run the successful and refused business responses under the new runtime validators; the new catalog test also rejects an extra private iCal token in a response and checks active/draft and optional-field behavior. Full response coverage is mapped below. Every row also appears in the runtime contract inventory; the record exception is addressed above.

| Endpoint | Successful/refused response suites |
| --- | --- |
| `services/publicServices:categories` | `publicServices.test.ts` |
| `services/publicServices:list` | `publicServices.test.ts` |
| `services/publicServices:getBySlug` | `publicServices.test.ts` |
| `messaging/chatSuggestions:nextForSession` | `chatSuggestions.test.ts`, `phase0Security.test.ts` |
| `messaging/chatSuggestions:markShown` | `chatSuggestions.test.ts`, `phase0Security.test.ts` |
| `messaging/chatSuggestions:markClicked` | `chatSuggestions.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:createSession` | `chatReuse.test.ts`, `adminChat.test.ts`, `factRetrieval.test.ts` |
| `messaging/chat:touchSession` | `adminChat.test.ts`, `hotspotMeasure.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:closeSession` | `phase4Returns.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:createBrowserHandoff` | `chatBrowserHandoffs.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:claimBrowserHandoff` | `chatBrowserHandoffs.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:identifyVisitor` | `adminChat.test.ts`, `serviceBookings.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:getSession` | `hotspotMeasure.test.ts`, `chatReview.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:isAiPaused` | `phase4Returns.test.ts`, `phase0Security.test.ts` |
| `messaging/chat:getMessages` | `chatReuse.test.ts`, `chatAi.test.ts`, `chatAdmission.test.ts` |
| `messaging/chat:sendMessage` | `chatAdmission.test.ts`, `maintenanceGate.test.ts`, `phase0Security.test.ts` |
| `messaging/leads:save` | `listPagination.test.ts`, `leads.test.ts`, `queryScale.test.ts` |
| `marketing/public:resolveLink` | `marketing.test.ts`, `marketingAffiliates.test.ts` |
| `marketing/public:recordOpen` | `marketing.test.ts`, `marketingAffiliates.test.ts` |
| `marketing/public:startSession` | `marketingCapture.test.ts`, `marketingAffiliates.test.ts`, `marketingReport.test.ts` |
| `marketing/public:previewCoupon` | `marketing.test.ts`, `couponRedemptions.test.ts` |
| `marketing/access:current` | `marketingAccess.test.ts`, `marketingAffiliates.test.ts` |
| `marketing/report:noteCouponRefusal` | `marketingReport.test.ts` |
| `auth/users:current` | `authOwnership.test.ts`, `auth/accessBuilders.test.ts` |
| `auth/staffAccess:myAccess` | `staffRoles.test.ts`, `authOwnership.test.ts` |
| `bookings/bookings:quoteStay` | `adminBookings.test.ts` |
| `bookings/bookings:create` | `bookingResortDay.test.ts`, `marketingCapture.test.ts`, `couponRedemptions.test.ts` |
| `bookings/bookings:getById` | `couponRedemptions.test.ts`, `orderAudit.test.ts`, `pos.test.ts` |
| `bookings/bookings:getConfirmProposal` | `bookingRules.test.ts`, `chatCoupons.test.ts`, `messaging/toolRecovery.test.ts` |
| `bookings/bookings:confirmProposal` | `marketingCapture.test.ts`, `bookingRules.test.ts`, `marketingAffiliates.test.ts` |
| `pos/displays:claimLink` | `displayLifecycle.test.ts`, `displayLeaseRelease.test.ts`, `displays.test.ts` |
| `pos/displays:startPairing` | `displayLifecycle.test.ts`, `displays.test.ts` |
| `pos/displays:releaseDisplay` | `displayLifecycle.test.ts`, `displayLeaseRelease.test.ts` |
| `pos/displays:current` | `displayLifecycle.test.ts`, `displayLeaseRelease.test.ts`, `displays.test.ts` |
| `pos/displays:heartbeat` | `displays.test.ts` |
| `bookings/calendar/availability:getForProperty` | `queryScale.test.ts` |
| `bookings/calendar/availability:getBlockedDates` | `ical.test.ts`, `queryScale.test.ts` |
| `bookings/calendar/availability:getBlockedDatesByProperty` | `queryScale.test.ts` |
| `bookings/calendar/availability:isAvailable` | `ical.test.ts`, `queryScale.test.ts`, `payments.test.ts` |
| `bookings/payments/stripe:createCheckout` | `phase1Architecture.test.ts`, `bookingRules.test.ts`, `payments.test.ts` |
| `settings/settings:publicProfile` | `settings.test.ts`, `bookingRules.test.ts` |
| `catalog/properties:list` | `otaRates.test.ts`, `properties.test.ts`, `adminProperties.test.ts` |
| `catalog/properties:getBySlug` | `phase4Returns.test.ts` |
| `catalog/properties:getById` | `phase4Returns.test.ts` |
| `catalog/properties:getRooms` | `phase0Security.test.ts` |
| `catalog/properties:getTourRooms` | `properties.test.ts` |
| `catalog/properties:getOtaComparison` | `otaRates.test.ts` |
| `catalog/properties:getSocialProof` | `phase0Security.test.ts` |
| `catalog/properties:getReviews` | `phase0Security.test.ts` |
| `catalog/properties:getTourSnippets` | `phase4Returns.test.ts` |
| `catalog/publicProperties:list` | `publicProperties.test.ts` |
| `catalog/publicProperties:getBySlug` | `publicProperties.test.ts` |
| `catalog/publicProperties:featuredReviews` | `publicProperties.test.ts`, `phase0Security.test.ts` |

## Inbox read/write closure

`inboxState` remains the canonical equivalent of `needsStaff`: only `needs_staff` means staff work is needed. Keeping that existing state avoids a redundant boolean whose writes could diverge. `lastActivityAt` stores the existing `getAdminChatSortAt` policy: latest-message time, otherwise last-seen/creation time. Contact/profile metadata updates use the same builder. `by_inboxState_and_lastActivityAt` serves `needs_reply`; activity/channel/admin/message-date filters retain their checks and existing source-order/overflow behavior.

`lastMessagePreview` is one nullable message document, and `lastDeliveryStatus` is one nullable latest channel-event document (including durable Web turns). They retain the complete existing admin list response shapes, including IDs, timestamps, content and event fields; they are not transcript arrays. Keeping that single bounded head avoids changing administrative clients' response contracts. No new summary table, UI, outbox or provider operation is introduced. The remaining property lookup reads its current name, so catalog renames remain visible without another writer fan-out.

Writer closure:

| Writer family | Projection/state behavior |
| --- | --- |
| Web session creation and social ingress session creation | Initialize version, nullable heads, last activity and processing state in the same transaction |
| `pipeline.recordGuest`, `chat.acceptGuestMessage`, assistant-message insertion, `worker.commitTurn`, `adminReply.complete` | Existing shared `patchSessionAfterMessages` now selects the actual indexed message head and stores it with message metadata; timestamp ties/out-of-order ingress follow the same index as reads |
| `chat.sendMessage`, `ingress.accept` | `insertChannelEvent` refreshes the correct channel head atomically |
| Worker claim, prepare, begin/authorize dispatch, commit, retry and terminal failure | `patchChannelEvent` refreshes the actual indexed event head; an older turn's late completion cannot replace a newer event's snapshot |
| Durable preparation and tool results in `claims`, ingress admission/refusal, pipeline reconciliation | Use the same event writer, including tool-result changes and delivery uncertainty |
| Staff takeover/release, staff follow-up/task edits, handoff, accepted reply, timeout, send failure, manual settlement, reopen/archive | Existing authoritative `inboxState` writes remain; the sparse index tracks the same transaction automatically |
| Touch, identification, browser-handoff claim, profile update | Touch keeps both sort fields synchronized; close and browser handoff use the shared metadata builder. Profile writes retain the shared metadata path without rewriting message/event heads |
| Archived-session deletion | Deletes the conversation first, as before, then bounded children; no retained conversation can serve a removed child's cached head |
| Eval creation/transcript writes | Initialize every read head at creation and preserve readiness; retain eval identity/length/pause guards and quota/alert/task exclusions. Transcript writes refresh exact heads and their implicit last-guest state through the messaging model interface |
| Seeds/historical imported rows | Missing projection version keeps the compatibility read path until bounded explicit initialization |

`inboxProjectionReady` checks the separate undefined-version index bucket. A fresh `needs_reply` request uses the new index only when that bucket is empty. Until then, the existing paginated source plus live-message/event reads preserves old rows. A missing head also falls back to the authoritative live query. The cursor records its source index; a request begun before initialization stays on its original index after cutover. Read-only fallback never fabricates a preview or silently interprets missing optional state as false.

`phase4Performance.test.ts` compares stored snapshots with authoritative indexed heads through social admission, claim/profile changes, preparation, dispatch, explicit rejection/retry, uncertainty, newer ingress and staff reply. Existing lifecycle, handoff, replay, takeover, admission, timeout, deletion and concurrent-send suites exercise sibling semantics.

## Review totals and stay release

`reviewStats.ratingTotal` is an optional exact sum. Review create/update/delete adjust exact sum and count before the source write in the same transaction; the average uses the same `Math.round(total / count * 100) / 100` rule. An empty aggregate is deleted, as before. Missing initialization reads at most 1,001 reviews, refuses above 1,000 before changing data, and derives the exact sum from source reviews rather than multiplying a rounded average. Initialized writes never rescan reviews. The guarded empty-backend review seed uses the same incremental model interface; property removal already removes the property's reviews and its aggregate together. Current review update arguments do not support property reassignment; no reassignment API is invented.

`availability.by_bookingId` indexes the existing optional owner field. Convex builds that index over existing rows automatically; no application field repair is needed. `releaseBookingDates` reads only that booking's rows, refuses an overflowing owner range before deletion and leaves other stays, feeds and date blocks untouched.

## One appointment audit record

New creation, tracked edits/financial changes, cancellation and rebooking write **one `recordChanges` document**. Its optional `appointmentAudit` payload preserves the original per-field changes, kind, actor, reason, currencies and audit timestamp; optional `appointmentId`/`at` index fields make that payload pageable. General record-history before/after snapshots, effective time and monetary behavior remain unchanged. Revision/no-op rules still apply in the same transaction.

`appointmentChanges` remains in the schema with all historical data intact. The appointment history reader merges its indexed stream with canonical record entries using the installed `convex-helpers` stream pagination, ordered by `at`. Old `recordChanges` duplicates without the typed payload are excluded from that merged appointment view, so historical pairs appear once. Historical-only appointment entries remain readable; no history is invented for older appointments with no creation evidence. History `_id` is now honestly typed as `Id<'appointmentChanges'> | Id<'recordChanges'>`; values and other history fields retain their shape. Tests cover more than fifty entries, historical-only records, duplicate exclusion, one canonical write, unchanged appointment money and revision.

Other appointment-related general-history events that previously had no `appointmentChanges` counterpart (for example a link change) retain that behavior. This does not unify unrelated audit tables.

## Exact schema/contract deltas

Actual exported schemas were compared against `161541b…`; equivalence correctly reports **false** for the four approved changed tables, with **74 → 74** tables. Every other table export is equal, including schema validators reused from owning files.

| Table | Additive delta |
| --- | --- |
| `conversations` | Optional literal-1 `inboxProjectionVersion`, optional `lastActivityAt`, optional nullable message/event head snapshots; indexes `by_inboxState_and_lastActivityAt` and `by_inboxProjectionVersion` |
| `reviewStats` | Optional numeric `ratingTotal` |
| `availability` | Index `by_bookingId` on the existing optional owner field |
| `recordChanges` | Optional `appointmentId`, `at`, typed `appointmentAudit`; index `by_appointmentId_and_at` |

All **381 existing RPC paths, builder bindings, argument declarations and public reasons/capability/permission declarations** compare equal to the explicit parent. HTTP route assembly is byte-identical. Intentional return declarations, explicit projection implementations, inbox/read/write implementations and appointment-history ID types are reviewed changes, so the old universal initializer/schema equality scripts are not claimed to pass. The local spec matches the complete current RPC inventory and all 53 no-login return declarations. Two new RPCs are internal mutations only: `messaging/projectionMaintenance:initializeInbox` and `catalog/reviewMaintenance:initialize`.

## Root-owned additive rollout and rollback

Root's read-only populated snapshot supplied this sizing evidence: conversations 14, messages 29, reviews 7, reviewStats 3, availability 6, appointments 4, appointmentChanges 0 and recordChanges 32. Those counts justify the migration skill's **small-table shortcut**, with hard bounds and no migrations component. No deployment or data repair is run remotely by this implementer.

1. **Widen/update.** Deploy the optional fields and indexes together with their transactional writers, compatibility readers and merged history reader. Existing documents satisfy the widened schema. Wait for the normal Convex deployment/index build to finish. Existing conversations continue to be read from the original source until every row has a version. Review writes initialize only their own small property's exact sum when needed.
2. **Dry-run the inbox.** On the explicitly selected intended deployment, root invokes `messaging/projectionMaintenance:initializeInbox` with `{"dryRun":true}`. It reads at most 101 conversations, refuses above 100, calculates only two indexed heads per row, and returns counts without guest/provider data. With the observed 14 rows, this is bounded to the source conversations and at most 28 head reads. It checks every row, including already-versioned rows, for drift. No field is changed by dry run.
3. **Initialize atomically.** Root invokes that same internal mutation with `{"dryRun":false}`. One transaction writes changed projections and infers `needs_staff` for an unsettled guest message using the established last-message/settlement rule. Otherwise an absent historical state stays absent, preserving existing deep-link/selection behavior. Concurrent writer transactions conflict/retry against the same conversations, so the final committed projections match their source. Existing explicit states are preserved.
4. **Verify and cut over.** Repeat `{"dryRun":true}` and require `changed:0, complete:true` with the expected checked count. Fresh needs-reply requests now use the indexed state/activity range automatically because no undefined-version row remains. Existing cursors finish on their original source. Compare ordered IDs, active/inactive, channel, message-date, empty/nonempty, resolved/archive and needs-reply filters with root's pre-run evidence; verify at most one property join per returned initialized row. An unforeseen uninitialized row disables fresh indexed requests rather than dropping it.
5. **Initialize/verify reviews.** For each of the three actual villa IDs obtained from root's protected inventory, invoke `catalog/reviewMaintenance:initialize` with `{"propertyId":"<actual ID>","dryRun":true}`. Inspect `checked`, `ratingTotal`, `totalReviews`, `changed`; then invoke with `dryRun:false` only for the intended property and repeat dry run until `changed:false`. The mutation reads at most 1,001 reviews and one unique aggregate, refuses above 1,000 and replaces only the aggregate. The seven review records are untouched. Verify public count/rounded average and unchanged villa visibility before/after. Missing or corrupt duplicate aggregate rows fail explicitly rather than choosing an arbitrary row.
6. **Audit verification.** No historical copy/delete job is needed. Confirm new appointment actions add one canonical record and no `appointmentChanges` row; confirm both history views and monetary fields. Refresh open paginated appointment-history views at deployment because the merged stream uses its own opaque cursor encoding; persisted history values remain intact. Existing history rows and all tables remain intact.

The optional fields remain optional after verification: this PR does not claim a required-field narrowing or delete rollout support. If actual counts exceed these proven bounds, root should hold cutover and choose a separately reviewed paginated repair; the functions refuse rather than silently process an incomplete table. Check transaction byte limits as well as counts if populated content is unusually large. A failure rolls back the whole repair and preserves compatibility reads.

For rollback, retain the widened schema and the merged appointment reader. Inbox reads can be rolled back to the original source without discarding fields; do not feed an inbox-index cursor to an old-index reader. If rolling writers all the way back to pre-Phase-4 code, remove projection-version markers in a separately reviewed bounded root operation **before** re-enabling Phase-4 indexed readers, and rerun both exact repairs after restoring the writers. Older review writers can remove exact-sum initialization, so source verification/repair is mandatory after such a rollback. New canonical appointment payloads cannot be read by a pre-Phase-4 appointment-only reader: roll back the writer while retaining the merged reader, or have root review a preservation/copy procedure first. Never delete the canonical records or historical table to roll back. This reader requirement is a genuine rollback constraint.

Remaining risks are the usual denormalized-writer closure and added contention/bytes on one conversation head and one per-villa aggregate. The stored heads duplicate the latest message and latest social delivery document internally; Web delivery remains only on its event. Admin list/search/detail/transcript responses exclude projection-only fields while preserving their existing message/social fields, so root should inspect unusually large channel tool-result payloads before live acceptance; no transcript-sized array is introduced. Existing free-text search and secondary inbox filters retain their bounded scan costs. No live provider-delivery, production repair or production performance claim is made from local tests.

## Validation evidence

Node 22 and the parent hardware-aware ceiling of four Vitest workers are used. Only the three allowed Clerk test fields were copied from the validated test env into this checkout's ignored mode-600 `.env.e2e.local`; no dirty original env, provider credential or shared deployment selector was loaded. Authenticated artifacts and function metadata remain private under ignored `output/phase4/` and the integration runner's mode-700 directories. The parent due-metric scorecard optimization is retained: `--phase3` measures its 30 due metrics, while `--phase4` and the unfiltered JSON report include Phase 4.

- Frozen dependency install; complete application/test/backend types; lint with zero warnings; Knip: passed.
- Focused final suites: 207 tests passed, plus 24 inbox/query-scale checks and the exact-parent counter probe. Later projection coverage is included in the final full run.
- Actual local CLI codegen/function-spec and real record-return rejection: passed. `convex/_generated` is produced by CLI 1.50.0.
- Full `pnpm verify:integration`: **passed**, including complete types, lint0, **3,059 unit/backend tests (251 files)**, production build, **228 component checks** and **73 actual-Clerk E2E checks**. The component configuration retains its 24 existing skips; no skip was added. The successful runner exited 0 after its owned-process and run-owned Clerk-user cleanup.
- Earlier validation exposed implementation lint/test-typing issues and one old ownership assertion expecting the intentionally removed second audit. These were corrected while preserving rollback/history assertions. A prior component run had one unchanged coupon-fixture timeout; the exact case passed its focused recheck in 4.8 seconds under the original timeout, and the final complete component run passed all 228 enabled checks. No timeout or assertion was weakened.
- Clean committed Phase 3 and Phase 4 scorecards: **30/30** and **32/32**. The phase marker remains 3. Final evidence is committed separately from private ignored logs.


## Root review follow-up

The independent Spec review found no requirement gaps. The Standards review identified an unstructured review-initialization error and two repeated helper shapes. The root follow-up uses a typed `ConvexError` for the bounded refusal, shares exact aggregate calculation/storage between first-write initialization and explicit repair, and centralizes the initialized-message fallback. No public response or repair contract changes. The structured refusal test also proves that oversized initialization leaves both source reviews and aggregate storage untouched.

Root verification: complete integration passed with 3,059 unit/backend tests, 228 component checks and 73 actual-Clerk E2E checks; afterward the four affected suites passed 74/74 and all app/test/Convex typechecks passed with the review follow-up. The independent operational audit subsequently identified four inbox issues, addressed below. Final root production acceptance remains pending.

## Independent audit corrections

The independent operational audit found four inbox issues at `1698d96`. All four were reproduced by failing tests before the corrections. Admin list/search/detail/transcript now omit internal cached heads and projection metadata, including an existing cached Web tool result. Web event writes keep tool evidence on the event and skip conversation delivery reads/writes; the regression checks one event write and an unchanged conversation. Heartbeats update both activity sort fields; close and browser handoff use the shared metadata builder. Every eval and scenario creator initializes its read projection, and eval transcript metadata follows the same sorting rules without creating quota, alert or scheduled staff work.

The additional historical-state regression preserves absent state on empty/already-answered imported rows rather than assigning `processing`. The bounded inbox refusal now uses `INBOX_INITIALIZATION_REQUIRED`, and the repeated social-delivery fallback is shared. Sparse secondary filters may still produce short or empty pages with a continuation; callers retain the existing pagination contract. Social event payload fields already returned before Phase 4 are unchanged.

Five new regression tests cover the four audit findings and historical-state preservation. Existing Web delivery assertions now verify the canonical event rather than a redundant conversation copy. Eval assertions separately prove read projection state and the absence of production quota/alerts/staff tasks/scheduled functions. The focused six-file run passed 114 tests; final full integration and refreshed live Preview acceptance passed as recorded below. The earlier Preview acceptance at `1698d96` passed six rendered routes, 16 inbox filter/pagination comparisons, atomic initialization (`changed:1` then `0`) and three review totals with seven source tables unchanged. That real Convex mutation stored a latest-message document with nested system IDs successfully.

## Root completion and production acceptance

At backend source `49b3de8`, root completed `pnpm verify:integration`: **3,064 unit/backend tests in 252 files**, **228 component checks**, **73 actual-Clerk E2E checks**, application/test/backend types, zero-warning lint and production build. Knip and all 32 clean-tree Phase 4 gates passed. The 24 existing component skips remain unchanged. The final documentation/phase-marker commit changes no backend behavior.

The isolated Preview for that exact source was Ready and its rendered frontend used its own backend. Six public routes, three seeded villas, 16 inbox filter/pagination comparisons and three exact review aggregates passed. Real backend heartbeat, close and one-use browser handoff kept the initialization gate at zero drift. New eval sessions for Web, LINE, Facebook, Instagram and WhatsApp, with direct transcript writes but no model/provider call, all retained readiness and stored nested message system IDs successfully. The final Preview dry run covered seven conversations with `changed:0, complete:true`. Admin policy checks used explicit owner impersonation; actual Clerk login is proven separately by the full local E2E suite.

Before the production backend update, root captured an export including file storage, verified its ZIP CRC and SHA-256, and checked inclusion of all 75 expected app/storage entries and all component data. The archive also includes Convex's table catalog and 31 empty retired table entries; those are not active application schema tables. The protected mode-600 archive and its verification manifest are outside git under `~/Library/Application Support/360-tour/backups/phase4-2026-11-13/`. Root explicitly verified the production deployment name and URL before exporting, deploying or initializing.

The additive backend deploy passed dry run and applied four new indexes. Bounded production inbox initialization checked/changed all **14** existing conversations atomically, then verified **`changed:0, complete:true`**. Each of the three review aggregates initialized its exact source sum/count and then verified unchanged. All seven source review documents and their public count/rounded averages stayed intact.

Post-initialization comparison passed across **75 protected app/storage tables**, permitting only the intended conversation projection/state fields and `reviewStats.ratingTotal`. All other source fields and documents—including messages, delivery events, availability, bookings, appointments, payments and audit history—remained unchanged. Sixteen paginated inbox filter views preserved row ordering, message/event content and needs-reply behavior. Runtime metadata retained all existing RPC paths, argument and access declarations; the two new internal repairs bring the metadata total to 393 including ten HTTP actions, with 295 public RPCs unchanged. Anonymous admin reads remained denied, the original Stripe money cutoff was preserved, and the backend stayed unpaused. Largest observed production message/event/conversation JSON sizes after initialization were 340/866/1,402 bytes.

No production reset, test appointment, payment/refund, email, model or social-provider send was performed for Phase 4. Canonical appointment writes, revision/no-op rules and merged historical pagination are covered by transaction tests and actual backend validation; source production appointment/audit rows were preserved. The final GitHub checks and merge publish the completed Phase 4 ratchet. Its rollback constraints above remain applicable.
