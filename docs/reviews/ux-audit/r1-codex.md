# Independent UX/UI scorecard — round 1

Reviewed detached `ux/integration` at `e7a808a` (Round-1 captures from the merged branch). Read only the rubric and visual brief in `docs/reviews/ux-audit/`; no other audit-review files were read. Opened and personally inspected every one of the 50 PNGs in `docs/screenshots/audit-r1/`, including duplicate scene captures. Used `tests/browser/now-screenshots.spec.ts` to identify scenes. Grouped viewport/state variants into 19 screens; duplicate captures do not receive extra weight.

Scoring: ten equal-weight categories per screen, integer 1–10; 9 means shippable with at most a nit. Overall is the mean of all 190 category scores. No 10 is awarded. A screen meets the target only if every category is at least 9, not merely if its average rounds to 9.

Evidence scope: rendered findings come from the supplied images. Loading, empty, error, disabled, focus, aria labels, touch sizing and unsaved-draft findings are static component-code checks, not newly executed browser tests. Uncaptured viewports are explicitly described as code-reviewed where relevant. No product code, Convex code/deployment, commit, push or PR was changed; the requested detached checkout and this scratchpad report are the only task changes.

Paths in fixes are repository-relative. No fix removes an approval, attempt key, revision check or permission gate.

### Checkout catalog / cashier till (extra-checkout-start-phone.png, extra-checkout-start-ipad.png, ux-p1-phone-cashier-till.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Catalog leads; populated phone strip exposes the next action and ฿1,200 due. | — |
| Typography | 9 | 15px item names, quieter durations and sans amounts are easy to scan. | — |
| Layout & spacing | 9 | Two catalog columns on iPad; one on phone. Bottom strip has matching catalog pb-28/scroll-pb-28. | — |
| Consistency | 9 | Tiles use a coherent image/icon, name, duration and price pattern. | — |
| Color & contrast | 9 | Dark checkout action and legible gold outline affordances have distinct roles. | — |
| Efficiency | 9 | Tapping the entire item adds it; search spans every tab; phone cash shortcut avoids reopening the order first. | — |
| Clarity | 9 | “Search all items”, “View order” and item quantities describe their jobs. | — |
| States & feedback | 9 | CatalogPane has loading placeholders, empty/search-empty copy and a custom-item recovery; CheckoutView reports writes. | — |
| Responsive | 9 | Phone strip and iPad complementary order pane are purpose-built layouts. | — |
| Accessibility | 9 | Tile is one large button, not a 32px plus target. Checkout TOUCH_TARGETS, input labels and focus rings are implemented. | — |

Average: **9.00/10**.

### Order line editor (extra-line-open-phone.png, extra-line-open-ipad.png, ux-p2-phone-line-open.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Discount, schedule and price form one inset editing group; due remains prominent. | — |
| Typography | 8 | iPad metadata leaves “scheduled” alone on a second line; phone has a cleaner single-line summary. | src/components/checkout/OrderPanel.tsx: in the line header, put therapist and scheduling status on separate intentional text-xs lines (or use a short “Unscheduled” status); remove the accidental one-word wrap beside the amount. |
| Layout & spacing | 9 | Inset rows and dividers align; removal has a separate destructive row. | — |
| Consistency | 8 | Order tender choices are four separated outline buttons, while the immediately following PayPanel uses a shared pill track. | src/components/checkout/OrderPanel.tsx: replace the four independent tender buttons in the due footer with the same rounded-full bg-muted p-1 track and h-11 selected bg-foreground text-background treatment used by PayPanel.TenderRow; keep Split ghost. |
| Color & contrast | 9 | Remove is red; ordinary row actions remain neutral; due is high contrast. | — |
| Efficiency | 9 | Discount edits and row actions are adjacent to the selected item. | — |
| Clarity | 9 | Approval limit is stated under Discount, and scheduling says “Not scheduled”. | — |
| States & feedback | 9 | DiscountField parses invalid input, exposes feedback, and routes restricted changes to approval; write errors are surfaced. | — |
| Responsive | 9 | Phone sheet retains all controls; iPad pane remains independently scrollable. | — |
| Accessibility | 9 | 44px checkout overrides cover raw buttons; amount labels, expanded states and focus treatment exist. | — |

Average: **8.80/10**.

### Cash payment (extra-cash-panel-phone.png, extra-cash-panel-ipad.png, ux-p3-phone-cash-1500.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Balance due is unmistakable; Confirm cash is the only filled action. | — |
| Typography | 9 | 40px due, 24px received and 32px change use sans numerals. | — |
| Layout & spacing | 9 | Input, equal quick chips and conditional change block form a compact stack. | — |
| Consistency | 9 | Tender track and note chips have clear selected states. | — |
| Color & contrast | 9 | Change is emerald and shortfall amber, each accompanied by text and an amount. | — |
| Efficiency | 9 | Exact cash opens prefilled; ฿1,500 and ฿2,000 chips make change calculation one tap. | — |
| Clarity | 9 | “Cash received”, “Change” and “Received now · Edit time” are plain and specific. | — |
| States & feedback | 9 | PayPanel handles shortfall, busy lock, coupon refusal, changed revision and same-attempt retry with inline messages. | — |
| Responsive | 9 | Phone sheet keeps confirm near the thumb; input listens for keyboard viewport resizing; iPad is compact without dead space. | — |
| Accessibility | 9 | Labelled input, tender aria-pressed, live change/shortfall and focus restoration are implemented. | — |

Average: **9.00/10**.

