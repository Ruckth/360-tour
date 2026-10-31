# Order checkout QA

29 October 2026. Supersedes the earlier Hold/Resume checkout report. Implementation candidate `2d2be9a`, rebased onto main `7fe2206`. Local acceptance and shared-dev QA passed; current-head hosted CI/review remains the final readiness gate. No merge is authorized.

## Behavior

A standalone order needs neither a booking nor a customer. New bookings and appointments get an empty linked order; opening checkout adds the outstanding charge. Existing bookings obtain an order on first open. Reopening reuses the active order and does not charge the source twice. Related appointments and extras can join the order. Order numbers are permanent and separate from receipt numbers.

A customer is a reusable payer profile. Linking it never overwrites the booking guest. Paid receipts freeze the payer and therapist display names; later charges use another linked order. Legacy therapist names are frozen from the name available at migration time, with `staffNameBackfilledAt`; earlier renames cannot be reconstructed.

Items are compact full-width list rows. Editing expands a row. Totals and payment controls remain visible while long lists scroll. Narrow order headers wrap.

**Save & close replaces Hold.** Edits already persist to the server. This action leaves the order unpaid, returns to a new order, and makes it available in **Orders → Unpaid**. Reopening restores the number, items, payer and source references. Saving does not take payment, issue a receipt or reserve inventory. Orders also offers Paid and Voided filters; no separate held-bill analytics report was requested.

## Audit and automated checks

Kiro CLI implemented and fixed the feature. Independent GPT-6.1 Sol audits completed and retained regressions for migration ambiguity, legacy held pagination, query-error recovery, deposit balances, therapist snapshots, landscape forms, appointment contact discovery and customer retry handling. All F1–F8 regressions passed the stable recheck. Sol then found F9: completion of an earlier customer write could close a newer form. The coordinator fixed completion scoping to both the original order and dialog session; the original regression and a same-order close/reopen regression pass.

- Full rebased unit suite: **117 files / 1,216 tests passed**.
- Focused acceptance: **183 tests passed**. After the final event-handler refactor, all **32 customer recovery/write tests passed** again.
- Typecheck: app, tests and Convex passed.
- ESLint: zero errors; one existing warning in an untracked historical audit script under `tmp/`.
- Production build passed. The post-rebase dev server needed a fresh generated Turbopack cache after the renamed receipt route; no product-code workaround was added.
- Booking browser suite from the updated main branch: **11 passed**.
- Disconnected smoke suite: **10 passed**. Current-head hosted CI is checked after push.

## Shared-dev migration

Authorized deployment: `dev:optimistic-turtle-573`. Widened schema and code deployed; narrowing remains a separate later change.

All three backfills completed with `success`: **23 bookings**, **33 appointments**, **4 legacy orders**. Preview and dry runs completed; order verification ended with `isDone: true`, `problems: []`, no ambiguous/unlinked sources and no missing therapists. One legacy therapist display name received a timestamped snapshot.

Preservation checks retained the original baseline and verified every original booking/appointment field, settled financial field and receipt-line field, plus **5 payments and 8 audit rows**. Only explicitly allowed lookup/display fields could be added. The verifier rejects unrelated additions or edits to original fields. A reset rerun of all three migrations left every row in all six checked tables byte-for-byte unchanged.

## Authenticated browser acceptance

Real shared-dev data, synthetic fixtures only. Shared-preview authentication was confirmed. After two preview capture timeouts, Chrome was used for the live flow; the dev-cache issue was diagnosed and cleared before testing.

1. Created standalone **Order #5** without booking/customer, added a reusable payer, Save & close, reopened from Unpaid and reloaded successfully.
2. In two browser tabs, opened cash review then changed the order in the other tab. Confirmation disappeared and the UI required reviewing the updated order.
3. Added eight compact rows. Inspected desktop1440×900, mobile390×844 and320×740. Payment controls remained reachable. Recorded synthetic cash of ฿300 against ฿260 due; receipt **R-000005** shows ฿40 change.
4. Opened isolated booking **Order #6**, then attached its related appointment and reused the payer. The guest stayed unchanged. ฿1,000 stay minus ฿300 prior deposit plus ฿250 appointment produced **฿950 due**.
5. Recorded synthetic split payment: cash฿450 + PromptPay฿500. Receipt **R-000006** shows booking reference, payer, therapist, deposit and tenders. Backend reads confirm booking amountPaid฿1,000 and appointment paid฿250.
6. Voided QA receipts, preserving numbers, original lines and payments. Linked records remain paid until separate fixture refund/cancellation. Notification-queue guard was unchanged; no real money was processed.

Cleanup completed at 17:35 Bangkok: both QA receipts are void; only the owned synthetic booking was cancelled/refunded and its appointment refunded. Archived QA resources and the synthetic payer remain as labelled audit history. No real guest record or production inventory was changed. The original notification guard remained intact.

## Visual evidence

These screenshots show the real authenticated app and synthetic shared-dev records. They were inspected at capture time. The video is a real browser recording using explicitly labelled sample data; it demonstrates long-list scroll and Save & close → Orders → reopen, not server persistence.

| Evidence | State |
| --- | --- |
| [Desktop order](assets/pos-orders/desktop-standalone.jpg) | Standalone order, optional payer, compact rows and payment footer, 1440×900 |
| [Mobile list](assets/pos-orders/mobile-list.jpg) | Eight flat item rows, 390×844 |
| [Narrow list](assets/pos-orders/mobile-320-scroll.jpg) | Wrapped header and constrained scrolling list, 320×740 |
| [Booking header](assets/pos-orders/mobile-booking-header.jpg) | Order identity, source and optional payer |
| [Booking balance](assets/pos-orders/mobile-booking-deposit.jpg) | Stay + appointment, deposit deducted |
| [Cash receipt](assets/pos-orders/mobile-cash-receipt.jpg) | Received cash and change |
| [Split receipt](assets/pos-orders/mobile-booking-receipt.jpg) | Booking/payer references and two tenders |
| [Desktop receipt](assets/pos-orders/desktop-booking-receipt.jpg) | Same split settlement at desktop size |
| [Scroll/save/reopen video](assets/pos-orders/sample-mobile-scroll-save-reopen.mp4) | 20-second real browser capture, sample data |

Earlier inspected fixture evidence also covers long names, landscape844×390 customer forms, keyboard/focus, rotation, error/retry states and receipt overflow. It is retained locally under `output/pos-orders-qa/sol-final/`.

## Limits

PromptPay/card/transfer are manually recorded; no bank or card terminal was exercised. CSS viewport checks do not prove physical touch or virtual-keyboard behavior. Physical thermal printers were not tested. Extras catalog management, automatic QR generation, LINE/image receipts, VAT configuration, commissions, packages and loyalty remain outside this change.
