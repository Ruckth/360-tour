# Optional POS staff roles: backend contract and endpoint inventory

Implemented on `feat/staff-roles-backend`, with audit fixes on `feat/staff-roles-backend-fixes`, based on the local staff-roles branch (base `d67ba9f`). Backend only; no deployment, migration, seed or live data edit is part of this work.

## Roles and permission model

`convex/lib/staffAccess.ts` is the server permission layer. `staffAccess(ctx)` resolves the authenticated canonical `tokenIdentifier`, then returns `{ email, tokenIdentifier, role, capabilities, pendingInvitation }`. `requireStaff(ctx, capability)` rejects without that capability. This also works from actions through the authenticated internal `staffAccess.currentInternal` query.

- **Owner:** email in `ADMIN_EMAILS`. Owner takes precedence over every staff grant, including a legacy/corrupt cashier grant. Owners cannot be assigned or downgraded through Team. With no staff grants or cashier rules, existing owners retain their access.
- **Manager:** a claimed, identity-bound staff grant. `requireAdmin` now means Owner or Manager (`operations`). Its existing callers keep their validation and audit behavior. Marketing keeps its separate grants and permission checks.
- **Cashier:** a claimed, identity-bound staff grant. Gets the explicitly listed checkout endpoints and no general operations permission. Invitations confer no access before claim. A matching email in a different identity/issuer cannot reuse a claimed grant.
- **No staff role:** no staff/admin access. An independent marketing grant continues to work.

Capability flags are `checkout`, `approve`, `operations`, `manageTeam`, `settings`, `bookings`, `services`, `customers`, `orders`, `chats`, `properties`, `roster`, `reports`. `myAccess` adds `marketing`, resolved through existing marketing access. `settings` denotes owner settings management; Managers can still call existing settings read queries. Cashier receipts/order recall use checkout permission while the general Orders sidebar/list remains an operations area.

New tables: `staffGrants`, singleton `cashierRules`, `staffApprovalRequests`. The staff-roles base added optional `billLines.catalogUnitPrice` to an existing table. Package 2.1 adds optional `cashierRules.refund`, the `refund` approval kind, optional rules fingerprints, `billRefunds` and refund audit events; existing documents remain valid without migration. Grant revisions prevent a role change and reversal in the same millisecond from reviving a request.

## UI API

All names below are under `api`. IDs are Convex IDs for their named tables. Mutations validate exact argument shapes; identities/actors are always derived from the session.

### Access, Team and rules

| Function | Args | Return | Authorization |
| --- | --- | --- | --- |
| `staffAccess.myAccess` (query) | `{}` | `{ email: string|null, role: 'owner'|'manager'|'cashier'|null, capabilities, pendingInvitation: {role,expiresAt}|null, cashierRules: Rules, marketingRole }` | Any session, including signed out (false flags) |
| `staffAccess.claimInvite` | `{}` | `null` | Matching authenticated email; unclaimed, unexpired invitation; already claimed by this identity is idempotent |
| `staffAccess.listPeople` (query) | `{}` | `Array<{email, role, staffGrant: GrantSummary|null, marketingGrant: GrantSummary|null}>` | Owner |
| `staffAccess.setGrant` | `{email, role: 'manager'|'cashier'|null}` | `Id<'staffGrants'>` for invite/change, `null` for revoke | Owner |
| `staffAccess.updateInvitation` | `{grantId, action:'resend'|'expire'}` | `{expiresAt}` | Owner; unclaimed invites only |
| `staffAccess.getCashierRules` (query) | `{}` | `Rules` | Owner |
| `staffAccess.updateCashierRules` | `{expectedRevision, discountLimitPercent, voidPaidSale, customPrice, paymentFix, refund?}` | Updated `Rules` | Owner; revision must match |
| `pos.createOrder` | `{}` | `{orderId}` | Checkout; creates an empty order when its first custom item needs approval |
| `customers.checkoutCustomer` (query) | `{customerId}` | `{_id,name,phone?,email?,revision,archivedAt?,mergedInto?}|null` | Checkout; contact card only |

