# Round 5 grade: checkout / point of sale

Graded from `docs/screenshots/audit-r5/` (phone 390×844 and iPad 1180×820 touch-emulated, desktop 1440×900 mouse). For loading, empty, error, disabled, focus and label states I read the code in `src/components/checkout/`, `src/components/ui/` and `src/hooks/`. `tests/browser/touch-targets-a.spec.ts` checks 44px targets on catalog, editor, schedule, cash, split, Orders, receipt, refund and approvals at both touch widths, and `TOUCH_TARGETS` plus `buttonVariants` apply `pointer-coarse:min-h-11 min-w-11` to every button. Accessibility scores take that as given.

Locked decisions are scored on execution only: strong tender track with Split as its 5th option, subtle tracks everywhere else, the pressed-chip ring, "Covered ✓" logic, ghost Refund next to an outline Link appointment, and expiry shown for display only.

---

### 1. Catalog and till (extra-checkout-start-{phone,ipad,desktop}, ux-p1-phone-cashier-till)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The catalog grid is the obvious work area. On phone the dark till bar carries `Cash ฿1,200` as the primary action. | — |
| Typography | 9 | Tile names 15px medium, meta 12px muted, prices 15px semibold sans tabular. | — |
| Layout & spacing | 8 | On phone, the empty "No items yet" strip floats over the 6th tile (Hot stone) and does nothing. It's a 56px card that looks like a disabled button. | `CheckoutView.tsx` ~l.274: when `!count && !request`, render nothing instead of the `<p>No items yet</p>` strip, and drop the catalog's `pb-28` to `pb-6` in that state (`CatalogPane.tsx` l.151, make the padding conditional on a visible strip). |
| Consistency | 9 | Same outline buttons on every viewport. Orders goes icon-only on phone and keeps its label from sm up. | — |
| Color & contrast | 9 | Gold only on the + glyph and the selected tab; navy count badge. | — |
| Efficiency | 9 | Tapping anywhere on a tile adds it, Frequent is the default tab, search sits on top, and no-match offers "Add as custom item". | — |
| Clarity | 9 | Nit: desktop empty order reads "Tap an item to add it." on a mouse device. Change it to "Choose an item to add it." (`OrderPanel.tsx` l.270). | — |
| States & feedback | 9 | Skeleton tiles (`role=status` "Loading items"), "No item matches '…'" with a custom-item escape, "Nothing to sell here yet.", count badge with sr text. | — |
| Responsive | 9 | Phone: one column with the bottom till bar. iPad: 2-up grid plus the order card. Desktop: 3-up grid, not stretched. | — |
| Accessibility | 9 | The whole tile is the `<button>` (32px + circle is decoration) with an sr-only "Add to order", focus ring, and spec coverage. | — |

### 2. Order panel and line editor (extra-line-open-{phone,ipad,desktop}, ux-p2-phone-line-open)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | 40px "Balance due" hero and a full-width primary `Cash ฿1,200`, with the other tenders outlined below. | — |
| Typography | 9 | Serif order title, 15px line name, settings rows 14px, VAT 12px. | — |
| Layout & spacing | 8 | Phone sheet header wraps: Coupon, ⋯ and ✕ drop to a second row under "Order #1043". That wastes about 48px and moves ✕ out of the corner (extra-line-open-phone, ux-p2-phone-line-open). | `OrderPanel.tsx` l.192: `flex-nowrap` below sm (`max-sm:flex-nowrap`). l.218–220: make Coupon icon-only on phone (`max-sm:px-0 max-sm:size-11` and wrap the label in `<span className="max-sm:sr-only">`; keep `aria-label="Add coupon"`). Title, Coupon, ⋯ and ✕ then share one row. |
| Consistency | 9 | The inset settings list (Discount / Schedule / Price / Remove item) matches the brief. Same chevron rows. | — |
| Color & contrast | 9 | Only "Remove item" is red; amber is reserved for "Not scheduled". | — |
| Efficiency | 9 | Exact cash takes two taps (Cash ฿ → Confirm cash). The discount input is inline. | — |
| Clarity | 9 | "Up to 10% without approval" and "Any therapist · Not scheduled" are plain. Nit: "History" on a fresh order could read "Changes". | — |
| States & feedback | 9 | "Saving…" status, coupon and source-issue warnings with Update/Remove, inline approval request, discarded read-only view, "More item options" overflow fade. | — |
| Responsive | 9 | iPad and desktop: the panel pins the totals and the line editor scrolls. Phone tenders sit in a 2×2 grid. | — |
| Accessibility | 9 | Line row is a `<button aria-expanded>`, quantity steppers are labelled, and the spec measures the editor and schedule states. | — |

