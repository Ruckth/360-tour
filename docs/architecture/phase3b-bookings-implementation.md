# Phase 3b: bookings backend domain

Required dependent base: `ee796bf2089fb2d13e29b3ece6e4bbc44d8c6d27`, the open catalog PR #66 (`t3/catalog-backend-domain`) plus its gated-cutover documentation. The clean prepared `t3/phase3b-bookings-domain-move` worktree was fast-forwarded from its initial ancestor to exactly that commit. No unpublished commits were discarded; no reset to origin/main occurred. The dirty original `/Users/macbook/Development/360-tour` checkout was not touched. This PR targets `t3/catalog-backend-domain`. Root owns independent review, shared/production acceptance, cutover and merge. `.arch-phase` remains **2**.

## Scope and contracts

This is a path-only move of `bookings.ts`, `adminBookings.ts`, `availability.ts`, `payments.ts` and `ical.ts`. There are **68** registrations: **45** public trust registrations and **23** internal registrations. Builder counts remain publicQuery 7, publicMutation 2, publicAction 1, adminQuery 12, adminMutation 22, adminAction 1, internalQuery 5, internalMutation 17 and internalAction 1. Every function retains its function name, registration builder, visibility, access metadata, argument/return validators and handler body. The only handler substitutions are the mapped `api`/`internal` paths below.

- `bookings/bookings.ts` owns the existing guest/capability/proposal and internal chat booking endpoints.
- `bookings/admin.ts` groups the eight cohesive admin reads. The thirteen booking/payment admin commands each own one file under `bookings/commands/`; the four date-block commands each own one file under `bookings/calendar/`.
- `bookings/calendar/availability.ts` and `bookings/calendar/ical.ts` retain their existing reads and calendar synchronization logic.
- `bookings/payments/stripe.ts` owns the existing checkout/provider refund and reconciliation endpoints.
- `bookings/model.ts` contains actual implementations of `isDocumentedLiveRefund`, `recordStayPayment`, `markBookingPaid`, `queueBookingEmails` and `queueCancellationEmail`, plus `StayPaymentInput`, formerly in the registered bookings module. Its local `assertNotCancelled` remains private. Shared admin loading, confirmation, edit-pricing, deletion and date-block validation implementations and their existing constants/validators/types also live here, including `AdminBooking`. These are plain helpers, never RPC registrations or proxy wrappers.

The POS, stay-correction, query-scale and maintenance callers now import booking helpers only through `bookings/model.ts`. No other domain imports booking endpoint files. The existing messaging helper `startDurablePreparation` is exposed through the existing `messaging/model.ts` seam, so bookings does not bypass that domain's interface. Its implementation, claim checks and durable replay behavior are unchanged. Services, POS, settings, auth policies and pure `lib` helpers remain in place pending their own steps/3c.

Anonymous booking budgets remain email 5/hour, phone 5/hour and global 100/hour. Capability-token checks, proposal signatures/revisions, lease/write guards, durable tool result storage/replay, integer SATANG/BPS calculations, payment and provider-refund deduplication, immutable Stripe request snapshots, orphan auditing, expiry cutoffs, manual correction guards, date ownership, iCal ticket/generation protection and all bounded read limits are preserved. No schema, data migration, auth policy, product behavior, dependency pin or rate-limiter component changes are introduced. No old aliases, wrappers or re-exports of endpoints remain.

## Complete RPC mapping

Serialized CLI/HTTP/getFunctionName paths use `module:function`; generated references replace `/` and `:` with property segments, for example `internal.payments.expireCheckout` becomes `internal.bookings.payments.stripe.expireCheckout`. The registration name after `:` is unchanged in every row.

