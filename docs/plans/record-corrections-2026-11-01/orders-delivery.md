# Order lifecycle, appointment fees and booking entry: delivery

Branch `fix/audited-record-corrections`, working tree only. Implemented by Kiro (Claude Opus 5.5). No commits, pushes, deploys, live writes, installs, child agents or generated-file edits. Concurrent changes by other workers were preserved.

Covers audit finding 1 (discard/restore), the order part of 7 (lifecycle history), B5 (no-show fee), B7 for new bookings and calendar moves, B1/B8 for new bookings (custom price, archived villa), B11 for calendar moves, and the remaining financial-delivery edge case (refunded without `refundedAt`).

**Frontend discard/restore is not claimed as done here.** The backend and its contract are complete. The checkout UI (Orders dialog, order panel, fixture backend) belongs to the checkout worker, whose integration was in progress while this was written (see "Checkout UI integration" and "Status of other owners' files").

## Files

Owned and changed: `convex/pos.ts`, `convex/lib/orderLinks.ts`, `convex/schema.ts` (narrow `bills` / `billLines` patches only), `src/components/admin/NewBookingDialog.tsx`, `src/components/admin/AdminBookingsView.tsx`.
New: `convex/lib/orderLifecycle.ts`, `convex/orderLifecycle.test.ts`, `tests/unit/admin-booking-entry.test.ts`, this file.

## Schema (additive, except one union literal)

- `bills.status` gains `'discarded'`. Rollback caveat: rolling back the schema while any order is discarded fails validation. Restore those orders first, or keep the literal.
- `bills`: optional `discardedAt`, `discardedBy`, `discardReason` (set while discarded, cleared on restore) and `lifecycleKey` (the attempt key of the latest discard or restore).
- `billLines`: optional `fee { kind: 'no_show' | 'late_cancellation', reason?, by, at }` and `feeAppointmentId`, with index `by_feeAppointmentId`. A fee row is a normal `extra` row, so `billMath.LineKind` and the UI kind maps are unchanged. It does **not** set `appointmentId`, because that field means "this row charges the appointment".
- No billAudit change. Discard and restore history goes to `recordChanges` (entity type `order`), next to the existing line history.

## Discard and restore: behaviour

- **Discard** leaves the order's number, rows, `bookingId`/`appointmentId` links, `customerId`, payments (there are none) and history as they are. Status becomes `discarded`, and `revision` is bumped.
- **Not listed as unpaid.** `listOrders({filter:'unpaid'})` reads the index range `draft..held`, which excludes `discarded`. `listOrders({filter:'discarded'})` pages through discarded orders, newest discard first.
- **Locked while discarded.** Every edit path (`addItem`, `attach`, `updateLine`, `overrideLinePrice`, `removeLine`, `updateSourceLine`, `linkCustomer`, `unlinkCustomer`, `saveOrder`, `clearOrder`, `addAppointmentFee`) refuses with "This order was discarded. Restore it from Orders → Discarded before changing or paying it." `settleOrder` refuses with the same message. `voidOrder` and `amendOrderPayment` already require `paid`.
- **Sources are released, nothing is cancelled.** `isOpenOrder` is false for a discarded order, so it no longer holds its stays, appointments or fees. Staff can open the booking at checkout (which creates a new order), add it to another order, or record a payment outside checkout. The booking or appointment itself is never changed: its status, held nights and payment state stay as they were.
- **Deletion guard stays correct.** `ordersForSource` now includes discarded orders. A booking whose discarded order charges it, or is linked to it, is still refused by `deleteBooking` ("has an order"). A discarded order is never treated as an empty placeholder and deleted.
- **Restore** makes the order `draft` again with its rows exactly as they were. It never re-prices a row and never writes to a source:
  - **Blocking:** a stay, appointment or fee on the order is now on another *open* order. Restoring it would create a second chargeable copy, so the restore refuses and names each conflict. With `removeConflictingRows: true`, those rows are deleted instead, each logged as `line_removed` with its full row and the reason. If every row conflicts, the restore refuses.
  - **Warning, not blocking:**
    - The source changed (dates, price, deposit, therapist, time): the row comes back stale with `sourceIssue.kind = 'changed'`. Settlement refuses it until `updateSourceLine` refreshes it. The booking keeps its new terms.
    - The source was paid, cancelled or deleted, or another fee was paid: `settled` or `gone`. Settlement refuses, and `updateSourceLine` removes the row.
    - An online checkout is running: `online`.
    - Another open order is also linked to the same booking or appointment: `link_shared`. Both links stay. Nothing is charged twice, because charging is decided per row.
    - The linked customer was archived, merged or deleted: `customer`. The link stays. Settlement's customer checks still apply.
  - The revision is bumped (`refreshOrder`), so a payment screen opened before the restore is refused.
