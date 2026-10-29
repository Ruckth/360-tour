# Order checkout QA

29 October 2026. Replaces the Hold/Resume follow-up in `pos-checkout-qa.md` for the current order model. This report is in progress; deployment and authenticated acceptance are not yet complete.

## Current behavior

A standalone order needs neither a booking nor a customer. Each new booking or appointment gets an empty linked order; opening checkout adds its outstanding charge. The order number is permanent and separate from the receipt number. Orders can charge a booking and its appointments/extras while the payer remains a separate optional customer.

Order items are compact full-width list rows on desktop and mobile. Editing expands a row. Totals and payment actions stay visible while the item list scrolls. Narrow headers wrap so the order number remains readable.

**Save & close replaces Hold.** Every edit is already saved to the server. This action leaves the order unpaid, returns to a new order, and makes the saved order easy to find in **Orders → Unpaid**. Reopening restores its number, items, customer and booking references. Saving does not take payment, issue a receipt or make a reservation. Orders also provides Paid and Voided filters; this is an operational list, not a separate analytics report.

The order's own booking and bookings charged on its rows are both displayed. An existing empty booking order is preserved when its charge is added to a standalone sale. Reopening by booking finds the active charging order without duplicating its charge.

## Verified locally

- Main implementation: 1,174 tests passed, lint had no errors, production build passed. Subsequent audits added tests; these counts are historical, not final-candidate totals.
- Independent audits found migration/source ambiguity, held pagination, appointment contact discovery, legacy deposit balance, legacy therapist snapshots and customer/search error recovery issues. Their retained regressions now pass in the coordinator's latest focused run: **52/52**.
- Full app, test and Convex typecheck passed after correcting the independent audit test types. The complete final candidate will be checked again after all edits finish.
- Actual sample-fixture browser checks: desktop1440×900, portrait390×844 and320×740, long customer/item names, compact lists, fixed payment footer, save/reopen with stable identity, payer/guest separation, deposited booking and related appointment, keyboard/focus, tablet rotation, split receipt and voided list. Audit evidence distinguishes real browser checks from happy-dom tests.
- Landscape844×390: the customer form and duplicate matches now scroll inside a viewport-limited dialog. The dialog is y16–374; Add and link is reachable at y309–349 after scrolling. The original clipped state is superseded by `output/pos-orders-qa/landscape-customer-top.png` and `landscape-customer-actions.png`.
- Real browser video: `output/pos-orders-qa/sol-final/mobile-scroll-save-reopen.mp4` (about20seconds, sample data) and the coordinator's32.9second recording in `output/pos-orders-qa/mobile-scroll-save-reopen.mp4`. Both were inspected; these are not authenticated backend transactions.

## Remaining acceptance gates

- Finish the implementation/fix run, then obtain a stable independent recheck and final full check results.
- Deploy this branch to the already-authorized shared Convex dev. Preview and dry-run both order and appointment-contact migrations; run, verify and check idempotence. Preserve all existing IDs and financial/payment/audit fields.
- Authenticated synthetic standalone/customer/booking flows, reload persistence, two-tab stale payment review, receipts, void/refund cleanup and stored-state verification.
- Capture and inspect final authenticated desktop/mobile evidence, update this report and the PR, and assess current CI/reviews. No merge is authorized.

## Evidence limits

Fixture refresh resets sample state and cannot prove server persistence. CSS viewport checks are not physical-device touch or virtual-keyboard testing. No real bank, payment terminal or printer has been tested. Legacy therapist names are snapshots of the available name at migration time, explicitly marked in storage; a name changed before migration cannot be reconstructed.
