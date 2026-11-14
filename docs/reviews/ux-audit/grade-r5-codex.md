# Independent UX/UI scorecard — round 5

Reviewed latest local `ux/integration`, detached at `620e5bc40b8d1d469f89591a5a6a7e33db5afd65` (contains required `620e5bc4`).

Method: opened every one of the 94 PNGs individually and inspected the rendered image. Read only the three authorized review documents in `docs/reviews/ux-audit/`: the rubric, visual brief and locked design decisions. No other file in that directory was read. Used screenshot-scene and touch-target test source plus the relevant component/shared-hook code to assess states not visible in the captures. No browser tests were executed, no product code changed, no push/PR, and no Convex deployment action. Accessibility/state grades are source-backed review judgments, not a fresh runtime certification.

Grouping: 23 screens. Phone/iPad/desktop captures are one screen; line-open/therapist/discount-request are order-editor states; empty/filled coupon and clean/dirty settings are states of their screen. Cash, split, Orders, receipt, line refund and approvals are distinct task surfaces. Each settings tab is graded separately. All categories have equal weight; responsive scores cover all supplied widths. A 9 is shipping quality with at most a nit. Locked choices themselves receive no penalty.

Financial-flow notes: guards and prompts proposed below preserve all money approvals, permissions, attempt keys and revision checks. The Finance source chart intentionally says Collected; the negative-net finding applies specifically to the hero tracking mix, not to that gross-collection chart. Scrolling below the viewport and fixed bars in full-page screenshots are not automatically clipping defects.

**Result: 8.94/10 overall; 16/23 screens score 9+ in every category; 13 screen/category pairs below 9.**

### Checkout catalog / till (`extra-checkout-start-desktop.png`, `extra-checkout-start-ipad.png`, `extra-checkout-start-phone.png`, `ux-p1-phone-cashier-till.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Catalog selection is the task; the phone View order / Cash rail gives a clear next step. | — |
| Typography | 9 | 15px item names, muted duration and sans tabular prices scan cleanly at all three widths. | — |
| Layout & spacing | 9 | Two iPad columns and three desktop columns align; phone cards have generous separation. | — |
| Consistency | 9 | Catalog cards, underlined tabs and outline secondary actions use the shared visual vocabulary. | — |
| Color & contrast | 9 | Dark prices and labels contrast with warm surfaces; gold is limited to add affordances. | — |
| Efficiency | 9 | Whole item tiles add; Frequent and cross-catalog search support repeat sales. | — |
| Clarity | 9 | Rooms explicitly explains that a charge does not reserve dates; the empty order tells staff to tap an item. | — |
| States & feedback | 9 | Catalog skeletons, empty/search results and checkout errors are implemented; item counts feed back into the order. | — |
| Responsive | 9 | Phone rail has catalog bottom padding/scroll padding; the wide order pane uses its own space. | — |
| Accessibility | 9 | Named search, keyboard tabs, labelled add actions and coarse-pointer target styles are present. | — |

Average: **9.00/10**.

### Order line editor (`extra-discount-reason-desktop.png`, `extra-discount-reason-ipad.png`, `extra-discount-reason-phone.png`, `extra-line-open-desktop.png`, `extra-line-open-ipad.png`, `extra-line-open-phone.png`, `extra-therapist-chips-desktop.png`, `extra-therapist-chips-ipad.png`, `extra-therapist-chips-phone.png`, `ux-p2-phone-line-open.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Balance due and Cash are dominant; discount, schedule and price form a readable settings list. | — |
| Typography | 9 | 0% placeholder, tabular amounts and 15px line title follow the brief. | — |
| Layout & spacing | 8 | The absolute 48px More item options gradient washes out Schedule/date/time/Remove item content. | [OrderPanel.tsx:293](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/OrderPanel.tsx:293): Render the continuation cue as a separate shrink-0 min-h-6 row below the item scroller, rather than absolute inset-x-0 bottom-0 h-12 over its content. Keep it conditional on moreBelow; retain scrolling, the total and payment safeguards. |
| Consistency | 9 | Therapist and discount-reason selections are subtle, as locked; remove is the destructive row. | — |
| Color & contrast | 9 | Normal labels and monetary values are legible; warning copy distinguishes the approval threshold. | — |
| Efficiency | 9 | Discount edits stay on the line; schedule folds; above-limit requests keep their reason beside the amount. | — |
| Clarity | 9 | Up to 10% without approval, Not scheduled and Price are explicit. | — |
| States & feedback | 9 | Writes show Saving/error feedback; approval waiting and stale source rows explain disabled payment actions. | — |
| Responsive | 8 | The phone header wraps Coupon/menu/close onto another row, spending roughly 44px needed by the expanded editor. | [OrderPanel.tsx:192](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/OrderPanel.tsx:192): At max-sm hide the decorative receipt glyph, make the Coupon action a size-11 icon with its text sr-only, retain aria-label="Add coupon", and keep title/menu/close in one header row. Preserve the wide header and accessible control names. |
| Accessibility | 9 | Inputs have labels/invalid descriptions; line disclosure, therapist pressed states and targets are implemented. | — |

Average: **8.80/10**.

