# Phase 3b: messaging ownership completion

Required dependent base: `8be1dd4e73af8e2dcaa2666c80497aaf94da8b7a`, Settings PR [#71](https://github.com/Ruckth/360-tour/pull/71), atop concierge #70 and the required dependency history. This prepared isolated `t3/complete-messaging-ownership` worktree was clean at `3ca332d` and fast-forwarded to the exact required base. No rebase, reset, origin/main substitution or unpublished-history rewrite occurred. The original dirty `/Users/macbook/Development/360-tour` and root review checkout were untouched. This PR targets **t3/phase3b-settings-move**. `.arch-phase` stays **2**. Root owns independent reviews, new Preview isolation checks, gated backend acceptance, live reconciliation/cutover and merge.

## Ownership and limits

Rules 2–5 and the messaging domain map in [the accepted architecture plan](../plans/scalable-architecture-plan.html) govern this completion. Phase 2 moved ingress, workers, adapters and durable evidence; it did not finish messaging ownership. The preceding [concierge](phase3b-concierge-implementation.md) and [settings](phase3b-settings-implementation.md) implementation notes explicitly reserved these remaining root APIs/helpers and mixed alert/maintenance actions.

Messaging now owns actual guest/staff session APIs, transcript reads, browser handoffs, suggestions, inbox transitions/expiry, lead capture, admission budgets, staff requests/alerts, channel reply-window reads and rate-limit cleanup. All 41 moved endpoints contain their original real registrations. Old source endpoints are removed; no compatibility registration, forwarding proxy, alias or endpoint re-export is introduced. Every moved messaging source is below 1,000 lines; the largest is `messaging/adminChat.ts` (929 lines).

`messaging/model.ts` exposes named plain implementations only. `pipeline.ts`, `staffRequests.ts`, `leadWriter.ts`, `claims.ts` and the state/token/limit helpers contain those implementations without importing registration modules. The audit follows erased-TypeScript-aware value imports/re-exports from model, rejects any reachable registration, and rejects runtime cycles. Auth guest builders import the token helper through this seam. The original `maintenancePaused` arrow function is extracted unchanged to **backend-only `lib/maintenance.ts`**, with auth/model retaining its plain helper export; durable claims/pipeline consume the same predicate directly. This narrowly necessary dependency seam removes auth → messaging model → auth initialization cycles. It creates no new maintenance function endpoint or policy and does not move generic-maintenance evals.

Actual pure frontend-shared `lib/chatPresence.ts`, `chatSuggestions.ts`, `inboxTypes.ts` and proposal identity rules remain unchanged for 3c. `chatPresence` has no ctx implementation to move. `assertChatWriteAllowed` moves out of the mixed write guard; pure proposal identity/comparison stay. The combined channel window implementation has no frontend importer and moves once, keeping the same 24-hour predicate and bounded read. `lib/chatReuse.ts` is also pure. `lib/chatCoupon.ts` retains the existing booking/coupon quote and explicit-guest-choice policy (including its bounded transcript read); moving that pricing/marketing policy would exceed messaging ownership. The existing pure unknown-reply copy seam remains 3c work. No browser imports a ctx-heavy model/private helper. Backend consumers use messaging/model; HTTP remains the existing composition root importing its real ingress factory. Worker/ingress/channel paths and HTTP routes stay stable.

The eight messaging tables remain owned by `messaging/tables.ts`, including rateLimits. Settings/model's existing plain email configuration/escaping/sender helpers are reused by the moved default-runtime staff-alert action. Actual booking confirmation/owner/lifecycle email registrations remain in root emails. Marketing, auth identity/grants, bookings, services, POS registries and generic maintenance/evals remain with their current owners. This does not claim broader Phase 3 completion.

## Complete endpoint mapping

Each old module/function maps to the same function name in the new module below, with identical resolved builder, public reason/capability/permission, args/returns and handler AST. This table accounts for all **41** moved registrations.

| Old module | New module | Exact function names |
| --- | --- | --- |
| `chat` | `messaging/chat` | `createSession`, `touchSession`, `closeSession`, `createBrowserHandoff`, `claimBrowserHandoff`, `identifyVisitor`, `acceptGuestMessage`, `addAssistantMessageWithSuggestions`, `getSession`, `getSessionInternal`, `isAiPaused`, `getMessages`, `getRecentMessages`, `sendMessage` |
| `adminChat` | `messaging/adminChat` | `listSessions`, `getSessionDetail`, `settleGuestMessage`, `listTranscriptMessages`, `getTranscript`, `setSessionStatus`, `setAiPaused`, `setStaffTask`, `setKeepWithStaff`, `deleteSessionChildren`, `deleteArchivedSession` |
| `adminReply` | `messaging/adminReply` | `claim`, `complete`, `fail` |
| `chatSuggestions` | `messaging/chatSuggestions` | `nextForSession`, `markShown`, `markClicked` |
| `inboxLifecycle` | `messaging/inboxLifecycle` | `expireAnswer`, `expireStaffSend` |
| `leads` | `messaging/leads` | `save`, `list`, `exportRows`, `remove` |
| `chatAi` | `messaging/admission` | `consumeChatLimit` |
| `chatKnowledge` | `messaging/staffHandoff` | `alertStaffForHandoff` |
| `emails` | `messaging/alerts` | `sendStaffAlert` |
| `crons` | `messaging/maintenance` | `cleanRateLimits` |

The ten retained mixed-module registrations are `emails:{sendBookingConfirmation,sendOwnerNotification,sendCancellation,sendPreArrival,sendBookingUpdated,sendReviewRequest}` and `crons:{cleanRawMarketing,expireBookingHold,expirePending,queueLifecycleEmails}`. Auth/model retains its actual builders, not endpoint proxies.

## Helper ownership mapping

Whole guest/admin chat, reply, suggestion and inbox registration modules retain all of their original private declarations together. Additional split/moved declarations are enumerated below, including originally private names; they are not all public model exports.

| Old source | Actual implementation owner | Exact declaration names |
| --- | --- | --- |
| `convex/leads.ts` | `convex/messaging/leads.ts` | `leadSource`, `EXPORT_LIMIT`, `save`, `list`, `exportRows`, `remove` |
| `convex/leads.ts` | `convex/messaging/leadWriter.ts` | `recordLead` |
| `convex/chatKnowledge.ts` | `convex/messaging/staffRequests.ts` | `word`, `STAFF_VERBS`, `STAFF_PEOPLE`, `STAFF_ALONE`, `STAFF_REQUEST`, `asksForStaff`, `claimStaffAlertSlot`, `queueStaffAlert` |
| `convex/chatKnowledge.ts` | `convex/messaging/staffHandoff.ts` | `alertStaffForHandoff` |
| `convex/lib/guestToken.ts` | `convex/messaging/guestToken.ts` | `createGuestToken`, `hashGuestToken`, `requireGuestToken` |
| `convex/lib/chatAdmission.ts` | `convex/messaging/chatAdmission.ts` | `chatLimiter`, `consumeChatAdmission` |
| `convex/lib/adminChatMetadata.ts` | `convex/messaging/adminChatMetadata.ts` | `SearchableSession`, `SortableSession`, `AdminChatMetadataPatch`, `normalizeAdminSearchText`, `buildAdminSearchText`, `getAdminChatSortAt`, `getAdminChatMessageCount`, `buildAdminChatMetadataPatch`, `patchSessionAfterMessages` |
| `convex/lib/inboxLifecycle.ts` | `convex/messaging/inboxState.ts` | `replyOutcomeValidator`, `ReplyOutcome`, `inboxNeedsStaff`, `latestGuestId`, `guestReceived`, `staffNeeded`, `answerAccepted`, `sendFailed`, `finishWithoutReply`, `changeStaffOwnership`, `assertNoPendingStaffSend` |
| `convex/lib/channelReplyWindow.ts` | `convex/messaging/channelReplyWindow.ts` | `CHANNEL_REPLY_WINDOW_MS`, `channelHasReplyWindow`, `getLastGuestMessageAt`, `getChannelReplyWindow` |
| `convex/lib/rateLimit.ts` | `convex/messaging/rateLimit.ts` | `rateLimitReached`, `enforceRateLimit` |
| `convex/emails.ts` | `convex/messaging/alerts.ts` | `sendStaffAlert` |
| `convex/crons.ts` | `convex/messaging/maintenance.ts` | `cleanRateLimits` |
| `convex/messaging/model.ts` | `convex/messaging/pipeline.ts` | `LEASE_MS`, `MAX_ATTEMPTS`, `recordGuest`, `nextEvent`, `scheduleNext`, `reconcile` |
| `convex/lib/chatWriteGuard.ts` | `convex/messaging/writeGuard.ts` | `assertChatWriteAllowed` |
| `convex/auth/model.ts` | `convex/lib/maintenance.ts` | `maintenancePaused` |

Existing `messaging/claims.ts` helpers and validators retain their paths; the model re-exports those plain implementations. No worker event, lease, tool result or admission component state is reset.

## Explicit codemod and contract evidence

`scripts/move-messaging-domain.mjs` is the fixed-base one-shot source codemod and repeatable read-only `--check`. It maps dot/bracket api/internal references, raw RPC/CLI strings, named imports (including split ownership), dynamic named imports, explicit module maps, Next admin reply route, scheduler/cron targets, eval context callers, hooks/adapters, browser/test fixtures and current access inventory. Historical implementation records and earlier fixed-base move scripts retain historical references. Explicit negative security tests for already retired, nonexistent root paths are retained as negative tests; rate-limit keys are not RPC names.

The final audit proves **41 moved registrations, 10 retained registrations, 147 helper/private/builder declarations, 4,130 resolved bindings and 1,647 other production declarations** equal the required base. It resolves bindings through imports/re-exports to original implementations, including auth builders and the model seams. Only trivia, lifted export modifiers and named export ordering normalize; literal/template/regex content, operator order, validators, capabilities, reasons, permissions, bounds, branches, return values and arithmetic remain significant. It rejects additional logic in moved files, old runtime endpoints/imports, oversized files, private domain bypasses, browser model imports, reachable registrations and model runtime cycles. Reference replacement has repeatability/prefix-boundary assertions so `getSession` cannot rewrite `getSessionInternal` or a similarly named retired endpoint.

Actual `schema.export()` values are equal: **74/74/74** base/current/static tables, SHA-256 **c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6**. Only object keys and top-level table order normalize; union/compound-index order remains significant. There are no schema, data, dependency, lockfile, product, policy or phase changes. `scripts/ai-accuracy-eval.mjs` is byte-for-byte unchanged: root's `modelOverride: true`, explicit `forcedModel`, honest `routingCoverage: false` and satang/BPS-to-baht expectation fixes remain. No live eval ran.

Preserved behavior includes hashed web-only/session-bound credentials, private transcript projection/ownership/pagination, one-use browser token rotation/expiry, duplicate admission and clientMessageId checks, fixed-window 20/session/hour and 500/global/hour with ten global shards, inbox state transitions and bounded reads, staff takeover/identity/replyTo/status/revision checks, provider reply windows/dispatch uncertainty, durable claims/order/semantic tool keys/recovery/commit, eval exclusion and rolling global **30/hour** plus per-session **30-minute** alert guards. LINE/Meta/WhatsApp security and transport implementations are unchanged.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-messaging-domain.mjs --check > output/phase3b-messaging/move-audit.json
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base 8be1dd4e73af8e2dcaa2666c80497aaf94da8b7a --out output/phase3b-messaging
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/arch-scorecard.mjs --phase 2 --json
```

## Exact stored-job reconciliation for root

**A source codemod does not migrate stored jobs.** This implementation inspects/mutates no shared/production queues. Before removing old code under the traffic gate, root must inventory pending/in-progress/failed/ambiguous scheduled records and external producers, recording original job IDs, full unredacted args in secure operational evidence, absolute scheduled timestamps, status and attempt/claim/delivery evidence. Audit both `module:function` and serialized `module.js:function` paths. Drain old jobs while old code remains, or cancel/reconcile and deliberately replace each eligible pending job exactly once at its original absolute time under the accepted new backend. Elapsed jobs are reconciled individually, not given a fresh TTL. Running or ambiguously delivered actions require outcome reconciliation before any replacement. The implementation does not perform that operational step.

| Stored target / producer | Exact mapping, args, timing and reconciliation |
| --- | --- |
| `inboxLifecycle:expireAnswer` / `inboxLifecycle.js:expireAnswer` | → `messaging/inboxLifecycle:expireAnswer` / `messaging/inboxLifecycle.js:expireAnswer`. Preserve **`{sessionId,messageId}`** and the original absolute due time (originally guest receipt + 60,000ms). Keep latestGuestMessageId, inbox reason, answered/settled ownership, staff send and archived/done guards. Never restart generation or replay guest admission to manufacture an expiry. |
| `inboxLifecycle:expireStaffSend` / `inboxLifecycle.js:expireStaffSend` | → `messaging/inboxLifecycle:expireStaffSend` / `messaging/inboxLifecycle.js:expireStaffSend`. Preserve **`{requestId}`** and original due time (claim + 90,000ms). Preserve adminReplyAttempts status/adminEmail/content/replyTo/completedAt, inboxSendRequestId and possible provider delivery. A timeout is uncertainty, not permission to resend; never reset the pending attempt or claim a new request ID. |
| `emails:sendStaffAlert` / `emails.js:sendStaffAlert` | → `messaging/alerts:sendStaffAlert` / `messaging/alerts.js:sendStaffAlert`. Preserve complete **`{sessionId,channel,guestName,lastMessage}`** as originally queued (zero delay) and absolute due time, rather than rebuilding names/text from today's session. Preserve lastStaffAlertAt and rolling staff-alert:global timestamps/count/expiry, eval exclusion and inbox handoff evidence. Email and optional LINE can succeed independently; inspect each outcome before any manual replacement. No idempotency key/receipt is added by this move, so a successful/ambiguous send must not be blindly replayed. Do not call queueStaffAlert again to migrate the job. |
| `crons:cleanRateLimits` / `crons.js:cleanRateLimits` | → `messaging/maintenance:cleanRateLimits` / `messaging/maintenance.js:cleanRateLimits`. Preserve **`{}`** and original due times for hourly cron and zero-delay continuations. Keep the root cron name/cadence **clean rate limits / `{hours:1}`** with only the target ref updated. Preserve all still-live rateLimits rows/counters/timestamps/expiresAt and rate-limiter component state; the implementation deletes only the same bounded 100 expired rows. Do not clear budgets or replay the entire cron schedule. |
| `adminChat:deleteSessionChildren` / `adminChat.js:deleteSessionChildren` | → `messaging/adminChat:deleteSessionChildren` / `messaging/adminChat.js:deleteSessionChildren`. Preserve **`{sessionId}`** and original zero-delay continuation time. Continue bounded 200-row cleanup against the same archived/deleted conversation; keep webhook/event logs, unknown-question unlinking and already-deleted children. Do not rerun archive/delete commands or recreate the parent. |
| Other moved internal RPCs | `chatAi:consumeChatLimit` → `messaging/admission:consumeChatLimit` retains `{sessionId}`; no first-party stored producer exists. Do not repeat an ambiguous admission and charge another quota. `chatKnowledge:alertStaffForHandoff` → `messaging/staffHandoff:alertStaffForHandoff` retains `{durableTurn?:{eventId,claimToken},sessionId,lastMessage,replyToMessageId?}`; synchronous mutation callers are updated. Preserve claims/leases and cooldown evidence; do not replay stale handoffs. Other moved chat reads/writes likewise retain full args; audit unexpected external stored producers rather than assuming they do not exist. |
| Stable worker/ingress | `messaging/worker:{run,recover,...}`, `messaging/ingress:accept` and channel paths do not change. Retain event IDs, eventKey/channel dedupe, user/client message IDs, nextAttemptAt, attempts, claimToken, leaseExpiresAt, deliveryStartedAt, dispatchState, content/response/toolResults and pending semantic tool keys. Never reset or replay these to compensate for an API rename. Resume/reconcile using existing durable rules and uncertain-delivery state. |
| `emails:sendBookingConfirmation` / `sendOwnerNotification` | Paths unchanged. Retain the full queued **guestName, guestEmail, propertyName, checkIn, checkOut, nights, guests, total, currency** payload; owner additionally **guestPhone**. Preserve zero-delay absolute times and confirmationEmailsQueuedAt. Do not invoke booking/payment mutations or force resend to migrate these jobs; reconcile ambiguous delivery. Actual booking email closure remains later work. |
| `emails:sendCancellation` / `sendPreArrival` / `sendBookingUpdated` / `sendReviewRequest` | Paths unchanged. Retain **`{bookingId,attempt?}`**, absolute times and attempts; eligible failures retry after **5min × 2^attempt**, while attempt < 3. Preserve booking eligibility/status/money and cancellation/pre-arrival/review queue markers. No new retry cycle or send is authorized. |
| `crons:expireBookingHold` | Path unchanged. Retain **`{bookingId,expectedRevision}`**, original absolute expiry and any later rescheduled current deadline. Do not reset booking money, payment identity, revision or hold. Existing status/deadline re-read remains authoritative; staff edits do not disable expiry. |
| `crons:expirePending` | Path unchanged. Retain **`{cutoff?,cursor?}`** for continuations, their original absolute times and cutoff snapshot. The root hourly `{}` producer stays unchanged. Preserve bounded 100-row pagination and each booking's actual hold deadline. |
| `crons:queueLifecycleEmails` | Path unchanged. Retain **`{kind:'preArrival'|'review',cursor?,today?}`**, resort-date snapshot, absolute continuation times and queue markers. Root daily cron stays **02:00 UTC** with `{kind:'preArrival'}` or `{kind:'review'}`. Gate these email producers with booking/payment writes; do not rebuild jobs from a new today's date. |
| `crons:cleanRawMarketing` | Path unchanged. Preserve **`{cutoff?}`**, original absolute continuation time/cutoff and daily **03:00 UTC** `{}` producer. Raw retention/100-row bounds and permanent aggregate/frozen records remain unchanged. No marketing ownership move occurs. |
| Stable remaining cron targets | `bookings/calendar/ical:syncAll` every 30min `{}`, `services/maintenance:cleanStaffAvatarUploads` every 6h `{}`, `pos/displays:cleanPending` every 10min `{}`, and `messaging/worker:recover` every minute `{}` retain their exact names/refs/args. Parent ownership cutover obligations (iCal generation/ticket/cursor, POS lease/approval/customer merge state, service roster jobs) still apply. No queue observation from another domain proves this queue safe. |

Public clients/external RPC producers must reconnect using the endpoint mapping with the complete original payloads and caller identity/capability. Preserve pagination cursors/read bounds, token scopes, original clientMessageId, handoff one-use state and admin reply request IDs. Drain in-flight writes. After ambiguous mutation completion, reconcile persisted session/message/attempt/revision/interaction state before retry. No old compatibility endpoints remain after acceptance.

## Preview evidence and backend-first acceptance

Initial read-only PR #71 metadata confirmed OPEN, exact head `8be1dd4e73af8e2dcaa2666c80497aaf94da8b7a`, branch `t3/phase3b-settings-move`. The final pre-push check found #71 MERGED; `git ls-remote` still confirmed that named branch at the exact required commit. The implementation preserves that base/history and the explicitly requested PR target. The supplied `/tmp/360-arch-phase3b-concierge-preview-target.json` identifies concierge head **6d2c4ec82f285b891891d973ebd6ff09b8e21a99**, Preview **dpl_BNruu97BWXSM2Eycy8NM8gw76dDK**, only **https://resolute-tiger-204.convex.cloud**, and `sharedProductionAndDevExcluded:true`. Its ignored copy is `output/phase3b-messaging/pre-push-preview-target.json`. This is preceding evidence, not proof of the actual new Messaging Preview target. `vercel.json` and pnpm vercel-build are unchanged; no remote environment/secret was read or changed. Root must check the **new Preview's actual logs** after push, excluding shared production wary-toad-189 and shared development optimistic-turtle-573. Neither shared target was inspected or operated on here.

1. Keep this PR stacked/open for independent root review. Reconfirm exact dependency history, the actual new Preview's dedicated backend and parent cutover state.
2. Gate web/social ingress, guest/staff/admin/lead/suggestion RPCs, external producers and Next admin replies. Quiesce messaging workers/expiry/cleanup/alert producers and any affected parent/email producers. Drain in-flight transactions/actions. Inventory/reconcile stored jobs as above while no producer can add an old path; retain complete args/times/idempotency/claims/uncertainty securely.
3. **Push and accept the renamed backend with traffic gated BEFORE any merge-triggered frontend build.** Root checks unchanged schema/data, removed old endpoints, correct actual scheduler dispositions, guest token/transcript/handoff admission policy, staff roles/inbox/replyTo/revisions, quotas/cooldowns/eval exclusion, provider windows/security and durable claims/recovery/uncertainty. This implementation authorizes no live email, provider call or model eval.
4. **Merge only after gated backend acceptance.** Git integration triggers frontend builds. If a prior merge is unavoidable, root disables production Git deployment before it and restores it after backend acceptance. Existing convex deploy --cmd runs the frontend command before the final backend push, so it cannot by itself accept this incompatible rename first. Build/publish against the accepted backend, invalidate stale/paused artifacts and reload clients holding old RPC references.
5. Root verifies accepted frontend/backend behavior, then restores traffic/producers and records exact live acceptance/reconciliation. Coordinate frontend/backend rollback and queued/external jobs under the same gate. Never reset durable evidence or data to simplify rollback.

## Validation

Node **22.22.3**, `/opt/homebrew/opt/node@22/bin`; ignored evidence: `output/phase3b-messaging/`. A fresh checkout-local anonymous backend at **http://127.0.0.1:3270**, HTTP actions **3271**, deployment `anonymous:anonymous-agent`, generated component-aware API types through installed Convex **1.34.1** and convex-helpers **0.1.120**. The only configured value is a deliberately nonfunctional local JWT issuer `https://messaging-local.invalid`. No shared credentials were copied; no seed/reset, real sign-in, live eval/send, external provider request or shared deployment occurred. Real `convex dev --local` and standalone `convex codegen` succeed with the rateLimiter component.

The initial full test run exposed repeated-prefix errors in string fixtures during codemod iteration; it was stopped and retained as superseded evidence. The corrected boundary-aware codemod regenerated references from the exact base; the three affected fixture suites pass **39/39**. No assertions or detector were silenced. The committed-HEAD maintenance test then exposed an inline-flag assumption in offline archive preparation. `scripts/architecture-maintenance.mjs` now resolves the extracted flag's actual value import, verifies its exact predicate AST and compares the full archived helper source with the reviewed Git source before any writes. Missing or modified helpers fail closed. The archive fixture includes that reviewed dependency; two new cases prove rejection leaves the reset file absent. Historical inline/raw-builder preparation is unchanged. This is offline tooling only, not a live maintenance operation. The three committed tooling/access/schema suites pass **25/25**. Final results are recorded below.

| Check | Result |
| --- | --- |
| Fixed-base implementation/binding/acyclic model audit | Pass, counts above |
| Actual schema exports | Equal, 74 tables and matching SHA-256 |
| Real isolated local CLI generation | Pass |
| Focused token/handoff/admission/inbox/admin reply/alerts/ingress/durable tools/reliability | 13 files / 155 tests pass |
| Focused staff-role/maintenance/AI/money/coupons/cards/admin route/delivery/LINE security | 9 files / 163 tests pass |
| Fixture regression | 3 files / 39 tests pass |
| Final auth/maintenance/inventory focus | 3 files / 13 tests pass |
| Committed-HEAD schema/tooling/access inventory | 3 files / 25 tests pass |
| pnpm test:booking-ui | 223 pass, 24 existing opt-in captures skipped |
| pnpm verify | App/test/Convex types, lint, 232 files / 2,867 tests and production build pass |
| Zero-warning lint / Knip | Pass, including Knip configuration hints |
| Serial smoke production build + tests | 13 pass after its own serial production build |
| Phase 0–2 gates / public inventory / raw public | 19/19 on clean implementation commit / 295 / 0 |

UI uses the existing browser fixtures. Verify and smoke build serially with explicit disconnected placeholder Convex/Clerk values; those checks do not establish live Clerk/provider/shared-data/cutover acceptance. No metric/gate/phase target changed. Later gaps remain visible: 24 app as-never casts, 75 src→convex/lib imports, one convex→src import, 34 demo references, three CI placeholders, one existing >1,000-line fixture, 52 no-login return-validator gaps and the missing Phase 4 read-budget test/architecture recipe. Nine table owners and zero cross-domain bypasses do not establish Phase 3 completion.

No independent review approval, live backend acceptance, shared cutover or merge is claimed.

## Root review and acceptance preparation

Spec and Standards reviews found no findings at `6ae8d81`. The independent safety audit also found no new defects; it checked the moved implementations and scheduler mapping, ran 202 focused tests, Convex types and the Phase 2 gates. Its small retirement-test gap is closed by a runtime regression in `phase0Security.test.ts`: all eight removed root messaging modules fail module resolution, while the two functions removed from retained email/cron modules fail export resolution. These checks distinguish missing endpoints from argument or authorization failures. The updated security suite passes 10/10, test types pass and its lint has zero warnings.

Root's serial full verify at `6ae8d81` passed 2,867 tests, all typechecks, production build and zero-warning lint; Knip, 19/19 gates and schema export equality against merged Settings `57431fb` also passed. A merge-tree comparison proves integrating that merged parent leaves the reviewed source tree identical, so the PR was retargeted to `main` without a redundant merge commit.

The actual `6ae8d81` Preview `dpl_42rA2AdhuaM86zVS6wvFamUiDcsj` is READY and its build logs name only isolated `colorful-kiwi-854.convex.cloud`, excluding production and shared development. This evidence applies to that head; any later Preview must be checked separately. Root captured a read-only production inbox/transcript/lead baseline and verified guest-token and staff boundaries without invoking alerts. No messaging backend cutover, live staff/provider delivery or final acceptance is claimed by this preparation.
