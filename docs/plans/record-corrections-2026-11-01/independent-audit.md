# Record corrections audit: editable and removable business records

Repository: `/Users/macbook/Development/360-tour-pos-checkout` (HEAD `edabde1`, untracked `output/` and `tmp/` left untouched).
Mode: read-only. No application code changed, no dependencies installed, no commits, deploys, browsers or live data. Only this file was written.
Read first: `/Users/macbook/Development/360-tour-pos-checkout/AGENTS.md` and `/Users/macbook/Development/360-tour-pos-checkout/convex/_generated/ai/guidelines.md`.

The user's goal: staff should be able to edit or remove almost every business record, enter work they forgot to record (backdated), and every such change should leave a log entry. Every claim below is traced to UI callers, Convex mutations, schema and tests. Reproductions are inferred from source unless they appear under "Executed tests" in section (d).

Abbreviations for paths used below (all absolute):

- `POS` = `/Users/macbook/Development/360-tour-pos-checkout/convex/pos.ts`
- `LINKS` = `/Users/macbook/Development/360-tour-pos-checkout/convex/lib/orderLinks.ts`
- `BILLMATH` = `/Users/macbook/Development/360-tour-pos-checkout/convex/lib/billMath.ts`
- `CUST` = `/Users/macbook/Development/360-tour-pos-checkout/convex/customers.ts`
- `ADMB` = `/Users/macbook/Development/360-tour-pos-checkout/convex/adminBookings.ts`
- `BOOK` = `/Users/macbook/Development/360-tour-pos-checkout/convex/bookings.ts`
- `BWRITES` = `/Users/macbook/Development/360-tour-pos-checkout/convex/lib/bookingWrites.ts`
- `ADMS` = `/Users/macbook/Development/360-tour-pos-checkout/convex/adminServices.ts`
- `SLOTS` = `/Users/macbook/Development/360-tour-pos-checkout/convex/lib/serviceSlots.ts`
- `WINDOW` = `/Users/macbook/Development/360-tour-pos-checkout/convex/lib/appointmentWindow.ts`
- `APCH` = `/Users/macbook/Development/360-tour-pos-checkout/convex/lib/appointmentChanges.ts`
- `ROSTER` = `/Users/macbook/Development/360-tour-pos-checkout/convex/roster.ts`
- `SCHEMA` = `/Users/macbook/Development/360-tour-pos-checkout/convex/schema.ts`
- `STRIP` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/checkout/OrderStrip.tsx`
- `PANEL` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/checkout/OrderPanel.tsx`
- `RECEIPT` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/checkout/ReceiptView.tsx`
- `BSHEET` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/BookingSheet.tsx`
- `ASHEET` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/AppointmentSheet.tsx`
- `NEWAPPT` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/NewAppointmentDialog.tsx`
- `RESCHED` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/RescheduleDialog.tsx`
- `BORDERS` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/BookingOrders.tsx`
- `STAFFMGR` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/AdminStaffServicesManager.tsx`
- `TIMEOFF` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/AdminStaffTimeOff.tsx`
- `CAL` = `/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/AdminStaffBookingsView.tsx`

The Orders dialog in the screenshot is `STRIP:157-169` (title "Orders", description "Open an unpaid order to keep selling or take payment…") together with `OrdersBrowser`/`OrdersList` at `STRIP:513-578`.

Authorization context: there is one role. `requireAdmin` (`/Users/macbook/Development/360-tour-pos-checkout/convex/lib/adminAuth.ts:12-24`) admits any email listed in `ADMIN_EMAILS`. Every staff member who can use checkout can already do everything an owner can. Any override capability recommended below therefore goes to every admin, unless a role is introduced first.

---

## (a) Prior Sol findings: verdicts

### 1. Unpaid orders can be cleared but not removed from the Orders list. CONFIRMED, with additions.

Evidence:
- `clearOrder` deletes every line, writes a `cleared` audit row and keeps the order, its number, `bookingId`/`appointmentId` and `customerId` (`POS:1013-1023`). The UI copy says the same (`PANEL:105-106`).
- `listOrders` reads only `hasItems = true` (`POS:473-484`, index `by_hasItems_and_status_and_updatedAt` at `SCHEMA:398`), so a cleared order disappears from every filter.
- The Orders list rows are open buttons only (`STRIP:536-541`). No remove, discard or cancel control exists. The Clear button is disabled once the order is empty (`PANEL:99`).
- No backend path ends an unpaid order: statuses are `draft | held | paid | void` (`SCHEMA:353`), and `voidOrder` accepts only `paid` (`POS:1094-1106`).