### Cash payment (`extra-cash-1500-desktop.png`, `extra-cash-panel-desktop.png`, `extra-cash-panel-ipad.png`, `extra-cash-panel-phone.png`, `ux-p3-phone-cash-1500.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | 40px balance, 24px received value, 32px Change and full-width Confirm establish a decisive hierarchy. | — |
| Typography | 9 | All amounts use sans tabular numerals, with comfortable grouping and no currency collisions. | — |
| Layout & spacing | 9 | Cash input and equal quick chips align; the confirmation stays low and the change block is separate. | — |
| Consistency | 9 | The strong tender track and quiet outlined pressed cash chip match the locked choices. | — |
| Color & contrast | 9 | Green Change and amber Short carry labels; the primary action remains the strongest element. | — |
| Efficiency | 9 | Exact is prefilled; note chips make common change calculations one tap. | — |
| Clarity | 9 | Cash received, Change and Confirm cash leave little to decode. | — |
| States & feedback | 9 | Short cash disables confirmation with a visible deficit; payment retries freeze the attempt and explain retry behavior. | — |
| Responsive | 9 | Phone bottom sheet fits; keyboard viewport handling reveals the amount and retains confirmation access. | — |
| Accessibility | 9 | Labelled cash field, active-tender focus, Escape handling and live change/short outputs are present. | — |

Average: **9.00/10**.

### Split payment (`extra-split-desktop.png`, `extra-split-ipad.png`, `extra-split-phone.png`, `ux-p3-ipad-split.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Balance, payment rows, Covered status and the explicit confirmation read in the right order. | — |
| Typography | 9 | Tabular amounts and compact row labels remain readable on phone and iPad. | — |
| Layout & spacing | 9 | Each payment has one amount row and one method track; summary and action are separated. | — |
| Consistency | 9 | Split is inside the strong tender track; each payment method uses the locked subtle treatment. | — |
| Color & contrast | 9 | Coverage has a check and text; over-allocation is explicitly labelled, not conveyed by color alone. | — |
| Efficiency | 9 | The final payment takes the rest automatically; one typed amount completes a two-way split. | — |
| Clarity | 9 | Payment 2 · rest and Confirm ฿500 cash + ฿700 PromptPay state exactly what will be recorded. | — |
| States & feedback | 9 | Empty typed rows show validation rather than Covered; excess allocation and retry locking are implemented. | — |
| Responsive | 9 | The same row structure fits the 390px sheet without horizontal squeezing. | — |
| Accessibility | 9 | Each amount and method group is named; validation descriptions, live status and labelled removal are present. | — |

Average: **9.00/10**.

### Orders (`extra-orders-desktop.png`, `extra-orders-ipad.png`, `ux-p2b-phone-orders.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Open orders lead, followed by the separate order-number lookup. | — |
| Typography | 9 | Order numbers and amounts are strong; customer and item count recede. | — |
| Layout & spacing | 9 | Spaced full-width rows and a divided lookup make the narrow panel easy to scan. | — |
| Consistency | 9 | The responsive dialog uses the same panel/sheet and control vocabulary as checkout. | — |
| Color & contrast | 9 | Current is a neutral label; amounts and navigation affordances are legible. | — |
| Efficiency | 9 | Tap an open row or type the displayed order number; a found result opens directly. | — |
| Clarity | 9 | Copy distinguishes open orders from today’s receipts; receipt-number input gets a specific correction. | — |
| States & feedback | 9 | Loading, no results, invalid input and inline retry preserve the lookup text. | — |
| Responsive | 9 | Phone bottom sheet and wide side panel retain useful row widths. | — |
| Accessibility | 9 | Order-number label, error association, full-row buttons and dialog focus behavior are present. | — |

Average: **9.00/10**.

### Receipt (`extra-receipt-desktop.png`, `extra-receipt-ipad.png`, `extra-receipt-phone.png`, `ux-p4-phone-manager-receipt.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Paid receipt identity and New sale lead; line-level Link appointment and Refund remain secondary. | — |
| Typography | 9 | Receipt paper is mono for its text, with explicit sans tabular money; side-card item type is coherent. | — |
| Layout & spacing | 9 | Paper and Items are cleanly separated; phone stacks a folded preview above item actions. | — |
| Consistency | 9 | Neutral ghost Refund, outline Link appointment and New sale match the locked choices. | — |
| Color & contrast | 9 | Paid and Not scheduled use meaningful status colors plus words. | — |
| Efficiency | 9 | New sale and Print are direct; rare sharing and correction actions live in the menu. | — |
| Clarity | 8 | Expanded refund/activity history exposes database stay/appointment/customer IDs as ordinary staff-facing copy. | [FinancialHistory.tsx:157](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/FinancialHistory.tsx:157): In Refund/Audit use the available guest/service/date or booking/order reference from view.lines/view.links/view.sources for the primary label; otherwise use “Linked stay”, “Linked appointment” or “Customer reference”. Put raw IDs behind a closed “Technical details” disclosure, preserving the audit data. |
| States & feedback | 8 | Refund drafts are guarded, but Correct payment / Void drafts can be lost through toolbar Close or Escape. | [ReceiptView.tsx:229](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/ReceiptView.tsx:229): Report task dirty state from CorrectPayment/VoidPanel in PaymentRecord.tsx. Gate toolbar Close, Escape, New sale and in-app navigation through useUnsavedGuard(refundDirty \|\| taskDirty); bypass the guard after successful onDone. Reuse “Discard unsaved changes?” / “Keep editing” / “Discard”. Preserve attempt keys, frozen retries and revision checks. |
| Responsive | 9 | Phone Print becomes a labelled icon and New sale fills the row; wider receipt layout is comfortably bounded. | — |
| Accessibility | 9 | Print is named; line action names include the item; history has keyboard tabs and post-action focus feedback. | — |

Average: **8.80/10**.

