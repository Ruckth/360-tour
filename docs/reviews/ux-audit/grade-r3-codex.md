# Independent UX/UI scorecard — round 3

Reviewed detached `ux/integration` at `c86338391b28da636c17568f07f67655cadc8fcf`. Read only the three authorized audit documents: [scorecard-rubric.md](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/reviews/ux-audit/scorecard-rubric.md), [visual-brief.md](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/reviews/ux-audit/visual-brief.md), [design-decisions.md](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/reviews/ux-audit/design-decisions.md). No other file in that audit directory was opened. All 68 PNGs were opened individually at their original resolution, including duplicate-looking captures. They are grouped into 19 screens; viewports and filled/empty variants are not counted as separate screens. Cash, split, receipt and refund remain separate task views because each has a different active workflow.

Scoring: 9 means shippable with at most a nit, not merely usable. No 10s are awarded. Locked choices are accepted as the baseline; the refund tone finding concerns failure to execute that baseline. Each category is equally weighted. Responsive covers every supplied viewport for its screen; an uncaptured desktop state is not claimed to have been visually tested.

Hidden states were inspected in the component and hook sources listed below, plus shared Button, Input, ToggleGroup, InfoTip, Disclosure, sheet/dialog and calendar primitives. Read [now-screenshots.spec.ts](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/tests/browser/now-screenshots.spec.ts) and [touch-targets-a.spec.ts](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/tests/browser/touch-targets-a.spec.ts), [touch-targets-b.spec.ts](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/tests/browser/touch-targets-b.spec.ts), [touch-targets-c.spec.ts](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/tests/browser/touch-targets-c.spec.ts) for scene definitions and target-measurement coverage. The suites were not run; node_modules is absent. Accessibility scores use screenshot and source evidence, not a claimed fresh browser/assistive-technology or contrast measurement.

No product code was edited, no push or PR was made, and no Convex deployment or data was touched. Browser Back/Forward is not penalized: the locked guard decision is honored. Full-page captures can paint a fixed/sticky bar over a mid-document row; where matching bottom padding allows content to scroll clear, that capture composition is not counted as an unreachable-control defect.

### Checkout catalog / till ([extra-checkout-start-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-checkout-start-desktop.png), [extra-checkout-start-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-checkout-start-ipad.png), [extra-checkout-start-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-checkout-start-phone.png), [ux-p1-phone-cashier-till.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p1-phone-cashier-till.png))

