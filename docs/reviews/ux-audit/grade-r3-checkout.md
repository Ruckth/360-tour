# Grade r3: checkout / point of sale

Grader: fresh-eyes senior product designer. Sources: `docs/screenshots/audit-r3/` (listed per screen), plus code in `src/components/checkout/`, `src/components/ui/`, `src/hooks/` and `tests/browser/touch-targets-a.spec.ts` for states the screenshots can't show. I scored execution against the house rules (`visual-brief.md`) and the locked decisions (`design-decisions.md`). I didn't mark any screen down for a locked choice itself.

Scale: 9 = I'd ship it with only a nit.

## Summary

| # | Screen | Hier | Type | Layout | Consist | Color | Effic | Clarity | States | Resp | A11y | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Checkout start (catalog + empty order) | 9 | 9 | 8 | 9 | 9 | 9 | 9 | 9 | 8 | 9 | **8.8** |
| 2 | Order line editor (line open) | 9 | 8 | 8 | 8 | 9 | 9 | 8 | 9 | 9 | 9 | **8.6** |
| 3 | Cash panel | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |
| 4 | Split payment | 9 | 9 | 8 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | **8.8** |
| 5 | Receipt | 8 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **8.9** |
| 6 | Refund (inline on receipt) | 7 | 9 | 8 | 7 | 8 | 9 | 9 | 9 | 8 | 9 | **8.3** |
| 7 | Orders sheet | 9 | 9 | 9 | 9 | 9 | 9 | 7 | 9 | 9 | 9 | **8.8** |
| 8 | Approvals sheet | 8 | 8 | 9 | 8 | 9 | 9 | 9 | 9 | 8 | 9 | **8.6** |

**Area average: 8.7.** Screens at 9+ in every category: **1 of 8** (Cash panel).

The money core is strong. Cash, split and the line editor follow the brief closely: 40px sans hero, the strong tender track, the emerald Change block, the 56px Confirm and the "Received now · Edit time" line. States are very thorough everywhere: attempt-key retries, server caps, coupon refusals, stale booking rows, "Saving…", skeletons, empty states. The weak spots are around the edges. The refund form breaks the locked choice-control tone rule. The Orders copy contradicts its own list. Approvals isn't designed for the phone. There are also a few awkward wraps ("Split payment", "16.67%").

---

### 1. Checkout start (extra-checkout-start-ipad/phone/desktop, ux-p1-phone-cashier-till)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Catalog leads and the empty order recedes. On phone, the dark "View order · Cash ฿1,200" bar is unmistakable once an item is added. | — |
| Typography | 9 | Tile name 15px medium, meta 12px muted, price 15px semibold sans tabular. | — |
| Layout & spacing | 8 | On iPad (1180) each tile is about 224px wide. That's under the 72px photo + 12px gap + `min-w-[min(100%,8rem)]` text column, so the card's `flex-wrap` drops the text under the photo. The result is a tall 180px tile with about 130px of dead space beside the thumbnail, and only 6 items above the fold. | `CatalogPane.tsx` tile `<button>`: drop `flex-wrap` (use `flex-nowrap`) and change the text column to `min-w-0 flex-1`, so the photo stays left at every width (as on desktop). If a vertical tile is wanted on iPad, make it deliberate: `@min-[34rem]:@max-[53rem]:flex-col` with the photo `w-full aspect-[4/3]`. |
| Consistency | 9 | Same tile, chips and outline buttons across viewports. | — |
| Color & contrast | 9 | Gold only on the add affordance and the active tab. | — |
| Efficiency | 9 | One tap adds. The phone bar has a direct "Cash ฿X" shortcut that still lands on the Confirm step. | — |
| Clarity | 9 | "No items yet · Tap an item to add it." | — |
| States & feedback | 9 | 6-tile pulse skeleton, empty search result, "Nothing to sell here yet", count badge on the tile. | — |
| Responsive | 8 | iPad tiles look squeezed by the wrap above, not designed. Phone and desktop are good. | Same `CatalogPane.tsx` tile fix. |
| Accessibility | 9 | Whole tile is the button, with sr-only "Add to order" and "N on the order". Bar `aria-label` starts with its visible text. Touch spec covers the catalog. | — |

