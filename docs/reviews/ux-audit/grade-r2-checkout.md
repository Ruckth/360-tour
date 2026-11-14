# R2 grade · Checkout / point of sale

Graded from `docs/screenshots/audit-r2/` (iPad 1180×820 and phone 390×844, touch-emulated) plus the code in `src/components/checkout/` and `src/components/ui/` for states a screenshot can't show. Rubric: `scorecard-rubric.md`. House rules: `visual-brief.md`. Every fix below is visual or layout only. Approvals, attempt keys, revision checks and permission gates all stay.

**Area average: 8.6.** No screen reaches 9 overall. The money core is strong: the cash panel, change and short states, retry-same-attempt copy and refund defaults are all good. What holds the area back is mostly mechanical:
1. The iPad order and receipt columns use **nested scroll regions** that clip content.
2. **Chip and segmented styles** differ inside a single form (split, refund).
3. A few dark fills compete with the primary button.

---

### 1 · Catalog and empty order (extra-checkout-start-ipad, extra-checkout-start-phone, ux-p1-phone-cashier-till)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The catalog is clearly the task. Tiles show name, meta and price in a clean ladder. On the phone, the quick "Cash ฿1,200" in the bottom bar is the obvious primary. | — |
| Typography | 9 | Tile name 15, meta 12 muted, price semibold sans tabular. "No items yet" is 15 medium over 13 muted. | — |
| Layout & spacing | 8 | iPad: the catalog grid stays at 2 columns across about 736px, so the tiles are 362px wide and mostly empty space. The empty order card ends in a bare footer band with a top border (about y 770) holding nothing. | `CatalogPane.tsx` L125: change `@min-[53rem]:grid-cols-3` to `@min-[46rem]:grid-cols-3`, and clamp tile names with `line-clamp-2`. `OrderPanel.tsx` L249: render the footer `div` only when `lines.length > 0`, or drop `border-t` when it is empty. |
| Consistency | 8 | ux-p1-phone-cashier-till shows two identical ⋯ buttons stacked 34px apart: the app header account menu and the order strip's "More checkout actions". extra-checkout-start-phone has only one, so the header changes between captures. | `AdminShell.tsx` "Account menu" trigger: show the staff initials in a `size-9 rounded-full bg-muted text-xs font-semibold` avatar instead of ⋯ (`pointer-coarse:size-11`). The order ⋯ then has a single meaning. |
| Color & contrast | 9 | Gold is used only as a brand accent on icons and the + rings. The navy count badge is clear. | — |
| Efficiency | 9 | One tap adds an item. On the phone, quick Cash in the bar saves the trip into the sheet. | — |
| Clarity | 9 | Plain labels ("Customer", "Add booking", "Orders"). Nit: the navy "1" badge on a tile would read better as "1 in order" for screen readers (check its aria). | — |
| States & feedback | 9 | Skeleton tiles, "Nothing to sell here yet.", search-empty state, error banner with Try again (`CheckoutView.tsx` L159). | — |
| Responsive | 8 | Phone: with zero items the bar still renders as a full-width "View order · No items yet" button that opens an empty sheet. iPad: see Layout (2 columns, empty footer). | `CheckoutView.tsx` L209: when `!count`, render the bar as a non-interactive hint (`<p>` with the same styling, no ChevronUp), or hide it. |
| Accessibility | 9 | `TOUCH_TARGETS` enforces 44px on coarse pointers, the search has a label, tiles have focus rings, and `touch-targets-a.spec.ts` covers this state. | — |