Code checked: [CatalogPane.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/CatalogPane.tsx), [CheckoutView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/CheckoutView.tsx), [OrderStrip.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/OrderStrip.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Item names, prices and add affordances lead; the populated phone dock exposes the cash shortcut. | — |
| Typography | 9 | Service names, duration metadata and sans prices have a coherent scale; long yoga copy fits. | — |
| Layout & spacing | 9 | Catalog cards align; the large empty order area communicates a deliberate empty state. | — |
| Consistency | 9 | The same cards, search field and category tabs carry across all three widths. | — |
| Color & contrast | 9 | Dark prices and labels are legible; gold distinguishes catalog affordances without replacing their shapes. | — |
| Efficiency | 9 | Whole-card addition, frequent items, search and direct phone cash access support the common sale. | — |
| Clarity | 9 | “No items yet” and “Tap an item to add it” explain the next step; room-charge caveat exists in code. | — |
| States & feedback | 9 | CatalogPane has loading skeletons and empty search results; CheckoutView renders actionable write errors. | — |
| Responsive | 9 | Phone uses stacked cards and a dock; iPad uses a catalog/order split; desktop cards become horizontal. | — |
| Accessibility | 9 | Catalog controls have names and focus styles; TOUCH_TARGETS covers touch buttons, inputs and links. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Order line editor ([extra-line-open-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-line-open-desktop.png), [extra-line-open-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-line-open-ipad.png), [extra-line-open-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-line-open-phone.png), [ux-p2-phone-line-open.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p2-phone-line-open.png))

Code checked: [OrderPanel.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/OrderPanel.tsx), [CheckoutDrafts.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/CheckoutDrafts.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | The expanded item and large balance are easy to locate; Cash is the only filled payment action. | — |
| Typography | 9 | Discount, schedule and price form a readable label/value list; amounts remain sans and tabular. | — |
| Layout & spacing | 9 | Inset rows and dividers are aligned; the phone sheet keeps the editor and payment actions within its scroll layout. | — |
| Consistency | 9 | Outline alternatives, ghost removal and the shared history disclosure have consistent roles. | — |
| Color & contrast | 9 | Removal has destructive text plus an icon and explicit words; ordinary rows stay neutral. | — |
| Efficiency | 9 | Inline discount and expandable schedule avoid leaving checkout; price approval remains available. | — |
| Clarity | 9 | “Up to 10% without approval” and “Any therapist · Not scheduled” explain the cashier limit and schedule. | — |
| States & feedback | 9 | Discount parsing has inline validation; source changes have Update/Remove recovery; pending writes disable controls. | — |
| Responsive | 9 | Phone alternatives become a two-column block; iPad and desktop preserve aligned settings rows. | — |
| Accessibility | 9 | Expanded state, named fields, focus rings and minimum touch sizes are coded; dirty price/approval drafts are guarded. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Orders ([extra-orders-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-orders-desktop.png), [extra-orders-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-orders-ipad.png), [ux-p2b-phone-orders.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p2b-phone-orders.png))

Code checked: [OrderStrip.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/OrderStrip.tsx), [ErrorBoundary.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/ErrorBoundary.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Open orders are prominent and their amounts align; the number lookup is a separate, clear task. | — |
| Typography | 9 | Order titles, customer metadata and sans amounts form a compact, readable scale. | — |
| Layout & spacing | 9 | The short list and lookup are spaced consistently in the phone bottom sheet and wider side sheets. | — |
| Consistency | 9 | List rows, field, Go button and close control use the same checkout primitives. | — |
| Color & contrast | 9 | Disabled Go remains readable and visibly different from an active primary action. | — |
| Efficiency | 9 | An open order is one tap away; the lookup accepts 1043, #1043 and Order #1043. | — |
| Clarity | 8 | The header invites finding a paid order without disclosing that the cashier lookup only permits today’s receipts. | [OrderStrip.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/OrderStrip.tsx): Change the cashier Orders sheet description to “Open an unpaid order below, or find today’s receipt by its order number (#).” Change the lookup label to “Order number · today’s receipts”. Keep all existing permission gates. |
| States & feedback | 9 | List and lookup have local retry boundaries, loading, empty and not-found messages; invalid receipt numbers are explained. | — |
| Responsive | 9 | Phone uses a bottom sheet; wider screens use a bounded side sheet without squeezing the lookup. | — |
| Accessibility | 8 | OpenOrdersList overrides row text with an aria-label containing only title, amount and current state; customer and item count disappear from its accessible name. | [OrderStrip.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/OrderStrip.tsx): In OpenOrdersList remove the overriding row `aria-label` and let the visible title/customer/item-count/amount text name the button, or append the same customer and count to it. Retain `aria-current`. |

Average: **8.80/10**. Every category 9+: **no**.

### Cash payment ([extra-cash-1500-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-cash-1500-desktop.png), [extra-cash-panel-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-cash-panel-desktop.png), [extra-cash-panel-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-cash-panel-ipad.png), [extra-cash-panel-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-cash-panel-phone.png), [ux-p3-phone-cash-1500.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p3-phone-cash-1500.png))

Code checked: [PayPanel.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/PayPanel.tsx), [checkout-ui.ts](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/checkout-ui.ts).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | The 40px balance, received amount, change and single Confirm cash action form an immediate task sequence. | — |
| Typography | 9 | Balances, input and change use sans tabular numerals with distinct 40/24/32px scales. | — |
| Layout & spacing | 9 | Quick amounts share a row; change is an inset block; the form has no oversized internal void. | — |
| Consistency | 9 | The strong tender track and outline exact/note shortcuts behave consistently at every supplied width. | — |
| Color & contrast | 9 | Change uses emerald with the word Change; shortages use amber with Short and an amount. | — |
| Efficiency | 9 | Exact cash starts prefilled; note chips calculate change without typing. | — |
| Clarity | 9 | Cash received, Change and Received now are short, concrete labels; editing time reveals Bangkok labels. | — |
| States & feedback | 9 | Short cash disables confirm and explains the gap; submitting locks fields; failures offer a same-attempt retry; stale orders require review. | — |
| Responsive | 9 | Phone sheet grows for change; iPad/desktop panel fits its task; code scrolls the amount above a reduced keyboard viewport. | — |
| Accessibility | 9 | Input has a label, cash confirmation includes received/change context in its accessible name, and change/shortage are live status output. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Split payment ([extra-split-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-split-desktop.png), [extra-split-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-split-ipad.png), [extra-split-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-split-phone.png), [ux-p3-ipad-split.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p3-ipad-split.png))

Code checked: [PayPanel.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/PayPanel.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Balance leads, payment rows follow and the confirmation names the allocation; the status recedes appropriately. | — |
| Typography | 9 | Sans money, readable method names and concise row labels remain coherent across widths. | — |
| Layout & spacing | 9 | Each amount sits beside its payment label; per-payment method tracks are grouped without horizontal overflow. | — |
| Consistency | 9 | Top-level tender choice is strong; per-payment choices correctly use the LOCKED subtle tone. | — |
| Color & contrast | 9 | Covered has a check and text; over-allocation has explicit words as well as destructive color. | — |
| Efficiency | 9 | One typed amount allocates the rest automatically; Add payment supports further tenders. | — |
| Clarity | 9 | “Rest”, “Covered · ฿1,200 in 2 payments” and the amount/method confirmation explain allocation. | — |
| States & feedback | 9 | Empty payment validation prevents premature Covered; over-allocation is explicit; retry and revision checks are preserved. | — |
| Responsive | 9 | Phone and iPad fit two allocations; additional rows remain in the scrollable panel. | — |
| Accessibility | 9 | Every payment amount and method group has an accessible name; validation is announced; focused amount has a visible ring. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Receipt ([extra-receipt-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-receipt-desktop.png), [extra-receipt-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-receipt-ipad.png), [extra-receipt-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-receipt-phone.png), [ux-p4-phone-manager-receipt.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p4-phone-manager-receipt.png))

Code checked: [ReceiptView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/ReceiptView.tsx), [AfterPayment.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/AfterPayment.tsx), [FinancialHistory.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/FinancialHistory.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Receipt identity and Paid state lead; New sale is primary; line actions and History are secondary. | — |
| Typography | 9 | The receipt paper is mono for its printed character, with explicit sans tabular money; screen item rows are 15px. | — |
| Layout & spacing | 9 | Paper and Items are separate, aligned surfaces; the phone folds paper above the actionable item list. | — |
| Consistency | 9 | Link appointment is outline and Refund is neutral ghost, exactly as locked. | — |
| Color & contrast | 9 | Paid and Not scheduled use distinct named badges; all ordinary actions retain clear contrast. | — |
| Efficiency | 9 | New sale, Print and line scheduling are directly available; secondary receipt actions live in More. | — |
| Clarity | 9 | Receipt/order references, amount and payment method are visible before line actions. | — |
| States & feedback | 9 | Loading, missing receipt, refunded/void states, line success notices and lazy ledger loading exist; refund drafts are guarded. | — |
| Responsive | 9 | Wider captures keep paper alongside item work; phone hides only the optional paper preview behind a disclosure. | — |
| Accessibility | 9 | Print and More have names; line refund labels name the service; live result text and focus restoration are coded. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Refund form ([extra-refund-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-refund-desktop.png), [extra-refund-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-refund-ipad.png), [extra-refund-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-refund-phone.png), [ux-p4-ipad-manager-refund.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p4-ipad-manager-refund.png))

Code checked: [RefundForm.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/RefundForm.tsx), [ReceiptView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/ReceiptView.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | The form opens immediately beneath its service line; the amount, destination and reason are in task order. | — |
| Typography | 9 | Labels are compact, service title is readable and refund amounts are sans tabular numerals. | — |
| Layout & spacing | 9 | The phone form is long but coherent; auto-reveal brings the whole active form into view. | — |
| Consistency | 7 | Amount presets and refund methods use foreground-filled pills rather than the LOCKED subtle choice-control treatment. | [RefundForm.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/RefundForm.tsx): Replace REFUND_CHIPS selected `bg-foreground text-background border-foreground` with the existing subtle token treatment (`bg-background text-foreground shadow-sm` on a `rounded-full bg-muted p-0.5` track), preferably using ToggleGroup `variant="segmented" tone="subtle"`. Apply the same subtle selected treatment to reason chips; keep destructive-outline submit and neutral receipt Refund. |
| Color & contrast | 9 | Refund submit is destructive-outline; invalid/disabled state is neutral and named; method choice remains legible. | — |
| Efficiency | 9 | All remaining money and the original method are preselected; reason chips let a routine refund avoid typing. | — |
| Clarity | 8 | After auto-scroll on phone the order/receipt identity is offscreen; the form title says only Refund. | [RefundForm.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/RefundForm.tsx): Add a persistent context line under the Refund heading: `{view.order.title} · {line.name}` with `text-xs text-muted-foreground`; keep it inside the auto-revealed form. Preserve the parent receipt/order references too. |
| States & feedback | 9 | Amount caps, required reason, pending approval, ambiguous-response retry, busy locking and success feedback are implemented. | — |
| Responsive | 9 | Five methods use a 3+2 phone grid and one wide row on iPad/desktop; the form stays with its item. | — |
| Accessibility | 9 | Amount, destination and reason are named; title receives focus; errors have alert semantics and cancel respects dirty guards. | — |

Average: **8.70/10**. Every category 9+: **no**.

### Approvals ([extra-approvals-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-approvals-desktop.png), [extra-approvals-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-approvals-phone.png), [ux-p1-ipad-manager-approvals.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p1-ipad-manager-approvals.png))

Code checked: [ApprovalsPanel.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/ApprovalsPanel.tsx), [ApprovalRequest.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/ApprovalRequest.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Each request leads with service and requested money change, then reason and decision buttons. | — |
| Typography | 9 | 15px request text and sans before/after amounts are readable; wrapping remains natural on phone. | — |
| Layout & spacing | 9 | Cards separate requests; reason, expiry and actions have a consistent rhythm. | — |
| Consistency | 9 | Outline Decline and filled Approve repeat predictably for each independent request. | — |
| Color & contrast | 9 | Near-expiry text is amber with explicit wording; decision errors use destructive text. | — |
| Efficiency | 9 | A manager decides directly in the queue; the last completed request closes the panel with feedback. | — |
| Clarity | 9 | Requester, reason, percentage, order reference and before/after total explain what approval permits. | — |
| States & feedback | 9 | Loading, empty, inline failure, busy spinner and per-decision result exist; expiry is display-only as locked. | — |
| Responsive | 9 | Phone requests wrap without collisions; iPad and desktop retain a bounded decision column. | — |
| Accessibility | 9 | Opening targets the heading rather than a decision; request list is named; touch sizing and live results are coded. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### New booking ([extra-new-booking-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-booking-ipad.png), [extra-new-booking-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-booking-phone.png), [ux-p5-new-booking-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p5-new-booking-phone.png))

Code checked: [NewBookingDialog.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/NewBookingDialog.tsx), [DeskBookingRangePicker.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/DeskBookingRangePicker.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Stay, Guest and Price are distinct groups; the total and Create booking complete the form. | — |
| Typography | 9 | Serif title, sans total and muted labels have a disciplined scale; no awkward date wraps. | — |
| Layout & spacing | 9 | Check-in/out remain side by side; guest count has its own narrow column; the footer has a clear divider. | — |
| Consistency | 9 | Villa picker, status toggle, fields and disabled primary action match the shared form system. | — |
| Color & contrast | 9 | Disabled Create booking has a readable reason; errors and warnings have explicit copy. | — |
| Efficiency | 9 | Default villa, two guests, date range selection and returning-guest suggestions reduce repeat entry. | — |
| Clarity | 9 | Total includes nights; missing guest/phone requirements are explained beside the submit area. | — |
| States & feedback | 9 | Availability loading/failure has retry; phone validation focuses the field; coupon refusals preserve input; close is guarded. | — |
| Responsive | 9 | Phone uses a full-width dialog with stacked contact fields; iPad uses a bounded two-column form where useful. | — |
| Accessibility | 9 | Labels, switch semantics, phone error associations and touch-sized pickers are present; native required/email/count constraints remain. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Stay details ([extra-stay-sheet-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-stay-sheet-ipad.png), [extra-stay-sheet-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-stay-sheet-phone.png), [ux-p5-stay-sheet-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p5-stay-sheet-ipad.png))

Code checked: [BookingSheet.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/BookingSheet.tsx), [BookingFinancials.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/BookingFinancials.tsx), [DisabledReason.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/DisabledReason.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest identity, status and balance are immediately apparent; Take payment is primary. | — |
| Typography | 9 | Serif guest name contrasts with sans money and compact label/value details. | — |
| Layout & spacing | 9 | Details use a fixed label column and dividers; notes sit in a separate surface. | — |
| Consistency | 9 | Header edit/more/close and Card surfaces match the appointment sheet. | — |
| Color & contrast | 9 | Confirmed and money states are named, with color supporting rather than replacing words. | — |
| Efficiency | 9 | Payment, external payment recording, contact links and header edit are easy to find. | — |
| Clarity | 9 | Stay dates, nights, guests, source and creation context are explicit; external payment has an explanatory tip. | — |
| States & feedback | 9 | Booking loading/not-found, notes errors/retry/success, checkout-live explanations and dirty-close guards exist. | — |
| Responsive | 9 | Phone stacks money actions; iPad keeps the bounded side sheet and uses available width for action alignment. | — |
| Accessibility | 9 | Header icons are labelled, fields have labels, links are native and touch targets have shared minimums. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Appointment details ([extra-appointment-sheet-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-appointment-sheet-ipad.png), [extra-appointment-sheet-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-appointment-sheet-phone.png))

Code checked: [AppointmentSheet.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AppointmentSheet.tsx), [AppointmentFinancials.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AppointmentFinancials.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest, status, inline Mark arrived and balance are easy to identify; payment is primary while due. | — |
| Typography | 9 | Service/staff/time details read cleanly; the balance is sans tabular 4xl. | — |
| Layout & spacing | 9 | Inline arrival follows the LOCKED placement; fixed labels and dividers align the details. | — |
| Consistency | 9 | The sheet shares stay header actions, surfaces, money layout and History disclosure. | — |
| Color & contrast | 9 | Booked is named; balance, subsequent status notices and failures have distinct words and tones. | — |
| Efficiency | 9 | Arrival is one tap; payment, phone contact, related stay and editing are directly reachable. | — |
| Clarity | 9 | “Room ready 11:05” distinguishes turnaround from treatment end; related stay dates explain context. | — |
| States & feedback | 9 | Balance uses a skeleton while financial data loads; mutation errors/status, disabled busy controls and draft guards are coded. | — |
| Responsive | 9 | The phone stacks money actions and related-stay detail; iPad preserves a bounded, readable side sheet. | — |
| Accessibility | 9 | Named header controls, semantic detail labels, native phone link and focus/touch primitives are present. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Hotel calendar ([extra-hotel-calendar-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-hotel-calendar-ipad.png), [extra-hotel-calendar-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-hotel-calendar-phone.png))

Code checked: [AdminBookingsView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminBookingsView.tsx), [AdminCalendarHeader.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminCalendarHeader.tsx), [TodayStrip.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/TodayStrip.tsx), [event-calendar-month-view.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/reui/event-calendar/event-calendar-month-view.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Today’s arrival/leaving/in-house/due strip leads, followed by date navigation and New booking. | — |
| Typography | 9 | Day numbers and service bars remain compact; KPI values are 28px on iPad and compact on phone. | — |
| Layout & spacing | 9 | Month weeks grow with actual stay bars; empty weeks stay compact; the page scrolls as locked. | — |
| Consistency | 9 | Subtle view control, shared search and named status badges match the rest of the desk. | — |
| Color & contrast | 9 | Month colors have status icons and a legend in code; phone rows spell out statuses and money due. | — |
| Efficiency | 9 | Phone defaults to an actionable list; iPad offers Month/Villas/List, date navigation and guest search. | — |
| Clarity | 9 | Phone rows state Arrives/Leaves/In house, villa, dates and balance rather than requiring calendar decoding. | — |
| States & feedback | 9 | Loading, no-stay CTA, search results, disabled creation until data and move confirmation/failure notices are coded. | — |
| Responsive | 9 | Phone four-up KPI strip and list are specifically designed; iPad month bars use the wide canvas. | — |
| Accessibility | 9 | Month day cells are keyboard-operable and at least 44px; event labels include guest/villa/dates/status; toolbar controls are named. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Staff calendar ([extra-staff-calendar-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-staff-calendar-ipad.png), [extra-staff-calendar-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-staff-calendar-phone.png))

Code checked: [AdminStaffBookingsView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminStaffBookingsView.tsx), [event-calendar-agenda-view.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/reui/event-calendar/event-calendar-agenda-view.tsx), [event-calendar-event.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/reui/event-calendar/event-calendar-event.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Date and New appointment lead; staff lanes and the current-time line organize the iPad schedule. | — |
| Typography | 9 | Guest titles and time/service/staff metadata are readable; sparse phone rows do not stretch type. | — |
| Layout & spacing | 9 | Lane headers align to time columns; turnaround occupies a distinct patterned block. | — |
| Consistency | 9 | Shared calendar toolbar and subtle view switches align with the hotel calendar. | — |
| Color & contrast | 9 | Legend names booked/arrived/in-service/completed states; breaks also have text and hatching. | — |
| Efficiency | 9 | Phone List surfaces upcoming work; staff filter, search and Next 16:00 cue support wide-screen navigation. | — |
| Clarity | 9 | Each phone row states guest, full time range, treatment and staff; non-default states have badges in code. | — |
| States & feedback | 9 | Loading and empty-calendar states, filtered staff, pending operations and mutation notices are provided. | — |
| Responsive | 9 | Phone uses a list rather than compressing four resource lanes; iPad uses the width for staff/time relationships. | — |
| Accessibility | 9 | Events are native controls with contextual labels; default Booked has screen-reader text; toolbars have touch/focus treatment. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Chats ([extra-chats-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-chats-ipad.png), [extra-chats-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-chats-phone.png), [ux-p6-phone-chat.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p6-phone-chat.png))

Code checked: [ChatsView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/ChatsView.tsx), [AdminSessionDetail.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminSessionDetail.tsx), [useAdminReplyComposer.ts](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/useAdminReplyComposer.ts).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest identity and No reply needed are anchored in the header; transcript and bottom composer remain distinct. | — |
| Typography | 9 | 16px guest name and 13px channel/property metadata fit phone; message text is comfortable. | — |
| Layout & spacing | 9 | iPad list and transcript divide cleanly; composer stays beneath the independently scrolling transcript. | — |
| Consistency | 9 | Message surfaces, shared status badges and labelled icon actions are consistent. | — |
| Color & contrast | 9 | Needs you is an explicit amber badge; sent/received alignment and AI labels supplement bubble color. | — |
| Efficiency | 9 | Phone hides contact details behind Info and uses an icon for No reply needed; shortcuts support desktop work. | — |
| Clarity | 8 | iPad says both Needs you and Waiting for staff in the same header, duplicating the same staff-response state. | [AdminSessionDetail.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminSessionDetail.tsx): Suppress the automation chip when `automationLabel === "Waiting for staff"` and the Needs you badge already conveys it. Keep distinct AI paused / AI replying states and expose the waiting detail in Chat details. |
| States & feedback | 9 | List/transcript loading, empty results, reply-window lockout, send failure/status and per-session draft guards are implemented. | — |
| Responsive | 9 | Phone has a compact two-line header and full transcript; iPad presents master/detail without clipped controls. | — |
| Accessibility | 9 | Composer and icon actions have names; closed reply windows explain disability; alert/status output and keyboard send are coded. | — |

Average: **8.90/10**. Every category 9+: **no**.

### Missing information ([extra-missing-information-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-missing-information-ipad.png), [extra-missing-information-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-missing-information-phone.png), [ux-p6-desktop-missing.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p6-desktop-missing.png))

Code checked: [MissingInformationPanel.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/MissingInformationPanel.tsx), [combobox.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/ui/combobox.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Questions lead and Resolve is aligned with each question; filters recede above the list. | — |
| Typography | 9 | 15px questions and 12px metadata separate content from date/property/category details. | — |
| Layout & spacing | 9 | Wide rows align resolve/actions; phone puts Resolve and Create fact on the same task row. | — |
| Consistency | 9 | Table-like rows, filters, ghost create and More use the shared system. | — |
| Color & contrast | 9 | Asked count and category are distinct named chips; controls and question text have clear contrast. | — |
| Efficiency | 9 | Searchable fact/source resolution supports paginated search; Create fact is directly adjacent. | — |
| Clarity | 9 | Questions are plain; source property and repeated-question count provide useful context. | — |
| States & feedback | 8 | Action failures are rendered only in the top actionError banner, detached from the affected row in a long scrolled list. | [MissingInformationPanel.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/MissingInformationPanel.tsx): Store row errors by normalized-question key and render `role="alert" className="mt-2 text-sm text-destructive"` below that row’s Resolve control; include “Couldn’t resolve this question. Try again.” Keep a top summary for bulk actions. |
| Responsive | 9 | Phone moves actions under each question while iPad/desktop keep inline columns; no table overflow is imposed. | — |
| Accessibility | 9 | Checkboxes have activating labels; Resolve names its question; search, row menus and focus/touch primitives are labelled. | — |

Average: **8.90/10**. Every category 9+: **no**.

### Business settings ([extra-settings-business-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-business-ipad.png), [extra-settings-business-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-business-phone.png), [ux-p7-business-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p7-business-desktop.png))

Code checked: [AdminSettingsView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminSettingsView.tsx), [SegmentedTabs.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/SegmentedTabs.tsx), [time-picker.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/ui/time-picker.tsx), [use-unsaved-guard.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/hooks/use-unsaved-guard.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 8 | A persistent filled Save appears before any edits because usingDefaults bypasses dirty-only visibility. | [AdminSettingsView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminSettingsView.tsx): Set the sticky action bar condition to `!readOnly && dirty`. Render transient Saved feedback inline as `role="status"`; move the existing default-persistence action into History as outline “Save these defaults”, preserving that function without a clean-form primary bar. |
| Typography | 8 | The phone tab rail cuts AI assistant into the visible fragment “AI ass”; form text otherwise follows the scale. | [SegmentedTabs.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/SegmentedTabs.tsx): Add a soft end mask to the scroll viewport, for example `[mask-image:linear-gradient(to_right,#000_calc(100%_-_1.5rem),transparent)]`, while trailing tabs overflow; clear the mask at the end. Keep the separate 44px More tabs button and full accessible labels. |
| Layout & spacing | 9 | Four rounded Cards align headings left and fields right at iPad/desktop; phone stacks sensibly. | — |
| Consistency | 9 | Fields, shared time picker and Cards are consistent; the defaults Save exception needs the hierarchy fix above. | — |
| Color & contrast | 9 | Labels are dark enough to read; validation uses text and invalid state, not only borders. | — |
| Efficiency | 9 | Related contact fields are grouped; currency/time zone and time picker avoid raw hour/minute controls. | — |
| Clarity | 9 | The usage scope is stated above the form and optional fields are marked; section descriptions are short. | — |
| States & feedback | 9 | Loading, field errors/focus, retained stale drafts, saving/saved and unload/in-app guards are present. | — |
| Responsive | 9 | Phone contact fields stack; wide layouts use the intended 1/3–2/3 split; bottom padding lets final fields scroll clear. | — |
| Accessibility | 9 | Fields have label/id associations and error descriptions; read-only mode is labelled; shared controls carry focus and touch minimums. | — |

Average: **8.80/10**. Every category 9+: **no**.

### Team settings ([extra-settings-team-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-team-desktop.png), [extra-settings-team-ipad-full.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-team-ipad-full.png), [extra-settings-team-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-team-ipad.png), [extra-settings-team-phone-full.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-team-phone-full.png), [extra-settings-team-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-team-phone.png), [ux-p7-team-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p7-team-phone.png))

Code checked: [TeamSettings.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/TeamSettings.tsx), [AdminSettingsView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminSettingsView.tsx), [SegmentedTabs.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/SegmentedTabs.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | People and Invite lead; cashier rules are a separate, clearly subordinate section. | — |
| Typography | 8 | The shared phone tab rail clips AI assistant into “AI ass”; name/email/role typography itself is coherent. | [SegmentedTabs.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/SegmentedTabs.tsx): Apply the same overflow-only end mask as Business settings so partially visible words fade out; keep the More tabs control, keyboard navigation and complete labels. |
| Layout & spacing | 9 | Rows align Change using the LOCKED reserved More column; phone wraps role controls predictably. | — |
| Consistency | 9 | Neutral role badges, amber invitation badges and subtle permission toggles execute the LOCKED choices. | — |
| Color & contrast | 9 | Invited includes an expiry date in amber; expired invitations use destructive treatment in code. | — |
| Efficiency | 9 | Invite and inline role editing avoid separate pages; cashier permissions share one save operation. | — |
| Clarity | 9 | “Sign-in access and cashier permissions” states scope; permission rows and invitation expiry are explicit. | — |
| States & feedback | 9 | Loading, invite validation, row save results, stale rules warning and dirty-only Save are coded. | — |
| Responsive | 9 | Phone rows wrap identity above role/actions; iPad and desktop retain aligned columns; full captures reveal rules without occlusion. | — |
| Accessibility | 9 | Change names its person, inputs are labelled, permission controls are grouped and touch/focus styles are present. | — |

Average: **8.90/10**. Every category 9+: **no**.

### New coupon (empty and filled) ([extra-new-coupon-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-coupon-desktop.png), [extra-new-coupon-filled-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-coupon-filled-desktop.png), [extra-new-coupon-filled-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-coupon-filled-ipad.png), [extra-new-coupon-filled-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-coupon-filled-phone.png), [extra-new-coupon-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-coupon-ipad.png), [extra-new-coupon-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-new-coupon-phone.png), [ux-p8-new-coupon-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p8-new-coupon-phone.png))

Code checked: [CouponEditor.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/CouponEditor.tsx), [coupon-form.ts](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/coupon-form.ts), [use-unsaved-guard.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/hooks/use-unsaved-guard.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Code and discount lead; Save & publish is primary; summary appears only after a valid discount. | — |
| Typography | 9 | Serif title, mono code and 28px sans “20% off” provide a clear, appropriate scale. | — |
| Layout & spacing | 9 | The LOCKED single max-w-3xl column stays bounded; summary sits below rather than creating an empty side column. | — |
| Consistency | 9 | All choice controls are subtle segmented groups; form and summary share Card treatment. | — |
| Color & contrast | 9 | Focus ring is visible on the discount; unsaved state is named, not indicated only by color. | — |
| Efficiency | 9 | Scope/villas have sensible defaults; uncommon dates and limits fold under More. | — |
| Clarity | 9 | Discount echo gives a nightly savings range; summary spells out scope, dates and rules. | — |
| States & feedback | 9 | Validation opens hidden rule errors and focuses the first field; save/publish failures, saved draft outcomes and dirty guards exist. | — |
| Responsive | 9 | Phone uses a pinned save bar with matching bottom padding; iPad/desktop use header actions and the same bounded column. | — |
| Accessibility | 9 | Inputs and toggle groups are labelled; hidden errors are revealed/focused; disclosures and controls have touch/focus treatment. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Marketing dashboard ([extra-marketing-dashboard-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-marketing-dashboard-ipad.png), [extra-marketing-dashboard-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-marketing-dashboard-phone.png), [ux-p8-dashboard-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p8-dashboard-desktop.png))

Code checked: [DashboardScreen.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardScreen.tsx), [DashboardView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardView.tsx), [DashboardTiles.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardTiles.tsx), [DashboardChart.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardChart.tsx).

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Net collected is the dominant tile; business total is folded inside it and secondary KPIs recede. | — |
| Typography | 9 | 40px hero, 28px secondary values and muted labels establish a coherent scale; phone visit caption wraps but remains readable. | — |
| Layout & spacing | 9 | Hero spans two columns and secondary tiles form a stable wide grid; phone uses two-up secondary tiles. | — |
| Consistency | 9 | Stat Cards, subtle view/metric controls and shared information tips are consistent. | — |
| Color & contrast | 9 | Figures are dark and readable; chart series have names and a table alternative in code. | — |
| Efficiency | 9 | Date/property filters lead; view/export controls are compact; the chart supports series toggling and a table. | — |
| Clarity | 9 | Results from tracked links qualifies the hero; chart headings and attribution help explain scope. | — |
| States & feedback | 8 | Changing range or basis retains old report figures while new toolbar selections display; on phone updating text is hidden. | [DashboardScreen.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardScreen.tsx): Retain the ready report only for a reread of the same `from`, `to` and `basis`; use the existing LoadingBody for a changed scope. In DashboardView, visibly say “Updating… · showing previous figures” during same-scope refresh. |
| Responsive | 9 | Phone folds tracking detail and exposes secondary actions through More; iPad/desktop put KPIs and chart to good use. | — |
| Accessibility | 8 | Chart has a labelled image and an accessible table, but phone refresh progress is only an aria-hidden colored/animated dot until More is opened. | [DashboardView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardView.tsx): Put `{busy ? "Updating…" : "Updated"}` in the always-visible `role="status"` text and add `aria-busy={busy}` to the report results wrapper. Keep the dot supplementary and respect reduced motion. |

Average: **8.80/10**. Every category 9+: **no**.

## Below 9

Sorted by impact. Every below-target (screen, category) pair is included; shared fixes remain separate scored pairs.

| Screen | Category | Score | Concrete buildable fix |
|---|---|---:|---|
| Refund form | Clarity | 8 | **Refund loses transaction identity after phone auto-scroll.** [RefundForm.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/RefundForm.tsx): Add a persistent context line under the Refund heading: `{view.order.title} · {line.name}` with `text-xs text-muted-foreground`; keep it inside the auto-revealed form. Preserve the parent receipt/order references too. |
| Marketing dashboard | States & feedback | 8 | **Phone can show a newly selected period/view above figures from the previous report with no visible updating words.** [DashboardScreen.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardScreen.tsx): Retain the ready report only for a reread of the same `from`, `to` and `basis`; use the existing LoadingBody for a changed scope. In DashboardView, visibly say “Updating… · showing previous figures” during same-scope refresh. |
| Missing information | States & feedback | 8 | **A failed resolve action is detached from its row when the top banner is out of view.** [MissingInformationPanel.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/MissingInformationPanel.tsx): Store row errors by normalized-question key and render `role="alert" className="mt-2 text-sm text-destructive"` below that row’s Resolve control; include “Couldn’t resolve this question. Try again.” Keep a top summary for bulk actions. |
| Orders | Clarity | 8 | **The cashier paid-order lookup does not state its today-only permission scope.** [OrderStrip.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/OrderStrip.tsx): Change the cashier Orders sheet description to “Open an unpaid order below, or find today’s receipt by its order number (#).” Change the lookup label to “Order number · today’s receipts”. Keep all existing permission gates. |
| Orders | Accessibility | 8 | **The open-order aria-label omits customer and item count that sighted staff can use to distinguish rows.** [OrderStrip.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/OrderStrip.tsx): In OpenOrdersList remove the overriding row `aria-label` and let the visible title/customer/item-count/amount text name the button, or append the same customer and count to it. Retain `aria-current`. |
| Marketing dashboard | Accessibility | 8 | **Phone refresh progress has no exposed textual status outside the closed More menu.** [DashboardView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/marketing/dashboard/DashboardView.tsx): Put `{busy ? "Updating…" : "Updated"}` in the always-visible `role="status"` text and add `aria-busy={busy}` to the report results wrapper. Keep the dot supplementary and respect reduced motion. |
| Refund form | Consistency | 7 | **Refund presets/methods use strong selected fills that violate the locked tone system.** [RefundForm.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/checkout/RefundForm.tsx): Replace REFUND_CHIPS selected `bg-foreground text-background border-foreground` with the existing subtle token treatment (`bg-background text-foreground shadow-sm` on a `rounded-full bg-muted p-0.5` track), preferably using ToggleGroup `variant="segmented" tone="subtle"`. Apply the same subtle selected treatment to reason chips; keep destructive-outline submit and neutral receipt Refund. |
| Business settings | Hierarchy | 8 | **The initial clean form promotes a Save bar that the brief reserves for dirty forms.** [AdminSettingsView.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminSettingsView.tsx): Set the sticky action bar condition to `!readOnly && dirty`. Render transient Saved feedback inline as `role="status"`; move the existing default-persistence action into History as outline “Save these defaults”, preserving that function without a clean-form primary bar. |
| Chats | Clarity | 8 | **The iPad header repeats Needs you and Waiting for staff.** [AdminSessionDetail.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/AdminSessionDetail.tsx): Suppress the automation chip when `automationLabel === "Waiting for staff"` and the Needs you badge already conveys it. Keep distinct AI paused / AI replying states and expose the waiting detail in Chat details. |
| Business settings | Typography | 8 | **The right edge of the phone tab strip exposes the broken label AI ass.** [SegmentedTabs.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/SegmentedTabs.tsx): Add a soft end mask to the scroll viewport, for example `[mask-image:linear-gradient(to_right,#000_calc(100%_-_1.5rem),transparent)]`, while trailing tabs overflow; clear the mask at the end. Keep the separate 44px More tabs button and full accessible labels. |
| Team settings | Typography | 8 | **The shared phone tab strip exposes AI ass on Team too.** [SegmentedTabs.tsx](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/src/components/admin/SegmentedTabs.tsx): Apply the same overflow-only end mask as Business settings so partially visible words fade out; keep the More tabs control, keyboard navigation and complete labels. |

## Visual bugs

1. **Strong refund selections conflict with the locked subtle-control system.** Selected All and Card have solid dark fills, producing competing emphases inside the inline form. Seen in [extra-refund-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-refund-desktop.png), [extra-refund-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-refund-ipad.png), [extra-refund-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-refund-phone.png), [ux-p4-ipad-manager-refund.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p4-ipad-manager-refund.png). Fix: the RefundForm choice-control change listed above.

2. **Phone settings navigation clips AI assistant mid-word into “AI ass”.** Seen in [extra-settings-business-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-business-phone.png), [extra-settings-team-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-team-phone.png), [extra-settings-team-phone-full.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-team-phone-full.png), [ux-p7-team-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p7-team-phone.png). Fix: fade the trailing partial tab while preserving More tabs and complete accessible labels.

3. **A clean Business form displays a sticky filled Save action.** The label “Using built-in defaults” confirms that this is the initial state, rather than a user edit. It competes with fields and consumes the bottom of the touch viewport. Seen in [extra-settings-business-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-business-phone.png), [extra-settings-business-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/extra-settings-business-ipad.png), [ux-p7-business-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-d32585dc-4ad26adc5b22b6ae/docs/screenshots/audit-r3/ux-p7-business-desktop.png). Fix: dirty-only sticky bar, with default persistence retained as a secondary History action.

No additional overlap, horizontal overflow or clipped active-form control was established from the supplied captures. The order dock and long coupon summary have scroll clearance in code. The clipped bottom of an ordinary viewport capture, growing month weeks, the reserved Team More column, neutral receipt Refund, inline Mark arrived and the single-column coupon summary are not bugs.

## Per-screen averages

| Screen | Average / 10 | Every category 9+ |
|---|---:|---|
| Checkout catalog / till | 9.00 | Yes |
| Order line editor | 9.00 | Yes |
| Orders | 8.80 | No |
| Cash payment | 9.00 | Yes |
| Split payment | 9.00 | Yes |
| Receipt | 9.00 | Yes |
| Refund form | 8.70 | No |
| Approvals | 9.00 | Yes |
| New booking | 9.00 | Yes |
| Stay details | 9.00 | Yes |
| Appointment details | 9.00 | Yes |
| Hotel calendar | 9.00 | Yes |
| Staff calendar | 9.00 | Yes |
| Chats | 8.90 | No |
| Missing information | 8.90 | No |
| Business settings | 8.80 | No |
| Team settings | 8.90 | No |
| New coupon (empty and filled) | 9.00 | Yes |
| Marketing dashboard | 8.80 | No |

Overall average: **8.94/10** (1698/1900 points; 190 category scores).
Screens with 9+ in every category: **12/19**.
Below-target category scores: **11**, across **7** screens.
Images reviewed: **68/68**.
