# R0 audit — checkout / point of sale

Graded against `scorecard-rubric.md` and `visual-brief.md`. I looked at every screenshot below myself. For states a screenshot can't show, I read `src/components/checkout/*` and `src/components/ui/{button,toggle-group,input,reason-field,sheet}.tsx`. iPad is 1180×820 and phone is 390×844. None of the fixes touches attempt keys, revision checks, approvals or permission gates.

**Area average: 8.0 / 10** (8 screens × 10 categories; 50 of 80 cells are below 9).

| Screen | Avg |
|---|---|
| 1. Catalog and empty order | 7.8 |
| 2. Order panel and line editor | 7.8 |
| 3. Cash payment | 8.4 |
| 4. Split payment | 7.0 |
| 5. Receipt | 8.4 |
| 6. Refund form | 7.4 |
| 7. Approvals sheet | 8.8 |
| 8. Orders list | 8.7 |

What already works well: touch targets (`TOUCH_TARGETS` is on the screen and on every portaled dialog and sheet), the money font (sans, tabular, everywhere), the hero "Balance due", the phone "Cash ฿X" quick-pay, the cash Change block, and the error, retry and loading states inside PayPanel.

---

### 1. Catalog and empty order (extra-checkout-start-ipad, extra-checkout-start-phone, ux-p1-phone-cashier-till)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 7 | On an empty order the panel still shows a 40px **฿0** and a full tender row with a grey "Cash" pill. On the phone a navy primary bar reads "View order · 0 items · ฿0". Nothing to pay is the loudest thing on the screen. | `OrderPanel.tsx` footer: when `lines.length === 0`, skip the Balance due row and the tender row. In their place show one line: `<p className="text-sm text-muted-foreground">Add an item to take payment.</p>`. `CheckoutView.tsx` bar: when `count === 0`, use `bg-card text-foreground border border-border shadow-sm` instead of `bg-primary`, show the text "No items yet" and leave out ฿0. |
| Typography | 8 | Tile names and prices are 14px semibold (`CatalogPane.tsx` CatalogTile). The brief asks for a 15px medium row title. "No booking" is a lone 12px label next to 14px buttons. | CatalogTile: name `text-[15px] font-medium leading-snug`, price `text-[15px] font-semibold`. |
| Layout & spacing | 7 | The count badge `-top-1.5 -left-1.5` sticks out over the tile's photo corner and border (ux-p1, line-open). iPad strip: a floating "No booking" label, then an outline "Add customer", then a ghost "Add booking", all on different visual baselines. | Badge: `absolute top-1 left-1` (inside the photo). In `OrderStrip.tsx`, hide the "No booking" `<p>` on lg when there is no booking (the Add booking button already says it). |
| Consistency | 7 | Two sibling actions use different variants: "Add customer" is outline and "Add booking" is ghost. Catalog tabs are underline tabs, while every other picker in checkout is a pill segmented control. | `OrderStrip.tsx`: make "Add booking" `variant="outline"` like Add customer. Keep the underline for top-level tabs, but document it as the one tab style. |
| Color & contrast | 7 | The disabled "New order" (opacity-45 on outline) is about 2.3:1. The disabled grey "Cash" pill on ฿0 is a non-action rendered as a selected state. | Hide "New order" when `!order && !canStartNew` rather than disabling it. The tender row goes away with the empty-state fix above. |
| Efficiency | 9 | One tap on a tile adds it. Phone "Cash ฿1,200" is two taps to Confirm. | — |
| Clarity | 8 | "No booking" reads like a filter or a status. "Tap an item to add it to the order." is good. | Remove the "No booking" text when there is none, and show the booking reference only when one is attached. |
| States & feedback | 8 | The loading skeleton, "No item matches … / Add as custom item" and "Nothing to sell here yet." are all good. Empty-order tenders are disabled with no reason given. | Covered by the empty-state line "Add an item to take payment." |
| Responsive | 8 | The phone bar is thumb-reachable and the catalog has `pb-28`, so the bar never covers the last tile. On the phone cashier header (ux-p1), "Cashier" plus a full "Sign out" button crowd the title. | In the admin header on `<sm`, show Sign out as an icon button (`size-11`, `aria-label="Sign out"`) or move it into the account ⋯ menu. |
| Accessibility | 9 | 44px coarse targets, labelled search, an sr-only "on the order" count. | — |

