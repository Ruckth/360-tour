# Package C visual redesign

Light-mode Chromium captures using the same fixtures, initial states, and viewport sizes as `../now/README.md`. Original captures are unchanged. Business desktop and new coupon phone use full-page capture; the other comparison images capture the viewport.

| Screen | Viewport | After | Current comparison |
| --- | --- | --- | --- |
| Business settings | 1280 × 950 | [business-desktop.png](business-desktop.png) | `../now/ux-p7-business-desktop.png` |
| Business settings | 390 × 844 | [business-phone.png](business-phone.png) | `../now/extra-settings-business-phone.png` |
| Team settings | 390 × 844 | [team-phone.png](team-phone.png) | `../now/ux-p7-team-phone.png` |
| Team settings | 1180 × 820 | [team-ipad.png](team-ipad.png) | `../now/extra-settings-team-ipad.png` |
| New coupon | 390 × 844 | [new-coupon-phone.png](new-coupon-phone.png) | `../now/ux-p8-new-coupon-phone.png` |
| New coupon | 1180 × 820 | [new-coupon-ipad.png](new-coupon-ipad.png) | `../now/extra-new-coupon-ipad.png` |
| Marketing dashboard | 1440 × 900 | [marketing-dashboard-desktop.png](marketing-dashboard-desktop.png) | `../now/ux-p8-dashboard-desktop.png` |
| Marketing dashboard | 390 × 844 | [marketing-dashboard-phone.png](marketing-dashboard-phone.png) | `../now/extra-marketing-dashboard-phone.png` |

Supplementary states:

- [Coupon summary after entering 20%](coupon-summary-phone.png), scrolled to show the summary above the phone action bar.
- [Team with unsaved cashier rules](team-dirty-phone.png), showing the conditional Save bar.
- [Compact business time picker](business-time-picker-desktop.png), with the existing hour, minute, and clear controls inside a popover.

Reproduce:

```sh
CAPTURE_VIS_C=1 BOOKING_UI_PORT=4373 pnpm exec playwright test -c playwright.booking.config.ts vis-c-screenshots --workers=1
```

The capture spec also checks the compact time picker's `15:30` form value and dirty Save state. Screenshots were opened and visually reviewed; iteration tightened Team rows to retain the no-scroll discount edit and removed a redundant line above the phone dashboard hero.

Validation tails are in [checks.txt](checks.txt). The full run passed 3,188 unit tests and 402 browser tests (130 opt-in tests skipped). Typecheck passed for app, tests, and Convex; lint has zero errors and two existing warnings.

The measured interaction budgets remain intact: Team has seven initial People controls and grants Marketing access in three taps with no typing or scroll; cashier discount edit/save needs no scroll; coupon creation/publication/printing takes eight taps, two fields and one confirmation; the dashboard has six controls before its figures on phone and eight on desktop.