| Old RPC | New RPC |
| --- | --- |
| `bookings:quoteStay` | `bookings/bookings:quoteStay` |
| `bookings:create` | `bookings/bookings:create` |
| `bookings:getLifecycleEmailDetails` | `bookings/bookings:getLifecycleEmailDetails` |
| `bookings:markPaidFromTrustedWebhook` | `bookings/bookings:markPaidFromTrustedWebhook` |
| `bookings:getById` | `bookings/bookings:getById` |
| `bookings:listByProperty` | `bookings/bookings:listByProperty` |
| `bookings:touchChatBookingFlow` | `bookings/bookings:touchChatBookingFlow` |
| `bookings:invalidateChatProposal` | `bookings/bookings:invalidateChatProposal` |
| `bookings:previewChatCoupon` | `bookings/bookings:previewChatCoupon` |
| `bookings:prepareChatBooking` | `bookings/bookings:prepareChatBooking` |
| `bookings:getConfirmProposal` | `bookings/bookings:getConfirmProposal` |
| `bookings:confirmProposal` | `bookings/bookings:confirmProposal` |
| `bookings:confirmChatBooking` | `bookings/bookings:confirmChatBooking` |
| `bookings:listChatGuestBookings` | `bookings/bookings:listChatGuestBookings` |
| `bookings:cancelChatBooking` | `bookings/bookings:cancelChatBooking` |
| `adminBookings:listForAdmin` | `bookings/admin:listForAdmin` |
| `adminBookings:getForAdmin` | `bookings/admin:getForAdmin` |
| `adminBookings:searchBookings` | `bookings/admin:searchBookings` |
| `adminBookings:findGuests` | `bookings/admin:findGuests` |
| `adminBookings:updateBooking` | `bookings/commands/updateBooking:updateBooking` |
| `adminBookings:recordPayment` | `bookings/commands/recordPayment:recordPayment` |
| `adminBookings:amendPayment` | `bookings/commands/amendPayment:amendPayment` |
| `adminBookings:cancelPayment` | `bookings/commands/cancelPayment:cancelPayment` |
| `adminBookings:recordRefund` | `bookings/commands/recordRefund:recordRefund` |
| `adminBookings:cancelStay` | `bookings/commands/cancelStay:cancelStay` |
| `adminBookings:reopenBooking` | `bookings/commands/reopenBooking:reopenBooking` |
| `adminBookings:resendBookingEmails` | `bookings/commands/resendBookingEmails:resendBookingEmails` |
| `adminBookings:createBooking` | `bookings/commands/createBooking:createBooking` |
| `adminBookings:quoteBookingEdit` | `bookings/admin:quoteBookingEdit` |
| `adminBookings:editBooking` | `bookings/commands/editBooking:editBooking` |
| `adminBookings:deleteBooking` | `bookings/commands/deleteBooking:deleteBooking` |
| `adminBookings:listCleanupCandidates` | `bookings/admin:listCleanupCandidates` |
| `adminBookings:deleteBookings` | `bookings/commands/deleteBookings:deleteBookings` |
| `adminBookings:updateNotes` | `bookings/commands/updateNotes:updateNotes` |
| `adminBookings:bookingFinancials` | `bookings/admin:bookingFinancials` |
| `adminBookings:bookingHistory` | `bookings/admin:bookingHistory` |
| `adminBookings:addDateBlocks` | `bookings/calendar/addDateBlocks:addDateBlocks` |
| `adminBookings:addDateBlock` | `bookings/calendar/addDateBlock:addDateBlock` |
| `adminBookings:updateDateBlock` | `bookings/calendar/updateDateBlock:updateDateBlock` |
| `adminBookings:removeDateBlock` | `bookings/calendar/removeDateBlock:removeDateBlock` |
| `availability:getForProperty` | `bookings/calendar/availability:getForProperty` |
| `availability:getBlockedDates` | `bookings/calendar/availability:getBlockedDates` |
| `availability:getAdminBlockedDates` | `bookings/calendar/availability:getAdminBlockedDates` |
| `availability:getBlockedDatesByProperty` | `bookings/calendar/availability:getBlockedDatesByProperty` |
| `availability:isAvailable` | `bookings/calendar/availability:isAvailable` |
| `payments:beginCheckout` | `bookings/payments/stripe:beginCheckout` |
| `payments:saveCheckoutSession` | `bookings/payments/stripe:saveCheckoutSession` |
| `payments:expireCheckout` | `bookings/payments/stripe:expireCheckout` |
| `payments:createCheckout` | `bookings/payments/stripe:createCheckout` |
| `payments:completeCheckout` | `bookings/payments/stripe:completeCheckout` |
| `payments:recordRefund` | `bookings/payments/stripe:recordRefund` |
| `payments:linkRecordedStripeRefund` | `bookings/payments/stripe:linkRecordedStripeRefund` |
| `ical:addSource` | `bookings/calendar/ical:addSource` |
| `ical:listSources` | `bookings/calendar/ical:listSources` |
| `ical:continueRelabelSource` | `bookings/calendar/ical:continueRelabelSource` |
| `ical:updateSource` | `bookings/calendar/ical:updateSource` |
| `ical:continueRemoveSource` | `bookings/calendar/ical:continueRemoveSource` |
| `ical:removeSource` | `bookings/calendar/ical:removeSource` |
| `ical:rotateExportToken` | `bookings/calendar/ical:rotateExportToken` |
| `ical:getExportToken` | `bookings/calendar/ical:getExportToken` |
| `ical:getExport` | `bookings/calendar/ical:getExport` |
| `ical:pageSources` | `bookings/calendar/ical:pageSources` |
| `ical:continuePruneSource` | `bookings/calendar/ical:continuePruneSource` |
| `ical:beginSync` | `bookings/calendar/ical:beginSync` |
| `ical:applySource` | `bookings/calendar/ical:applySource` |
| `ical:recordSyncError` | `bookings/calendar/ical:recordSyncError` |
| `ical:syncSource` | `bookings/calendar/ical:syncSource` |
| `ical:syncAll` | `bookings/calendar/ical:syncAll` |

