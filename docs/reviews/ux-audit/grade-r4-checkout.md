# Grade R4: checkout / point of sale

Graded against `scorecard-rubric.md`, `visual-brief.md` and `design-decisions.md`, with no earlier grades read. Sources: `docs/screenshots/audit-r4/` (desktop has no touch; iPad 1180×820 and phone 390×844 are touch-emulated). For states a screenshot can't show, I read the code in `src/components/checkout/*`, `src/components/ui/*`, `src/hooks/use-unsaved-guard.tsx` and `tests/browser/touch-targets-a.spec.ts`.

Locked decisions are scored on how well they're built, not on the choice itself: strong tender track, ghost Refund, chip pressed ring, split "Covered" rule and approval expiry.

What applies to the whole area, from reading the code:
- **Touch targets.** `TOUCH_TARGETS` in `checkout-ui.ts` and `pointer-coarse:min-h-11` in `button`, `toggle-group` and `sheet` cover all checkout controls on coarse pointers. The touch-target spec measures the catalog, line editor, schedule, cash, payment time, split, Orders, receipt, refund and approvals screens.
- **Money safeguards.** These are all present and stay as they are: attempt keys, revision checks ("The order changed while payment was open"), the retry-same-payment copy, approvals and permission gates.
- **Unsaved drafts.** `CheckoutDraftProvider` with `useUnsavedGuard` guards line drafts, the refund form and the link dialog on reload/close and in-app links. Browser Back is not intercepted, as locked.

---

### 1. Catalog / new order (extra-checkout-start-desktop/ipad/phone, ux-p1-phone-cashier-till)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Catalog grid leads. The order panel's empty state recedes. On phone the till bar becomes navy "View order · Cash ฿1,200" once there are items. | — |
| Typography | 8 | Tile name 15px medium and price 15px semibold sans are good. On iPad the tile meta is cut off: "per night · up to 4 gu…" (CatalogPane line 230 `truncate`). | In `CatalogPane.tsx` change the meta span from `truncate` to `line-clamp-2`, or shorten the room meta to `` `per night · ${maxGuests} guests` `` (line 53). |
| Layout & spacing | 9 | Even 3-col grid on desktop and iPad. On phone, `pb-28` keeps the last tile clear of the floating bar. | — |
| Consistency | 9 | Outline header buttons, Card-radius tiles and gold + affordance are the same on every viewport. | — |
| Color & contrast | 9 | Neutral with a gold accent. The count badge uses primary. | — |
| Efficiency | 9 | One tap adds an item. Phone "Cash ฿X" goes straight to the cash panel. | — |
| Clarity | 9 | "No items yet · Tap an item to add it." Search placeholder is plain. | — |
| States & feedback | 9 | Skeleton tiles while loading. A search with no results offers "Add as custom item". "Nothing to sell here yet." | — |
| Responsive | 9 | iPad stacks the tabs above the search. Phone gets a list layout with a thumb-zone till bar. | — |
| Accessibility | 9 | The whole tile is one button with sr-only "Add to order" and "on the order" count. Focus rings are visible. | — |