### 3. Cash payment (extra-cash-panel-{phone,ipad,desktop}, extra-cash-1500-desktop, ux-p3-phone-cash-1500)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | 40px balance due, then the cash input, then a 32px emerald Change, then Confirm h-14. | — |
| Typography | 9 | Input 24px right-aligned sans tabular with a muted ฿ prefix; 12px "Cash received" label. | — |
| Layout & spacing | 8 | Confirm sits at the bottom of the panel (`mt-auto`), leaving a ~200px gap on iPad and ~300px on desktop between the chips/Change block and Confirm. The panel looks unfinished, and on desktop the mouse travels a long way from input to Confirm. | `PayPanel.tsx` `PayAttempt`: from md up, render a read-only items summary in the gap before `<ReceivedAt>`: `<dl className="hidden md:grid gap-1 text-[13px] text-muted-foreground">`, one `flex justify-between` row per line (name · `font-sans tabular-nums` amount), at most 4 rows then "+N more". The space then lets the cashier check what they're charging, and the phone keeps its pinned Confirm. |
| Consistency | 9 | Strong tender track with Split inside (locked). Chips h-11 with the locked pressed ring. | — |
| Color & contrast | 9 | Emerald for change, amber for "Short", strong selection only on the track. | — |
| Efficiency | 9 | Opens at the exact amount, chips for the next note and the next big note, Enter-free. | — |
| Clarity | 9 | Nit: on phone "← Order" and ✕ sit side by side, two exits that look alike. Consider `aria-label`/tooltip "Close order sheet" on ✕, or hide ✕ while paying. | — |
| States & feedback | 9 | Amber "Short ฿X" block with Confirm disabled, change block, spinner on submit, same-key "Retry payment", coupon-refused panel, "order changed while payment was open" guard. | — |
| Responsive | 9 | Phone bottom sheet keeps Confirm sticky when the keyboard shrinks the viewport (`max-height:36rem` rule). | — |
| Accessibility | 9 | Labelled input, `aria-pressed` chips, `aria-live` on confirm, and a full aria-label on Confirm ("Confirm cash · change ฿300"). | — |

### 4. Split payment (extra-split-{phone,ipad,desktop}, ux-p3-ipad-split)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The Confirm label spells out the money: "Confirm ฿500 cash + ฿700 PromptPay". | — |
| Typography | 8 | Split amounts are 14px (`text-sm`) and headings 14px medium, while the single-cash input is 24px. The money being allocated is the weakest text on the panel. | `PayPanel.tsx` SplitForm: amount `<Input>` and `<output>` to `text-[17px] font-medium`; heading `<h3>` to `text-[15px] font-medium`. |
| Layout & spacing | 8 | Each payment is a two-row card (~120px). Desktop still has a ~140px gap above Confirm (extra-split-desktop). | SplitForm `<li>`: at `@min-[26rem]` use one row, `grid-cols-[minmax(0,1fr)_8rem_auto]`, with the subtle method track in col 1, the amount in col 2 and × in col 3, and the "Payment N" heading as a 12px label above. The two-row layout stays for narrower panels. Fill the leftover desktop space with the same md+ items summary as Cash. |
| Consistency | 9 | Subtle per-payment method tracks (locked) under the strong mode track. | — |
| Color & contrast | 9 | Green "Covered", red "Over by", amber validation line. | — |
| Efficiency | 8 | The cash part of a split has no "received / change" step. If the guest hands ฿1,000 for a ฿500 cash part, the cashier works out the change in their head. Single cash does this for them. | SplitForm: when `row.method === "cash"`, show a compact "Received" input (h-11, ฿ prefix, optional) under the row and a `Change ฿X` line (`text-sm font-semibold text-emerald-700`). Pass `received` on that tender: `Tender` already carries `received`, as CashForm uses it. |
| Clarity | 8 | "Payment 2 · rest" is terse, and the dashed read-only box looks like a disabled input. | Heading copy "Payment 2 · remaining". Add a 12px muted hint under the output, "Fills in automatically", or make the output `bg-muted/60 border-transparent` so it reads as computed, not disabled. |
| States & feedback | 9 | "Enter an amount for payment 1." (aria-live), Covered only when every amount is set (locked), "Over by", disabled "Confirm split". | — |
| Responsive | 9 | Phone tracks fit 4 options at 14px. iPad panel is balanced. | — |
| Accessibility | 9 | Per-row `aria-label="Payment N amount"`, labelled remove ×, spec covers empty, covered and removable rows. | — |

