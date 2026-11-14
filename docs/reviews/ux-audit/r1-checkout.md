# R1 audit · Checkout / point of sale

Graded against `scorecard-rubric.md` and `visual-brief.md` from `docs/screenshots/audit-r1/`, plus `src/components/checkout/*` and `src/components/ui/*` for states the shots don't show. iPad 1180×820 and phone 390×844 are touch screens.

Note on target sizes: `Button`, `ToggleGroupItem` and `TOUCH_TARGETS` (checkout-ui.ts:59) add `pointer-coarse:min-h-11 min-w-11`. The screenshots look like they were taken with a fine pointer, so some controls look smaller (36–40px) than they are on a real iPad. I scored accessibility on the code, not the pixel height in the shots.

## Summary

| Screen | Hier | Type | Layout | Consist | Color | Effic | Clarity | States | Resp | A11y | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 Catalog / new order | 8 | 9 | 8 | 8 | 9 | 9 | 8 | 9 | 9 | 9 | **8.6** |
| 2 Order line editor + tenders | 8 | 8 | 8 | 7 | 8 | 9 | 8 | 9 | 9 | 9 | **8.3** |
| 3 Cash panel | 9 | 9 | 8 | 8 | 8 | 9 | 9 | 9 | 9 | 9 | **8.7** |
| 4 Split payment | 7 | 8 | 7 | 7 | 8 | 9 | 7 | 8 | 8 | 8 | **7.7** |
| 5 Receipt | 8 | 9 | 7 | 8 | 9 | 9 | 8 | 9 | 8 | 9 | **8.4** |
| 6 Refund form | 8 | 8 | 7 | 8 | 8 | 9 | 8 | 9 | 7 | 9 | **8.1** |
| 7 Approvals sheet | 9 | 8 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **8.9** |
| 8 Orders sheet | 8 | 9 | 8 | 8 | 8 | 8 | 8 | 9 | 9 | 9 | **8.4** |

**Area average: 8.4.** No screen reaches 9 yet. Split and Refund are furthest off. The one fix that helps most is making every choice control in checkout the same component: one segmented track and one selected style.

---

### 1 · Catalog / new order (extra-checkout-start-ipad.png, extra-checkout-start-phone.png, ux-p1-phone-cashier-till.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Catalog reads well. The empty iPad order panel is 380×520px of blank space with one 14px muted line. The phone till header gives "Sign out" (outline button) the same weight as page actions. | `OrderPanel.tsx:224` empty state: add a `ReceiptText` icon `size-8 text-muted-foreground/60` and "No items yet" at `text-[15px] font-medium text-foreground`, with "Tap an item to add it." at 13px muted below. Phone header: move Sign out into the account/⋯ menu and keep only the `Cashier` chip. |
| Typography | 9 | Tile name 15px medium, price 15px semibold sans tabular, meta 12px. | — |
| Layout & spacing | 8 | Phone till header is crowded: Checkout title, Cashier chip and Sign out button together, with no breathing room before the title. On iPad the catalog ends at y≈510 and the 300px below is empty while the order pane also sits empty. | Same Sign out move as above. Optional: on iPad, `@min-[34rem]:min-h-[96px]` tiles to use the height, or show a "Spa" group under "Frequent". |
| Consistency | 8 | iPad: "Add customer" and "Add booking" are outline pills, "Orders" is ghost, "New order" is outline. Phone uses "Customer" plus an icon-only Orders button and hides Add booking in ⋯. The same jobs get different labels. | `OrderStrip.tsx:153`: use "Customer" on iPad too (it becomes the name once set), and make Orders the same outline `Button` on both. Keep Add booking as the one extra iPad action. |
| Color & contrast | 9 | Gold "+" and navy count badge are decorative. Text contrast is fine. | — |
| Efficiency | 9 | Phone bar gives "Cash ฿1,200" in one tap, prefilled exact. Tile tap adds the item. | — |
| Clarity | 8 | iPad empty panel says the same thing twice: "Tap an item to add it to the order." and the footer's "Add an item to take payment." | `OrderPanel.tsx:305`: render nothing in the footer while `lines.length === 0`. The body hint is enough. |
| States & feedback | 9 | Loading grid (`role=status`), "Nothing to sell here yet.", error banner with dismiss and retry, discarded-order read-only state. | — |
| Responsive | 9 | Phone has a bottom bar, and the catalog has `pb-28` so the bar never hides the last tile. iPad uses a two-pane layout. | — |
| Accessibility | 9 | Whole tile is the button with `sr-only` "Add to order", the count has `sr-only` text, and touch targets are coarse-safe. | — |

