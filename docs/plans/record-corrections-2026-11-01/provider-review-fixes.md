# Provider/POS review fixes (Kiro scope)

PR: https://github.com/Ruckth/360-tour/pull/34. Base for this work: staged HEAD `799dfdf`, plus uncommitted concurrent repairs by the parent and Sol, which were preserved.

Findings addressed: Sol C1 from `/tmp/sol-record-corrections-review-c863f12.md`, and Kiro C1–C4 from `/tmp/kiro-record-corrections-review-c863f12.md`.

Files changed in this scope:
- `convex/payments.ts`
- `convex/bookings.ts`
- `convex/pos.ts`
- `convex/stripeCorrections.test.ts`
- the new `convex/providerReviewFixes.test.ts`
- in `convex/schema.ts`, only the booking fields `legacyStripePaymentIntentId` and `legacyStripeGross` and the index `by_legacyStripePaymentIntentId`.

`convex/orderAudit.test.ts` needed no change. Its `refunded` stale-settlement case patches a refunded flag with no amounts, and that flag still closes the stay.

## Semantics

### Full provider refund on a live stay (Sol C1, Kiro C2)
- `payments.recordRefund` sets `paymentStatus: 'refunded'` and `refundedAt` only for a **cancelled** stay whose net becomes 0.
- On a live stay (pending or confirmed), the net can reach 0 while gross is above 0. In that case:
  - `paid` becomes `pending`, the same state that reopen and payment reversal write.
  - Any other status is left unchanged.
  - `status`, nights, `amountPaid`, `amountRefunded` and `providerRefundWaived` are written as before. Occupancy is untouched.
- `bookings.isDocumentedLiveRefund(booking)` is true when all of these hold:
  - the stay is not cancelled;
  - `paymentStatus` is `refunded`;
  - both `amountPaid` and `amountRefunded` are present and equal.

  This is the state the earlier code wrote. It is treated as chargeable in three places:
  - `recordStayPayment` (manual, POS and online writers);
  - `payments.isPayable` (begin, save and complete checkout, and expiry);
  - POS `bookingClosedReason`.

  The amount that can be collected is still `total − net − providerRefundWaived`, so waived provider money is never charged again.
- A legacy `refunded` flag without `amountRefunded`, or a `failed` payment, still needs a reopen. POS now gives the real reason ("marked refunded without refund amounts; reopen it first" or "payment failed"). It no longer says "This booking was cancelled".

### POS unreceived reversal under a live checkout (Kiro C1)
- `pos.voidUnreceivedOrder` calls `assertNoLiveCheckout(booking)` for every stay during its proof phase, before any write. A live Stripe checkout refuses the whole void with `LIVE_CHECKOUT`, and nothing is written.
- After the checkout's `stripeCheckoutExpiresAt`, the void goes ahead.

### Legacy Stripe evidence (Kiro C3)
- `bookings.legacyStripeCharge(booking, hasItemisedPayments)` returns the provable pre-itemisation Stripe payment, or null. It is one of two forms:
  1. **Captured:** `legacyStripePaymentIntentId` and `legacyStripeGross` are both set.
  2. **Uncaptured:** all of these hold, and the gross is `stayMoney(booking).gross`:
     - there are no itemised payments;
     - `paymentMethod === 'stripe'`;
     - `stripePaymentIntentId` is set;
     - gross is above 0.
- `recordStayPayment` writes the captured fields when it records the stay's first itemised payment and the uncaptured form applies. It runs in the same transaction, and `legacyStripeGross` is also written to the `payment_recorded` history details. After capture, a later online payment can replace `stripePaymentIntentId` without losing the legacy identity.
- `recordRefund` finds the booking in this order:
  1. the itemised payment's PaymentIntent;
  2. `by_stripePaymentIntentId`;
  3. `by_legacyStripePaymentIntentId`.

  With no matching itemised payment, the provider gross is the legacy charge's gross only when its PaymentIntent equals the event's. Otherwise it is 0, which refuses with "Provider charge does not match". The charge amount must equal that gross to the cent.
- Ambiguous evidence is refused and writes nothing. Two cases exist:
  - itemised money written by the earlier code before any capture;
  - a PaymentIntent that was replaced and never captured.

  Nothing is inferred from amounts alone.

### Legacy completion redelivery (Kiro C4)
`payments.completeCheckout` runs these checks in order:
1. A replay by session idempotency key is a no-op when it matches exactly, and is refused otherwise. This is unchanged.
2. A PaymentIntent that is already recorded on any `bookingPayments` row is refused ("replay mismatch"), whatever session delivers it.
3. If the event's PaymentIntent is the stay's `legacyStripeCharge` PaymentIntent, an exact amount is a no-op and any other amount is refused. The session id is deliberately not compared, because a later checkout replaces `stripeCheckoutSessionId`.
4. Otherwise the normal session, payable and amount checks apply. The obsolete "Shared provider refund balance integration is required" guard was removed. `checkoutBalance > 0` implies no credit, so it equals `stayMoney().owed`, and `recordStayPayment` re-checks that through `expectedAmount`.