### 2. Order panel + line editor (extra-line-open-desktop/ipad/phone, ux-p2-phone-line-open)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | 40px "Balance due" hero, navy "Cash ฿1,200" primary, four outline tenders below. | — |
| Typography | 9 | Inset list: 14px labels, 13px values, "Up to 10% without approval" hint. Money is sans tabular. | — |
| Layout & spacing | 9 | 48px inset rows with dividers. Remove item is centred under a top border, as in the brief. | — |
| Consistency | 8 | Pick-one chips are built three ways, and two of them break the locked "subtle everywhere except tenders" rule. The therapist `Chip` (OrderPanel line ~602) is a raw `<button>` with `bg-foreground text-background` when on. The discount-request `ReasonField` is forced strong by `[&_button[aria-pressed=true]]:bg-foreground` (line ~1002). Refund uses the subtle `ToggleGroup`. | Delete `Chip` and render the therapists with `<ToggleGroup variant="segmented" tone="subtle" className="flex-wrap">`, or give the chip pressed state `bg-background text-foreground ring-1 ring-border`. Remove the `[&_button[aria-pressed=true]]:…` override on the discount `ReasonField`. |
| Color & contrast | 9 | Destructive red only on "Remove item". | — |
| Efficiency | 9 | Discount typed inline. Schedule and price are folded into one row each. | — |
| Clarity | 8 | In the phone sheet header, Coupon is a bare ticket icon (`max-sm:sr-only` on its label, line ~217). Desktop and iPad show "Coupon". | Remove `max-sm:sr-only` from the Coupon label span. The header has room next to "Order #1043". |
| States & feedback | 9 | "Saving…", stale booking rows, coupon blocked, "Waiting for a manager · …", "More item options" scroll cue, discard/clear dialogs. | — |
| Responsive | 9 | Phone bottom sheet with a 2×2 tender grid. iPad and desktop show the floating side panel. | — |
| Accessibility | 9 | Rows have `aria-expanded`, the discount has `aria-describedby` and `aria-invalid`, and icon buttons are labelled. | — |

### 3. Cash payment (extra-cash-panel-desktop/ipad/phone, extra-cash-1500-desktop, ux-p3-phone-cash-1500)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Balance 40px, tender track, h-14 amount, emerald 32px Change, h-14 Confirm. One primary. | — |
| Typography | 9 | Right-aligned 24px amount with ฿ prefix. Chips and Change are tabular sans. | — |
| Layout & spacing | 8 | (a) On phone the 5-segment track (`grid-cols-[1fr_1.5fr_1fr_1.2fr_1fr]`, `px-1`) puts labels almost edge to edge, and "Split" sits ~16px from the track end. (b) On desktop and iPad the panel goes from full height (order) to content height (`has-[[data-testid=pay-panel]]:self-start`, CheckoutView line 234). The card visibly shrinks by ~280px between Order and Cash. | (a) As the brief says, take Split out of the track below an `@sm` container width: render 4 segments plus a trailing `Button variant="ghost" size="sm"` "Split" (PayPanel `TenderRow`). (b) Drop `has-[…]:self-start` so the card keeps its height, and let `PayButton`'s `mt-auto` pin Confirm to the bottom. Or keep self-start on both states. Either way, no jump. |
| Consistency | 9 | Chip pressed state is `ring-2 ring-foreground bg-foreground/5`, as locked. The same `PayButton` is used for every tender. | — |
| Color & contrast | 9 | Emerald Change and amber Short carry meaning. | — |
| Efficiency | 9 | Opens at Exact, so an exact cash sale is 2 taps. Note chips are one tap. | — |
| Clarity | 9 | "Received now · Edit time". Nit: the visible "Confirm cash" leaves out the amount the aria-label carries, while split shows its amounts. | Optional: `Confirm ฿1,500 cash` once received ≠ due. |
| States & feedback | 9 | Amber "Short ฿X", disabled Confirm, spinner, "Retry sends the same payment…", order-changed alert, coupon-refused recovery. | — |
| Responsive | 9 | Phone sheet keeps Confirm above the keyboard (sticky when height < 36rem). | — |
| Accessibility | 9 | Labelled input, `role=status` for Change and Short, `aria-pressed` chips, focus starts on the active tender, Escape goes back. | — |