### 2 · Order line editor (extra-line-open-ipad, extra-line-open-phone, ux-p2-phone-line-open)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Phone is right. On iPad the pinned footer (coupon, totals, 40px due, Cash, plus a 2×2 tender grid, about 340px) takes the panel. The open editor gets about 240px, so the edit you opened loses to the payment block. | Compact the iPad footer while a line is open (see Layout). |
| Typography | 8 | The Schedule row value "Any therapist · Not scheduled" is `text-xs` (12px). That is below the 13px value size the brief sets for settings rows. | `OrderPanel.tsx` L604: `text-xs` → `text-[13px]`. Do the same for the discount limit line at L848. |
| Layout & spacing | 7 | extra-line-open-ipad: the editor is clipped inside its scroll area. The Price row's divider is cut at about y 455, and "Remove item" and History sit below the fold with no scroll cue. | `OrderPanel.tsx` L294: at `lg` force the four tender buttons into one row (`lg:grid-cols-4 lg:min-h-10`). Hide the dashed "Add coupon" row while a line editor is open (the header coupon icon at L177 already covers it). Optionally widen the panel `lg:w-[420px]` in `CheckoutView.tsx` L185. |
| Consistency | 9 | Inset settings list with 48px rows and the label-left, control-right pattern, as briefed. "Remove item" is centred destructive text. | — |
| Color & contrast | 9 | Amber "Not scheduled" chip, red Remove, otherwise neutral. | — |
| Efficiency | 9 | Discount is typed inline. Price and Schedule are one tap each. Qty steppers sit on the row. | — |
| Clarity | 8 | The schedule state appears three times: the subtitle "60 min · Any therapist", the "Not scheduled" chip, and the Schedule row "Any therapist · Not scheduled". | `OrderPanel.tsx` L428: hide the chip when the editor is open (`!open &&`). The row already says it. |
| States & feedback | 9 | "Saving…", discount echo and over-limit hint, inline approval request with reason chips, source-changed banner with Update/Remove. | — |
| Responsive | 7 | Phone uses the full sheet well. iPad squeezes the editor into a small inner scroller on an 820px-tall screen (see Layout). | Same fix as Layout. |
| Accessibility | 9 | Line toggle has `aria-expanded`. Discount has a visible label and `aria-describedby`. Coarse-pointer min sizes come from the Button base. | — |

### 3 · Cash payment (extra-cash-panel-ipad, extra-cash-panel-phone, ux-p3-phone-cash-1500)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The 40px "Balance due" hero and h-14 "Confirm cash" are right. But three solid dark fills stack up: the selected tender "Cash", the selected "Exact" or "฿1,500" chip, and Confirm. The near-black chip reads heavier than the navy primary. | `PayPanel.tsx` CashForm chips (L563–575): replace `aria-pressed:bg-foreground aria-pressed:text-background` with `aria-pressed:border-foreground aria-pressed:bg-foreground/5 aria-pressed:ring-1 aria-pressed:ring-inset aria-pressed:ring-foreground`. Confirm then stays the only filled button below the tenders. |
| Typography | 9 | Cash input is 24px right-aligned with a muted sans ฿. Change is 32px semibold emerald. Received-at line is 13px. | — |
| Layout & spacing | 9 | The iPad panel hugs its content (`has-[pay-panel]:self-start`) with no dead space. The phone half-sheet keeps the keypad area clear. | — |
| Consistency | 9 | Segmented tender row as briefed, standard Button and Input. | — |
| Color & contrast | 9 | Emerald for change, amber for short, nothing decorative. | — |
| Efficiency | 9 | Opens at Exact, so an exact sale is one tap. Note chips cover the common hand-overs. | — |
| Clarity | 9 | "Cash received", "Change", "Received now · Edit time". | — |
| States & feedback | 9 | Short block (amber) disables Confirm. Spinner while submitting. "Retry sends the same payment…" after a lost answer. Order-changed guard. Coupon refusal with fix actions. | — |
| Responsive | 9 | iPad side panel and phone bottom sheet both fit. The sticky confirm handles short viewports. | — |
| Accessibility | 9 | Tender `role=group` with `aria-pressed`, labelled cash input, Change is `role=status`, "Edit payment time" has an aria-label. | — |

