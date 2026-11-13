# Phase 3b: Bookings ownership closure

Required dependent base: `d4359d41203937982f53705ad11b24060d893bcf`, Auth PR [#74](https://github.com/Ruckth/360-tour/pull/74), including root's import/documentation cleanup. The prepared isolated checkout was clean at `3ca332d` and fast-forwarded to this exact commit. No origin/main substitution, reset, rebase, worktree creation or unpublished-history rewrite occurred. Neither `/Users/macbook/Development/360-tour` nor `/Users/macbook/Development/360-tour-arch` was touched. This PR targets **t3/complete-auth-ownership**. `.arch-phase` remains **2**. Root owns review, remote Preview inspection, backend acceptance, operational cutover and merge.

## Ownership and limits

The accepted scalable architecture plan's Rules 2–5, nine-domain map and Phase 3b govern this closure of PR #67's remaining ctx/email/maintenance ownership. All existing public Bookings, admin command, payment and calendar RPC paths remain unchanged. Exactly **nine internal registrations** change module: six actual email actions and three actual booking maintenance mutations. No other domain endpoint moves. There are no forwarding endpoints, compatibility aliases, duplicated implementations, model registrations or model imports/re-exports of registration modules.

`bookings/model.ts` exposes explicit named plain helpers. The former model implementation now lives in `bookings/private/stays.ts`, allowing the correction helper to call `queueCancellationEmail` directly without a model/private runtime cycle. Other domains and root ctx consumers enter through the model; files inside Bookings may use its private helpers directly. Every moved source is below 1,000 lines (largest: `private/stays.ts`, 446 lines).

| Original implementation | Actual owner | Responsibility / consumers |
| --- | --- | --- |
| `lib/bookingWrites.ts` | `bookings/private/bookingWrites.ts` | Property/stay validation, quotes and atomic stay creation, availability holds, captured attribution/coupon/affiliate state, history, linked order and absolute hold scheduling. Exported declarations retain names through model. Root scenarios/eval-data and Concierge property tools use model. |
| `lib/bookingMoney.ts` ctx/history implementation | `bookings/private/money.ts` | `appendBookingHistory`, `writeBooking`, `bookingSnapshot` and their private history-field/equality implementation. Retain revision increment, exact history projection, coupon/affiliate sync and deferred sync/payment-unlink flags in the caller's transaction. Root scenarios/eval-data and POS use model. |
| `lib/stayCorrections.ts` | `bookings/private/stayCorrections.ts` | Refund fingerprints/replay, order stay charges/payments, refunds, cancellation, financial projections, payment blockers and reversal patch. Preserve bounded reads, actual payment/refund dates, money limits, identity and notification defaults. POS uses model. |
| `lib/bookingPhone.ts` | `bookings/private/bookingPhone.ts` | `bookingsByPhone`, same international-number forms, original limit/index/order/deduplication; no country inference. Services uses model. |
| `lib/stayOverlap.ts` | `bookings/private/stayOverlap.ts` | Booking/date-block scans and availability-night reads, lockstep iterators, early termination/read budget and every original bound/error. |
| `lib/availabilityWrites.ts` | `bookings/private/availabilityWrites.ts` | Atomic validation/holding/releasing of stay and host-block nights, ownership checks and OTA overlap semantics. |
| booking-specific `lib/chatCoupon.ts` | `bookings/private/chatCoupon.ts` | Existing validator/snapshot identity, bounded guest transcript choice, guest-supplied code guard and live stay/coupon quote. Messaging table composition imports the validator through model; no coupon catalog ownership moves. |
| original `bookings/model.ts` implementation | `bookings/private/stays.ts` | Payment recording/confirmation and email queues; admin load/projection/edit-pricing/deletion/date-block helpers and constants/types. Its helper names remain exposed by model. |
| private root `emails.ts` declarations | `bookings/private/emails.ts` | `escapedFields`, money formatting, lifecycle content/send and retry implementation. Registrations import the actual plain functions directly; model does not expose email actions. Inline confirmation/owner templates remain with their unchanged actual action handlers in `bookings/emails.ts`. |
| root `crons.ts:expireHold` | `bookings/private/maintenance.ts` | Actual hold cancellation/availability release and history, called directly by the new maintenance registrations. |

The remaining `lib/bookingMoney.ts` is a **pure rule/type leaf**, with its original revision/checkout checks, reasons, effective-time validation, attempt keys, historical/notification defaults, price validation and `BookingPatch`/`HistoryEntry` types. It has no ctx, backend model import or generated-server import. These pure rules stay for Phase 3c; the browser checkout fixture's `effectiveTime` still uses this single implementation. `lib/stayMoney.ts` remains the existing pure leaf breaking Marketing/booking-write cycles. No pure rule is duplicated or casually pulled into the backend model. Browser AdminBooking types now derive from the generated `bookings/admin:listForAdmin` return type in `src/lib/admin/booking-types.ts`; all four former type imports of the backend model are removed.

Services/POS ctx helpers (`lib/orderLinks`, `lineLinks`, appointment finance/corrections/roster and related policies) are not moved incidentally. Bookings still calls the existing POS relationship leaves for linked-order creation/deletion and financial references; their later owner must retain same-transaction ctx behavior and provide its own model seam without a cycle. Generic seed/eval maintenance stays for its later pass. The Auth-owned backend deployment-config leaves `lib/adminEmails` and `lib/maintenance` remain narrow and unchanged. Settings remains the owner of the reused email configuration, recipient selection, escaping, footer and from-header helpers.

## Complete internal RPC mapping

Each row also retires the serialized `.js` spelling: for example `emails.js:sendCancellation` becomes `bookings/emails.js:sendCancellation`. Function export names do not change.

| Old RPC | New RPC | Preserved builder / full args |
| --- | --- | --- |
| `emails:sendBookingConfirmation` | `bookings/emails:sendBookingConfirmation` | `internalAction`; `{guestName,guestEmail,propertyName,checkIn,checkOut,nights,guests,total,currency}` |
| `emails:sendOwnerNotification` | `bookings/emails:sendOwnerNotification` | `internalAction`; same payload plus `guestPhone` |
| `emails:sendCancellation` | `bookings/emails:sendCancellation` | `internalAction`; `{bookingId,attempt?}` |
| `emails:sendPreArrival` | `bookings/emails:sendPreArrival` | `internalAction`; `{bookingId,attempt?}` |
| `emails:sendBookingUpdated` | `bookings/emails:sendBookingUpdated` | `internalAction`; `{bookingId,attempt?}` |
| `emails:sendReviewRequest` | `bookings/emails:sendReviewRequest` | `internalAction`; `{bookingId,attempt?}` |
| `crons:expireBookingHold` | `bookings/maintenance:expireBookingHold` | `internalMutation`; `{bookingId,expectedRevision}` |
| `crons:expirePending` | `bookings/maintenance:expirePending` | `internalMutation`; `{cutoff?,cursor?}` |
| `crons:queueLifecycleEmails` | `bookings/maintenance:queueLifecycleEmails` | `internalMutation`; `{kind:'preArrival'|'review',cursor?,today?}` |

Every builder, validator, return contract, handler statement, error, context, guard and imported binding is preserved after these path substitutions. Email actions retain the default runtime and real Resend fetch SDK; no new runtime directive, provider fallback or exception policy is introduced. Every payload, HTML template/escaping/from header, recipient choice and configuration skip is unchanged. `bookings/bookings:getLifecycleEmailDetails` remains at its existing path with its original eligibility rules. Retry remains **5 minutes × 2^attempt**, scheduled only while **attempt < 3**, passing `attempt + 1`; missing configuration and ineligible bookings retain their original non-retry behavior. Confirmation/owner behavior and existing total presentation are preserved without a money-policy correction.

The immutable `ARCH_MONEY_CUTOVER_AT = 1794510611496`, SATANG/BPS rounding, refunds/payment limits, Stripe provider/checkout identity, request snapshots, orphan/cutover rules, durable tool keys/claims/events, capability tokens, proposal identity/replay/invalidation and privacy are unchanged. No schema/data/dependency/product change occurs. Stay creation and availability remain in the same transaction with all existing read bounds. Corrections retain revision/history and notification defaults.

## Fixed-base proof and runtime retirement

`scripts/move-bookings-closure.mjs` is the single explicit fixed-base codemod and repeatable read-only audit. It distributes actual declarations with the TypeScript AST; rewrites resolved imports, generated dot/bracket `api`/`internal` references, raw RPC/CLI/HTTP names, `.js` serialized names, scheduler/cron references and current inventory; and scans Next/frontend/test/fixture/eval sources. Historical architecture records and old move scripts retain their historical paths. Neither API declarations nor schema exports are fabricated by the codemod.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-bookings-closure.mjs --check
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base d4359d41203937982f53705ad11b24060d893bcf --out output/phase3b-bookings-closure
```

The proof compares **9 renamed registrations**, **134 helper/retained declarations**, **1,718 other production declarations** and **4,276 resolved bindings** against the exact base. It preserves literal/template/regex contents and syntax kinds, normalizing only trivia and explicitly lifted top-level export modifiers. It rejects extra production files/logic, legacy imports/references, endpoint re-exports, private cross-domain/browser imports and runtime cycles reachable from the Bookings or Marketing models. Root cron registry statements are compared too, so names, cadence and args cannot drift. Public access inventory remains **295 explicit / 0 raw**.

Actual `schema.export()` comparison is equal: **74 base / 74 current / 74 static tables**, SHA-256 **c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6**. Only object keys/top-level table order normalize; all other array order remains significant. Schema/table sources are unchanged.

Real installed Convex **1.34.1** component-aware generation ran against new checkout-local anonymous state `.convex/local/default/`, cloud **http://127.0.0.1:3410**, HTTP actions **3411**, deployment `anonymous:anonymous-agent`. Only a deliberately nonfunctional issuer `https://bookings-closure-local.invalid` was configured locally. `convex dev --local` and real `convex codegen` prepared/uploaded the component graph and generated/checked actual bindings. No shared keys/config/credentials were copied or inspected. No seed/reset, shared/production deployment, live Clerk/provider/model/email/social call or live eval occurred.

The actual isolated function-spec contains **295 public** functions, all nine new internal registrations and no old registrations. CLI calls to all nine old paths with `{}` return **missing-function** errors despite missing required args. Runtime `bookingsOwnership.test.ts` separately proves old email/ctx modules are absent and root `crons`/retained pure `bookingMoney` exports are absent for anonymous/owner callers, distinguishing module/export absence from bad args or auth. Existing root Messaging retirement assertions remain: `emails:sendStaffAlert` now correctly requires missing-module because its remaining root module is removed; `crons:cleanRateLimits` still requires missing-export. No retired path is remapped to a replacement in those regressions.

Ignored `output/phase3b-bookings-closure/` holds full declaration/binding mappings, source scheduler inventory, actual schema exports, generated-function spec, negative CLI evidence and validation logs. This proves isolated behavior, not production acceptance.

## Root-owned scheduler cutover

**A source codemod cannot migrate persisted jobs.** There is no compatibility window for these nine retired internal names. The following inventories the actual old-code producers; root must also inspect external schedulers/raw RPC definitions and actual stored unfinished/pending/in-progress jobs on the intended target, including both `module:function` and `module.js:function` names.

| Old-code producer → retired target | Original schedule, complete payload and state to retain |
| --- | --- |
| `lib/bookingWrites:createBookingRecord` → `crons:expireBookingHold` | `runAt(unpaidHoldExpiresAt!, {bookingId,expectedRevision:created.revision ?? 0})`; preserve original createdAt, authoritative hold deadline, booking/payment identity and revision argument. |
| `bookings/payments/stripe:beginCheckout` → `crons:expireBookingHold` | `runAt(request.expiresAt, {bookingId:booking._id,expectedRevision:booking.revision ?? 0})`; preserve exact Stripe request/checkout identity and absolute checkout-extended deadline. |
| `crons:expireBookingHold` → itself | Re-read current status and `bookingHoldExpiresAt(booking)`; if extended, `runAt(expiresAt, args)` retains both original args. An edit's changed revision does not disable expiry: expectedRevision is preserved as supplied, not converted into a new skip guard. Admin, paid and nonpending guards remain. |
| hourly registry `expire unpaid bookings` → `crons:expirePending` | Every one hour with `{}`. Continuation uses `runAfter(0, {cutoff,cursor:page.continueCursor})`; preserve captured cutoff and cursor, 100-row pagination and per-booking absolute-deadline recheck. Never recompute a continuation's cutoff. |
| `bookings/model:queueBookingEmails` → `emails:sendBookingConfirmation` and `sendOwnerNotification` | Original zero-delay due time. Full frozen `{guestName,propertyName,checkIn,checkOut,nights,guests,total,currency,guestEmail}`; owner additionally has `guestPhone` and may have empty guestEmail. Preserve `confirmationEmailsQueuedAt`, original guest/owner recipients and individual known/ambiguous delivery. Forced admin resends are deliberate original operations, never a cutover strategy. |
| `bookings/model:queueCancellationEmail` → `emails:sendCancellation` | Original zero-delay `{bookingId}` and cancellation queued marker; retain cancellation/guest-email eligibility, notification resolution, revision/history and recipient outcome. Never run cancellation again to recreate an email job. |
| `bookings/commands/editBooking` → `emails:sendBookingUpdated` | Original zero-delay `{bookingId}` only when the existing notify/guest-email condition holds. Preserve correction/history and known/ambiguous delivery; never replay an edit to migrate a job. |
| daily registries `queue pre-arrival emails` / `queue review emails` → `crons:queueLifecycleEmails` | Both `'0 2 * * *'` UTC (09:00 resort time), args `{kind:'preArrival'}` / `{kind:'review'}`. Continuations use original zero-delay `{kind,cursor:page.continueCursor,today}`. Preserve resort-date snapshot, 50-row page, settings rules, eligible status/date ranges, `preArrivalEmailQueuedAt` / `reviewEmailQueuedAt` and original queue decisions. Never recalculate a continuation's today. |
| `crons:queueLifecycleEmails` → `emails:sendPreArrival` / `sendReviewRequest` | Original zero-delay `{bookingId}`, original markers written in the queue transaction. Preserve guest email, eligibility recheck and per-recipient delivery evidence. A marker is evidence work was queued, not proof an external send succeeded. |
| private `emails:retryLifecycleEmail` → `emails:sendCancellation` / `sendPreArrival` / `sendBookingUpdated` / `sendReviewRequest` | Original absolute due time from `runAfter(5*60*1000*2**attempt, {bookingId,attempt:attempt+1})`, only attempt < 3. Keep supplied attempt, original failed delivery evidence and all markers. Do not restart at attempt zero or grant a new retry cycle. |

Every root registry name/cadence/args is retained. Only the booking targets above change. The unchanged registry entries remain: `clean raw marketing after 90 days` (`0 3 * * *`), `sync OTA calendars` (30min), `clean rate limits` (1h), `clean unattached staff and service photos` (6h), `clean pending customer displays` (10min), `recover messaging turns` (1min), all with `{}`. Stripe `expireCheckout`, all iCal continuations, Services/POS/Messaging/Marketing jobs and generic seed/eval maintenance paths are unchanged by this PR.

Root's concrete release procedure:

1. Keep the dependency stack and review this head against exact Auth `d4359d4`. Supplied status: production is healthy at merged Marketing `c1847f0`, with no active gate/pause; Auth #74 is pending CI/cutover. This implementation does not create a production gate or claim Auth acceptance. Auth Preview `6734ad3` was reported isolated on `chatty-starfish-84`; final `d4359d4` still requires root inspection. Root alone inspects new Preview logs. No other deployments are inspected/deleted here; the earlier quota-40 resolution remains root's private-backup/delete-only-obsolete-merged-PR60–63 work.
2. Root establishes the release gate before removing old paths: quiesce booking/payment/correction ingress, provider callbacks, durable worker writes, email producers/retries and affected cron triggers; drain in-flight old handlers. Retain payment identity/claims, original deadlines and state. Coordinate Auth's preceding gate/acceptance separately; no source rename grants authority to bypass it.
3. Securely inventory each actual stored job's original ID, full serialized target, **complete args**, original absolute due time, scheduler state/attempts, relevant queued markers/claim/revision/payment/deduplication identity, and known or ambiguous provider delivery. Drain under old code, or explicitly reconcile/cancel and replace each **eligible pending job once** under the new accepted backend using its mapped target, full original args and original due time. Record old/new job IDs and dispositions. Due/expired jobs acquire no new TTL. Preserve cutoff/cursor/today and retry attempt snapshots. Never reset/replay booking/payment writes, regenerate checkout requests, reset queued markers or restart hold/retry cycles to migrate a path.
4. In-progress, failed, successful or ambiguous external emails require per-recipient provider/delivery reconciliation. A successful send is not replayable merely because the scheduler completion is unclear. Do not blindly replace ambiguous confirmation/owner/lifecycle sends. Known pending undelivered work can be deliberately replaced once after reconciliation; known delivered work must not be sent again. Preserve original retry policy/eligibility and handle cancelled/ineligible records through their unchanged guards.
5. **Root pushes and accepts the renamed backend under the gate BEFORE merging and triggering the frontend build.** Check exact schema/data preservation, new/retired paths, every registry contract, atomic holds/re-reads/reschedules, pending/lifecycle continuations, marker/retry semantics, correction/refund/payment replay/privacy and durable proposals/claims/provider identity. Any live provider/Clerk/model/email/social acceptance belongs to root. No script here mutates the persisted production queue or performs that acceptance.
6. Only after backend acceptance and recorded queue disposition may root merge, let the matching frontend build complete and verify it under the gate. Reload stale clients only after the matching release is accepted; resume reconciled jobs with their retained due times and snapshots, document exact backend/head/frontend acceptance and then lift the gate. Do not merge first and rely on the automatic Vercel frontend build to migrate jobs or accept the backend.

## Local validation

Node **22.22.3**; frozen lockfile/dependencies unchanged. Verify and smoke use explicit disconnected placeholder Convex/Clerk build configuration and **serial Next production builds**. UI uses the existing disconnected browser fixtures. Archive predicate tests retain their explicit **30-second** budgets, root retired-RPC regressions remain effective, and accuracy-eval `routingCoverage:false` / money-unit fixes are untouched. No detector, gate or phase is weakened.

| Check | Result |
| --- | --- |
| `pnpm verify` | All app/test/Convex types, lint, **235 files / 2,877 tests**, production Next build pass |
| `pnpm exec eslint . --max-warnings 0` | Pass, zero warnings |
| `pnpm knip` | Pass, including configuration hints |
| Focused booking/payment/refund/hold/coupon/affiliate/proposal/durable replay/email/retention/lifecycle/maintenance/security and affected Services/POS suites | **703 tests / 35 files** pass |
| Functional UI, two workers | **223 passed**, 24 existing opt-in captures skipped |
| Disconnected smoke, `E2E_PORT=3075 pnpm test:e2e:smoke` | **13 passed**, separate serial production build |
| Schema/access/scorecard tooling plus retirement/security/POS-refund/Services recheck | **92 tests / 7 files** pass; explicit archive budgets unchanged |
| Fixed-base declaration/binding proof | **9 registrations / 134 helper-retained / 1,718 other declarations / 4,276 bindings**, equal |
| Actual schema export | Equal, **74 tables**, identical hash |
| Model runtime graph / ownership | No reachable registrations, cycles, private cross-domain or browser model imports |
| Source inventory / real local function spec | **295 explicit / 0 raw**, actual local backend **295 public** |
| Runtime retirement | Nine old RPCs absent on real local backend; module/export absence independently proved in convex-test |
| Real isolated CLI codegen | Pass, component-aware actual bindings and types |
| `pnpm arch:score --phase 2` and `--phase2` | **19/19** gates pass on the clean committed tree |

The first focused run exposed the expected retirement-test distinction after deleting root emails: `emails:sendStaffAlert` now raises missing-module instead of missing-export. That assertion was updated to require the stronger accurate absence condition; its retired path stays unchanged. The corrected 703-test run passes. Initial local setup correctly refused a missing issuer; the nonfunctional local issuer fixed configuration only. An initial standalone codegen after a one-shot backend stopped failed because no local process was listening; the corrected persistent checkout-local backend and codegen passed. These are isolated setup/test fixes, not shared operations or policy changes.

Independent review, CI/new Preview and root-controlled live acceptance remain pending. Remaining later-phase metrics are unchanged: 24 `as never`, 72 src imports of convex/lib, one convex import of src, nine domain table owners/zero bypasses, 34 demo files, three CI placeholders, one existing file above 1,000 lines, 52 no-login return-validator gaps, no architecture recipe and no Phase 4 read-budget test. This closure does not claim completion of Phase 3.
