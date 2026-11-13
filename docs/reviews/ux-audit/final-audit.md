# Staff admin click audit: final re-run

Branch `ux/final-audit`, from `ux/integration` at `19d22fa` (Wave 0, P0–P8 and P2b merged). Measured on 14 Nov 2026 in headless Chromium against the offline browser fixtures. No product code was changed.

This repeats [click-audit.md](click-audit.md) (measured on `ux/click-audit`, UI at `2a08d77`) on the same screens and journeys, with the same counting rules, and checks each target in the plan's "What we'll measure" table (`docs/plans/ux-simplification-plan.md` on `ux/preview`).

## How it was measured

- Viewports: iPad landscape **1180×820** and phone **390×844**. Time zone Asia/Bangkok.
- Same counters as the original: [measure.ts](../../../tests/browser/ux-audit/measure.ts) (identical logic to `tests/browser/helpers/screen-census.ts`). A tap is a click; a native `<select>` is 2 taps; a field is one filled text box; a key is Enter or Escape; a scroll is a target outside the viewport or clipped by its scroller before the action. Controls and words count what is visible inside the viewport ("on screen") and anywhere on the page ("on page").
- New column: **explanatory sentences**, counted with `tests/browser/helpers/sentence-count.ts`, the counter the package specs assert rule 4 with (text ending in `.`/`!`/`?` with at least 4 words, outside buttons, labels, headings and closed `<details>`). The receipt paper is left out on both sides.
- Scripts:
  - [final-tasks.audit.ts](../../../tests/browser/ux-audit/final-tasks.audit.ts): the tasks a–j again, plus the plan journeys that needed a desk fixture (a2, d2, h2b, i2, k, m, n, o, p, q).
  - [final-components.audit.ts](../../../tests/browser/ux-audit/final-components.audit.ts): controls, words and sentences per component and per page, and the screenshot set.
  - [final-shared.ts](../../../tests/browser/ux-audit/final-shared.ts): paths and the sentence counter.
  - Rerun: `BOOKING_UI_PORT=4361 pnpm exec playwright test -c tests/browser/ux-audit/playwright.ux.config.ts final`
- **Before numbers** are the original audit's. For sentences, which the original did not count, and for "words outside the receipt paper", I re-ran the original [components.audit.ts](../../../tests/browser/ux-audit/components.audit.ts) on a detached checkout of `c96542b` with the sentence and receipt counters added. It reproduced every original control and word count exactly. Output: [results-final/components-before-rerun.json](results-final/components-before-rerun.json). The original `tasks.audit.ts` and `components.audit.ts` stay as the before scripts; they drive the old UI and fail on `ux/integration`.
- Raw data: [results-final/](results-final/) (one JSON per task and viewport, `components.json`, `dump-*.txt` control lists). Screenshots: [final-screens/](final-screens/). Task steps are named `<task>-<size>-NN-<step>.png`; each audited screen is `screen-<page>-<size>.png`, with a `-dark` copy for checkout and receipt.

Differences from the original setup:

- **j. Create a coupon** now runs on the real page fixture `marketing-coupon.html`. The original used an audit-only `CouponEditor` fixture, so the page now also counts the back link, title, `Save & publish` and ⋯. The audit-only fixture was dropped from this branch.
- **h2. New appointment** is measured twice. `index.html` stops at the guest name, as before. **h2b** finishes the booking on the desk fixture, which now has staff and open times.
- **c and e2** still switch roles on the same till (`window.fixture.setRole`). On the phone, the Approvals button is no longer covered by the order sheet, so the uncounted Escape from the original is gone.
- The package specs that assert the plan targets all pass on this branch: `ux-p2-order`, `ux-p2b-open-orders`, `ux-p3-pay`, `ux-p4-receipt`, `booking-desk`, `facts-chats`, `settings-team`, `marketing-coupon` and `admin-shell`, 136 tests in total.

## Headline numbers

| Measure | Before | After |
|---|---:|---:|
| Actions on the 12 original tasks (taps + fields + keys), iPad | 57 | **52** |
| Same, phone | 60 | **55** |
| Typed fields on those tasks, iPad | 15 | **10** |
| Surprise scrolls on those tasks, iPad / phone | 6 / 5 | **0 / 1** |
| Checkout controls on screen, iPad: empty till · 1 line · line open | 29 · 32 · 38 | **21 · 24 · 31** |
| Cash panel controls (the Cash payment group) | 9 | **5** |
| Receipt, iPad: controls · words on screen | 14 · 145 | **10 · 57** |
| Receipt: words outside the paper, iPad (manager) | 104 | **13** |
| Receipt: explanatory sentences | 3 | **0** |
| Payment correction form: controls · sentences | 11 · 2 | **7 · 1** |
| New coupon: words · controls on the page | 332 · 28 | **52 · 13** |
| New coupon: explanatory sentences | 28 | **0** |
| New booking: `Create booking` on screen without a scroll | no | **yes** |