Additions:
- Removing every line one at a time through `removeLine` (`POS:915-923`) also hides the order, and leaves no audit row at all.
- A cleared order keeps its customer link, so `updateCustomer` still counts it (see finding 6).
- New consequence: clearing an order permanently blocks deleting its test booking. `orderDeleteBlocker` treats an order as a deletable placeholder only if it has no lines, payments or audit rows (`LINKS:123-141`). The `cleared` audit row disqualifies it, so `deleteBooking` refuses with "This booking has an order. Cancel it instead of deleting it." (`ADMB:472-481`). Reproduction: create an admin booking, open it at checkout, clear the order, then press Delete in the booking sheet.
- The existing test `pos.test.ts:471` ("clears an order but keeps its number and links") asserts this retention as intended behaviour.

### 2. Staff cannot create historical appointments; stays can be backdated. CONFIRMED and QUALIFIED.

Appointment creation is blocked at each layer:
- UI: the date picker has `min={today}` (`NEWAPPT:218`), the slot query is skipped for past dates (`NEWAPPT:126`), and the dialog shows "Pick today or a future date." (`NEWAPPT:240`). A click on a past calendar slot is moved to today (`CAL:461-464`, also `CAL:557`, `CAL:610`).
- Slots: `openStarts` drops every past start (`SLOTS:210`).
- Mutation: `createAppointmentRecord` calls `assertAppointmentStart` (`SLOTS:283` → `SLOTS:52-55`, "Start must be a future 15-minute time"). It also requires an active service (`SLOTS:286`) and active staff (`SLOTS:290`) and rejects any roster, break or time-off gap through `staffBusyRanges`. Admin `createAppointment` (`ADMS:562-576`) shares this helper.

Rescheduling is blocked too:
- `canReschedule` allows only `booked` appointments whose start is still ahead (`WINDOW:40`). `rescheduleAppointment` enforces it plus a future start (`ADMS:609-611`), and the UI date picker has `min={today}` (`RESCHED:53, 64, 106`).

Stay backdating does exist:
- `createBooking` passes `allowPastCheckIn: true` (`ADMB:346`), and so does `editBooking` (`ADMB:397`). The UI loads past months (`/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/useAdminBookingDates.ts:38`, `allowPast: true`). Tests: `adminBookings.test.ts:614, 638, 657`.

Qualifications to the stay claim:
- A backdated stay is priced at today's rate (`calculateDirectQuote`, `BWRITES:117-119`, `ADMB:405`), and no booking field allows a different price (see B1).
- `loadProperty` requires an active villa (`BWRITES:41-43`), so a past stay in an archived villa cannot be entered.
- A backdated booking created as confirmed queues confirmation emails to the guest (`ADMB:348-353` → `BOOK:143-167`).

Separating public booking from staff corrections is feasible. The public appointment path asserts a future start on its own (`/Users/macbook/Development/360-tour-pos-checkout/convex/serviceBookings.ts:119`) before it calls the shared helper. A staff-only policy flag on `createAppointmentRecord` would therefore leave the public path strict, the same way `StayDatePolicy` works for stays (`BWRITES:107-108`).

### 3. Stay changes have no append-only history; appointment changes do. CONFIRMED and widened.

- `editBooking` patches the booking in place (`ADMB:406-422`). `updateNotes` overwrites `adminNotes` (`ADMB:540-549`). Cancel and refund are a single patch (`ADMB:293-296`). `markPaid` goes through `markBookingPaid` (`BOOK:108-140`). No change table exists for bookings.
- `updateBooking` also throws away the admin identity: it calls `await requireAdmin(ctx)` and never uses the result (`ADMB:282`). The `bookings` table has no `createdBy`, `cancelledBy` or `refundedBy` field (`SCHEMA:78-149`). Who cancelled, refunded or marked a stay paid is therefore never stored.
- Date blocks: `updateDateBlock` and `removeDateBlock` keep no actor or history (`ADMB:622-641`).
- Appointments do have history: `recordAppointmentChange` writes actor, `at` and per-field from→to (`APCH:41-58`), and `AppointmentHistory.tsx` displays it. Gaps remain: appointment creation is never logged, there is no business-effective time, refunds carry no reason or amount, and the display is capped at 50 entries (`APCH:15`).

