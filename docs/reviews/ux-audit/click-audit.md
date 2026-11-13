# Staff admin click audit (measured)

Branch `ux/click-audit`, from `feat/pos-partial-refunds-ui` at `2a08d77`. Measured on 12 Nov 2026 in headless Chromium against the offline browser fixtures. No product code was changed.

The owner's goal is fewer clicks and less to read per component and per page. This document counts both on real paths. Other reviews cover the code; this one reports what a person has to do on screen.

## How it was measured

- Viewports: iPad landscape **1180×820** and phone **390×844**.
- Scripts: [tasks.audit.ts](../../../tests/browser/ux-audit/tasks.audit.ts) drives the tasks, [components.audit.ts](../../../tests/browser/ux-audit/components.audit.ts) counts per component, and [measure.ts](../../../tests/browser/ux-audit/measure.ts) holds the counters. To rerun: `pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts`. Files end in `.audit.ts`, so the normal browser run skips them.
- Fixtures: `staff-roles.html` (checkout, receipts, refunds and approvals by role, Settings › Team), `checkout.html` (link appointment), `index.html` (new booking and new appointment dialogs). Marketing has no coupon-builder fixture, so I added an audit-only one, [coupon-fixture.tsx](../../../tests/browser/ux-audit/coupon-fixture.tsx). It renders `CouponEditor` the way `MarketingCouponScreen` does for `/coupons/new`.
- Every action goes through a recorder:
  - **Tap**: a click or tap. Opening a native `<select>` and picking from it counts as 2 taps.
  - **Field**: one text field filled.
  - **Key**: Enter to apply a coupon, Escape to close a panel. On a touchscreen these are the keyboard's Go key and a tap on ✕.
  - **Decision**: a step where the person picks one option out of several. The number in brackets is how many controls were on screen at that moment.
  - **Scroll**: the target was outside the viewport, or clipped by its scroll container, before the action.
- **Controls on screen** counts the visible buttons, links, inputs, selects, tabs, radios and summaries inside the viewport. A control nested in another control counts once.
- **Words on screen** counts the words in visible text boxes inside the viewport. "On the page" adds what is reachable by scrolling. Screen-reader-only text is left out.
- Raw data is in [results/](results/): one JSON file per task and viewport, `components.json`, and `dump-*.txt` lists of every control with its y position. Screenshots are in [screens/](screens/).

Limits:

- Tasks start on the page where the work happens. Reaching that page through the admin navigation is not counted; each task notes the extra taps it would take.
- **h. New appointment** could not be finished. The fixture passes no staff and no open times, so `Book appointment` stays disabled. It is measured up to the guest name.
- **h. New booking** opens with check-in and check-out already filled in, as they would be after a calendar selection.
- **c and e2** run the cashier and the manager on the same till by switching roles (`window.fixture.setRole`). On the phone, the open order sheet covers the header's Approvals button. The manager first had to close the sheet with Escape, and that press is **not** counted.

## Summary: today's counts

| Task | iPad taps · fields · keys | Phone taps · fields · keys | Scrolls (iPad / phone) | Controls on screen at start (iPad / phone) | Words on screen at start (iPad / phone) |
|---|---|---|---|---|---|
| a. Cashier sells 1 service, cash | 4 · 0 · 0 | 5 · 0 · 0 | 0 / 0 | 29 / 21 | 93 / 61 |
| b. 2 services + coupon, card | 5 · 1 · 1 | 6 · 1 · 1 | 0 / 0 | 29 / 21 | 93 / 61 |
| c. Over-limit discount → manager approves | 6 · 2 · 1 (cashier 4 · 2 · 0, manager 2 · 0 · 1) | 7 · 2 · 1 | 1 / 0 | 32 / 21 | 103 / 62 |
| d. Print the receipt after payment | 1 · 0 · 0 | 1 · 0 · 0 | 0 / 0 | 14 / 9 | 133 / 82 |
| e. Refund one line (manager) | 2 · 1 · 0 | 2 · 1 · 0 | 1 / 0 | 14 / 10 | 145 / 83 |
| e2. Refund one line (cashier asks, manager approves) | 4 · 1 · 1 | 4 · 1 · 1 | 1 / 0 | 14 / 10 | 148 / 84 |
| f. Link an appointment after payment | 3 · 1 · 0 | 3 · 1 · 0 | 0 / 0 | 15 / 10 | 133 / 83 |
| g. Correct the payment method | 4 · 1 · 0 | 4 · 1 · 0 | 1 / 2 | 14 / 10 | 132 / 80 |
| h1. Staff villa booking | 3 · 2 · 0 | 3 · 2 · 0 | 1 / 1 | 11 / 12 | 73 / 73 |
| h2. Staff appointment (incomplete, see above) | 2 · 2 · 0 | 2 · 2 · 0 | 0 / 0 | 10 / 10 | 78 / 65 |
| i. Invite a cashier + set the discount limit | 3 · 2 · 0 | 3 · 2 · 0 | 1 / 1 | 24 / 19 | 50 / 42 |
| j. Create a coupon | 2 · 2 · 0 | 2 · 2 · 0 | 0 / 1 | 16 / 8 | 197 / 94 |

