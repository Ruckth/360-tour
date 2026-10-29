# Checkout QA: bill list and Hold/Resume

Date: 29 October 2026. Follow-up to PR #29 after design feedback.

## Bill items

Bill items now use a compact, full-width list with separators on desktop and mobile. Individual rounded cards and gaps were removed. Each row still expands to edit its therapist, time, discount, price or quantity. Prices remain aligned on the right; long names wrap. The totals and payment controls remain in the fixed footer.

## What Hold does

Hold keeps the current bill unpaid and opens a fresh sale so the cashier can serve another customer. The saved bill retains its guest, items and edits. In the live admin checkout, it is stored on the server and can be reopened after a reload or from another signed-in admin device.

To resume it, open **Held bills** in the checkout header, then select the customer or walk-in number. This list shows other unpaid bills (both held bills and open drafts), their item counts, last-updated times and bill totals. The current bill is excluded. The displayed total is before prior deposits; reopening the bill shows the remaining amount due.

Holding does not record a payment, issue a receipt, or create a room/service reservation. Payment must be recorded separately when the customer is ready. Existing attached bookings and appointments keep their own reservation state.

The mobile header now displays the words **Held bills**, and the dialog explains the action. A dedicated held-bill reporting feature was not requested; this section documents the behavior and its verification.

## Verification

- **Current mobile preview, 390×844:** added eight Thai massage lines. Total ฿9,600; included VAT ฿628.04. All eight fit as 56px rows (57px including separators), with 0px row border radius and no horizontal overflow.
- **Inline editing:** tapping a row still exposes therapist, time, discount, price and remove controls.
- **Hold:** saved Walk-in #13 with eight items, then returned to empty Walk-in #14. Held bills displayed #13, eight items and ฿9,600.
- **Resume:** reopening #13 restored all eight lines, ฿9,600 total and ฿628.04 VAT.
- **Desktop, 1440×900:** visually inspected plain list rows, right-aligned prices and fixed payment footer. Separate fixture run used massage, foot spa and breakfast, total ฿2,250.
- **Existing live shared-dev evidence from the earlier QA pass:** a ฿107 bill survived Hold, page reload and Resume before cash settlement (receipt R-000001). That record was subsequently voided as QA cleanup. This follow-up uses in-memory sample data and does not repeat or claim a new live-backend transaction.
- **Automated:** 16 focused checkout UI/write tests passed; changed-file ESLint passed. Full app/test/Convex typecheck passed after regenerating route types and removing a malformed stale generated dev validator.

Evidence is in `output/pos-list-followup/`: `mobile-list.png`, `held-bills.png`, `mobile-expanded.png`, and `desktop-list.jpg`. These are real browser captures of the updated components using the development fixture. No new animation was introduced; older card-layout footage is superseded for visual appearance.