### Receipt line refund (`extra-refund-desktop.png`, `extra-refund-ipad.png`, `extra-refund-phone.png`, `ux-p4-ipad-manager-refund.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | The inline Refund form is attached to Foot spa 45 and keeps its amount visible. | — |
| Typography | 9 | Compact 13px phone method/reason labels fit without truncation; money remains sans/tabular. | — |
| Layout & spacing | 9 | The form has deliberate grouping and a stable footer; opening it scrolls the line into view. | — |
| Consistency | 9 | All/Half, methods and reasons use subtle tracks; submit is destructive outline. | — |
| Color & contrast | 9 | The disabled Pick a reason action is readable; active destructive treatment is reserved for submission. | — |
| Efficiency | 9 | All and original payment method default sensibly; a reason chip completes the common case. | — |
| Clarity | 9 | Records money already returned to the guest clearly separates recording from moving money. | — |
| States & feedback | 9 | Caps, invalid amounts, approval waiting, frozen ambiguous retries and success notices are implemented. | — |
| Responsive | 9 | The locked five-option phone track fits; wide layout retains the paper alongside. | — |
| Accessibility | 9 | Amount and reason labels, error descriptions, initial form focus and return-to-trigger focus are present. | — |

Average: **9.00/10**.

### Approvals (`extra-approvals-desktop.png`, `extra-approvals-phone.png`, `ux-p1-ipad-manager-approvals.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Requester, requested money and Approve are prominent; order context and expiry recede. | — |
| Typography | 9 | 15px request headline, 14px totals and muted reason form a coherent compact card. | — |
| Layout & spacing | 9 | Each request has one bounded card and a clear action row; phone sheet remains readable. | — |
| Consistency | 9 | Outline Decline and filled Approve use the same actions in phone, iPad and desktop. | — |
| Color & contrast | 9 | Warning expiry and readable reason block support decisions without decorative color. | — |
| Efficiency | 9 | Approve or decline is direct; a completed final request closes and reports its result. | — |
| Clarity | 9 | Before → after total and the cashier’s quoted reason make the proposed effect explicit. | — |
| States & feedback | 9 | Queue loading/empty, per-request errors, pending decisions and result notices are implemented; expiry stays server-decided. | — |
| Responsive | 9 | Phone stacks full request cards; wide panel does not stretch the decision content. | — |
| Accessibility | 9 | Title initial focus, named dialog, labelled information control and 44px coarse-pointer actions are present. | — |

Average: **9.00/10**.

### New booking (`extra-new-booking-desktop.png`, `extra-new-booking-ipad.png`, `extra-new-booking-phone.png`, `ux-p5-new-booking-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Stay, Guest and Price groups lead toward a single Create booking action and total. | — |
| Typography | 9 | Section type and muted labels are coherent; total is sans tabular and prominent. | — |
| Layout & spacing | 9 | Dates remain side by side; 24px section gaps and a separate footer maintain rhythm. | — |
| Consistency | 9 | Subtle status track, shared pickers and the locked Ban alternative placement are correctly executed. | — |
| Color & contrast | 9 | Disabled Create is legible, with its blocking explanation beside the action. | — |
| Efficiency | 9 | Default villa/status/guest count and returning-guest suggestions reduce entry effort. | — |
| Clarity | 9 | Total, nights and the exact missing fields explain why submission is unavailable. | — |
| States & feedback | 9 | Availability/coupon checking, retry, conflicts, validation, retained drafts and close/navigation guards are implemented. | — |
| Responsive | 9 | Phone uses a fieldset scroller and non-overlapping footer; iPad/desktop use a bounded dialog. | — |
| Accessibility | 9 | Guest/date/phone labels, phone error association, switch naming and coarse-pointer controls are present. | — |

Average: **9.00/10**.

### Stay sheet (`extra-stay-sheet-ipad.png`, `extra-stay-sheet-phone.png`, `ux-p5-stay-sheet-ipad.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest, status and Balance due make the collection task immediately apparent. | — |
| Typography | 9 | Large sans tabular money and fixed-label detail rows follow the brief. | — |
| Layout & spacing | 9 | One money card and one detail list separate tasks from reference data. | — |
| Consistency | 8 | The external-payment MethodPicker still uses a strong selected style reserved for checkout tender/mode. | [BookingMoneyFields.tsx:123](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/BookingMoneyFields.tsx:123): In MethodPicker use ToggleGroup variant="segmented" tone="subtle"; remove ToggleGroupItem data-[state=on]:bg-foreground and data-[state=on]:text-background overrides. Keep all method options and touch target sizes. |
| Color & contrast | 9 | Status and amounts remain legible; primary Take payment dominates the secondary external record action. | — |
| Efficiency | 9 | Collection, editing, contact links and notes are available in a compact sheet. | — |
| Clarity | 9 | Stay versus spa debt is explicit; the external payment info explains the recording action. | — |
| States & feedback | 8 | Notes/edit drafts are guarded, but external-payment method/time/note drafts close without a discard guard. | [BookingFinancials.tsx:375](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/BookingFinancials.tsx:375): Track edited method, when.edited, note/reason/amount and notify choice in the money dialogs. Pass a guarded cancel callback to ChangeConfirmDialog, with a separate successful-close callback so successful recording does not prompt. Use the existing discard copy and preserve all financial safeguards. |
| Responsive | 9 | Phone makes Take payment full width; iPad keeps a bounded 30rem sheet. | — |
| Accessibility | 9 | Header icons are named, contact targets are expanded and financial actions retain labelled help. | — |

Average: **8.80/10**.