- **Clear (legacy)** is unchanged. It still deletes the rows, writes the `cleared` billAudit row and logs a `cleared` history row with the removed rows.

## API contracts (`api.pos.*`)

All require `requireAdmin` (anonymous and non-admin callers are refused; tested). Attempt keys are 8–100 characters (`attemptKey`). Reasons are trimmed and at most 500 characters.

### `discardOrder({ orderId, expectedRevision, idempotencyKey, reason? }) → { replayed: boolean }`

- `expectedRevision` is `getOrder().order.revision` as staff saw it. A mismatch throws "The order changed since you opened it…".
- Retrying with the same key after the discard succeeded returns `{replayed:true}` and writes nothing. This is checked before the revision, so a retry after a lost response works.
- A different key on an order that is already discarded throws "already discarded".
- Paid orders throw "A paid order can't be discarded. Void it instead." Void orders throw "This order was voided".
- Orders with no rows, or with any `billPayments`, are refused.
- Writes a `recordChanges` row: `kind: 'discarded'`, `actor`, `recordedAt`/`effectiveAt`, optional `reason`. `before` holds `{status, revision, bookingId, appointmentId, customerId, itemCount, total, due, lines: [row snapshots]}`; `after` is `{status:'discarded'}`.

### `restoreCheck({ orderId }) → null | { discarded, revision, conflicts, blocking, rowsLeft }`

- Read-only preview. Returns `null` for a missing order. For an order that isn't discarded it returns `discarded: null` and an empty `conflicts`.
- `discarded`: `{at, by, reason}`.
- `conflicts[]`: `{ kind: 'charged_elsewhere'|'changed'|'settled'|'gone'|'online'|'link_shared'|'customer', blocking, lineId|null, name, message, order: {_id,title}|null }`.
- `blocking` counts the blocking conflicts. `rowsLeft` is the number of rows that would come back without them; 0 means the order cannot be restored.

### `restoreOrder({ orderId, expectedRevision, idempotencyKey, removeConflictingRows? }) → { replayed, removed: [{lineId,name,reason}], warnings: RestoreConflict[] }`

- Send the `revision` from `restoreCheck` or `getOrder`.
- A replay (same key, order already restored) returns `{replayed:true, removed:[], warnings:[]}`.
- Refusals:
  - Blocking conflicts without `removeConflictingRows`: "Not restored: <conflicts> Restore without that row/those rows, or leave the order discarded."
  - Every row conflicts: "Not restored: every item on this order is now on another order."
  - The order is not discarded: "This order is not discarded."
- History: a `line_removed` row for each row taken off, then `kind: 'restored'` with `before: {status:'discarded', discardedAt, discardedBy, discardReason}` and `after: {status:'draft', removed:[{lineId,name}], warnings:[{kind,name,message}]}`.

### Changed reads

- `listOrders({ filter: 'unpaid'|'paid'|'void'|'discarded', paginationOpts })`. Rows can now have `state: 'discarded'`, and discarded rows carry `discarded?: {at, by, reason}`. The field is absent on other rows; fixtures may also send `null`.
- `getOrder` adds `discarded: {at,by,reason} | null`. `order.state` can be `'discarded'`. `sourceIssue` is computed for open orders only, now including fee rows. Fee rows carry `fee` and `feeAppointmentId`.
- `ordersForBooking` leaves discarded orders out of `orders` (still typed `'unpaid'|'paid'|'void'`) and adds `discardedOrders: [{_id,title,total,discardedAt,discardReason}]`.
- `orderLinks.orderState` returns `'unpaid'|'paid'|'void'|'discarded'`. It is also used by `customers.getCustomer` and the customer order list (which renders the string).
- New `orderLinks.isSettledOrder(order)`: paid or void.

## No-show and late-cancellation fees (audit B5)