`scripts/move-bookings-domain.mjs` is the explicit reference codemod and repeatable comparison check. It uses the fixed base's TypeScript AST to distribute registrations, lift helper implementations and organize imports; rewrites relative/absolute type imports, ESM `.js` and module-map paths, dot/bracket `api`/`internal` references, serialized RPC/CLI names and the current access inventory; and updates HTTP callbacks, crons, scheduler targets, frontend adapters, fixtures and source-text assertions. Existing evals call through the updated tool dispatcher; `convex data bookings` remains the unchanged table name. Historical benchmark transcripts and prior architecture records retain their observed paths. No historical record is rewritten to claim new runtime evidence.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-bookings-domain.mjs --check --mapping
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base ee796bf2089fb2d13e29b3ece6e4bbc44d8c6d27 --out output/phase3b-bookings
```

The check rejects old endpoint files, runtime RPC paths and imports, compares all **68** registration ASTs after only the documented reference substitutions, compares all **35** lifted declarations and every private declaration in the intact guest/availability/payment/iCal modules, checks for extra registrations and requires one registration per command file. AST printing ignores comments/formatting and normalizes only the helper export modifier; it does not remove policy fields, handler statements or validators. Convex API bindings are generated by the real CLI, never this codemod.

## Schema and measurements

The actual Convex `schema.export()` comparison against the required base is **equal**: 74/74/74 base/current/static tables, export SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. Normalization sorts only object keys and top-level tables; index-field and validator-union order remain significant. Schema and table sources have no diff.

| Metric | Required base | Bookings |
| --- | ---: | ---: |
| Tables / real domain owners | 74 / 9 | 74 / 9 |
| Explicit public registrations / raw public registrations | 295 / 0 | 295 / 0 |
| Cross-domain imports bypassing model.ts | 2 | 2 |
| src imports of convex/lib / convex imports of src | 75 / 1 | 75 / 1 |
| as never | 24 | 24 |
| Demo-mode files / CI placeholder references | 34 / 3 | 34 / 3 |
| Architecture recipe / files over 1,000 lines | 0 / 3 | 0 / 2 |
| No-login return-validator gaps / Phase 4 read-budget test | 52 / 0 | 52 / 0 |

The large adminBookings file is removed; the largest moved endpoint file is 594 lines and the model is 444 lines. The two existing cross-domain violations remain the messaging imports of concierge copy. No detector, metric, test gate, return-validator gap or read-budget requirement is silenced or relaxed.

## Validation and local evidence

All commands use Node **22.22.3** via `PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Detailed logs, schemas, mappings and local acceptance artifacts are under ignored `output/phase3b-bookings/`. Next production builds run serially: the complete verify build finishes before the separate smoke build starts.