### 4. Stay refunds are tied to cancellation; appointment refunds are not; voids keep the source paid. CONFIRMED, with refund visibility traced.

- Stays: the only way to mark a stay refunded is `updateBooking({action:'cancel', refundRecorded:true})` (`ADMB:286-296`). It always sets `status: 'cancelled'`, releases the dates and queues the cancellation email. The UI exposes only "Cancel & record refund" (`BSHEET:150, 299`) and "Cancel & refund" (`/Users/macbook/Development/360-tour-pos-checkout/src/components/admin/BookingQuickActions.tsx:123`).
  - A refund cannot be recorded without a fictitious cancellation.
  - Partial refunds are impossible, and no amount, method or reason is stored. `amountPaid` keeps the full value.
- Appointments: `refundAppointment` is independent of cancellation (`ADMS:716-724`). It covers the full amount only, takes no reason or method, and sets `refundedAt = now`.
- Voids: `voidOrder` leaves charged sources paid by design (`POS:1088-1106`; test `pos.test.ts:733` "Wrong card"). The void dialog tells staff to "record a refund on them if needed" (`RECEIPT:230-231`). For a stay, the only way to do that is to cancel it.
- Original POS history never shows a refund. `billAudit` has no refund kind (`SCHEMA:475-495`). `getOrder` and `ReceiptView` never read booking or appointment refunds. `BookingOrders` keeps listing the order as "Paid ฿X" (`BORDERS:52-63`).
- Display bug found while tracing (B9): after a stay refund, `bookingBalance` still counts `amountPaid` as paid (`BILLMATH:138-141`; `amountPaid` is never cleared at `ADMB:293-296`). The booking sheet's Orders block therefore reads "Paid ฿total · Balance ฿0" for a refunded stay.

Is the void itself corruption? I agree with Sol that it is not. Void is internally consistent. The real gap is a missing correction path (B3): a receipt issued in error (wrong tender, wrong customer, wrong guest) cannot be voided and charged again, because the stay or appointment stays `paid`. `bookingPayable` and `appointmentAttachable` then refuse it (`BILLMATH:144-146`, `POS:144-146`).

### 5. Completed, cancelled and no-show appointments cannot be corrected; cancelled stays cannot be reopened. CONFIRMED, with nuance.

- Status transitions are fixed: `completed: [], cancelled: [], no_show: []` (`ADMS:644-649`), mirrored in the UI (`ASHEET:59-66`). Cancelling is allowed only from `booked` or `arrived` (`ADMS:733`, `ASHEET:77`). An `in_service` appointment cannot be cancelled or marked no-show. A mistaken "Complete" has no undo.
- Workarounds that partly exist:
  - Guest details and notes can be edited in any status (`ADMS:697-712`).
  - Cancelled and no-show appointments can be "Booked again" as a new record (`WINDOW:46`), but only at a future time.
- Hidden API-only path: `markAppointmentPaid` checks only for `cancelled` (`ADMS:662-670`), so a `refunded` appointment can be set back to `paid` with no reason. No UI calls it this way.
- Stays: `editBooking` refuses cancelled or refunded bookings (`ADMB:378-380`), and the UI says "Cancelled and refunded bookings are read-only." (`BSHEET:309`). `markBookingPaid` refuses cancelled stays (`BOOK:116`). A web booking that expired automatically (`/Users/macbook/Development/360-tour-pos-checkout/convex/crons.ts:18-25`; `/Users/macbook/Development/360-tour-pos-checkout/convex/payments.ts:121-126`) therefore cannot be recovered if the guest arrives and pays. The only option is a new booking.

### 6. Customer editing exists in the backend only; the open-order limit gives bad advice. CONFIRMED. Severity is low; the missing editor and log matter more.

- `updateCustomer` and `getCustomer` exist (`CUST:84-141`), but nothing in `src/` calls them (grep found no callers). The checkout UI can only create, search, link and unlink customers (`/Users/macbook/Development/360-tour-pos-checkout/src/components/checkout/convex-backend.ts:35-46`).
- There is no customer archive, restore, merge or delete mutation.
- `updateCustomer` throws when a customer has more than 100 open orders in one status, telling staff to "Settle or clear some first." (`CUST:134-138`). Clearing keeps `status: 'draft'` and `customerId` (`POS:1013-1023`), so the advice cannot work. The cleared orders are also hidden from the list (finding 1), so staff cannot find them to unlink.
- Smaller defects:
  - The revision bump also changes `updatedAt` (`CUST:138`), which reorders every Unpaid list.
  - Customer edits record no actor (only `createdBy` at `CUST:111`) and keep no history.

