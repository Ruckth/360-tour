# Phase 3b: POS backend domain

Required dependent base: `77c06d6cb7440899ddb9d0f373994531762ce165`, PR [#68](https://github.com/Ruckth/360-tour/pull/68), services atop merged bookings #67. The prepared `t3/phase3b-pos-domain-move` checkout was clean but pointed at `3ca332d`; it was fast-forwarded to exactly the required base before implementation. No reset, rebase, replacement base or history rewrite occurred. The original dirty `/Users/macbook/Development/360-tour` and root review checkout were not changed. This PR targets `t3/services-domain-move`. `.arch-phase` remains **2**. Root owns independent review, live operations, backend acceptance, merge and retargeting.

## Scope and contracts

The five removed endpoint modules own **77 registrations**: POS 39, customers 12, displays 14, staffApprovals 7 and orderHistoryPages 5. Builders remain staffMutation 35, staffQuery 21, adminQuery 6, adminMutation 5, internalMutation 4, publicMutation 3, deviceQuery 1, deviceMutation 1 and authenticatedMutation 1. All **73 public** and **4 internal** registrations preserve the builder binding, capability/reason, argument/return contracts and complete handler bodies after path substitutions.

- Each of the **26 former POS mutations** owns its own `pos/commands/<name>.ts`. These are the original registrations and implementations, not newly introduced forwarding endpoints.
- `pos/catalog.ts` contains stable catalog, live ranking and their existing combined projection. `pos/orders.ts` contains cohesive order/receipt/history/lifecycle reads. `pos/sourceReads.ts` contains attachment availability and paid-line link candidate reads.
- `pos/customers.ts`, `pos/displays.ts`, `pos/staffApprovals.ts` and `pos/orderHistoryPages.ts` retain their cohesive registrations. Existing cashier today's-receipt guards, search limits, approval fingerprints, self-approval prohibition, device capabilities and bounded history streams remain unchanged.
- `pos/model.ts` is the only implementation interface for other backend domains. It exposes the former exported helper/type contracts through real implementations in `pos/private/`, never endpoint registrations or endpoint re-exports. `orderModel` owns order/source loading, coupon refresh, validators and shared projections; `sourceModel` owns contact lookup/source attachment; `lineCommands`, `paymentCorrections`, `paidLinks` and `paidLinkModel` own the shared execute/reversal paths; `approvalModel` owns preview/atomic execution; `lifecycleModel` owns restore conflicts; customer/display models own their shared identity and lease/pairing implementations. Internal imports use these actual implementations directly, without generic wrappers or cycles. The largest moved file is **654 lines**; every moved source file is below 1,000 lines.

No schema, stored data, dependency, product or access-policy change is introduced. Integer satang/BPS arithmetic, rounding and coupon allocation, till/checkout/settlement/refund/correction replay, booking/appointment financial links and rollback boundaries are preserved. Customer profiles remain explicit selections: no automatic matching, creation, identity redirection or merge. Reviewed merges retain revisions, original identities, frozen receipts and durable progress. The existing frontend `convex/lib` imports and customers' import of `src/lib/booking/phone` remain Phase 3c work; the latter follows its implementation to `pos/private/customerModel.ts` without changing its logic. No metrics or gates were relaxed.

## Registration-owner audit for all 16 tables

The audit inspected actual registrations and their helper dependencies, not only filenames. `scripts/audit-pos-registration-owners.mjs` resolves TypeScript symbols through imports/re-exports and follows literal/typed-ID database operations. The complete reproducible registration matrix is checked in as [phase3b-pos-registration-owners.json](./phase3b-pos-registration-owners.json); detailed dependency trails and unresolved generic-ID operations are in ignored `output/phase3b-pos/registration-owner-audit.json`. The static closure is conservative: it lists reachable helper operations, not proof that every invocation takes every branch. Generic parameter operations still require manual inspection. This is not a shared backend or stored-job audit.

| POS table | Registration ownership / retained consumers |
| --- | --- |
| orders | POS commands/order/source/display/customer/approval paths and marketing report; bookings create/change/payment/delete/expiry and Stripe handlers; services appointment create/payment/refund/financial reads; aiEval cleanup and seed |
| orderLines | POS cart/source/receipt/approval/display paths; bookings financial/create/delete/payment/linked-order paths; services appointment/payment/refund/financial paths; seed |
| orderPayments | POS settlement, receipts, financial correction/reversal/refund paths and marketing report; linked bookings financial/lifecycle/Stripe cleanup; services refund; seed and aiEval |
| orderCorrections | POS correction commands and receipt/history pages; atomic approval execution |
| orderAudit | POS cart/settlement/receipt/history/approval paths; bookings deleteBooking/deleteBookings cleanup |
| orderCounters | POS order creation/receipt issue and approved execution; bookings and services that create linked orders; seed |
| orderLineLinks | POS paid-line linking, reversal, receipt/refund/approval paths; booking cancellation/deletion/refund/source updates and services payment/financial/refund guards |
| orderRefunds | POS refund/read/correction/approval guards and marketing report; bookings money/lifecycle/Stripe guards, services refund, seed and aiEval cleanup |
| customers | POS customer registrations, checkout/customer linking, settlement, correction and approval implementations |
| customerMergeJobs | POS mergeCustomers, resumeCustomerMerge, continueMerge and guarded profile operations |
| tills | POS display pairing/publishing/driver/lease/read/cleanup registrations |
| displays | POS display registrations; device builders in auth/model remain the shared authentication seam |
| displayDriverLeases | POS display handover/publish/renew/release/expiry/current paths |
| displayPresence | POS display heartbeat/list/pair/revoke paths |
| displayPairLinks | POS createPairLink, claimLink and cleanPending |
| staffApprovalRequests | POS approval registrations; POS discard guard reaches shared staffApprovalState |

The matrix includes other-domain bookings/services/marketing report registrations, root crons, seed and eval implementations. They retain their domain purpose; touching a POS table does not make their registration a POS endpoint. `marketingReport:getReport` reads POS sales/payments/refunds through `readMarketingReport`; it remains marketing-owned. Auth's display lookup remains auth-owned. Test fixtures and maintenance scenarios remain test/maintenance-owned. No additional POS-owned registration was found outside the five scoped modules. The actual cleanup registration already lives in displays; its root ten-minute cron caller follows the new path. The matrix's registration count and each reachable helper/operation are reproducible with the audit script.


## Complete RPC mapping

Names after `:` are unchanged. Generated references expand nested paths: `api.pos.settleOrder` becomes `api.pos.commands.settleOrder.settleOrder`.

| Old RPC | New RPC |
| --- | --- |
| `pos:stableCatalog` | `pos/catalog:stableCatalog` |
| `pos:recentCatalogRanking` | `pos/catalog:recentCatalogRanking` |
| `pos:catalog` | `pos/catalog:catalog` |
| `pos:getOrder` | `pos/orders:getOrder` |
| `pos:listOrders` | `pos/orders:listOrders` |
| `pos:findOrderByNumber` | `pos/orders:findOrderByNumber` |
| `pos:ordersForBooking` | `pos/orders:ordersForBooking` |
| `pos:attachLookupStatus` | `pos/sourceReads:attachLookupStatus` |
| `pos:listAttachable` | `pos/sourceReads:listAttachable` |
| `pos:openOrderFor` | `pos/commands/openOrderFor:openOrderFor` |
| `pos:openOrderForLink` | `pos/commands/openOrderForLink:openOrderForLink` |
| `pos:addItem` | `pos/commands/addItem:addItem` |
| `pos:attach` | `pos/commands/attach:attach` |
| `pos:updateLine` | `pos/commands/updateLine:updateLine` |
| `pos:overrideLinePrice` | `pos/commands/overrideLinePrice:overrideLinePrice` |
| `pos:removeLine` | `pos/commands/removeLine:removeLine` |
| `pos:applyOrderCoupon` | `pos/commands/applyOrderCoupon:applyOrderCoupon` |
| `pos:removeOrderCoupon` | `pos/commands/removeOrderCoupon:removeOrderCoupon` |
| `pos:recheckOrderCoupon` | `pos/commands/recheckOrderCoupon:recheckOrderCoupon` |
| `pos:updateSourceLine` | `pos/commands/updateSourceLine:updateSourceLine` |
| `pos:linkCustomer` | `pos/commands/linkCustomer:linkCustomer` |
| `pos:unlinkCustomer` | `pos/commands/unlinkCustomer:unlinkCustomer` |
| `pos:saveOrder` | `pos/commands/saveOrder:saveOrder` |
| `pos:clearOrder` | `pos/commands/clearOrder:clearOrder` |
| `pos:settleOrder` | `pos/commands/settleOrder:settleOrder` |
| `pos:refundLine` | `pos/commands/refundLine:refundLine` |
| `pos:voidOrder` | `pos/commands/voidOrder:voidOrder` |
| `pos:amendOrderPayment` | `pos/commands/amendOrderPayment:amendOrderPayment` |
| `pos:voidUnreceivedOrder` | `pos/commands/voidUnreceivedOrder:voidUnreceivedOrder` |
| `pos:orderHistory` | `pos/orders:orderHistory` |
| `pos:discardOrder` | `pos/commands/discardOrder:discardOrder` |
| `pos:restoreCheck` | `pos/orders:restoreCheck` |
| `pos:restoreOrder` | `pos/commands/restoreOrder:restoreOrder` |
| `pos:addAppointmentFee` | `pos/commands/addAppointmentFee:addAppointmentFee` |
| `pos:appointmentFees` | `pos/orders:appointmentFees` |
| `pos:linkCandidates` | `pos/sourceReads:linkCandidates` |
| `pos:linkPaidLine` | `pos/commands/linkPaidLine:linkPaidLine` |
| `pos:unlinkPaidLine` | `pos/commands/unlinkPaidLine:unlinkPaidLine` |
| `pos:createOrder` | `pos/commands/createOrder:createOrder` |
| `customers:browseCustomers` | `pos/customers:browseCustomers` |
| `customers:searchCustomers` | `pos/customers:searchCustomers` |
| `customers:getCustomer` | `pos/customers:getCustomer` |
| `customers:listCustomerOrders` | `pos/customers:listCustomerOrders` |
| `customers:customerHistory` | `pos/customers:customerHistory` |
| `customers:createCustomer` | `pos/customers:createCustomer` |
| `customers:updateCustomer` | `pos/customers:updateCustomer` |
| `customers:setCustomerArchived` | `pos/customers:setCustomerArchived` |
| `customers:continueMerge` | `pos/customers:continueMerge` |
| `customers:resumeCustomerMerge` | `pos/customers:resumeCustomerMerge` |
| `customers:mergeCustomers` | `pos/customers:mergeCustomers` |
| `customers:checkoutCustomer` | `pos/customers:checkoutCustomer` |
| `displays:createPairLink` | `pos/displays:createPairLink` |
| `displays:claimLink` | `pos/displays:claimLink` |
| `displays:startPairing` | `pos/displays:startPairing` |
| `displays:approveCode` | `pos/displays:approveCode` |
| `displays:takeDisplay` | `pos/displays:takeDisplay` |
| `displays:showOrder` | `pos/displays:showOrder` |
| `displays:renewDriverLease` | `pos/displays:renewDriverLease` |
| `displays:releaseDisplay` | `pos/displays:releaseDisplay` |
| `displays:expireLease` | `pos/displays:expireLease` |
| `displays:current` | `pos/displays:current` |
| `displays:heartbeat` | `pos/displays:heartbeat` |
| `displays:listDisplays` | `pos/displays:listDisplays` |
| `displays:revoke` | `pos/displays:revoke` |
| `displays:cleanPending` | `pos/displays:cleanPending` |
| `staffApprovals:create` | `pos/staffApprovals:create` |
| `staffApprovals:approve` | `pos/staffApprovals:approve` |
| `staffApprovals:cancel` | `pos/staffApprovals:cancel` |
| `staffApprovals:reject` | `pos/staffApprovals:reject` |
| `staffApprovals:forOrder` | `pos/staffApprovals:forOrder` |
| `staffApprovals:pending` | `pos/staffApprovals:pending` |
| `staffApprovals:expire` | `pos/staffApprovals:expire` |
| `orderHistoryPages:corrections` | `pos/orderHistoryPages:corrections` |
| `orderHistoryPages:audit` | `pos/orderHistoryPages:audit` |
| `orderHistoryPages:bookingRefunds` | `pos/orderHistoryPages:bookingRefunds` |
| `orderHistoryPages:appointmentRefunds` | `pos/orderHistoryPages:appointmentRefunds` |
| `orderHistoryPages:orderRefunds` | `pos/orderHistoryPages:orderRefunds` |

`scripts/move-pos-domain.mjs` is the explicit one-shot codemod and repeatable fixed-base comparison. It redistributes the original AST declarations, relocates imports and updates generated-reference callsites, raw RPC/CLI strings, current access inventory, schedulers/crons, frontend adapters and test fixtures. The checkout's generated-type alias follows nested command references without changing its runtime interface. Dynamic staff-role test selection now selects the two actual command references; the history fixture's module-object alias follows its new path. HTTP/evals have no direct old POS references; their transitive domain calls keep their paths. Historical implementation records/benchmark transcripts keep their original evidence. Generated API files come from the real CLI, never the codemod.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-pos-domain.mjs --check --mapping
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/audit-pos-registration-owners.mjs --check-snapshot
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base 77c06d6cb7440899ddb9d0f373994531762ce165 --out output/phase3b-pos
```

The fixed-base comparison checks all **77 registration ASTs and resolved builders**, **153 helper/private declarations**, their retained dependency bindings, and **1,588 other production declarations** after the documented reference substitutions. It rejects old endpoint files/imports/RPCs, extra declarations within moved implementation files, oversize moved files, command modules without exactly one registration, model registrations and other backend imports bypassing the POS model. The root schema composition's existing tables import is necessarily exempt from the implementation seam. `pos/catalog` now has the same spelling as the old catalog function; the reference scanner recognizes this namespace and real generated TypeScript validates its uses. AST normalization removes only comments, formatting and the lifted export modifier; policies, validations, return shapes, statements, rounding and bounds remain significant.

## Schema and measurements

Actual `schema.export()` values equal the required base: **74/74/74** base/current/static tables, SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6` for both. Only object keys and top-level table order are normalized; validator unions and compound index ordering remain significant. Schema/table sources, lockfile, package scripts and `.arch-phase` have no diff.

| Metric | Required base | POS |
| --- | ---: | ---: |
| Tables / real domain owners | 74 / 9 | 74 / 9 |
| Explicit public inventory / raw public registrations | 295 / 0 | 295 / 0 |
| Cross-domain imports bypassing model.ts | 2 | 2 |
| src imports of convex/lib / convex imports of src | 75 / 1 | 75 / 1 |
| as never | 24 | 24 |
| Demo files / CI placeholders | 34 / 3 | 34 / 3 |
| Files over 1,000 lines | 2 | 1 |
| No-login return-validator gaps / Phase 4 budget test | 52 / 0 | 52 / 0 |

The remaining long file is the existing checkout fixture, 1,489 lines. The two pre-existing cross-domain violations are messaging's concierge-copy imports. These later-phase gaps are measured unchanged, not hidden or fixed in this move.

## Validation and limits

All commands use Node **22.22.3** through `/opt/homebrew/opt/node@22/bin`. Ignored logs/artifacts are under `output/phase3b-pos/`. Next builds run serially: full verify finished before the smoke server's production build began.

| Check | Result |
| --- | --- |
| pnpm verify | All app/test/Convex types, lint, **232 files / 2,865 tests**, production build pass |
| pnpm exec eslint . --max-warnings 0 | Pass, zero warnings |
| pnpm knip | Pass, including configuration hints |
| Focused POS/approval/display/customer/history/security/payment/UI suites | **49 files / 582 tests passed** |
| pnpm test:booking-ui | **223 passed**, 24 existing opt-in captures skipped |
| E2E_PORT=3049 pnpm test:e2e:smoke | **13 passed**, separate serial production build |
| Fixed-base comparisons / actual schema exports | Equal as described above |
| Access inventory / Phase 0–2 gates | **295 / raw 0**; committed-tree **19/19** gates pass |

Focused suites include POS receipt source/read reuse, paid-line link/reversal, coupons, refunds, staffRoles (approval validation, self-approval, expiration, atomic execute helpers and today's-receipt policy), display lifecycle/pairing/driver/lease release, customer correction/revision/merge continuation and recovery, history streams, checkout recovery, Stripe payment/security and access inventory/builders. These pin existing behavior and idempotency, including integer/BPS allocation and booking/appointment financial integration. Initial typechecking identified two dynamic fixture references and the checkout type alias that also needed mapping; the completed verify uses the final real generated types. The early focused run passed 110 tests; the final selected run passed 582.

Real component-aware API generation used installed Convex **1.34.1** and convex-helpers **0.1.120**, a newly initialized checkout-local anonymous backend at **http://127.0.0.1:3240**, HTTP actions 3241, deployment `anonymous:anonymous-agent`, state `.convex/local/default/`. No shared credential/configuration was copied. Only a nonfunctional local JWT issuer (`https://pos-local.invalid`) and dummy owner email (`pos-admin@example.test`) were configured. The first CLI invocation required the explicit local selector and the backend required its local issuer; these were corrected without touching a shared target. The standalone real `convex codegen` subsequently succeeded, including component bindings and TypeScript. This CLI version does not accept `--env-file` on codegen; its local `.env.local` selection was used.

The empty local backend was seeded once with existing demo-resort, without reset/backfill. CLI identity injection then exercised **30 local checks**: anonymous admin rejection and removed RPC rejection, catalog/customer selection, cashier request creation, prohibition on approving one's own request after promotion, stale-request resolution, atomic manager approval/replay, one-use display link pairing/replay, wrong driver/device guards, leased order publishing, settlement/replay at **192,000 satang**, and one **1,000-satang** refund after two identical refund calls, plus the history stream and frozen payer snapshot. This is injected local identity acceptance, not real Clerk sign-in. Two acceptance-fixture assumptions were corrected: CLI null results print no JSON, and settlement replay intentionally differs in its `replayed` flag. The remaining refund/history checks resumed against the same persisted order; nothing was reset or changed in product code. No customer identities were merged in local CLI acceptance; existing isolated transactional suites cover reviewed merge continuation/resume.

An actual local `_scheduled_functions` read captured **three pending jobs**: two `pos/staffApprovals.js:expire` jobs with original `{requestId}` arguments and one `pos/displays.js:expireLease` with `{tillId, leaseId}`. It showed the newly serialized paths, not any source-only assertion about a shared queue. The requests had been terminally resolved by acceptance, so later expiry is harmless. No scheduled job was cancelled/replayed to manufacture this observation. Local cleanup/merge continuations were not manufactured; their code and existing suites are covered, while root must inspect and reconcile actual target queues.

UI tests use the existing browser fixtures; smoke uses the existing disconnected demo configuration. No real Clerk login, provider/email/social send, Stripe provider/refund call, shared data inspection/mutation, provider console, secret operation, merge or live cutover was performed. Root still owns independent audit and live staff/payment/display/customer acceptance.

## Preview evidence checked before push

The supplied root record `/tmp/360-arch-phase3b-services-preview-target.json` was checked twice before push. Its initial observation recorded services head `95a75539a47cd3230895a5b6a80fc97b929e9993`, Preview `dpl_BJvEZYL3NqyU5rM38B7r6SyiE9e5`, only `https://graceful-condor-901.convex.cloud`, and `sharedProductionAndDevExcluded: true`. The required merge base `77c06d6…` has the same implementation tree as that head. The initial evidence is retained as ignored `preceding-preview-target.json`.

Immediately before committing/pushing, root's record had independently been refreshed to the **exact required base** `77c06d6cb7440899ddb9d0f373994531762ce165`: Preview `dpl_EHgoVKEj3LtdmUvJj8F7wKbo3N4x`, only **https://adjoining-octopus-182.convex.cloud**, again `sharedProductionAndDevExcluded: true`. That newer observation is retained as ignored `pre-push-preview-target.json`. Read-only PR #68 metadata confirms the open services branch at the required base. These are available preceding Preview isolation evidence, not a claim about the new POS build's target. No provider settings, secrets or consoles were changed. Root must inspect actual new POS Preview logs after push and record the dedicated target before accepting any deployment. Shared production `wary-toad-189` and development `optimistic-turtle-573` were not operated on.

## Root-owned backend-first gated acceptance before merge

Removing the old paths has **no compatibility window**. Keep this stacked PR open. Root owns services PR #68 acceptance/merge, any main integration preserving dependent history, review, retargeting and all shared/live operations. Earlier catalog/bookings/services audits do not dispose of these POS jobs.

1. **Gate traffic and quiesce writers before auditing queues.** Drain old checkout/cart/receipt/refund/correction/customer edits and merges; approval creation/resolution; pairing/publishing/renewal/sign-out release and guest display polls. Stop the ten-minute display cleanup cron and external POS/RPC schedulers under the gate. Coordinate parent booking/payment/calendar/service jobs and worker/marketing financial operations. Drain in-flight transactions so they cannot enqueue another old target. Plan a coordinated reload for existing checkout and display sessions.
2. **Inspect actual stored jobs while writers are quiesced**, including unfinished, pending, in-progress, failed and external scheduled calls, complete args and original scheduled times. Audit corresponding approval requests, till/lease rows and running customerMergeJobs. Prefer draining under old code. Otherwise root records explicit cancellation/re-enqueue/reconciliation for each old job. Source codemods never rewrite persisted function identifiers, arguments or progress.

   | Removed stored target (also `.js` serialization) | New target | Exact reconciliation |
   | --- | --- | --- |
   | staffApprovals:expire | pos/staffApprovals:expire | Preserve `{requestId}` and the request's absolute `expiresAt = createdAt + 300,000ms`; do not grant a fresh five-minute window at cutover. Re-enqueue at the original expiry, or immediately if overdue, after accepting the new backend. Terminal/missing requests no-op. A still-pending request is evaluated against current order/requester/rules fingerprints and expires or becomes stale as appropriate. Calling this before the original expiry can return pending without rescheduling: do not treat that as a replacement expiry. There is no stored scheduled-job ID on the request. Reconcile every pending request's expiry coverage explicitly. |
   | displays:expireLease | pos/displays:expireLease | Preserve **both** `{tillId, leaseId}` and original scheduled time. Compare current till identity and persisted displayDriverLeases.expiresAt; do not create a new lease or restart its 90,000ms lifetime. A superseded/missing till job no-ops. A matching renewed lease re-enqueues itself at its stored newer expiry; an overdue matching lease ends immediately. Renewal patches the expiry and depends on the existing check, so losing the check requires explicit coverage. Expiry clears an unpaid order, retains the expired mount identity for the same mount's resume, and retains a paid order's thank-you while removing its lease. Stale jobs cannot clear a newer lease. |
   | displays:cleanPending (cron and recursive jobs) | pos/displays:cleanPending | Args remain `{}`. Retain the ten-minute recurring cadence and account for any immediate recursive jobs. There is no cursor: restart bounded cleanup on current rows. It scans at most ten tills, deletes at most 100 pending displays older than the ten-minute pairing TTL and at most 100 expired links per invocation, then schedules another zero-delay batch if either bound fills. It checks maintenance pause. Draining/restarting after new-backend acceptance is safe; do not delete active devices, alter generations/tokens or invent progress. |
   | customers:continueMerge | pos/customers:continueMerge | Preserve `{jobId}` and resume the **existing** running job, with stored source/destination, initiating actor/reason, `before` snapshot and `movedOrders`. Continuations are scheduled at zero delay. Each transaction rereads the job/identity guards, queries up to 101 still-source-linked orders, moves at most 100, increments draft revisions, appends order history and atomically advances progress; the remaining source index is its progress, **no cursor**. Completed/missing jobs no-op. If identities changed, stop for operator review; never restart mergeCustomers, create another job or automatically redirect identities. Root may invoke the new admin resumeCustomerMerge with `{sourceId}` to advance the same job. OCC and job completion guards safely reconcile duplicate/racing resumes; completion emits terminal history only once. Keep frozen paid receipt snapshots and original identities. |

3. These are **all moved scheduler targets**. POS commands themselves introduce no renamed scheduler target. Transitive booking/appointment payment notifications, booking expiry, affiliate accounting and other domain schedules retain their existing paths/guards. The root `crons.ts` declaration only substitutes `internal.pos.displays.cleanPending`; cron name, cadence and args remain the same. Pairing links and device tokens stay in the same tables with the same hashes, TTLs and generations; this is not a token/schema migration. Audit external stored names for every mapped RPC too.
4. **Push and accept the renamed backend first, while traffic remains gated, before any merge-triggered frontend build.** Verify unchanged schema/data and actual scheduled-job disposition. Exercise staff permissions and cashier receipt-day guards; approval expiration/staleness/self-approval and atomic execute helpers; checkout/settlement/replay, coupons and satang/BPS rounding; partial refunds/corrections/paid links; till pairing/token/driver lease handover/renewal/expiry/sign-out; customer reviewed selection/correction/explicit merge resume; order/financial history and booking/appointment links. Clear maintenance pause at the right point for acceptance, keeping external traffic gated. Do not infer any of this from an empty earlier-domain queue audit.
5. **Merge only after backend acceptance.** Vercel's Git integration starts a production frontend build when main changes. If an earlier merge is unavoidable, root must disable production Git deployment first, then restore it only after acceptance. The existing `vercel-build` executes the frontend build before the final Convex push, so it cannot perform this incompatible cutover alone. Inspect the actual branch Preview logs for isolation as well. Build/publish fresh frontend against the accepted backend; rebuild/invalidate artifacts produced against old or paused paths so home/sitemap prerendering cannot cache stale/empty data.
6. Root verifies home/villa/sitemap output and checkout/receipt/approval/display/customer behavior, restores traffic/jobs, and records the actual operation. Coordinate frontend/backend rollback and queued-job disposition under the same gate; this source-only move requires no data reset.

No shared/production acceptance, cutover or merge is claimed by the implementation evidence.