### `addAppointmentFee({ orderId?, appointmentId, kind: 'no_show'|'late_cancellation', amount, reason? }) → { orderId, lineId, replayed }`

- **Eligible appointment:** `no_show` takes a no-show fee and `cancelled` takes a late-cancellation fee. The appointment must have `paymentStatus: 'unpaid'` and be priced in THB.
  - A paid appointment is refused: record a refund of the difference instead.
  - A refunded appointment is refused.
- **Amount:** more than zero, finite, whole satang, at most the appointment's price (when the price is above 0), and within the row limit.
- **The appointment is not changed.** It is not reopened, not marked paid, and its price is not touched. `openOrderFor({appointmentId})` on a no-show still says there is nothing to pay.
- **Receipt row:**
  - Kind `extra`, `qty` 1.
  - Name: "No-show fee · <service>" or "Late cancellation fee · <service>". The service name is the appointment's snapshot, else the current service name.
  - Detail: "<date> <time> · <code> · no-show, service not given" (or "cancelled late, service not given").
  - The row is never merged with ordinary extras and never counted in the Frequent tab.
- **The amount is fixed.** Quantity, discount and price override are refused with "A fee row keeps the amount it was added with. Remove it and add the fee again with the right amount."
- **Repeat-charge guard:** at most one fee per appointment counts, on an open order or a paid one.
  - A second fee is refused: "already on Order #N" or "already charged on Order #N (receipt R)".
  - Fees on void or discarded orders don't count, so a voided fee can be charged again.
  - The same kind and amount repeated on the same open order returns the existing row with `replayed: true`. Without `orderId`, a repeat is refused rather than duplicated.
- **Settlement re-checks** each fee row:
  - It refuses the fee if the appointment was deleted, its status was corrected (for example to `completed`), it was paid, or another fee was charged.
  - `updateSourceLine` removes such a fee row and writes a `source_removed` billAudit row.
- **Audit:**
  - Order history: `fee_added` (with the row and reason) and `line_removed`.
  - Appointment history in `recordChanges` (`entityType: 'appointment'`): `fee_added`, `fee_removed`, and `fee_charged` with `{feeKind, amount, currency, billId, receiptNumber}` at the payment's `effectiveAt`.
  - Plain `voidOrder` does not write an appointment row. This is a known gap; voiding releases the guard.

### `appointmentFees({ appointmentId }) → [{ lineId, kind, amount, currency, reason, by, at, order: {_id,title,state,receiptNumber} }]`

Newest first, at most 20, any order state. Intended for the appointment sheet.

## Booking entry UI (owned)

- **`NewBookingDialog`:**
  - Shows `NotifyGuestField`. The default follows the dates: no email for a stay starting before today (UTC, as on the server), with the hint "Past stays don't email the guest unless you tick this." Once staff tick or untick it, their choice is kept.
  - `notifyGuest` is always sent explicitly, so the server never applies a different default from the one shown.
  - Optional **Custom price**: stay total plus required reason, sent as `priceOverride {total, reason}`. Validation is inline.
  - **Archived villas** appear only for past stays, with a required reason, sent as `archivedVillaReason`. A prefilled archived villa is kept only when the prefilled check-in is in the past. A current stay in an archived villa shows the refusal and disables Create. `AdminBookingsView` now passes active and archived villas (never drafts).
  - While saving, Close, Escape and a second submit are blocked. A failure keeps every field and shows the error; pressing Create again sends identical arguments.
- **`AdminBookingsView`:** a drop or resize opens the new `MoveBookingDialog` instead of the generic confirm.
  - It sends `expectedRevision` captured from the calendar row at the drop. If the loaded booking's revision already differs, the dialog says it changed and disables Move. The server also refuses stale writes.
  - The email choice is shown and always sent. The default is `notifyDefault({checkIn: new check-in, guestEmailsOff})`.
  - **Custom-price recovery:** if the booking has a custom price, the dialog explains that a move needs a price for the new dates. It offers "Open booking", which opens the booking sheet where Edit sets the price or returns to the villa rate. Nothing is re-priced silently. A server refusal mentioning a custom price (a race) also shows "Open booking".
  - Pending blocks closing and repeats. A failure stays open with "Try again", which sends the same arguments.