The task paths are already short. Most tasks take 2–6 taps, and the money flows keep their protections. The weight sits elsewhere:

- The checkout shows **29–38 controls** on an iPad at all times.
- The receipt shows **133–148 words** before anyone acts.
- The coupon builder has **332 words** on the page for a 4-step task.
- Several primary buttons sit just below the fold, which costs a scroll: `Record refund`, `Send request`, `Create booking`, `Save rules`, and the discount field on iPad.

## Per task

### a. A cashier sells one service, paid by cash

`staff-roles.html?role=cashier`, new order.

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Thai massage 60 tile | tap · decision (29 controls) | tap · decision (21) |
| 2 | Open the order sheet | — | tap |
| 3 | Cash | tap · decision (32) | tap · decision (11) |
| 4 | Exact | tap | tap |
| 5 | Confirm cash | tap | tap |

- Totals: iPad 4 taps, phone 5 taps. No fields or scrolls.
- Receipt afterwards: 14 controls and 137 words on screen (iPad); 9 controls and 82 words (phone).
- `Cash received` opens empty (`useState("")` at [PayPanel.tsx:370](../../../src/components/checkout/PayPanel.tsx)), so `Confirm cash` stays disabled until `Exact` is tapped. For an exact cash sale, `Exact` is one tap of pure ceremony.
- Screens: [iPad start](screens/a-cash-sale-ipad-00-start.png), [cash panel](screens/a-cash-sale-ipad-02-cash-panel.png), [receipt](screens/a-cash-sale-ipad-03-receipt.png), [phone order sheet](screens/a-cash-sale-phone-01-order.png), [phone receipt](screens/a-cash-sale-phone-03-receipt.png).

### b. Two services, a coupon, paid by card

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Thai massage 60 tile | tap · decision (29) | tap · decision (21) |
| 2 | Foot spa 45 tile | tap · decision (29) | tap · decision (21) |
| 3 | Open the order sheet | — | tap |
| 4 | Add coupon | tap | tap |
| 5 | Coupon code `DCNT-SPA-500` | field | field |
| 6 | Enter to apply | key | key |
| 7 | Card | tap · decision (33) | tap · decision (12) |
| 8 | Confirm ฿1,300 received | tap | tap |

- Totals: iPad 5 taps, 1 field, 1 key. Phone 6 taps, 1 field, 1 key.
- With the coupon applied: 33 controls and 133 words on screen (iPad). The coupon chip carries a 15-word description under the code.
- Screens: [coupon applied (iPad)](screens/b-two-services-coupon-card-ipad-02-coupon-applied.png), [card panel](screens/b-two-services-coupon-card-ipad-03-card-panel.png), [phone with coupon](screens/b-two-services-coupon-card-phone-02-coupon-applied.png).

### c. A cashier discount over the limit → ask a manager → the manager approves