`Rules = { revision:number, discountLimitPercent:number, voidPaidSale:'manager'|'cashier', customPrice:'manager'|'cashier', paymentFix:'manager'|'cashier', refund:'manager'|'cashier' }`. Defaults: revision 0, limit 10, all actions `manager`. Limit range 0–100, up to two decimals. Missing record reads defaults without writing. The additive `refund` field reads as `manager` when absent; older callers omitting it on update preserve its current value. Package 2.1 implements the rule and matching approval kind. Updates increment revision; conflicts throw `ConvexError({code:'STALE_RULES',message})`.

`GrantSummary = {id, role, claimed:boolean, expiresAt:number|null, expired:boolean, updatedAt:number}`. Team combines owners and both grant tables by email; it never merges tables or changes marketing permissions. A marketing-only person has staff `role:null`. Owner precedence remains explicit. The view caps each grant table at 500 and fails visibly if exceeded.

Invites last 14 days, matching marketing policy. `setGrant` changes a claimed role in place, preserving identity binding. On an unclaimed invite it changes role without renewing expiry; use `updateInvitation(action:'resend')` to renew explicitly. `expire` prevents claim immediately. Revoke deletes the grant and logs the event. Creating/resending invitations stores the invitation; email delivery is not implemented, matching the current marketing-grant flow.

### Approval requests

| Function | Args | Return | Authorization |
| --- | --- | --- | --- |
| `staffApprovals.create` | `{orderId, payload:Payload, reason:string}` | `{requestId,status:'pending',expiresAt,totalBefore,totalAfter,amount,percent?}` | Cashier only; order visibility and paid-link rule below apply |
| `staffApprovals.approve` | `{requestId}` | `{status:Status,replayed:boolean}` | Owner/Manager, in their own session; cannot approve own email or identity |
| `staffApprovals.cancel` | `{requestId}` | `{status:Status}` | Original requester identity, even after revocation (then resolves stale) |
| `staffApprovals.reject` | `{requestId,reason?:string}` | `{status:Status}` | Owner/Manager |
| `staffApprovals.pending` (query) | `{}` | `{count:number,list:RequestView[]}` | Owner/Manager |
| `staffApprovals.forOrder` (query) | `{orderId}` | `RequestView[]`, newest first | Checkout; cashier order visibility below applies |

`Status = 'pending'|'applied'|'rejected'|'cancelled'|'expired'|'stale'`.

`RequestView = { _id, _creationTime, orderId, lineId?, kind, payload, reason, requesterEmail, approverEmail?, orderRevision, rulesRevision, status, createdAt, expiresAt, resolvedAt?, resolutionReason?, amount, percent?, totalBefore, totalAfter }`. Private identity tokens and raw fingerprints are excluded. The inline query returns the newest 50 requests plus outstanding stored-pending requests, so older history cannot conceal an active request. The manager query returns the exact effective pending count/list, with a visible failure above 500 stored-pending rows. Per-order outstanding scans cap at 200 and fail closed above that limit.

`Payload` is the exported discriminated union in `convex/lib/staffTypes.ts`:

```ts
{ kind: 'discount', lineId, discount: { type: 'amount'|'percent', value:number } }
{ kind: 'customPrice', action:'overrideLinePrice', lineId, price:number|null, note:string }
{ kind: 'customPrice', action:'addCustomItem', name:string, price:number }
{ kind: 'customPrice', action:'updateSourceLine', lineId }
{ kind: 'customPrice', action:'attachSource', bookingId?:Id<'bookings'>, appointmentId?:Id<'serviceAppointments'> }
{ kind: 'voidPaidSale' }
{ kind: 'refund', lineId, amount, currency, method, idempotencyKey } // amount in integer satang
{ kind: 'paymentFix', action:'amendOrderPayment', tenders?:Tender[], effectiveAt?:number,
  customer?:{customerId:Id<'customers'>|null,expectedCustomerRevision?:number} }
{ kind: 'paymentFix', action:'voidUnreceivedOrder' }
{ kind: 'paymentFix', action:'linkPaidLine', lineId, bookingId?, appointmentId?, expectedTargetRevision:number, notifyGuest?:boolean }
{ kind: 'paymentFix', action:'unlinkPaidLine', linkId }
```