### 7. Order audit is never shown; line edits are not logged; clear keeps no snapshot. CONFIRMED and widened.

- `getOrder` returns `audit` (`POS:426, 466`). No production component reads `view.audit` (only `fixture-backend.ts` mentions it). The Clear dialog and the price-change textarea promise an "audit log" that cannot be viewed (`PANEL:106`, `PANEL:417`).
- `addItem`, `attach`, `updateLine` (staff, start, quantity, discount) and `removeLine` write no audit (`POS:789-923`). Only price overrides, customer link and unlink, source update and removal, clear, paid and void are logged (`SCHEMA:479-489`).
- `cleared` stores no snapshot of the deleted lines (`POS:1020`), so a cleared order cannot be recovered.

### 8. Staff, services and properties can be archived and restored, but changes leave no durable log. CONFIRMED and QUALIFIED.

What exists:
- Staff: `updateStaff` with `status` (`ADMS:207-257`) and `archiveStaff` (`ADMS:259-267`).
- Services: `updateService` with `status` (`ADMS:293-321`) and `archiveService`.
- Properties: `setStatus` (`/Users/macbook/Development/360-tour-pos-checkout/convex/adminProperties.ts:225-235`).
- Time off: editable and removable (`ADMS:436-455`, `STAFFMGR:801-845`).
- Settings: `update` (`/Users/macbook/Development/360-tour-pos-checkout/convex/settings.ts:49-87`).

What is missing:
- No before/after records. Staff and services keep only `updatedAt`. Settings keep only the latest `updatedByEmail` (`SCHEMA:1275`). Time off keeps only `createdByAdminEmail` (`SCHEMA:213`), and edits and removals leave nothing.
- Roster batches are an undo buffer, not an audit log. `newBatch` schedules `pruneBatches` on every action (`ROSTER:185`, `ROSTER:629-649`), and undo deletes each item as it restores it (`ROSTER:593`, `ROSTER:618`).

Qualifications (new):
- Archiving a staff member strips them from every service (`ADMS:105-114`). Restoring does not put them back, and no snapshot records which services they had.
- Weekly patterns are not effective-dated. `makeDefault` (`ROSTER:485-523`) and `updateStaff` hours rewrite the pattern, which silently changes the plan shown for past days that have no override (`SLOTS:131-134`). "Who was rostered on 3 Oct" is not stable history.

---

## (b) Additional problems found

Severity scale: **High** means money or record correctness is wrong, or a common correction has no workaround. **Medium** means a frequent friction or audit gap. **Low** means cosmetic or rare.