`?role=cashier&scenario=spa`. The cashier limit is 10%, and the cashier gives 15% on ฿1,200.

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Open the order sheet | — | tap |
| 2 | Open the Thai massage row | tap | tap |
| 3 | `%` instead of `฿` | tap · decision (38) · **scroll first** | tap · decision (22) |
| 4 | Discount 15 | field | field |
| 5 | Ask manager | tap | tap |
| 6 | Reason | field | field |
| 7 | Send request | tap | tap |
| 8 | Manager: Approvals | tap | tap |
| 9 | Manager: Approve | tap · decision (4) | tap · decision (4) |
| 10 | Manager: close Approvals | key | key |

- Totals: iPad 6 taps, 2 fields, 1 key, 1 scroll. Phone 7 taps, 2 fields, 1 key.
- The cashier's share on iPad is 4 taps and 2 fields. The manager's share is 2 taps and 1 key.
- With the row open, the iPad shows 38 controls and 112 words on screen (45 controls on the page).
- On iPad the rows area between the order header and the totals is only about 230 px tall. Opening the row shows Therapist, Date and Time, and pushes Discount below the fold. That is a surprise scroll inside a small scroller ([row open](screens/c-discount-over-limit-approval-ipad-01-row-open.png)).
- The discount unit defaults to `฿`, so a percentage costs one extra tap.
- `Ask manager` opens a second form, and its `Send request` is another tap.
- Screens: [over the limit](screens/c-discount-over-limit-approval-ipad-02-over-limit.png), [waiting](screens/c-discount-over-limit-approval-ipad-03-waiting.png), [approvals sheet](screens/c-discount-over-limit-approval-ipad-04-approvals.png), [phone row open](screens/c-discount-over-limit-approval-phone-01-row-open.png).

### d. Print the receipt after payment

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Print | tap · decision (14) | tap · decision (9) |

- Totals: 1 tap at both sizes. Print is the first action on the receipt.
- The cost is what surrounds it. The toolbar has 6 controls: `58 mm`, `80 mm`, `Print`, `Share`, `Copy` and the `Print setup for 80 mm paper` disclosure. The page has 133 words on screen.
- Screens: [iPad](screens/d-print-receipt-ipad-00-start.png), [phone](screens/d-print-receipt-phone-00-start.png).

### e. Refund one line

The receipt is ฿1,800, paid by card.

**Manager** (`?role=manager&scenario=refund`):

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Refund Foot spa 45 | tap · decision (14) | tap · decision (10) |
| 2 | Reason | field | field |
| 3 | Record refund | tap · **scroll first** | tap |

- Totals: 2 taps and 1 field. The amount (what is left on the line) and the method are prefilled, which works well.
- On iPad the form opens inside the receipt paper, and `Record refund` lands below the 820 px fold ([form](screens/e-refund-one-line-manager-ipad-01-form.png)).

**Cashier asks** (`?role=cashier&scenario=refund`):

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Refund Foot spa 45 | tap · decision (14) | tap · decision (10) |
| 2 | Reason | field | field |
| 3 | Send request | tap · **scroll first** | tap |
| 4 | Manager: Approvals | tap | tap |
| 5 | Manager: Approve | tap · decision (4) | tap · decision (4) |
| 6 | Manager: close Approvals | key | key |

- Totals: 4 taps, 1 field, 1 key. The cashier's share is 2 taps and 1 field; the manager's is 2 taps and 1 key.

### f. Link an appointment after payment

`checkout.html?scenario=unscheduled-paid`.

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Link appointment | tap | tap |
| 2 | Review SVC-0002 | tap · decision (4) | tap · decision (4) |
| 3 | Reason (required) | field | field |
| 4 | Confirm link | tap | tap |

- Totals: 3 taps and 1 field.
- The candidate list held exactly **one** appointment: same service and same customer. Even so, the person has to tap `Review` before the review screen appears ([candidates](screens/f-link-appointment-ipad-01-candidates.png), [review](screens/f-link-appointment-ipad-02-review.png)).

### g. Correct the payment method

A sale recorded as cash was really PromptPay.

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Correct payment recording | tap | tap · **scroll first** |
| 2 | Method (open) | tap | tap |
| 3 | PromptPay QR | tap · decision (4) | tap · decision (4) |
| 4 | Reason | field · **scroll first** | field · **scroll first** |
| 5 | Save recording correction | tap | tap |