## Plan targets ("What we'll measure")

| Task (iPad) | Before | Target | Now (iPad / phone) | Met? |
|---|---|---|---|---|
| Exact cash sale | 4 taps | 3 (item, Cash, Confirm) | **3** / 4 | ✅ (the phone adds View order, as the plan allows) |
| Cash with change (฿1,500) | 4–5 taps + mental sums | 4, no sums | **4** / 5; the button reads "Confirm cash ฿1,500 · change ฿300" | ✅ |
| Over-limit discount → manager approves | 6 taps, 2 typed, 1 scroll | 5, 1 typed, 0 scrolls | **5 · 1 · 0** / 6 · 1 · 0 | ✅ |
| Approve from any page | 3 + page change | 2, same page | **2**, same page, reply draft kept | ✅ |
| Refund one line | 2 taps, 1 typed, 1 scroll | 3, 0 typed, 0 scrolls | **3 · 0 · 0** at both sizes | ✅ |
| Correct payment method | 4 taps, 1 typed, 1–2 scrolls, 11 controls | 5, 0 typed, 0 scrolls, ≤ 7 controls | **5 · 0 · 0, 7 controls** at both sizes | ✅ |
| Print on 58 mm paper | 2 taps every time | 3 the first time, then 1 | **3**, then **1** | ✅ |
| Book spa for a staying guest | ~9 + 3 typed + page change | 5, 0 typed | **5 · 0** at both sizes | ✅ |
| Guest leaves: balance with spa, receipt printed | not measurable | ≤ 6 | **5** / 6 | ✅ |

| On screen at the start | Before | Target | Now | Met? |
|---|---|---|---|---|
| Checkout, iPad: controls | 29–38 | ≤ 22, and ≤ 30 with a line open | 21 empty till, 24 with one line, **31 with a line open** | ⚠️ Start met. Line open misses by 1; `ux-p2-order.spec.ts` was relaxed to ≤ 31 after P2b |
| Receipt: words outside the paper | ~95–110 (104 measured) | ≤ 25 | **13** manager, **12** cashier | ✅ |
| Cash panel: controls | 9 | 5 | **5** in the Cash payment group. The tender row's 5 controls stay visible above it, doing Back's job, so the pay area holds 10 | ✅ as specified |
| New coupon: words / controls | 332 / 28 | ≤ 130 / ≤ 14 | **52 / 13** | ✅ |
| Any panel: visible explanatory sentences | up to 6 (28 on the coupon page) | ≤ 1 | Most panels hold 0–1. **Over budget:** Link review 3, New appointment 4, Record payment 2, New booking 2, Orders (manager) 2, coupon chip in the order 2 | ❌ |

Package before → after claims, checked by their specs on this branch: approve from Chats 3 + page change → 2 ✅; Checkout on a phone 2 → 1 ✅; wrong-tab search 3 → 0 ✅; split payment 5 → 3 ✅; side column 9 blocks → ≤ 3 (1 measured) ✅; record a stay payment 5–6 + scroll → 3 ✅; arrivals ~11 → 1 + 1 per guest ✅; appointment buttons 9 → 3 ✅; Questions queue 2 → 1, clear a chat 3 → 2, read contact 2 → 0 ✅; Marketing access 4 + retyped email → 2 ✅; coupon → QR card → Print ~18 taps and 2 page switches → 8 and 0 ✅.

One claim is only partly met. **Link the only matching appointment (3 → 2)** still takes 3 taps (Link appointment, reason chip, Confirm link). The review now opens by itself, and the typed reason became a chip, so the task went from 3 taps + 1 field to 3 taps + 0 fields.

## Per task: before → after

Taps · fields · keys, then scrolls. "Start" is controls and words on screen when the task begins.