### Split payment (extra-split-phone.png, extra-split-ipad.png, ux-p3-ipad-split.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Due and the final combined confirmation dominate; allocation status is visible. | — |
| Typography | 8 | iPad row methods shrink to 12px with almost no space between PromptPay, Card and Transfer. | src/components/checkout/PayPanel.tsx SplitForm: change method button text-xs to text-sm and replace sm:w-24 with a deliberate amount column (for example w-28); switch the row to a stacked layout at the order pane’s container width when four legible labels cannot fit. |
| Layout & spacing | 9 | Phone stacks each method and amount; iPad keeps the pair together and separates payments with dividers. | — |
| Consistency | 9 | Each payment uses the same selected pill treatment as the parent tender row. | — |
| Color & contrast | 9 | Fully allocated has a check and ฿0; invalid allocation has explicit text rather than color alone. | — |
| Efficiency | 9 | Final payment automatically absorbs the remainder; additional payments can be added or removed. | — |
| Clarity | 9 | “Auto balance” and confirmation naming both amounts explain the split outcome. | — |
| States & feedback | 9 | Missing amount and over-allocation have a live validation line; confirm disables until every tender is positive; retry preserves the attempt. | — |
| Responsive | 9 | Both captured two-payment states fit without clipping. Additional rows scroll in the containing panel. | — |
| Accessibility | 9 | Each amount and method group is labelled; checkout overrides keep removal and method controls touch-sized. | — |

Average: **8.90/10**.

### Receipt (extra-receipt-phone.png, extra-receipt-ipad.png, ux-p4-phone-manager-receipt.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | New sale is primary; print and line-level follow-up actions are secondary. | — |
| Typography | 9 | Receipt mono body resembles paper; every displayed amount is explicitly sans/tabular. | — |
| Layout & spacing | 9 | iPad separates paper from Items/History; phone stacks the same order with clean card edges. | — |
| Consistency | 9 | Items and history share rounded surfaces and standard action variants. | — |
| Color & contrast | 9 | Amber “Not scheduled” chips are readable, paired with text, and separate from neutral actions. | — |
| Efficiency | 9 | Link appointment and Refund live next to the correct paid line. | — |
| Clarity | 9 | Receipt number, order number, total and tender are all explicit. | — |
| States & feedback | 9 | ReceiptView has loading/missing order states; successful line actions get inline status and restored focus; history loads lazily with ledger error boundaries. | — |
| Responsive | 9 | Both phone and iPad keep receipt and operational controls in a sensible reading order. | — |
| Accessibility | 9 | Print has an accessible label, refunds are named by item, checkout touch overrides and keyboard-accessible disclosure tabs are implemented. | — |

Average: **9.00/10**.

### Inline refund (extra-refund-phone.png, extra-refund-ipad.png, ux-p4-ipad-manager-refund.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Form stays under Foot spa 45; destructive recording action is clearly separate from linking. | — |
| Typography | 9 | Amount and tender labels remain readable; amount uses sans numerals. | — |
| Layout & spacing | 8 | On phone, All and Half occupy one row while the amount field drops alone below; this needlessly lengthens the form. | src/components/checkout/RefundForm.tsx: make Refund amount a three-column grid such as grid-cols-[1fr_1fr_6rem] gap-2, reduce chip horizontal padding to px-2, and make the amount input w-full so All/Half/amount stay together at 390px. |
| Consistency | 9 | Refund method uses the same pill selection language; form stays within Items. | — |
| Color & contrast | 9 | Reason requirement explains the neutral disabled submit; enabled submit uses destructive outline. | — |
| Efficiency | 9 | All/Half shortcuts and reason chips avoid repetitive typing. | — |
| Clarity | 9 | “Records money already returned to the guest” correctly explains the operation. | — |
| States & feedback | 8 | Retry/remaining-cap handling is strong, but ReceiptView’s New sale and navigation can abandon a changed refund draft without a dirty guard. | src/components/checkout/RefundForm.tsx and ReceiptView.tsx: report dirty state after amount/method/reason changes and use useUnsavedGuard before New sale or route departure; keep the existing attempt key, remaining cap and retry behavior. |
| Responsive | 8 | Phone’s three full-width reason-chip rows plus wrapped amount controls make this small form consume most of the viewport. | src/components/checkout/RefundForm.tsx: use shorter quick-reason copy (“Short treatment”, “Guest complaint”, “Wrong charge”) in a two-column phone grid with whitespace-normal and min-h-11; retain the editable reason input and full reason stored in the audit record. |
| Accessibility | 9 | Form title is focused on opening; amount/reason errors are associated; checkout target sizing covers chips. | — |

Average: **8.70/10**.

### Orders picker (ux-p2b-phone-orders.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Open orders lead; order-number lookup is a clearly separate secondary task. | — |
| Typography | 9 | Order names, secondary customer/item count and 15px sans money are well differentiated. | — |
| Layout & spacing | 9 | Short bottom sheet uses compact full-width rows and a labelled lookup footer. | — |
| Consistency | 9 | Rows, input and buttons match checkout layers. | — |
| Color & contrast | 9 | Due values are dark and readable; disabled Go is visibly inactive. | — |
| Efficiency | 9 | Open order is one tap; number lookup preserves the cashier’s permitted access scope. | — |
| Clarity | 9 | Copy explicitly says newest first and explains how to find today’s receipts. | — |
| States & feedback | 8 | List loading/empty/errors have local recovery. OrderNumberLookup calls useFindOrder outside that boundary, so a query failure has no lookup-local retry. | src/components/checkout/OrderStrip.tsx: keep lookup text in OrderNumberLookup and move useFindOrder into a small result child inside InlineErrorBoundary resetKey={number}; show “Couldn’t find this order. Try again” beside the field, preserving the entered number and cashier access limits. |
| Responsive | 9 | Captured phone sheet fits; wider behavior is code-reviewed through CheckoutDialogContent, not visually verified by a paired capture. | — |
| Accessibility | 9 | Rows are min-h-14 and labelled; current order has aria-current; number lookup has error association and keyboard submission. | — |

