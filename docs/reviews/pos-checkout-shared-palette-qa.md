# Checkout: shared app palette and one desktop order title

31 October 2026. This report supersedes the colour/theme conclusions in the [earlier visual QA](pos-checkout-visual-qa.md). The persistent-order and payment model remains documented in [order QA](pos-orders-qa.md).

## Result

Checkout keeps the glass panel, blurred villa backdrop, photo catalog and compact order list. Colours now come directly from the same `:root` and `.dark` tokens as other pages: warm cream/white/navy in light mode and charcoal/navy/gold in dark mode. The separate green-black palette and forced dark classes are removed. Dialogs, sheets, menus and mobile navigation inherit the app theme. Checkout layer wrappers retain their touch-target sizing.

Desktop shows the active order number only in the right panel header. The duplicate title above the catalog is hidden at the same 1024px breakpoint where that panel appears. Phones retain the strip title while the order sheet is closed, and the sheet retains its accessible name and heading. Booking/customer controls, Orders and New order remain available.

The light-mode add icon now uses dark text on its gold hover fill, and selected tab underlines use the accessible gold token. Shadows and the neutral backdrop wash adapt to the app theme. The order panel defaults to 95% card opacity when backdrop-filter is unsupported, using 80% only with blur support. Global theme values, backend, schema and money logic were not changed.

Kiro Opus 5.5 implemented the change. The coordinator reviewed the diff and separately checked the running UI. Old forced-dark assertions were replaced with inherited-theme regressions, rather than disabled. Temporary mutation checks caught the duplicate title, a forced dark layer, a separate palette and a forced dark admin shell.

## Validation

- **1,281 unit tests passed** in 121 files; **252 focused tests passed** in 15 files.
- **27 booking browser tests passed**; app/tests/Convex typecheck and changed-file lint passed.
- **10 smoke tests and the production build passed** on the completed tree.
- Coordinator browser checks passed in both themes at **1440×900, 1024×768, 390×844, 320×740 and 844×390**. No horizontal page overflow; all tender and split-payment controls remained in the viewport.
- Checked a single visible desktop order title, a visible mobile strip title when closed, and preserved title/controls in the open sheet.
- Checked inherited computed tokens on Filters, Customer, Add booking, Orders, Custom item, Clear order and the mobile order sheet, including their overlays. No descendant forced a separate dark theme.
- Inspected desktop, narrow-phone, landscape and overlay screenshots. A simulated disabled backdrop filter remained readable. This is not a test in a browser that lacks CSS feature support.
- Recorded and checked a mobile long-list scroll, Save & close and reopen flow. The reopened fixture order retained every item.

## Authenticated shared-dev checks

The shared preview remained signed in. Computed colours on Settings and checkout matched. The real mobile admin sidebar at 390px inherited the app tokens in both light and dark modes, with no nested forced-dark class. Theme changes for this check were temporary DOM changes in an owned tab; no stored user preference was changed.

The previously pending two-tab stale-payment UI check is now complete. Using only the UI, synthetic **Order #9** (`rn71tjbr18qzj37gmf9rnrsf5d8hbgkw`) contained a labelled QA item at ฿100. Tab A opened Cash payment. Tab B increased quantity to two. Tab A displayed “The order changed while payment was open” and removed Confirm cash. Reviewing the updated order showed ฿200 due. Exact cash settlement displayed **Receipt R-000008**, two items, total/cash ฿200 and included VAT ฿13.08. The receipt was then voided through the UI with a synthetic-QA reason, preserving its history. No actual money was collected; no booking or customer was linked.

These live checks were verified through DOM state. Screenshot and recording calls repeatedly failed with `Preview automation snapshot timed out after 15000ms` / recordingStart timeout; the fallback browser host was also unavailable. **A fresh authenticated receipt screenshot remains unavailable.** The owned QA tabs were closed. No user testing tab was changed.

## Visual evidence

The images and video below use the real checkout components on `/dev/checkout-preview` with explicitly labelled **sample data**. They are not screenshots of authenticated shared-dev data.

| Evidence | Scope |
| --- | --- |
| [Light desktop](assets/pos-checkout-visual/palette-light-desktop.png) | One order title, cream/navy app palette, glass panel |
| [Dark desktop](assets/pos-checkout-visual/palette-dark-desktop.png) | Shared charcoal/gold palette |
| [Light mobile](assets/pos-checkout-visual/palette-light-mobile.png) | Compact order rows and reachable payment footer |
| [Dark narrow mobile](assets/pos-checkout-visual/palette-dark-mobile.png) | 320px order sheet |
| [Mobile scroll/save/reopen](assets/pos-checkout-visual/palette-mobile-scroll-save-reopen.mp4) | Recorded interaction on sample data |

## Remaining limits

New-head hosted CI and owner/reviewer acceptance must complete before merge. The fresh authenticated receipt screenshot remains blocked by browser capture tooling; live two-tab payment and receipt/void DOM checks passed. This report does not claim all live visual gates are complete, and no merge was performed.

Shared-dev services without photos still use fallback icons. No service photos were fabricated or seeded. No physical device, terminal, printer or physical keyboard testing was performed. Payment methods record tenders manually.
