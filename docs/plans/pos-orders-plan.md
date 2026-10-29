# Booking, Order and Customer — implementation and test plan

Approved: 29 October 2026. User requested removal of the walk-in concept, booking-linked orders, optional customer links, compact list rows, and standalone orders without a booking. Implementation by Kiro; independent audit and testing by GPT-6.1 Sol. No merge is authorized.

## Product model

- An **Order** is the persistent commercial record: permanent order number, items, pricing, payments and receipt history. Orders may exist without a booking or customer.
- A **Booking** (stay or service appointment) has a stable order relationship. Its checkout opens/reuses its active order, never a new duplicate charge. Related appointments and extras can be lines on the booking's order. Preserve source references for each charged booking/appointment.
- A **Customer** is a reusable profile. An order may link to a customer by ID; copying a name is not a relationship. Booking guest/contact details and the payer/customer are separate. Linking a customer does not overwrite the booking's guest.
- One customer may have many orders. An order's number never changes when a customer is linked or unlinked, an order is saved/reopened, or payment is recorded.
- Paid financial/receipt data is immutable. Later charges use a linked additional order; never reopen and rewrite a paid receipt. Voids/refunds preserve the audit trail.
- Remove walk-in labels, counters, preview APIs and assumptions from active UI/business logic. Legacy fields may remain optional only for a staged migration and must not drive new identities.

## UI and flows

1. Checkout identifies the order (`Order #…`, or `New order` before a record exists), booking reference and optional customer separately. Customer action: search/create/link/unlink, with no fabricated customer when absent.
2. Keep the compact full-width item list and fixed payment footer. No individual item cards.
3. Booking and appointment details expose their order and total/paid/balance, with an Open order action. Repeated opens and two-device opens reuse the same active order.
4. Replace Hold with **Save & close** and Held bills with **Orders**. Provide an operational list with Unpaid/Paid/Voided filters, order number, customer if linked, booking reference, updated date and correct remaining balance. No separate reporting dashboard requested.
5. Standalone sales use the same order and optional customer model. Booking creation is not required to sell an extra.
6. Keep deposits, manual cash/PromptPay/card/transfer, split payments, reviewed-revision safety, active Stripe-checkout conflict handling, receipt layouts and separate refund behavior.
7. Save/reopen and customer link changes must not silently re-arm an open payment confirmation. Preserve clear errors and keyboard/focus behavior.

## Implementation sequence

1. Record glossary and relationship rules; inspect every booking/appointment creation and payment path, not only the POS entry point.
2. Add order identity, explicit booking relationships and reusable customer records/queries/mutations with admin authorization and indexed lookups. Reuse existing bill storage IDs if this avoids unnecessary remapping of payments/audit history; product/API vocabulary must describe Orders.
3. Wire idempotent booking/appointment order creation/reuse and order links in detail screens. Reconcile source edits/deposits/payments/cancellations without charging twice or rewriting settled records.
4. Replace customer name copying with explicit optional customer linkage and immutable receipt snapshots. Do not automatically merge customers by matching names; handle ambiguous legacy contacts conservatively.
5. Update checkout components, Orders list, receipt labels/copy text, URLs/compatibility redirects and fixture backend. Remove active walk-in numbering and language consistently.
6. Use widen → migrate → verify → narrow for existing dev data. Prefer the existing @convex-dev/migrations component for batched, resumable, idempotent backfills. Preserve bill/order IDs, receipt numbers, payments and audit records. Keep an explicit plan for ambiguous historical multi-booking bills. No destructive data reset.
7. Complete implementation tests; independent Sol audit/test; Kiro fixes confirmed findings; focused independent recheck. Coordinator deploys to the already-authorized shared dev and performs final authenticated visual/flow QA.

## Required automated tests

| Area | Required evidence |
| --- | --- |
| Order identity | Standalone order without booking/customer; unique stable number; concurrent creation; stable across save/reopen, customer relink, different dates and payment; no active walk-in labels/counters. |
| Booking relationship | Stay and appointment creation/opening yield the correct order; repeat and simultaneous opens do not duplicate order or source charge; related appointment plus extra; one active charge allocation per source. |
| Customer | Create/search/link/unlink; same customer on multiple orders; guest and payer can differ; same-name people remain distinct; invalid customer ID and unauthorized reads/writes rejected. |
| Persistence/list | Save & close preserves items, edits and links; reload/another session resumes; Unpaid/Paid/Voided list returns correct records/balances with bounded/paginated queries and clear empty/loading/error states. |
| Source changes | Booking price/date/deposit/payment/cancellation and appointment changes detected or synchronized safely; no stale or duplicated charge; paid order never mutated; additional charges preserve original receipt. |
| Settlement | Cash/change; manual electronic tenders; split sum validation; zero due; deposits counted once; stale revision including customer-only changes; double click/idempotent retry; concurrent POS/online payment conflicts. |
| History | Paid receipt snapshot retains original customer/items/amounts despite later profile edits; void preserves number and tender/audit history; linked booking/appointment refunds remain explicit. |
| Migration | Representative legacy draft/held/paid/void rows, with/without guest, deposits and multiple source links; dry-run; idempotent rerun; stable numbers; no lost source/payment/audit records; no forced customer merge or invented booking. |
| Access | Every new admin query/mutation rejects anonymous/non-admin identities; no customer information in public catalog/booking responses. |

Run relevant tests during development, then full `pnpm typecheck`, `pnpm lint`, `pnpm test:unit --maxWorkers=2`, and `pnpm build` on the final candidate. Generate Convex API types with the CLI; never hand-edit generated output. No tests that merely assert CSS class strings.

## Required browser and visual tests

- Desktop 1440×900 and mobile390×844: standalone order, optional customer controls, compact list, editing, fixed footer, Orders list, save/reopen, booking entry and receipt.
- Include 320px narrow screen and tablet rotation checks where layout differs. Test long customer/item names, many rows and scroll containers, empty/error/loading states, keyboard tab/Enter/Escape and focus return.
- Record a real browser clip of long-list scrolling and Save & close → Orders → reopen. Capture screenshots of final desktop/mobile order UI and customer/booking links. Inspect every deliverable; label fixture versus live evidence and actual viewport.
- Authenticated shared-dev QA: synthetic standalone order without customer; customer-linked order; booking+deposit+appointment/extra; save/reload/reopen; two tabs changing an open payment; manual tender/receipt/void and stored-state verification.
- Shared-dev fixture prep must avoid notification emails, real banking operations, real guest edits and production inventory. Use uniquely labeled QA data and archived resources/historical completed records when appropriate. Void QA receipts and refund/cancel only owned fixtures after evidence capture; preserve audit history.
- Physical printers, genuine mobile touch/keyboard and real gateway/banking behavior cannot be marked passed without actual testing.

## Completion gate

Kiro reports implemented scope, exact checks and failures/limitations. Sol independently reads the actual diff, executes tests and gives reproducible findings plus an explicit completed verdict. Fix/recheck confirmed issues, update this plan/status and QA report, capture final visuals, push the reviewed candidate, and report current CI/merge readiness. Do not claim completion based solely on agents saying it works. No automatic merge.