### 2 · Order line editor + tender row (extra-line-open-ipad.png, extra-line-open-phone.png, ux-p2-phone-line-open.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | "Balance due ฿1,200" is a clear hero. Below it, a navy filled "Cash" among three outline buttons reads as a *selected segment*, not "pay cash now". "Split" floats alone bottom-right as bare text. | `OrderPanel.tsx:293-302`: replace the 4-up grid with one primary full-width `Button className="h-14 w-full text-base font-sans tabular-nums"` reading "Cash ฿1,200" (same wording as the phone bar), then `grid grid-cols-4 gap-2` of `variant="outline" h-11` for PromptPay · Card · Transfer · Split. Drop the "Pay ฿1,200 by" label. |
| Typography | 8 | iPad line meta wraps "60 min · Any therapist · Not" / "scheduled", leaving an orphan. The "PromptPay" label touches its button edges (`px-1`). The discount placeholder "10% or ฿120" renders larger than the 14px "Discount" label and reads like a value. | `OrderPanel.tsx:427-440`: meta `text-[13px] text-balance`, or render "Not scheduled" as its own amber chip (same as the receipt). Tender buttons `px-3` (the fix above gives room). Discount input: `placeholder="0"` and put "10% or ฿120" in the limit line ("Up to 10% without approval · type 10% or ฿120"). |
| Layout & spacing | 8 | The inset settings list follows the brief: 48px rows, dividers, centred "Remove item". The lone "Split" adds a 44px row of dead space under the tenders. | Folded into the tender-row fix. |
| Consistency | 7 | The same choice (payment method) is a 4-button rounded-xl grid here and a `rounded-full bg-muted` segmented track in the pay panel. "Not scheduled" is muted text here but an amber chip on the receipt. | The tender-row fix above. Use one `NotScheduledChip` (amber-50/amber-800, `rounded-full px-2 py-0.5 text-xs`) in both OrderPanel and ReceiptView. |
| Color & contrast | 8 | Navy on one tender implies state. | Fixed by making it an explicit "Cash ฿1,200" action. |
| Efficiency | 9 | Cash opens prefilled with the exact amount, so it's one more tap to confirm. Discount, schedule and price are inline. | — |
| Clarity | 8 | "Pay ฿1,200 by" repeats the hero amount. "Split" on its own is unclear: split what? | Copy: the action is "Cash ฿1,200". The secondary is "Split payment" (visible text, not just the aria-label). |
| States & feedback | 9 | Tenders lock when the order is stale, the coupon is blocked or an approval is waiting. There's a manager-request flow with spinner and error, and "Close order · nothing due". | — |
| Responsive | 9 | Phone sheet puts tenders at thumb height. `max-height:32rem` handling folds Split into the row. | — |
| Accessibility | 9 | Discount is labelled with `aria-describedby` for the limit, the line toggle has `aria-expanded`, and steppers have aria labels. | — |

### 3 · Cash panel (extra-cash-panel-ipad.png, extra-cash-panel-phone.png, ux-p3-phone-cash-1500.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | "Balance due" 12px with ฿1,200 at 40px semibold sans. The input is h-14, the Change block shows ฿300 at 32px emerald, and "Confirm cash" h-14 is the only primary. | — |
| Typography | 9 | Follows the brief's scale. Money is sans tabular. | — |
| Layout & spacing | 8 | "Split" sits outside the segmented track as loose text, and "Transfer" butts against the track's right end, so the row looks clipped. | `PayPanel.tsx:367` TenderRow: make Split a real outline pill `variant="outline" h-11 rounded-full px-4` with `gap-2` from the track, or a fifth segment inside the track. |
| Consistency | 8 | Quick-chip selected state is `bg-muted` plus a dark border. The segmented control and refund chips use a solid `bg-foreground text-background`. That's three selected styles in one flow. | `PayPanel.tsx` CashForm chips: replace `aria-pressed:border-foreground aria-pressed:bg-muted` with `aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:border-foreground`. |
| Color & contrast | 8 | Selected "Exact"/"฿1,500" differs from unselected only by a faint fill (≈1.05:1) and border weight. | Same as above. |
| Efficiency | 9 | Opens on exact, note chips give the change in one tap, and the time defaults to now. | — |
| Clarity | 9 | "Cash received", "Change", "Short", "Received now · Edit time". All plain. | — |
| States & feedback | 9 | Amber "Short" block, disabled Confirm until enough cash, spinner, "Retry payment" with the same key, order-changed guard, coupon-refused recovery. | — |
| Responsive | 9 | The phone sheet keeps Confirm in thumb reach and stays sticky above the keyboard on short viewports. The iPad card sizes to its content. | — |
| Accessibility | 9 | Labelled input, `aria-pressed` chips, `role=status` change, Escape returns focus to the tender. | — |