| # | Severity | Problem | Source-inferred reproduction |
|---|---|---|---|
| B1 | High | **A stay's price can never be corrected, although checkout says to do exactly that.** `ATTACHED_PRICE` says "Change the price on the booking itself, then update the row." (`POS:80`, used at `POS:881, 896`), and the panel says "edit the booking" (`PANEL:374`). `editBooking` has no price argument and re-quotes only from today's villa rate (`ADMB:363-427`). No other mutation writes `bookings.total` (grep of `ctx.db.patch(booking…` calls). | Negotiated rate: create a stay, open checkout, try a discount → refused. Open Edit booking → no price field. A backdated stay keeps today's price. |
| B2 | High | **A shortened paid stay cannot be partly refunded.** `editBooking` freezes `amountPaid`, and the dialog shows "Credit ฿X" (`BSHEET` EditBookingDialog, `admin-bookings-shared.ts:54-59`). The only refund path is full cancellation (`ADMB:286-296`). | Paid 3-night stay, guest leaves after 2 nights: edit check-out → "Credit ฿10,000" with no way to record it. |
| B3 | High | **A wrong tender, customer or payment cannot be fixed for stays or appointments.** After `voidOrder` the source stays paid (`pos.test.ts:733`). Opening the booking again creates an empty follow-up order with no stay row, because `bookingPayable` is false (`POS:735-746`, `BILLMATH:144-146`). An appointment is no longer attachable. A manual "Mark paid" has no reversal either: stays (`ADMB:301-306`) and appointments (`ADMS:662-670`) can only be undone with a fictitious refund or cancellation. | Charge a stay by card when the guest paid cash → void "Wrong card" → there is no way to charge the stay again as cash. |
| B4 | High | **No business-effective time anywhere.** `settleOrder` stamps `paidAt = now` (`POS:1083`). `billPayments.createdAt` is the only payment time (`SCHEMA:463-473`). `markBookingPaid` uses `paidAt = now` (`BOOK:127`). Appointments have no `paidAt` at all (`SCHEMA:254-318`). `appointmentChanges` and `billAudit` store only the recording time. The POS service-row time picker sets the time on today's date (`PANEL:324-330`). | Monday's cash massage entered on Tuesday: the receipt, payment and row time all say Tuesday. |
| B5 | Medium | **No-show or late-cancellation fees cannot go through checkout.** `appointmentAttachable` and `openSourceOrder` reject `no_show` (`POS:144-146, 751-753`). "Mark paid" on a no-show records the full price with no method or receipt (`ADMS:662-670`; `ASHEET:142`). | Charge a ฿500 fee on a ฿1,500 no-show: impossible. The only option marks ฿1,500 paid with no receipt. |
| B6 | Medium | **Booking deletion is permanent and keeps no snapshot.** `deleteBookingRecord` hard-deletes the booking and silently unlinks up to 50 appointments (`ADMB:451-469`). The cleanup batch deletes up to 100 at once, including old cancelled web bookings (`ADMB:516-538`). | Delete a cancelled booking: the cancellation, guest and dates are gone, and its appointments lose their stay link. |
| B7 | Medium | **Corrections email the guest.** Creating a confirmed booking queues confirmation emails (`ADMB:352`). Editing dates emails the guest (`ADMB:424-426`). Cancelling queues a cancellation email (`ADMB:297`). There is no "don't notify" option. | Enter last week's walk-in stay as confirmed → the guest receives a confirmation for a finished stay. |
| B8 | Medium | **Archived staff, services and villas block historical entry.** Creating an appointment requires an active service and staff (`SLOTS:286, 290`). POS `addItem` requires an active service (`POS:795-797`). `updateLine` requires active staff (`POS:862`). Backdated stays require an active villa (`BWRITES:41-43`). | A therapist who left last week cannot be credited with last Friday's work. |
| B9 | Medium | **A refunded stay shows as paid.** `BookingOrders` uses `bookingBalance`, which counts the retained `amountPaid` (`BILLMATH:138-141`, `POS:540`). The paid POS order stays "Paid" (`BORDERS:52-63`). | Mark a stay paid → Cancel & record refund → the sheet shows "Paid ฿total". |
| B10 | Medium | **Creation and payment actors are missing.** Bookings have no `createdBy`; only the placeholder order's `createdBy` hints at it (`BWRITES:122-155`). Appointment creation leaves no history row, and the UI says "No changes since it was booked." `markBookingPaid` keeps the first `paymentMethod` forever (`BOOK:130`), so mixed Stripe-deposit-plus-POS payments show only "stripe". | Ask who entered booking X, or who marked it paid: the data cannot say. |
| B11 | Medium | **Several edits lack optimistic concurrency.** `editBooking`, `updateBooking`, `updateNotes`, `updateAppointmentStatus`, `markAppointmentPaid` and `refundAppointment` take no expected revision, and bookings have no `revision` field. A correction log needs a reliable "before" value and protection against two devices writing at once. | Two devices edit the same booking: the last write wins silently. |
| B12 | Medium | **Past time off cannot be entered in the UI, and ended time off is hard to find.** `min={today}` (`TIMEOFF:240`, `STAFFMGR:565`) blocks past dates, although the backend allows them (`ADMS:115-117`). `listTimeOff` returns only entries not yet ended (`ADMS:393-405`), and the list is titled "Upcoming time off" (`STAFFMGR:770`). Ended entries are reachable only by finding them on the calendar. | Record yesterday's sick day: the date picker refuses it. |
| B13 | Low | **Routine time-off edits ask for a second confirmation.** After Save, a "Confirm time off change?" dialog appears (`STAFFMGR:831-835`). This is the needless-dialog pattern the user asked to avoid. | Change a label from Leave to Sick → two clicks plus a dialog. |
| B14 | Low | **Restoring archived staff loses their service assignments, and pattern edits rewrite past roster days** (see finding 8 qualifications). | Archive and restore a therapist → they offer no services. |
| B15 | Low | **Hidden API-only state changes.** `markAppointmentPaid` can move `refunded → paid` with `refundedAt` still set (`ADMS:662-670`). | Only reachable by calling the API directly. |