Average: **8.90/10**.

### Manager approvals (ux-p1-ipad-manager-approvals.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | One request, its reason, before/after total and Approve/Decline are easy to find. | — |
| Typography | 8 | Whole request is bold; “Thai massage 60” wraps with “60” orphaned onto a second line. | src/components/checkout/ApprovalsPanel.tsx ApprovalItem: split the long bold sentence into a 15px medium service title and a 14px normal request line (“Mint · 15% discount · ฿180”); keep “Thai massage 60” together and leave the reason below. |
| Layout & spacing | 9 | Reason, amount comparison, expiry and actions have sufficient separation. | — |
| Consistency | 9 | Request uses Card, secondary decline and primary approve. | — |
| Color & contrast | 9 | Gold is reserved for approval context; before/after amounts remain dark. | — |
| Efficiency | 9 | Manager can decide directly while keeping the underlying task mounted. | — |
| Clarity | 9 | Actor, requested discount, reason and monetary consequence are explicit. | — |
| States & feedback | 9 | Queue has loading/empty states; useApprovalDecision reports busy/error; final decision closes the panel and announces the result. | — |
| Responsive | 9 | iPad panel is restrained. Phone layout is code-reviewed via responsive CheckoutSheetContent only; no phone approval capture was supplied. | — |
| Accessibility | 9 | Close/actions have touch overrides; title is focused on open; expiry information is accessible via InfoTip. | — |

Average: **8.90/10**.

### New booking (extra-new-booking-phone.png, extra-new-booking-ipad.png, ux-p5-new-booking-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Stay, Guest and Price have obvious headings; total and the single primary action anchor the footer. | — |
| Typography | 9 | Serif title, muted field labels and sans total follow the house scale. | — |
| Layout & spacing | 7 | iPad shows a partly cut/faded Custom price control immediately above the footer; phone cuts the Price card at the same boundary. | src/components/admin/NewBookingDialog.tsx: remove the mask-image from the scrolling fields and use an inset separator/shadow only at the scroller edge; add a visible “More booking options below” scroll cue so an enabled control is never half faded at the footer. |
| Consistency | 9 | Inputs, date fields, group headings and footer variants are coherent. | — |
| Color & contrast | 8 | The scroll mask washes an enabled Price control toward white, making it look disabled. | src/components/admin/NewBookingDialog.tsx: remove [mask-image:linear-gradient(...)] from interactive content; retain full text/control opacity and use border-t border-border on the separate footer as the boundary. |
| Efficiency | 8 | Villa/dates and guest are simple, but the narrow/tall iPad layout forces scrolling before coupon and booking status can be reviewed. | src/components/admin/NewBookingDialog.tsx: at sm+ put Phone and Email in a two-column contact grid, with suggestions/notification spanning both columns; this saves a field row and brings Price/coupon closer without removing either safeguard. |
| Clarity | 9 | Disabled Create booking has a specific explanation: enter guest name and phone. | — |
| States & feedback | 7 | Availability/coupon and write errors are handled, but NewBookingDialog closes directly without a dirty check; guest and date controls also remain editable during creation. | src/components/admin/NewBookingDialog.tsx: derive dirty state from the opening villa/date/guest/price snapshot, call useUnsavedGuard for Close/Escape/outside/Block instead, and disable the scrolling fieldset while saving. Preserve the creation key and availability/coupon checks. |
| Responsive | 8 | Phone dates fit side by side; iPad uses essentially the same tall 512px form and clips Price despite substantial width outside the dialog. | src/components/admin/NewBookingDialog.tsx: use sm:max-w-2xl and a sm:grid-cols-2 contact row, while keeping the existing single-column phone form and side-by-side dates; ensure a complete Price row, rather than half a control, is visible above the footer at 1180×820. |
| Accessibility | 9 | Inputs have labels; phone errors associate to the phone control; dates and footer actions use touch-sized primitives. | — |

Average: **8.30/10**.

### Stay details (extra-stay-sheet-phone.png, extra-stay-sheet-ipad.png, ux-p5-stay-sheet-ipad.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Guest, status, balance and payment action lead the sheet. | — |
| Typography | 9 | ฿27,500 is sans/tabular; 13px labels and 14px values align consistently. | — |
| Layout & spacing | 9 | Fixed 96px label column and grouped cards make the long record easy to scan. | — |
| Consistency | 9 | Header Edit/More/Close and key-value pattern match appointment details. | — |
| Color & contrast | 9 | Balance and neutral fields are legible; status has a written label. | — |
| Efficiency | 9 | Contact links and payment entry are directly available; secondary operations are in the menu. | — |
| Clarity | 8 | Take payment and Record payment… sit beside each other without explaining checkout versus money already received. | src/components/admin/BookingFinancials.tsx: rename “Record payment…” to “Record received payment…” and add an InfoTip stating “Use for money already received; Take payment opens checkout.” Keep both flows and their revision/permission gates. |
| States & feedback | 8 | Notes have a dirty guard and revision check, but nested EditBookingDialog closes directly and can lose edited dates/guest/price. | src/components/admin/BookingSheet.tsx EditBookingDialog: compare the full edit draft to its initial snapshot, apply useUnsavedGuard to onOpenChange and Cancel, and retain the outer notes guard; keep expected revision and reviewed-price validation. |
| Responsive | 9 | Phone stays full width; iPad keeps the calendar visible beside a readable 480px sheet. | — |
| Accessibility | 9 | Header icon buttons are labelled; contact links are at least 44px high; loading/deleted record copy is implemented. | — |