## Coverage

All of these run the production mutations under `convex-test`. Only pre-itemisation legacy money is seeded directly, because no current path can write it. `convex/providerReviewFixes.test.ts`:

| Finding | Case |
| --- | --- |
| Sol C1 | Seeded legacy Stripe payment of 200 on a 300 stay. A 100 balance checkout is reserved, then the original 200 is fully refunded. The completion records exactly one payment (100, `pi_balance`). Result: gross 300, refunded 200, waived 200, net 100, owed 0. Status stays confirmed and both nights are still held. Redelivered completion and refund events leave a full DB snapshot unchanged. Run twice: on the new normalized state, and on the explicit `refunded` state the earlier code wrote. |
| Kiro C1 | A stay paid in full at POS is extended by 50, and a checkout is opened for the 50. `voidUnreceivedOrder` rejects, and a snapshot of booking, payments, refunds, charges, history, bills, corrections, audit and availability is unchanged. The guest's 50 then completes. A second case shows the void succeeds once the checkout has expired. |
| Kiro C2 | Online 200, fully refunded by the provider, then extended to 250. POS charges a due of exactly 50. Result: amountPaid 250, refunded 200, waived 200, owed 0, nights held. Run on both the normalized and the earlier explicit `refunded` states. A legacy refunded flag without amounts still refuses at POS with the accurate reason. |
| Kiro C3 | Legacy Stripe 200, then a 50 extension at POS or online, then the original is refunded. It reconciles through the captured evidence: paid 50, refunded 200, owed 0, the extension entry untouched, and the refund linked to no itemised payment. A mismatched charge amount is refused. The two ambiguous-evidence cases above are refused with an unchanged snapshot. |
| Kiro C4 | An exact legacy completion redelivery is a no-op, a different amount is refused, and a forged PaymentIntent is refused. The same checks pass after a later extension session replaces the session and PaymentIntent. The extension's own redelivery is a no-op, and its PaymentIntent delivered from another session is refused. |

`convex/stripeCorrections.test.ts` updates:
- The obsolete assertion that a full provider refund marks a live stay `refunded` with `refundedAt` now expects `paymentStatus: 'pending'`, status confirmed, and no `refundedAt`.
- The refund-date test now names its itemised source payment (`paymentId`). This is required by the parent's refund-source linkage. The extra 100 is unitemised money.

Mutation checks were run by temporarily editing production code, then restoring it byte-for-byte (verified with `cmp`). Each break was caught:
- removing `assertNoLiveCheckout` failed C1;
- disabling the legacy redelivery no-op failed C4;
- dropping evidence capture failed Sol C1 (both variants), C3 (both) and C4;
- making `isDocumentedLiveRefund` false failed both "previously written refunded" variants.

## Checks run

| Check | Result |
| --- | --- |
| `npx vitest run convex` | 62 files, 911 tests, all passing |
| `npx tsc --noEmit -p convex/tsconfig.json` | ok |
| `npx tsc --noEmit -p tsconfig.tests.json` | ok |
| `npx tsc --noEmit -p tsconfig.json` | ok |
| `npx eslint` on the six owned files | ok |
| `npx vitest run tests/unit` | 691 passed, 1 failed (outside this scope) |

The `tests/unit` failure is `tests/unit/booking-calendar-events.test.ts:198`. It still expects a refunded booking to be read-only. It is caused by the parent's concurrent change to `canEditBooking` in `admin-bookings-shared.ts` (a parent-owned shared predicate), so the parent needs to update or retire that assertion.

No commit, push, install, deploy, codegen, browser run or live data was used.

## Remaining gaps
- **Cancelled stays.** A full provider refund on a cancelled stay still writes `refunded`. A reserved checkout cannot complete on a cancelled stay; this is unchanged and intended.
- **Uncaptured legacy gross.** The uncaptured form assumes all of the gross recorded on a legacy Stripe stay is that one Stripe payment. A pre-itemisation stay that mixed Stripe with an unrecorded manual deposit therefore fails the exact-amount match and refuses, which is safe. It is not reconciled automatically.
- **Evidence written before this change.** Stays that got itemised money before this deploy have no captured evidence. Their original Stripe refunds keep refusing until staff reconcile them by hand. There is no backfill.
- **Pending stays with no money.** A live `status: 'pending'` stay fully refunded by the provider becomes `paymentStatus: 'pending'`. Like the earlier `refunded` value, that is not `paid`, so `crons.expirePending` treats it as unpaid and may expire it.
- **UI not covered here.** Mounted BookingSheet Edit/Cancel on a refunded or normalized live stay, and the BookingFinancials display of the `pending` + fully refunded state, are parent-owned and not covered by these tests.
- **Real Stripe not run.** No real Stripe delivery was exercised. HTTP signature handling is covered only by the existing `stripeCorrections` webhook test.