Objections to the prior recommendations:
- Do not "allow editing paid or void orders". Paid rows and receipts are deliberately frozen (`LINKS:12-13`, `POS:93-106`). Issued receipt numbers must not change. Make corrections as new documents: void, then charge again, or record a linked refund.
- Do not make a refund a status flip on the source. It needs its own record with amount, method, effective time and idempotency key, linked to the order that took the money.
- Do not turn every check into an override. Overlap of villa nights, one therapist in two appointments at once (for current and future time), source-on-one-open-order, tender totals, revision checks and Stripe states are integrity rules, not policy. The table below separates the two.
- Do not attach a "reason" dialog to every edit. Ask for a reason only when a policy is overridden or money is reversed. For reversible edits, prefer an undo action to a confirmation dialog.

Essential rules versus overridable policies:

| Keep as hard errors | Make warnings or reason-gated overrides for staff corrections |
|---|---|
| Admin authentication (`requireAdmin`) | Start must be in the future (`SLOTS:52-55`), for staff-entered past work |
| `settleOrder` idempotency key, `expectedDue` and `expectedRevision` (`POS:1031-1050`) | 15-minute grid for past records |
| Paid and void orders immutable; receipt numbers never reused (`POS:93-106`, `LINKS:30-37`) | Roster, break and time-off coverage for past entries (`staffBusyRanges`) |
| A source on at most one open order (`LINKS:51-63`, `assertNotOnOpenOrder`) | Archived staff, service or villa for dates before archiving |
| Villa night overlap (`blockBookingDates`) | Status transition table (`ADMS:644-649`) and cancel only from booked/arrived (`ADMS:733`) |
| Therapist overlap for current and future times | Reschedule only upcoming booked appointments (`WINDOW:40`) |
| THB-only orders; paid stay cannot change currency (`ADMB:386-389`) | Today's-rate pricing for stays (B1) |
| Live Stripe checkout locks; Stripe-paid money never "un-paid" (refund only) | Time off must not overlap past appointments that are still marked booked (`ADMS:119-136`) |
| Tender validation (`BILLMATH:110-130`) | 60-day time-off limit, 100-open-orders limit (implementation limits; fix them rather than override) |

Therapist overlap in the past is a judgement call. I recommend blocking it by default and allowing "record anyway" with a required reason, which also flags the conflicting record. One of the two records must be wrong.

---

## (c) Implementation plan, in priority order

Shared foundation (step 0, do first):
- Add an additive, append-only `recordChanges` table: `entityType`, `entityId`, `at` (recorded time), `effectiveAt` (business time, defaults to `at`), `actor`, `kind`, optional `reason`, `changes: [{field, from, to}]` and an optional bounded `snapshot` for removals. Index it `by_entityType_and_entityId_and_at`.
- Keep `appointmentChanges` and `billAudit` as they are, adding optional `effectiveAt` and `snapshot` fields and new kinds. This avoids migrating existing history.
- Write each change row in the same mutation as the change, so Convex transactions make the two atomic.
- One helper, like `recordAppointmentChange`, computes the diff, so call sites cannot forget it.
- Rollback caveat: adding union literals (new statuses or kinds) works only going forward. If the code is rolled back while documents hold a new literal, schema validation fails on deploy. Either keep the literals in the rolled-back schema or migrate those documents first. Optional fields are safe to roll back.
- History starts at deploy time. The UI should say "History recorded since <date>" rather than imply completeness.

P0, money and record correctness:
1. **Refunds as their own records** (fixes findings 4 and B2, B9).
   - New `refunds` table: `source` (booking or appointment), optional `billId` and `paymentRefs`, `amount`, `method`, `effectiveAt`, `reason`, `actor`, `idempotencyKey`.
   - `recordRefund` validates `amount ≤ net paid` (paid minus earlier refunds) and records a refund only; no money moves. Copy must say plainly that recording a refund does not return money (the existing appointment copy at `ASHEET:119` already does).
   - The payment state of a stay or appointment becomes `refunded` only when fully refunded. Change `bookingBalance` to net out refunds and clear the B9 display bug. Re-test `bookingPayable` so a refund after a shortened stay does not reopen a balance.
   - Show refunds in `getOrder`, the receipt screen (as a note, without changing the printed receipt) and `BookingOrders`.
   - Cancelling a paid stay offers "keep payment", "record refund (amount)" or "cancel later". The forced coupling at `ADMB:286-288` goes away.
