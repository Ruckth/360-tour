# Phase 3b: services backend domain

> Historical implementation evidence. Fixed-base move/proof commands below were retired in Phase 3e; retrieve them from parent `6a81d1715009bcb586f1dfd08f7b613b71334223` only to reproduce that history. Use [ARCHITECTURE.md](../../ARCHITECTURE.md) for current commands and ownership rules.


Required dependent base: `a3be68d6a23b4ce933766d37ff53d329063a8713`, the open bookings PR [#67](https://github.com/Ruckth/360-tour/pull/67), atop merged catalog PR #66. The clean prepared `t3/services-domain-move` worktree was fast-forwarded to exactly this commit before implementation. Its unpublished history is preserved; no reset, rebase or substitution of origin/main occurred. The unrelated dirty `/Users/macbook/Development/360-tour` checkout was not touched. This PR targets `t3/phase3b-bookings-domain-move`. `.arch-phase` remains **2**. Root owns reviews, shared/live acceptance, cutover, merge and any later retargeting.

## Scope and contracts

The move contains **58 registrations**: adminQuery 15, adminMutation 27, adminAction 1, publicQuery 3, internalQuery 4 and internalMutation 8. The **46 public trust registrations** retain exactly their builders, access metadata, arguments, validators, handler bodies and return shapes; the 12 internal registrations retain their visibility and complete implementations. Only references to renamed RPC paths change inside handlers.

- `services/admin.ts` contains the thirteen cohesive admin reads for staff, service assignment, time off, appointments, scheduling, history and finance.
- Each former adminServices mutation/action, including the internal pending-photo registration, owns one file under `services/commands/` (23 files). No command is a generic forwarding wrapper.
- `services/publicServices.ts` retains anonymous categories/list/detail projections and internal chat browsing. Its catalogue belongs to services, independently of the villa catalog domain.
- `services/serviceBookings.ts` retains internal availability, preparation, confirmation, guest appointment listing and cancellation, including the unchanged durable tool transaction and proposal checks.
- `services/roster.ts` retains the cohesive weekly roster, copy/default/undo, conflict checks, chunk continuations and retrospective break changes.
- The additional registration-owner audit identified `crons.cleanStaffAvatarUploads` as services-owned. Its actual cleanup implementation moves to `services/maintenance.ts`; the existing six-hour cron and recursive scheduler target follow it. The 24-hour TTL and 100-row bound are unchanged. Other crons remain in place.
- `services/model.ts` contains the actual 33 former adminServices helper/constant/type declarations, plus `RosterConflict`, `STALE_ROSTER`, `NOT_SCHEDULED` and the photo TTL (37 declarations total). It owns ctx-based loaders, validation, conflict checks, photo attachment, staff/service history and snapshots, archiving, slot preparation and service-change calculation. It contains no endpoint registration, endpoint re-export or proxy wrapper. Other files importing moved helpers use this model seam. Roster/chat private helpers used only within their cohesive endpoint module remain local.

Auth/staffAccess, staffApprovals, POS checkout, other domain registrations, existing pure lib/shared/date helpers and frontend duplicates remain outside this move. The parent 3c work still owns the later shared-helper cleanup; this step does not silence its metrics. Services continue using the existing auth and messaging model interfaces. Cross-domain consumers invoke endpoints through generated references, never endpoint implementation imports.

Integer SATANG/BPS, appointment payment/refund/correction idempotency and immutable history, checkout line links, staff permissions, avatar registration/cleanup rollback, turnaround occupancy, historical appointment warnings, roster scheduling/time-off conflicts, weekly pattern version history, bounded reads and rate limits are unchanged. Service confirmation still uses the 5/hour phone and 100/hour global limits. Durable tool names, invocation identity, fingerprints, result replay and proposal identity remain unchanged. No schema, data, policy, product behavior or dependency change is introduced. The four old endpoint files are deleted without compatibility endpoints, aliases or re-exports.

## Complete RPC mapping

Function names after `:` are unchanged. Generated references substitute slash-separated module segments with properties: `api.adminServices.createService` becomes `api.services.commands.createService.createService`.

| Old RPC | New RPC |
| --- | --- |
| `adminServices:listStaff` | `services/admin:listStaff` |
| `adminServices:registerStaffAvatarUpload` | `services/commands/registerStaffAvatarUpload:registerStaffAvatarUpload` |
| `adminServices:uploadStaffAvatar` | `services/commands/uploadStaffAvatar:uploadStaffAvatar` |
| `adminServices:discardStaffAvatarUpload` | `services/commands/discardStaffAvatarUpload:discardStaffAvatarUpload` |
| `adminServices:createStaff` | `services/commands/createStaff:createStaff` |
| `adminServices:updateStaff` | `services/commands/updateStaff:updateStaff` |
| `adminServices:archiveStaff` | `services/commands/archiveStaff:archiveStaff` |
| `adminServices:countUpcomingAppointments` | `services/admin:countUpcomingAppointments` |
| `adminServices:listServices` | `services/admin:listServices` |
| `adminServices:createService` | `services/commands/createService:createService` |
| `adminServices:updateService` | `services/commands/updateService:updateService` |
| `adminServices:archiveService` | `services/commands/archiveService:archiveService` |
| `adminServices:setServiceStaffMatrix` | `services/commands/setServiceStaffMatrix:setServiceStaffMatrix` |
| `adminServices:listTimeOff` | `services/admin:listTimeOff` |
| `adminServices:addTimeOff` | `services/commands/addTimeOff:addTimeOff` |
| `adminServices:updateTimeOff` | `services/commands/updateTimeOff:updateTimeOff` |
| `adminServices:removeTimeOff` | `services/commands/removeTimeOff:removeTimeOff` |
| `adminServices:listSchedule` | `services/admin:listSchedule` |
| `adminServices:findOpenSlots` | `services/admin:findOpenSlots` |
| `adminServices:getAppointmentReference` | `services/admin:getAppointmentReference` |
| `adminServices:createAppointment` | `services/commands/createAppointment:createAppointment` |
| `adminServices:previewAppointmentTime` | `services/admin:previewAppointmentTime` |
| `adminServices:correctAppointmentStatus` | `services/commands/correctAppointmentStatus:correctAppointmentStatus` |
| `adminServices:listAppointmentHistoryPage` | `services/admin:listAppointmentHistoryPage` |
| `adminServices:listTimeOffPage` | `services/admin:listTimeOffPage` |
| `adminServices:rescheduleOptions` | `services/admin:rescheduleOptions` |
| `adminServices:rescheduleAppointment` | `services/commands/rescheduleAppointment:rescheduleAppointment` |
| `adminServices:updateAppointmentTurnaround` | `services/commands/updateAppointmentTurnaround:updateAppointmentTurnaround` |
| `adminServices:updateAppointmentStatus` | `services/commands/updateAppointmentStatus:updateAppointmentStatus` |
| `adminServices:markAppointmentPaid` | `services/commands/markAppointmentPaid:markAppointmentPaid` |
| `adminServices:getAppointmentFinancials` | `services/admin:getAppointmentFinancials` |
| `adminServices:correctAppointmentPaymentEntry` | `services/commands/correctAppointmentPaymentEntry:correctAppointmentPaymentEntry` |
| `adminServices:updateAppointmentDetails` | `services/commands/updateAppointmentDetails:updateAppointmentDetails` |
| `adminServices:refundAppointment` | `services/commands/refundAppointment:refundAppointment` |
| `adminServices:cancelAppointment` | `services/commands/cancelAppointment:cancelAppointment` |
| `adminServices:listAppointmentHistory` | `services/admin:listAppointmentHistory` |
| `publicServices:categories` | `services/publicServices:categories` |
| `publicServices:list` | `services/publicServices:list` |
| `publicServices:getBySlug` | `services/publicServices:getBySlug` |
| `publicServices:browseForChat` | `services/publicServices:browseForChat` |
| `serviceBookings:listActiveServices` | `services/serviceBookings:listActiveServices` |
| `serviceBookings:checkServiceAvailability` | `services/serviceBookings:checkServiceAvailability` |
| `serviceBookings:prepareChatServiceBooking` | `services/serviceBookings:prepareChatServiceBooking` |
| `serviceBookings:confirmChatServiceBooking` | `services/serviceBookings:confirmChatServiceBooking` |
| `serviceBookings:listChatGuestServiceBookings` | `services/serviceBookings:listChatGuestServiceBookings` |
| `serviceBookings:cancelChatServiceBooking` | `services/serviceBookings:cancelChatServiceBooking` |
| `roster:getWeek` | `services/roster:getWeek` |
| `roster:applyCells` | `services/roster:applyCells` |
| `roster:resetCells` | `services/roster:resetCells` |
| `roster:copyWeek` | `services/roster:copyWeek` |
| `roster:continueCopy` | `services/roster:continueCopy` |
| `roster:makeDefault` | `services/roster:makeDefault` |
| `roster:undo` | `services/roster:undo` |
| `roster:continueUndo` | `services/roster:continueUndo` |
| `roster:pruneBatches` | `services/roster:pruneBatches` |
| `roster:previewBreakChange` | `services/roster:previewBreakChange` |
| `roster:editBreak` | `services/roster:editBreak` |
| `crons:cleanStaffAvatarUploads` | `services/maintenance:cleanStaffAvatarUploads` |

`scripts/move-services-domain.mjs` is the explicit one-shot codemod and repeatable fixed-base comparison. It reads the base TypeScript AST, distributes registrations, lifts implementations and organizes imports. It rewrites dot/bracket api/internal references, serialized raw RPC/CLI names, relative ESM/type imports, module-map overrides, frontend adapters, tests, scheduler/cron callers and all 46 moved entries in the current 295-registration access inventory. Existing HTTP and eval paths have no direct services references; their tool dispatchers now call the new paths. The failure-injection module-map override follows the real pending-photo registration command, preserving the test's rollback behavior. Historical benchmark transcripts and prior architecture records retain their original observed paths.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-services-domain.mjs --check --mapping
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base a3be68d6a23b4ce933766d37ff53d329063a8713 --out output/phase3b-services
```

The comparison rejects removed endpoint files/imports/RPC paths, compares **all 58 registration ASTs and their resolved builder imports**, **37 lifted declarations**, and every remaining private declaration in the cohesive public/chat/roster modules against base. It also compares **1,677 other production declarations** across the rest of convex, including remaining cron registrations and private helpers, after only the documented reference substitutions. It rejects extra moved registrations, registrations in model.ts and command files owning anything other than one registration. AST printing ignores comments/formatting and normalizes only the lifted export modifier; policy fields, validator shapes, statements and bounds remain significant. Generated bindings come from the real CLI, never from the codemod.

## Schema and measurements

Actual Convex `schema.export()` equality against the required base: **equal**, 74/74/74 base/current/static tables; both SHA-256 hashes are `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. Only object keys and top-level table order are normalized; index fields and validator union ordering remain significant. Schema/table source files have no diff.

| Metric | Required base | Services |
| --- | ---: | ---: |
| Tables / real domain owners | 74 / 9 | 74 / 9 |
| Explicit public registrations / raw public registrations | 295 / 0 | 295 / 0 |
| Cross-domain imports bypassing model.ts | 2 | 2 |
| src imports of convex/lib / convex imports of src | 75 / 1 | 75 / 1 |
| as never | 24 | 24 |
| Demo-mode files / CI placeholder references | 34 / 3 | 34 / 3 |
| Architecture recipe / files over 1,000 lines | 0 / 2 | 0 / 2 |
| No-login return-validator gaps / Phase 4 read-budget test | 52 / 0 | 52 / 0 |

The two cross-domain violations are the existing messaging imports of concierge copy. No detector, target, gate or Phase 4 gap is relaxed. The largest moved endpoint remains the cohesive roster module, below 1,000 lines; the shared model is 223 lines. The existing 19 Phase 0–2 gates are unchanged and are checked again with the committed tree.

## Validation and honest limits

All commands use Node **22.22.3** (`PATH=/opt/homebrew/opt/node@22/bin:$PATH`). Ignored evidence lives under `output/phase3b-services/`. Next production builds run serially: full verify finishes before the smoke suite's separate build starts.

| Check | Result |
| --- | --- |
| pnpm verify | All app/test/Convex types, lint, **232 files / 2,865 tests**, Next production build pass |
| pnpm exec eslint . --max-warnings 0 | Pass, zero warnings |
| pnpm knip | Pass, including configuration hints |
| pnpm test:booking-ui | **223 passed**, 24 existing opt-in captures skipped |
| E2E_PORT=3039 pnpm test:e2e:smoke | **13 passed**, with a separate serial production build |
| Focused services/appointments/roster/payment/capability/durable/access suites | **289 passed in 18 files** |
| Fixed-base AST comparisons / schema exports | All contracts/private logic equal; actual schema export equal |
| Access inventory / phase gates | **295** explicit registrations, **0** raw; **19/19** Phase 0–2 gates with the committed tree |

Focused suites include adminServices, publicServices, serviceBookings, serviceSlots, roster, rosterHistory, appointmentCorrections, appointmentFinance, staffAvatars, staffCalendarChanges, staffOccupancyConsistency, staffRoles, checkoutRecovery, messaging/toolRecovery, messaging/reliability, phase0Security, auth/accessBuilders and convex-access-inventory. They cover chunked large-roster copy/undo, historical/live pattern versions, schedule/time-off conflicts, slot bounds, stale revisions, payment/refund/correction replay, checkout links and both live/crash-recovered durable service confirmation/cancellation. The initial focused run exposed the module-map fixture relocation and was rerun after correction. Initial app typechecking overlapped API generation; the completed serial verify uses the real generated types and passes.

Real component-aware generation used installed Convex **1.34.1** and convex-helpers **0.1.120**. A new checkout-local anonymous backend owns `.convex/local/default/`, deployment `anonymous:anonymous-agent`. It was first initialized on ports 3230/3231; a subsequent CLI invocation used its default 3210/3211 before the persistent dev process was explicitly bound back to **http://127.0.0.1:3230** (HTTP actions 3231). This was the same checkout-local isolated state; no shared configuration/credential was copied. The only local auth setup was a nonfunctional issuer `https://services-local.invalid` and the dummy owner email `services-admin@example.test`. The final real `convex codegen` completed against this local backend, including component-aware bindings and TypeScript. An earlier codegen attempt correctly refused because the local process had stopped; it was rerun with the local dev process alive.

The empty backend was seeded once with the existing demo-resort scenario; no reset/reseed/backfill occurred. Real local HTTP/CLI acceptance reads six services/four categories and five staff, verifies public projection privacy, rejects anonymous admin access and removed paths, creates an appointment with **240,000 satang**, changes its turnaround, records/replays a desk payment and a **50,000-satang** partial refund, checks the **190,000-satang** net, rejects overlapping time off, applies/undoes a roster override and verifies an existing booking capability while rejecting a wrong token. CLI identity injection exercises the unchanged local admin policy; it is **not a real Clerk login**. An acceptance-fixture typo first treated a slot's `autoStaffId` as `staffId`; the fixture was corrected and resumed against the same seeded database, with no product change. A real local `_scheduled_functions` read found `services/roster.js:pruneBatches` completed successfully, with no old-path jobs. That local observation does not audit shared queues.

Browser UI tests use the existing fixtures; smoke uses the existing disconnected demo environment. No real Clerk sign-in, social/email send, Stripe provider call/refund, shared deployment inspection/mutation, secret change, provider console, message, merge or live cutover was performed. Root still owns live staff/payment/worker acceptance and scheduler disposition.

## Preview isolation checked before push

The user supplied the preceding catalog/bookings Preview targets: dedicated `artful-puffin-649` and `oceanic-camel-538`. The existing root record `/tmp/360-arch-phase3b-bookings-preview-target.json` (modified 2026-11-13 04:51:49 Asia/Bangkok) independently confirms Preview deployment `dpl_EmLKFsUe3tZTBWjEEXBaTnz5GUgQ` used only `https://oceanic-camel-538.convex.cloud` and explicitly excluded shared production/development. A copy is in the ignored evidence directory. This check occurred before this services push, as requested; it supports the existing dedicated Preview configuration. No shared production `wary-toad-189` or shared development `optimistic-turtle-573` backend was operated on.

The Vercel connector returned a scope-access denial when reading newer PR #67 build logs; no authentication/configuration change was attempted. This implementation relies on the authorized existing root record, not a claim to have inspected a new services Preview that did not yet exist. Root should inspect the services Preview's actual build target as part of review before any live acceptance.

## Pending root-controlled gated cutover

This removes RPC paths with **no compatibility window**. PR #67 remains open at the required base; its bookings cutover is also pending. The earlier catalog acceptance/queue audit cannot establish services or bookings readiness. Root owns any combined release and the complete mappings.

1. **Keep this PR open until gated backend acceptance.** Root completes reviews and bookings acceptance/merge, coordinates any main update while preserving unpublished history, retargets when appropriate and reruns gates. Do not let merge-triggered frontend deployment precede the renamed backend. Verify dedicated Preview targets again for later pushes if configuration changes.
2. **Gate traffic and quiesce writers/jobs first.** Drain old frontend requests, staff roster editing/copy/default/undo and photo uploads, chat service preparation/confirmation/cancellation, checkout appointment links/payment/refund/correction operations and worker service tools. Quiesce the staff-photo cleanup cron and external scheduling writers before auditing stored jobs, so another old-path call cannot be enqueued during the audit. Coordinate the bookings parent's checkout/calendar jobs and callbacks under the same gate. Old browser sessions need a coordinated reload.
3. **Inspect actual stored scheduled functions on the target backend while quiesced.** Include unfinished, pending, in-progress and external jobs; inspect roster batch status/progress too. Drain old-path jobs under the old implementation whenever possible. Otherwise capture original scheduled time, function, complete args, job state and batch state; cancel only under root control and explicitly reconcile/re-enqueue at new paths after backend acceptance. A source codemod does **not** rewrite stored scheduled jobs.

   | Removed job target (including `.js` serialization) | New target | Preserve and reconcile |
   | --- | --- | --- |
   | roster:continueCopy | services/roster:continueCopy | Exact `batchId`, `sourceWeekStart`, `fromWeek`, `toWeek`, `weeksPerTx`, `conflict`; inspect the existing running batch and its written cells/items. Resume the original next chunk, do not invoke copyWeek to create a replacement batch or reconstruct a cursor from today's date. Check final status becomes done. |
   | roster:continueUndo | services/roster:continueUndo | Exact `batchId`; preserve the undoing batch, remaining rosterBatchItems, original actor and pattern-version state. Resume the internal continuation; public undo refuses an already-undoing batch. Verify restoration and final undone status, including conflict skips. |
   | roster:pruneBatches | services/roster:pruneBatches | Exact `keep` batch ID and original timing; preserve the retained latest batch and all running/undoing batches. Reconcile older items with the bounded pruning algorithm, never replace keep with a newly created batch. |
   | crons:cleanStaffAvatarUploads | services/maintenance:cleanStaffAvatarUploads | Exact empty `{}` args and intended timing, including recursive continuations and the six-hour cron. The job recomputes its unchanged 24-hour cutoff from execution time; drain or deliberately account for delayed cleanup rather than inventing a cutoff argument. Preserve pending-upload rows and attached-photo safety. |

   Once a copy/undo chunk commits it schedules its next chunk atomically. Audit the current job/batch together so root does not replay an already-completed chunk or enqueue duplicate successors. Do not drop a running/undoing batch and leave roster writes blocked, rerun a public command to manufacture a replacement batch, or assume a generic cron repairs it. Also inspect external stored references to removed adminServices/publicServices/serviceBookings paths. Durable service proposal/tool records retain their unchanged semantic identity; draining/reconciling service work must respect their existing lease, fingerprint and replay checks.
4. Back up and **push/accept the renamed backend first** with unchanged schema/data while traffic remains gated. Clear maintenance at the appropriate point to test real public reads. Accept services catalogue privacy/bounds, owner/manager/cashier policy, photo attachment/cleanup, schedule/time-off conflicts, live and historical weekly patterns, large copy/undo continuations, appointment status/time/turnaround/corrections, checkout payment/refund links and durable chat confirmation/cancellation/recovery. Record actual job disposition and evidence separately.
5. **Merge only after backend acceptance, inside the traffic gate.** Vercel Git integration automatically builds production when main changes. If an earlier merge is unavoidable, root must disable production Git deployment first and restore it after backend acceptance. The current vercel-build builds Next before its final Convex push; it cannot safely order this incompatible rename by itself. Build/publish a fresh frontend against the accepted backend, invalidate/rebuild artifacts produced against old/paused paths, and verify service/home/sitemap data before restoring traffic.
6. Restore traffic, callbacks, workers and jobs only after acceptance; record root's live operations. Rollback coordinates old frontend/backend RPC paths and stored-job disposition within the same gate, preserving arguments and data. No data reset is required for this code-only move.