### 4 · Split payment (extra-split-ipad.png, extra-split-phone.png, ux-p3-ipad-split.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 7 | Three identical pill tracks stack up (the mode switch plus one per payment row), all with the same weight. The largest thing after the due amount is "฿0", which carries no information. | `PayPanel.tsx` SplitForm: show a **Remaining** hero row (`text-[28px] font-semibold font-sans tabular-nums`, amber-800 on `bg-amber-50` while > ฿0). Once it reaches zero, replace it with an emerald "Covered ✓" line at 15px, not a 28px "฿0". |
| Typography | 8 | Per-row method labels are `text-xs` (12px) in 44px pills, smaller than body text for the main choice. "Auto balance" is 12px floating over one input only. | Row segments `text-sm`. Give every row a 12px muted header ("Payment 1", "Payment 2 · rest"). |
| Layout & spacing | 7 | iPad: row 2 has an "Auto balance" label that row 1 lacks, so the rows have different heights and the inputs don't line up. Phone: segment and amount stack, separated only by hairlines, so it's hard to see which amount belongs to which method. | Each row as `rounded-xl bg-muted/40 p-3 grid gap-2`: header line (label left, × right), then `grid grid-cols-[1fr_8rem] gap-2` with segment and amount on iPad, stacked on phone inside the same tinted box. |
| Consistency | 7 | Per-row method tracks are visually identical to the mode track above, so they read as a second mode switch. Selected "Split" is a detached black circle beside the track. | Row tracks: `bg-background border border-border` (outline track) to set them apart from the `bg-muted` mode track. Split as an outline pill (see screen 3). |
| Color & contrast | 8 | Gold focus border on the input is fine. Validation text is 12px amber-800, which passes, but it's the only signal while the split is incomplete. | Fixed by the amber Remaining hero. |
| Efficiency | 9 | Two-way split takes one typed amount because the last row takes the rest. Confirm spells out both tenders. | — |
| Clarity | 7 | "Auto balance" and "Fully allocated" are accounting jargon. Rows aren't numbered. | Copy: "Auto balance" → "Rest", "Fully allocated" → "Covered". Validation stays "Enter an amount for payment 1." |
| States & feedback | 8 | Before every amount is filled there's no summary, only the 12px validation line. "Over by" turns red. Remove (×) appears only with more than two rows. | The Remaining row above, always visible (amber > 0, red when over, emerald when covered). |
| Responsive | 8 | On iPad the 380px panel squeezes four 12px segments next to a 96px input. | `sm:basis-60` → stack the segment over the amount below `xl` (panel < 440px): `xl:grid-cols-[1fr_8rem]`. |
| Accessibility | 8 | Row 1's amount has only an `aria-label`, with no visible label. Invalid inputs rely on a red border. | Visible "Amount" label per row (header line above). Keep `aria-describedby` on the validation line. |