### 2. Order line editor (extra-line-open-ipad/phone/desktop, ux-p2-phone-line-open)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Balance due 40px and the dark "Cash ฿1,200" CTA anchor the panel. The inset settings list reads as secondary. | — |
| Typography | 8 | "Split payment" wraps onto two lines in the 4-up tender row on iPad and desktop (`lg:grid-cols-4 lg:text-[13px] lg:px-1`, about 88px per button). The other three labels are single-line, so the row looks broken. | `OrderPanel.tsx` (around line 330): set the visible label to "Split" and keep `aria-label="Split payment"` (the tests and focus-restore look it up by name). That also matches the pay-panel track, which already says "Split". |
| Layout & spacing | 8 | Same wrap: the 4th button is visibly fuller than its neighbours. On desktop there's an unexplained band of blank space between "History" and Subtotal. | Label fix above. Also move `OrderHistory` out of the scrolling items list into the totals footer as a `text-[13px]` link-row ("History ›"), or let the items area `flex-none` when it's shorter than the panel. |
| Consistency | 8 | Here the tenders are four outline buttons, one called "Split payment". One step later the same choice is a segmented track with "Split". In the header, the coupon icon button is `variant="outline" text-gold-text rounded-xl` while its neighbour ⋯ is ghost. | Rename as above. Make the coupon button `variant="ghost"` with the same `size-9 rounded-xl` as `MoreMenu` (`OrderPanel.tsx` around line 205). |
| Color & contrast | 9 | Destructive red only on "Remove item"; muted VAT row. | — |
| Efficiency | 9 | Discount is inline with the cashier limit visible, schedule and price are one tap away, and Cash is prefilled. | — |
| Clarity | 8 | (a) The header coupon control is a bare ticket glyph, and `title` doesn't help on touch. (b) The Discount field's placeholder "0%" reads as a value that's already set. (c) On a brand-new line, "History" doesn't say what it holds. | (a) `<TicketPercent/> <span className="max-sm:sr-only">Coupon</span>` and drop `size="icon"` from `sm` up. (b) `DiscountField` placeholder → `"None"` (or `"e.g. 10%"`). (c) Hide `OrderHistory` until the order has at least one history entry, or label it "Changes (n)". |
| States & feedback | 9 | "Saving…" in the header, stale-row/coupon/waiting-for-manager lines explain why tenders are off, and the approval request is inline. | — |
| Responsive | 9 | Phone sheet with a 2×2 tender grid; iPad and desktop inset glass panel. | — |
| Accessibility | 9 | Labelled discount input with `aria-describedby` limit + echo; icon buttons labelled; 44px on touch via `TOUCH_TARGETS`. | — |

### 3. Cash panel (extra-cash-panel-ipad/phone/desktop, extra-cash-1500-desktop, ux-p3-phone-cash-1500)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | "Balance due" 12px muted over a 40px sans amount, then an h-14 Confirm. Change at 32px emerald appears only when received > due. | — |
| Typography | 9 | Input h-14 text-2xl right-aligned, sans tabular. | Nit: the ฿ prefix sits at `left-4`, about 300px from the digits on desktop. Consider `justify-end` with the ฿ inline before the number. |
| Layout & spacing | 9 | Panel shrinks to its content (`has-[[data-testid=pay-panel]]:self-start`), so there's no dead space. Chips are h-11 and equal width. | — |
| Consistency | 9 | Strong tender track as locked. | Nit: the visible label is "Confirm cash" while card and split show the money ("Confirm ฿1,200 card"). |
| Color & contrast | 9 | Emerald Change, amber Short block. | — |
| Efficiency | 9 | Prefilled with Exact; note chips (฿1,500 · ฿2,000) cover the common hand-overs. | — |
| Clarity | 9 | "Cash received", "Change", "Received now · Edit time". | — |
| States & feedback | 9 | "Short ฿X" block with Confirm off, spinner in Confirm, `role=alert` error with Back, coupon-refusal recovery card. | Nit: the pressed note chip (`aria-pressed:ring-2 ring-foreground`) looks like a focus ring. `aria-pressed:bg-foreground aria-pressed:text-background` (or `aria-pressed:border-foreground aria-pressed:bg-muted`) would read as "selected". |
| Responsive | 9 | Phone bottom sheet; 5-item track fits at 390. | — |
| Accessibility | 9 | Labelled input; Confirm `aria-label` begins with its visible text; "Edit payment time" labelled; touch spec covers cash and payment time. | — |

