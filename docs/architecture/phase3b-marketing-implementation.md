# Phase 3b: Marketing ownership completion

Required dependent base: `e9f11ce5e9c03e4284794f046134976fa4e9f379`, Messaging PR [#72](https://github.com/Ruckth/360-tour/pull/72), including the root messaging retirement regression and merged Settings history. The prepared isolated `t3/cb836cd8` worktree (renamed to `t3/complete-marketing-ownership` for publication) was clean at `3ca332d` and fast-forwarded to exactly this base before implementation. Its unpublished history is preserved without rebase, reset or origin/main substitution. Neither `/Users/macbook/Development/360-tour` nor `/Users/macbook/Development/360-tour-arch` was touched. This PR targets **t3/complete-messaging-ownership**. `.arch-phase` stays **2**. Root owns independent reviews, new Preview log inspection, gated backend acceptance, operational reconciliation and merge. No subagents were used.

## Ownership and contracts

Rules 2–5 and the nine-domain map in [the accepted plan](../plans/scalable-architecture-plan.html) govern this completion. Preceding schema, catalog, bookings, services, POS, concierge, settings and messaging implementation notes remain applicable. Marketing owns the actual campaign/link/coupon APIs, grants and marketing invitation policy, affiliates/credits, capture/attribution, bounded report reads and raw retention cleanup. The fourteen marketing table definitions retain their existing owner and identical exported schema.

All **36 moved registrations** retain their actual handlers: marketingQuery **14**, marketingMutation **14**, publicQuery **3**, publicMutation **3**, authenticatedMutation **1**, internalMutation **1**. There are no forwarding endpoints, compatibility registrations, aliases or duplicated implementations. Eleven campaign/link/coupon/affiliate mutations have one command per file; cohesive access and report commands remain beside their reads. Private catalog validators/loaders/history/quote logic, affiliate projections, attribution, reservations, credits and report readers have cohesive modules. The largest moved source is `marketing/reportRead.ts`, **341 lines**; every moved source is below 1,000 lines.

`marketing/model.ts` exposes named plain implementations. Other domains and root helpers use that seam, preserving each caller's transaction. No registration module is imported or re-exported through model. The fixed-base audit follows runtime imports/re-exports after erasing type-only bindings and rejects cycles, including auth builders importing Marketing permission policy. Auth builder declarations, their augmented ctx values and maintenance-before-auth order are unchanged.

Two minimal dependency separations are necessary for that acyclic interface. `adminEmails` moves unchanged from mixed `lib/adminAuth.ts` to the leaf `lib/adminEmails.ts`; desk/owner policy and actual users/staff grants stay with auth. `Booking`, `assertMoney` and `stayMoney` move unchanged from mixed `lib/bookingMoney.ts` to leaf `lib/stayMoney.ts`. All callers import those actual implementations directly; no old aliases remain. This breaks Marketing → money read/validation → booking writes → Marketing and allowlist → staff access cycles without moving booking writes or changing policy. The remaining root money helpers await their owner/3c work.

The existing attribution module mixed ctx reads with frontend-shared validators, capture sanitation, attribution rules and types. Its single pure implementation now lives in `shared/marketingAttribution.ts`; only the database resolver lives privately in Marketing. Frontend-shared marketing capabilities and row types likewise move once to `shared/marketingAccess.ts`, `shared/marketingTypes.ts` and `shared/marketingAffiliateTypes.ts`. Browser code imports no Marketing model or private backend module, including type-only references. Remaining pure `lib/marketingPolicy`, `marketingPrivacy`, `marketingReport`, `marketingSlugs`, `affiliateTypes`, `offers` and `posCoupons` stay for Phase 3c. There is no broad pure-rule cleanup.

Owner/admin bootstrap, original identity email spelling, invited Clerk identity without staff membership, grant claim/expiry, capability matrices, marketer draft restrictions and personal-data/history redaction are unchanged. Campaign/link/coupon states and limits, immutable coupon versions, quote previews and public redirects retain the original code. Atomic coupon reservation/redemption/counter/budget transitions, rollback, SATANG/BPS rounding, affiliate attribution/frozen candidates/credits/refunds/history, bounded report reads and reserve budgets, 30-day attribution window, 90-day raw retention, public limits and client capture sanitation are unchanged. No product, schema, data, policy, dependency or durable-record/counter reset is introduced.

Actual auth identity/users/staff grants, booking/service/POS registries and commands, messaging ownership, generic maintenance and evals remain with their owners. `lib/chatCoupon.ts` stays the existing explicit guest-choice/transcript and booking quote orchestration; it now consumes the real coupon-version helper through Marketing/model. `lib/bookingWrites.ts`, bookingMoney writes, appointmentFinance and POS finance helpers retain their actual domain implementations and consume Marketing helpers through model. Pure POS coupon pricing remains 3c. The root messaging retirement tests and accuracy-eval forced-model/routingCoverage-false/money fixes have no source diff. This does not claim all of Phase 3 is complete.

## Complete RPC mapping

The name after `:` is unchanged. Generated api/internal references use slash-separated module segments as properties; serialized scheduler names can include `.js` before `:`. The four root modules and root cleanup export are removed.

| Old RPC | New RPC |
| --- | --- |
| `marketing:listCampaigns` | `marketing/queries:listCampaigns` |
| `marketing:listLinks` | `marketing/queries:listLinks` |
| `marketing:listCoupons` | `marketing/queries:listCoupons` |
| `marketing:getCoupon` | `marketing/queries:getCoupon` |
| `marketing:checkSlug` | `marketing/queries:checkSlug` |
| `marketing:testQuote` | `marketing/queries:testQuote` |
| `marketing:catalog` | `marketing/queries:catalog` |
| `marketing:saveCampaign` | `marketing/commands/saveCampaign:saveCampaign` |
| `marketing:setCampaignStatus` | `marketing/commands/setCampaignStatus:setCampaignStatus` |
| `marketing:saveLink` | `marketing/commands/saveLink:saveLink` |
| `marketing:setLinkStatus` | `marketing/commands/setLinkStatus:setLinkStatus` |
| `marketing:saveCoupon` | `marketing/commands/saveCoupon:saveCoupon` |
| `marketing:setCouponStatus` | `marketing/commands/setCouponStatus:setCouponStatus` |
| `marketing:resolveLink` | `marketing/public:resolveLink` |
| `marketing:recordOpen` | `marketing/public:recordOpen` |
| `marketing:startSession` | `marketing/public:startSession` |
| `marketing:previewCoupon` | `marketing/public:previewCoupon` |
| `marketingAccess:current` | `marketing/access:current` |
| `marketingAccess:claimInvite` | `marketing/access:claimInvite` |
| `marketingAccess:listGrants` | `marketing/access:listGrants` |
| `marketingAccess:setGrant` | `marketing/access:setGrant` |
| `marketingAffiliates:listAffiliates` | `marketing/affiliates:listAffiliates` |
| `marketingAffiliates:listCredits` | `marketing/affiliates:listCredits` |
| `marketingAffiliates:getCredit` | `marketing/affiliates:getCredit` |
| `marketingAffiliates:saveAffiliate` | `marketing/commands/saveAffiliate:saveAffiliate` |
| `marketingAffiliates:setAffiliateStatus` | `marketing/commands/setAffiliateStatus:setAffiliateStatus` |
| `marketingAffiliates:assignCoupon` | `marketing/commands/assignCoupon:assignCoupon` |
| `marketingAffiliates:refreshCredit` | `marketing/commands/refreshCredit:refreshCredit` |
| `marketingAffiliates:reviewCredit` | `marketing/commands/reviewCredit:reviewCredit` |
| `marketingReport:getReport` | `marketing/report:getReport` |
| `marketingReport:listSpend` | `marketing/report:listSpend` |
| `marketingReport:saveSpend` | `marketing/report:saveSpend` |
| `marketingReport:deleteSpend` | `marketing/report:deleteSpend` |
| `marketingReport:couponRefusals` | `marketing/report:couponRefusals` |
| `marketingReport:noteCouponRefusal` | `marketing/report:noteCouponRefusal` |
| `crons:cleanRawMarketing` | `marketing/maintenance:cleanRawMarketing` |

The three retained root cron registrations are `crons:{expireBookingHold,expirePending,queueLifecycleEmails}`. The only renamed stored target is `crons:cleanRawMarketing`. HTTP/Next/server/frontend callers, public redirect proxy, analytics capture, raw makeFunctionReference paths, tests/fixtures, cron recursion and the current access inventory all use the mapped paths.

## Complete plain declaration mapping

Paths are relative to the repository. Every named non-registration declaration moved from the fixed base is listed, including private constants, validators and types. The standalone retention-versus-attribution top-level guard also moves unchanged from crons to Marketing maintenance. Root cron registration expressions/default export remain in crons with only the cleanup reference substituted.

| Former source | Actual implementation | Exact declarations |
| --- | --- | --- |
| `convex/marketing.ts` | `convex/marketing/catalogModel.ts` | `publishStatus`, `campaignStatus`, `destination`, `benefit`, `couponRules`, `quoteArgs`, `RuleFields`, `QuoteArgs`, `getOrThrow`, `auditFields`, `canonical`, `readable`, `recordChanges`, `validateRange`, `validateRules`, `currentRules`, `enrichLink`, `enrichCoupon`, `slugCheck`, `validateLinkDestination`, `quote`, `campaignTransitions` |
| `convex/marketing.ts` | `convex/shared/marketingTypes.ts` | `CampaignRow`, `LinkRow`, `CouponRow`, `RedemptionRow`, `CouponDetail`, `SlugCheck`, `ResolvedLink` |
| `convex/marketingAffiliates.ts` | `convex/marketing/affiliateRead.ts` | `LIMIT`, `AFFILIATE_LIMIT`, `SUMMARY_LIMIT`, `creditRow` |
| `convex/marketingAffiliates.ts` | `convex/shared/marketingAffiliateTypes.ts` | `AffiliateRow`, `CreditRow` |
| `convex/marketingReport.ts` | `convex/marketing/report.ts` | `snapshot` |
| `convex/lib/marketingAccess.ts` | `convex/marketing/accessPolicy.ts` | `marketingInvitationExpiry`, `marketingInvitationExpired`, `marketingAccess`, `requireMarketingPermission`, `requireEditableDraft` |
| `convex/lib/marketingAccess.ts` | `convex/shared/marketingAccess.ts` | `MarketingRole`, `MarketingPermission`, `marketingCapabilities` |
| `convex/lib/marketingAttribution.ts` | `convex/shared/marketingAttribution.ts` | `ATTRIBUTION_MODEL`, `ATTRIBUTION_WINDOW_MS`, `SESSION_IDLE_MS`, `MAX_SESSIONS_READ`, `entry`, `marketingTouchValidator`, `marketingAttributionValidator`, `marketingCaptureValidator`, `MarketingTouch`, `MarketingAttribution`, `MarketingCapture`, `VISITOR_KEY`, `isVisitorKey`, `newVisitorKey`, `cleanCapture`, `cleanLandingPath`, `cleanReferrerHost`, `touchFromLink`, `SessionTouch`, `buildAttribution` |
| `convex/lib/marketingAttribution.ts` | `convex/marketing/attribution.ts` | `resolveMarketingAttribution` |
| `convex/lib/couponRedemptions.ts` | `convex/marketing/couponRedemptions.ts` | `HoldInput`, `couponUnavailable`, `couponVersion`, `availability`, `holdCouponRedemption`, `syncCouponRedemption`, `quoteCouponBooking`, `CouponBookingQuote`, `repriceCouponBooking`, `consumeOrderCoupon`, `syncOrderCouponRedemption` |
| `convex/lib/affiliateCredits.ts` | `convex/marketing/affiliateCredits.ts` | `AffiliateSnapshot`, `LIMIT`, `captureAffiliateSnapshot`, `creditMoney`, `appendCreditChange`, `syncAffiliateCredit` |
| `convex/lib/marketingReportRead.ts` | `convex/marketing/reportRead.ts` | `reportSpend`, `dayOf`, `touch`, `sum`, `readMarketingReport` |
| `convex/crons.ts` | `convex/marketing/maintenance.ts` | `MARKETING_CLEANUP_BATCH_SIZE` |
| `convex/lib/adminAuth.ts` | `convex/lib/adminEmails.ts` | `adminEmails` |
| `convex/lib/bookingMoney.ts` | `convex/lib/stayMoney.ts` | `Booking`, `assertMoney`, `stayMoney` |

## Scripted migration and fixed-base evidence

`scripts/move-marketing-domain.mjs` is the single fixed-base one-shot codemod and repeatable read-only `--check`. It distributes original TypeScript declarations, splits mixed named imports by symbol, organizes only imports, and updates dot/bracket api/internal references, raw RPC/CLI names including `.js` serialization, relative/absolute imports, explicit module-map keys, frontend/server/Next/fixture/eval callers, cron/scheduler references and the current 295-function access inventory. Historical architecture notes, historical transcripts and earlier fixed-base codemods retain their observed paths. The new retirement test deliberately assembles old names to prove module/export absence, independently of arguments or permissions.

The audit compares syntax kinds and exact leaf tokens, ignoring only trivia and a lifted top-level export modifier after documented reference substitutions. It verifies **36 moved registrations**, **3 retained registrations**, **129 helper/other retained declarations**, **1,686 other production declarations** and **4,260 resolved dependency bindings** against the exact required base. It checks deleted modules, no legacy runtime callers, one registration per command file, source bounds, model exports resolving to exported plain implementations, browser isolation, and runtime import closure from Marketing/model and auth/model. No detector, test title, trust contract or metric is silenced or relaxed.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-marketing-domain.mjs --check
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base e9f11ce5e9c03e4284794f046134976fa4e9f379 --out output/phase3b-marketing
```

Actual `schema.export()` equality is **74 base / 74 current / 74 static tables**, SHA-256 **c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6** on both sides. Only object keys and top-level table order are normalized; all other arrays retain significant order. The schema assembly and table validators retain identical behavior; their attribution validator import now points at its single shared implementation. Public inventory remains **295 explicit / 0 raw**, nine domains and zero cross-domain bypasses. Remaining metrics are as-never **24**, src imports of convex/lib **72**, convex imports of src **1**, demo files **34**, CI placeholders **3**, files over 1,000 lines **1**, no-login return gaps **52** and Phase 4 read-budget gate **0**. Their future gates remain enabled.

## Exact scheduler cutover and reconciliation

**Source rewriting does not migrate persisted jobs.** This implementation inspects or mutates no shared/production state. Root must gate traffic and quiesce all old producers before queue inventory, then record original job ID/name, complete payload, absolute scheduled time, status, attempts, claims, idempotency keys and known/ambiguous outcomes in secure operational evidence. Audit both `module:function` and `module.js:function`, including pending/in-progress/failed/ambiguous records and external stored producers. Drain under old code, or deliberately reconcile/cancel and replace eligible pending jobs exactly once under accepted new code at their retained absolute time. Do not grant a fresh TTL to an elapsed job. Reconcile running or ambiguous actions before replacement; a successful or uncertain send/payment must never be blindly replayed.

| Actual stored target / producer | Mapping, payload, timing and reconciliation |
| --- | --- |
| `crons:cleanRawMarketing` / `crons.js:cleanRawMarketing` | **Rename to `marketing/maintenance:cleanRawMarketing` / `marketing/maintenance.js:cleanRawMarketing`.** Retain **`{cutoff?}`** exactly. Cron jobs retain `{}`; continuations retain their captured cutoff, never a newly computed one, and original absolute due times. Keep cron name **clean raw marketing after 90 days**, expression **`0 3 * * *` (03:00 UTC daily)** and zero-delay recursion. Drain old continuations or reconcile/cancel/re-enqueue each eligible one exactly once after backend acceptance; removed old functions cannot execute afterward. The unchanged pause guard returns 0. Each invocation reads at most **100 marketingSessions and 100 marketingEvents** strictly before cutoff (at most 200 deletions total), then schedules when either page fills. Keep the 90-day raw retention and 30-day fixed attribution window; cutoff-equal/newer rows survive. Do not delete session-day aggregates, link opens, coupon usage/held/budgets, redemptions/versions, frozen booking attribution or affiliate snapshots/credits/history. |
| Other moved Marketing RPCs / unexpected external stored producers | No first-party scheduler targets another moved Marketing RPC. Inventory external cron/CLI/queue definitions anyway and use the complete mapping with unchanged full args and caller credentials/capabilities. Preserve campaign/link/coupon/affiliate IDs, immutable versions, grant identities/expiry and expected credit revisions. Ambiguous saves with optional absent IDs can have already created records: reconcile persisted records/history before retry. Ambiguous `recordOpen`, `startSession` or refusal diagnostics can already have incremented counters/aggregates; do not replay captures or create artificial sessions/counts. Claim invitations against the same identity/grant; never renew expiry merely to migrate a call. |
| `crons:expireBookingHold` | Unchanged. Preserve `{bookingId,expectedRevision}`, original absolute hold deadline and any existing reschedule. Source producers are booking creation, checkout begin and its own deadline re-read. Preserve revision, reservation, status/money and Stripe identity; edits must not disable expiration. |
| `crons:expirePending` | Unchanged. Root hourly `{}` producer; continuations retain `{cutoff?,cursor?}`, absolute time and cutoff snapshot. Keep 100-row pagination and authoritative individual hold deadlines. |
| `bookings/payments/stripe:expireCheckout` | Unchanged. Preserve `{bookingId,sessionId}`, the original checkout absolute expiresAt, immutable checkout attempt/request amounts/dates and provider evidence. Generic hold cleanup does not replace admin-source/confirmed balance-checkout expiry. Reconcile delayed signed capture/refund/expiry, payment dedupe and orphan records without resubmitting a provider request. |
| `bookings/calendar/ical:{syncAll,continueRelabelSource,continueRemoveSource,continuePruneSource}` | Unchanged. syncAll cron every 30min `{}`; relabel `{sourceId,platform,cursor?}`, remove `{sourceId}`, prune `{sourceId,generation,dates,cursor?}`. Retain original absolute continuation times, cursor, generation/ticket and date snapshot. Do not advance generation or drop a relabel cursor as a rename workaround. Parent calendar cutover obligations remain. |
| `emails:{sendBookingConfirmation,sendOwnerNotification}` | Unchanged. Retain original zero-delay times and entire guestName/guestEmail/propertyName/checkIn/checkOut/nights/guests/total/currency payload; owner also guestPhone. Keep confirmationEmailsQueuedAt. Do not invoke booking/payment mutations or force resend to manufacture migrated jobs. Reconcile ambiguous delivery first. |
| `emails:{sendCancellation,sendPreArrival,sendBookingUpdated,sendReviewRequest}` | Unchanged. Preserve `{bookingId,attempt?}`, original time/attempt and booking eligibility/queue markers. Retry remains **5min × 2^attempt**, while attempt < 3. Do not restart the retry cycle. |
| `crons:queueLifecycleEmails` | Unchanged. Daily **02:00 UTC** with `{kind:'preArrival'}` or `{kind:'review'}`; continuations `{kind,cursor?,today?}` retain resort-date snapshot, original due time and queued markers. Gate these producers with booking/payment changes. |
| `services/roster:{continueCopy,continueUndo,pruneBatches}` | Unchanged. Copy `{batchId,sourceWeekStart,fromWeek,toWeek,weeksPerTx,conflict}`; undo `{batchId}`; prune `{keep}`. Retain zero-delay absolute times, batch status/progress/actor, prior cells/pattern snapshots and conflict policy. Resume existing progress; never repeat copy/undo initiation or recreate a batch. |
| `services/maintenance:cleanStaffAvatarUploads` | Unchanged. Every 6h and zero-delay continuations `{}`. Preserve original times, pending uploads, 24h TTL and 100-row bound; do not erase attached media or restart upload registration. |
| `pos/customers:continueMerge` | Unchanged. Preserve `{jobId}`, original zero-delay time, source/destination/actor/reason/before snapshots, movedOrders and running/completed state. Continue the job, never launch a second merge. |
| `pos/staffApprovals:expire` | Unchanged. Preserve `{requestId}`, original approval-TTL due time, approval fingerprint/revision, actor and execution outcome; never reset a request to extend approval or repeat approved money work. |
| `pos/displays:expireLease` / `cleanPending` | Unchanged. Expiry `{tillId,leaseId}` retains original absolute due time and deadline re-read/reschedule; cleanup `{}` retains every-10min cadence and zero-delay continuations. Preserve driver/pair generation, mount/order/lease IDs, pairing links and expiries; never manufacture a new lease lifetime. |
| `messaging/worker:{run,recover}` and ingress/pipeline producers | Unchanged. run `{eventId}`, recover every minute `{}`; preserve original nextAttemptAt/retry/deadline/absolute scheduled times, event/channel dedupe keys, client message IDs, attempts, claimToken, leaseExpiresAt, deliveryStartedAt/dispatchState, content/response/toolResults and semantic tool keys. Do not reset durable rows or replay an admission/model/provider call because Marketing moved. Reconcile uncertain delivery using existing durable rules. |
| `messaging/inboxLifecycle:{expireAnswer,expireStaffSend}` | Unchanged. Preserve `{sessionId,messageId}` at original guest receipt +60s and `{requestId}` at claim +90s. Keep reply ownership/latest message guards and adminReplyAttempts/inbox send state. Expiration uncertainty does not authorize a resend. |
| `messaging/alerts:sendStaffAlert` | Unchanged. Retain complete `{sessionId,channel,guestName,lastMessage}` and original zero-delay time. Preserve lastStaffAlertAt, rolling global budget and eval exclusion. Email and optional LINE outcomes can differ; reconcile each before replacement. Do not call queueStaffAlert to migrate it. |
| `messaging/adminChat:deleteSessionChildren` | Unchanged. Preserve `{sessionId}`, original zero-delay time and bounded archived-session cleanup progress. Keep webhook/event evidence and unknown-question unlinking; do not recreate/re-delete the parent. |
| `messaging/maintenance:cleanRateLimits` | Unchanged. Hourly `{}` and zero-delay continuations retain original times and 100-row expired-only bound. Keep live rate-limit counters/timestamps/expiresAt and component state; never clear budgets. |

This table audits all distinct first-party stored scheduler/cron targets in current production source. Full source call-site inventory is in ignored `output/phase3b-marketing/scheduler-source-inventory.txt`; the fixed-base declaration/dependency comparison proves every other producer, payload expression, timing expression and guard is unchanged. It is source evidence, **not** an observation of a shared queue. Root must also inventory external producers and pending synchronous/in-flight writes/callbacks. Frontends and stored raw RPC clients must reconnect on the new paths with the complete original request, pagination/capability and identity. Old browser sessions require a coordinated reload. No compatibility window exists.

## Backend-first acceptance and Preview evidence

1. Keep the stacked PR open until root review and parent disposition. Preserve the exact unpublished dependency history; root owns later retargeting or integration.
2. Root gates Marketing admin writes, public redirects/capture, coupon booking/POS writes and affiliate/report mutations, as well as relevant cron/external producers and in-flight callbacks/jobs. Inventory and reconcile stored jobs while no producer can add old names. Back up and coordinate using the existing cutover runbooks; do not reset counters or durable records.
3. Root pushes and accepts the renamed backend with unchanged schema/data **before any merge-triggered frontend build**, inside the traffic gate. Acceptance covers owner and invited Clerk bootstrap/claim/expiry, all capability/redaction boundaries, campaign/link/coupon transitions and immutable rules, public redirects/capture/rate limits/sanitation, atomic last-slot/budget rollback, booking/POS money and affiliate/refund snapshots/history, bounded report/cohort reads, retention/aggregates and actual scheduler disposition. Real external sends/model/provider work requires separate root authorization; this implementation performs none.
4. Root must inspect the **actual new Marketing Preview's build logs** for its exact head and target isolation. The supplied historical Messaging baseline at `6ae8d81` named isolated `colorful-kiwi-854`; it does not prove this PR's deployment. When read locally during implementation, `/tmp/360-arch-phase3b-messaging-preview-target.json` instead named head `e9f11ce5e9c03e4284794f046134976fa4e9f379`, deployment `dpl_EHA2xB6KgLZ88mFrVw6uTm9A2ASp`, isolated `beloved-opossum-805.convex.cloud`, READY and shared exclusion. That is supplied local evidence only: no remote logs were inspected here, and it is **not Marketing-head acceptance**. Root must independently verify new logs and absence of shared/prod targets.
5. Merge only after backend acceptance inside the gate; merging triggers the frontend production build. Verify the built client/proxy/analytics/Next callers and staff/privacy/financial/messaging regressions against the accepted backend. Resume/reconcile the retained jobs at their original times, reload clients, then lift the gate. Record actual job IDs/dispositions, accepted backend/head and frontend deployment separately. No production/shared deployment, reset, secret handling or live queue audit occurs in this implementation.

## Local validation

Node **22.22.3**, `/opt/homebrew/opt/node@22/bin`; installed Convex **1.34.1** and convex-helpers **0.1.120**, unchanged lockfile. Detailed logs, complete contracts/mappings, actual schema exports and source scheduler inventory are under ignored `output/phase3b-marketing/`.

Real Convex CLI generation uses new checkout-local anonymous state `.convex/local/default/`, deployment `anonymous:anonymous-agent`, cloud **http://127.0.0.1:3380**, HTTP actions **3381**. An initially requested occupied port was rejected; its process/state was never accessed. Only a deliberately nonfunctional local JWT issuer `https://marketing-local.invalid` was set. No shared credentials/configuration, seed/reset, live sign-in, model eval, provider/email/social call, send or post was used. Real `convex dev --local` prepared functions with the rateLimiter component; standalone `convex codegen` bundled/uploaded to this isolated local backend and generated the real bindings with successful types. The initial unused private type export caught by codegen was removed from model; no helper behavior changed.

Next builds were serialized: the complete verify production build finished before the disconnected smoke harness began its separate production build. No browser Preview automation or shared integration target was used.

| Check | Result |
| --- | --- |
| `pnpm verify` | All app/test/Convex types, lint, **233 files / 2,869 tests**, production Next build pass |
| `pnpm exec eslint . --max-warnings 0` | Pass, zero warnings |
| `pnpm knip` | Pass, including configuration hints |
| Focused Marketing/permission/privacy/invitation/coupon/affiliate/report/capture + finance/messaging/security | **590 tests / 27 files** pass across two focused runs |
| Retirement/retention regression | **3 tests** pass (also included in the focused and full runs) |
| Complete functional UI suite | **223 passed**, 24 existing opt-in captures skipped, two workers |
| Disconnected smoke, `E2E_PORT=3068 pnpm test:e2e:smoke` | **13 passed**, separate serial production build |
| Fixed-base AST and resolved dependencies | **36 moved / 3 retained registrations, 129 helper/retained declarations, 1,686 other declarations, 4,260 bindings** equal |
| Model/runtime graph and production-source inventory | Pass; exported plain implementations, no reachable registrations/cycles/extra implementation files |
| Actual schema export | Equal, **74 tables** and identical hash |
| Public access inventory | **295 explicit / 0 raw** |
| Real isolated local CLI generation | Pass, component-aware, successful codegen/types |
| `pnpm arch:score --phase 2` and `--phase2` | **19/19** gates pass on the clean committed tree; no gate changed |

The first full UI run used the default worker count during parallel type/codegen work and reported two timeouts (returning-guest selection and a spend-dialog bounding-box lookup), with 221 passed. Both tests passed immediately on a one-worker recheck. The complete suite then passed all 223 checks with two workers and unchanged assertions/timeouts; original and final logs are retained. No product or test workaround was introduced.

The focused runs cover the eight original Marketing suites plus retirement, coupon redemptions, guest chat coupons, POS coupon orders/refunds, staff roles/invitations, admin bookings/corrections/payments/Stripe, auth builders, root security/messaging retirement, durable tool recovery and messaging reliability (**502 tests / 22 files**); additional money cutover, appointment finance/corrections, POS coupon rules and offer rules pass **88 tests / 5 files**. The retention test additionally checks the exact new stored continuation name, cutoff payload and absolute scheduled time, then advances one day and proves the original cutoff and aggregate/link counters survive all pages.

Independent review, CI/Preview state and root-controlled live backend acceptance remain pending. Local mocked financial/provider/messaging tests and disconnected UI smoke do not constitute those operations.