Choose exactly one source ID for attach/link. When `paymentFix='manager'`, cashiers cannot request `linkPaidLine` or `unlinkPaidLine`: a Manager/Owner performs those direct mutations in their own session. Denials use `NEEDS_APPROVAL` with kind `paymentFix`, but the UI must send the manager to the linking flow instead of creating a link request. Other paymentFix actions remain requestable. When the rule is `cashier`, direct paid linking/unlinking and optional link requests are permitted. `Tender = {method:'cash'|'promptpay'|'card'|'transfer',amount:number,received?:number}`. Existing direct POS signatures and return shapes stay the same; the new requests supply order/reason, correction revision and stable correction idempotency keys server-side. `discount` requests set only the exact replacement discount; quantity/scheduling changes are separate writes and stale the proposal.

Reasons are trimmed and required, 1–500 characters. Creating a request changes no order, line, coupon reservation, payment or receipt; it only writes the request, audit history and scheduled expiry. One effective pending request is allowed per order. Request previews include coupon-adjusted totals. For manual actions `amount`/`percent` describe the total proposed manual reduction; for a custom item the amount is its charge; paid actions show the receipt/allocation amount. Paid receipts remain as issued; ordinary void has equal before/after totals because it keeps received money, while an unreceived-payment void previews zero recorded charge afterward.

Approval executes the same `execute*` TypeScript helper used by the direct POS mutation, with the approving session's actor. Existing validation, billAudit, billCorrections, booking/appointment ledgers, coupon and affiliate handling run in the same mutation as the terminal request update. Any validation failure rolls everything back, leaving the request pending for correction/cancel/reject. A terminal request never executes again; retries return its status and `replayed:true`. Approval metadata is stored on the request, and `recordChanges` records requester, reason, payload and resolution under entity type `staffApproval`, entity ID = order ID.

Requests expire at `createdAt + 300000` (inclusive). Status queries immediately derive stale/expired; approve/reject/cancel and the scheduled internal expiry mutation persist terminal status. Fingerprints cover the full order/lines/links, source booking/appointment records, prior POS refunds, relevant customer, coupon state/latest catalog-history event, business date, requester grant identity/revision, rules revision and all resolved rule values (including refund). Repricing/attach proposals resolve the exact source snapshot protected by that fingerprint. Coupon pause/resume or role change/reversal cannot revive a request. The approver's current permission is checked at execution; revoked managers cannot approve. Order/source/customer changes conservatively stale requests, including changes that leave the amount unchanged. At deadline, expiration takes precedence over other stale causes.

`settleOrder` blocks **every role** on an effective pending request with `ConvexError({code:'PENDING_APPROVAL',message,requestId})`. Stale/expired requests do not block payment. A replay of an already completed settlement remains idempotent.

### Manual discount and custom price contract

All amount arithmetic uses the existing satang rounding (`billMath.round2`, `lineStaffDiscount`), before coupons. The baseline subtotal is `max(catalogUnitPrice ?? unitPrice, unitPrice) × qty`, rounded to satang; a stale/lower snapshot cannot hide a reduction from the line's own pre-discount price. The manual reduction is `max(0, baselineSubtotalSatang - netBeforeCouponSatang)` for the current quantity. The limit is baseline subtotal × limit hundredths of a percent, rounded half up to integer satang. Thus 100.00 on 1000.00 is allowed and 100.01 requires approval at 10%. Percent discounts use the existing hundredths-of-a-percent rounding. A new discount replaces the prior one.

For catalog room/service rows the catalog snapshot is their original `unitPrice`; price overrides never change it. New attached appointments snapshot the agreed `appointment.price`, regardless of the current service catalog price. New attached stays use the booked charge, including an override authorized by Owner/Manager, adjusted for provider-waived charges. That override is already authorized and does not consume the cashier discount allowance; legitimate booking coupons/direct rates remain unaffected. Legacy rows without the optional baseline fall back to `unitPrice` until a source refresh establishes the source baseline. No backfill is required. Custom extras have their explicitly authorized starting price as baseline because no extras catalog exists.