| Check | Result |
| --- | --- |
| pnpm verify | App/test/Convex types, lint, **232 files / 2,865 tests**, production Next build pass |
| pnpm exec eslint . --max-warnings 0 | Pass, zero warnings |
| pnpm knip | Pass, including configuration hints |
| pnpm test:booking-ui | **223 passed**, 24 existing opt-in captures skipped |
| E2E_PORT=3038 pnpm test:e2e:smoke | **13 passed**, after a separate serial production build |
| Focused booking/payment/calendar/security/access/durable/tooling suites | **289 passed in 16 files** |
| Codemod AST comparison | **68** registrations / **35** lifted declarations / intact private logic equal to base |
| Actual exported-schema comparison | Equal, 74 tables and identical export hash |
| Current access inventory | **295** explicit registrations, **0** raw public registrations |
| pnpm arch:score --phase 2 / --phase2 | **19/19 gates**, clean committed tree |

Focused suites include adminBookings, bookingCorrections, bookingRules, bookingResortDay, payments, stripeCorrections, ical, queryScale, phase0Security, phase1Architecture, auth/accessBuilders, chatBooking, chatCoupons, messaging/toolRecovery, messaging/reliability and convex-access-inventory. They cover payment/refund replay, provider request immutability/orphans/cutoffs, capability rejection, proposals, stale leases, durable completion/recovery and bounded calendar reads using the existing transactional harness and channel adapters. They do not substitute stubs for deployed path acceptance.

Real component-aware API/type generation used installed Convex **1.34.1** and convex-helpers **0.1.120**, with a new checkout-local anonymous backend at cloud `http://127.0.0.1:3220`, HTTP actions `http://127.0.0.1:3221`, deployment `anonymous:anonymous-agent`, state `.convex/local/default/`. No shared config or credential was copied. A nonfunctional local JWT issuer `https://bookings-local.invalid` satisfies auth-config analysis only. The CLI's automatic skill-file updates were removed from this PR. The final `convex codegen` generated the new nested bindings successfully on this local backend.

The empty isolated database was seeded once with the existing `demo-resort` scenario; no reset/backfill occurred. Real HTTP acceptance read three villas, read a seeded paid booking with its capability, refused a wrong token and anonymous admin read, quoted and created a booking at an allowed future date, compared the stored integer satang total, checked the new date hold through both availability reads, refused unconfigured provider checkout, returned 404 for an invalid iCal export token and rejected the removed old booking RPC. An initial acceptance fixture used a date beyond the unchanged 365-day window and was correctly rejected; the fixture was corrected, not the policy.

Local CLI calls exercised `beginCheckout`/`saveCheckoutSession` without contacting Stripe. A real stored `_scheduled_functions` inspection found **3** pending local jobs: one `bookings/payments/stripe.js:expireCheckout` and two `crons.js:expireBookingHold`, with no old module names. No local job was cancelled or replayed to manufacture this result. These are isolated test records, not a shared/production queue audit. No real Clerk login, provider callback/send/refund, shared/backend data change or operational cutover is claimed. Browser fixtures remain the existing UI harness; smoke uses its existing disconnected demo configuration.

## Pending root-controlled gated cutover

This rename removes RPC paths and has **no rolling compatibility window**. Root must complete an independent review and controlled backend acceptance before merge. PR #66 is still open, with its catalog cutover pending; its earlier read-only production inventory found no catalog targets, which provides no acceptance evidence for these newly moved payment/calendar targets.

