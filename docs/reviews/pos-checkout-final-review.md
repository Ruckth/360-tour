# Checkout final review — 1 November 2026

Rebased onto main `d58a728`. Independent frontend and backend reviews completed. The user authorized merge after the final review and checks.

## Fixes

- Existing price overrides and their reasons can be edited directly, without restoring the catalog price first. The form opens with current values and prevents unchanged submissions.
- A lone decimal point cannot submit an invalid price or discount.
- Changing orders clears the previous order’s error banner.
- Checkout and receipt pages retain the same sidebar state.
- A failed booking link offers Try again. Reopening the same booking after leaving starts a fresh attempt, and an older attempt cannot redirect the newer view.
- Attribution was removed from checkout plans, reports and test filenames/fixtures. Tests were preserved under neutral filenames.

The backend review found no new reproducible correctness defect. No backend product code or schema changed in this final pass, and no deployment or migration is needed for these fixes.

## Verification

- Full unit suite: **1,298 tests in 123 files passed**, including six new regression tests. The frontend reviewer confirmed its four new tests fail without the fixes.
- Backend review: **719 tests in 51 files passed**, with **165 focused tests** also passing.
- Booking browser suite: **27 passed**. Smoke suite: **10 passed**.
- App, test and Convex typechecks and production build passed. Lint: zero errors; two warnings in untracked local QA scripts.
- Shared-browser sample-data flow: changed a price from 1,200 to 1,000, reopened Edit and verified the current price/reason and disabled unchanged submission, then changed it directly to 950. Desktop at 1440×900 and mobile at 390×844 were inspected. Mobile had no horizontal overflow; Edit, Restore and all tender buttons stayed inside the viewport (Split payment bottom: 832 of 844px).
- Authenticated shared-dev receipt R-000008 was reopened read-only and inspected: synthetic Order #9, two items, cash/total 200, included VAT 13.08, retained void status. A fresh screenshot now succeeds, resolving the earlier capture limitation. No new payment or shared-data write was made.

## Evidence

- [Desktop price editing, sample data](assets/pos-checkout-visual/final-price-edit-desktop.png)
- [Mobile price editing, sample data](assets/pos-checkout-visual/final-price-edit-mobile.png)
- [Authenticated synthetic receipt, voided](assets/pos-checkout-visual/final-authenticated-receipt.png) — captured at 1440×600, scaled by the preview tool.
- [Previously inspected mobile scroll/save/reopen video, sample data](assets/pos-checkout-visual/palette-mobile-scroll-save-reopen.mp4). This final pass does not change scroll or transition behavior.
- Earlier light/dark and five-viewport evidence is in [palette QA](pos-checkout-shared-palette-qa.md).

## Limits and follow-up

Hosted CI must run on the pushed final commit. Physical devices, payment terminals and printers were not tested; tenders are recorded manually.

The backend review noted existing Stripe expiry/webhook timing limitations also present on main: the cached checkout-in-progress warning can outlive expiry, and a late online completion after a separate paid update can be ignored. These were not introduced by this PR. Orders-list amounts can lag source changes until the row is updated; settlement independently refuses stale sources and totals. The final pass does not claim these pre-existing behaviors are fixed.
