# Booking corrections and financial records: delivery

Branch `fix/audited-record-corrections`, working tree only. No commits, pushes, PRs, deploys, live writes, package installs, subagents or generated-file edits. Concurrent changes by other workers were preserved; schema edits are narrow patches to the bookings, bills and billPayments sections plus new tables placed next to them, and one import line.

Covers audit items 3, 4 and B1, B2, B3, B4 (booking pay and POS settlement), B6, B7, B9, B10 (bookings), B11 (bookings), part of 5 (stay reopen) and part of 7 (ordinary POS line history). Appointment refunds, order discard/restore and receipt/pay panel UI are listed under remaining work.

## Model

- `bookings.amountPaid` stays the **gross** total received. New `bookings.amountRefunded` is the transactional sum of refund records. `billMath.bookingBalance` returns `{ paid (net), owed (negative = credit), gross, refunded }`. A `refunded` booking always nets to zero: a legacy one (no `amountRefunded`) counts its whole payment as refunded, and no refund record is invented.
- `lib/bookingMoney.stayMoney(booking)` adds `owed` (≥ 0), `credit`, `refundable`, `refundContext` (`credit` on a live stay, `cancellation` on a cancelled one) and `legacyRefund`.
- **Refund rule.** A live stay refunds only its credit (net paid above the price), so a refund can never reopen a balance or make a stay payable again. To give back more on a live stay, set a custom price or cancel first. A cancelled stay can refund any part of what it kept. A cancelled stay refunded to zero becomes `paymentStatus: refunded`.
- Every payment now writes a `bookingPayments` row (`origin` manual / pos / online). Online money is the provider's record and is never amended or undone. Paid amounts recorded before this release are reported as `unitemised` and are not turned into rows.
- `bookings.revision` (absent = 0) is bumped by every write that goes through `writeBooking`. That covers all staff paths, Stripe completion via `markBookingPaid`, and chat cancellation.
- History lives in `recordChanges` with entity type `booking`, written in the same transaction as the change: before and after of each changed field, plus details. Kinds: `created`, `edited`, `notes`, `confirmed`, `price_set`, `payment_recorded`, `payment_amended`, `payment_cancelled`, `order_payment_amended`, `order_voided`, `refund_recorded`, `cancelled`, `reopened`, `deleted`. Deleting a booking writes a `deleted` snapshot, and each unlinked appointment gets an `appointment`/`booking_unlinked` row. The appointment schema is unchanged.
- Order line history lives in `recordChanges` with entity type `order`. Kinds: `line_added`, `line_updated`, `line_removed`, `source_attached`, and `cleared` with the removed rows. It is deliberately not in billAudit, so `orderLinks.isPlaceholder` still lets an emptied test booking be deleted.

## Schema additions (all optional or new, so old documents stay valid)

- `bookings`: `amountRefunded`, `priceOverride {total, quotedTotal, reason, by, at}`, `revision`, `createdBy`, `guestEmailsOff`, `cancelledAt`, `cancelledBy`, `cancelReason`.
- `bookingPayments` (new): `bookingId, origin, amount, currency, method, billId?, effectiveAt, recordedAt, recordedBy, idempotencyKey?, note?, refunded, status (recorded|cancelled), cancelledAt/By/Reason?, amendedAt/By?`. Indexes: `by_bookingId_and_recordedAt`, `by_billId`, `by_idempotencyKey`.
- `bookingRefunds` (new): `bookingId, amount, currency, method, reason, context, paymentId?, billId?, effectiveAt, recordedAt, recordedBy, idempotencyKey, netBefore, netAfter`. Indexes: `by_bookingId_and_recordedAt`, `by_billId`, `by_idempotencyKey`.
- `billCorrections` (new): `billId, sequence, kind (amended|void_unreceived), reason, actor, recordedAt, idempotencyKey, tendersBefore/After?, customerBefore/After?, customerIdBefore/After?, effectiveAtBefore/After?`. Indexes: `by_billId_and_sequence`, `by_idempotencyKey`.
- `bills`: `voidUnreceived`, `paymentEffectiveAt`, `customerRevisionAtPayment`, `correctionRevision`, `amendedTenders`, `amendedCustomer` (null = no named payer).
- `billPayments`: `effectiveAt`.
- Validators are shared from `convex/lib/financeValidators.ts`.
- Rollback note: the new tables and fields are additive. Rolling back code while `bookingPayments.method` holds new literals needs the validator file kept, as the audit's rollback caveat describes.

## APIs