### Appointment sheet (`extra-appointment-sheet-ipad.png`, `extra-appointment-sheet-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Ken, booked status/Mark arrived and Balance due establish status and collection clearly. | — |
| Typography | 9 | Tabular balance and stable 96px-label detail rows are readable. | — |
| Layout & spacing | 9 | Financial and reference cards are aligned with generous row separation. | — |
| Consistency | 8 | The external-payment/correction MethodPicker still uses strong selection outside checkout tender/mode. | [BookingMoneyFields.tsx:123](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/BookingMoneyFields.tsx:123): Apply the same shared MethodPicker change: variant="segmented" tone="subtle" and remove the two explicit strong selected-state classes; retain all method options and 44px targets. |
| Color & contrast | 9 | Status includes text; Take payment is the only filled action while a balance remains. | — |
| Efficiency | 9 | Mark arrived is correctly beside status; stay, phone, edit and history are easy to reach. | — |
| Clarity | 9 | When and Room ready make service and turnaround times distinct. | — |
| States & feedback | 8 | Edit drafts are guarded, but the money-dialog method/time/reason draft can be dismissed without a guard. | [AppointmentFinancials.tsx:95](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AppointmentFinancials.tsx:95): Use useUnsavedGuard for differences from the captured money-dialog defaults. Route X/Escape/outside cancellation through confirmDiscard and bypass it on successful recording. Keep the submitted-attempt lock, revision and idempotency handling. |
| Responsive | 9 | Phone stacks the financial actions; wide sheet remains compact beside the staff calendar. | — |
| Accessibility | 9 | Named header buttons, contact targets and editor labels/focus are implemented. | — |

Average: **8.80/10**.

### Hotel calendar (`extra-hotel-calendar-desktop.png`, `extra-hotel-calendar-ipad.png`, `extra-hotel-calendar-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Today’s arrival/departure/debt strip and New booking anchor the screen. | — |
| Typography | 9 | 28px wide KPI values, 13px day numbers and compact event labels match the brief. | — |
| Layout & spacing | 9 | Content-grown month rows use the page scroll; bars align to actual day columns. | — |
| Consistency | 9 | View switches are subtle; primary booking action and shared search/picker styles are consistent. | — |
| Color & contrast | 9 | Stay tones are accompanied by status icons/labels; out-of-month days recede. | — |
| Efficiency | 9 | Villa filter, search, Today and direct event/day access support desk work. | — |
| Clarity | 9 | Phone list spells out Arrives/Leaves/In house, dates, villa and amount due. | — |
| States & feedback | 9 | Loading, no villas, empty period, move conflicts and retained failed move proposals have explanations. | — |
| Responsive | 9 | Phone defaults to a compact list with four KPI tiles; iPad retains the usable month grid. | — |
| Accessibility | 9 | Month bars have keyboard-operable day cells; event/date labels and coarse-pointer controls are implemented. | — |

Average: **9.00/10**.

### Staff calendar (`extra-staff-calendar-desktop.png`, `extra-staff-calendar-ipad.png`, `extra-staff-calendar-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Staff lanes, timed appointments and New appointment are clear at a glance. | — |
| Typography | 9 | Names, time labels, service subtitles and compact status chips form a readable scale. | — |
| Layout & spacing | 9 | Lane headers align to the time grid; turnaround blocks and the legend have distinct space. | — |
| Consistency | 9 | Subtle views, shared toolbar and status badges match the desk vocabulary. | — |
| Color & contrast | 9 | Bookings, turnaround and current-time line have distinguishable shapes/labels as well as color. | — |
| Efficiency | 9 | Filters and staff counts are direct; iPad Next 16:00 offers a useful offscreen-event shortcut. | — |
| Clarity | 9 | Time plus service/staff identifies the phone appointment without opening it. | — |
| States & feedback | 9 | Loading, missing staff/services, no appointments and mutation errors are implemented with relevant next steps. | — |
| Responsive | 9 | Phone list is tailored to width; iPad provides lanes and an offscreen appointment cue. | — |
| Accessibility | 9 | Named event buttons, keyboard calendar interactions and coarse-pointer header/toolbar targets are present. | — |

Average: **9.00/10**.

### Chats (`extra-chats-desktop.png`, `extra-chats-ipad.png`, `extra-chats-phone.png`, `ux-p6-phone-chat.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest and Needs you are obvious; the transcript and bottom reply field are easy to identify. | — |
| Typography | 9 | 16px guest name, 13px context and 14px messages are coherent and legible. | — |
| Layout & spacing | 8 | The phone header wraps its action cluster to a second line, then adds a third status/context line. | [AdminSessionDetail.tsx:364](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AdminSessionDetail.tsx:364): After compacting the action, use a non-wrapping phone top row for Back / guest / info / status action / menu, with one compact context/status row below it. Keep Needs you and any paused/replying chip once; do not add another status strip. |
| Consistency | 9 | One Needs you badge and only paused/replying automation chips follow the locked status decision. | — |
| Color & contrast | 9 | Incoming versus AI bubbles are readable; warning status includes a text label. | — |
| Efficiency | 9 | Queues/search and bottom composer support triage; reply drafts are kept per conversation. | — |
| Clarity | 9 | No reply needed, AI attribution and channel-specific reply placeholder state the task plainly. | — |
| States & feedback | 8 | Reply drafts/errors are guarded, but Staff follow-up closeTask clears changed task text unconditionally. | [AdminSessionActions.tsx:73](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AdminSessionActions.tsx:73): Capture the task value at openTask, derive taskDirty, and guard every dismissal with useUnsavedGuard(taskDirty). Reset the baseline on successful Save and keep the existing return-focus behavior. Reuse the shared discard confirmation copy. |
| Responsive | 8 | No reply needed stays a wide text button at 390px instead of the brief’s phone icon action. | [AdminSessionActions.tsx:135](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AdminSessionActions.tsx:135): Change the action label span to hidden sm:inline, retain aria-label="No reply needed", and give the phone button size-11 padding-0. Keep the 44px info/menu/back targets and a min-w-0 flex-1 guest block. |
| Accessibility | 9 | Composer/action labels, keyboard shortcuts, expanded targets and status/error announcements are implemented. | — |