### 4. Split payment (extra-split-ipad/phone/desktop, ux-p3-ipad-split)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The Confirm label carries the full allocation ("Confirm ฿500 cash + ฿700 PromptPay"). | — |
| Typography | 9 | Sans tabular throughout. | — |
| Layout & spacing | 8 | Row 1's amount shows "฿" pinned left with "500" right. Row 2's dashed output shows "฿700" right-aligned, so the currency marks don't line up between rows. Each card also stacks a two-line label ("Payment 1 / Amount"), which makes it taller than it needs to be. | `PayPanel.tsx` (around line 655): give the `<output>` the same absolute `left-3` ฿ span as the input and render only the number. Replace the `Label` sub-line with a visually-hidden label (`sr-only`) and keep the visible `h3` "Payment 1" as one line. |
| Consistency | 9 | Per-payment picker is `tone="subtle"` as locked; "Covered ✓" per the locked rule. | — |
| Color & contrast | 9 | Emerald Covered with ✓ icon, destructive "Over by". | — |
| Efficiency | 9 | Last payment auto-fills the rest; one field to type. | — |
| Clarity | 8 | "Amount" under "Payment 1" repeats the obvious, and "Rest" is terse. Nothing tells you the dashed box fills itself. | Visible meta for the last row: "Payment 2 · fills the rest". Drop "Amount" (see Layout). |
| States & feedback | 9 | Validation line (`aria-live`), "Confirm split" disabled until valid, Over-by state, remove × from 3 rows. | — |
| Responsive | 9 | Phone grid falls to label / amount / method stacked; fits at 390. | — |
| Accessibility | 9 | `aria-label="Payment n amount"`, `aria-invalid`, `aria-describedby` to validation, labelled remove buttons. | — |

### 5. Receipt (extra-receipt-ipad/phone/desktop, ux-p4-phone-manager-receipt)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | New sale is clearly the primary. But the outcome of the sale, *paid*, is a 12px pale-green "Paid" pill, and the amount sits in a 14px muted sub-line. Right after taking money, the confirmation should be the second thing you see. | `ReceiptView.tsx` (around line 278): Paid chip → `inline-flex items-center gap-1 h-6 px-2.5 text-[13px]` with a `<Check className="size-3.5"/>`. Sub-line: render the amount part as `<span className="font-medium text-foreground font-sans tabular-nums">฿1,800</span> paid by card`. |
| Typography | 9 | Serif title, mono paper with sans tabular money, 15px item rows. | — |
| Layout & spacing | 9 | `lg:grid-cols-[24rem_1fr]`; paper has no buttons, as the brief asks. | Nit: on iPad and desktop each line stacks name / chip / buttons in three rows. Chip inline after the name (`flex items-center gap-2`) would save about 28px per line. |
| Consistency | 9 | Card surfaces, outline "Link appointment" + ghost "Refund" as locked. | — |
| Color & contrast | 9 | Amber "Not scheduled", emerald Paid; text on tints ≥ 4.5:1. | — |
| Efficiency | 9 | Print and New sale one tap each; Share is in ⋯. | — |
| Clarity | 9 | Plain labels. | — |
| States & feedback | 9 | Loading spinner, "Receipt not found / Not available", unpaid and discarded messages, Refunded/Void badges, `role=status` notice. | — |
| Responsive | 9 | Phone folds the paper into "Receipt preview" and the toolbar becomes icon Print + full-width New sale; desktop centred at `max-w-6xl`. | — |
| Accessibility | 9 | Icon-only Print has `aria-label` + description; "Refund Foot spa 45" names the line; touch spec covers the receipt. | — |

### 6. Refund (extra-refund-ipad/phone/desktop, ux-p4-ipad-manager-refund)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 7 | The two loudest things in the form are the solid-black "All" and "Card" selections. The submit, the only action, is a pale outline until a reason is picked, and even then it's only a red-outline button. Your eye goes to settings, not the action. | Subtle selection (see Consistency). Then the destructive-outline submit is the only strong element. Keep `min-h-11` and make it `min-h-12 text-[15px]`. |
| Typography | 9 | 15px semibold title, 12px muted group labels, sans tabular amount. | — |
| Layout & spacing | 8 | Phone: "Refund to" is `grid-cols-3` with 5 options, so it wraps 3+2 with an empty cell. Reason chips wrap 2+1. The amount row is `grid-cols-[1fr_1fr_6rem]`, so when Half is hidden (`half >= all`) the input slides into the middle column and leaves a blank 6rem track. | `RefundForm.tsx`: methods → one `ToggleGroup variant="segmented" tone="subtle"` with `grid grid-cols-[1fr_1.4fr_1fr_1.2fr_1fr] text-[13px] @md:text-sm` (fits about 310px, as the split picker proves). Amount row → `grid-cols-[repeat(auto-fit,minmax(0,1fr))_6rem]`, or render a disabled placeholder Half. |
| Consistency | 7 | Locked decision: strong (`bg-foreground`) is only for the checkout tender/mode track, and every other form toggle is subtle. The refund amount and "Refund to" use strong black pills, built from a bespoke `REFUND_CHIPS` selector string instead of `ui/toggle-group.tsx`. The brief also asks for "Refund to" as a segmented control. | Replace both chip groups with `ToggleGroup variant="segmented" tone="subtle"` (All · Half as one track; methods as above) and delete the `aria-pressed=true` bg-foreground rules from `REFUND_CHIPS` (keep only the ReasonField sizing). |
| Color & contrast | 8 | Black-filled selections in a destructive flow carry no meaning and compete with the red action. | Fixed by `tone="subtle"`. |
| Efficiency | 9 | Opens ready to send: All, original tender, one reason chip. | — |
| Clarity | 9 | "Records money already returned to the guest."; the submit says "Pick a reason" until it can be used; "Ask a manager" variant for cashiers. | — |
| States & feedback | 9 | Readable disabled submit, spinner, "Retry same refund" after a lost answer, server cap rewrites the amount, "A request is already waiting", amber tint when it becomes a request. | — |
| Responsive | 8 | Phone wraps (above). The form is fine on iPad and desktop. | Same `RefundForm.tsx` track fix. |
| Accessibility | 9 | `role=group` + `aria-pressed`, labelled amount with hint, title focused on open, Escape cancels. | — |