- Totals: 4 taps, 1 field. Scrolls: 1 on iPad, 2 on phone.
- The open form has **11 controls**: date-time, method, amount, cash handed over, `Add recorded payment`, customer search, `Keep current customer`, `No named customer`, reason, `Close correction` and `Save recording correction`.
- With the form open, the page holds 25 controls and 178 words ([form](screens/g-correct-payment-method-ipad-01-form.png), [after](screens/g-correct-payment-method-ipad-03-done.png)).
- Changing only the method needs one of those 11 controls plus the reason.

### h. Create a staff booking or appointment

**Villa booking** (`NewBookingDialog`, dates prefilled):

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Villa (open) | tap | tap |
| 2 | Garden Villa | tap · decision (3) | tap · decision (3) |
| 3 | Phone | field | field |
| 4 | Guest name | field | field |
| 5 | Create booking | tap · **scroll first** | tap · **scroll first** |

- Totals: 3 taps, 2 fields, 1 scroll at both sizes.
- The footer (`Block these dates instead`, `Close`, `Create booking`) sits below the fold even on iPad.
- The dialog has two Close buttons: the ✕ in the corner and `Close` in the footer.
- Screens: [start](screens/h1-staff-villa-booking-ipad-00-start.png), [filled](screens/h1-staff-villa-booking-ipad-01-filled.png).

**Appointment** (`NewAppointmentDialog`): service (open) → search → pick → guest name. That is 2 taps and 2 fields up to the point the fixture allows ([filled](screens/h2-staff-appointment-ipad-01-filled.png)). The time and staff parts could not be measured.

### i. Invite a cashier in Settings › Team and set the discount limit

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Invite | tap | tap |
| 2 | Email | field | field |
| 3 | Send invite | tap | tap |
| 4 | Discount without approval | field | field · **scroll first** |
| 5 | Save rules | tap · **scroll first** | tap |

- Totals: 3 taps, 2 fields, 1 scroll.
- The invite role already defaults to Cashier, which saves a pick.
- Reaching this page from the app is 2 more taps: Settings, then the Team tab.
- On the phone, Team is the 6th tab and starts off screen: only 4 of the 6 tabs are visible at 390 px.
- Screens: [invite form](screens/i-invite-cashier-and-limit-ipad-01-invite-form.png), [saved](screens/i-invite-cashier-and-limit-ipad-03-saved.png).

### j. Create a coupon in Marketing

| # | Step | iPad | Phone |
|---:|---|---|---|
| 1 | Code | field | field |
| 2 | Discount % | field | field |
| 3 | Covers: Spa services | tap · decision (16) | tap · decision (8) · **scroll first** |
| 4 | Create coupon | tap | tap |

- Totals: 2 taps and 2 fields. That is the shortest path in the audit.
- The page is the wordiest: **332 words and 28 controls**, with 197 words on screen at the start on iPad.
- Most of that text belongs to sections a basic coupon never touches: Dates (58 words), Minimums and limits (45), Customer terms (27), and a `Test a quote` panel (52) that cannot run until the coupon is saved.
- Reaching this page is Marketing › Coupons › New coupon, 2–3 taps.
- Screens: [start](screens/j-create-coupon-ipad-00-start.png), [phone after create](screens/j-create-coupon-phone-02-created.png).

## Heaviest components per page

These are the counts from [components.audit.ts](../../../tests/browser/ux-audit/components.audit.ts) at iPad size. Controls and words are for the whole component, including any part that needs a scroll. "On screen" is the part visible without scrolling.

**Checkout, new sale.** The page shows 32 controls and 103 words on iPad. On the phone the sheet shows 11 controls and 41 words, and the catalog behind it shows 21 controls.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Catalog: 4 tabs, search, Filters, group toggle, 6 tiles, 5 ⓘ buttons | [CatalogPane.tsx](../../../src/components/checkout/CatalogPane.tsx) | 18 | 49 | 18 / 49 |
| Order footer: coupon, totals, 5 tenders | [OrderPanel.tsx](../../../src/components/checkout/OrderPanel.tsx), [OrderCoupon.tsx](../../../src/components/checkout/OrderCoupon.tsx) | 6 | 23 | 6 / 23 |
| Order strip: Add customer, Add booking, Orders, New order | [OrderStrip.tsx](../../../src/components/checkout/OrderStrip.tsx) | 4 | 9 | 4 / 9 |