Average: **8.70/10**.

### Missing information (`extra-missing-information-desktop.png`, `extra-missing-information-ipad.png`, `extra-missing-information-phone.png`, `ux-p6-desktop-missing.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Question leads each row; Resolve and Create fact are the obvious next steps. | — |
| Typography | 9 | 15px medium questions and 12px metadata are cleanly separated. | — |
| Layout & spacing | 9 | Compact wide rows and stacked phone question/action rows align without collisions. | — |
| Consistency | 9 | Card surface, neutral ghost Create fact and shared resolve combobox remain consistent. | — |
| Color & contrast | 9 | Question text has good contrast; topic and Asked badges remain secondary. | — |
| Efficiency | 9 | Searchable resolve works across fact pages; Create fact is one tap and resolution offers Undo. | — |
| Clarity | 9 | Questions use guest wording; source/fact labels say what is linked. | — |
| States & feedback | 9 | Loading, filtered empty, row resolve errors, partial bulk results and rerun/Undo feedback are implemented. | — |
| Responsive | 9 | Phone select and Create fact share one row; wide layout keeps actions inline. | — |
| Accessibility | 9 | Checkbox labels, question-specific combobox names, keyboard picker and 44px wrappers are present. | — |

Average: **9.00/10**.

### Settings — Business (`extra-settings-business-dirty-ipad.png`, `extra-settings-business-dirty-phone.png`, `extra-settings-business-ipad.png`, `extra-settings-business-phone.png`, `ux-p7-business-desktop.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Business profile and four clearly named sections make the form easy to orient within. | — |
| Typography | 9 | 15px section titles, 13px descriptions and muted 12px labels match the house scale. | — |
| Layout & spacing | 9 | Wide one-third headings / two-thirds fields align; phone groups have a clean vertical rhythm. | — |
| Consistency | 9 | Four Card surfaces, shared time pickers and dirty-only action bar follow the brief and locks. | — |
| Color & contrast | 9 | Field edges, labels and focused ring are clearly visible. | — |
| Efficiency | 9 | Contact pairs and structured currency/time zone controls reduce scanning and malformed entry. | — |
| Clarity | 9 | Optional markers, group descriptions and Using built-in defaults explain the form without clutter. | — |
| States & feedback | 9 | Validation focuses the first bad field; stale revisions, failed saves, dirty guards and success feedback exist. | — |
| Responsive | 9 | Phone fields stack; dirty form reserves bottom space and the bar reveals an overlapped active field. | — |
| Accessibility | 9 | Fields have labels, error descriptions and read-only handling; tab keyboard support and touch styles are present. | — |

Average: **9.00/10**.

### Settings — Booking rules (`extra-settings-bookingRules-desktop.png`, `extra-settings-bookingRules-ipad.png`, `extra-settings-bookingRules-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | One compact rules card and a secondary History disclosure keep the task apparent. | — |
| Typography | 9 | Muted labels, values and explicit unit suffixes are consistent. | — |
| Layout & spacing | 9 | Two-column wide and single-column phone fields have aligned edges and regular spacing. | — |
| Consistency | 9 | Shared settings field rendering, time picker and dirty-only save pattern are used. | — |
| Color & contrast | 9 | Inputs and labels remain readable; no unnecessary status colors compete. | — |
| Efficiency | 9 | Numeric controls and a No cutoff picker make common policy edits straightforward. | — |
| Clarity | 9 | The introduction explicitly says staff-created stays are exempt; unit labels remove ambiguity. | — |
| States & feedback | 9 | Shared validation, field errors, save retry, stale revision handling and dirty-navigation guard apply. | — |
| Responsive | 9 | Long labels wrap naturally on phone; wide form is capped with the other settings screens. | — |
| Accessibility | 9 | Each field has a label/unit description; time picker, info tips and tabs support keyboard/touch use. | — |

Average: **9.00/10**.

### Settings — AI assistant (`extra-settings-ai-ipad.png`, `extra-settings-ai-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Tone, reply length and extra instructions form a short, focused editing task. | — |
| Typography | 9 | Muted 12px labels and 14px wide-screen field text follow the scale. | — |
| Layout & spacing | 9 | Two short fields precede the full-width instruction area; phone stack is uncluttered. | — |
| Consistency | 9 | Shared settings Card, History and dirty-only save treatment match adjacent tabs. | — |
| Color & contrast | 9 | Legible text, field borders and help controls carry no extraneous color. | — |
| Efficiency | 9 | Only the three meaningful controls remain on the surface; explanations are behind tips. | — |
| Clarity | 9 | The channel description and concise field labels describe the assistant’s behavior. | — |
| States & feedback | 9 | Shared validation/save errors, stale revision feedback, success toast and draft guard apply. | — |
| Responsive | 9 | Phone instruction textarea has useful height; iPad fields use width sensibly. | — |
| Accessibility | 9 | Named fields, length validation, keyboard tabs, focus rings and touchable tips are present. | — |

Average: **9.00/10**.

### Settings — Email (`extra-settings-email-desktop.png`, `extra-settings-email-ipad.png`, `extra-settings-email-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Three email presentation/destination fields have an obvious editing order. | — |
| Typography | 9 | Label scale and readable multiline footer are coherent. | — |
| Layout & spacing | 9 | Sender and owner email pair on wide screens; footer spans the card and stacks well on phone. | — |
| Consistency | 9 | The same Card, fields, History and dirty-save treatment is used as in AI settings. | — |
| Color & contrast | 9 | Placeholder defaults and actual footer text are legible against the field surface. | — |
| Efficiency | 9 | Leaving sender/default notification fields blank is supported and explained in help. | — |
| Clarity | 9 | Sender name and Owner notification email distinguish guest-facing identity from staff destination. | — |
| States & feedback | 9 | Shared email validation, failed-save feedback, stale revision handling and dirty guard apply. | — |
| Responsive | 9 | The phone footer wraps naturally and no permanent action bar consumes clean-form space. | — |
| Accessibility | 9 | Labelled email/text fields, error descriptions and coarse-pointer target styling are present. | — |