### 7. Orders sheet (extra-orders-ipad/desktop, ux-p2b-phone-orders)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Rows first (order · customer · items · due), lookup below a divider. | — |
| Typography | 9 | 14 semibold title, 12 muted meta, 15 semibold sans due. | — |
| Layout & spacing | 9 | `min-h-14` rows, right panel on iPad and desktop, bottom sheet on phone. | — |
| Consistency | 9 | Shares the `panel` dialog with the other checkout side panels. | — |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | One tap to open; the lookup accepts "1043", "#1043" and "Order #1043". | — |
| Clarity | 7 | The description says "Find a paid order by its order number (#)." The list right under it is open, unpaid orders (`OpenOrders` for cashiers), and nothing labels it. "· on screen" is jargon. | `OrderStrip.tsx` (around line 194): cashier description → "Open orders on every till. Look up today's receipts by order number." Add `<p className="text-xs text-muted-foreground">Open</p>` above `OpenOrdersList`. Replace "· on screen" with a `Badge variant="secondary"` "Current" (and `aria-label` "…, current order"). |
| States & feedback | 9 | Spinner, "No open orders.", load more, receipt-number hint ("That's the receipt number…"), "Not available. Check the number…", inline error boundary with Retry. | — |
| Responsive | 9 | Designed per viewport. | — |
| Accessibility | 9 | Rows `aria-current`, labelled lookup, errors `role=alert` + `aria-describedby`; touch spec covers Orders. | — |