| Task | iPad before | iPad after | Phone before | Phone after | Start, iPad (before → after) | Start, phone (before → after) |
|---|---|---|---|---|---|---|
| a. Cashier sells 1 service, cash | 4 · 0 · 0, 0 | **3 · 0 · 0**, 0 | 5 · 0 · 0, 0 | **4 · 0 · 0**, 0 | 29 ctl, 93 w → 21, 86 | 21, 61 → 15, 56 |
| a2. Cash, guest hands ฿1,500 | (plan: 4–5 + sums) | **4 · 0 · 0**, 0 | — | **5 · 0 · 0**, 0 | — → 21, 86 | — → 15, 56 |
| b. 2 services + coupon, card | 5 · 1 · 1, 0 | 5 · 1 · 1, 0 | 6 · 1 · 1, 0 | 6 · 1 · 1, 0 | 29, 93 → 21, 86 | 21, 61 → 15, 56 |
| c. Over-limit discount → approval | 6 · 2 · 1, 1 | **5 · 1 · 0**, 0 | 7 · 2 · 1, 0 | **6 · 1 · 0**, 0 | 32, 103 → 24, 96 | 21, 62 → 15, 57 |
| d. Print the receipt | 1 · 0 · 0, 0 | 1 · 0 · 0, 0 | 1 · 0 · 0, 0 | 1 · 0 · 0, 0 | 14, 133 → **5, 44** | 9, 82 → **5, 44** |
| d2. Print on 58 mm, first time | (plan: 2 every time) | **3**, then 1 | — | **3**, then 1 | — → 5, 44 | — → 5, 44 |
| e. Refund one line (manager) | 2 · 1 · 0, 1 | **3 · 0 · 0**, 0 | 2 · 1 · 0, 0 | **3 · 0 · 0**, 0 | 14, 145 → 10, 57 | 10, 83 → 10, 57 |
| e2. Refund (cashier asks, manager approves) | 4 · 1 · 1, 1 | **5 · 0 · 0**, 0 | 4 · 1 · 1, 0 | **5 · 0 · 0**, 0 | 14, 148 → 6, 52 | 10, 84 → 6, 52 |
| f. Link an appointment after payment | 3 · 1 · 0, 0 | **3 · 0 · 0**, 0 | 3 · 1 · 0, 0 | **3 · 0 · 0**, 0 | 15, 133 → 7, 48 | 10, 83 → 7, 48 |
| g. Correct the payment method | 4 · 1 · 0, 1 | **5 · 0 · 0**, 0 | 4 · 1 · 0, 2 | **5 · 0 · 0**, 0 | 14, 132 → 8, 47 | 10, 80 → 8, 47 |
| h1. Staff villa booking | 3 · 2 · 0, 1 | 3 · 2 · 0, **0** | 3 · 2 · 0, 1 | 3 · 2 · 0, **0** | 11, 73 → 15, 60 | 12, 73 → 15, 60 |
| h2. Staff appointment (index.html, incomplete) | 2 · 2 · 0, 0 | 2 · 2 · 0, 0 | 2 · 2 · 0, 0 | 2 · 2 · 0, 0 | 10, 78 → 11, 71 | 10, 65 → 11, 58 |
| h2b. Staff appointment on the desk, finished | not measurable | 4 · 1 · 0, **1** | — | 4 · 1 · 0, **1** | — | — |
| i. Invite a cashier + discount limit | 3 · 2 · 0, 1 | 3 · 2 · 0, **0** | 3 · 2 · 0, 1 | 3 · 2 · 0, 1 | 24, 50 → 23, 49 | 19, 42 → 18, 37 |
| i2. Give a person Marketing access | 4 + 1 typed + page change | **2 · 0 · 0**, 0 | — | **2 · 0 · 0**, 0 | — | — |
| j. Create a coupon | 2 · 2 · 0, 0 | 3 · 2 · 0, 0 | 2 · 2 · 0, 1 | 3 · 2 · 0, **0** | 16, 197 → 13, 52 | 8, 94 → 13, 42 |
| j (on to QR card and Print) | ~18 + 2 page switches | **8 · 2 · 0**, 0 | — | 8 · 2 · 0, **1** | | |
| k. Approve from Chats | 3 + page change | **2**, same page | — | **2** | — → 17, 55 | — → 12, 50 |
| m. Book spa for a staying guest | ~9 + 3 typed + page change | **5 · 0 · 0**, 0 | — | **5 · 0 · 0**, 0 | — → 23, 125 | — → 21, 121 |
| n. Guest leaves, spa included, printed | not measurable | **5 · 0 · 0**, 0 | — | **6 · 0 · 0**, 0 | | |
| o. Arrivals (2 guests) | ~11 | **3** | — | **3** | | |
| p. Record a stay payment from the calendar | 5–6 + scroll | **3** | — | **3** | | |
| q. Appointment: next step | 9 buttons on the sheet | Mark arrived in 2 taps, 3 buttons | — | same | | |

Notes:

- **b** did not change. The coupon still costs `Add coupon`, typing the code and Enter. That path was not in the plan.
- **e and g** gained a tap each by design. The reason is a chip tap instead of a typed field, and Correct now sits in ⋯.
- **e2**: the cashier's share is now 3 taps (Refund, chip, Send) and the manager's 2 (Approvals, Approve). The panel closes itself, so the Escape is gone. An approver standing at the till can approve on the "Waiting for a manager" bar in 1 tap.
- **j** gained one tap because publishing has a confirm (`Save & publish` → "Publish SPA20?"). `⋯ › Save as draft` is also 2 taps.
- **h1** opens with the first villa already picked, so choosing Garden Villa still takes 2 taps. `Create booking` now sits in a sticky footer with "Total ฿21,675 · 3 nights".
- **h2b** scrolls before Guest name at both sizes (see hotspot 1).