The resulting whole line is checked on discount edits, quantity edits, price overrides and source repricing. Source attachment and both `openOrderFor` / `openOrderForLink` check only lines newly added for that source in this call; reopening or extending a reused order preserves existing manager-approved discounts. A custom-price permission never waives the manual reduction ceiling. Retained discounts combine with a price override for this check. Refreshing or reattaching a source uses its agreed source price, including a manager-authorized booking override. A manager-approved action may exceed the ceiling; its audit trail records the manager. Cashiers can subsequently settle that unchanged order. Valid coupons remain separate, including coupons above 10%, with all existing eligibility/cap/budget checks.

Cashier denials for these actions throw typed `ConvexError` data:

```ts
{ code:'NEEDS_APPROVAL', kind:'discount', message,
  amount, percent, subtotalSatang, reductionSatang, limitSatang, discountLimitPercent }
{ code:'NEEDS_APPROVAL', kind:'customPrice'|'voidPaidSale'|'paymentFix'|'refund', message }
```

Use `customPrice` for override/custom-item/source-update proposals, including a price action whose combined reduction hits the discount ceiling. Use `discount` for a replacement discount. `attachSource` supports a discounted source that cannot initially be attached; allocate its target with `pos.createOrder` if necessary. The existing staff/booking scheduling and source payment validations still run.

## Endpoint inventory: checkout and cashier-callable staff APIs

Every endpoint in this table checks `checkout` (Owner, Manager, Cashier), except the explicitly stated identity/telemetry exceptions. The action rule can still require an approval before its money write. None receives a client-supplied actor.

| Module | Endpoints | Additional restriction |
| --- | --- | --- |
| `pos` | `stableCatalog`, `recentCatalogRanking`, `catalog`, `getOrder`, `findOrderByNumber`, `attachLookupStatus`, `listAttachable`, `orderHistory`, `restoreCheck` | Order/receipt or bounded catalog/source lookup only; cashier receipt/history date restrictions below; general order list remains operations |
| `pos` | `createOrder`, `openOrderFor`, `openOrderForLink`, `addItem`, `attach`, `updateLine`, `removeLine`, `updateSourceLine`, `linkCustomer`, `unlinkCustomer`, `saveOrder`, `clearOrder`, `discardOrder`, `restoreOrder`, `settleOrder` | Unpaid lifecycle checks remain; custom extra uses `customPrice`; source price changes use `customPrice` and the manual ceiling; settlement blocks pending approvals |
| `pos` | `overrideLinePrice` | `customPrice` rule **and** manual ceiling |
| `pos` | `applyOrderCoupon`, `removeOrderCoupon`, `recheckOrderCoupon` | All existing coupon validity checks; no cashier percentage ceiling |
| `pos` | `linkCandidates` | Cashiers only with `paymentFix='cashier'`; checks rule before guest-name search; cashier order date restriction applies |
| `pos` | `voidOrder` | Paid only; `voidPaidSale` rule; keeps received money; refused after POS refunds |
| `pos` | `refundLine` | Paid walk-in line only; `refund` rule; cashier order visibility; integer satang and idempotency/cap checks |
| `pos` | `amendOrderPayment`, `linkPaidLine`, `unlinkPaidLine`, `voidUnreceivedOrder` | `paymentFix` rule, correction revisions/idempotency/proof checks retained |
| `customers` | `browseCustomers`, `searchCustomers`, `checkoutCustomer`, `createCustomer` | Cashiers: active search only, at least two characters; no archive browsing; contact cards only; create rejects nonempty notes. No profile edits/history/merge privileges |
| `displays` | `createPairLink`, `approveCode`, `takeDisplay`, `showOrder`, `renewDriverLease`, `listDisplays`, `revoke` | Existing pairing secrets, driver/lease and display checks remain |
| `orderHistoryPages` | `corrections`, `audit`, `bookingRefunds`, `appointmentRefunds`, `billRefunds` | Order-specific receipt histories, page size 1–50; cashier order date restriction applies; no refund writes |
| `staffApprovals` | `create`, `forOrder` | Create is Cashier only; immutable exact payload; cashier order date restriction applies to both; link/unlink requests require paymentFix=cashier |
| `staffApprovals` | `cancel` | Authenticated original requester identity; no staff capability required after revocation |
| `staffAccess` | `myAccess`, `claimInvite` | Access query permits signed out; claim requires matching unexpired unclaimed invite |
| `marketingReport` | `noteCouponRefusal` | POS surface accepts `checkout`; admin-booking surface requires `operations`; public booking surface and rate limits unchanged; unauthorized diagnostics are discarded |