### 4. Split payment (extra-split-desktop/ipad/phone, ux-p3-ipad-split)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Three stacked filled segmented tracks (master tenders plus one per payment) inside two filled `bg-muted/40` cards. The eye can't tell the per-payment method pickers from the main tender choice. | In `SplitForm`, drop the row fill (`bg-muted/40 p-3`) and use a `divide-y divide-border/70` list. Give the per-payment `ToggleGroup` `className="bg-transparent ring-1 ring-border"` so only the master track is filled. |
| Typography | 9 | "Payment 1" 14px medium, amounts tabular, dashed output for the computed rest. | — |
| Layout & spacing | 8 | Order is list → green "Covered" → "Add payment" → validation line → Confirm. Add payment is cut off from the list it extends, and the 12px amber validation sits under Add payment, away from the empty field. | Move the Add payment button directly under the `<ul>`, then the status/validation line, then Confirm. Render the validation `<p>` with the `Covered/Over` slot, in one place. |
| Consistency | 9 | Per-payment pickers are subtle, as locked. Same input style as cash. | — |
| Color & contrast | 9 | Emerald "Covered", destructive "Over by", amber validation. | — |
| Efficiency | 9 | One typed amount for a two-way split. The last payment takes the rest. | — |
| Clarity | 8 | "Payment 2 · rest" is shorthand, and the dashed box doesn't say it's computed. | Copy: "Payment 2 · the rest" plus a 12px muted hint under the dashed output: "Fills itself". Or label the row "Remaining". |
| States & feedback | 9 | "Covered ✓" only when every payment has an amount, "Over by ฿X", disabled "Confirm split". | — |
| Responsive | 9 | Phone wraps the amount under the title through container queries. Nothing clips. | — |
| Accessibility | 9 | `aria-label="Payment n amount"`, `aria-invalid`, `aria-describedby` validation, labelled × remove buttons. | — |

### 5. Receipt (extra-receipt-desktop/ipad/phone, ux-p4-phone-manager-receipt)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Serif "Receipt R-000142" with a Paid chip. New sale primary, Print outline, Share under ⋯. | — |
| Typography | 9 | Mono paper with sans tabular amounts. Row names 15px. | — |
| Layout & spacing | 9 | `5fr/7fr` columns, paper without buttons, Items card, History below. Phone collapses "Receipt preview". | — |
| Consistency | 8 | Status pills use three specs: Paid (`h-6 px-2.5 text-[13px]` emerald with icon, ReceiptView line 287), "Not scheduled" (`px-2 py-1 text-xs` amber, AfterPayment and OrderPanel) and Orders "Current" (`Badge secondary`). History is a standalone bordered card here but a ruled disclosure in the order panel. | Add `success` and `warning` variants to `ui/badge.tsx` (`bg-emerald-50 text-emerald-800` / `bg-amber-50 text-amber-800`, `h-6 px-2.5 text-xs font-medium rounded-full`) and use them for Paid, Not scheduled and Linked. Render receipt History with the same `HistoryDetails` ruled style, or make both Cards. |
| Color & contrast | 9 | Amber only on "Not scheduled". Refund is a neutral ghost, as locked. | — |
| Efficiency | 9 | Link and Refund are on the line. New sale is one tap. | — |
| Clarity | 9 | "Order #1043 · ฿1,800 · Paid by card". | — |
| States & feedback | 9 | Loading spinner, "Receipt not found" / "Not available", unpaid/discarded message, Share/copy notices, Refunded/Void states. | — |
| Responsive | 9 | Phone: icon Print, full-width New sale, preview folded. Desktop is capped and centred. | — |
| Accessibility | 9 | Icon Print has an aria-label and print-width description. The toolbar uses `role=toolbar`. | — |