## Per page: before → after

Controls on screen / on page · words on screen / on page · explanatory sentences · (receipt pages) words outside the paper.

| Page | iPad before | iPad after | Phone before | Phone after |
|---|---|---|---|---|
| Checkout · empty till | 29 / 29 · 93 / 93 · 1 | **21 / 21** · 86 / 86 · 1 | 21 / 23 · 61 / 68 · 0 | **15 / 16** · 56 / 62 · 0 |
| Checkout · 1 line on the order | 32 / 32 · 103 / 103 · 0 | **24 / 24** · 96 / 96 · 0 | 11 / 11 · 41 / 41 · 0 (sheet) | 10 / 10 · 40 / 40 · 0 |
| Checkout · line open | 38 / 45 · 112 / 123 · 0 | **31 / 34** · 106 / 113 · 0 | 22 / 24 · 57 / 61 · 0 | 19 / 20 · 55 / 57 · 0 |
| Checkout · over the limit (new state) | — | 30 / 39 · 108 / 130 · 0 | — | 20 / 25 · 65 / 74 · 0 |
| Checkout · cash | 31 / 31 · 93 / 93 · 0 | **25 / 25** · 81 / 81 · 0 | 10 / 10 · 31 / 31 · 0 | 11 / 11 · 25 / 25 · 0 |
| Checkout · split (new) | — | 32 / 32 · 101 / 101 · 1 | — | 18 / 18 · 45 / 45 · 1 |
| Receipt, 2 lines, manager | 14 / 18 · 145 / 154 · 3 · 104 | **10 / 10 · 57 / 57 · 0 · 13** | 10 / 18 · 83 / 154 · 3 · 42 | 10 / 10 · 57 / 57 · 0 · 13 |
| Receipt, paid by cash, cashier | 14 / 15 · 133 / 134 · 3 · 99 | **5 / 5 · 44 / 44 · 0** | 9 / 15 · 82 / 134 · 3 · 48 | 5 / 5 · 44 / 44 · 0 |
| Receipt · correcting payment | 13 / 25 · 139 / 178 · 5 · 106 | **15 / 15 · 80 / 80 · 1 · 46** | 6 / 25 · 93 / 178 · 5 · 92 | 11 / 15 · 66 / 80 · 1 · 37 |
| Receipt · refund form (new) | — | 18 / 18 · 68 / 72 · 0 · 13 | — | 17 / 18 · 61 / 72 · 0 · 12 |
| Receipt · void (new) | — | 15 / 15 · 83 / 83 · 0 · 39 | — | 10 / 15 · 69 / 83 · 0 · 26 |
| Link appointment dialog | 4 / 4 · 25 / 25 · 1 (candidate list) | 6 / 6 · 51 / 51 · **3** (review, opens straight away) | same | same |
| Settings › Team | 24 / 26 · 50 / 58 · 0 | 23 / 25 · 49 / 57 · 0 | 19 / 26 · 42 / 58 · 0 | 18 / 25 · 37 / 57 · 0 |
| New booking | 11 / 15 · 73 / 97 · 4 | **15 / 15** · 60 / 60 · **2** | 12 / 15 · 73 / 97 · 4 | 15 / 15 · 60 / 60 · 2 |
| New appointment (index.html) | 10 / 10 · 78 / 78 · 6 | 11 / 11 · 71 / 71 · **4** | 10 / 10 · 65 / 78 · 6 | 11 / 11 · 58 / 71 · 4 |
| New appointment (desk, today, new) | — | 16 / 20 · 69 / 96 · 4 in the dialog | — | 15 / 20 · 69 / 96 · 4 |
| New coupon | 16 / 28 · 197 / 332 · 28 | **13 / 13 · 52 / 52 · 0** | 8 / 28 · 94 / 330 · 28 | 13 / 13 · 42 / 54 · 0 |
| Coupon · just published (new) | — | 16 / 21 · 95 / 174 · 0 | — | 14 / 21 · 44 / 173 · 0 |
| Desk · hotel calendar (new) | — | 23 / 23 · 125 / 125 · 0 | — | 21 / 21 · 121 / 121 · 0 |
| Desk · stay popover (new) | — | 28 / 28 · 150 / 150 · 0 (popover: 5 · 25) | — | 26 / 26 · 146 / 146 · 0 |
| Desk · stay sheet (new) | — | 9 / 10 · 62 / 63 · 0 | — | 9 / 10 · 62 / 63 · 0 |
| Desk · appointment sheet (new) | — | 7 / 7 · 56 / 56 · 0 in the sheet (2 in the calendar legend behind it) | — | 7 / 7 · 56 / 56 · 0 |
| Desk · Book spa (new) | — | 16 / 17 · 60 / 66 · 0 | — | 16 / 17 · 60 / 66 · 0 |
| Approvals panel, 2 requests (new) | — | 7 / 7 · 43 / 43 · 0 in the panel | — | 7 / 7 · 43 / 43 · 0 |
| Orders dialog, manager / cashier (new) | — | 6 · 39 · **2** / 4 · 17 · 1 | — | same |