Every function calls `requireAdmin`, except the internal helpers and the existing public/webhook paths. Effective times are ms timestamps: any past time from 2000-01-01 on is allowed, the future (more than 5 minutes ahead) is refused, and no past-day limit is applied. Amounts must be finite, more than zero, in whole satang and at most 10,000,000. Attempt keys are 8–100 characters. A repeat with the same key returns `replayed: true` and writes nothing; a key reused for a different payload is refused. A replay is checked before the revision, so a retry after a lost response succeeds. Reasons are at most 500 characters.

### `convex/adminBookings.ts`

- `getForAdmin({bookingId})` adds: `revision`, `propertyStatus`, `priceOverride|null`, `money` (stayMoney), `createdBy`, `cancelledAt/By/Reason`, `historical`, `guestEmailsOff`, `confirmationEmailed`, `notifyByDefault`. `amountPaid` is now **net** (after refunds) while paid. `listForAdmin`/`searchBookings` rows also carry `revision`.
- `bookingFinancials({bookingId})` → `{revision, money, payments[], refunds[], legacyOrders[], unitemised, legacyManual: {cancellable:true, amount}|{cancellable:false, reason}, hasStripePayment, complete}`.
  - Each payment row: `_id, origin, amount, currency, method, effectiveAt, recordedAt, recordedBy, note, refunded, refundable, status, cancelReason/At/By, amendedAt/By, order {_id,title,receiptNumber,state,corrected}|null, amendBlocker, cancelBlocker` (null = allowed, else the reason).
  - `legacyOrders` lists paid orders that charged the stay before payments were itemised: `{_id,title,receiptNumber,state,charged,refundable}`.
  - Reads are bounded: up to 100 payments and refunds, 20 order rows.
- `bookingHistory({bookingId, paginationOpts})`: newest first, 1–50 per page. Rows are `recordChanges` documents. Still readable after the booking is deleted.
- `recordPayment({bookingId, expectedRevision, expectedAmount, method: cash|promptpay|card|transfer|other, effectiveAt?, note?, idempotencyKey, notifyGuest?})` → `{paymentId, replayed}`.
  - Records exactly what the stay owes. Refused if the amount changed, if an open order is charging the stay, or while a Stripe checkout is live.
- `amendPayment({bookingId, paymentId, expectedRevision, method?, effectiveAt?, note?, reason})`: corrects a manual entry's method, business date or note, never its amount. POS and online entries refuse, with the reason.
- `cancelPayment({bookingId, expectedRevision, paymentId? | legacy: true, reason})`: a manual entry recorded by mistake (no money received).
  - Reduces the gross amount; the stay may become unpaid again (`paidAt` cleared at net 0). Nothing is refunded.
  - Refuses online and POS entries, a partly refunded entry, and a cancellation that would leave refunds above what remains paid.
  - `legacy: true` cancels a pre-release "Mark paid" only when it is provably that alone: method `admin`, no Stripe intent, no order row ever charged the stay, no itemised entry, no refunds.
- `recordRefund({bookingId, expectedRevision, amount, currency, method: cash|promptpay|card|transfer|stripe|other, reason, idempotencyKey, effectiveAt?, paymentId?, billId?})` → `{refundId, replayed}`.
  - `paymentId` must belong to the booking and is capped at what is left of that payment.
  - `billId` must be a paid or void order that charged this stay (not `voidUnreceived`). It resolves to that order's itemised payment, or for a legacy order is capped at the order row's charge less earlier refunds.
- `cancelStay({bookingId, expectedRevision, reason?, effectiveAt?, notifyGuest?, refund?: {same as recordRefund}})`: keeps the money unless `refund` is given. Cancellation and refund are one transaction, so an invalid refund rolls the cancellation back.
- `reopenBooking({bookingId, expectedRevision, confirmed, reason, notifyGuest?, archivedVillaReason?})`
  - Applies to cancelled, expired (`failed`) and refunded stays. Payments and refunds stay.
  - Money still kept → `paid` + `confirmed`. Otherwise `pending` payment, with `confirmed` or `pending` status.
  - Rechecks the nights (held when confirmed), refuses while a Stripe checkout is live and clears stale checkout fields.
  - Non-admin-source bookings reopen confirmed only, because pending ones would expire again.
  - A legacy refunded stay gets `amountRefunded` filled in, so it keeps counting as refunded.
  - An archived villa requires a reason and a stay that started before today.
- `updateBooking({bookingId, action, refundRecorded?, expectedRevision?, notifyGuest?, reason?})`: revision is optional for older callers.
  - `cancel` now keeps paid money. `refundRecorded: true` (legacy) records a full refund with method `unrecorded`.
  - `markPaid` (legacy) records a manual entry with method `unrecorded` and also collects a remaining balance on a paid stay.