**Checkout, line open.** The page holds 45 controls (38 on screen) and 123 words.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Catalog | CatalogPane.tsx | 18 | 49 | 18 / 49 |
| Line editor: therapist chips, date, time, ฿/% toggle, discount, Apply, Change price, Remove item | OrderPanel.tsx (`LineEditor`, about lines 540–660) | 14 | 30 | 7 / 19 |
| Order footer | OrderPanel.tsx | 6 | 23 | 6 / 23 |

**Checkout, cash.** 31 controls and 93 words.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Catalog (still live behind the payment step) | CatalogPane.tsx | 18 | 49 | 18 / 49 |
| Cash panel: Back, payment time, received, Exact, +100, +500, +1,000, Clear, Confirm | [PayPanel.tsx](../../../src/components/checkout/PayPanel.tsx) | 9 | 25 | 9 / 25 |
| Order strip | OrderStrip.tsx | 4 | 9 | 4 / 9 |

**Receipt, paid with 2 lines.** 18 controls and 154 words; 14 controls and 145 words on screen at iPad.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Print toolbar: 58/80 mm, Print, Share, Copy, Print setup | [ReceiptView.tsx](../../../src/components/checkout/ReceiptView.tsx) | 6 | 13 | 6 / 13 |
| Current payment recording, with its explanation and `Receipt activity` | [PaymentRecord.tsx](../../../src/components/checkout/PaymentRecord.tsx) | 4 | 52 | 2 / 46 |
| History disclosures and Void | FinancialHistory.tsx, OrderHistory.tsx, ReceiptView.tsx | 3 | 7 | 0 / 0 |
| Also: the receipt paper (2 Refund buttons, 38 words) and After payment (2 Link buttons, 34 words) | ReceiptView.tsx, [AfterPayment.tsx](../../../src/components/checkout/AfterPayment.tsx) | 2 + 2 | 38 + 34 | all |

**Receipt, correcting the payment.** 25 controls and 178 words.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Correction form | PaymentRecord.tsx (about lines 380–570) | 11 | 50 | 3 / 26 |
| Receipt paper | ReceiptView.tsx | 1 | 30 | 1 / 30 |
| After payment | AfterPayment.tsx | 1 | 23 | 1 / 23 |

**Settings › Team.** 26 controls and 58 words.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| People: Invite, plus role select, Resend, Expire, Revoke and Manage per person | [TeamSettings.tsx](../../../src/components/admin/TeamSettings.tsx) | 12 | 30 | 12 / 30 |
| Cashier rules: 1 percentage, 4 selects, Save | TeamSettings.tsx | 7 | 17 | 6 / 12 |
| Settings tabs | [AdminSettingsView.tsx](../../../src/components/admin/AdminSettingsView.tsx) | 6 | 8 | 6 / 8 (4 / 6 on phone) |

**New booking.** 15 controls and 97 words. The rows are mostly 1 control each, so the weight is in the words.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Footer: Block these dates instead, Close, Create booking | [NewBookingDialog.tsx](../../../src/components/admin/NewBookingDialog.tsx) | 3 | 7 | 0 / 0 |
| Coupon code (optional), with its help text | NewBookingDialog.tsx | 1 | 20 | 0 / 3 |
| Create as confirmed, with its 13-word explanation | NewBookingDialog.tsx | 1 | 19 | 1 / 19 |

**New appointment.** 10 controls and 78 words.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Time (empty-state text) | [NewAppointmentDialog.tsx](../../../src/components/admin/NewAppointmentDialog.tsx) | 1 | 17 | 1 / 17 |
| Guest hint paragraph ("Leave guest details blank…") | NewAppointmentDialog.tsx | 0 | 13 | 0 / 13 |
| Staff | NewAppointmentDialog.tsx | 1 | 9 | 1 / 9 |