## Per component: before → after (iPad)

Controls · words for the whole component (on screen in brackets where it differs) · sentences.

| Component | File | Before | After |
|---|---|---|---|
| Catalog | [CatalogPane.tsx](../../../src/components/checkout/CatalogPane.tsx) | 18 · 49 (5 ⓘ, Filters, Frequent toggle) | **11 · 45** (4 tabs, search, 6 tiles) |
| Order strip | [OrderStrip.tsx](../../../src/components/checkout/OrderStrip.tsx) | 4 · 9 | 4 · 9 |
| Order header | [OrderPanel.tsx](../../../src/components/checkout/OrderPanel.tsx) | 2 · 2 (Save & close, Clear order) | **1 · 4** (⋯ holds Clear and Discard…) |
| Order footer: coupon, totals, tenders | OrderPanel.tsx, OrderCoupon.tsx, PayPanel.tsx | 6 · 23 | 6 · 24 |
| Line editor | OrderPanel.tsx:600–720 | 14 · 30 (7 on screen) | **11 · 27 (9 on screen)** |
| Line editor, over the limit, with inline Ask a manager | OrderPanel.tsx:785–850 | 14 + a separate form with its own Send | 16 · 44 (8 on screen); Ask a manager 5 · 11 |
| Cash panel | [PayPanel.tsx](../../../src/components/checkout/PayPanel.tsx) | 9 · 25 | **5 · 12**, plus the tender row 5 · 7 |
| Split payment | PayPanel.tsx:600–700 | not measured | 17 · 39 · 1 |
| Receipt toolbar | [ReceiptView.tsx](../../../src/components/checkout/ReceiptView.tsx):244 | 6 · 13 | **4 · 4** (Print, Share, New sale, ⋯) |
| Receipt header and "Checkout" back link | ReceiptView.tsx | 2 · 11 | back link gone |
| Payment recording block | PaymentRecord.tsx | 4 · 52 · 3 | **gone** (Correct payment is in ⋯) |
| After payment block | AfterPayment.tsx | 2 · 34 | **gone** (Link appointment is on each line) |
| History disclosures + Void | FinancialHistory.tsx, OrderHistory.tsx | 3 · 7 | **1 · 1** (one closed History; Void in ⋯) |
| Receipt paper with line actions | ReceiptView.tsx, RefundForm.tsx | 2 · 38 | 4 · 42 (Refund and Link appointment per line) |
| Correction form | PaymentRecord.tsx | 11 · 50 (3 on screen) · 2 | **7 · 32 · 1** |
| Refund form | [RefundForm.tsx](../../../src/components/checkout/RefundForm.tsx) | (Reason + Record refund) | 10 · 18 · 0 (All/Half, chips, Record refund ฿600) |
| Void panel | ReceiptView.tsx | Void… + "No money was received…" | 5 · 25 · 0 (one Void…, Yes / No) |
| Link dialog | [AfterPayment.tsx](../../../src/components/checkout/AfterPayment.tsx) | 4 · 25 · 1 (list) | 6 · 51 · **3** (review) |
| Team › People | [TeamSettings.tsx](../../../src/components/admin/TeamSettings.tsx) | 12 · 30 | 11 · 27 (Desk + Marketing select per person) |
| Team › cashier rules | TeamSettings.tsx:460 | 7 · 17 (6 on screen) | 7 · 19 (6 on screen; sticky Save) |
| Settings tabs | AdminSettingsView.tsx | 6 · 8 (Team off screen on phone) | 6 · 8 (Team on screen on phone) |
| New booking footer | [NewBookingDialog.tsx](../../../src/components/admin/NewBookingDialog.tsx) | 3 · 7, all below the fold | **1 · 6** in view: "Total ฿21,675 · 3 nights" + Create booking |
| New booking: coupon row · "Create as confirmed" | NewBookingDialog.tsx | 1 · 20 · 1 · 1 · 19 | **1 · 3 · 0 · 1 · 3** |
| New appointment: Time · Staff · guest hint | [NewAppointmentDialog.tsx](../../../src/components/admin/NewAppointmentDialog.tsx) | 17 w · 1 / 9 w · 1 / 13 w · 2 | 7 w · 0 / 10 w · 0 / 13 w · **2** |
| New coupon: Code / Benefit / Scope | CouponEditor.tsx | 61 w · 6 / 19 w · 2 / 30 w · 2 | Code · Type · Discount 4 · 6 · 0; Covers 3 · 12 · 0 |
| New coupon: Dates / Minimums / Terms | CouponEditor.tsx | 58 w · 5 / 45 w · 5 / 27 w · 2 | one closed **More rules**: 1 · 6 · 0 |
| New coupon: Test a quote | TestQuotePanel.tsx | 5 · 52 · 4, before any save | hidden until saved; then 5 · 35 · 0 |