- **Retry caveat:** `adminBookings.createBooking` has no attempt key (owned by another worker). A retry after a lost response could create a second booking. Recommended: add an optional `idempotencyKey` to `createBooking`; the dialog can then send one key per dialog.

## Payment reversal on cancelled stays (financial-delivery edge case)

- **Fixed in owned code:** `pos.voidUnreceivedOrder` now sets `refundedAt` whenever reversing a mistaken POS payment leaves a cancelled stay `refunded`. The value comes from `orderLifecycle.stayRefundedAt`: the `effectiveAt` of the stay's latest refund, else the existing `refundedAt`, else now.
- It still never changes the stay's status. A confirmed stay stays confirmed with its nights held and owes the balance again. Only an explicit cancellation cancels a stay. Both cases are tested.
- **Parent fix needed in `convex/adminBookings.ts` → `cancelPayment`.** It has the same branch (`booking.status === 'cancelled' && gross > 0 ? 'refunded'`) without `refundedAt`. Precise fix:
  1. `import { stayRefundedAt } from './lib/orderLifecycle';`
  2. In the `writeBooking` patch, add `...(paymentStatus === 'refunded' ? { refundedAt: await stayRefundedAt(ctx, booking, now) } : {})`.

## Parent fix needed in `convex/lib/stayCorrections.ts` (blocks enabling discard in the UI)

`stayCorrections` uses `!isOpenOrder(order)` to mean "an order that took money". A discarded order is neither open nor settled. Without this fix:

- `bookingFinancials.legacyOrders` lists a discarded order charging a stay as a legacy paid order, with a refundable amount. This is reproduced by the `it.fails` test in `convex/orderLifecycle.test.ts`.
- `recordRefund({billId: <discarded order>})` would accept it.

Precise fix (two lines plus the import):

- The import `{ isOpenOrder } from './orderLinks'` becomes `{ isSettledOrder }`, if nothing else in the file uses `isOpenOrder`.
- `recordStayRefund`: `if (!order || isOpenOrder(order))` becomes `if (!order || !isSettledOrder(order))`.
- `stayFinancials` legacy orders loop: `if (!order || isOpenOrder(order) || order.voidUnreceived || …)` becomes `if (!order || !isSettledOrder(order) || order.voidUnreceived || …)`.

Then change `it.fails(` to `it(` in `convex/orderLifecycle.test.ts` ("does not offer a discarded order as one that took money for the stay").

## Checkout UI integration instructions (checkout worker)

- **Orders dialog** (`OrderStrip` `FILTERS`): add `{ value: 'discarded', label: 'Discarded', empty: 'No discarded orders.' }`. Rows show `row.discarded` (when, who, reason). Opening one shows the order read-only. The amount label for `state === 'discarded'` should not read "Voided".
- **Discard action** on an open order with items:
  - Call `discardOrder` with `expectedRevision = view.order.revision` and one attempt key per attempt. Keep the key for a retry.
  - The reason is optional; no reason prompt is required.
  - After success, navigate away or show the read-only state.
- **Restore action:**
  - Call `restoreCheck` and show `conflicts`, with blocking ones first.
  - If `blocking > 0` and `rowsLeft > 0`, offer "Restore without N row(s)" (`removeConflictingRows: true`). If `rowsLeft === 0`, offer none.
  - Send `revision` from `restoreCheck`.
  - After success, show `warnings`. Changed rows display their existing `sourceIssue` with Update row; settled or gone rows with Remove.
- **Read-only discarded order** (`getOrder().discarded !== null`, `order.state === 'discarded'`): hide catalog and pay, disable customer and row controls, and show the restore entry point. `CheckoutView` must not treat `state !== 'unpaid'` as a receipt for discarded orders.
- **Fee rows** (`line.fee` set):
  - Hide the quantity stepper, discount and price override.
  - Show "service not given" from `detail`.
  - Show `sourceIssue` like other source rows, with the Remove (`updateSourceLine`) action.
- **Fixture backend:** match the contracts above, including the refusal messages, `lifecycleKey` replay, `discarded` on rows, and `discardedOrders` on `ordersForBooking`.
- **Appointment sheet** (appointment worker): for a `no_show` or `cancelled`, unpaid appointment, offer "Charge no-show fee" or "Charge late cancellation fee" with an amount (at most the price) and an optional note. Call `addAppointmentFee` and open `/admin/checkout?order=<orderId>`. List `appointmentFees`. Do not use `markAppointmentPaid` for fees.
- **`BookingOrders.tsx`:** optionally list `ordersForBooking().discardedOrders` with a link to the order.
- **Codegen:** all new functions are in the existing `pos` module. Run normal codegen at integration.