### 5. Receipt (extra-receipt-{phone,ipad,desktop}, ux-p4-phone-manager-receipt)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The success moment is small: a 13px "Paid" chip and a 14px subtitle. After a cash sale, the change to hand back appears only as a line on the paper, which is collapsed under "Receipt preview" on phone. | `ReceiptView.tsx` header (l.289): when `change > 0`, add an emerald block at the top of `receipt-side`: `<Card className="flex items-center justify-between bg-emerald-50 p-4"><span className="text-sm">Change to give</span><output className="text-[32px] font-semibold text-emerald-700 font-sans tabular-nums">…</output></Card>`. Also add "· Change ฿X" to the subtitle. |
| Typography | 9 | Serif title, 15px item rows, mono paper with sans money. | — |
| Layout & spacing | 9 | `lg:grid-cols-[24rem_1fr]`, with the paper alone on the left (matches print). Nit: on desktop the content is centred (`xl:max-w-6xl mx-auto`, starts x≈176) while the "Checkout" title sits at x=24. | — |
| Consistency | 9 | Card surface. Outline Link appointment plus ghost Refund (locked). New sale primary, Print outline, Share in ⋯. | — |
| Color & contrast | 9 | Emerald Paid, amber "Not scheduled". | — |
| Efficiency | 9 | New sale is one tap and guards an unsaved refund draft (`confirmDiscard`). | — |
| Clarity | 9 | "Not scheduled" next to "Link appointment" explains itself. | — |
| States & feedback | 9 | Loading spinner, "Not available." for cashiers, unpaid/discarded messages, focused notices, per-line emerald result notes. | — |
| Responsive | 9 | Phone: icon-only Print with a wide New sale, collapsed preview, stacked cards. | — |
| Accessibility | 9 | `aria-label="Print"` with print help text, "Refund {line}" labels, receipt `aria-label`. | — |