## The 15 worst remaining hotspots

These are ranked by how often the task happens multiplied by its cost (extra taps, controls or reading). Numbers are iPad unless a size is named.

1. **Spa bookings for today open in "past work" mode.**
   - Where: [NewAppointmentDialog.tsx:120](../../../src/components/admin/NewAppointmentDialog.tsx) uses `const historicalDate = date <= today`. So the desk's New appointment (which opens on today) and **Book spa for an in-house guest** both get the past-work form.
   - What shows: a free "Time (Bangkok)" box above the slot chips, now labelled "Suggested open times" (lines 273–279), and a Staff select with no Auto ("Choose who did the work", lines 351–359). On top of that, New appointment's description is 2 sentences on every date: "Record a service at its actual date and time. Current and future availability is checked before saving." (line 203). The guest hint adds 2 more (line 409).
   - Cost: the dialog holds 4 sentences, 16 controls and 96 words. Guest name needs a scroll at both sizes (h2b: 4 taps, 1 field, 1 scroll).
   - Change: treat a date as past only when the slot start is before now (or use `date < today`), so today gets the future form with slot chips and Auto staff. Cut the description to one line ("Only open times are shown.") and the guest hint to "Guest details are optional." Estimate: −2 controls, 4 → 1 sentence, no scroll.
2. **The line editor is still the busiest panel on the till.**
   - Where: the rows scroller is only ~270 px tall ([OrderPanel.tsx:199](../../../src/components/checkout/OrderPanel.tsx)).
   - Cost: with a line open there are 31 controls on screen (target ≤ 30). Over the limit, the page holds 39, and 9 of them sit below the rows scroller. The line's own header scrolls out of view, and the catalog's 11 controls stay live beside it.
   - Change: when the line is unscheduled, fold Therapist (4 chips, line 623) and Service date and time (2 controls, line 638) into one "Any therapist · Not scheduled ›" row. Expect 31 → 26 on screen, and the over-limit Send stays in view.
3. **The phone pays one extra tap on every till task.**
   - Where: `View order` ([CheckoutView.tsx:200](../../../src/components/checkout/CheckoutView.tsx)).
   - Cost: a 4, a2 5, b 6, c 6, n 6, against 3/4/5/5/5 on iPad.
   - Change: put the primary tender on the bottom bar once the order has items ("Cash ฿1,200" beside "View order ›"), so an exact cash sale on a phone is 3 taps too.
4. **The link review reads 3 sentences for a 3-tap job.**
   - Where: [AfterPayment.tsx:132](../../../src/components/checkout/AfterPayment.tsx) ("฿1,600 paid on Order #1043, receipt R-000142.") and :217 ("Not changed: receipt R-000142, its tenders and total. No new payment is taken.").
   - Cost: 51 words for 6 controls.
   - Change: delete the :217 paragraph. The Confirm link button and the Back list already carry the meaning. Expect 3 → 1 sentence, about 51 → 35 words.
5. **The tender row stays on screen during cash and split payments.**
   - Where: [PayPanel.tsx:394](../../../src/components/checkout/PayPanel.tsx).
   - Cost: the cash panel meets its target of 5, but the pay area is 10 controls (phone 11, up from 10). Split holds 17 controls, because the per-row method chips (PayPanel.tsx:626) repeat the same four tenders.
   - Change: while splitting, hide the top tender row and keep one "Back" chip, or reuse the row for payment 1. Expect split 17 → 13.
6. **Settings › Team shows 2 native selects per person.**
   - Where: [TeamSettings.tsx:315](../../../src/components/admin/TeamSettings.tsx) and :329.
   - Cost: 8 selects for 4 people, and 23 controls on screen. On the phone, `Discount without approval` (line 462) starts below the fold (i: 1 scroll), and only 3 of the rules' 7 controls are on screen.
   - Change: show each person's roles as text ("Cashier · Marketing Marketer") with one `Change` button that opens both selects, and put the rules above People on the phone. Expect 23 → 15 controls.