Average: **8.80/10**.

### Appointment details (extra-appointment-sheet-phone.png, extra-appointment-sheet-ipad.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Guest/status precede the balance; Take payment remains the primary action. | — |
| Typography | 9 | Sans/tabular due and clear service/staff/time rows follow the scale. | — |
| Layout & spacing | 9 | Header controls and 96px label column align; long villa link wraps without clipping. | — |
| Consistency | 9 | Cards and header actions match Stay details. | — |
| Color & contrast | 9 | Status includes text; balance and contact information are clearly readable. | — |
| Efficiency | 9 | Mark arrived, payment and linked stay are directly accessible. | — |
| Clarity | 8 | Take payment versus Record payment… is unexplained at the point of choice. | src/components/admin/AppointmentFinancials.tsx AppointmentMoneyBlock: use “Record received payment…” and the same explanatory InfoTip as BookingFinancials (“Money already received; Take payment opens checkout”). |
| States & feedback | 9 | AppointmentEditForm reports dirty/busy state; close and Cancel use confirmDiscard; mutations expose alerts and revision checks. | — |
| Responsive | 9 | Phone and iPad retain the same priorities while the wider sheet preserves calendar context. | — |
| Accessibility | 9 | Labelled header buttons, 44px contact links, focus treatment and associated edit labels exist. | — |

Average: **8.90/10**.

### Hotel calendar (extra-hotel-calendar-phone.png, extra-hotel-calendar-ipad.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Today strip and New booking are prominent; navigation sits directly above the calendar. | — |
| Typography | 8 | iPad event for Lena Fischer truncates the villa to “Tidegla…” while the phone list can show the full villa. | src/components/admin/AdminBookingsView.tsx renderEvent: show the guest first and a short villa label on a second intentional line instead of truncate text-xs; pair this with 44px touch lanes so “Lena Fischer” and a usable villa label remain visible. |
| Layout & spacing | 9 | Day numbers are aligned top-left; overflow pills stay in their day; phone list avoids squeezed seven-column cells. | — |
| Consistency | 9 | Toolbar, KPI cards and list rows use the same rounding/control language. | — |
| Color & contrast | 8 | Confirmed and Paid in the month grid rely on blue/green fill; pending gets dashes and cancelled gets a strike, but the other statuses have no non-color cue. | src/components/admin/AdminBookingsView.tsx renderEvent: add distinct status icons or short visible status labels for Confirmed/Paid/Host block/OTA block, retaining color and the existing pending/cancelled styling; reuse hotelStatus(statusKey(...)) for booking status. |
| Efficiency | 9 | Month/villa/list views, guest search and per-day overflow support quick work without removing booking checks. | — |
| Clarity | 8 | Phone row amounts (฿26,000, ฿0, ฿8,500) have no visible “Due” label; a user could read them as stay prices. | src/components/admin/AdminBookingsView.tsx renderAgendaEvent: add a text-xs “Due” label above/beside the right-hand money amount, and give the zero state the copy “Paid · ฿0 due”. |
| States & feedback | 9 | Calendar receives loading state; empty agenda and overflow panels are implemented; mutations provide notices and confirmation flows. | — |
| Responsive | 9 | Four compact phone KPIs and a list are appropriate; iPad has a genuine month calendar. | — |
| Accessibility | 7 | Month event bars are about 26px high (1.75rem minus 2px), with no enlarged hit region; unlike +more, they do not meet 44px. Event aria labels also omit booking/payment status. | src/components/reui/event-calendar/event-calendar-month-view.tsx and AdminBookingsView.tsx: set touch month lanes to at least 46px and event buttons to min-height:44px, recalculating row/overflow capacity rather than overlapping hit areas; include hotelStatus(statusKey(...)).label in the event’s accessible name. |

Average: **8.50/10**.

### Staff calendar (extra-staff-calendar-phone.png, extra-staff-calendar-ipad.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Date and New appointment lead; staff/filters remain secondary. | — |
| Typography | 9 | Guest name is a readable row title; time/service/staff are secondary; status remains legible. | — |
| Layout & spacing | 9 | iPad uses staff resource columns; phone agenda has clear rows and a separate legend. | — |
| Consistency | 9 | Same toolbar, selected view track and status language as the desk. | — |
| Color & contrast | 9 | Appointment chips have written statuses; turnaround/non-working time also have distinct pattern/icon cues. | — |
| Efficiency | 9 | Phone agenda avoids lateral hunting; staff filter and date navigation are immediately accessible. | — |
| Clarity | 9 | Appointment row says who, when, which service and which therapist. | — |
| States & feedback | 9 | AdminStaffBookingsView passes calendar loading and provides action errors/proposals; agenda has an empty state and changes require review. | — |
| Responsive | 9 | Phone is an agenda; iPad is an independently scrollable resource timeline. Later appointments below 14:00 are normal scroll content, not clipping bugs. | — |
| Accessibility | 9 | Captured appointment/agenda rows are large targets; toolbar uses pointer-coarse sizes and labelled controls; calendar events have keyboard focus and names. | — |

Average: **9.00/10**.