### 4 · Split payment (extra-split-ipad, extra-split-phone, ux-p3-ipad-split)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | No "Remaining" hero. Before coverage the only signal is a 12px amber line. Three segmented tracks of equal weight (the tender row plus one per payment) dominate. | `PayPanel.tsx` SplitForm L674: when `!ready && remaining > 0`, render `<p className="flex items-baseline justify-between rounded-xl bg-amber-50 p-3 text-amber-800"><span className="text-sm">Remaining</span><span className="text-[28px] font-semibold font-sans tabular-nums">{formatMoney(remaining)}</span></p>` in the slot the "Covered" banner uses. |
| Typography | 8 | Each row stacks "Payment 1" (14) over "Amount" or "Rest" (12), which is two labels for one field. The helper "Take all payments before confirming." is 12px muted. | L652: drop the visible "Amount"/"Rest" label and keep it as `sr-only` (the input already has an aria-label). |
| Layout & spacing | 8 | The helper sentence is right-aligned beside "Add payment" and reads as an orphan. On the phone it runs flush to the card edge. | L690: move the helper under the Confirm button as `text-center text-[13px] text-muted-foreground`, or delete it (the Confirm label already lists every tender). |
| Consistency | 7 | Per-row method pickers are an outlined `rounded-xl border bg-background` track with a muted, ringed selection. The tender row directly above is a `rounded-full bg-muted` track with a solid black selection. Same job, two looks on one screen. | `PayPanel.tsx` L661: make the row track `rounded-full bg-muted p-0.5` (no border) and the selected item `bg-background text-foreground shadow-sm rounded-full`. That is the "subtle" tone of `ui/toggle-group.tsx`, ideally used directly (`<ToggleGroup variant="segmented" tone="subtle">`). |
| Color & contrast | 9 | Emerald "Covered", red "Over by", amber validation. | — |
| Efficiency | 9 | The last row takes the rest automatically, so a two-way split is one typed amount. | — |
| Clarity | 8 | "Rest" is clipped jargon. "Take all payments before confirming." is ambiguous: it could mean collect the money, or tap something first. | Rename "Rest" to "Remaining" (aria and output). Copy: "Collect every payment, then confirm." |
| States & feedback | 8 | The uncovered state shows no amount left (see Hierarchy). Over and covered states are good, and the disabled Confirm reads "Confirm split". | Remaining row as above. |
| Responsive | 9 | Fits the phone sheet and the iPad panel without clipping. | — |
| Accessibility | 9 | Inputs labelled, `aria-invalid` plus `aria-describedby` on validation, remove buttons labelled "Remove payment N". | — |

### 5 · Receipt (extra-receipt-ipad, extra-receipt-phone, ux-p4-phone-manager-receipt)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif "Receipt R-000142" with a Paid chip. "New sale" is the single primary, Print is outline, Share is in ⋯. | — |
| Typography | 9 | Mono receipt paper with sans tabular amounts. Item rows 15 medium. "Items" card title 16 semibold. | — |
| Layout & spacing | 9 | iPad two columns, with the paper only on the left as briefed. | — |
| Consistency | 8 | Every line carries two equal outline buttons ("Link appointment", "Refund"), which makes a wall of buttons as lines add up. The brief asks for Refund as ghost. | `ReceiptView.tsx` L420: `variant="outline"` → `variant="ghost"` on Refund. Keep `h-11 px-3`. |
| Color & contrast | 9 | Emerald Paid chip and amber Not scheduled chip are both readable. Gold Approvals pill is in the header. | — |
| Efficiency | 8 | Phone: the items are listed twice (on the paper, then in the Items card), so History is two screens down. | `ReceiptView.tsx` L281: on `max-sm`, wrap the paper in `ui/disclosure.tsx` ("Receipt preview", closed by default) with `print:block` so printing is unchanged. |
| Clarity | 9 | "Not scheduled" sits beside its own fix ("Link appointment"). | — |
| States & feedback | 9 | Loading spinner, not-found and not-paid messages, refunded stamp, focusable notice after a refund, void status. | — |
| Responsive | 8 | Phone is the duplicated stack above. iPad leaves the lower 40% empty, which is fine. | Same fix as Efficiency. |
| Accessibility | 9 | Print is icon-only on the phone with an aria-label and describedby. `role=toolbar`, labelled regions. | — |