7. **The phone desk header overflows.**
   - Where: the Today strip is a fixed `grid-cols-4` ([TodayStrip.tsx:46](../../../src/components/admin/TodayStrip.tsx)).
   - Cost: at 390 px, "Balance due ฿44,300" is clipped at the right edge. The search box shows only "Gues" and the villa filter "All v…" ([final-screens/screen-desk-hotel-calendar-phone.png](final-screens/screen-desk-hotel-calendar-phone.png)).
   - Change: use `grid-cols-2` below `sm`, and on the phone move search and the villa filter into one row, or into the ⋯ next to New booking.
8. **The hotel calendar opens with 23 controls and 125 words.**
   - Where: the toolbar is 12 controls in 2 rows (Today, ‹ ›, month, Month/Villas/List, search, villa filter, Show cancelled, New booking, ⋯) in [AdminBookingsView.tsx:290–320](../../../src/components/admin/AdminBookingsView.tsx). The stay popover screen totals 28 controls and 150 words.
   - Change: move `Show cancelled` into the ⋯ (a rare filter), and merge Today into the month picker. Expect 23 → 21, and one toolbar row on iPad. The staff calendar has the same `Show cancelled` button beside its Filters.
9. **The Orders dialog for managers reads 2 sentences.**
   - Where: [OrderStrip.tsx:176](../../../src/components/checkout/OrderStrip.tsx): "Open an unpaid order to keep selling or take payment, or a paid one to see its receipt. Saved orders reopen here on any device."
   - Cost: 39 words for 6 controls. The cashier's version is "Unpaid orders, latest first." (17 words in total).
   - Change: use one line for both roles, such as "Unpaid first. Paid orders open their receipt." Expect 2 → 1 sentence.
10. **The Record payment dialogs read 2 sentences.**
    - Where: [BookingFinancials.tsx:337](../../../src/components/admin/BookingFinancials.tsx) ("Record ฿8,500 the guest already paid at the desk, with the date it was received. This does not charge the guest."), [AppointmentFinancials.tsx:122](../../../src/components/admin/AppointmentFinancials.tsx) and [AppointmentCorrectionDialog.tsx:45](../../../src/components/admin/AppointmentCorrectionDialog.tsx).
    - Cost: p: 11 controls, 55 words.
    - Change: drop "This does not charge the guest." The button already says "Record ฿8,500" and the title says "Record payment". Expect 2 → 1 sentence in each.
11. **New booking has 2 sentences, one of them a footnote.**
    - Where: "Manual bookings never expire automatically." ([NewBookingDialog.tsx:207](../../../src/components/admin/NewBookingDialog.tsx)) and "No guest email on file." ([BookingMoneyFields.tsx:94](../../../src/components/admin/BookingMoneyFields.tsx)).
    - Cost: 15 controls, 60 words.
    - Change: delete the :207 description, and show the email note only once Create as confirmed is ticked and the email is empty. Expect 2 → 0–1 sentences.
12. **The coupon chip in the order carries the coupon's terms.**
    - Where: [OrderCoupon.tsx:103](../../../src/components/checkout/OrderCoupon.tsx) prints `promotion.terms` under the code ("฿500 off spa services of ฿1,500 or more. Extras and stays are not included.").
    - Cost: the order panel goes to 2 sentences. b with the coupon applied: 25 controls and 128 words.
    - Change: keep "DCNT-SPA-500 · Saves ฿500" and put the terms behind an ⓘ. Expect 2 → 0 sentences and −14 words.
13. **The receipt toolbar stays full while a task is open.**
    - Where: [ReceiptView.tsx:244–255](../../../src/components/checkout/ReceiptView.tsx). During Correct payment, Print, Share and New sale stay beside `Close`.
    - Cost: the page holds 15 controls, and words outside the paper rise to 46 (phone 37), above the 25 budget. Void reaches 39 words.
    - Change: while Correct or Void is open, show only `Close` in the toolbar. Expect 15 → 12 controls and about −5 words. Also hide the History row during the task.
14. **The appointment ⋯ menu holds 8 items, 3 of them corrections.**
    - Where: [AppointmentSheet.tsx:175–186](../../../src/components/admin/AppointmentSheet.tsx): Start service, Complete, No-show, Correct date / time, Turnaround, Edit details, Correct status, Cancel appointment.
    - Change: merge Correct date / time, Correct status and Edit details into one "Correct…" item that opens a 3-choice step. Expect 8 → 6 items.
15. **On a phone, Print is below the fold in the QR card step.**
    - Where: [QrCardDialog.tsx:274](../../../src/components/admin/marketing/QrCardDialog.tsx). Print is the last step of the 8-tap coupon journey (j: 1 scroll on the phone).
    - Also: the published coupon page holds 174 words (Test a quote 35, Summary 26).
    - Change: give the QR card dialog a sticky footer with Print, as New booking has. Expect phone scrolls 1 → 0.