### 2. Order panel and line editor (extra-line-open-ipad, extra-line-open-phone, ux-p2-phone-line-open)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 7 | The footer tender row is styled as a segmented control with "Cash" always filled black (`OrderPanel.tsx` ~L284). It reads as "Cash is selected", not as "tap to pay", and the screen has no unmistakable primary action. "Split" floats outside the track as bare text. | In the order footer, tenders are *actions*, so render them as buttons: `grid grid-cols-4 gap-2`, Cash `variant="default" h-12 rounded-xl text-sm`, the others `variant="outline" h-12 rounded-xl text-sm`. Put "Split payment" as a `variant="ghost" size="sm"` button under the row, right-aligned. Change the label "Take payment by" to "Pay {formatMoney(due)} by". Keep the segmented style only inside PayPanel, where it really is a selector. |
| Typography | 7 | "Price" is 12px while "Discount" and "Schedule" are 14px, because `Button size="sm"` adds `text-xs` (`OrderPanel.tsx` LineEditor price button). "Remove item" is also 12px. The line name is 14px semibold. The line subtitle is cut off: "60 min · Any therapist · Not sched…" (extra-line-open-ipad). | Price button: add `text-sm`. Remove item: add `text-sm`. OrderLineRow name: `text-[15px] font-medium`. Subtitle: replace `truncate` with `line-clamp-2`. |
| Layout & spacing | 8 | The open row tints the `li` (`bg-muted/40`) *and* the editor (`bg-muted/50`), giving two nested grey boxes. The phone sheet is a fixed `h-[94dvh]`, which leaves a blank band of about 150px between History and Add coupon. | Drop `open && "bg-muted/40"` on the `li`. Phone sheet: use `h-auto max-h-[94dvh]` (as the pay panel already does via `has-[[data-testid=pay-panel]]:h-auto`) so a short order doesn't float. |
| Consistency | 7 | There are two "selected" styles: therapist `Chip` and reason chips use navy `bg-primary`, while tenders use black `bg-foreground`. | `Chip` in OrderPanel, `ReasonField` and the RefundForm amount chip: when pressed, use `border-foreground bg-foreground text-background`. Keep `bg-primary` for primary *actions* only. |
| Color & contrast | 8 | The always-black "Cash" has no meaning, since it isn't a state. | Fixed by the tender-button change under Hierarchy. |
| Efficiency | 8 | A discount takes typing plus a separate "Apply 15%" tap (Enter works on a keyboard, but not on an iPad soft keyboard without a Done key). | `DiscountField`: add `onBlur={() => void apply()}` to the input. `apply()` already returns early while asking for approval, so the manager path is unchanged. |
| Clarity | 8 | "Discount · up to 10%" and "Price ฿1,200 ›" are good. The truncation hides "Not scheduled", which is the one fact on the row that needs action. | Covered by `line-clamp-2`. Better still, render "Not scheduled" as the same amber chip the receipt uses (`rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800`). |
| States & feedback | 8 | Stale-row, coupon and waiting-for-manager messages are good. Writes go through `run()` with no visible saving cue on the row (`busy` exists but isn't shown). | In the OrderPanel header, when `busy`, show `<span role="status" className="text-xs text-muted-foreground">Saving…</span>` under the title. |
| Responsive | 8 | iPad 380px panel is fine. On the phone the fixed-height sheet leaves dead space (see Layout). | Same fix as Layout. |
| Accessibility | 9 | Labelled discount (`aria-describedby` limit and echo), 48px rows, coarse targets. | — |

### 3. Cash payment (extra-cash-panel-ipad, extra-cash-panel-phone, ux-p3-phone-cash-1500)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Balance due at 40px, the amount, the Change block, then Confirm. Close to the brief. | — |
| Typography | 8 | The input shows "1200" ungrouped while the chips show "฿1,500". Tender labels are 12px (`text-xs`); the brief asks for `text-sm`. | `PayPanel.tsx` TenderRow: `text-sm` (keep `max-[350px]:text-[11px]`). CashForm: show the value grouped while not focused (`Intl.NumberFormat("en-US").format(value)` when `document.activeElement !== input`, raw while editing). |
| Layout & spacing | 8 | "Received now · Edit time" sits between the tenders and the amount, pushing the main field down, and adds a row the cashier rarely needs. | Move `<ReceivedAt>` below the Confirm button as a footnote: `order-last justify-center text-center`. The time editor opens under it. |
| Consistency | 8 | "Exact" never looks selected when the amount equals the amount due: its class lacks the `aria-pressed:` styles that the note chips have (extra-cash-panel shows 1200 with no chip highlighted; ux-p3 highlights ฿1,500). | `CashForm` Exact button: add `aria-pressed:border-foreground aria-pressed:bg-muted`. |
| Color & contrast | 9 | Emerald change on `bg-muted/50`, and money is tabular. | — |
| Efficiency | 9 | Opens at the exact amount, so a cash sale is one tap. | — |
| Clarity | 8 | There is no visible way back to the order. On iPad the panel header has no back control; you have to know to re-tap the active "Cash". On the phone the ✕ closes the whole sheet, not the panel. The order context ("Order #1043 · 1 item") is `sr-only`. | `OrderPanel.tsx` header while `paying`: add `<Button variant="ghost" size="sm" onClick={() => setPaying(null)}><ArrowLeft/> Order</Button>` on the right (before ✕). Make the `paying` subtitle visible: remove `sr-only` and use `text-[13px] text-muted-foreground`. |
| States & feedback | 8 | Short state: the disabled Confirm reads "Short ฿200" at opacity-45, which is faint white on light navy. This is the most important message in the state, and it's the least readable. | When `!label.ready && value > 0`, render a status block in the Change slot: `rounded-xl bg-amber-50 p-4 flex justify-between` with "Short" (`text-sm`) and the amount (`text-[32px] font-semibold text-amber-800 font-sans tabular-nums`). Keep the button disabled, labelled "Confirm cash". |
| Responsive | 9 | Phone sheet is auto-height; the keyboard's sticky Confirm is handled. | — |
| Accessibility | 8 | "Edit time" has `aria-label="Change payment time"`, so the visible label isn't in the accessible name (WCAG 2.5.3; voice "tap Edit time" fails). | `ReceivedAt`: `aria-label="Edit payment time"`. |

### 4. Split payment (ux-p3-ipad-split)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 7 | The biggest number is an amber **Remaining ฿700**, while the button says "Confirm ฿500 cash + ฿700 PromptPay", so nothing actually remains. `rest` is `due − typed rows` (`PayPanel.tsx` L622) and the last row already takes it. | Show what is unallocated: `const left = round2(due - tenders.reduce((t, x) => t + x.amount, 0))`. That is ฿0 when the last row auto-fills, so show "Fully allocated" in the foreground colour. Keep "Over by" in destructive when typed rows exceed what is due. Label the last row's box "Rest" (12px muted above it). |
| Typography | 7 | Method chips are 11px (`text-[11px]`). The typed amount has no ฿, while the computed one has ฿. | Method chips `text-xs`. Give the typed input the same ฿ prefix as cash (`relative` + `absolute left-3` ฿, `pl-7`). |
| Layout & spacing | 7 | "Add payment" stretches full width and looks centred: `justify-self-start` does nothing inside the flex-column fieldset. | `className="self-start"`. |
| Consistency | 6 | "QR" here and in RefundForm, "PromptPay" in the tender row, the confirm label and the receipt. The input row (outlined) and the computed row (filled `bg-muted/50`) look like two different controls. | Use "PromptPay" everywhere. On iPad the 4-up track has room at `text-xs`; on the phone the row already wraps (`basis-44`). Computed row: `border border-dashed border-input bg-transparent` so it reads as the same field, auto-filled. |
| Color & contrast | 7 | Amber (warning) on a fully allocated split is a false alarm. | Covered by the Hierarchy fix: amber only while `left > 0`. |
| Efficiency | 8 | A two-way split is one typed amount, which is excellent. But leaving split goes "Back to order" and drops out of payment entirely; to switch to plain cash you re-open Cash. | Keep the TenderRow on top in split mode too (Split pressed), so one tap on Cash switches. `onPick` already handles a mode switch with a new attempt. |
| Clarity | 6 | Remaining versus Confirm contradict each other (see Hierarchy). "Back to order" is ambiguous. | Fixes above. |
| States & feedback | 8 | "Confirm split" is disabled with no reason when a row is ฿0. | When `!ready`, add `<p className="text-xs text-amber-800">Enter an amount for payment {n}.</p>` above the button. |
| Responsive | 8 | Only iPad was captured. The phone layout wraps rows, but the 4-up track plus a w-32 field is tight at 390px. | On `<sm`, put the method track on its own line (`basis-full`) with the amount below it at `w-full`. |
| Accessibility | 6 | The method buttons have `aria-label="PromptPay"` but show "QR" (WCAG 2.5.3 failure). | Remove the `aria-label` override and show "PromptPay". |

### 5. Receipt (extra-receipt-ipad, extra-receipt-phone, ux-p4-phone-manager-receipt)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The header is clear (New sale primary, Print outline, ⋯). A red "Refund" on every line is the most saturated thing on the page, so the eye goes to refunding a sale that just happened. | `ReceiptView.tsx` Refund trigger: `text-foreground` ghost (drop `text-destructive`). The destructive tone stays on the form's submit. |
| Typography | 9 | The paper is mono at 13px, item rows are 15px medium, money is sans. | Nit: receipt title `font-serif text-2xl` to match the "Order #1043" panel title. |
| Layout & spacing | 7 | The paper is centred in its 5fr column (`justify-items-center`), so its left edge (x≈66) doesn't line up with the header (x≈32). The lower half of the iPad screen is empty. | Receipt column: `justify-items-center lg:justify-items-start`. |
| Consistency | 9 | Items `Card`, History disclosure, outline "Link appointment". | — |
| Color & contrast | 8 | Repeated destructive red (see Hierarchy). The amber "Not scheduled" chip passes. | Same fix as Hierarchy. |
| Efficiency | 9 | One tap to New sale, one to Print. | — |
| Clarity | 8 | The paper says "To be scheduled" while the Items card says "Not scheduled" for the same state. | `checkout-ui.ts` L114: return "Not scheduled" (or use "To be scheduled" in both). Pick one term. |
| States & feedback | 9 | Loading, not found, not paid, "Refunded" chip, notices, void stamp. | — |
| Responsive | 8 | On the phone the paper fills the first screen, so Link appointment and Refund are below the fold. New sale is a small button among three at the top. | Phone toolbar: `New sale` gets `max-sm:flex-1 max-sm:h-12`, and Print becomes an icon button on `<sm` (`size-11`, `aria-label="Print"`), so the primary action is a full thumb target. |
| Accessibility | 9 | `aria-label="Refund Thai massage 60"` contains the visible label, and print help is in sr-only. | — |

### 6. Refund form (ux-p4-ipad-manager-refund)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The submit "Record refund ฿600" is the goal, but it renders as a faint pink outline until a reason is picked. | Covered under States and Color. |
| Typography | 8 | The form title "Refund" is 14px, the same as the body. The amount field has no ฿. | Title `text-[15px] font-semibold`. Amount input: add a ฿ prefix like the cash field. |
| Layout & spacing | 8 | Cancel is a 12px text button at top right, far from the submit. | Move Cancel next to the submit: `grid grid-cols-[auto_1fr] gap-2`, with Cancel as ghost and submit filling the rest. |
| Consistency | 6 | One form has two selected styles: "All ฿600" uses navy `bg-primary`, while "Card" in Refund to uses black `bg-foreground`. "QR" here versus "PromptPay" at payment. | RefundForm `chip()`: pressed `border-foreground bg-foreground text-background`. Method label "PromptPay" (5 columns at about 560px fit easily). |
| Color & contrast | 6 | The disabled submit (destructive outline at opacity-45) and the other line's disabled "Refund" (pink at 45%) are both about 1.6:1 and unreadable. | Submit: `disabled:opacity-100 disabled:border-border disabled:text-muted-foreground`. In ReceiptView, *hide* other lines' Refund while a form is open (`refunding !== null && refunding !== line._id`) instead of disabling it. |
| Efficiency | 9 | All and the original tender are preselected; one chip finishes it. | — |
| Clarity | 7 | The reason field shows only "Pick one or type"; its "Reason" label is sr-only (`compact`). | Pass `compact={false}`, or keep compact chips but show the label: in ReasonField, make `compact` shrink only the chips (drop `compact && "sr-only"` on the Label). |
| States & feedback | 7 | The submit is disabled with no reason given. Error, spinner and "A request is already waiting." exist. | When `!reason.trim()`, add `<p className="text-xs text-muted-foreground">Pick or type a reason to record the refund.</p>` above the button. |
| Responsive | 9 | Opens inline in the card and scrolls into view. | — |
| Accessibility | 6 | `aria-label="PromptPay"` on visible "QR" (2.5.3). A placeholder-only visible label (3.3.2). | Remove the aria-label override and show "PromptPay". Show the "Reason" label. |

### 7. Approvals sheet (ux-p1-ipad-manager-approvals)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Ask, quote, before → after total, expiry, then Decline and Approve. | — |
| Typography | 9 | 14px semibold ask, italic quote, sans money. | — |
| Layout & spacing | 9 | Clean. Empty space below a single request is fine in a sheet. | — |
| Consistency | 8 | The request is a raw `li.rounded-xl.border.bg-card.p-4`, not `Card`. | `ApprovalsPanel.tsx` ApprovalItem: wrap in `<Card asChild>` (or `Card` with `className="grid gap-2 p-4"`). |
| Color & contrast | 9 | Gold rule on the quote; primary Approve. | — |
| Efficiency | 9 | One tap to decide. | — |
| Clarity | 8 | "Mint asks for a ฿180 discount (15%)" doesn't say *which item*. `approvalAsk` only appends `lineName` for refunds. | `staff-approvals.ts` discount case: append `lineName ? \` on ${lineName}\` : ""`. |
| States & feedback | 9 | Loading spinner, "Nothing waiting.", per-item error, toast on close. | — |
| Responsive | 9 | `sm:max-w-md` sheet on iPad. | — |
| Accessibility | 9 | The title gets focus on open, and ⓘ is labelled. | — |

### 8. Orders list (ux-p2b-phone-orders)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | "Balance due" repeats as a 12px label on every row, which adds noise next to the amount. | `OrderStrip.tsx` OpenOrders row: drop the per-row "Balance due" span and keep the amount (`text-[15px] font-semibold`). Add `aria-label` on the row: "Order #1043, ฿1,200 due". |
| Typography | 9 | Clear. | — |
| Layout & spacing | 9 | Good rhythm, and the bottom panel sits in thumb reach. | — |
| Consistency | 9 | Standard dialog. | — |
| Color & contrast | 9 | — | — |
| Efficiency | 9 | One tap to open; go-to-number is there for old orders. | — |
| Clarity | 7 | The description "Latest first. A paid order opens its receipt." doesn't fit a cashier, whose list holds only open orders. "· on screen" is jargon. | DialogDescription: when `cashier`, use "Open orders, newest first." `on screen` → `· current`. |
| States & feedback | 9 | Loading, "No open orders.", load more. | — |
| Responsive | 9 | — | — |
| Accessibility | 9 | Labelled input, 44px rows. | — |

---

## Visual bugs

| # | File(s) | Bug | Fix |
|---|---|---|---|
| 1 | ux-p3-ipad-split | **Remaining ฿700 (amber)** shows while the split is fully allocated: it contradicts "Confirm ฿500 cash + ฿700 PromptPay". | Compute the remainder over all tenders (see Screen 4). |
| 2 | ux-p3-ipad-split | "Add payment" stretches the full width and looks centred. | `self-start` instead of `justify-self-start`. |
| 3 | ux-p3-ipad-split | The typed amount has no ฿ while the computed amount has one. The two rows use different box styles. | Add a ฿ prefix; make the computed box dashed-outline. |
| 4 | ux-p4-ipad-manager-refund | Disabled "Record refund ฿600" and the other line's "Refund" are faint pink (about 1.6:1). | See Screen 6, Color. |
| 5 | extra-receipt-ipad, ux-p4-ipad-manager-refund | The receipt paper is indented (left edge x≈66) against the header (x≈32). | `lg:justify-items-start`. |
| 6 | extra-line-open-ipad | Line subtitle cut off: "Any therapist · Not sched…". | `line-clamp-2`, or a "Not scheduled" chip. |
| 7 | extra-line-open-ipad/phone, ux-p2-phone-line-open | The "Price" row label and value are 12px; Discount and Schedule are 14px. | Add `text-sm` to the price button. |
| 8 | extra-cash-panel-ipad/phone | "Exact" isn't highlighted although 1200 equals the amount due (the ฿1,500 chip does highlight in ux-p3). | Add `aria-pressed:` classes to Exact. |
| 9 | extra-cash-panel-ipad/phone | Input "1200" is ungrouped next to chips "฿1,500". | Show it grouped when not focused. |
| 10 | extra-line-open-ipad, ux-p1-phone-cashier-till | The catalog count badge overhangs the tile's photo corner and border. | `top-1 left-1`. |
| 11 | extra-checkout-start-ipad | Disabled "New order" is faint; the disabled grey "Cash" pill sits over ฿0. | Hide both on an empty order. |
| 12 | extra-checkout-start-phone | A navy primary bar reads "View order · 0 items · ฿0". | Muted card style for the empty bar. |
| 13 | extra-line-open-phone, ux-p2-phone-line-open | A blank band of about 150px between "History" and "Add coupon" (fixed 94dvh sheet). | `h-auto max-h-[94dvh]`. |
| 14 | extra-receipt-ipad/phone | Paper "To be scheduled" against chip "Not scheduled" for the same state. | Use one term. |
| 15 | ux-p1-phone-cashier-till | The header crowds "Checkout", "Cashier" and a full "Sign out" button. | Icon-only Sign out on `<sm`. |