### 5 · Receipt (extra-receipt-ipad.png, extra-receipt-phone.png, ux-p4-phone-manager-receipt.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | "New sale" is the clear primary, but nothing confirms the payment went through. The title "Receipt R-000142" has the same weight before and after a refund (only a "Refunded" chip exists). | `ReceiptView.tsx:235`: add an emerald "Paid" chip (`bg-emerald-50 text-emerald-800 rounded-full px-2 py-0.5 text-xs font-medium`) next to the title, matching the existing "Refunded" chip. |
| Typography | 9 | Paper in mono 13px, money sans tabular, item rows 15px medium. | — |
| Layout & spacing | 7 | iPad: the receipt is capped at `max-w-sm` inside a 5fr column, leaving a ~100px gutter against the 32px gap, so the two columns don't share a rhythm. The bottom 40% of the screen is empty. | `ReceiptView.tsx:226`: `lg:grid-cols-[24rem_minmax(0,1fr)]` (receipt column = paper width), or `lg:max-w-none` on the article. Optionally make the receipt column `lg:sticky lg:top-4`. |
| Consistency | 8 | "Link appointment" is outline and "Refund" right next to it is ghost bold text, so they look like a button and a label. "Not scheduled" styles differ between screens (see screen 2). | Refund `variant="outline"` with `text-destructive border-destructive/40`, or both outline. Use the shared `NotScheduledChip`. |
| Color & contrast | 9 | Amber chip text is amber-800 on amber-50 (≈6:1). | — |
| Efficiency | 9 | New sale is one tap, Print is one tap, Link appointment is inline per line. | — |
| Clarity | 8 | The printed paper says "Not scheduled" under each service. That's internal state on a guest document (`checkout-ui.ts:114`). | `receiptSchedule()`: return `null` instead of "Not scheduled". Keep the screen-only chip in the Items card. |
| States & feedback | 9 | Loading spinner, "Receipt not found", unpaid and discarded states, line notes after a refund or link, void stamp. | — |
| Responsive | 8 | Phone: icon-only Print plus a wide New sale works. iPad: see the gutter above. | See Layout. |
| Accessibility | 9 | Print has an aria-label and print help, Refund buttons name their line, there's a toolbar role. | — |

### 6 · Refund form (extra-refund-ipad.png, extra-refund-phone.png, ux-p4-ipad-manager-refund.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The form opens under its line, as briefed. Every chip is bold 14px, so amount chips, method, reason chips and submit all carry the same weight. | Reason chips `font-medium` (not semibold). Keep semibold only on the selected amount and the submit. |
| Typography | 8 | Label scale is mixed: "Refund to" 12px muted vs "Reason (required)" 14px medium. Method segments `text-xs`. | `RefundForm.tsx`: pass ReasonField a 12px muted label (`label="Reason"` with `[&_label]:text-xs [&_label]:text-muted-foreground`). Method segments `text-sm`. |
| Layout & spacing | 7 | Phone: the "Refund to" track wraps into 3 + 2 (a two-row segmented control), reason chips stack one per line, and the amount input sits alone on its own row. | Method group on phone: `max-sm:grid max-sm:grid-cols-3 max-sm:gap-2 max-sm:bg-transparent max-sm:p-0` with items `max-sm:rounded-full max-sm:border` (intentional chip grid, not a broken track). Put the amount input on the All/Half row with `w-24`. |
| Consistency | 8 | Refund method segments use `text-xs` while pay segments use `text-sm`. All/Half selected is solid black but cash quick chips are muted. | One selected style (see screen 3). `text-sm` segments everywhere. |
| Color & contrast | 8 | The disabled "Record refund ฿600" is grey on near-white and looks broken rather than waiting. | Keep it disabled, but put the reason hint *in* the button's place: show "Pick a reason" as the disabled label, then "Record refund ฿600" once ready. |
| Efficiency | 9 | Defaults to All, the original tender, and one reason chip finishes it. | — |
| Clarity | 8 | The instruction appears three times: "Reason (required)", the "Pick one or type" placeholder and "Pick or type a reason to record the refund." | Drop the helper line (`RefundForm.tsx:186`) and "(required)". Placeholder "Or type a reason". Shorten chips: "Short treatment", "Complaint", "Charged in error". |
| States & feedback | 9 | Ask-a-manager amber variant, "Retry same refund" with key reuse, server cap, "A request is already waiting". | — |
| Responsive | 7 | The phone wrap and stacking above. iPad: once the form opens, the page header (Print/New sale) scrolls under the app bar half-clipped. | Phone fixes above. iPad: `ReceiptView` header `lg:sticky lg:top-0 lg:z-10 lg:bg-background/90 lg:backdrop-blur` so actions are never half-cut. |
| Accessibility | 9 | Labelled amount (sr-only), group labels, focus moves to the title, Escape cancels. | — |

