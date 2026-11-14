# Current UX captures

Captured from integration commit `7467c4ee93b1138c504afd5fc2bef5907d57d166`, with product code unchanged.

Run: `CAPTURE_NOW=1 BOOKING_UI_PORT=4370 pnpm exec playwright test -c playwright.booking.config.ts now-screenshots --workers=1`.

All captures use Chromium and light mode. iPad is 1180×820; phone is 390×844. Business settings comparison uses the original 1280×950 viewport and full-page capture; dashboard comparison uses 1440×900. Coupon comparison uses the original phone viewport and full-page capture. Current full-page heights follow current content, rather than stretching to the old page height.

## Fidelity limits

All 16 screen states were reached using the original fixture data and actions. Historical wall-clock values were not recorded by the old specs: receipt issue times and other Date.now-based fixture labels differ. Booking screens retain the original fixed desk clock (12 November 2026, 10:00 Bangkok). Removed controls and newly collapsed sections reflect the current UI; they have not been reintroduced or expanded to imitate the baseline. No screenshot pixels were altered.

## Gallery comparisons

- Cashier till: [ux-p1-phone-cashier-till.png](ux-p1-phone-cashier-till.png)
- Manager approvals: [ux-p1-ipad-manager-approvals.png](ux-p1-ipad-manager-approvals.png)
- Order line: [ux-p2-phone-line-open.png](ux-p2-phone-line-open.png)
- Open orders: [ux-p2b-phone-orders.png](ux-p2b-phone-orders.png)
- Cash and change: [ux-p3-phone-cash-1500.png](ux-p3-phone-cash-1500.png)
- Split payment: [ux-p3-ipad-split.png](ux-p3-ipad-split.png)
- Receipt: [ux-p4-phone-manager-receipt.png](ux-p4-phone-manager-receipt.png)
- Refund: [ux-p4-ipad-manager-refund.png](ux-p4-ipad-manager-refund.png)
- New booking: [ux-p5-new-booking-phone.png](ux-p5-new-booking-phone.png)
- Stay details: [ux-p5-stay-sheet-ipad.png](ux-p5-stay-sheet-ipad.png)
- Chats: [ux-p6-phone-chat.png](ux-p6-phone-chat.png)
- Missing information: [ux-p6-desktop-missing.png](ux-p6-desktop-missing.png)
- Team: [ux-p7-team-phone.png](ux-p7-team-phone.png)
- Business settings: [ux-p7-business-desktop.png](ux-p7-business-desktop.png)
- New coupon: [ux-p8-new-coupon-phone.png](ux-p8-new-coupon-phone.png)
- Marketing dashboard: [ux-p8-dashboard-desktop.png](ux-p8-dashboard-desktop.png)

## Extra viewport captures

Each of the following has both `-ipad.png` and `-phone.png`: checkout-start, line-open, cash-panel, receipt, stay-sheet, appointment-sheet, hotel-calendar, staff-calendar, chats, missing-information, settings-business, settings-team, new-coupon, marketing-dashboard.

Original before and first-pass images remain unchanged.