- `createBooking(... , notifyGuest?, archivedVillaReason?, priceOverride?: {total, reason})`: past stays default to no emails and set `guestEmailsOff`. Archived villas are allowed only for past stays and need a reason.
- `editBooking(... , expectedRevision?, priceOverride?: {total, reason} | null, notifyGuest?, archivedVillaReason?)`
  - Revision is required whenever `priceOverride` is sent.
  - A villa or date change on a booking with a custom price must say which: a new `priceOverride`, or `null` for the villa rate.
  - The guest is emailed about stay, guest-count or price changes only when `notifyGuest` resolves true.
- `updateNotes({.., expectedRevision?})` and `deleteBooking({.., expectedRevision?})` accept a revision.
- Deletion now also refuses bookings with any payment or refund row, or any amount received or refunded.

Notification default (`resolveNotify`): `notifyGuest ?? (!guestEmailsOff && checkIn >= today)`. Today is the UTC ISO date, as in all booking date checks. A silent booking also gets no pre-arrival or review emails: `bookings.getLifecycleEmailDetails` returns null for `guestEmailsOff`, so the crons queue them but nothing is sent. Online (Stripe) payments always confirm to the guest. Public booking and chat flows are unchanged apart from history rows.

### `convex/pos.ts`

- `settleOrder` adds `effectiveAt?`, `notifyGuest?`, `expectedCustomerRevision?`. All existing checks are kept: `expectedDue`, `expectedRevision`, idempotency, sources, tenders.
  - Writes `billPayments.effectiveAt`, `bills.paymentEffectiveAt` and `customerRevisionAtPayment`. `bills.paidAt` stays the receipt's issue time.
  - Writes a `pos` `bookingPayments` row for each stay, for exactly what the stay owed (line total less the deposit already paid).
  - Sets the appointment's `paidAt` to the business date and `paidBy`.
  - Customer check uses `customers.assertCustomerReviewed`. Now that `CUSTOMER_POS_INTEGRATION_ENABLED = true`, the reviewed revision is required whenever a customer is linked. With the flag off, an omitted revision falls back to the current one, protected by customers.ts order revision bumps.
- `linkCustomer` uses `customers.assertCustomerCanLink`, which refuses missing, archived and merged profiles.
- `amendOrderPayment({orderId, expectedCorrectionRevision, idempotencyKey, reason, tenders?, effectiveAt?, customer?: {customerId|null, expectedCustomerRevision?}})` → `{sequence, replayed}`.
  - Paid orders only. Tenders must add up to the original payments' total, so an online deposit can't be touched. `received` is allowed on cash.
  - The issued receipt number, `billPayments` rows and `customerSnapshot` never change. The corrected values go in `amendedTenders` / `amendedCustomer` / `paymentEffectiveAt`, and a `billCorrections` row records before and after.
  - A new date also moves the stays' `pos` payment rows and booking `paidAt`, plus appointments' `paidAt` that matched the old date. Every charged stay gets a booking history row.
- `voidUnreceivedOrder({orderId, expectedCorrectionRevision, idempotencyKey, reason})`: a paid order recorded by mistake, where no money was received.
  - Voids it, then reverses exactly this order's itemised stay payments (a Stripe deposit stays). Appointments go back to unpaid at their pre-checkout price (`line.unitPrice`, as verified at settlement).
  - Refuses without writing anything when: a stay was paid before payments were itemised (explanatory error; amend tenders or refund instead), part of the payment was refunded, refunds would exceed what remains, or an appointment changed since it was paid.
- `voidOrder` is unchanged in effect: money and sources stay paid. It now adds an `order_voided` row to each charged booking's history.
- `getOrder` adds:
  - `paymentRecord {effectiveAt, tenders, tendersAmended, customer, customerAmended, correctionRevision, voidUnreceived}`
  - `corrections` (newest 20)
  - `refunds` recorded against money this order took
  - `payments` and `receiptCustomer` stay as issued.
- `ordersForBooking`: `balance` adds `refunded` and `credit`, and `paid` is net. Adds `refunds` (newest 10). History rows add `refunded`, `corrected`, `voidUnreceived`.
- `orderHistory({orderId, paginationOpts})`: line history, 1–50 per page.
- The `ATTACHED_PRICE` message now names the real path: Edit booking → Custom price, then update the row. The open row shows `changed` until refreshed, and settlement charges the new price.

## UI (booking sheet)

All new dialogs use the incumbent `ChangeConfirmDialog`: they show before → after, stay open with the error on failure, block a duplicate submit and closing while pending, and keep their input for a retry. Attempt keys are created once per dialog, so a retry is idempotent. Each dialog sends the revision captured when it opened.