### 6. Refund (extra-refund-desktop/ipad/phone, ux-p4-ipad-manager-refund)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Three equal filled tracks (amount, Refund to, Reason) plus a large grey disabled submit give no focal point. The header repeats "Order #1043 · Foot spa 45" right under the Foot spa 45 row. | In `RefundForm.tsx` remove the meta `<p>` (`{view.order.title} · {line.name}`). Make the amount the anchor: input `h-12 w-32 text-lg`, presets beside it. |
| Typography | 8 | Phone: reason segments at 13px with `px-0.5` run together ("Short treatment Guest complaint Wrong charge"). "PromptPay" in Refund to has ~4px side padding. | Below `@md`, render reasons as wrapping chips: `ToggleGroup … className="flex flex-wrap gap-2 bg-transparent p-0"` with items `flex-none px-3 ring-1 ring-border`. Keep the 3-col track from `@md`. |
| Layout & spacing | 8 | The bordered form card sits inside the bordered Items Card, making a third border level. | Swap the form's `border border-border bg-background` for the line-editor inset `rounded-xl bg-muted/40` (keep the amber variant for "Ask a manager"). |
| Consistency | 9 | Subtle choices and destructive-outline submit, as locked. Same inset idea as the line editor. | — |
| Color & contrast | 9 | Destructive only on the ready submit. The disabled state is legible grey. | — |
| Efficiency | 9 | "All" preset, method defaults to the original tender, quick reasons. | — |
| Clarity | 9 | "Records money already returned to the guest." The disabled submit says what's missing ("Pick a reason"). | — |
| States & feedback | 9 | Cap error ("Up to ฿X"), cashier refusal turns into a request form, "Retry same refund", inputs locked while uncertain, guarded draft. | — |
| Responsive | 8 | The phone squeezes 5 methods and 3 reasons into single rows instead of a 358px layout. | Below `@sm` give Refund to `grid-cols-3` (two rows: Cash, PromptPay, Card / Transfer, Other) and use the wrapping reason chips above. |
| Accessibility | 9 | Labelled amount, `aria-invalid` and hint, focus moves to the form title, Escape cancels, submit has `min-h-12` on touch. | — |

### 7. Orders sheet (extra-orders-desktop/ipad, ux-p2b-phone-orders)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Open orders first, lookup second. | — |
| Typography | 9 | Row title 14px semibold, meta 12px, amount 15px tabular. | — |
| Layout & spacing | 9 | `min-h-14` rows with chevrons. Right sheet on desktop and iPad, bottom sheet on phone. | — |
| Consistency | 9 | Same sheet header as Approvals. "Current" uses `Badge`. | — |
| Color & contrast | 9 | Neutral. Disabled "Go" is legible. | — |
| Efficiency | 8 | A cashier can reach a past receipt (reprint, refund request) only by typing its exact order number. | In `OrderStrip.tsx` add a "Paid today" list under Open, using the same row button, limited to receipts the cashier can already look up by number (same permission scope, no new access). |
| Clarity | 8 | The section label "Open" reads like a verb or button. "Go" doesn't say what happens. | Label "Open orders". Button "Find order". |
| States & feedback | 9 | Spinner, "No open orders.", detects receipt numbers ("That's the receipt number…"), "Not available. Check the number…", load more. | — |
| Responsive | 9 | Phone sheet input and button at thumb height. | — |
| Accessibility | 9 | Full row aria-labels including "current order". Close is 44px on touch. | — |

### 8. Approvals sheet (extra-approvals-desktop/phone, ux-p1-ipad-manager-approvals)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | "Mint asks for a ฿180 discount (15%)" leads. Total before → after. Approve is primary. | — |
| Typography | 9 | 15px semibold ask, 12px meta, italic reason quote. | — |
| Layout & spacing | 8 | On touch (phone and iPad) the 44px `InfoTip` makes the "Expires in 5 min ⓘ" row taller. A ~16px extra gap opens above it, and the card spacing doesn't match desktop. | In `ApprovalsPanel.tsx` line 150 change `pointer-coarse:-ml-2` to `pointer-coarse:-my-3 pointer-coarse:-ml-2`. Better: put expiry on the button row (`flex items-center justify-between`: expiry left, Decline/Approve right), which saves a row per card. |
| Consistency | 9 | Card surface, outline + primary pair, same sheet chrome as Orders. | — |
| Color & contrast | 9 | Amber only while expiring soon. Gold quote rule. | — |
| Efficiency | 9 | One tap to decide, straight from any screen's header button. | — |
| Clarity | 9 | Plain request sentence. "Works once, for this order as it is now." | — |
| States & feedback | 9 | Loading, "Nothing waiting.", per-card error ("Couldn't approve. Nothing changed."), decision notice, "Expiring now" (display only, as locked). | — |
| Responsive | 9 | Bottom sheet on phone, side sheet on iPad and desktop. | — |
| Accessibility | 9 | Count badge has sr-only "waiting". The title gets focus. Labelled InfoTip. | — |