## Tests executed

- `npx vitest run convex/orderLifecycle.test.ts`: 20 passed, 1 expected fail (the stayCorrections gap above). Coverage:
  - Discard keeps rows, links, customer and snapshot history; actor, time and reason recorded.
  - Hidden from Unpaid, listed and paginated under Discarded; `ordersForBooking.discardedOrders`.
  - Stale revision, replay, repeat, bad key, paid, void and empty refusals.
  - Every edit, link, clear, settle and void refused while discarded.
  - Stay released and charged once elsewhere; `recordPayment` still refused while another open order charges it; booking deletion still refused.
  - Restore exact rows, revision bump, list movement, history, replay and stale refusal.
  - Second-copy conflict refused, then restore without the row; all-rows-conflict refusal.
  - Source edited while discarded: row restored stale, settlement refused, update then settle at the new price, booking terms untouched. Source paid elsewhere: flagged, refused, removed, then settled.
  - Archived-customer warning.
  - Legacy clear and its logging.
  - Fee: label, detail, no appointment link, replay, duplicate, fixed amount, no merging, settlement leaving the appointment no-show and unpaid, appointment history, paid-fee guard, `appointmentFees`, appointment itself still not chargeable.
  - Fee validation: zero, negative, NaN, ∞, fractional satang, above price, wrong status, prepaid; late-cancellation fee.
  - Fee after a status correction refused and removed; a new fee after a void.
  - Fee released by discard and the restore conflict.
  - Reversal on a cancelled stay sets `refundedAt` to the refund date; a confirmed stay stays confirmed.
  - Non-admin and anonymous callers refused; discard and restore actors recorded.
- `npx vitest run tests/unit/admin-booking-entry.test.ts`: 11 passed (happy-dom, real components, mocked Convex hooks). Coverage:
  - Past default off with an explicit `notifyGuest`; toggling it; future default on.
  - Custom price validation and payload.
  - Archived villa for a past stay with a reason; refused for a current stay.
  - Pending blocks Close and a second submit; failure keeps input; retry sends identical arguments.
  - Move: captured revision, explicit email choice, pending and retry with identical arguments; silent-guest default.
  - Custom-price explanation and "Open booking"; server custom-price refusal recovery.
  - Changed-meanwhile refusal; loading state.
- Adjacent suites: `pos`, `bookingCorrections`, `appointmentCorrections`, `serviceBookings`, `staffCalendarChanges`, `adminServices`, the order audit suites, `checkoutRecovery`, `customers.corrections`, `adminBookings`, `queryScale`, `listPagination`, `posPhotoReads`, `payments`, and the POS and booking UI unit suites all pass.
- Full `npx vitest run`: 146 files, 1537 passed, 1 expected fail, 1 failed. The failure is `orderAudit.test.ts` "stripe full settlement of a deposited stay", which throws "Checkout amount mismatch" from `convex/payments.ts` (the Stripe worker's uncommitted change). One file errored: `tests/unit/pos-order-lifecycle-ui.test.ts` (the checkout worker's new test) hit an unhandled rejection in its own `fixture-backend.ts`. Neither file is mine; both were in progress.
- `pnpm typecheck`: app and convex pass. The tests project's only error is in the checkout worker's new `tests/unit/pos-order-lifecycle-ui.test.ts` (it types `restoreCheck` without `undefined`).
- ESLint on every owned file: clean.
- Not run: build, browser or Playwright, deployment.

## Status of other owners' files

- The checkout worker has already started wiring `discardOrder`/`restoreOrder`/`addAppointmentFee` in `convex-backend.ts`, `fixture-backend.ts`, `OrderLifecycle.tsx`, `OrderPanel.tsx`, `OrderStrip.tsx` and `CheckoutView.tsx`. That integration is theirs to finish and verify against this contract.
- Still needed from the parent or other owners: the two fixes above (`stayCorrections.ts`, `adminBookings.cancelPayment`), the appointment-sheet fee entry point, and optionally `createBooking` idempotency and `BookingOrders` discarded links.