### Chats (extra-chats-phone.png, extra-chats-ipad.png, ux-p6-phone-chat.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Conversation name and composer are easy to locate; list is separate on iPad. | — |
| Typography | 9 | Message body, timestamps and name have a clear scale. | — |
| Layout & spacing | 9 | Composer has its own row and does not cover transcript content; compact phone actions fit. | — |
| Consistency | 9 | List selection, chat bubbles and header actions are coherent across sizes. | — |
| Color & contrast | 9 | Needs you uses amber text as well as a dot; messages remain readable. | — |
| Efficiency | 9 | No reply needed is directly available; switching chats retains drafts within the mounted page. | — |
| Clarity | 8 | “Needs you” beside “AI replying” is ambiguous, and phone hides the channel name from the header. | src/components/admin/AdminSessionDetail.tsx: render the channel text on phone instead of sr-only sm:not-sr-only, and rename the default automation chip to “AI on”; use “AI replying” only for a real in-flight reply. Keep Needs you as the triage state. |
| States & feedback | 7 | Per-session pending/error/status and late-message checks are implemented, but drafts exist only in useAdminReplyComposer memory, without route/unload protection. | src/components/admin/useAdminReplyComposer.ts and ChatsView.tsx: expose whether any session has an unsent draft, guard route/unload navigation with useUnsavedGuard, or persist drafts by session locally; preserve existing within-inbox draft retention and new-message checks. |
| Responsive | 9 | Phone uses a full conversation sheet; iPad uses two panes without squeezing the transcript. | — |
| Accessibility | 9 | Back/details/no-reply actions are named; composer is labelled and disabled send is visible; reply errors/status use live semantics. | — |

Average: **8.70/10**.

### Missing information (extra-missing-information-phone.png, extra-missing-information-ipad.png, ux-p6-desktop-missing.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Question is visually primary; resolution controls sit alongside it on larger screens. | — |
| Typography | 9 | 15px questions and 12px metadata work; full question text remains readable. | — |
| Layout & spacing | 8 | Desktop/iPad rows are roughly 94px rather than the brief’s ~64px; an inline min-h-11 Open chat expands metadata. Phone’s second row becomes about 200px. | src/components/admin/MissingInformationPanel.tsx: take Open chat out of the metadata flex line and put it with row actions; keep metadata leading-4 and use py-3 so large-screen rows can approach 64px instead of inheriting a 44px metadata line. |
| Consistency | 9 | One surface and standard select/create/menu controls are consistent. | — |
| Color & contrast | 9 | Question and metadata have sufficient visual distinction; no faint disabled-looking main action. | — |
| Efficiency | 7 | Approved facts are fetched in an initial page of 100; resolveOptions only maps those results and never exposes loadMore/search for later facts. | src/components/admin/MissingInformationPanel.tsx resolveOptions: use the existing searchable picker/combobox pattern and expose approvedFacts.loadMore(100) when status is CanLoadMore; retain compatibleFacts filtering so staff can select approved facts after the first 100. |
| Clarity | 8 | “Use a fact” does not say that selecting immediately resolves the report and includes structured sources, not only facts. | src/components/admin/MissingInformationPanel.tsx: change placeholder “Use a fact” to “Resolve…” and group picker choices as “Business facts” and “Business details”; the scoped aria-label should still name the question and the immediate resolution behavior. |
| States & feedback | 8 | Skeleton, empty/filter recovery and Undo are good; while resolving, all controls disable but the affected row has no progress text/spinner. | src/components/admin/MissingInformationPanel.tsx: when pendingAction equals resolve:<question key>, replace the select value/adjacent row hint with a Spinner and role=status “Resolving…”; keep the existing disabled lock, success Undo and alert on failure. |
| Responsive | 8 | Phone select and Create fact stay together, but the permanent checkbox column wastes action width and causes excess metadata wrapping. | src/components/admin/MissingInformationPanel.tsx: on max-lg position the selection checkbox in the question heading, then make metadata and the resolve/Create/Open chat action row span the full card width; remove the persistent col-start-2 constraint for those rows. |
| Accessibility | 9 | Checkbox label has an actual 44px wrapper; scoped select/menu labels and focus rings are implemented. | — |

Average: **8.40/10**.

### Business settings (extra-settings-business-phone.png, extra-settings-business-ipad.png, ux-p7-business-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Business profile and four named groups make the editing task obvious. | — |
| Typography | 9 | 15px section titles, 12px labels and 13px helper copy follow the house scale. | — |
| Layout & spacing | 9 | Desktop/iPad use one-third section description and two-thirds fields; phone stacks clear cards. | — |
| Consistency | 9 | Card surfaces, TimePicker and input styles are shared. | — |
| Color & contrast | 9 | Labels and values are readable; disabled read-only treatment is explicitly explained in code. | — |
| Efficiency | 9 | Contact pairs use width well; currency/time zone and arrival times are grouped logically. | — |
| Clarity | 9 | Optional fields are marked; public-site scope is explained; labels are short. | — |
| States & feedback | 9 | SettingsForm has dirty Save/Discard, saved status, field validation, stale-revision notice and retained draft; AdminSettingsView guards tabs/routes/unload. | — |
| Responsive | 9 | Phone cards stack cleanly. The horizontal tab strip’s intentional fade/chevron is an overflow cue, not accidental clipping. | — |
| Accessibility | 9 | Fields are associated with errors and labels; tabs support arrows/Home/End; touch primitives and visible focus are implemented. | — |

Average: **9.00/10**.