2. **Payment corrections** (fixes B3).
   - `voidOrder` gains an option to reopen charged items. In one transaction it voids the order and returns each charged source to its state before checkout:
     - Appointments: `paymentStatus: unpaid` and the price from the `payment` change row's `from` value.
     - Stays: `amountPaid` minus this order's charged amount, and `paymentStatus` back to `pending` when nothing else is paid. Keep any Stripe deposit.
   - It records changes on both sides and bumps revisions. A new order can then charge the sources again (set `parentOrderId` to point at the voided order).
   - It refuses when a source is on another open order, or when the money moved through Stripe.
   - Add `reversePayment` for manual "Mark paid" on stays and appointments, with a required reason. Allow it only when no non-void POS order charged the source and no Stripe payment exists.
3. **Booking price correction** (fixes B1). Add an optional `priceOverride {total, note, by, at}` to bookings, set through `editBooking` with a required note. `bookingLine` already compares `booking.total`, so open rows become "changed" and `settleOrder` stays safe (`POS:195-207`). Keep the currency rule.
4. **Booking change log** (fixes finding 3 and B10, B11). Log create, edit, notes, confirm, markPaid, cancel, refund, reopen, and deletion (with a full snapshot). Add `revision` to bookings, with `expectedRevision` on `editBooking`, `updateBooking` and `updateNotes`. Store the actor. A Notes edit gets no confirmation dialog.

P1, entering past work:
5. **Staff historical appointments** (fixes finding 2 and B8).
   - Admin-only `recordPastAppointment` (or a `historical` policy flag on `createAppointmentRecord`; `serviceBookings.ts:119` keeps the public path strict).
   - Start in the past within a configurable window. Status defaults to `completed`; payment stays `unpaid`, so checkout can still charge it (`POS:144-146` already allows completed and unpaid).
   - Archived staff or service allowed for dates before archiving.
   - Roster, break and time-off gaps become warnings. Therapist overlap is blocked unless overridden with a reason.
   - No guest messages. A `created` history row with `effectiveAt`.
   - Allow past and non-booked rescheduling under the same rules.
6. **Status corrections** (fixes finding 5).
   - `correctAppointmentStatus`: any status to any status with `expectedRevision` and a reason. Moving into a status that occupies the therapist's time re-checks overlap for current and future times.
   - `reopenBooking`: re-holds the nights through `blockBookingDates`, which stays a hard check. A refunded stay reopens as unpaid while its refund records remain. Recovery of auto-expired web bookings uses the same path.
7. **POS records** (fixes findings 1, 7 and B4, B5).
   - Add an order status `discarded` for unpaid orders. Keep the lines, so a discarded order can be restored. `isOpenOrder` excludes it, so its sources are released automatically.
   - Restore re-checks `openOrderCharging` for each source and flags conflicting rows instead of charging anything twice.
   - Add a Discarded filter and remove/restore actions to the Orders dialog (`STRIP:507-578`). No reason prompt for discarding.
   - Make `clearOrder` write a snapshot row per line, or replace it with discard.
   - Audit `addItem`, `attach`, `updateLine` (before and after) and `removeLine` (with snapshot). Taps on the quantity stepper can be grouped in the display rather than merged in storage.
   - Show order history in `OrderPanel` and `ReceiptView`, with pagination beyond the current `take(50)` (`POS:426`).
   - Add a service date to POS rows (not just a time), and `receivedAt` on `billPayments` as the business-effective time. Keep `paidAt` and the receipt timestamp as the actual issue time.
   - Allow a no-show fee as a priced row linked to the appointment, while keeping the original appointment as it is.
8. **Customers** (fixes finding 6).
   - A customer sheet in checkout using `updateCustomer` and `getCustomer`, logged in `recordChanges`.
   - Archive and restore (hide from search, keep links).
   - Merge: point `bills.customerId` at the kept profile in scheduled batches with progress recorded. Receipts keep their `customerSnapshot`.
   - Bump only open orders with `hasItems = true` and without touching `updatedAt`. Remove the misleading "clear" advice, or count only orders with items.