### 6 · Refund (extra-refund-ipad, extra-refund-phone, ux-p4-ipad-manager-refund)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The form is long (about 490px) with three chip groups of equal weight. The destructive submit is only at the bottom, inside a card that is cut off on iPad. | Fix the Layout and Consistency items. One chip style lets the submit stand out. |
| Typography | 9 | Title 15 semibold, 12px muted group labels, sans tabular amount. | — |
| Layout & spacing | 7 | "Refund to" wraps 3+2 with an empty cell, and the reason chips wrap 2+1. iPad: the Items card is its own scroller (`lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto`), so the Thai massage line is scrolled out above, the form is cut at the viewport, and the History card peeks 14px at the bottom. | `ReceiptView.tsx` L389: remove `lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto` and let the page scroll. Make the paper column `lg:sticky lg:top-6` (L281). `RefundForm.tsx` L191: "Refund to" grid → `grid-cols-3 @md:grid-cols-5` (add `@container` on the form). |
| Consistency | 6 | Three chip styles in one form. All/Half are `rounded-full` with a muted fill. Refund-to is `rounded-full` with a white outline. Reason is a muted fill, rounded, with left-aligned text. None matches the segmented control the cash panel uses. | One chip class for all three groups: `h-11 rounded-full border border-border bg-background px-3 text-sm font-medium justify-center aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background`. In `RefundForm.tsx` L125 (`chip`), the Refund-to group, and the ReasonField className at L199, drop `[&_button]:text-left` and the grid override in favour of `flex flex-wrap gap-2`. |
| Color & contrast | 9 | The destructive-outline submit appears only when enabled. The disabled label "Pick a reason" is muted but readable. | — |
| Efficiency | 9 | Opens at All plus the original tender, so a refund is one reason chip and submit. | — |
| Clarity | 9 | "Records money already returned to the guest." The button names its blocker ("Pick a reason") and then the amount. | — |
| States & feedback | 9 | Server cap, uncertain retry ("Retry same refund"), amber "Ask a manager" variant for cashiers, "A request is already waiting". | — |
| Responsive | 7 | iPad nested scroll (see Layout). The phone page scroll works. | Same fix as Layout. |
| Accessibility | 9 | Labelled groups, sr-only amount label, `aria-invalid` and describedby, focus moves to the form title. | — |

### 7 · Manager approvals sheet (ux-p1-ipad-manager-approvals)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The decision facts are plain body text: "asks for a ฿180 discount (15%)" is 14px regular, and the new total sits in a muted line. Nothing pulls the eye to what is being approved. | `ApprovalsPanel.tsx` L142: `text-sm` → `text-[15px] font-semibold` for the ask line. Keep the total line muted. |
| Typography | 9 | Line name 15 medium, italic quote, tabular totals, 12px expiry. | — |
| Layout & spacing | 9 | Single Card with actions right-aligned. Nit: the ⓘ after "Expires in 5 min" floats loosely. | — |
| Consistency | 9 | `Card`, outline Decline, primary Approve, standard sheet header. | — |
| Color & contrast | 9 | Expiry turns amber when soon, and the gold quote rule is subtle. | — |
| Efficiency | 9 | One tap to approve, with the count badge on the header button. | — |
| Clarity | 8 | "Mint · asks for a ฿180 discount" has a separator that breaks the sentence. | `ApprovalsPanel.tsx` L142: `${personName} asks for …` (no "·"). |
| States & feedback | 9 | "Nothing waiting.", status notice after a decision, per-button spinner, error. | — |
| Responsive | 9 | A `sm:max-w-md` sheet on iPad, full width on the phone. | — |
| Accessibility | 9 | Focus goes to the title (not Decline), sr-only description, labelled ⓘ. | — |