### Team settings (extra-settings-team-phone.png, extra-settings-team-ipad.png, ux-p7-team-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | People and Rules for all cashiers are clearly separated; Invite is easy to find. | — |
| Typography | 9 | 15px names and quieter 13px emails give an effective two-line identity. | — |
| Layout & spacing | 9 | Phone roles/actions move below identity without collision; iPad rows align role and Change controls. | — |
| Consistency | 9 | People use the same role badges; rules use the shared segmented control. | — |
| Color & contrast | 9 | Pending invite is an amber written expiry state; owner access is explicit. | — |
| Efficiency | 9 | Change is scoped to each person; rules are edited together with dirty-only Save. | — |
| Clarity | 8 | Role selects save immediately, while cashier rules require Save; the expanded role editor does not explain this difference. | src/components/admin/TeamSettings.tsx PersonRow: add a 13px muted “Role changes apply immediately” line inside the expanded role editor; keep cashier rules’ Save bar and existing access-removal confirmations. |
| States & feedback | 7 | RulesForm detects stale revisions but reloads rules over the dirty draft; InviteForm is also omitted from onDirtyChange, so its draft is unguarded when changing tabs. | src/components/admin/TeamSettings.tsx: on STALE_RULES preserve draft and show “Rules changed on another device. Review latest before saving” with an explicit Load latest action instead of load(rules); combine InviteForm dirty state with RulesForm dirty reporting to AdminSettingsView. Retain expectedRevision. |
| Responsive | 9 | Phone and iPad keep identity, role, invite state and actions legible. | — |
| Accessibility | 9 | Change/menu labels include the person; inputs/selects are labelled; touch and focus styling are shared. | — |

Average: **8.70/10**.

### New coupon (extra-new-coupon-phone.png, extra-new-coupon-ipad.png, ux-p8-new-coupon-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | New coupon title and one primary Save & publish action lead the view. | — |
| Typography | 9 | Serif page title, mono code and sans discount follow the intended roles. | — |
| Layout & spacing | 9 | Card has clean spacing; phone bottom padding accounts for the fixed action bar. | — |
| Consistency | 9 | Coverage radios, villa track and More disclosure match shared controls. | — |
| Color & contrast | 9 | Selected choices are high contrast; inactive options are legible. | — |
| Efficiency | 9 | Essential fields are visible; optional campaign/dates/limits stay folded; Summary only mounts after a positive discount. | — |
| Clarity | 8 | The untouched discount field looks like a selected 20% amount, but it is only placeholder text and nothing has been entered. | src/components/admin/marketing/CouponEditor.tsx: change percent placeholder from “20%” to “e.g. 20” and fixed-amount placeholder to “e.g. 500”; leave the adjacent selected unit as the unit cue, and keep Summary hidden until a real value exists. |
| States & feedback | 7 | Validation focuses the first error and opens More when needed. Own back link/unload are guarded, but other in-app navigation can lose the draft. | src/components/admin/marketing/CouponEditor.tsx: replace the separate beforeunload/back-link-only guard with useUnsavedGuard(dirty) and route all explicit exits through confirmDiscard, so sidebar/section navigation is covered too; preserve publish confirmation and role gates. |
| Responsive | 9 | Phone has reachable Save & publish and a secondary menu; iPad uses a restrained form width. | — |
| Accessibility | 9 | Labelled inputs, native radio labels, shared touch sizes and accessible validation are implemented. | — |

Average: **8.70/10**.

### Marketing dashboard (extra-marketing-dashboard-phone.png, extra-marketing-dashboard-ipad.png, ux-p8-dashboard-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Net collected clearly dominates; smaller KPIs remain distinct; chart is secondary. | — |
| Typography | 8 | Phone “Coupon savings granted” wraps to two lines, exceeding the brief’s one-line stat caption and making the small tile heavier than its peers. | src/components/admin/marketing/dashboard/DashboardTiles.tsx: shorten HINTS[“Discounts granted”] from “Coupon savings granted” to “Coupon savings”, keeping the fuller wording in the InfoTip; retain the 13px caption instead of shrinking it. |
| Layout & spacing | 9 | Hero is two columns wide; business total is integrated; desktop is bounded rather than stretched. | — |
| Consistency | 9 | KPI cards use Stat/Card and shared InfoTips; pill tracks match the rest of admin. | — |
| Color & contrast | 9 | Money is dark sans/tabular; chart colors identify sources and legend names accompany them. | — |
| Efficiency | 9 | Period/property filters are upfront; refresh/export/view options are available; chart has a table alternative. | — |
| Clarity | 9 | Metric labels and short captions are mostly plain; detailed calculations live in tips. | — |
| States & feedback | 9 | DashboardView distinguishes loading/error/first-run/empty/incomplete; failed same-range refresh keeps figures and states their as-of time with retry. | — |
| Responsive | 9 | Two-up small phone stats, three-up iPad/desktop stats and a full-width hero breakdown adapt intentionally. | — |
| Accessibility | 9 | InfoTip adds 44px hit area, labelled filters have focus styling, and DashboardChart provides a semantic table alternative to chart colors. | — |

Average: **8.90/10**.

## Below 9

Sorted by practical impact: losing staff work or preventing a task first, then misleading states, layout and typography. Each row is one scored (screen, category) pair; one implementation may resolve more than one pair.