Average: **9.00/10**.

### Settings — Channels (`extra-settings-channels-desktop.png`, `extra-settings-channels-ipad.png`, `extra-settings-channels-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | The setup warning leads, followed by channel-by-channel receiving/failure status. | — |
| Typography | 9 | 15px names and 12px metric labels with 14px values remain readable. | — |
| Layout & spacing | 9 | Four wide metrics become two columns on phone; cards and dividers maintain grouping. | — |
| Consistency | 9 | Warning/success/neutral statuses use the shared status vocabulary and surfaces. | — |
| Color & contrast | 9 | Receiving, Needs attention and numeric failures convey meaning with text plus color. | — |
| Efficiency | 9 | Retry is beside the failed setup check; technical error detail remains collapsed. | — |
| Clarity | 9 | Warning distinguishes unverified setup from recent receiving activity; old messages do not imply current health. | — |
| States & feedback | 9 | Config loading/error/retry, missing setup, never received and no recent messages are explicitly handled. | — |
| Responsive | 9 | Phone channel rows stack cleanly; the longer error message remains contained. | — |
| Accessibility | 9 | Named Retry/help controls, touch-height technical disclosure and labelled metric definitions are present. | — |

Average: **9.00/10**.

### Settings — Team (`extra-settings-team-desktop.png`, `extra-settings-team-dirty-ipad.png`, `extra-settings-team-dirty-phone.png`, `extra-settings-team-ipad-full.png`, `extra-settings-team-ipad.png`, `extra-settings-team-phone-full.png`, `extra-settings-team-phone.png`, `ux-p7-team-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | People/Invite precede the separate Rules for all cashiers section. | — |
| Typography | 9 | 15px names, 13px email and neutral role badges follow the requested scale. | — |
| Layout & spacing | 8 | The expired-invite branch adds Renew, Change and a reserved 44px slot inside the same 128px wrapping action group. | [TeamSettings.tsx:354](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/TeamSettings.tsx:354): Keep the 128px Change/menu group. Put a size-11 RotateCw ghost/outline icon button with aria-label="Renew invitation for Lek" in the reserved menu slot when allExpired; remove the additional text Renew sibling. Keep Change available and the reserved column on every row. |
| Consistency | 9 | The max-w-4xl cap, reserved menu column, subtle permissions and amber invitation state follow the locks. | — |
| Color & contrast | 9 | Pending and expired invites use distinct warning/destructive tones; roles stay neutral. | — |
| Efficiency | 9 | Role changes apply directly; one dirty-only Save handles the cashier policy draft. | — |
| Clarity | 9 | Roles, invitation expiry and Manager only permissions are stated plainly. | — |
| States & feedback | 9 | Loading, inline role errors, renewal/copy feedback, invalid rules, stale revisions and invitation/rules draft guards exist. | — |
| Responsive | 9 | Normal phone rows put role and actions on one line; the panel cap is correctly left aligned at wide sizes. | — |
| Accessibility | 9 | Person-specific Change/menu labels, email label, permission group names and shared focus/target styles are present. | — |

Average: **8.90/10**.

### Marketing dashboard (`extra-marketing-dashboard-ipad.png`, `extra-marketing-dashboard-phone.png`, `ux-p8-dashboard-desktop.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Net collected is the large hero, with quieter supporting KPIs and source chart. | — |
| Typography | 9 | 40px hero, 28px supporting values and sans tabular money provide a coherent numerical hierarchy. | — |
| Layout & spacing | 9 | The hero spans two columns; five support tiles make a balanced three-column group on iPad/desktop. | — |
| Consistency | 9 | Cards, Stat tiles, subtle controls and the distinct staff-entered chart hue are correctly executed. | — |
| Color & contrast | 9 | Categories have labelled legend keys and contrasting text; there is no unnecessary success coloring of KPIs. | — |
| Efficiency | 9 | Dates/property/basis are direct; chart/table switching and export are accessible from the toolbar. | — |
| Clarity | 9 | Date range, attribution caption and info tips explain what counts; Finance chart correctly says Collected. | — |
| States & feedback | 8 | Loading/stale refresh/error/empty are covered, but the tracking mix drops negative net parts in refund-heavy Finance periods. | [DashboardTiles.tsx:98](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/marketing/dashboard/DashboardTiles.tsx:98): When any part.money.net < 0, replace the positive-only strip with a labelled signed breakdown (or a diverging zero-baseline bar); keep every signed amount visible. For a compact fallback use “Net refunds included — see breakdown”. Keep the normal positive-period colors and the locked staff-entered hue. |
| Responsive | 9 | Phone preserves the hero, folds tracking detail and puts support metrics into two columns. | — |
| Accessibility | 9 | Stat help, named filters, chart description, keyboard series controls and equivalent data table are present. | — |

Average: **8.90/10**.