---

## Visual bugs
| File | Bug |
|---|---|
| extra-checkout-start-ipad.png, extra-line-open-ipad.png, extra-cash-panel-ipad.png | Garden Villa tile meta cut off: "per night · up to 4 gu…". |
| extra-refund-phone.png | Reason segments run together with no padding ("Short treatment Guest complaint Wrong charge"). Refund to "PromptPay" is cramped. |
| extra-refund-desktop.png, extra-refund-ipad.png, extra-refund-phone.png | Refund header repeats "Order #1043 · Foot spa 45" right under the Foot spa 45 row. |
| extra-cash-panel-phone.png, ux-p3-phone-cash-1500.png, extra-split-phone.png | Tender track labels packed edge to edge. "Split" sits ~16px from the track end. |
| extra-cash-panel-desktop.png / extra-line-open-desktop.png (and iPad) | Order card goes from full height to ~600px when payment opens: a layout jump with an empty column below. |
| extra-approvals-phone.png, ux-p1-ipad-manager-approvals.png | Extra gap above "Expires in 5 min ⓘ" (touch-size InfoTip grows the row). Card rhythm differs from desktop. |
| extra-split-*.png, ux-p3-ipad-split.png | "Add payment" sits below the green "Covered" bar, away from the payment list it extends. |
| extra-line-open-phone.png, ux-p2-phone-line-open.png | Coupon is an unlabeled ticket icon in the sheet header. Desktop and iPad show "Coupon". |
| extra-receipt-*.png vs extra-line-open-*.png | History is a bordered card on the receipt but a ruled disclosure in the order panel. |

## Below 9, by impact
1. Refund · Typography / Responsive / Layout · 8 · Wrapping reason chips and a 3-col method grid below `@md`/`@sm`. Use the `bg-muted/40` inset instead of a bordered form inside the Card (`RefundForm.tsx`).
2. Refund · Hierarchy · 8 · Remove the duplicate order/line meta. Make the amount input `h-12 w-32 text-lg`.
3. Cash · Layout · 8 · Split becomes a ghost button at the end of the track below `@sm`. Stop the order card shrinking (`has-[[data-testid=pay-panel]]:self-start` in CheckoutView).
4. Split · Hierarchy · 8 · Unfill the payment rows (`divide-y`) and outline the per-payment tracks (`bg-transparent ring-1 ring-border`).
5. Split · Layout · 8 · Order: list → Add payment → status/validation → Confirm.
6. Split · Clarity · 8 · "Payment 2 · the rest" plus a "Fills itself" hint.
7. Line editor · Consistency · 8 · Therapist chips and discount reason chips go subtle (`ToggleGroup tone="subtle"`). Remove the strong override.
8. Line editor · Clarity · 8 · Show the "Coupon" label on phone (remove `max-sm:sr-only`).
9. Orders · Efficiency · 8 · "Paid today" list for cashiers within their existing scope.
10. Orders · Clarity · 8 · "Open" → "Open orders". "Go" → "Find order".
11. Receipt · Consistency · 8 · `Badge` success/warning variants for Paid, Not scheduled and Linked. One History style.
12. Approvals · Layout · 8 · `pointer-coarse:-my-3` on the InfoTip, or expiry on the button row.
13. Catalog · Typography · 8 · Tile meta `line-clamp-2`, or the shorter "per night · 4 guests".

## Per-screen averages
| Screen | Avg |
|---|---|
| 1. Catalog / new order | 8.9 |
| 2. Order panel + line editor | 8.8 |
| 3. Cash payment | 8.9 |
| 4. Split payment | 8.7 |
| 5. Receipt | 8.9 |
| 6. Refund | 8.6 |
| 7. Orders sheet | 8.8 |
| 8. Approvals sheet | 8.9 |
| **Area average** | **8.81** |

Screens at 9+ in every category: **0 of 8**. Every screen is one to four specific fixes away. No category scored below 8, and States & feedback and Accessibility are 9 everywhere.