| Screen | Category | Score | Concrete buildable fix |
| --- | --- | ---: | --- |
| New booking | States & feedback | 7 | src/components/admin/NewBookingDialog.tsx: derive dirty state from the opening villa/date/guest/price snapshot, call useUnsavedGuard for Close/Escape/outside/Block instead, and disable the scrolling fieldset while saving. Preserve the creation key and availability/coupon checks. |
| Hotel calendar | Accessibility | 7 | src/components/reui/event-calendar/event-calendar-month-view.tsx and AdminBookingsView.tsx: set touch month lanes to at least 46px and event buttons to min-height:44px, recalculating row/overflow capacity rather than overlapping hit areas; include hotelStatus(statusKey(...)).label in the event’s accessible name. |
| Chats | States & feedback | 7 | src/components/admin/useAdminReplyComposer.ts and ChatsView.tsx: expose whether any session has an unsent draft, guard route/unload navigation with useUnsavedGuard, or persist drafts by session locally; preserve existing within-inbox draft retention and new-message checks. |
| Missing information | Efficiency | 7 | src/components/admin/MissingInformationPanel.tsx resolveOptions: use the existing searchable picker/combobox pattern and expose approvedFacts.loadMore(100) when status is CanLoadMore; retain compatibleFacts filtering so staff can select approved facts after the first 100. |
| Stay details | States & feedback | 8 | src/components/admin/BookingSheet.tsx EditBookingDialog: compare the full edit draft to its initial snapshot, apply useUnsavedGuard to onOpenChange and Cancel, and retain the outer notes guard; keep expected revision and reviewed-price validation. |
| Team settings | States & feedback | 7 | src/components/admin/TeamSettings.tsx: on STALE_RULES preserve draft and show “Rules changed on another device. Review latest before saving” with an explicit Load latest action instead of load(rules); combine InviteForm dirty state with RulesForm dirty reporting to AdminSettingsView. Retain expectedRevision. |
| New coupon | States & feedback | 7 | src/components/admin/marketing/CouponEditor.tsx: replace the separate beforeunload/back-link-only guard with useUnsavedGuard(dirty) and route all explicit exits through confirmDiscard, so sidebar/section navigation is covered too; preserve publish confirmation and role gates. |
| Orders picker | States & feedback | 8 | src/components/checkout/OrderStrip.tsx: keep lookup text in OrderNumberLookup and move useFindOrder into a small result child inside InlineErrorBoundary resetKey={number}; show “Couldn’t find this order. Try again” beside the field, preserving the entered number and cashier access limits. |
| Inline refund | States & feedback | 8 | src/components/checkout/RefundForm.tsx and ReceiptView.tsx: report dirty state after amount/method/reason changes and use useUnsavedGuard before New sale or route departure; keep the existing attempt key, remaining cap and retry behavior. |
| Hotel calendar | Color & contrast | 8 | src/components/admin/AdminBookingsView.tsx renderEvent: add distinct status icons or short visible status labels for Confirmed/Paid/Host block/OTA block, retaining color and the existing pending/cancelled styling; reuse hotelStatus(statusKey(...)) for booking status. |
| Missing information | States & feedback | 8 | src/components/admin/MissingInformationPanel.tsx: when pendingAction equals resolve:<question key>, replace the select value/adjacent row hint with a Spinner and role=status “Resolving…”; keep the existing disabled lock, success Undo and alert on failure. |
| New booking | Layout & spacing | 7 | src/components/admin/NewBookingDialog.tsx: remove the mask-image from the scrolling fields and use an inset separator/shadow only at the scroller edge; add a visible “More booking options below” scroll cue so an enabled control is never half faded at the footer. |
| New booking | Color & contrast | 8 | src/components/admin/NewBookingDialog.tsx: remove [mask-image:linear-gradient(...)] from interactive content; retain full text/control opacity and use border-t border-border on the separate footer as the boundary. |
| New booking | Responsive | 8 | src/components/admin/NewBookingDialog.tsx: use sm:max-w-2xl and a sm:grid-cols-2 contact row, while keeping the existing single-column phone form and side-by-side dates; ensure a complete Price row, rather than half a control, is visible above the footer at 1180×820. |
| Chats | Clarity | 8 | src/components/admin/AdminSessionDetail.tsx: render the channel text on phone instead of sr-only sm:not-sr-only, and rename the default automation chip to “AI on”; use “AI replying” only for a real in-flight reply. Keep Needs you as the triage state. |
| Hotel calendar | Clarity | 8 | src/components/admin/AdminBookingsView.tsx renderAgendaEvent: add a text-xs “Due” label above/beside the right-hand money amount, and give the zero state the copy “Paid · ฿0 due”. |
| Stay details | Clarity | 8 | src/components/admin/BookingFinancials.tsx: rename “Record payment…” to “Record received payment…” and add an InfoTip stating “Use for money already received; Take payment opens checkout.” Keep both flows and their revision/permission gates. |
| Appointment details | Clarity | 8 | src/components/admin/AppointmentFinancials.tsx AppointmentMoneyBlock: use “Record received payment…” and the same explanatory InfoTip as BookingFinancials (“Money already received; Take payment opens checkout”). |
| Team settings | Clarity | 8 | src/components/admin/TeamSettings.tsx PersonRow: add a 13px muted “Role changes apply immediately” line inside the expanded role editor; keep cashier rules’ Save bar and existing access-removal confirmations. |
| Missing information | Clarity | 8 | src/components/admin/MissingInformationPanel.tsx: change placeholder “Use a fact” to “Resolve…” and group picker choices as “Business facts” and “Business details”; the scoped aria-label should still name the question and the immediate resolution behavior. |
| New booking | Efficiency | 8 | src/components/admin/NewBookingDialog.tsx: at sm+ put Phone and Email in a two-column contact grid, with suggestions/notification spanning both columns; this saves a field row and brings Price/coupon closer without removing either safeguard. |
| Missing information | Layout & spacing | 8 | src/components/admin/MissingInformationPanel.tsx: take Open chat out of the metadata flex line and put it with row actions; keep metadata leading-4 and use py-3 so large-screen rows can approach 64px instead of inheriting a 44px metadata line. |
| Inline refund | Layout & spacing | 8 | src/components/checkout/RefundForm.tsx: make Refund amount a three-column grid such as grid-cols-[1fr_1fr_6rem] gap-2, reduce chip horizontal padding to px-2, and make the amount input w-full so All/Half/amount stay together at 390px. |
| Inline refund | Responsive | 8 | src/components/checkout/RefundForm.tsx: use shorter quick-reason copy (“Short treatment”, “Guest complaint”, “Wrong charge”) in a two-column phone grid with whitespace-normal and min-h-11; retain the editable reason input and full reason stored in the audit record. |
| Missing information | Responsive | 8 | src/components/admin/MissingInformationPanel.tsx: on max-lg position the selection checkbox in the question heading, then make metadata and the resolve/Create/Open chat action row span the full card width; remove the persistent col-start-2 constraint for those rows. |
| New coupon | Clarity | 8 | src/components/admin/marketing/CouponEditor.tsx: change percent placeholder from “20%” to “e.g. 20” and fixed-amount placeholder to “e.g. 500”; leave the adjacent selected unit as the unit cue, and keep Summary hidden until a real value exists. |
| Manager approvals | Typography | 8 | src/components/checkout/ApprovalsPanel.tsx ApprovalItem: split the long bold sentence into a 15px medium service title and a 14px normal request line (“Mint · 15% discount · ฿180”); keep “Thai massage 60” together and leave the reason below. |
| Hotel calendar | Typography | 8 | src/components/admin/AdminBookingsView.tsx renderEvent: show the guest first and a short villa label on a second intentional line instead of truncate text-xs; pair this with 44px touch lanes so “Lena Fischer” and a usable villa label remain visible. |
| Split payment | Typography | 8 | src/components/checkout/PayPanel.tsx SplitForm: change method button text-xs to text-sm and replace sm:w-24 with a deliberate amount column (for example w-28); switch the row to a stacked layout at the order pane’s container width when four legible labels cannot fit. |
| Order line editor | Consistency | 8 | src/components/checkout/OrderPanel.tsx: replace the four independent tender buttons in the due footer with the same rounded-full bg-muted p-1 track and h-11 selected bg-foreground text-background treatment used by PayPanel.TenderRow; keep Split ghost. |
| Marketing dashboard | Typography | 8 | src/components/admin/marketing/dashboard/DashboardTiles.tsx: shorten HINTS[“Discounts granted”] from “Coupon savings granted” to “Coupon savings”, keeping the fuller wording in the InfoTip; retain the 13px caption instead of shrinking it. |
| Order line editor | Typography | 8 | src/components/checkout/OrderPanel.tsx: in the line header, put therapist and scheduling status on separate intentional text-xs lines (or use a short “Unscheduled” status); remove the accidental one-word wrap beside the amount. |