### New coupon (`extra-new-coupon-desktop.png`, `extra-new-coupon-filled-desktop.png`, `extra-new-coupon-filled-ipad.png`, `extra-new-coupon-filled-phone.png`, `extra-new-coupon-ipad.png`, `extra-new-coupon-phone.png`, `ux-p8-new-coupon-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Code and Discount lead to one Save & publish primary; summary leads with the benefit after valid input. | — |
| Typography | 9 | Serif New coupon, mono code and 28px summary benefit follow the brief. | — |
| Layout & spacing | 9 | The locked single max-w-3xl column keeps the summary below the form without an empty side column. | — |
| Consistency | 9 | All scope/unit/villa tracks are subtle; Card surfaces and shared controls are coherent. | — |
| Color & contrast | 9 | Focus and input boundaries are clear; secondary Save as draft remains outline. | — |
| Efficiency | 9 | Common fields are visible; campaign/dates/limits/terms fold under More with validation opening it as needed. | — |
| Clarity | 9 | 20% off, Stays/all villas and ongoing dates make the consequence inspectable before publish. | — |
| States & feedback | 9 | Validation focuses fields, missing/loading/archived states have explanations, failed save preserves the form and dirty links/unload are guarded. | — |
| Responsive | 9 | Phone fixed save bar has matching bottom padding; full-page capture occlusion is scrollable rather than proof of an unreachable field. | — |
| Accessibility | 9 | Labels/error associations, named units, keyboard choices and coarse-pointer target minimums are implemented. | — |

Average: **9.00/10**.

## Below 9

Sorted by impact. Each row is a separate screen/category score; shared fixes are deliberately repeated where they affect two screens.

| Priority | Screen | Category | Score | Evidence and concrete buildable fix |
|---:|---|---|---:|---|
| 1 | Marketing dashboard | States & feedback | 8 | Refund-heavy Finance periods can have negative tracking-group net values; the mix strip filters them out and can imply a wholly positive distribution. **Fix:** [DashboardTiles.tsx:98](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/marketing/dashboard/DashboardTiles.tsx:98) — When any part.money.net < 0, replace the positive-only strip with a labelled signed breakdown (or a diverging zero-baseline bar); keep every signed amount visible. For a compact fallback use “Net refunds included — see breakdown”. Keep the normal positive-period colors and the locked staff-entered hue. |
| 2 | Receipt | States & feedback | 8 | Correct payment and Void have editable method/date/amount/reason state, but ReceiptView.closeTask clears the task directly; only refundDirty feeds its guard. **Fix:** [ReceiptView.tsx:229](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/ReceiptView.tsx:229) — Report task dirty state from CorrectPayment/VoidPanel in PaymentRecord.tsx. Gate toolbar Close, Escape, New sale and in-app navigation through useUnsavedGuard(refundDirty \|\| taskDirty); bypass the guard after successful onDone. Reuse “Discard unsaved changes?” / “Keep editing” / “Discard”. Preserve attempt keys, frozen retries and revision checks. |
| 3 | Stay sheet | States & feedback | 8 | External-payment and refund/correction form drafts are not part of the notes/edit dirty guard. ChangeConfirmDialog routes Escape/outside/close straight to onClose. **Fix:** [BookingFinancials.tsx:375](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/BookingFinancials.tsx:375) — Track edited method, when.edited, note/reason/amount and notify choice in the money dialogs. Pass a guarded cancel callback to ChangeConfirmDialog, with a separate successful-close callback so successful recording does not prompt. Use the existing discard copy and preserve all financial safeguards. |
| 4 | Appointment sheet | States & feedback | 8 | AppointmentMoneyDialog has method/time/reason/amount state but passes onClose directly to ChangeConfirmDialog; an accidental dismissal loses it. **Fix:** [AppointmentFinancials.tsx:95](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AppointmentFinancials.tsx:95) — Use useUnsavedGuard for differences from the captured money-dialog defaults. Route X/Escape/outside cancellation through confirmDiscard and bypass it on successful recording. Keep the submitted-attempt lock, revision and idempotency handling. |
| 5 | Order line editor | Layout & spacing | 8 | More item options is an absolute 48px gradient over live rows. The iPad schedule inputs and several desktop/phone row labels are visibly washed out. **Fix:** [OrderPanel.tsx:293](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/OrderPanel.tsx:293) — Render the continuation cue as a separate shrink-0 min-h-6 row below the item scroller, rather than absolute inset-x-0 bottom-0 h-12 over its content. Keep it conditional on moreBelow; retain scrolling, the total and payment safeguards. |
| 6 | Order line editor | Responsive | 8 | At 390px the title/icon and Coupon/menu/close wrap into a tall two-row header, reducing room for the expanded schedule/discount editor. **Fix:** [OrderPanel.tsx:192](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/OrderPanel.tsx:192) — At max-sm hide the decorative receipt glyph, make the Coupon action a size-11 icon with its text sr-only, retain aria-label="Add coupon", and keep title/menu/close in one header row. Preserve the wide header and accessible control names. |
| 7 | Chats | States & feedback | 8 | Editing Staff follow-up and pressing X/Escape/outside calls closeTask, which clears task without comparing it with session.staffTask. **Fix:** [AdminSessionActions.tsx:73](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AdminSessionActions.tsx:73) — Capture the task value at openTask, derive taskDirty, and guard every dismissal with useUnsavedGuard(taskDirty). Reset the baseline on successful Save and keep the existing return-focus behavior. Reuse the shared discard confirmation copy. |
| 8 | Chats | Responsive | 8 | No reply needed retains its text at 390px, forcing the action cluster below the guest name; the header becomes three lines. **Fix:** [AdminSessionActions.tsx:135](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AdminSessionActions.tsx:135) — Change the action label span to hidden sm:inline, retain aria-label="No reply needed", and give the phone button size-11 padding-0. Keep the 44px info/menu/back targets and a min-w-0 flex-1 guest block. |
| 9 | Chats | Layout & spacing | 8 | The wrapped action cluster creates a separate right-aligned control row between name and context, consuming about one message of vertical space. **Fix:** [AdminSessionDetail.tsx:364](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/AdminSessionDetail.tsx:364) — After compacting the action, use a non-wrapping phone top row for Back / guest / info / status action / menu, with one compact context/status row below it. Keep Needs you and any paused/replying chip once; do not add another status strip. |
| 10 | Stay sheet | Consistency | 8 | The external-payment method control uses strong dark selection even though only checkout tender/mode may be strong. **Fix:** [BookingMoneyFields.tsx:123](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/BookingMoneyFields.tsx:123) — In MethodPicker use ToggleGroup variant="segmented" tone="subtle"; remove ToggleGroupItem data-[state=on]:bg-foreground and data-[state=on]:text-background overrides. Keep all method options and touch target sizes. |
| 11 | Appointment sheet | Consistency | 8 | The shared money-dialog MethodPicker repeats strong selected method chips outside the checkout tender/mode track. **Fix:** [BookingMoneyFields.tsx:123](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/BookingMoneyFields.tsx:123) — Apply the same shared MethodPicker change: variant="segmented" tone="subtle" and remove the two explicit strong selected-state classes; retain all method options and 44px targets. |
| 12 | Settings — Team | Layout & spacing | 8 | For allExpired, Renew + Change + the reserved 44px menu placeholder cannot fit in w-32, so the action group wraps and breaks the locked column alignment. **Fix:** [TeamSettings.tsx:354](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/admin/TeamSettings.tsx:354) — Keep the 128px Change/menu group. Put a size-11 RotateCw ghost/outline icon button with aria-label="Renew invitation for Lek" in the reserved menu slot when allExpired; remove the additional text Renew sibling. Keep Change available and the reserved column on every row. |
| 13 | Receipt | Clarity | 8 | Refund/activity history presents raw stay, appointment and customer database IDs in ordinary ledger text, making staff decode implementation identifiers. **Fix:** [FinancialHistory.tsx:157](/Users/macbook/.t3/worktrees/360-tour/t3-fbded6cf-d3c9eaad0b844233/src/components/checkout/FinancialHistory.tsx:157) — In Refund/Audit use the available guest/service/date or booking/order reference from view.lines/view.links/view.sources for the primary label; otherwise use “Linked stay”, “Linked appointment” or “Customer reference”. Put raw IDs behind a closed “Technical details” disclosure, preserving the audit data. |