For Cashiers, `pos.getOrder` and `pos.findOrderByNumber` return `null` for orders outside active unpaid checkout (`draft`/legacy `held`) or settlements (`paid`/`void`) on the current resort business date. Settlement date uses `resortTodayIso(paymentEffectiveAt ?? paidAt)` and is compared to `resortTodayIso()` (Asia/Bangkok); a void does not reset it. Missing settlement timestamps and discarded orders are hidden. `orderHistoryPages.*`, `pos.orderHistory`, `staffApprovals.forOrder` / `create`, and permitted `linkCandidates` enforce the same boundary with `Order not found`, identically for absent and inaccessible orders. Authorization runs before order joins/history reads. Owners/Managers retain their prior read access.

Cashiers receive minimal customer cards rather than private notes or unrelated guest histories. `getCustomer`, all customer editing/archive/merge/history endpoints, general order lists, booking/appointment admin and penalty-fee creation stay operations-only. The UI must use `customers.checkoutCustomer` and skip the old full CustomerDetails workflow for cashiers; display pairing stays fully usable from checkout.

Pre-existing public/guest APIs retain their own authentication, token and validity policies. In touched modules these include `settings.publicProfile`, `displays.claimLink`, `startPairing`, `releaseDisplay`, `current`, `heartbeat`, and the public booking telemetry surface. They gain no staff permission or broader guest-data access from this feature.

## Endpoint inventory: owner-only and approval management

| Endpoint | Required capability |
| --- | --- |
| `settings.update`, `settings.restore` | Owner (`requireOwner` / `manageTeam`) |
| `staffAccess.listPeople`, `setGrant`, `updateInvitation`, `getCashierRules`, `updateCashierRules` | Owner (`manageTeam`) |
| `staffApprovals.pending`, `approve`, `reject` | `approve` (Owner/Manager); own approvals forbidden |
| `recordHistory.list` for `staffGrant`, `cashierRules`, `marketingGrant` | Owner; marketing entity history retains its existing separate marketing check/redaction |
| `staffAccess.currentInternal` | Internal only; authenticated resolver for action contexts |
| `staffApprovals.expire` | Internal only; scheduled terminal-status maintenance |

Marketing access management (`marketingAccess.listGrants`, `setGrant`) is unchanged and still requires `manageAccess` from the existing marketing layer. A staff Manager has no implicit marketing grant.

## Endpoint inventory: existing requireAdmin operations surface

The following 182 registered endpoints (including the conditional non-marketing branch of `recordHistory.list`) resolve through the unchanged `requireAdmin` interface, now backed by `operations` (Owner/Manager). They remain denied to Cashiers. This list includes calls made through local helpers, such as customer merges. Source files outside the explicit changes below require no mechanical edits.