## Visual bugs

- **extra-new-booking-ipad.png** — Enabled Custom price text/switch is washed out and partly cut at the bottom scroll mask, directly above Total. Remove the interactive-content mask and reflow the iPad contact fields (NewBookingDialog.tsx).
- **extra-new-booking-phone.png; ux-p5-new-booking-phone.png** — Price card ends at the scroll/footer boundary with its bottom cut off. This is scroll-boundary clipping, not evidence that the underlying field is unreachable. Replace the mask with a clear separator/scroll cue (NewBookingDialog.tsx).
- **extra-refund-phone.png** — Refund amount drops to a separate narrow row under All/Half; three reason-chip rows make the nested form unnecessarily tall. Use a deliberate phone grid (RefundForm.tsx).
- **extra-line-open-ipad.png** — “Not scheduled” breaks after “Not”, leaving “scheduled” orphaned below the therapist metadata. Give status its own line or shorter label (OrderPanel.tsx).
- **extra-hotel-calendar-ipad.png** — Lena Fischer’s villa is visibly truncated to “Tidegla…”. Use a two-line touch event with guest plus short villa label (AdminBookingsView.tsx).
- **ux-p1-ipad-manager-approvals.png** — Service title wraps with “60” alone on the next line in the bold request sentence. Separate service title from requester/discount (ApprovalsPanel.tsx).
- **extra-marketing-dashboard-phone.png** — “Coupon savings granted” wraps to two lines in the Discounts granted tile. Shorten to “Coupon savings” (DashboardTiles.tsx).

No static screenshot establishes a content-on-content overlap. Offscreen continuation in scrolling calendars/pages, the intentional settings-tab overflow fade, and the checkout strip with matching bottom padding are not counted as overlap bugs. The calendar’s undersized event targets are a code-backed accessibility defect, listed in Below 9.

## Per-screen averages

| Screen | Average / 10 | Categories below 9 |
| --- | ---: | ---: |
| Checkout catalog / cashier till | 9.00 | 0 |
| Order line editor | 8.80 | 2 |
| Cash payment | 9.00 | 0 |
| Split payment | 8.90 | 1 |
| Receipt | 9.00 | 0 |
| Inline refund | 8.70 | 3 |
| Orders picker | 8.90 | 1 |
| Manager approvals | 8.90 | 1 |
| New booking | 8.30 | 5 |
| Stay details | 8.80 | 2 |
| Appointment details | 8.90 | 1 |
| Hotel calendar | 8.50 | 4 |
| Staff calendar | 9.00 | 0 |
| Chats | 8.70 | 2 |
| Missing information | 8.40 | 5 |
| Business settings | 9.00 | 0 |
| Team settings | 8.70 | 2 |
| New coupon | 8.70 | 2 |
| Marketing dashboard | 8.90 | 1 |

**Overall: 8.79/10** across 19 screens / 190 scores. **5/19 screens** meet 9+ in every category. **32 category scores** are below 9.
