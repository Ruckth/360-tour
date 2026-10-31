# Resort checkout visual QA

31 October 2026. Visual redesign on PR #29, rebased onto main `ceb8654`. The earlier [order-model QA](pos-orders-qa.md) remains the record of migration and booking/deposit settlement acceptance. This report covers the redesign and its final integration checks. No merge has been performed.

## Result

Checkout now uses a green-black theme, warm gold controls, serif headings, a compact navigation rail and a wider inset order panel. Catalog tiles and order rows display existing service/villa photos, with a fallback for absent or broken images. Categories fold, search and filters remain available, and room/extra rows have quantity controls. Services retain separate rows. Order #, optional customer, booking links, Orders and Save & close remain unchanged.

Independent review identified two P2 defects: portaled overlays inherited the light app theme, and mobile navigation lost the checkout theme. Both are fixed by carrying the checkout theme through content and sibling overlays. The original regressions pass; another regression verifies that ordinary admin navigation keeps its original theme.

## Automated validation

- Full suite after rebase: **121 files / 1,270 tests passed**.
- Additional historical booking integration assertions: **46 tests passed**, including an empty linked order attributed to the admin for both historical and ongoing bookings.
- Typecheck passed for app, tests and Convex. Final test-only typecheck and changed-file lint passed.
- Production build passed after rebase.
- Booking browser suite: **27 passed**. The new main-branch booking fixture needed an explicit order-summary mock; the real component/backend contract did not change.
- Disconnected smoke: **10 passed**.
- Fresh light-root browser checks confirm dark desktop Filters overlay and mobile order sheet. Fresh mobile video confirms eight separate rows, scrolling, Save & close, Orders and reopening.
- Independent audit also exercised 1440×900, 1024×768, 390×844, 320×740 and 844×390, including 100 rows, long labels, reachable payment controls, image failures/loading, price reasons, quantity limits, keyboard navigation and reduced motion.

The rebase conflict combined main's permission for historical admin check-ins with this branch's admin actor attribution when creating the linked order. Public booking date restrictions remain covered by tests. No schema change or data migration was required for photos or styling.

## Shared-dev verification

Candidate functions deployed to the authorized `dev:optimistic-turtle-573`, and the rebased functions were redeployed on 31 October.

Authenticated browser checks on 30 October verified live room catalog photos and the matching Garden Suite order-row image, missing-service-photo fallbacks, desktop/mobile layout, mobile navigation, Save & close → page reload → Orders → reopen, room quantity updates, and price override requiring a reason. Order #7 restored all four rows after reload. Its service/room rows were then cleared without reserving dates or taking payment.

**Data limitation:** all 11 active services in shared dev currently have no `imageUrl`; they correctly show fallback icons. All three rooms have image URLs. Deployment does not create missing service photography. No unrelated catalog records were edited or seeded.

The synthetic custom item on Order #7 was priced at ฿100 and overridden to ฿80 with a reason through the authenticated UI. After the browser host disconnected, final financial verification used authenticated Convex CLI calls, explicitly not a browser claim: increasing quantity to two rejected the stale ฿80 payment/revision; fresh ฿160 cash settlement with ฿200 received produced ฿40 change; replay created no second payment. Receipt #7 was then voided, retaining its lines, original tender and receipt number. No booking/customer links or actual money were involved. The labelled synthetic order remains as void audit history.

## Inspected evidence

| Evidence | Scope |
| --- | --- |
| [Desktop](assets/pos-checkout-visual/desktop-live.jpg) | Authenticated shared-dev room photos, four compact order rows, 1440×900 |
| [Mobile](assets/pos-checkout-visual/mobile-live.jpg) | Same persisted order reopened after reload, 390×844 |
| [Narrow mobile](assets/pos-checkout-visual/mobile-320-live.jpg) | 320×740, wrapped names/header and reachable tender controls |
| [Mobile navigation](assets/pos-checkout-visual/mobile-sidebar-live.jpg) | Dark sidebar; cropped before the account footer to exclude account details |
| [Light-root overlay](assets/pos-checkout-visual/light-root-filters-fixed.png) | Final rebased fixture build, dark Filters backdrop under a light app root |
| [Light-root mobile sheet](assets/pos-checkout-visual/light-root-mobile-fixed.png) | Final rebased fixture build, themed content and backdrop |
| [Scroll/save/reopen video](assets/pos-checkout-visual/sample-mobile-scroll-save-reopen.mp4) | About 15 seconds of real browser capture on labelled sample data; initial dev compilation trimmed |

The video was inspected at sampled frames through the reopened order. Fixture video proves interaction/layout, while the authenticated screenshots and reload check prove the live catalog and persisted order separately. Original independent audit details remain locally in `tmp/pos-visual-redesign/sol-audit-report.md`.

## Remaining gates and limits

Current-head hosted CI and final reviewer/owner acceptance are pending push. The authenticated two-tab stale-payment UI recheck and final receipt-screen capture were interrupted when the browser host disconnected. Backend revision rejection, settlement/replay/void, unit regressions and earlier authenticated baseline UI acceptance passed, but they are not represented as a completed new two-tab UI run. Reconnect browser automation to finish that final UI gate before claiming full merge readiness.

No physical devices, virtual keyboards, bank/card terminals or thermal printers were tested. Photos currently use their original size. Cash/PromptPay/card/transfer record tenders manually; no money was sent. The local dev server remains on port 3107 for testing.

## Kiro Opus 5.5 review and refactor — 31 October

Kiro CLI with `claude-opus-5.5`, high effort, completed the requested review and bounded refactor. It found no P0–P2 defects in the reviewed scope. Four maintainability improvements were implemented and independently checked by the coordinator:

- `CheckoutDialogContent` and `CheckoutSheetContent` now apply both content and overlay themes together across all seven checkout dialogs/sheets, preventing the omission that caused the earlier light-root overlay defect.
- A shared `useLoadablePhoto` hook preserves the existing URL-specific photo-failure behavior for both thumbnails and the decorative background.
- Quantity stepper wording and update calls are centralized, with the same accessible labels, quantity bounds and serialized server updates.
- Payment availability uses one `cannotPay` condition; the redundant fragment around the tender grid was removed.

Changes are confined to six checkout component files. Financial logic, backend/schema, shared UI primitives, admin navigation, receipt behavior and all existing tests remain unchanged. No tests were weakened or skipped; no additional deployment or data mutation was needed.

After refactoring: **205 focused regressions, all 1,270 unit tests and all 27 booking browser tests passed**. App/tests/Convex typecheck and changed-file lint passed. The coordinator additionally ran **10 smoke tests and a production build**, both passing on the refactored tree.

Fresh isolated browser checks confirmed all seven themed layers under a light root, separate service rows, room/extra steppers and required price-change reasons. At all five required viewports, there was no page overflow and the payment footer remained reachable; measured footer positions matched the pre-refactor audit. The coordinator inspected the [desktop sample](assets/pos-checkout-visual/refactor-desktop-sample.png), [320px mobile sample](assets/pos-checkout-visual/refactor-mobile-sample.png), and Orders overlay captures. These images use labelled fixture data, not authenticated shared-dev data. No motion changed, so the earlier inspected scroll/save/reopen video remains the motion evidence.

The full local review is `tmp/pos-visual-redesign/kiro-review-refactor-report.md`. Hosted CI on `86da380` passed before this refactor; the new commit must receive its own CI result. The authenticated two-tab/receipt-screen gate and missing real service-photo data described above remain open. No merge performed.