### 8 · Orders sheet (ux-p2b-phone-orders)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Open orders first, number lookup below a divider. | — |
| Typography | 9 | Row title 14 semibold, meta 12 muted, amount 15 semibold tabular. | — |
| Layout & spacing | 9 | 56px rows, a clean divider, input and Go aligned. | — |
| Consistency | 8 | The manager variant (`OrdersBrowser`) uses `ToggleGroup` in its default `rounded-lg` look with a white selection. That is a third segmented style beside the tender row and the split rows. | `OrderStrip.tsx` L707: `<ToggleGroup variant="segmented" tone="subtle">` and drop the ad-hoc classes. |
| Color & contrast | 9 | Disabled Go is muted and enabled Go is primary. | — |
| Efficiency | 9 | One tap reopens an order. Typing "#1043" or "Order #1043" works. | — |
| Clarity | 8 | The subtitle says "find receipts by number", but typing the receipt number (R-000142) is refused with a correction. | Copy: "Open orders · find a receipt by its order number." Better: accept `R-…` and resolve it through `receiptNumber` in `OrderNumberLookup`. |
| States & feedback | 9 | Loading, "No open orders.", error boundary, "Not available. Check the number…", Load more. | — |
| Responsive | 9 | The bottom panel on the phone is thumb-reachable. | — |
| Accessibility | 9 | Rows have full aria-labels including "on screen". The input is labelled and wired to `aria-invalid`. | — |

---

## Visual bugs
| File | Bug |
|---|---|
| extra-line-open-ipad.png | The line editor is clipped by the pinned footer. The Price row's divider is cut at about y 455, and "Remove item" and History are hidden in a roughly 240px inner scroller with no cue. |
| extra-refund-ipad.png, ux-p4-ipad-manager-refund.png | The Items card scrolls internally. The first line (Thai massage) is scrolled out of view, the form's bottom edge is cut at the viewport, and the next card peeks about 14px at the bottom. |
| extra-refund-ipad/phone.png | "Refund to" pills wrap 3+2 with an empty slot. Reason chips wrap 2+1 with left-aligned text inside pills. Three different chip styles sit in one form. |
| ux-p1-phone-cashier-till.png | Two identical ⋯ buttons stacked about 34px apart (account menu and order menu). |
| extra-checkout-start-ipad.png | The empty order card ends in a bare footer band with a top border (about y 770 to 800). |
| extra-split-ipad/phone.png | "Take all payments before confirming." is crammed right of "Add payment". On the phone it sits flush to the card edge. |
| extra-split-ipad/phone.png | The per-payment method tracks (outlined, rounded-xl, muted selection) don't match the tender track above them (muted, rounded-full, black selection). |
| extra-cash-panel-ipad/phone.png, ux-p3-phone-cash-1500.png | The selected quick chip (Exact or ฿1,500) is a near-black fill that outweighs the navy "Confirm cash" below it. |
| extra-cash-panel-phone.png | The tender track's uneven columns (`1fr 1.5fr 1fr 1.2fr 1fr`) leave "Split" tight to the right end of the track. |
| extra-checkout-start-phone.png | With zero items, "View order · No items yet" is still a full-width tappable bar that opens an empty sheet. |
| extra-line-open-ipad/phone.png | The schedule state is shown three times (subtitle, "Not scheduled" chip, Schedule row). |

## Averages
| Screen | Avg |
|---|---|
| 1 Catalog and empty order | 8.7 |
| 2 Order line editor | 8.3 |
| 3 Cash payment | 8.9 |
| 4 Split payment | 8.3 |
| 5 Receipt | 8.7 |
| 6 Refund | 8.2 |
| 7 Approvals sheet | 8.8 |
| 8 Orders sheet | 8.8 |
| **Area** | **8.6** |