1. Keep this stacked PR open. Root owns PR #66 acceptance/merge and any merge of main into this dependent branch, preserving its unpublished history. After the catalog parent lands, retarget to main and rerun the required gates against the resulting combined history. A combined gated release is also root's decision, with both mappings accounted for.
2. **Gate traffic, callbacks and jobs before removing paths.** Drain old frontend requests and in-flight checkout creation, signed completion/expiry/refund callbacks, calendar fetches and worker booking operations. Quiesce calendar sync ingress/cron and checkout writers so they cannot schedule another old-path job after the audit. Existing old browser sessions require a coordinated reload.
3. **Inspect actual stored scheduled paths on the target backend**, including unfinished/pending/in-progress jobs and externally scheduled calls. Old `payments:expireCheckout` / `payments.js:expireCheckout`, `ical:continueRelabelSource`, `ical:continueRemoveSource`, `ical:continuePruneSource` and the cron target `ical:syncAll` are concretely renamed by this change. Drain them under the old code, or cancel and deliberately re-enqueue/reconcile under the new paths after acceptance, preserving original expiry times, IDs, cursor/ticket/generation arguments and deduplication semantics. Do not silently drop checkout expiries, relabel/purge/prune continuations, or assume an empty catalog audit covers bookings. Audit any external stored `bookings`, `adminBookings` and `availability` paths too. Perform this audit while ingress remains quiesced; no old compatibility function can execute after removal.

   Reconciliation depends on the target. Preserve and re-enqueue a relabel continuation's original cursor: calling `updateSource` with the same platform does not restart relabelling. A remove continuation can be resumed by calling `removeSource` again on its deleting source. A prune continuation is covered by a subsequent full sync, which advances the generation and prunes from the start. Checkout expiry also needs explicit disposition: the ordinary hold-expiry jobs cover pending guest stays, while admin-source stays and confirmed balance checkouts depend on the checkout-specific expiry job or a subscribed Stripe `checkout.session.expired` webhook. Do not assume the generic hold cron covers those cases.
4. Source targets `crons:expireBookingHold`, `crons:expirePending`, lifecycle emails, messaging workers and email send/update/cancellation identifiers are unchanged, as are their arguments and revision/lease guards. `crons.ts` now registers the OTA cron against `bookings/calendar/ical:syncAll`. No schema/data migration or scheduled-argument migration is introduced, but **stored function names do not get rewritten by a source codemod**.
5. Root backs up/co-ordinates the release using existing runbooks and **pushes and accepts the renamed backend first**, with unchanged schema/data, while traffic stays gated. Acceptance must cover guest quote/create/read capabilities and holds, staff admin corrections/date blocks, payment/refund callback idempotency and expiry/orphan handling, iCal export/sync/continuations, and durable worker booking/proposal/tool replay. Clear a backend maintenance pause at the appropriate point before verifying public reads. Record actual scheduler disposition and acceptance separately.
6. **Merge only after backend acceptance, inside the traffic gate.** The Vercel Git integration automatically starts the production frontend build when main changes. If an earlier merge is unavoidable, root must disable production Git deployment first and restore it only after backend acceptance. The pushed branch has already started preview builds: inspect their actual build logs now and verify that they targeted a dedicated preview backend, not shared development or production. Verify Preview deployment configuration before subsequent incompatible branches are pushed. The existing vercel-build builds the frontend **before** its final Convex push and cannot perform this cutover alone. Building against old/paused backend paths can prerender/cache empty home or sitemap data. Build/publish fresh frontend against the accepted backend and rebuild/invalidate any earlier artifacts.
7. Root verifies home/villa/sitemap output plus booking/admin/payment/calendar/worker behavior, restores ingress/jobs/traffic and records the operation. Rollback coordinates both frontend and backend RPC paths under the same gate, including scheduled-job disposition; no data reset is required for this code-only move.

No shared/production inspection or mutation, secret/provider-console operation, reset, deployment, message to another person, merge, independent delegate review or live cutover was performed by this implementation task.

## Parent review

PR #66 is now merged at `0ebbbec`. The parent merged it into this branch at `5725cf1` without changing the implementation tree and retargeted PR #67 to `main`. Standards, spec and independent reviews found no code defects. The independent review's preview-isolation check and target-specific scheduler recovery notes are reflected above. Parent `pnpm verify` passed 2,865 tests, all types, lint and the production build; Knip, all 19 architecture gates, the 68-registration/35-helper comparison and actual schema-export equality also passed. Production bookings cutover remains pending.