## Visual bugs

Only defects visible in the supplied PNGs are called screenshot-visible bugs here. Draft loss, expired-invite wrapping, off-surface strong selections and negative net distribution are code findings above; the captures do not demonstrate those states.

1. **Order editor continuation cue paints over row content.** `extra-therapist-chips-ipad.png`: date/time controls are largely whitened out; `extra-therapist-chips-desktop.png`: Remove item is washed out; `extra-therapist-chips-phone.png`: Price is almost invisible beneath the cue. `extra-discount-reason-ipad.png`: Schedule is faded; `extra-discount-reason-desktop.png` and `extra-discount-reason-phone.png`: lower item options are obscured. Cause/fix: `OrderPanel.tsx:293`, reserve a separate cue row instead of overlaying controls. The controls can be reached by scrolling; the bug is the overlay’s visual obstruction, not permanent inaccessibility.

2. **Phone chat header wraps into three rows.** `extra-chats-phone.png` and `ux-p6-phone-chat.png`: Back/name occupy the first row, info/No reply needed/menu the second, and Needs you/channel/property the third. Cause/fix: `AdminSessionActions.tsx:135` and `AdminSessionDetail.tsx:364`, hide the phone action text while keeping its accessible name and 44px target, then prevent the top-row wrap.

3. **Phone order-editor header consumes an avoidable extra action row.** `extra-line-open-phone.png`, `ux-p2-phone-line-open.png`, `extra-discount-reason-phone.png`, `extra-therapist-chips-phone.png`: title/icon occupy one row and Coupon/menu/close another. This materially reduces the editable window in expanded states. Fix: `OrderPanel.tsx:192`, phone icon-only Coupon plus hidden decorative receipt glyph as specified above.

Not treated as visual bugs: content-grown hotel month rows; neutral ghost Refund; the five-option phone refund track; lower Summary card; Team width cap/reserved menu space; dirty-only business Save; scrollable New booking fields below the visible crop; and the phone coupon fixed bar appearing midway through a full-page capture. Those either execute locked choices or have source-backed scroll/padding access.

## Averages

| Screen | Average / 10 | Every category 9+ |
|---|---:|:---:|
| Checkout catalog / till | 9.00 | Yes |
| Order line editor | 8.80 | No |
| Cash payment | 9.00 | Yes |
| Split payment | 9.00 | Yes |
| Orders | 9.00 | Yes |
| Receipt | 8.80 | No |
| Receipt line refund | 9.00 | Yes |
| Approvals | 9.00 | Yes |
| New booking | 9.00 | Yes |
| Stay sheet | 8.80 | No |
| Appointment sheet | 8.80 | No |
| Hotel calendar | 9.00 | Yes |
| Staff calendar | 9.00 | Yes |
| Chats | 8.70 | No |
| Missing information | 9.00 | Yes |
| Settings — Business | 9.00 | Yes |
| Settings — Booking rules | 9.00 | Yes |
| Settings — AI assistant | 9.00 | Yes |
| Settings — Email | 9.00 | Yes |
| Settings — Channels | 9.00 | Yes |
| Settings — Team | 8.90 | No |
| Marketing dashboard | 8.90 | No |
| New coupon | 9.00 | Yes |

Overall: **8.94/10** (2057 points / 230 category scores). **16/23** screens meet 9+ in every category. No score was rounded before averaging.

## Image inspection inventory

All **94** files were opened individually. The per-screen filenames above are the complete inventory; 94 assignments, no duplicate screen assignments.