P2, configuration history and friction:
9. Log before and after values to `recordChanges` for staff, services, properties, settings, time off, date blocks and roster edits. Snapshot service assignments on staff archive and offer to restore them. Undo batches may still be pruned, because the log becomes the history.
10. Effective-dated weekly patterns (versions with an `effectiveFrom` date), so past roster days stop changing. Defer unless payroll or reporting depends on it.
11. UI fixes:
    - Allow past dates in time-off add.
    - Add a Past tab for time off.
    - Remove the second confirmation on time-off edits.
    - Add a "Notify guest" toggle on booking create, edit and cancel, default off for past dates.
    - Show creation in appointment history.

Tests to add with each step (convex-test, following the existing `pos.test.ts` style):
- Void with reopen, then charge again, for a stay, a stay with a Stripe deposit, and an appointment.
- Partial and full refunds, plus refund idempotency on retry.
- Stay price override flags an open row as changed.
- Discard, then restore after a competing order charged the same source.
- Historical appointment with an overlap override.
- Status correction that occupies time.
- Reopening a cancelled stay against a conflicting stay.
- Customer merge in batches.
- Rejection of non-admin callers for every new mutation (as `pos.test.ts:910` does).

---

## (d) Coverage and uncertainty

Read in full or in the relevant ranges:
- Backend: `POS`, `LINKS`, `BILLMATH`, `CUST`, `ADMB`, `BOOK`, `BWRITES`, `ADMS`, `SLOTS`, `WINDOW`, `APCH`, `availabilityWrites.ts`, `adminAuth.ts`, `crons.ts` (pending expiry), `payments.ts` (expiry), `settings.ts` (update), `adminProperties.ts` (status, delete), and `ROSTER` (cells, batches, undo, prune, makeDefault).
- Schema: the tables for bookings, staff, services, time off, roster, appointments, change history, bills, customers, billLines, billPayments, billAudit, dateBlocks, availability and siteSettings.
- UI: `STRIP`, `PANEL`, `RECEIPT`, `backend.tsx`, `convex-backend.ts`, `BSHEET`, `admin-bookings-shared.ts`, `useAdminBookingDates.ts`, `BookingDatePicker.tsx` (range picker), `BORDERS`, `ASHEET`, `AppointmentHistory.tsx`, `NEWAPPT`, `RESCHED`, `TIMEOFF`, and parts of `STAFFMGR`, `CAL` and `StaffRosterView.tsx`.

Not reviewed in depth: chat and AI flows (except the guest cancellation path), email templates, iCal and OTA sync, the property editor UI, `migrations.ts`, `PayPanel.tsx` and the Playwright suites.

Executed tests. These are existing tests only, nothing was modified, and the git status before and after was identical.
1. `npx vitest run convex/pos.test.ts convex/adminBookings.test.ts convex/adminServices.test.ts convex/staffCalendarChanges.test.ts convex/roster.test.ts convex/serviceSlots.test.ts convex/checkoutRecovery.test.ts convex/orderAudit.test.ts convex/settings.test.ts`: 9 files, 256 tests passed.
2. `npx vitest run tests/unit/pos-checkout.test.ts tests/unit/pos-order-line-editing.test.ts tests/unit/pos-customer-order-switch.test.ts tests/unit/pos-order-recovery.test.ts tests/unit/schedule-changes.test.ts tests/unit/staff-booking-helpers.test.ts tests/unit/staff-time-off.test.ts`: 7 files, 57 tests passed.

In total, 16 files and 313 tests passed. They overlap heavily with what earlier reviewers ran. Several of them confirm current behaviour that this report calls a gap: `pos.test.ts:471` (clear keeps links), `pos.test.ts:733` (void leaves the stay paid), `adminBookings.test.ts:161` (refund requires cancellation) and `adminServices.test.ts:164` (terminal statuses are final). No test covers the new scenarios B1–B15, the cleared-order deletion blocker, or the refunded-stay "Paid" display. Those are inferred from source and not run. No browser verification was done.

Uncertainties:
- Legal and accounting rules for Thai receipts and credit notes are not modelled in the repo. Whether a refund needs its own numbered document is a business decision.
- The right window for past entries (for example 30 or 90 days) and whether past therapist overlaps may be overridden are product decisions.
- The amount to restore on reopen after a void, for stays that mixed a Stripe deposit with POS payment, needs a worked design. `amountPaid` is a single number, and the per-order split must be derived from `billLines.deposit` and the order total.
- With one admin role, "authorization" for overrides is all or nothing. Adding an owner role is out of scope, but it would be the natural gate for payment reversals.
