# Integrated correction contract

This document supersedes earlier workers' unresolved-integration notes where explicitly listed below. Base: `09a8450`. All behavior remains subject to the final independent reviews and release checks.

## Parent integrations

- POS customer review protocol is enabled with frozen reviewed revisions and retry payloads. Customer merges run in bounded, resumable jobs; profile changes no longer scan all orders.
- `getOrder.refunds` contains discriminated `sourceType: booking | appointment` rows. The issued receipt and original tender snapshots remain unchanged. Complete financial history is provided by `orderHistoryPages`; ordinary edits use paginated `recordHistory`.
- Appointment settlement records explicit gross/refunded counters and effective payment time. An appointment refund, including a partial one, prevents unreceived-payment reversal atomically. Per-source order summaries report actual net paid/refunded, never charge refunded appointment money again.
- Provider refunds reduce net paid and waive the corresponding charge. `bookingBalance` subtracts `providerRefundWaived` only from collectible amounts; it never creates a payment or a credit. `bookingChargeTotal` reduces the POS row's chargeable price, while its deposit remains actual net received. Regression: total 200 with 50 deposit, 150 Stripe payment, 100 Stripe refund, then an extension to 250 collects only 50 at POS.
- Manually recorded Stripe returns can be linked to actual charge/refund IDs from BookingFinancials. Same-evidence retry succeeds before revision checks and writes no second event. Different IDs remain a reviewed correction, not an amount-based automatic match. Webhook reconciliation preserves its explicit-evidence requirements.
- Both stay payment-reversal callers use `stayPaymentReversalPatch`. It retains the real refund effective date and preserves actual stay occupancy. It refuses to invent an unknown legacy refund date.
- Discarded orders are not settled orders: they cannot serve as refund evidence or appear as legacy payments. They remain reachable through Orders and source histories, with contents and links retained.
- **Override to orders-delivery.md:** a plain-voided no-show fee still counts as paid money and blocks collecting a second fee. Only discarded unpaid orders or explicit unreceived-payment reversals release that guard. A void alone never represents returned money.
- Booking creation accepts an optional stable attempt key. The admin dialog sends one per creation attempt; a replay returns the original booking before checking availability and does not repeat history or notifications. Reusing a committed key with different details fails. Attempt records survive booking deletion, preventing a delayed retry from recreating a removed booking.
- Staff, service and time-off editors expose readable history. All time-off history remains discoverable after removal. Generic history supports indexed pagination across one entity type when no entity ID is supplied.
- Villa date-block creation, batch creation, edits and removals append atomic snapshots with actor, recorded time and effective dates. Editor saves/removals send the reviewed snapshot. Concurrent changes reject without releasing nights. Pending saves prevent dismissal/duplicate requests, and failures retain the draft. Removed-block history is available from Block dates.

## Audit coverage map

| Original finding | Delivered surface / evidence |
| --- | --- |
| 1, 7 | Orders discard/restore, item/clear snapshots, readable history; orderLifecycle and checkout workflow tests |
| 2, 5, B8 | Historical appointments, archived sources, status/time correction, stay reopen; appointmentCorrections and bookingCorrections |
| 3, B6, B10, B11 | Atomic booking history, creation/deletion snapshots, actors and reviewed revisions; bookingCorrections and adminBookings |
| 4, B2, B9, B15 | Independent returns and accurate balances, no accidental recollection; bookingCorrections, appointmentFinance, stripeCorrections |
| 6 | Customer editor, archive/restore, resumable reviewed merge; customers.corrections and pos-customer-corrections |
| 8, B14 | Configuration history, safe settings restoration, assignment restore and effective roster history; configurationHistory and rosterHistory |
| B1 | Custom stay prices with reason, explicit repricing on moves; bookingCorrections and admin-booking-entry |
| B3 | Tender/payer/time amendments and explicit unreceived-entry reversals; bookingCorrections, appointmentFinance, pos-payment-corrections |
| B4 | Service date and business-effective payment timestamps separate from recording/receipt time; pos-service-row-dates and finance suites |
| B5 | Explicit appointment fee rows and appointment entry point, preserving actual service lifecycle; orderLifecycle and checkout workflow |
| B7 | Explicit notification choice, historical default off; admin-booking-entry and bookingCorrections |
| B12, B13 | Past time off and pagination, direct routine Save, retained removal history; staff-time-off-dialogs and date-block-corrections |

## Retention and release notes

Historical events before this change are not reconstructed. Existing paid receipts remain immutable; corrections are displayed alongside them. Provider refunds are recorded/reconciled, not initiated by these controls. Authentication, overlap checks, valid amounts and payment concurrency remain enforced.

New optional fields and tables preserve legacy documents. The new `discarded` bill status must remain in any rollback schema while such rows exist. Keep financial validators that accept newly written method literals. Ship the reviewed-customer protocol and its checkout frontend together. No manual database migration or live transaction was run during validation. Convex code generation analyzes the functions through its codegen path and updates generated types; it does not execute the deployment finish step.

Verification at the parent integration checkpoint: 1,554 unit tests across 146 files passed, production build passed with placeholder backend settings, and 10 disconnected smoke tests passed. After repairing outdated fixture exports/catalog data, all 44 component browser tests passed. App/test typechecks passed; the backend test's unsupported Array.at call was replaced with indexed access and backend typecheck passed. Full ESLint has zero errors and two pre-existing warnings in unrelated untracked tmp/ scripts. Final review and CI outcomes are recorded separately when complete.

The final fee API integration supersedes the limitation in order-ui-delivery.md: addAppointmentFee accepts paired reviewed appointment revision and retry key. The mounted controls send both; an atomic attempt record preserves the original order/line result across source changes and lost responses, and rejects different actors or payloads. Existing callers without either field remain compatible. Backend regression covers stale review, committed replay, changed amount and different actor.