Also seen, smaller:

- The staff calendar legend adds 2 sentences behind every sheet ("Drag a booking or break to propose a change; you confirm before it saves. Times are Bangkok time.", [AdminStaffBookingsView.tsx:618](../../../src/components/admin/AdminStaffBookingsView.tsx)).
- While a cashier's discount is over the limit and not yet sent, the tenders stay enabled at the full price ([final-screens/c-discount-over-limit-approval-ipad-02-over-limit.png](final-screens/c-discount-over-limit-approval-ipad-02-over-limit.png)). Cash is styled as the primary button.

## Inconsistencies across pages

- **Taking payment has three names.** The stay popover says "Checkout ฿27,500" (BookingQuickActions.tsx). The stay sheet and the appointment sheet say "Take payment" (BookingFinancials.tsx:126, AppointmentFinancials.tsx:76). The till labels its tenders "Take payment by".
- **Recording a desk payment has two names for the same dialog.** The popover says "Record payment" (BookingQuickActions.tsx:171); the sheets say "Already paid…" (BookingFinancials.tsx:133, AppointmentFinancials.tsx:78).
- **Corrections are named four ways.** The receipt ⋯ has "Correct payment". The appointment has "Correct payment method or date" (AppointmentFinancials.tsx:101), plus "Correct status" and "Correct date / time" in its ⋯.
- **"Entered by mistake" is named two ways.** On the receipt it is `Void…` › "No · Entered by mistake". On an appointment's manual payment it is "Cancel mistaken payment entry" (AppointmentFinancials.tsx:101).
- **The same correction button changes its label.** It reads "Save correction" until a method is picked, then "Save · PromptPay QR ฿1,200" (PaymentRecord.tsx:234–235). Refund always says the money ("Record refund ฿600").
- **The same dialog has two Book labels.** New appointment says "Book appointment"; from a stay it says "Book Thai massage 60 · 10:30 AM" (NewAppointmentDialog.tsx:433). The money-button rule is applied to one entry and not the other.
- **⋯ against inline buttons.**
  - In ⋯: the receipt (Correct payment, Void…, paper width), the order (Clear, Discard…), the hotel calendar (Block dates, OTA tools), the appointment sheet (8 items) and the coupon page (Save as draft).
  - Inline: the stay popover keeps "Cancel stay" inline in red and "Record payment" as a full button.
  - On Team, only pending invites get a ⋯ ("More for lek@…"); claimed people have none, so where a person's actions live depends on their state.
- **Confirm styles differ by page.**
  - Discard order is an alertdialog with "Keep".
  - Void is an inline panel in the receipt's side column with Yes / No cards.
  - Cancel stay is a dialog with radios and "Cancel booking".
  - Coupon publish is an alertdialog ("Publish SPA20?").
  - Refund and Approve have no confirm; the money button is the confirm.
  - The dismiss label varies: "Keep", "Keep booking", "Keep appointment", "Keep payment", "Keep editing" and "Close" (the Record payment dialogs use `keepLabel="Close"`).
- **Closing a task differs.** Receipt tasks close with a text "Close" in the toolbar. Dialogs and sheets close with the corner ✕. The order sheet has "Close order".
- **The reason field differs in one place.** Discount, Refund, Void and Link show the quick chips with a text box under them (`ReasonField`). Correct payment hides the box and folds an "Own reason" field under More (PaymentRecord.tsx:276 and :314). No desk dialog under `src/components/admin/` uses `ReasonField`, so reasons typed there (for example an appointment refund) get no chips.
- **Clock formats mix inside one dialog.** The time box shows "10:30" (24 h), the slot chips show "1:30" and "3:00" without AM/PM (their accessible names are "1:30 PM" and "3:00 PM"), and the Book button says "10:30 AM". Book spa from the stay shows "3:00 PM". Bangkok time is spelled "Time (Bangkok)", "Times are Bangkok time." and "Received … Bangkok".
- **History is named two ways.** "Order history" in the order panel, "History" on the receipt and the sheets.
- **Lookup placeholders are worded four ways.** "Search all items", "Guest, phone or code" (desk), "Name, phone or email" (customers), "Reference, phone, email or name" (bookings at the till).
- **Approvals appear three ways.** The header button ("Approvals · 1 waiting"), Approve on the receipt's waiting bar, and a status line on the order row. Only the receipt lets an approver decide in place.
- **Explanation style differs.** The till, receipt, coupon and Team use ⓘ tips ("About the discount limit", "About people"). The desk dialogs (Record payment, New appointment, New booking) still explain in sentences.
