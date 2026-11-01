# Checkout audit follow-up

This follow-up fixes all six confirmed findings from the post-merge checkout audit. It keeps the shared app palette, glass surfaces, optional customer and booking relationships, and one active order panel on desktop.

| Finding | Corrected behavior | Regression coverage |
| --- | --- | --- |
| Late errors from another order | Queued writes keep their original target; only the currently displayed sale can clear or show its error banner. | Existing and newly created orders, queued retries, current-order recovery. |
| Invalid customer phone | Blank remains optional. Supported Thai and international formats are accepted; prose and non-phone values are rejected without discarding the form draft. Unchanged legacy values remain editable during unrelated profile changes. | Shared UI/backend validation, correction, optional contact, legacy profile compatibility. |
| Malformed source links | IDs are normalized after admin authorization. Invalid/missing orders show a recoverable message, with New order and Orders available. Booking/appointment source failures remain inside checkout. | Malformed, wrong-table, missing and valid IDs; source authorization and reuse; recovery controls. |
| Receipt paper size ignored | A valid width and measured receipt length replace the invalid `58mm auto` / `80mm auto` rules. Print-only layout removes surrounding app chrome. | Browser CSSOM and Chromium PDF page dimensions for both widths; no extra blank page. |
| Enlarged order controls overflow | Actions wrap, tender buttons reflow, item rows retain usable scroll space, and the overall panel scrolls when the header/footer need more space. | 200% rem scaling, long orders, cash/split controls and normal desktop/mobile layouts. |
| Enlarged custom item dialog exceeds screen | Dialog height is bounded by the viewport with internal scrolling; fields and actions remain reachable. The page's order actions and catalog tiles also wrap at narrow enlarged-text sizes. | 320×740 and 390×844 at 200% rem scaling, normal text, cancel behavior and whole-page horizontal bounds. |

## Live verification

The backend candidate was deployed to the authorized shared dev environment. Authenticated browser checks confirmed:

- `?order=aaaaaaaa` stays inside checkout with a readable message; New order clears the invalid URL.
- `?booking=aaaaaaaa` shows a readable source error; New order removes it and returns to checkout.
- Entering `not-a-phone` prevents customer submission and retains the entered name and phone for correction.
- At 320×740 with root text 32px, Custom item fits from y=32 to y=708, has no horizontal overflow, and scrolls to the Cancel action. Recorded scroll position reached 362px and Cancel remained inside the viewport.
- An existing labelled, voided synthetic receipt retains `80mm 95mm` and `58mm 98mm` page-size declarations in browser CSSOM when toggled. No new shared-dev order, customer, payment or receipt was created during these checks.

Browser snapshots timed out, while page interaction, DOM measurements and recording worked. Layout screenshots and PDF assertions also use an isolated browser fixture rendering the actual checkout components. Fixture checks are not claims about live backend behavior.

## Verification limits

The 200% checks double the root font from 16px to 32px, including rem spacing; they do not simulate every OS text setting or physical device. Physical printer output, native touch behavior, clipboard readback and real network disconnect/reconnect were not newly verified. Previously blocked audit scenarios outside these six findings remain outside this follow-up's passing coverage.

Receipt print settings explain selecting the matching roll, no margins and 100% scale. Printer drivers may override CSS page sizing. Automated PDF validation does not certify a physical printer.

## Combined checks

- Unit tests: **1,337 passed in 126 files** (`pnpm test:unit --maxWorkers=2`).
- Component browser tests: **40 passed** (`pnpm test:booking-ui`), including 13 new layout/print cases.
- Public browser smoke tests: **10 passed** (`E2E_PORT=3110 pnpm test:e2e:smoke`).
- Application, test and Convex type checks: passed (`pnpm typecheck`).
- Production build: passed (`pnpm build`).
- Lint: zero errors. Two existing warnings are in untracked temporary audit scripts and are not part of this PR.
- Original asynchronous-write audit reproducer: both cases pass. An additional phone-text regression failed in three cases before the strict whole-input check and passed afterward.
- The narrow-page regression initially reproduced the Orders/New order and catalog add-control overflow. Wrapping those groups fixed it; the horizontally scrollable catalog tabs remain keyboard accessible. The catalog keeps a minimum scroll area and scroll padding above the floating order total, with the checkout itself scrollable when enlarged content outgrows it. A hit-test regression confirms the catalog add control is not covered by the order total.

## Visual evidence

The screenshots below use the actual checkout components with isolated sample data. The recording uses authenticated shared dev, opens a custom-item form, scrolls and cancels without saving.

- [Desktop, 1440×900](assets/checkout-audit-followup/desktop.png)
- [Mobile, 390×844](assets/checkout-audit-followup/mobile.png)
- [Mobile order controls at 200% rem scaling](assets/checkout-audit-followup/enlarged-text.png)
- [Live custom-item dialog scroll recording, 320×740 at 200%](assets/checkout-audit-followup/custom-dialog-scroll.mp4)