### 6. Refund (extra-refund-{phone,ipad,desktop}, ux-p4-ipad-manager-refund)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The form opens inside its line. The submit button is wide, and its disabled label says what's missing ("Pick a reason"). | — |
| Typography | 9 | 15px title, 12px group labels, 13px track labels on phone (locked). | — |
| Layout & spacing | 9 | Grouped amount, Refund to, Reason, then actions. | — |
| Consistency | 9 | Subtle tracks for amount, method and reason (locked); destructive-outline submit. | — |
| Color & contrast | 9 | Red only on the enabled submit. The amber variant marks "Ask a manager". | — |
| Efficiency | 9 | Opens at All plus the original tender. One reason chip and Submit finish it. | — |
| Clarity | 8 | The meta line "Order #1043 · Foot spa 45" repeats the line name printed just above the form (duplicated context). | `RefundForm.tsx` l.152: make that `<p>` `sr-only`, or drop it. The line row above already names it. |
| States & feedback | 9 | Inline amount error ("Up to ฿X"), server-cap correction, "Retry same refund" after a lost answer, "This needs a manager. Send it as a request.", "A request is already waiting.", spinners. | — |
| Responsive | 8 | On phone the reason track is squeezed: "Short treatment / Guest complaint / Wrong charge" sit at 13px with `px-0.5`, so the labels touch each other and the track edge (extra-refund-phone). | `RefundForm.tsx` reason chips: shorter copy `["Cut short", "Complaint", "Wrong charge"]` (the full text still fills the reason input, which is what's saved; pass `value="Short treatment"` and render the short label). Or use `grid-cols-[1fr_1fr_1fr] px-1.5` only once `@sm` and wrap to `flex flex-wrap gap-1` below. |
| Accessibility | 9 | Reason input labelled, chips "Quick reason", focus moves to the form title, Escape cancels. | — |

### 7. Orders sheet (extra-orders-{ipad,desktop}, ux-p2b-phone-orders)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Open orders first, with the amount right-aligned in each row; lookup below. | — |
| Typography | 9 | Nit: row titles are 14px semibold where the scale says 15px medium. | — |
| Layout & spacing | 9 | 56px rows, a clear divider before the lookup. Phone bottom sheet. | — |
| Consistency | 9 | Same sheet header and close button as Approvals; "Current" secondary badge. | — |
| Color & contrast | 9 | Neutral throughout. | — |
| Efficiency | 8 | Reprinting today's receipt for a returning guest means knowing and typing the order number. There's no list of today's paid orders, though cashiers may already open them by number. | `OrderStrip.tsx` `OpenOrders`: add a collapsed `Disclosure label="Paid today"` under the open list, reusing the same row button (title · customer · ฿), last 10. This widens no permission: it lists exactly what `useFindOrder` already lets a cashier open. |
| Clarity | 9 | "Open orders on every till. Look up today's receipts by order number." The receipt-number mistake gets its own hint. | — |
| States & feedback | 9 | Spinner, "No open orders.", inline error boundary with retry, "Not available. Check the number…". | — |
| Responsive | 9 | Right sheet on iPad and desktop, bottom sheet on phone with thumb-reach rows. | — |
| Accessibility | 9 | Full row aria-labels ("…, ฿1,200 due, current order"), labelled lookup input, spec coverage. | — |

### 8. Approvals (extra-approvals-{desktop,phone}, ux-p1-ipad-manager-approvals; header trigger in extra-receipt-*, extra-refund-*)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | "Mint asks for a ฿180 discount (15%)" headline, then the reason, then the before → after total, then Decline/Approve. | — |
| Typography | 9 | Nit: the reason uses quote marks, italics and a gold bar at once. Drop the italics. | — |
| Layout & spacing | 9 | One Card per request, actions right-aligned. | — |
| Consistency | 9 | Card, outline Decline, primary Approve, same as the inline approval component. | — |
| Color & contrast | 8 | The header "Approvals" trigger stays gold-outlined with gold text when nothing is waiting (no count; extra-receipt-*, extra-refund-*). It reads as an alert all day. | `ApprovalsPanel.tsx` `ApprovalsButton`: `className={cn("shrink-0", count ? "border-gold/60 text-gold-text hover:bg-gold/10 hover:text-gold-text" : "")}`, so it's a neutral outline at 0 and gold with the count badge only when something waits. |
| Efficiency | 9 | One tap per decision. The panel closes and toasts after the last one. Nit: no "Open order" link for context. | — |
| Clarity | 9 | Plain ask, total before → after, "Expires in 5 min ⓘ". | — |
| States & feedback | 9 | Spinner, "Nothing waiting.", per-card error, result notice, toast on close, amber when under 2 min, "Expiring now" (display only, locked). | — |
| Responsive | 9 | Phone bottom sheet with full-width cards; works over any page (iPad over Chats). | — |
| Accessibility | 9 | Focus goes to the title, not to Decline; sr-only description and "N waiting" count; spec coverage. | — |

---

## Visual bugs
| File | Bug |
|---|---|
| extra-line-open-phone.png, ux-p2-phone-line-open.png | Order sheet header wraps: Coupon / ⋯ / ✕ drop to a second row below the title, and ✕ leaves the corner. |
| extra-refund-phone.png | Reason track cramped: "Short treatment", "Guest complaint" and "Wrong charge" have ~2px side padding and nearly touch. The "PromptPay" segment is tight too. |
| extra-cash-panel-desktop.png, extra-cash-1500-desktop.png, extra-cash-panel-ipad.png | Large dead band (~200–300px) between the chips/Change block and Confirm cash. |
| extra-split-desktop.png | ~140px dead band between "Add payment" and Confirm. |
| extra-checkout-start-phone.png, ux-p1-phone-cashier-till.png | The floating bottom strip covers the 6th catalog tile at rest. When empty it says only "No items yet" and looks like a disabled button. |
| extra-receipt-*.png, extra-refund-*.png | Gold "Approvals" header button with no count looks like a pending alert. |
| extra-refund-{ipad,desktop,phone}.png | Refund form meta "Order #1043 · Foot spa 45" repeats the line name directly above. |
| extra-split-*.png, ux-p3-ipad-split.png | Dashed "rest" amount box reads as a disabled input; split amounts at 14px look faint next to the 40px hero. |
| extra-receipt-desktop.png | Content column centred (x≈176) while the page title sits at x=24; left edges don't line up. |
| extra-checkout-start-desktop.png | "Tap an item to add it." on a mouse device. |

## Averages
| Screen | Avg |
|---|---|
| 1. Catalog and till | 8.9 |
| 2. Order panel and line editor | 8.9 |
| 3. Cash payment | 8.9 |
| 4. Split payment | 8.6 |
| 5. Receipt | 8.9 |
| 6. Refund | 8.8 |
| 7. Orders sheet | 8.9 |
| 8. Approvals | 8.9 |
| **Area** | **8.85** |

Screens at 9+ in every category: **0 of 8**. Seven screens are one fix away from 9 everywhere. Split needs four fixes.