| Module | Endpoints requiring operations |
| --- | --- |
| `adminBookings` | `listForAdmin`, `getForAdmin`, `searchBookings`, `findGuests`, `updateBooking`, `recordPayment`, `amendPayment`, `cancelPayment`, `recordRefund`, `cancelStay`, `reopenBooking`, `resendBookingEmails`, `createBooking`, `quoteBookingEdit`, `editBooking`, `deleteBooking`, `listCleanupCandidates`, `deleteBookings`, `updateNotes`, `bookingFinancials`, `bookingHistory`, `addDateBlocks`, `addDateBlock`, `updateDateBlock`, `removeDateBlock` |
| `adminChat` | `listSessions`, `getSessionDetail`, `settleGuestMessage`, `listTranscriptMessages`, `getTranscript`, `setSessionStatus`, `setAiPaused`, `setStaffTask`, `setKeepWithStaff`, `deleteArchivedSession` |
| `adminProperties` | `get`, `create`, `duplicate`, `setSlug`, `setStatus`, `deleteDraft`, `generateUploadUrl`, `saveUploadedImage`, `createRoom`, `deleteRoom`, `reorderRooms`, `setHotspots` |
| `adminReply` | `claim`, `complete`, `fail` |
| `adminReviews` | `list`, `create`, `update`, `remove` |
| `adminServices` | `listStaff`, `uploadStaffAvatar`, `discardStaffAvatarUpload`, `createStaff`, `updateStaff`, `archiveStaff`, `countUpcomingAppointments`, `listServices`, `createService`, `updateService`, `archiveService`, `setServiceStaffMatrix`, `listTimeOff`, `addTimeOff`, `updateTimeOff`, `removeTimeOff`, `listSchedule`, `findOpenSlots`, `getAppointmentReference`, `createAppointment`, `previewAppointmentTime`, `correctAppointmentStatus`, `listAppointmentHistoryPage`, `listTimeOffPage`, `rescheduleOptions`, `rescheduleAppointment`, `updateAppointmentTurnaround`, `updateAppointmentStatus`, `markAppointmentPaid`, `getAppointmentFinancials`, `correctAppointmentPaymentEntry`, `updateAppointmentDetails`, `refundAppointment`, `cancelAppointment`, `listAppointmentHistory` |
| `availability` | `getAdminBlockedDates` |
| `bookings` | `getById`, `listByProperty` |
| `businessFacts` | `adminList`, `adminSave`, `adminSetStatus`, `adminResolveUnknownGroups`, `adminPropertyOptions` |
| `chatKnowledge` | `adminListPropertyScopes`, `adminCreatePropertyScope`, `adminDeletePropertyScope`, `adminListAnswers`, `adminGetAnswerDetail`, `adminListAnswerOptions`, `adminListTopics`, `adminCreateAnswer`, `adminUpdateAnswer`, `adminListUnknownQuestions`, `adminGenerateSimilarQuestions`, `adminCreateAnswerFromUnknown`, `adminResolveUnknownWithAnswer`, `adminIgnoreUnknown`, `adminReopenUnknown`, `adminDeleteAnswer`, `adminDeleteQuestion`, `adminApproveQuestion`, `adminRejectQuestion`, `adminListUnknownGroups`, `adminSuggestAnswersForUnknownGroups`, `adminIgnoreUnknownGroups`, `adminReopenUnknownGroups`, `adminLinkUnknownGroups`, `adminUndoLinkUnknownGroups`, `adminListPendingVariants`, `adminApproveQuestions`, `adminRejectQuestions`, `adminUnreviewQuestions`, `adminSetAnswersStatus` |
| `chatSuggestions` | `adminListCurated`, `adminCreateCurated`, `adminUpdateCurated`, `adminTranslateCuratedDraft`, `adminTranslateMissingCurated`, `adminSetCuratedStatus`, `adminArchiveCurated`, `adminRestoreCurated`, `adminDeleteArchivedCurated` |
| `configurationHistory` | `records` |
| `customers` | `getCustomer`, `listCustomerOrders`, `customerHistory`, `updateCustomer`, `setCustomerArchived`, `resumeCustomerMerge`, `mergeCustomers` |
| `emails` | `sendTestEmail` |
| `ical` | `addSource`, `listSources`, `updateSource`, `removeSource`, `rotateExportToken`, `getExportToken`, `syncSource` |
| `leads` | `list`, `exportRows`, `remove` |
| `payments` | `linkRecordedStripeRefund` |
| `pos` | `listOrders`, `ordersForBooking`, `addAppointmentFee`, `appointmentFees` |
| `properties` | `listOtaRates`, `upsertOtaRate`, `removeOtaRate`, `adminList`, `adminGet`, `update`, `updateRoom` |
| `recordHistory` | `list` |
| `roster` | `getWeek`, `applyCells`, `resetCells`, `copyWeek`, `makeDefault`, `undo`, `previewBreakChange`, `editBreak` |
| `seed` | `seedCuratedQuestionBank` |
| `settings` | `get`, `channelHealth`, `serverConfig`, `setupChecklist`, `admins` |