- `BookingFinancials.tsx`: net paid, refunded, balance, credit or kept. Each payment shows its origin, method, order receipt link, received and recorded times, actor, and any refund or cancellation.
  - Actions per payment: Correct method or date, Not received…, Refund from this. Blocker text explains why online and order payments can't be changed here.
  - Also shows the unitemised amount (with the legacy Not received action when provable), legacy order references and refunds.
  - Record payment: method, received date and time, note, and the email toggle when no confirmation was sent yet.
  - Record refund: source payment or order, amount capped live, method incl. Stripe, date, required reason, and a "recording does not return money" warning.
- `BookingCorrectionDialogs.tsx`:
  - Cancel: keep the payment, or record a refund in the same save; date, optional reason, explicit guest email toggle with the current choice spelled out.
  - Reopen: confirmed or pending where allowed, required reason, archived villa reason, email toggle.
- `BookingHistory.tsx`: paginated `bookingHistory` with labelled fields, money, times, reasons and effective times. It says history before this release was not recorded.
- `BookingSheet.tsx`:
  - Shows the custom price and reason, cancellation details, creator and villa status.
  - Payments section and History section.
  - Confirm, notes (revision captured at the first keystroke, plus a "Load the latest notes" recovery), edit and delete all send revisions.
  - Reopen for cancelled bookings, and a past-stay email hint.
  - Edit dialog: custom price with required reason (or explicit return to villa rate), guest email toggle when the change reaches the guest, archived villas offered only for past dates with a required reason.
- `BookingQuickActions.tsx`: Record payment… and Cancel… for paid stays open the sheet. Unpaid cancel and confirm send the revision; the cancel copy says whether the guest is emailed.
- `BookingOrders.tsx`: net paid, refunded and credit, plus per-order refunded, corrected and "voided, no money received".

## Tests executed (this pass, final run)

- `npx vitest run convex/bookingCorrections.test.ts` (new): 21 tests passed. Coverage:
  - Partial refund after shortening a completed stay, then re-extension and POS settlement against the net amount.
  - Cancellation separate from refunds: duplicate key replay, key reuse, overrefund, NaN/∞/0/negative/fractional satang, wrong currency, foreign payment, future date, stale revision, fully refunded stay not payable by any path.
  - Atomic cancel + refund and its rollback.
  - Manual payment record/amend/cancel with business dates.
  - Partly refunded entry not cancellable.
  - Stripe deposit + extension + POS settlement dated yesterday, then `voidUnreceivedOrder` keeping the Stripe money and recharging the balance. Online entries refused for amend/cancel; POS entries refused on the booking.
  - Plain void retaining funds.
  - Wrong tender, date and payer amendment with replay, stale revision, total mismatch and merged customer.
  - Legacy POS order: reversal refused, tender amendment allowed, capped refund by order.
  - Legacy `markPaid` itemised.
  - Legacy refunded booking counted without invented records, reopened and paid again.
  - Legacy document reads and the legacy manual cancel.
  - Custom price: revision and reason guards, stale open row refreshed and settled, stay change requiring a choice, return to villa rate.
  - Historical notifications off by default and on when asked; lifecycle email suppression; public Stripe confirmation unchanged.
  - Reopen against a conflicting stay, an expired web booking and a live checkout.
  - Archived villa past stay with reason.
  - History actors, diffs and page size, with no `accessToken` stored.
  - Deletion snapshot and appointment unlink history; deletion refused once payment records exist.
  - Non-admin and anonymous callers denied on every new function.
  - POS line history snapshots.
  - Appointment settlement business date, future-date refusal, customer revision guard, and appointment reversal.
- `npx vitest run tests/unit/booking-financial-corrections.test.ts` (new, happy-dom, real components with mocked Convex hooks): 10 tests passed. Coverage:
  - Payment rows and blockers.
  - Refund validation, failure with retained input and identical retry args (same key).
  - Desk payment pending state and exact args.
  - Not received requiring a reason.
  - Cancel keeping funds, with the email toggle.
  - Cancel with a partial refund.
  - Reopen with required reasons.
  - History labels and pagination.
  - Custom price edit: failure, retry and notify toggle.
  - Return to villa rate.
- Updated existing tests to the new intended behaviour:
  - `adminBookings.test.ts`: paid cancellation now keeps funds, the legacy flag records a refund, and historical creates are silent.
  - `pos.test.ts` and `orderAudit.test.ts`: the review helpers send the reviewed customer revision now that customers.ts enabled POS integration, and the customer-edit test asserts the customer-revision refusal.
