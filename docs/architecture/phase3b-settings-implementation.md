# Phase 3b: settings backend domain

Required dependent base: `6d2c4ec82f285b891891d973ebd6ff09b8e21a99`, open concierge PR [#70](https://github.com/Ruckth/360-tour/pull/70), including the root accuracy-eval report and money-unit fixes atop POS #69. The clean prepared `t3/phase3b-settings-move` worktree initially pointed at `3ca332d`; it was fast-forwarded to this exact required base. No reset, rebase, origin/main substitution or unpublished-history rewrite occurred. The unrelated dirty `/Users/macbook/Development/360-tour` and root review checkout were not modified. This PR targets **t3/concierge-phase3b-move**. `.arch-phase` remains **2**. Root owns reviews, actual Preview inspection, live acceptance, cutover, retargeting and merge.

## Ownership and unchanged behavior

Rules 2–5, Phase 3b and the nine-domain/table map in `docs/plans/scalable-architecture-plan.html` govern this settings-only move. Settings owns `siteSettings`, `cashierRules`, `configurationHistoryIndex` and `recordChanges`. Their existing `settings/tables.ts` definitions and root schema assembly are unchanged.

- `settings/settings.ts` contains the original nine settings registrations and channel-health helper. Defaults, field validation, revision checks, safe snapshots, legacy booking-rule restore defaults, retained AI instructions, secret-presence booleans, explicit public-profile projection, bounded channel failures, channel credential-health flags and iCal discovery are unchanged.
- `settings/configurationHistory.ts` contains the original deleted-villa/room discovery registration. `settings/recordHistory.ts` contains the authenticated history registration, including entity-specific marketing permission/redaction, owner-only grant/cashier history and operations authorization. Pagination and all per-record checks stay in the actual handlers.
- `settings/cashierRules.ts` contains only `getCashierRules` and `updateCashierRules`, extracted from mixed `staffAccess.ts`. Their original `manageTeam` capability, default/refund fallback, revision conflict, integer BPS bounds and transactional history are unchanged. The actual plain `cashierRules(ctx)` loader moves from `lib/staffAccess.ts` to private `settings/cashierPolicy.ts`. Retained cashier action/discount/receipt policies import this same implementation through the settings model; no policy is duplicated.
- `settings/emails.ts` contains only the original `sendTestEmail` admin action. Five actual plain helpers (`escapeHtml`, `loadSettings`, `fromHeader`, `ownerNotificationEmail`, `footerHtml`) move from mixed `emails.ts` to private `settings/emailTransport.ts`. Retained email actions import these implementations through `settings/model.ts`. The Resend call, environment guards, owner/admin fallback, sanitized sender display name, HTML escaping, error handling and response shape are unchanged. No transport wrapper or compatibility action is introduced.
- `settings/model.ts` holds the original `getSiteSettingsRow` and `getEffectiveSettings` implementations and explicitly exposes the plain history, configuration, cashier and email helpers. Other backend domains and remaining ctx-lib consumers use this seam in their existing transaction. There are no endpoint exports or generic forwarding functions in the model.
- `settings/configurationWriter.ts` owns the original safe settings/property/room snapshots, configuration index/writer and OTA history implementation. `settings/recordWriter.ts` owns the original append-only history writer, including finite effective-time validation. All writes remain in the caller's transaction.
- `lib/siteSettings.ts` now contains only actual pure defaults, metadata, merging, validators and booking-hold rules. `lib/staffTypes.ts` retains actual pure cashier metadata/validators/defaults. These frontend-shared implementations stay in place pending Phase 3c; there are no forwarding aliases, duplicate rules or ctx-heavy browser imports.

The **14 moved registrations** retain adminQuery 6, internalQuery 1, publicQuery 1, staffMutation 3, staffQuery 1, adminAction 1 and authenticatedQuery 1. All builders and capability/reason/auth/permission metadata, args/returns and handler implementations match the exact fixed base after reference substitutions. Public inventory remains **295 / raw 0**. No product, schema, data, dependency, money, access policy, provider configuration or delivery behavior change is introduced.

## Mixed-file ownership deliberately retained

`staffAccess.ts` retains actual `currentInternal`, `myAccess`, `claimInvite`, `listPeople`, `setGrant` and `updateInvitation` registrations. Identity lookup, admin allowlist, staff/marketing grant separation, invitation claim/expiry/renewal and history behavior stay there; these are not compatibility proxies. The remaining `lib/staffAccess.ts` identity, access, action/discount and cashier business-date receipt helpers stay for later ownership closure.

`emails.ts` retains actual `sendBookingConfirmation`, `sendOwnerNotification`, `sendCancellation`, `sendPreArrival`, `sendBookingUpdated`, `sendReviewRequest` and `sendStaffAlert` internal actions, plus escaped booking fields, money formatting and lifecycle retry/send implementation. Their ownership is still bookings/messaging closure work. No broad auth, messaging, marketing or maintenance move is claimed. Existing mixed crons, guest/staff APIs, auth/grants and remaining ctx-lib helpers still need closure after settings; nine table folders do not mean Phase 3 is complete.

## Complete RPC mapping

No old endpoint aliases remain. Generated dot references use the same slash-separated module mapping, for example `internal.settings.effective` becomes `internal.settings.settings.effective`.

| Fixed-base RPC | New RPC |
| --- | --- |
| `settings:get` | `settings/settings:get` |
| `settings:effective` | `settings/settings:effective` |
| `settings:publicProfile` | `settings/settings:publicProfile` |
| `settings:update` | `settings/settings:update` |
| `settings:restore` | `settings/settings:restore` |
| `settings:channelHealth` | `settings/settings:channelHealth` |
| `settings:serverConfig` | `settings/settings:serverConfig` |
| `settings:setupChecklist` | `settings/settings:setupChecklist` |
| `settings:admins` | `settings/settings:admins` |
| `configurationHistory:records` | `settings/configurationHistory:records` |
| `recordHistory:list` | `settings/recordHistory:list` |
| `staffAccess:getCashierRules` | `settings/cashierRules:getCashierRules` |
| `staffAccess:updateCashierRules` | `settings/cashierRules:updateCashierRules` |
| `emails:sendTestEmail` | `settings/emails:sendTestEmail` |

## Complete implementation declaration mapping

Every top-level declaration from the moved or split sources is listed, including retained implementation declarations. Type-only and private declarations retain their exact syntax apart from an export modifier on extracted email helpers.

| Original source | Current owner | Declarations |
| --- | --- | --- |
| `convex/settings.ts` | `convex/settings/settings.ts` | `text`, `get`, `effective`, `publicProfile`, `update`, `restore`, `DAY_MS`, `FAILED_SCAN_LIMIT`, `CHANNEL_TABLES`, `ChannelKey`, `channelStats`, `channelHealth`, `serverConfig`, `setupChecklist`, `admins` |
| `convex/configurationHistory.ts` | `convex/settings/configurationHistory.ts` | `records` |
| `convex/recordHistory.ts` | `convex/settings/recordHistory.ts` | `list` |
| `convex/lib/configurationHistory.ts` | `convex/settings/configurationWriter.ts` | `settingsSnapshot`, `propertySnapshot`, `roomSnapshot`, `logConfiguration`, `configurationWriter`, `logOtaRate` |
| `convex/lib/recordHistory.ts` | `convex/settings/recordWriter.ts` | `appendRecordHistory` |
| `convex/lib/siteSettings.ts` | `convex/lib/siteSettings.ts` | `bookingRulesValidator`, `BOOKING_RULE_DEFAULTS`, `BookingRules`, `BOOKING_RULE_RANGES`, `resolveBookingRules`, `SITE_DEFAULTS`, `BUSINESS_FIELDS`, `BusinessField`, `BusinessSettings`, `AiSettings`, `EmailSettings`, `EffectiveSettings`, `mergeSiteSettings`, `EMAIL`, `TIME`, `Rule`, `email`, `time`, `timezone`, `BUSINESS_RULES`, `AI_RULES`, `EMAIL_RULES`, `MAX_WORDS_RANGE`, `SettingsErrors`, `cleanText`, `SettingsInput`, `validateSettingsInput`, `bookingHoldExpiresAt` |
| `convex/lib/siteSettings.ts` | `convex/settings/model.ts` | `getSiteSettingsRow`, `getEffectiveSettings` |
| `convex/lib/staffAccess.ts` | `convex/lib/staffAccess.ts` | `StaffRole`, `staffCapabilities`, `StaffCapability`, `StaffAccess`, `StaffActor`, `staffInvitationExpiry`, `accessForIdentity`, `staffAccess`, `requireStaff`, `requireCashierAction`, `manualReduction`, `assertCashierDiscount`, `canReadCheckoutOrder` |
| `convex/lib/staffAccess.ts` | `convex/settings/cashierPolicy.ts` | `cashierRules` |
| `convex/staffAccess.ts` | `convex/staffAccess.ts` | `currentInternal`, `myAccess`, `claimInvite`, `listPeople`, `setGrant`, `updateInvitation` |
| `convex/staffAccess.ts` | `convex/settings/cashierRules.ts` | `getCashierRules`, `updateCashierRules` |
| `convex/emails.ts` | `convex/settings/emailTransport.ts` | `escapeHtml`, `loadSettings`, `fromHeader`, `ownerNotificationEmail`, `footerHtml` |
| `convex/emails.ts` | `convex/emails.ts` | `escapedFields`, `sendBookingConfirmation`, `sendOwnerNotification`, `formatMoney`, `LifecycleKind`, `retryLifecycleEmail`, `sendLifecycleEmail`, `sendCancellation`, `sendPreArrival`, `sendBookingUpdated`, `sendReviewRequest`, `sendStaffAlert` |
| `convex/emails.ts` | `convex/settings/emails.ts` | `sendTestEmail` |

Every moved file is below 1,000 lines; the largest is **settings/settings.ts, 309 lines**. No schema/table source, dependency, lockfile, package script or phase marker has changed.

## Explicit codemod and contract evidence

`scripts/move-settings-domain.mjs` is the one-shot fixed-base codemod and repeatable read-only `--check` audit. It moves original declarations, splits mixed named imports by symbol ownership, updates dot/bracket api/internal references, raw RPC/CLI strings, explicit test module maps, frontend adapters, fixtures, the Next admin config-status route, current access inventory and accuracy-eval settings read. Cron/helper callers retain their actual schedules and implementations; no settings RPC is directly targeted by a first-party cron or scheduler.

The accuracy-eval script changes **only** `settings:effective` to `settings/settings:effective`. The required base's honest `modelOverride: true`, `forcedModel`, `routingCoverage: false` and SATANG/BPS-to-baht expected price calculation remain intact. No live eval was run.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-settings-domain.mjs --check > output/phase3b-settings/move-audit.json
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base 6d2c4ec82f285b891891d973ebd6ff09b8e21a99 --out output/phase3b-settings
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/arch-scorecard.mjs --phase 2 --json
```

The audit proves **14 moved and 13 retained registration ASTs, 67 helper/private declarations, 4,117 resolved dependency bindings and 1,749 other production declarations** equal the base. It resolves import/re-export symbols to their original implementations, including builder and helper bindings through model seams. Normalization ignores comments, formatting and a lifted export modifier only; literal/template/regex content, operator order, validators, branches, returns, bounds, arithmetic and policies remain significant. It rejects extra declarations, old runtime imports/RPCs, endpoint model exports, oversized moved files and backend settings-private/browser model imports. Generated API bindings come from the real CLI, never the codemod. Historical implementation records and earlier one-shot move scripts intentionally retain their original evidence/base paths.

Actual `schema.export()` values equal the fixed base: **74/74/74** base/current/static tables and identical SHA-256 **c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6**. Only object keys and top-level table order normalize; union and compound-index order remain significant.

## Metrics and verification

| Metric | Required base | Settings |
| --- | ---: | ---: |
| Phase 0–2 gates on committed clean tree | 19/19 | 19/19 |
| Public inventory / raw registrations | 295 / 0 | 295 / 0 |
| Schema tables / actual domain table owners | 74 / 9 | 74 / 9 |
| Cross-domain imports bypassing model | 0 | 0 |
| App as-never casts | 24 | 24 |
| src imports convex/lib / convex imports src | 75 / 1 | 75 / 1 |
| Demo-mode references / CI placeholders | 34 / 3 | 34 / 3 |
| Missing architecture recipe document | 1 | 1 |
| Files above 1,000 lines | 1 | 1 |
| No-login return-validator gaps | 52 | 52 |
| Phase 4 required read-budget test | 0 / 1 | 0 / 1 |

The long file is the existing checkout fixture. Phase 3c shared rules, Phase 3d data loading/demo removal, architecture documentation and Phase 4 gaps remain visible. No detector, metric target, gate or policy was relaxed. The clean-tree gate fails honestly during implementation and passes after commit.

Commands use Node **22.22.3**, via `/opt/homebrew/opt/node@22/bin`. Ignored evidence is under `output/phase3b-settings/`.

| Validation | Result |
| --- | --- |
| pnpm verify | App/test/Convex types, lint, 232 files / 2,865 tests and production build pass |
| pnpm exec eslint . --max-warnings 0 | Pass, zero warnings |
| pnpm knip | Pass, including configuration hints |
| Focused settings/history/restore/permissions/cashier/channel-health/email-security/configuration | 15 files / 221 tests pass |
| pnpm test:booking-ui | 223 passed, 24 existing opt-in captures skipped |
| E2E_PORT=3057 pnpm test:e2e:smoke | 13 passed, separate serial production build |
| Fixed-base implementation and actual schema exports | Equal as described above |
| Real Convex CLI API generation | Pass, component-aware, isolated local backend only |

The first focused run exposed an existing scheduler isolation gap: the AI-prompt test could leave a staff alert running when the next test installed its email fetch mock. That test now uses fake timers and finishes all scheduled work before teardown restores real timers/mocks. The codemod includes this test-only adjustment. Production code/contracts/guards are unchanged; all email/provider requests in tests remain mocked.

Fresh checkout-local anonymous Convex state is `.convex/local/default/`, deployment `anonymous:anonymous-agent`, cloud **http://127.0.0.1:3260**, HTTP actions 3261. Real installed Convex **1.34.1** / convex-helpers **0.1.120** generated component-aware bindings through `convex dev --local --once`, followed by standalone `convex codegen` with the local dev process running. Initial setup required explicit anonymous mode and a nonfunctional local JWT issuer `https://settings-local.invalid`; no real issuer, secret or shared configuration was copied. The local backend has no delivery/provider credentials. No seed, reset, live email, message, model eval, payment/refund or external provider operation was performed.

UI checks use existing browser fixtures. Smoke and the verify production build use explicit disconnected placeholder Convex/Clerk configuration. Full verify finishes before smoke starts its own Next build. Committed-HEAD schema/tooling/access-inventory checks also pass: **3 files / 23 tests**. These checks do not establish real Clerk authentication, live provider delivery or shared-data/cutover acceptance.

## Preview evidence checked before push

The supplied root record `/tmp/360-arch-phase3b-concierge-preview-target.json` identifies concierge head **e195258c86eaa3d6a907b948c8608502f85826f3**, Preview **dpl_9gptPoMstiuh1i7qkvd9QvQc8kES**, only **https://hidden-squid-316.convex.cloud**, and `sharedProductionAndDevExcluded: true`. Its ignored copy is `preceding-preview-target.json`. Read-only PR #70 metadata confirms it remains open at the exact required **6d2c4ec82f285b891891d973ebd6ff09b8e21a99** on `t3/concierge-phase3b-move`. The later base commit corrects only the accuracy-eval report/money expectation; this preceding Preview record is not proof of the next actual Settings Preview target.

Immediately before push, root refreshed that record to the **exact required base** `6d2c4ec82f285b891891d973ebd6ff09b8e21a99`: Preview **dpl_BNruu97BWXSM2Eycy8NM8gw76dDK**, only **https://resolute-tiger-204.convex.cloud**, again `sharedProductionAndDevExcluded: true`. The fresh observation is retained as ignored `pre-push-preview-target.json`; the initial hidden-squid observation is retained separately. Neither preceding Preview establishes the new Settings Preview target.

Repository `vercel.json` and `pnpm vercel-build` configuration are unchanged. No provider environment or secret was accessed/changed. Root must inspect actual **new Settings Preview logs** after push and confirm its dedicated backend, excluding shared production **wary-toad-189** and shared development **optimistic-turtle-573**, before live acceptance. Neither shared target was operated on. The supplied root status says POS #69 cutover is paused for CI rerun only and production is healthy on services #68; this implementation does not operate or alter that state.

## Exact stored-job and RPC reconciliation

**No first-party stored scheduler target is renamed by this settings-only move.** None of the 14 moved registrations is referenced by a source `runAfter`, `runAt` or cron. The only moved internal query (`settings:effective`) is called synchronously by actions through `loadSettings`; it is not a scheduled target. Source codemods cannot rewrite persisted function identifiers, arguments, scheduled times, dispatch state or external job definitions. Root must inspect actual queues and external producers while quiesced, including unexpected old targets and `.js` serialization (for example `settings.js:effective` → `settings/settings.js:effective`).

| RPC / stored state | Exact mapping and disposition |
| --- | --- |
| settings:{get,effective,publicProfile,channelHealth,serverConfig,setupChecklist,admins} | Each maps to settings/settings with the same function name and `{}` args. Repoint cached/generated clients and external CLI/RPC producers. Reissue authorized reads on the accepted backend; never expose internal effective settings as a public fallback. Rebuild setup/profile artifacts created against old or paused paths. |
| settings:update | settings/settings:update. Preserve the complete original optional expectedRevision/business/bookingRules/ai/email args. Drain in-flight writes. If the result is ambiguous, inspect current revision and retained history before retry; expectedRevision is optional, so a blind retry can create another revision/history event. Do not reconstruct AI instructions from redacted history. |
| settings:restore | settings/settings:restore. Preserve `{historyId, expectedRevision, side}` exactly. Re-read the same settings entity's safe snapshot/current revision after ambiguous completion. Never rewrite the source history row or force the old expectedRevision through; restoration is a new validated revision retaining current AI instructions/provider configuration. |
| configurationHistory:records | settings/configurationHistory:records. Preserve optional `{propertyId}` and `{paginationOpts:{numItems,cursor}}`, with the original 1–50 bound. Existing table IDs/index entries and pagination state are unchanged; authorize discovery on the new path. |
| recordHistory:list | settings/recordHistory:list. Preserve `{entityType,entityId?,paginationOpts:{numItems,cursor}}`, with the original 1–100 bound and exact entity IDs. Reconnect with the current caller identity so marketing redaction and owner/operations checks still run. No log row is migrated or replayed. |
| staffAccess:getCashierRules / staffAccess:updateCashierRules | settings/cashierRules:getCashierRules / settings/cashierRules:updateCashierRules. Read args remain `{}`; update retains expectedRevision and all original cashier fields, including optional refund fallback. Drain/reconcile ambiguous writes against persisted rules revision/history; never reset revision, defaults or approval fingerprints. Retained staffAccess bootstrap/identity/grant/invite RPC paths do not change. |
| emails:sendTestEmail | settings/emails:sendTestEmail, `{}` args and admin action policy unchanged. Stop setup-test producers before cutover. A successful/ambiguous send must not be replayed merely because its old RPC disappeared; reconcile provider outcome under root authorization. This implementation never invokes it live. |
| emails:sendBookingConfirmation / emails:sendOwnerNotification | Paths and zero-delay booking-detail payloads unchanged (guestName, guestEmail, propertyName, checkIn/checkOut, nights, guests, total/currency; owner also guestPhone). Drain under old code or retain each unchanged job exactly once. Preserve confirmationEmailsQueuedAt; do not rerun a booking/payment mutation or force resend to replace queue evidence. Ambiguous delivery requires root reconciliation, not automatic replay. |
| emails:sendCancellation / sendPreArrival / sendBookingUpdated / sendReviewRequest | Paths and `{bookingId,attempt?}` unchanged. Preserve original due time and retry attempt: failed eligible sends retry after `5min * 2^attempt` while attempt < 3. Retain current-booking eligibility reads, missing-config guard, cancellation/pre-arrival/review queue markers and financial/status guards. Do not reset attempts or create another lifecycle queue cycle. |
| crons:queueLifecycleEmails | Path and daily 02:00 UTC preArrival/review cron definitions unchanged; continuations keep `{kind,cursor?,today?}` and the original resort-date snapshot. Coordinate these producers under the traffic gate; preserve queue markers and bounded pagination so resuming does not duplicate notifications. All other root crons retain their paths, cadence and args. |
| emails:sendStaffAlert | Path and zero-delay `{sessionId,channel,guestName,lastMessage}` payload unchanged. Drain or retain the original job, never enqueue a second alert. Preserve per-session lastStaffAlertAt and rolling-global timestamps; queue-time eval/staff-needed/30-minute/30-per-hour guards and action email/LINE environment guards remain exact. Neither source cleanup nor a settings save proves delivery. |
| Messaging/POS/bookings/services parent queues and durable state | Paths unchanged by Settings. Root repeats parent cutover audits where still applicable: worker claims/leases/deliveryStartedAt/tool result keys, pending approvals/lease expiry/customer merge progress, booking holds/Stripe expiry/iCal generations and roster jobs. Preserve original payloads, scheduled times, idempotency and uncertainty. Earlier queue observations and source audits do not reconcile live queues. |

## Root-owned gated backend-first acceptance before merge

1. Keep this PR stacked/open for root review. Confirm exact dependency history and actual new Preview isolation; coordinate the parent cutovers without substituting origin/main or operating shared targets from this implementation checkout.
2. Gate web/social/external RPC traffic and quiesce settings, Team/cashier-rule and history/configuration writers, setup test-email triggers, email-producing booking/payment changes, lifecycle cron and worker producers as necessary. Drain in-flight writes/actions and inspect actual queues while no producer can add old targets. Record complete IDs/args/due times and ambiguous delivery outcomes; reconcile using the table above. No source codemod is a stored-job migration.
3. **Push and accept the renamed backend while traffic stays gated, before any merge-triggered frontend build.** Root confirms unchanged schema/data, removed old Settings/cashier/test-email paths, unchanged retained auth/grant/invite and booking/staff email paths, correct stored-job disposition, permissions/redaction, defaults/validation/revisions/history/restore, cashier policy/fingerprint behavior, public profile, health/secret-presence flags and environment guards. No live send/eval is authorized by this implementation evidence.
4. **Merge only after backend acceptance.** Git integration starts a frontend build on main changes. If an earlier merge is unavoidable, root disables production Git deployment first and restores it after backend acceptance. Existing `convex deploy --cmd` runs the frontend command before final backend push and cannot alone perform this incompatible rename. Build/publish against the accepted backend; invalidate/rebuild old or paused home/villa/sitemap/setup artifacts and reload existing admin/checkout clients with cached RPC references.
5. Root verifies frontend/profile/setup/history/cashier/checkout behavior, restores traffic and producers and records exact live actions. Coordinate frontend/backend rollback and queued-job/external RPC disposition under the same gate. This settings move needs no schema/data reset.

No shared/prod backend acceptance, cutover, real send, review approval or merge is claimed here.

## Parent review

Standards, spec and independent audits found no new correctness issues at `f70d554`. The parent made the two suggested type-only imports explicit, sourcing `ActionCtx` from the generated server types, and restored the sender/environment and default-runtime comments. This changes no handler, permission, email behavior or schema. Fixed-base comparison and Convex typechecking pass; live settings acceptance remains pending.