`lib/serviceSlots.createAppointmentRecord` also retains its conditional `requireAdmin` check for historical/admin appointment creation; its callers retain their existing public/admin admission policies. Settings reads, including `settings.admins` and `recordHistory.list(entityType="settings")`, require `requireAdmin` (Owner/Manager); settings writes and Team/grant/cashier-rule management remain owner-only. All `requireOwner` callers were checked: only these settings reads needed restoration. The conditional owner history scopes are listed separately above.

## Refund and paid-source decisions (updated for package 2.1)

Existing refund endpoints:

| Endpoint/helper | Existing purpose | Staff policy in this change |
| --- | --- | --- |
| `adminBookings.recordRefund` → `recordStayRefund` | Amount-based stay refund recording | Owner/Manager only |
| `adminBookings.cancelStay` with `refund` | Cancellation plus optional refund in one transaction | Owner/Manager only |
| `adminBookings.updateBooking` with legacy `refundRecorded:true` | Legacy cancellation/full-refund recording | Owner/Manager only |
| `adminServices.refundAppointment` → `recordAppointmentRefund` | Appointment refund recording | Owner/Manager only |
| `pos.refundLine` | Record a walk-in line return in integer satang | Checkout visibility; follows `refund` rule or manager approval |
| `payments.recordRefund` | Authoritative provider refund reconciliation | Internal only, unchanged |
| `payments.linkRecordedStripeRefund` | Allocate an already recorded provider refund | Owner/Manager only; booking finance management |
| `orderHistoryPages.bookingRefunds`, `appointmentRefunds`, `billRefunds`, `pos.getOrder` | Receipt-linked refund reads | Checkout allowed within the cashier order date boundary; no recording privilege |

Package 2.1 adds `pos.refundLine({orderId,lineId,amount,currency,method,reason,idempotencyKey})` → `{refund:RefundView,replayed}`. Owner/Manager execute directly; Cashier follows `refund` (`manager` by default). `NEEDS_APPROVAL` routes to an immutable `refund` payload; manager approval executes in the same transaction as request resolution. Refund amounts and line summaries are integer satang; existing report, credit, tender and source-refund amounts remain major units. `getOrder` adds per-line refunded/remaining values, POS refund summaries and a derived fully-refunded flag. `billAudit` and order history receive return entries. Full pagination is `orderHistoryPages.billRefunds`.

See [POS partial refunds API](pos-partial-refunds-api.md) for shapes, typed errors and boundaries. Only settled walk-in lines qualify; source-owned/allocated rows use source finance controls. Fully returned orders stay paid and retain consumed coupons. Both void modes are refused after a POS refund; refunded lines cannot later be allocated. Reports date returns on the server's Bangkok business date; affiliate credit sync is atomic. Existing booking/payment corrections outside checkout remain operations-only regardless of POS refund/paymentFix rules.

`voidUnreceivedOrder` is classified as **paymentFix** because it reverses recorded source payments/allocations, even though its receipt becomes void. `voidOrder` is **voidPaidSale** because it keeps received money. `linkPaidLine` and `unlinkPaidLine` are **paymentFix** because they change allocation. All amendment fields (tender, date, payer) use **paymentFix**. Custom extras use **customPrice**; no catalog extras exist. Appointment no-show/late-cancellation fee controls stay operations-only because they originate in appointment admin.

## Integration limits and validation

The follow-on UI must read `myAccess`, claim an offered staff invitation explicitly, hide/skip operations queries for Cashiers, use the contact-card customer API, and route typed `NEEDS_APPROVAL` responses into the matching immutable request payload, except manager-only paid linking/unlinking (open the manager linking flow directly). Receipt recall must handle hidden orders as missing, and skip `linkCandidates` for cashiers unless paymentFix is cashier. Read the `refund` rule and use the package 2.1 request payload and POS refund history contract. Existing rules forms may omit the optional update argument without resetting the rule. An expired/stale approval response requires a fresh request. Live Clerk-session/UI verification is deferred to the UI implementation; these changes were exercised using identity-bound convex-test sessions, including a full cashier customer/coupon/payment/receipt/display sale. No shared deployment was touched.