- Focused regression set (17 files: the new files plus adminBookings, pos, orderAudit, orderAuditFixes, orderFinalAudit, orderStableRecheck, checkoutRecovery, payments, chatBooking, queryScale, emails, appointmentCorrections, customers.corrections, pos-checkout, booking-calendar-events): 341 passed.
- Full `npx vitest run`: 138 files, 1466 tests passed. One earlier full run showed a single failure in `tests/unit/pos-customer-corrections.test.ts` while another worker was editing customer UI; it passed in isolation and in the final full run.
- `pnpm typecheck` (app, tests, convex): passed.
- ESLint on every file I changed or added: clean.
- `git diff --check` on my files: clean.
- Not run: `pnpm build`, Playwright/browser tests, any preview (avoided racing other agents). The Node 24 engine warning was not changed.

## Genuine unresolved financial cases

- **Stripe partial refunds.** The webhook (`payments.recordRefund`, not owned) only handles full refunds and writes no history or amount. A full Stripe refund still nets to zero through the `refunded` rule. Partial Stripe refunds must be recorded by staff with method `stripe`. Recommended: record a `bookingRefunds` row from the webhook, keyed by the Stripe refund id.
- **Stripe checkout amount with an earlier deposit.** `payments.completeCheckout` (not owned) requires Stripe to charge the full `booking.total` even when `amountPaid` already holds a deposit. The online `bookingPayments` row records what the stay owed, not the provider's charged amount, and that difference is not resolved here. No such deposit-plus-checkout path exists in production flows that I found; the only case is a test fixture.
- **Appointments.** Appointment refunds and payment corrections remain `adminServices.refundAppointment` / `markAppointmentPaid` (another owner). `bookingRefunds` is stays only. `voidUnreceivedOrder` reverses appointments only when provable.
- **Reversing a stay payment** leaves the stay `confirmed` with its nights held, even if it was pending before the mistaken payment; staff can cancel it. **Cancelling a mistaken entry** on a cancelled stay whose refunds equal the remainder marks it `refunded` without `refundedAt`.
- **Unrecorded system writes.** `crons.expirePending`, `payments.expireCheckout` and `payments.recordRefund` patch bookings without history or revision bumps (not owned). Their state is still guarded: reopen requires `cancelled`, and revisions guard staff writes.
- **No refund receipt.** Recorded refunds have no numbered document; whether Thai credit notes are needed is a business decision. Receipts keep the issued document; corrections and refunds are shown alongside it.

## Remaining integration (other owners)

- **POS pay panel** (`PayPanel.tsx`, `backend.tsx`, `convex-backend.ts`, `fixture-backend.ts`): send `effectiveAt` (business date control), `notifyGuest` for stays, and `expectedCustomerRevision` from the reviewed view (`view.customer.revision`), alongside `expectedDue` and `expectedRevision`. Keep the original attempt values on retry. The flag is already on in customers.ts, so a linked customer now requires it. `backend.tsx` already lists `amendOrderPayment`, `voidUnreceivedOrder` and `orderHistory`.
- **Receipt view** (`ReceiptView.tsx`):
  - Show `paymentRecord` next to the issued `payments`/`receiptCustomer`, plus `corrections` and `refunds`.
  - Offer an "Amend payment" dialog → `amendOrderPayment` (send `paymentRecord.correctionRevision`, a stable attempt key and a reason). Use `tenders` with the same total, `effectiveAt`, and `customer` with `customers.getCustomer().revision`.
  - Offer "Void: no money received" → `voidUnreceivedOrder`, showing its refusal reasons. Keep plain Void for real money.
  - Update the void dialog copy: refunds are recorded on the booking's Payments section.
- **Order panel**: the copy "edit the booking" now matches a real path (Edit booking → Custom price, then Update row). The panel may link to the booking sheet. Order line history can use `orderHistory`.
- **`AdminBookingsView.tsx` drag-and-drop** (not owned): pass `expectedRevision: booking.revision`. Expect the "custom price" refusal for custom-priced stays (or open the edit dialog). Optionally pass `notifyGuest`.
- **`NewBookingDialog.tsx`** (not owned): expose `notifyGuest` (default off for past dates), an archived villa with reason for past stays, and an optional custom price.
- **Order discard/restore** (next bounded task): line history in `recordChanges` (`order`) already includes the cleared rows' snapshot. `cleared`/`line_*` rows are not billAudit, so placeholder deletion is unchanged.
- **Codegen.** New functions live in existing modules (`adminBookings`, `pos`), so generated API types already cover them. Run normal Convex codegen at integration for the separately added `recordHistory` module and others.
