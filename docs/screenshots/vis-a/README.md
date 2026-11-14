# Package A visual captures

Chromium, light mode, Bangkok time. iPad: 1180×820. Phone: 390×844.
These use the same staff-role fixtures and actions as `docs/screenshots/now/`. Receipt issue times follow the capture clock; fixture money and states are unchanged. Screenshots are unaltered viewport captures.

| State | iPad | Phone |
| --- | --- | --- |
| Checkout start | [checkout-start-ipad.png](checkout-start-ipad.png) | [checkout-start-phone.png](checkout-start-phone.png) |
| Order line open | [line-open-ipad.png](line-open-ipad.png) | [line-open-phone.png](line-open-phone.png) |
| Exact cash panel | [cash-panel-ipad.png](cash-panel-ipad.png) | [cash-panel-phone.png](cash-panel-phone.png) |
| ฿1,500 received; ฿300 change | [cash-1500-ipad.png](cash-1500-ipad.png) | [cash-1500-phone.png](cash-1500-phone.png) |
| Split: ฿500 cash, ฿700 PromptPay | [split-ipad.png](split-ipad.png) | [split-phone.png](split-phone.png) |
| Manager receipt | [receipt-ipad.png](receipt-ipad.png) | [receipt-phone.png](receipt-phone.png) |
| Manager refund: Foot spa 45 | [refund-ipad.png](refund-ipad.png) | [refund-phone.png](refund-phone.png) |

Capture only:

```sh
CAPTURE_VIS_A=1 BOOKING_UI_PORT=4371 pnpm exec playwright test -c playwright.booking.config.ts vis-a-screenshots --workers=1
```

The payment sheet and iPad panel fit their content; the confirmation stays at the bottom of that surface. At enlarged text sizes, tender segments and quick amounts wrap to preserve readable labels and touch targets. The compact split/refund segment shows “QR” with the accessible name “PromptPay”.

The receipt paper contains no buttons. Its line actions and refund forms live in the separate Items card, which follows the paper on phones. Share is in the receipt menu.

The P2 control census allows 28 visible controls when a line is open because the shorter tender bar also reveals History and Add coupon. The receipt word census includes the new Items card (65-word ceiling). The P2/P3/P4 tap, typing, and manual scroll budgets are unchanged.

Validation: `pnpm typecheck`, `pnpm lint`, `pnpm test:unit`, and `BOOKING_UI_PORT=4371 pnpm test:booking-ui` all exited 0. Unit: 258 files / 3,188 tests passed. Browser: 402 passed / 136 tests skipped by suite defaults. Lint retained two existing unused-variable warnings in `scripts/arch-scorecard.mjs`. [Command tails](validation.txt).

All fourteen captures were visually inspected. The focused capture run also passed the payment layout, keyboard, refund retry and permission checks. No tap, typing or manual-scroll assertions were relaxed.