Verification commands and final results are recorded in the implementation handoff. Tests cover default owners, role precedence, action-context access, direct permission denial, independent marketing grants, invitation claim/expiry/renew/revoke, rules concurrency, satang/quantity/percent boundaries, replacement edits, coupons, custom/source repricing, immutable requests, audit actors, atomic rollback, expiry, rejection/cancel, stale requests, role restoration/regrant, pending-payment guards, and paid link/unlink/amend/void actions.

### Final local verification

Commands ran from this worktree with `$HOME/.bun/bin` added to `PATH` (Bun 1.3.14). Package scripts internally invoke the repository's pnpm commands where configured. Node was 24.19.0; pnpm reported the repository's Node 22 engine preference without failing any check.

| Exact command | Final result |
| --- | --- |
| `git fetch origin && git switch -c feat/staff-roles-backend origin/main` | Passed; branch based on fetched main |
| `PATH="$HOME/.bun/bin:$PATH" bun install --frozen-lockfile` | Passed; no dependency/lockfile changes committed |
| `PATH="$HOME/.bun/bin:$PATH" bun run typecheck` | Passed; app, tests and Convex checks; 0 errors |
| `PATH="$HOME/.bun/bin:$PATH" bun run lint` | Passed; 0 errors, 0 warnings |
| `PATH="$HOME/.bun/bin:$PATH" bun run test:unit` | Passed; 232 files, 2,963 tests, 0 failures |
| `PATH="$HOME/.bun/bin:$PATH" bun run build` | Passed; production build, 170 pages generated |
| `PATH="$HOME/.bun/bin:$PATH" bun run test:unit convex/staffRoles.test.ts` | Passed; final focused run: 35 tests, 0 failures |
| `PATH="$HOME/.bun/bin:$PATH" bun run test:unit convex/pos.test.ts convex/marketingAccess.test.ts convex/orderLifecycle.test.ts convex/settings.test.ts convex/displays.test.ts` | Passed; 5 files, 136 tests, 0 failures |
| `git diff --check` | Passed |

During implementation, the first focused staff run had 25 passes and 6 failures: five test invocation/expectation mistakes and one percent-rounding expectation inconsistent with the existing hundredths-of-a-percent arithmetic. These were corrected before the successful focused and full runs. Intermediate Convex-only typechecks also caught one telemetry surface-name mismatch and two invalid test signatures, all corrected. The final commands above passed on the committed implementation. Browser/e2e and a real Clerk cashier session remain for the follow-on UI work; no backend deployment was run.


## Audit regression coverage

All cases below are in `convex/staffRoles.test.ts`; parameterized cases exercise both indicated variants.

| Finding | Regression test |
| --- | --- |
| Appointment baseline and lower-snapshot bypass | `uses the agreed appointment price %s despite catalog drift` (1500 and 500); `never hides manual reduction behind a baseline below the line price` |
| Cashier receipt privacy and paid linking | `limits cashier receipt and history reads to unpaid or current business-date settlements`; `keeps paid-link discovery and link requests behind the paymentFix rule` |
| Reused orders with approved discounts | `%s preserves manager-approved discounts when reusing or extending an order` (`openOrderFor`, `openOrderForLink`) |
| Manager-authorized booking overrides | `uses the %s booking override as baseline across refresh and reattachment` (Owner, Manager) |
| Additive refund rule and old caller compatibility | `defaults the additive refund rule to manager and preserves it for older callers`; package 2.1 coverage in `convex/posRefunds.test.ts` |
| Manager settings reads | `restores manager settings reads while keeping writes and Team history owner-only` |

Final local validation uses `PATH="$HOME/.bun/bin:$PATH"`: `bun run typecheck` (app, tests and Convex), `bun run lint`, `bun run test:unit` (2,973 tests / 232 files; staff-role suite 45 tests), and `bun run build` (170 static pages). No deployment or shared-data changes are involved.