**New coupon.** 28 controls and 332 words.

| Component | File | Controls | Words | On screen |
|---|---|---:|---:|---|
| Test a quote (cannot run before the first save) | [CouponEditor.tsx](../../../src/components/admin/marketing/CouponEditor.tsx), [TestQuotePanel.tsx](../../../src/components/admin/marketing/TestQuotePanel.tsx) | 5 | 52 | 3 / 47 |
| Scope | CouponEditor.tsx | 5 | 30 | 5 / 30 |
| Dates | CouponEditor.tsx | 4 | 58 | 0 / 0 |
| Also: Minimums and limits (4 controls, 45 words); the Code section (2 controls, 61 words) | CouponEditor.tsx | | | |

## Proposals

Each proposal gives the clicks before and after on the measured path. Money protections stay as they are: manager approvals, the confirm step on payments, reasons on refunds, links and corrections, the void confirmation and the audit trails. Most proposals delete something.

### Top 8

| # | Proposal | Where | Before → after |
|---:|---|---|---|
| 1 | **Open the cash panel with the amount due filled in.** `Exact` stops being a required tap. Typing a larger amount or using +฿100/+฿500/+฿1,000 still shows the change. `Confirm cash` stays as the money confirmation. | PayPanel.tsx:370 (`useState("")` → the due amount) | a: iPad 4 → **3** taps, phone 5 → **4**. Every exact cash sale saves 1 tap. |
| 2 | **Let the discount field take `15%` or `150` and delete the ฿/% toggle.** A trailing `%` means percent; otherwise the value is baht. The over-limit hint already shows the amount in baht, so the reading is confirmed on screen. | OrderPanel.tsx, the `Discount type` ToggleGroup in the line editor | c: −1 tap, and −2 controls in the line editor. |
| 3 | **Ask for the reason inline.** When a discount is over the limit, show the Reason field directly under the hint, and make `Ask manager` send the request. Today `Ask manager` opens `ApprovalRequestForm`, which needs its own `Send request`. The reason stays required. | OrderPanel.tsx (`ask` state, about line 513), [ApprovalRequest.tsx](../../../src/components/checkout/ApprovalRequest.tsx) | c, cashier part: 4 → **3** taps. Together with #2: 4 → **2** taps and 2 fields. |
| 4 | **Close the Approvals sheet when its last request is decided.** Keep the "Approved · Order #…" status as a toast on the till, so the confirmation is not lost. Today the sheet stays open on "No requests waiting." | [ApprovalsPanel.tsx](../../../src/components/checkout/ApprovalsPanel.tsx):83 | c and e2, manager part: 3 → **2** actions each. |
| 5 | **Keep the primary button in view.** When an inline form opens, scroll it into view with `block: "nearest"`: the refund form inside the receipt and the line editor in the order rows. Give `NewBookingDialog` and Cashier rules a sticky footer. Move `Order history` out of the rows pane on iPad (it sits in [OrderPanel.tsx:192](../../../src/components/checkout/OrderPanel.tsx)), which gives the rows back about 44 px. | [RefundForm.tsx](../../../src/components/checkout/RefundForm.tsx), OrderPanel.tsx, NewBookingDialog.tsx:440, TeamSettings.tsx | Scrolls: c iPad 1 → **0**, e iPad 1 → **0**, e2 iPad 1 → **0**, h1 1 → **0** at both sizes, i 1 → **0** at both sizes. 7 scrolls saved across the measured runs. |
| 6 | **Open the link dialog on the review screen when exactly one appointment matches** (same service and same customer). Keep `Back` to the list. The reason and `Confirm link` stay. | AfterPayment.tsx, `LinkDialog` (line 124) | f: 3 → **2** taps. |
| 7 | **Slim the payment correction to what changes most often: the method.** Show method, amount and reason. Put date-time, a second tender, customer search, `Keep current customer` and `No named customer` behind one closed "Also change time, customer or split" disclosure. Delete the outer "The issued receipt never changes…" paragraph (PaymentRecord.tsx:55), because the form repeats it in its own first line. | PaymentRecord.tsx, about lines 380–470 and 55 | g: taps stay at 4. Scrolls go from 1 / 2 (iPad / phone) to **0 / 0**. Form controls 11 → **7**; words in the section about 70 → about 35. |
| 8 | **Show only what a basic coupon needs.** Fold Dates, Minimums and limits, and Customer terms into one closed "More rules" disclosure; the Summary card already says "Ongoing, no minimum". Hide `Test a quote` until the coupon is saved, since it cannot run before then. Delete the paragraph that starts "The code is a label people remember…" (26 words). | CouponEditor.tsx (sections; line 387; `TestQuotePanel` at line 681) | j: taps stay at 2 and fields at 2. Page controls 28 → **about 14**, page words 332 → **about 127**, and the phone scroll before "Covers" goes 1 → 0. |