### 7 · Approvals sheet (ux-p1-ipad-manager-approvals.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Request, quote, before → after total, Approve primary. | — |
| Typography | 8 | The headline wraps with an orphan "60" and is 14px semibold, when a row title should be 15px medium. "Expires in 5 min" is 12px with no urgency styling. | `ApprovalsPanel.tsx:124`: `text-[15px] font-medium text-balance`. Expiry `text-amber-800` when ≤ 2 min. |
| Layout & spacing | 9 | Card in a 448px sheet, actions bottom-right. | — |
| Consistency | 9 | Card surface, sheet header matches Orders. | — |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | Approve/Decline right on the card. | — |
| Clarity | 9 | "Mint asks for a ฿180 discount (15%)…" is plain. | — |
| States & feedback | 9 | Loading, "Nothing waiting.", "Expiring now", error, result notice. | — |
| Responsive | 9 | — | — |
| Accessibility | 9 | Count badge has `sr-only` "waiting", buttons are h-11. | — |

### 8 · Orders sheet (ux-p2b-phone-orders.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The list is clear, but the lookup at the bottom has a faint disabled "Go" that reads as a broken button. | `OrderStrip.tsx:680`: `disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground`, or hide Go until typed (Enter submits). |
| Typography | 9 | Order 14px semibold, meta 12px, amount sans tabular. | — |
| Layout & spacing | 8 | A two-sentence description sits between the title and the list. | Drop the description. Add a 12px muted "Open" header above the list and "Find a receipt" as the lookup label. |
| Consistency | 8 | "Go" is an outline submit, while other single-input forms use a primary submit. | `variant="default"` for Go. |
| Color & contrast | 8 | Disabled Go is ≈2:1. | See Hierarchy. |
| Efficiency | 8 | Today's receipts are reachable only by order number. | Accept the permission-limited lookup for cashiers. For managers, add a "Today's receipts" link to the existing filtered list (`FILTERS`) under the lookup. |
| Clarity | 8 | "Open orders, newest first. For today's receipts, enter the order number." covers two ideas in the description. | See Layout copy. |
| States & feedback | 9 | Loading, "No open orders.", error boundary, "Not available. Check the number…". | — |
| Responsive | 9 | Bottom sheet, list `max-h-[50dvh]`. | — |
| Accessibility | 9 | Rows have full aria labels including "on screen", and the input is labelled. | — |

---

## Visual bugs

1. **extra-refund-phone.png**: the "Refund to" segmented control wraps into two rows (Cash/PromptPay/Card, then Transfer/Other).
2. **extra-split-phone.png / extra-split-ipad.png / ux-p3-ipad-split.png**: the selected "Split" is a cramped black circle detached from the tender track, and the label fills the circle edge to edge on phone.
3. **extra-split-ipad.png / ux-p3-ipad-split.png**: row 2 has an "Auto balance" label that row 1 lacks, so the two rows' inputs don't line up vertically.
4. **extra-split-* / ux-p3-ipad-split.png**: three identical pill tracks stacked, so per-row method controls look like duplicate mode switches.
5. **extra-cash-panel-ipad.png / extra-cash-panel-phone.png / ux-p3-phone-cash-1500.png**: "Transfer" butts against the right end of the track and "Split" floats as loose text outside it.
6. **extra-cash-panel-* / ux-p3-phone-cash-1500.png**: the selected quick chip ("Exact", "฿1,500") is barely different from unselected (faint fill only).
7. **extra-line-open-ipad.png**: line meta wraps "…Any therapist · Not" / "scheduled", leaving an orphan word.
8. **extra-line-open-ipad.png / extra-line-open-phone.png / ux-p2-phone-line-open.png**: "PromptPay" label touches its button edges. "Split" floats alone bottom-right, leaving a dead row.
9. **extra-receipt-ipad.png**: ~100px gutter between the receipt paper and the Items card, against a 32px page margin, so the columns are misaligned.
10. **extra-refund-ipad.png / ux-p4-ipad-manager-refund.png**: page header (order subline, Print and New sale) half-clipped under the app header once the refund form opens.
11. **extra-refund-phone.png / extra-refund-ipad.png**: the disabled "Record refund ฿600" button is faint grey on grey.
12. **ux-p2b-phone-orders.png**: the disabled "Go" button is faint (≈2:1).
13. **ux-p1-ipad-manager-approvals.png**: request headline wraps to an orphan "60".
14. **ux-p1-phone-cashier-till.png**: the header crams the Checkout title, Cashier chip and Sign out button together.
15. **extra-receipt-* / ux-p4-phone-manager-receipt.png**: "Not scheduled" printed on the guest receipt paper (not a layout bug, but a visible content defect).
