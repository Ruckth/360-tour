# r2 · Checkout and receipt

After screenshots for the second-round checkout and receipt pass (branch `ux/r2-checkout`).

- `after-<size>-NN-<state>.png`: captured by `tests/browser/ux-r2-checkout-screenshots.spec.ts`
  (`CAPTURE_UX_R2=after pnpm exec playwright test -c playwright.booking.config.ts ux-r2-checkout-screenshots`).
- `audit/screen-<page>-<size>.png`: the final audit's screens re-run on this branch, same names as
  `docs/reviews/ux-audit/final-screens/` on `ux/final-audit` (the before set).

Measured with `tests/browser/ux-audit/final-*.audit.ts` from `ux/final-audit`, iPad 1180×820 and phone 390×844.

| Measure | Before | After |
|---|---:|---:|
| Checkout, line open: controls on screen, iPad / phone | 31 / 19 | 26 / 14 |
| Line editor controls (on screen), iPad | 11 (9) | 5 (4) |
| Split payment panel controls | 17 | 13 |
| Exact cash sale, phone (taps) | 4 | 3 |
| Cash with ฿1,500 handed over, phone (taps) | 5 | 4 |
| Guest leaves, spa included, printed, phone (taps) | 6 | 5 |
| Receipt · correcting payment: controls · words outside the paper, iPad | 15 · 46 | 11 · 23 |
| Receipt · void: controls · words outside the paper, iPad | 15 · 39 | 11 · 25 |
| Correct payment form: controls · words · sentences | 7 · 32 · 1 | 7 · 14 · 0 |
| Link review: words · sentences | 51 · 3 | 38 · 1 |
| Orders dialog (manager): words · sentences | 39 · 2 | 23 · 1 |