### Further deletions (smaller)

- **Catalog tiles:** remove the 5 ⓘ "About …" buttons from the tiles ([CatalogPane.tsx:282](../../../src/components/checkout/CatalogPane.tsx)) and show the description in the line editor instead. Also remove the "FREQUENT · 6 items" collapse toggle; one group does not need collapsing. The checkout goes from 29 to **23** controls on screen at the start (iPad), with no task taps lost.
- **Receipt toolbar:** move paper width (58/80 mm) and the `Print setup` disclosure to a per-till setting. Paper size is fixed for each printer. Fold `Copy` into `Share`: when `navigator.share` is missing, Share copies instead ([ReceiptView.tsx:144–208](../../../src/components/checkout/ReceiptView.tsx)). The toolbar goes from 6 to **2** controls.
- **After payment:** delete the `Payment · Paid · R-000142` row ([AfterPayment.tsx:44](../../../src/components/checkout/AfterPayment.tsx)). The header right above it already says "Receipt R-000142 · Paid by cash".
- **Team › People:** drop `Expire` on pending invites ([TeamSettings.tsx:236](../../../src/components/admin/TeamSettings.tsx)). `Revoke` already ends the invite, and the two look alike on a row. This is −1 control per pending invite.
- **New booking:** delete the footer `Close` (NewBookingDialog.tsx:440). The ✕ in the corner does the same, and Escape works too. Shorten the 13-word help under "Create as confirmed".

Recorded, not proposed: on the phone, every checkout task pays one tap to open the order sheet (tasks a, b and c). I found no change that removes that tap without putting tenders over the catalog.

## What felt confusing while driving it

- **"Checkout" twice on the receipt.** The page header reads "Concierge operations / Checkout", and the receipt's back link right below it says "Checkout" again. The back link reads as a second title rather than as a way back.
- **"Correct payment recording" next to "No money was received…" next to "Void…".** These are three corrective actions with similar weight, and "No money was received…" is styled as a link. Which one to pick depends on wording I had to read twice. A one-line hint under each would help, or one "Fix this sale…" menu with the three choices and a sentence each.
- **The method is named differently in different places.** The tender button says `PromptPay`, the correction select says `PromptPay QR`, and the receipt line says "PromptPay QR · ฿1,200 · amended".
- **The cash panel starts at "Still short ฿1,200" with Confirm disabled,** even though the sale is the simplest one possible. It looks like an error state.
- **iPad line editor:** opening a row shows Therapist first. Discount, the field a cashier most often wants, needs a scroll inside a scroller about 230 px tall. Nothing on screen hints that more is below.
- **The phone manager hand-off:** after the cashier sends a request on the phone, the open order sheet hides the Approvals button in the header. The manager has to close the sheet first.
- **Coupon builder:** "Saved as version 1" shows next to `Create coupon` before anything is saved (CouponEditor.tsx:199). The code field's placeholder `DCNT-F1-20` looks like a value that is already filled in (line 352).
- **Correcting the payment:** while saving, the button briefly reads `Retry correction` with a spinner (PaymentRecord.tsx:560). It reads like a failure.
- **Settings tabs on the phone:** Team, the tab the owner needs for staff, is the last of 6 and off screen at 390 px.
- **New booking:** `Create booking` is below the fold even on an iPad. `Block these dates instead`, which is a different job, sits in the same footer.