### 8. Approvals sheet (extra-approvals-phone/desktop, ux-p1-ipad-manager-approvals)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The line name (15px medium) and the ask (15px semibold) are the same size, so the card has two headlines. The decision data (Total ฿1,200 → ฿1,020) sits in muted 14px. | `ApprovalsPanel.tsx` (around line 141): line name → eyebrow `text-xs text-muted-foreground` combined with the order ("Thai massage 60 · Order #1043"). Keep the ask at 15 semibold. Drop `title ·` from the totals line, since the order is now in the eyebrow. |
| Typography | 8 | "16.67%" shows two decimals. On phone the bold ask breaks as "Mint asks for a ฿100 / discount (16.67%)". | `staff-approvals.ts` `approvalAsk`: display percent rounded to one decimal (`16.7%`; display only, the ฿ amount is what's approved). Add `text-balance` (replacing `text-pretty`) on the ask line. |
| Layout & spacing | 9 | Card rhythm fine. | Nit: on touch the 44px ⓘ hit box leaves a wide gap after "Expires in 5 min". Use `-ml-2` on the InfoTip trigger. |
| Consistency | 8 | Approvals uses `SheetContent side="right"`: a square-edged sheet everywhere, and on phone a side drawer. Orders, the order sheet and every other checkout layer use the `panel` dialog (rounded-l-2xl right panel from md, bottom sheet on phone). | Swap to `<CheckoutDialogContent panel …>` (as Orders does), keeping the title-focus and toast hooks. |
| Color & contrast | 9 | Amber when ≤ 2 min; gold quote rule. | — |
| Efficiency | 9 | Approve/Decline one tap on the card. | — |
| Clarity | 9 | "Mint asks for a ฿180 discount (15%)", quoted reason, before → after. | — |
| States & feedback | 9 | Loading, "Nothing waiting.", per-card error, "Expiring now" (display only, per lock), toast on close, `role=status` notice. | — |
| Responsive | 8 | Phone: `w-80 max-w-[calc(100vw-2rem)]` leaves a 32px sliver of the blurred page on the left and squeezes the cards to about 300px, which causes the wrap above. | The `panel` dialog swap gives a full-width bottom sheet on phone. |
| Accessibility | 9 | Title receives focus on open (not Decline); labelled ⓘ; touch spec covers approvals. | — |

---

## Below 9, sorted by impact

1. Refund · Consistency · 7: strong black pills violate the locked tone rule, and they aren't a ToggleGroup. Use `ToggleGroup variant="segmented" tone="subtle"` for All/Half and Refund-to in `RefundForm.tsx`, and strip the `aria-pressed=true` bg-foreground rules from `REFUND_CHIPS`.
2. Refund · Hierarchy · 7 (and Color · 8): the same fix makes the destructive-outline submit the only strong element. Bump it to `min-h-12 text-[15px]`.
3. Orders · Clarity · 7: the description says "paid" over a list of open orders. New copy, an "Open" label, and a "Current" badge replacing "· on screen" (`OrderStrip.tsx`).
4. Line editor · Typography / Layout / Consistency · 8: "Split payment" wraps in the 4-up tender row. Visible label "Split", keep `aria-label` (`OrderPanel.tsx`). Make the coupon button ghost like ⋯.
5. Approvals · Consistency / Responsive · 8: phone side drawer with a 32px sliver. Move to `CheckoutDialogContent panel` (`ApprovalsPanel.tsx`).
6. Refund · Layout / Responsive · 8: phone methods wrap 3+2 and the amount grid leaves a blank track without Half. 5-up subtle track `grid-cols-[1fr_1.4fr_1fr_1.2fr_1fr] text-[13px]`, auto-fit amount row.
7. Catalog start · Layout / Responsive · 8: iPad tiles wrap the photo onto its own row. Use `flex-nowrap` and a `min-w-0 flex-1` text column in `CatalogPane.tsx`.
8. Receipt · Hierarchy · 8: the "Paid" outcome is a 12px pill. Use an h-6 13px chip with ✓, and the amount in foreground medium in the sub-line (`ReceiptView.tsx`).
9. Approvals · Hierarchy / Typography · 8: two equal headlines and "16.67%". Line name + order as a 12px eyebrow, percent to one decimal, `text-balance`.
10. Split · Layout / Clarity · 8: misaligned ฿ between the input and the "Rest" output, and the redundant "Amount" label. Same ฿ prefix span on the output, sr-only label, "fills the rest" meta.
11. Line editor · Clarity · 8: bare ticket icon, "0%" placeholder, and a vague "History". Labelled "Coupon" from sm, placeholder "None", hide History until there are entries.
12. Line editor · Layout · 8: blank band between History and totals on desktop. Move History into the footer as a link-row.

## Visual bugs

- **"Split payment" wraps to two lines** in the tender row: extra-line-open-ipad.png, extra-line-open-desktop.png.
- **iPad catalog tiles wrap**: the photo sits alone on the top row with about 130px of dead space beside it: extra-checkout-start-ipad.png, extra-line-open-ipad.png, extra-cash-panel-ipad.png, extra-split-ipad.png.
- **Refund-to wraps 3+2 with an empty cell; reason chips wrap 2+1**: extra-refund-phone.png.
- **Approvals ask breaks awkwardly** ("Mint asks for a ฿100 / discount (16.67%)"): extra-approvals-phone.png.
- **Approvals phone drawer leaves a 32px sliver** of the blurred page on the left: extra-approvals-phone.png.
- **฿ misaligned between split rows** (prefix left + number right, versus "฿700" right-aligned): extra-split-ipad/phone/desktop.png, ux-p3-ipad-split.png.
- **Wide gap between "Expires in 5 min" and its ⓘ** on touch: extra-approvals-phone.png, ux-p1-ipad-manager-approvals.png.
- **Blank band between "History" and Subtotal** in the desktop order panel: extra-line-open-desktop.png.
- **Pressed cash chip looks like a focus ring** (ring-2 around "Exact" / "฿1,500"): extra-cash-panel-*.png, extra-cash-1500-desktop.png (nit).
- **Cash ฿ prefix far from the digits** in the wide input: extra-cash-panel-desktop.png (nit).

## Per-screen averages

| Screen | Avg |
|---|---|
| Cash panel | 9.0 |
| Receipt | 8.9 |
| Checkout start | 8.8 |
| Split payment | 8.8 |
| Orders sheet | 8.8 |
| Order line editor | 8.6 |
| Approvals sheet | 8.6 |
| Refund | 8.3 |
| **Area average** | **8.7** |

Screens at 9+ in every category: **1 / 8** (Cash panel).
