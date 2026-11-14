# Independent UX/UI scorecard — round 0

Reviewed detached `ux/integration` at `46e2643` (2026-11-14). Read `docs/reviews/ux-audit/scorecard-rubric.md`, `visual-brief.md` and `tests/browser/now-screenshots.spec.ts`. Personally opened every one of the 44 PNGs; no contact-sheet-only grading. Grouped duplicate captures and phone/iPad variants into 19 screen/state scorecards. Every screen has all ten categories. A 9 is shippable with at most a nit; no 10 awarded.

Visual evidence is limited to the supplied captures. Loading, empty, error, disabled, focus, touch sizes, keyboard semantics and labels were checked in the React component source, not exercised live. Screens with only one captured viewport are explicitly identified in their Responsive row; a 9 there is a provisional code-supported assessment, not a claim of unseen visual verification. Source-reviewed risks are identified as such. No server, browser session, deployment or mutation was run; no product files, pushes or PRs were made.

Shared code matters: `ui/button.tsx`, `input.tsx`, `select.tsx`, `toggle-group.tsx` and checkout `TOUCH_TARGETS` add coarse-pointer 44px sizing. I did not mistake the screenshot’s fine-pointer 36–40px rendering for proof those shared controls fail on a real touch device. Catalog plus icons are inside full-tile buttons; InfoTip and Team switch pseudo-elements expand their hit regions. Conversely, raw report checkboxes, calendar triggers and some radio/checkbox labels lack equivalent sizing.

Money safeguards remain requirements: every proposed change retains approvals, permission gates, idempotency/attempt keys, refund caps and revision checks. The split finding concerns contradictory allocation copy; the screenshot does not prove incorrect money settlement.

**Overall average: 8.56/10** (equal weight per category per screen: 190 scores; duplicates do not increase weight). **55 category scores below 9; 2/19 screens meet 9+ in all ten categories.**

### Checkout catalog / cashier till (`extra-checkout-start-ipad.png`, `extra-checkout-start-phone.png`, `ux-p1-phone-cashier-till.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Catalog is the starting task; the phone order bar clearly holds the next step. | — |
| Typography | 9 | Prices are sans/tabular; service names and supporting duration form a readable two-level scale. | — |
| Layout & spacing | 9 | Consistent tile gutters; catalog has pb-28 and scroll-pb-28 to clear the fixed phone order bar. | — |
| Consistency | 9 | Tile shapes, catalog tabs, search and customer actions use the same treatments at both widths. | — |
| Color & contrast | 9 | Dark order bar contrasts clearly with the light catalog; the gold add affordance is supported by text. | — |
| Efficiency | 9 | The whole tile adds an item; its small plus is decorative, not the only hit target. Cash shortcut appears when payable. | — |
| Clarity | 9 | Empty order says to tap an item; room-charge versus date-reservation distinction is explained in code. | — |
| States & feedback | 9 | CatalogPane supplies labelled skeletons, empty-search copy and custom-item recovery; CheckoutView repeats write errors inside the sheet. | — |
| Responsive | 9 | iPad uses two catalog columns and an order rail; phone uses full-width tiles and a bottom order entry. | — |
| Accessibility | 9 | Catalog tiles exceed 44px, have focus rings and accessible add text; shared inputs/buttons enlarge for coarse pointers. | — |

Screen mean: 9.00/10.

### Order line editor (`extra-line-open-ipad.png`, `extra-line-open-phone.png`, `ux-p2-phone-line-open.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Expanded line makes discount, schedule and price discoverable while the total remains anchored. | — |
| Typography | 8 | The iPad subtitle visibly cuts off “Not scheduled” even though it is operationally significant. | In src/components/checkout/OrderPanel.tsx OrderLine, replace the subtitle block truncate text-xs with whitespace-normal text-xs leading-4; allow a second line. |
| Layout & spacing | 9 | Inset divided settings rows align labels and controls; the bottom summary is separate from scrolling lines. | — |
| Consistency | 9 | Outline inputs, inset setting rows and destructive removal have predictable roles. | — |
| Color & contrast | 9 | Destructive Remove item is text-labelled, and standard body/muted text is readable. | — |
| Efficiency | 9 | Discount is inline; schedule and price are progressive disclosures with approval routes preserved. | — |
| Clarity | 7 | “Discount · up to 10%” sits beside placeholder “15% or 150”; the visible label omits “without a manager”. | In src/components/checkout/OrderPanel.tsx DiscountField, make “without approval” visible, change placeholder to “10% or ฿120”, and retain the larger-discount manager-request flow. |
| States & feedback | 9 | Discount parsing echoes baht/percent before applying; invalid text, manager requests, pending actions and source-change errors have local UI. | — |
| Responsive | 8 | The 380px iPad order rail loses subtitle information that fits on the phone sheet. | In src/components/checkout/OrderPanel.tsx OrderLine, wrap metadata or move “Not scheduled” into its own chip beneath the title instead of one truncated line. |
| Accessibility | 9 | Line toggle exposes aria-expanded; fields have labels, descriptions and invalid state; checkout descendants get coarse-pointer targets. | — |

Screen mean: 8.60/10.

### Cash payment (`extra-cash-panel-ipad.png`, `extra-cash-panel-phone.png`, `ux-p3-phone-cash-1500.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Balance is the hero; Confirm cash is the clear primary action. Change is prominent only for overpayment. | — |
| Typography | 9 | 40px balance, 24px received input and 32px change use sans/tabular numerals. | — |
| Layout & spacing | 9 | Full-width input and equally sized note shortcuts align; confirmation is pinned with mt-auto. | — |
| Consistency | 8 | Pressing the selected Cash chip closes payment, unlike a normal selected segment; its appearance promises persistent selection. | In src/components/checkout/PayPanel.tsx, make onPick of the active tender a no-op and provide a labelled Back to order control; preserve attempt-key lifetimes when leaving. |
| Color & contrast | 9 | Change has an explicit label as well as emerald color; amounts and action have strong contrast. | — |
| Efficiency | 9 | Exact cash is prefilled; note chips make change calculation one tap. | — |
| Clarity | 7 | There is no visible Back to order on iPad; staff must discover that tapping selected Cash restores order details. | In src/components/checkout/PayPanel.tsx render a ghost “Back to order” action for single-tender modes as well as split, disabled while submitting. |
| States & feedback | 9 | Insufficient cash changes disabled-button copy; order revisions, in-flight lock, coupon recovery and same-attempt retry are explicitly handled. | — |
| Responsive | 9 | Phone sheet hugs its content; iPad keeps the catalog available. Code scrolls the focused field on visualViewport resize. | — |
| Accessibility | 9 | Cash amount has a label, change is announced as status, payment time is keyboard accessible and shortcuts are h-11. | — |

Screen mean: 8.70/10.

### Split payment (`ux-p3-ipad-split.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Balance and final confirmation frame the split; payment rows are adjacent. | — |
| Typography | 8 | 11px method labels “Cash / QR / Card / Transfer” are below the 12px label floor on a primary payment control. | In src/components/checkout/PayPanel.tsx SplitForm, replace text-[11px] with text-xs (or text-sm) and allow each method group a full-width row if needed. |
| Layout & spacing | 9 | Two rows align amounts; remaining and confirmation fit inside the panel. | — |
| Consistency | 8 | PromptPay is called QR here, while the cash panel and confirmation call it PromptPay. | In src/components/checkout/PayPanel.tsx SplitForm render TENDER_LABELS[method].short without the QR substitution; use the same PromptPay wording in RefundForm.tsx. |
| Color & contrast | 9 | Over-allocation uses destructive color and a textual Over by label; active methods have a dark fill. | — |
| Efficiency | 9 | Last row automatically fills the remainder, so two-way splitting needs one typed amount. | — |
| Clarity | 6 | The screenshot shows Cash ฿500 plus an auto-filled ฿700 second payment, yet amber “Remaining ฿700” persists with Confirm enabled. This is an allocation label, not a demonstrated settlement error. | In src/components/checkout/PayPanel.tsx SplitForm label the computed last row “Auto balance”; change the hero to “Remaining on PromptPay” using the final tender’s method, with “Included in payment 2” underneath. Keep the 28px amber remainder and Over by validation so the house treatment stays intact. |
| States & feedback | 8 | Zero/blank typed rows only disable Confirm split; a zero final row has no explanation of how to finish. | In src/components/checkout/PayPanel.tsx SplitForm add an inline aria-live validation message: “Enter an amount above ฿0 for payment 1” or “Leave an amount for the final payment, or use a single payment.” Keep positive-amount checks. |
| Responsive | 9 | Only iPad is captured. Source uses min-w-0 and flex-wrap so method and amount can stack on a phone; that appearance is unverified. | — |
| Accessibility | 9 | Method groups and each amount are labelled; buttons are h-11 and editable amounts select on focus. | — |

Screen mean: 8.40/10.

### Orders drawer (`ux-p2b-phone-orders.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Order rows lead; lookup is a secondary task below the list. | — |
| Typography | 9 | Order IDs, customer metadata and right-aligned due amounts have clear contrast in scale. | — |
| Layout & spacing | 9 | Comfortable row height and dividers; lookup is aligned and separated. | — |
| Consistency | 9 | Sheet styling, list rows, outline Go and close affordance match checkout. | — |
| Color & contrast | 9 | Open and current orders are identified by text, not color alone. | — |
| Efficiency | 9 | Open orders take one tap and current order is marked; cashier receipt-by-number scope is retained. | — |
| Clarity | 7 | The cashier list contains unpaid orders only, but “A paid order opens its receipt” implies that paid rows can be browsed here. | In src/components/checkout/OrderStrip.tsx use cashier-specific intro: “Open orders, latest first. For today’s receipts, enter the order number below.” Label lookup “Order number shown on the receipt”. Keep cashier access limits. |
| States & feedback | 8 | Entering 0 enables Go, then silently sets number to null. “Not available.” gives no recovery guidance for a failed lookup. | In src/components/checkout/OrderStrip.tsx OrderNumberLookup validate a positive safe integer before submission, show an inline error for 0/invalid input, and add “Check the order number or choose an open order above” to unavailable copy. |
| Responsive | 9 | Only phone is captured; source caps the drawer at max-w-lg and scrolls long lists at 50dvh. | — |
| Accessibility | 9 | Rows are min-h-14, lookup is labelled, current order has aria-current and focus is visible. | — |

Screen mean: 8.70/10.

### Receipt (`extra-receipt-ipad.png`, `extra-receipt-phone.png`, `ux-p4-phone-manager-receipt.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | New sale is the only filled primary; Print is secondary and receipt identity is prominent. | — |
| Typography | 9 | Paper has deliberate receipt typography; every monetary span uses sans/tabular styling, including VAT and tender. | — |
| Layout & spacing | 9 | 5:7 iPad columns separate receipt paper from operational Items; phone follows the same order. | — |
| Consistency | 9 | Items and History use rounded card surfaces; toolbar and overflow actions follow shared patterns. | — |
| Color & contrast | 9 | Not scheduled has amber text plus words; refund is explicitly named and body content is readable. | — |
| Efficiency | 9 | Link and refund sit under each item; Share, paper size and corrections move to overflow. | — |
| Clarity | 9 | Paid by card, receipt/order numbers and Not scheduled distinguish payment from service scheduling. | — |
| States & feedback | 9 | ReceiptView handles loading/missing/unpaid/void/refunded, sharing failures and line notices; history has labelled loading/empty/retry states. | — |
| Responsive | 9 | Paper stays capped at max-w-sm on iPad; phone paper and Items fit with aligned amounts. | — |
| Accessibility | 9 | Labelled toolbar, menu and article, focus restoration, h-11 item actions and keyboard history tabs are implemented. | — |

Screen mean: 9.00/10.

### Inline refund (`ux-p4-ipad-manager-refund.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Refund is correctly attached to Foot spa 45; original receipt remains beside it. | — |
| Typography | 9 | Amount and All/Half shortcuts use sans/tabular text; method and reason controls are legible. | — |
| Layout & spacing | 9 | Form is inset inside the item card and scrollIntoView brings it and its action into view. | — |
| Consistency | 9 | Refund uses the same rounded controls and labelled destructive-outline submission pattern. | — |
| Color & contrast | 9 | Faded refund action is disabled; this is not itself a WCAG text-contrast failure because it is inactive. | — |
| Efficiency | 9 | All, Half, original-tender default and reason chips minimize typing without removing approvals. | — |
| Clarity | 7 | “Refund to Card” can read as returning money through the terminal; the required Reason label is sr-only and disabled submit has no visible prerequisite. | In src/components/checkout/RefundForm.tsx add “Record money already returned to the guest”; give ReasonField a visible “Reason (required)” label and an inline “Choose or enter a reason to continue” hint. Use PromptPay instead of QR. |
| States & feedback | 7 | After an uncertain network response, amount is locked but method and reason remain editable, and another submit reuses the attempt key with current method/reason. This permits a misleading changed retry. | In src/components/checkout/RefundForm.tsx snapshot amount, method and reason for the first submitted attempt; on uncertain response disable all three edits and show “Retry same refund”. Retain the original idempotency key and all caps/approval checks. |
| Responsive | 9 | Only iPad refund is captured. Source wraps amount chips and reason chips; the five-column phone method row is code-reviewed, not visually verified. | — |
| Accessibility | 9 | Form/amount/method/reason are programmatically labelled; amount errors are described; focus and checkout touch sizing are implemented. | — |

Screen mean: 8.60/10.

### Manager approvals (`ux-p1-ipad-manager-approvals.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Request amount, reason and before/after total lead directly to Approve versus Decline. | — |
| Typography | 9 | 14px request and reason are readable; total comparison uses sans/tabular numerals. | — |
| Layout & spacing | 9 | Compact request card has comfortable padding and aligned decision buttons. | — |
| Consistency | 9 | Primary Approve and outline Decline follow the shared button system. | — |
| Color & contrast | 9 | Decisions use labelled buttons; quoted reason and muted expiry remain readable. | — |
| Efficiency | 9 | One decision tap; final request closes the sheet and results return as a toast. | — |
| Clarity | 9 | Requester, discount and expiry are explicit; one-use/current-order explanation is available in InfoTip. | — |
| States & feedback | 8 | Expiry text updates locally but decision buttons are disabled only for busy, so an expired request can still look actionable until a server refusal. | In src/components/checkout/ApprovalsPanel.tsx ApprovalItem compute expired = now >= request.expiresAt, show “Expired · cashier must request again”, and disable both decisions; keep server revision/expiry verification. |
| Responsive | 9 | Only iPad is captured; source uses a w-full sheet capped at sm:max-w-md with wrapping decisions. | — |
| Accessibility | 9 | Sheet is labelled, title gets initial focus rather than arming Approve, and coarse-pointer button/close sizing is implemented. | — |

Screen mean: 8.90/10.

### New booking (`ux-p5-new-booking-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Stay, Guest and Price grouping makes the booking sequence obvious; Create booking is the primary. | — |
| Typography | 9 | Serif title, semibold section headings and 18px sans/tabular total follow the scale. | — |
| Layout & spacing | 9 | 24px group gaps and paired check-in/out fields work at 390px. Footer is a separate flex sibling, not an overlay. | — |
| Consistency | 9 | Villa/date pickers, inputs and ghost Block action follow established admin treatments. | — |
| Color & contrast | 9 | Muted labels and dark action are readable; conflict and validation messages are textual. | — |
| Efficiency | 9 | Villa/default guest count, confirmed default, return-guest suggestions and live quote reduce entry work. | — |
| Clarity | 9 | Custom price and Block these dates instead describe their effects; phone/email requirements are differentiated. | — |
| States & feedback | 8 | An invalid phone puts the error below the form’s fields without focusing or describing nb-phone, so the problem can remain out of view on a phone. | In src/components/admin/NewBookingDialog.tsx store a phone-specific error, render it under PhoneInput with aria-invalid/aria-describedby, and focus/scroll nb-phone on failed validation. |
| Responsive | 9 | Only phone is captured; side-by-side dates fit, and scrolling permits access to the coupon below Price. iPad appearance is not verified. | — |
| Accessibility | 7 | Create as confirmed and Custom price use 16px raw checkboxes inside labels without min-h-11; returning-guest suggestion buttons also lack a minimum target. | In src/components/admin/NewBookingDialog.tsx give these labels and suggestion buttons min-h-11; add a visible focus ring to the complete labelled checkbox row. |

Screen mean: 8.70/10.

### Stay sheet (`extra-stay-sheet-ipad.png`, `extra-stay-sheet-phone.png`, `ux-p5-stay-sheet-ipad.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Guest and balance lead; Take payment is the sole primary. | — |
| Typography | 9 | Serif name, 36px sans/tabular balance, 13px labels and 14px detail values are coherent. | — |
| Layout & spacing | 9 | 96px key column and repeated divided rows align well; header tools are grouped together. | — |
| Consistency | 9 | Sheet tools and financial card treatment match the appointment sheet. | — |
| Color & contrast | 9 | Confirmed is text-labelled; muted detail labels and body values are readable. | — |
| Efficiency | 8 | Guest phone and email are plain detail text, so calling or contacting a guest requires selecting/copying a number/address. | In src/components/admin/BookingSheet.tsx render tel: and mailto: anchors in the Phone/Email Detail rows, with min-h-11 inline-flex and focus-visible:ring-2; keep a copy option for shared desk devices. |
| Clarity | 9 | Stay dates, nights, guests and separate Stay/Spa amounts make the combined balance understandable. | — |
| States & feedback | 8 | Notes show a Save action when changed, but Sheet onOpenChange and Close discard the draft without warning or retention. | In src/components/admin/BookingSheet.tsx retain the per-booking notes draft or intercept every close route when notesChanged with “Discard unsaved notes?”; do not alter note revision checks. |
| Responsive | 9 | Full-width phone sheet and capped iPad rail keep detail fields readable without truncation in these samples. | — |
| Accessibility | 9 | Inputs, icon actions and financial region are labelled; shared buttons and notes focus styling are present. | — |

Screen mean: 8.80/10.

### Appointment sheet (`extra-appointment-sheet-ipad.png`, `extra-appointment-sheet-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Guest and balance are obvious; Mark arrived correctly becomes outline while money is due. | — |
| Typography | 9 | Name and money scale match the stay sheet; detail rows are readable. | — |
| Layout & spacing | 9 | Header tools, money surface and aligned 96px label column are orderly. | — |
| Consistency | 9 | Payment and detail presentation match the stay sheet; service terminology is stable. | — |
| Color & contrast | 9 | Booked status is explicit, and main amounts and copy have clear contrast. | — |
| Efficiency | 8 | There is no action on the linked-stay row; staff must leave the appointment and hunt for the booking in Hotel bookings. | In src/components/admin/AppointmentSheet.tsx make the Villa stay row an “Open stay” button opening BookingSheet for bookingId, preserving its access checks. |
| Clarity | 8 | “On a villa stay” is tautological and gives no reference or villa name for the linked booking. | In src/components/admin/AppointmentSheet.tsx replace that value with the linked villa and booking reference (with a loading/removed fallback), using the existing bookingId. |
| States & feedback | 8 | Parent Sheet closes on Escape, outside click or Close during guest-detail editing; AppointmentEditForm has local unsaved state without a close guard. | In src/components/admin/AppointmentSheet.tsx propagate edit dirty/saving state to the sheet, preserve the draft or confirm discard on all close routes, and prevent dismiss while saving. |
| Responsive | 9 | Phone and iPad sheet widths preserve all visible details; no overlap in these captures. | — |
| Accessibility | 7 | AppointmentMoneyBlock gives Take payment aria-disabled and pointer-events-none but leaves an href, so keyboard Enter can still navigate while it is disabled. | In src/components/admin/AppointmentFinancials.tsx replace the disabled ButtonLink with a disabled Button (or remove href and intercept keyboard activation); restore the link when enabled. |

Screen mean: 8.50/10.

### Hotel calendar (`extra-hotel-calendar-ipad.png`, `extra-hotel-calendar-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Today’s counts lead to the calendar and a clear New booking action. | — |
| Typography | 7 | At 390px Maya is “M…”, Somchai is “Somchai Pras…” and Anna’s villa is “Lagoon …”; +N more is 10px. | In src/components/admin/AdminBookingsView.tsx use List on phones with text-[15px] guest names and separate 12px villa/date metadata; in retained month mode use text-xs overflow labels. |
| Layout & spacing | 9 | iPad month occupies the available width with aligned controls and date numbers; phone KPIs fit four across. | — |
| Consistency | 9 | Rounded calendar surface and outline/primary tools align with the system. | — |
| Color & contrast | 7 | Outside-month day numbers are visibly faint in both calendar screenshots; text-muted-foreground/50 sacrifices legibility for de-emphasis. | In src/components/admin/AdminBookingsView.tsx monthDayNumber remove /50 from outside-day text; de-emphasize via bg-muted/30 and font-normal while keeping text-muted-foreground. |
| Efficiency | 7 | Month mode makes staff tap truncated events merely to learn whose stay it is; search and villa filters are behind phone controls. | In src/components/admin/AdminBookingsView.tsx default phones without a remembered choice to List/agenda; retain Month as an explicit view and keep remembered-view behavior. |
| Clarity | 9 | KPI labels and month/date navigation are short and understandable; booking statuses are named in the legend. | — |
| States & feedback | 9 | Loading is explicit, no-villa state has an Add villa action, incomplete reads warn, and mutations report success/error. | — |
| Responsive | 6 | A seven-column booking planner is squeezed into 365px instead of presenting phone-readable bookings. | In src/components/admin/AdminBookingsView.tsx provide a phone list with full guest, villa, dates and balance rows below the four KPIs; use the existing agenda view and keep month optional. |
| Accessibility | 6 | h-4 overflow links and short month bars fall well below 44px; calendar interaction does not inherit checkout touch expansion. | In src/components/reui/event-calendar/event-calendar-month-view.tsx give more triggers and day-detail entry points 44px hit areas; use min-h-11 tappable rows in the phone agenda instead of enlarging overlapping month bars. |

Screen mean: 7.80/10.

### Staff calendar (`extra-staff-calendar-ipad.png`, `extra-staff-calendar-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 8 | Phone toolbar occupies roughly the top 265px of the calendar before any appointment content appears. | In src/components/admin/AdminCalendarHeader.tsx compact date navigation and view into two phone rows; in AdminStaffBookingsView.tsx move Show cancelled into Filters and keep New appointment beside the date. |
| Typography | 7 | Phone “09:50 · Thai massage…” cuts off; the narrow resource cell cannot show the service name. | In src/components/admin/AdminStaffBookingsView.tsx render phone appointments as text-[15px] guest plus a wrapping text-xs service/time row in agenda mode; retain concise grid chips for iPad. |
| Layout & spacing | 7 | Red now-indicator crosses Ken Tanaka’s name on both screenshots, creating a strike-through appearance. | In src/components/reui/event-calendar/event-calendar-time-grid.tsx lower the now-indicator below event text/cards (currently z-40) and keep its time dot in the gutter; ensure event surfaces mask the line. |
| Consistency | 8 | Square outer calendar surface differs visibly from the rounded Hotel calendar and other admin cards. | In src/components/admin/AdminStaffBookingsView.tsx replace the outer border bg-card div with Card (rounded-xl) and overflow-hidden; preserve internal grid dividers. |
| Color & contrast | 9 | Body text and appointment chip contrast are adequate; statuses have a text legend. | — |
| Efficiency | 7 | Two of four staff columns are offscreen on phone; staff must discover horizontal scrolling to inspect all schedules. | In src/components/admin/AdminStaffBookingsView.tsx default phone to agenda or a one-staff picker; if resource view is selected, add “Swipe to see 2 more staff” and explicit next/previous staff controls. |
| Clarity | 8 | Blank beige availability blocks require guessing; only turnaround is labelled and the legend has no Not working entry. | In src/components/admin/AdminStaffBookingsView.tsx renderEvent off branch add visible “Not working” text or a labelled hatch, and add the same entry to the footer legend. |
| States & feedback | 9 | Loading, service-less disabled reason, proposal review and mutation failures have explicit UI; no fabricated empty appointments appear. | — |
| Responsive | 6 | Only two staff and 08:00–11:00 fit in the phone grid; service text clips and horizontal continuation is invisible. | In src/components/admin/AdminStaffBookingsView.tsx use a phone agenda/one-staff day view with a compact header and viewport-fitting scroll area; retain the four-column resource grid at iPad width. |
| Accessibility | 7 | Raw calendar view buttons are 36px; Show all is a small text button and filter labels have py-1.5 without min-h-11. | In src/components/admin/AdminCalendarHeader.tsx add pointer-coarse:min-h-11/min-w-11 to view buttons; in AdminStaffBookingsView.tsx make Show all and every filter label min-h-11 with a row focus indicator. |

Screen mean: 7.60/10.

### Chats (`extra-chats-ipad.png`, `extra-chats-phone.png`, `ux-p6-phone-chat.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Guest identity, Needs you and the latest exchange are evident; composer anchors the reply task. | — |
| Typography | 7 | iPad names become “Anna …”, “Somcha…” and “Kenji Wa…”; phone property is “Tideglass Pool Resid…”. | In src/components/admin/ChatsView.tsx give visitor name its own full-width text-[15px] row and move property below it; in AdminSessionDetail.tsx let the property line wrap to two lines on narrow screens. |
| Layout & spacing | 8 | AdminSessionActions renders its error paragraph inside the non-wrapping actions flex row; a server failure can squeeze tools and header identity instead of occupying its own row. | In src/components/admin/AdminSessionActions.tsx use flex-wrap with a w-full error row, or return the error into a separate header strip below the action group. |
| Consistency | 9 | Badges, outline settled action, chat bubbles and overflow menu remain consistent at both widths. | — |
| Color & contrast | 9 | Guest/AI messages differ by alignment and label as well as tint; muted time text is readable. | — |
| Efficiency | 9 | No reply needed advances to the next chat; search, shortcuts and sender channel are available. | — |
| Clarity | 9 | Reply via Website and Needs you are plain; phone icon action has an explicit accessible name. | — |
| States & feedback | 8 | Action errors are textual and role=alert, but their layout is not protected at phone width; no dedicated space remains for the failure message. | In src/components/admin/AdminSessionActions.tsx place action errors below the tools in a full-width role=alert region; retain the active chat and provide a Retry action where safe. |
| Responsive | 8 | Fixed iPad list compresses identity; phone allocates three icon tools beside a two-line identity but still cuts the villa name. | In src/components/admin/ChatsView.tsx restructure the list’s metadata onto its own row; in AdminSessionDetail.tsx make the identity block full-width below the tool row when needed instead of truncating property. |
| Accessibility | 9 | Composer is labelled and 44px, actions have aria-labels, shared controls expand on coarse pointers and keyboard shortcuts are documented. | — |

Screen mean: 8.50/10.

### Missing information (`extra-missing-information-ipad.png`, `extra-missing-information-phone.png`, `ux-p6-desktop-missing.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Question is the row’s main content and Resolve/Create fact are adjacent actions. | — |
| Typography | 8 | Every phone resolve placeholder is truncated to “Resolve…”; no selected fact or full action wording is visible. | In src/components/admin/MissingInformationPanel.tsx use a short visible placeholder “Use a fact” and preserve the full aria-label; give the trigger min-w-[8rem] with readable text-xs or text-sm. |
| Layout & spacing | 9 | iPad rows are compact and aligned; phone rows place actions under the question without overlap. | — |
| Consistency | 9 | Search, status select, overflow and inline ghost creation follow shared admin controls. | — |
| Color & contrast | 9 | Body/meta contrast is legible and repeated reports have a text badge. | — |
| Efficiency | 9 | Resolving takes one selection and supports Undo; Create fact is one tap beside it. | — |
| Clarity | 8 | Bare New looks like an action instead of a status filter; Resolve… does not reveal that choosing a fact immediately resolves the report. | In src/components/admin/MissingInformationPanel.tsx add a visible “Status” label, use “Use a fact” and a short “Choosing a fact resolves this report · Undo available” hint in the picker. |
| States & feedback | 9 | Skeletons, search/filter empty states, local action errors, pending disabling and undo feedback are implemented. | — |
| Responsive | 8 | Phone action row spends width on col-span-full pl-7 plus reserved right-menu space, leaving a 124px truncated selector. | In src/components/admin/MissingInformationPanel.tsx align the action row with the question by removing redundant max-lg:pl-7, keep Create fact beside it, and reserve min-w-[8rem] for Use a fact. |
| Accessibility | 6 | Bulk checkboxes expose only a 16–20px target and Open chat links are line-height sized; neither inherits shared Button sizing. | In src/components/admin/admin-bulk.tsx wrap SelectCheckbox in a labelled size-11 hit region with the 16–20px input centered; in MissingInformationPanel.tsx give Open chat min-h-11 inline-flex and a visible focus ring. |

Screen mean: 8.40/10.

### Business settings (`extra-settings-business-ipad.png`, `extra-settings-business-phone.png`, `ux-p7-business-desktop.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Business profile leads into four well-labelled groups; dirty-only Save avoids a competing default action. | — |
| Typography | 9 | 3xl serif title, 15px section titles and 12px muted labels follow the house scale. | — |
| Layout & spacing | 9 | Desktop left-third group explanations align with right-two-thirds fields; phone cards keep a stable vertical rhythm. | — |
| Consistency | 9 | Four actual Cards and the compact shared TimePicker follow the prescribed system. | — |
| Color & contrast | 9 | Input edges, labels, body copy and focus styles are coherent and readable. | — |
| Efficiency | 9 | Contact fields pair on iPad; time entry opens one picker rather than separate always-visible selectors. | — |
| Clarity | 9 | Optional fields are identified, section copy is brief, and scope explanation is available beside Business profile. | — |
| States & feedback | 7 | Switching Settings tabs unmounts SettingsForm and loses its local dirty draft without confirmation or retention; reload/close is also unguarded. | In src/components/admin/AdminSettingsView.tsx lift section drafts into the parent or guard setTab and beforeunload while dirty. Show “Unsaved changes” in the dirty Save bar and retain expectedRevision checks. |
| Responsive | 8 | Phone captures end the settings tabs at AI assistant; Email/Channels have no visible overflow affordance. | In src/components/admin/SegmentedTabs.tsx add a right-edge scroll affordance/chevron when overflow exists (using scrollWidth/clientWidth); alternatively expose a phone “Settings section” select in AdminSettingsView.tsx. |
| Accessibility | 9 | Fields and errors are associated, read-only fieldset is explained, and time controls have labelled keyboard-accessible triggers. | — |

Screen mean: 8.70/10.

### Team settings (`extra-settings-team-ipad.png`, `extra-settings-team-phone.png`, `ux-p7-team-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | People and Invite lead; global cashier rules are clearly a separate section. | — |
| Typography | 9 | 15px names and 13px email pair well; role badges remain readable and do not truncate in the samples. | — |
| Layout & spacing | 9 | Divided people rows align roles/actions; phone makes a deliberate second row for role/actions. | — |
| Consistency | 9 | People and Rules use Cards, role Badges and shared outline Change controls. | — |
| Color & contrast | 9 | Amber invitation status is explicitly labelled; permission switches have text labels. | — |
| Efficiency | 9 | Role changes are local to the row; cashier rules use a dirty-only Save bar. | — |
| Clarity | 7 | “Invited · 26 Nov” reads as the date invited; inviteState formats grant.expiresAt, so the label conceals the deadline. | In src/components/admin/TeamSettings.tsx inviteState change copy to “Invite expires 26 Nov” (include year when needed), and retain “Invite expired” for expired grants. |
| States & feedback | 7 | RulesForm keeps draft/base locally and is removed on another settings tab; dirty rules are silently lost when navigating away or reloading. | In src/components/admin/TeamSettings.tsx expose rules dirty state to AdminSettingsView.tsx, retain the draft across tabs or guard discard, and add beforeunload while dirty. Preserve rules.revision checks. |
| Responsive | 8 | Email and Channels remain offscreen without a cue in the phone settings navigation. | In src/components/admin/SegmentedTabs.tsx add an overflow arrow/edge affordance and ensure the selected tab scrolls into view; reuse the Business settings solution. |
| Accessibility | 9 | Role controls have person-specific labels; switches have aria-checked and expanded 44px hit regions; focus is visible. | — |

Screen mean: 8.50/10.

### New coupon (`extra-new-coupon-ipad.png`, `extra-new-coupon-phone.png`, `ux-p8-new-coupon-phone.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | New coupon title and one Save & publish primary are clear; optional rules remain folded. | — |
| Typography | 9 | Serif page title and mono code field follow the house rules; summary money uses the money utility. | — |
| Layout & spacing | 8 | At iPad width the form occupies roughly two thirds while the entire reserved sidebar is blank; Save & publish sits far across that gap. | In src/components/admin/marketing/CouponEditor.tsx apply lg:grid-cols-[minmax(0,1fr)_22rem] only when summary/status/history exists; for an empty new coupon use a centered max-w-3xl form with actions on its right edge. |
| Consistency | 9 | Card, choice options and disclosures fit the admin system. | — |
| Color & contrast | 9 | Input labels, selected radios and primary action have clear contrast. | — |
| Efficiency | 7 | Percentage entry requires %, but mobile decimal keyboards generally omit that key; entering 20 alone is parsed as ฿20 rather than 20%. This is a code-derived device risk, not a tested keyboard failure. | In src/components/admin/marketing/CouponEditor.tsx add a visible % / ฿ ToggleGroup beside the numeric discount field (or a % insertion button) and retain the existing parser, limits and publish review. |
| Clarity | 8 | The initial discount field relies on a placeholder to distinguish percent and an unlabeled baht amount. | In src/components/admin/marketing/CouponEditor.tsx label the numeric unit with a % / ฿ control and replace placeholder with “Amount”; show “20% off” or “฿500 off” beside the field before saving. |
| States & feedback | 9 | Code/discount validation focuses the first error and opens More when needed; draft/publish failures and dirty-leave protection are implemented. | — |
| Responsive | 8 | The empty sidebar persists at iPad/desktop widths even though its Summary is hidden; phone alone uses space efficiently. | In src/components/admin/marketing/CouponEditor.tsx condition the two-column layout on visible sidebar content, using one column for a blank new coupon and restoring the summary column once a discount exists. |
| Accessibility | 8 | All villas / Choose villas raw radio labels are min-h-10 (40px), with no coarse-pointer 44px override. | In src/components/admin/marketing/CouponEditor.tsx change both villa-scope radio labels to min-h-11 and add has-[:focus-visible]:ring-2/rounded-md around the complete hit area. |

Screen mean: 8.40/10.

### Marketing dashboard (`extra-marketing-dashboard-ipad.png`, `extra-marketing-dashboard-phone.png`, `ux-p8-dashboard-desktop.png`)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Net collected is the hero; other KPIs are subordinate and definitions move to information controls. | — |
| Typography | 9 | 40px hero and 28px secondary values use sans/tabular numbers, with one-line 13px hints. | — |
| Layout & spacing | 9 | Max-w-7xl caps desktop; hero aligns to the two-row metric group; chart is a separate Card. | — |
| Consistency | 9 | Shared Stat and Card primitives standardize KPI styling. | — |
| Color & contrast | 9 | Chart colors encode source categories and have labels/table equivalents; money and muted text are readable. | — |
| Efficiency | 8 | On phone, tracking composition fills most of the first screen; finding conversion, ROAS or the trend requires substantial scrolling. | In src/components/admin/marketing/dashboard/DashboardTiles.tsx collapse the tracking breakdown on phone behind “Tracking breakdown”; keep net collected and the Business total line visible, with a jump-to-chart action. |
| Clarity | 9 | Business total is separated from tracked links; info controls explain ROAS, session and attribution definitions. | — |
| States & feedback | 9 | Loading, first-run, empty range, failed refresh retaining old data, incomplete read and non-THB exclusions have explicit copy and recovery. | — |
| Responsive | 8 | Only two of five secondary KPIs are fully visible at 844px, while the tracking breakdown consumes a large hero card; the phone lacks a compact overview. | In src/components/admin/marketing/dashboard/DashboardTiles.tsx use a compact phone hero and a disclosure for its tracking bar/three-row legend; retain full expanded 5-column composition on iPad/desktop. |
| Accessibility | 9 | Stat InfoTips have expanded touch regions; chart has a textual summary, table data, labelled series toggles and keyboard focus. | — |

Screen mean: 8.80/10.

## Visual bugs and capture limits

- **Overlap:** `extra-staff-calendar-ipad.png`, `extra-staff-calendar-phone.png`: red current-time line crosses Ken Tanaka’s appointment title. See Staff calendar / Layout & spacing.
- **Clipping/truncation:** `extra-staff-calendar-phone.png`: Thai massage service detail clips inside the narrow appointment cell; two of four resource columns are outside the visible area without a clear continuation cue.
- **Truncation:** `extra-hotel-calendar-phone.png`: guest/villa identities collapse to “M…”, “Somchai Pras…” and “Lagoon …”. The tiny month representation prevents identification at a glance.
- **Faint text:** `extra-hotel-calendar-ipad.png`, `extra-hotel-calendar-phone.png`: outside-month dates use half-opacity muted text. Remove the opacity reduction and distinguish outside dates by surface instead.
- **Truncation:** `extra-line-open-ipad.png`: subtitle ends “Not sched…”. Phone variants `extra-line-open-phone.png` and `ux-p2-phone-line-open.png` show the same information completely, demonstrating the rail-specific squeeze.
- **Truncation:** `extra-chats-ipad.png`: ordinary guest names and villa names truncate in the list. `extra-chats-phone.png`, `ux-p6-phone-chat.png`: villa header cuts to “Tideglass Pool Resid…”.
- **Truncation:** `extra-missing-information-phone.png`: each resolve selector displays “Resolve…” because its text and chevron compete within the narrow action column.
- **Faint disabled action with hidden prerequisite:** `ux-p4-ipad-manager-refund.png`: Record refund is pale because it is disabled and no visible Reason label explains the prerequisite. Do not “fix” this by enabling the button without a reason. Add the visible label/hint; inactive-control contrast is exempt from WCAG text contrast.
- **Spacing/alignment:** `extra-new-coupon-ipad.png`: permanently reserved blank summary column leaves the form and Save & publish far apart before a discount exists. This is a layout defect, not an absent Summary feature request.
- **Navigation discoverability:** `extra-settings-business-phone.png`, `extra-settings-team-phone.png`, `ux-p7-team-phone.png`: Email/Channels are beyond the horizontal tab row without an obvious scroll affordance; source does permit horizontal scrolling, so they are hidden, not inaccessible.
- **Not counted as overlap:** `extra-checkout-start-phone.png`, `ux-p1-phone-cashier-till.png`: the fixed order pill visually covers part of the next catalog tile in the still, but CatalogPane supplies pb-28/scroll-pb-28. Content is designed to scroll above it. `ux-p5-new-booking-phone.png` cuts the coupon label at the form scroll boundary, but code makes the footer a separate sibling; this capture alone does not establish a sticky-footer overlap. Business settings and dashboard captures also end mid-scroll; below-fold content is not automatically clipping.
- No additional overlap or misalignment was visible in the remaining supplied images. No phone refund, phone split, phone approvals, iPad new-booking or wide Orders capture is supplied; code review cannot certify their visual result. Keyboard-open, zoomed text, live failure and focus-state screenshots were not supplied.

## Coverage inventory

All entries below were opened as images. Dimensions are read from the PNG headers. The “desktop missing” and every `-ipad` capture are 1180×820; Business desktop is a 1280×1173 full-page capture; dashboard desktop is 1440×900. Every phone capture is 390×844.

| Screenshot | Dimensions | Screen |
| --- | --- | --- |
| extra-checkout-start-ipad.png | 1180×820 | Checkout catalog / cashier till |
| extra-checkout-start-phone.png | 390×844 | Checkout catalog / cashier till |
| ux-p1-phone-cashier-till.png | 390×844 | Checkout catalog / cashier till |
| extra-line-open-ipad.png | 1180×820 | Order line editor |
| extra-line-open-phone.png | 390×844 | Order line editor |
| ux-p2-phone-line-open.png | 390×844 | Order line editor |
| extra-cash-panel-ipad.png | 1180×820 | Cash payment |
| extra-cash-panel-phone.png | 390×844 | Cash payment |
| ux-p3-phone-cash-1500.png | 390×844 | Cash payment |
| ux-p3-ipad-split.png | 1180×820 | Split payment |
| ux-p2b-phone-orders.png | 390×844 | Orders drawer |
| extra-receipt-ipad.png | 1180×820 | Receipt |
| extra-receipt-phone.png | 390×844 | Receipt |
| ux-p4-phone-manager-receipt.png | 390×844 | Receipt |
| ux-p4-ipad-manager-refund.png | 1180×820 | Inline refund |
| ux-p1-ipad-manager-approvals.png | 1180×820 | Manager approvals |
| ux-p5-new-booking-phone.png | 390×844 | New booking |
| extra-stay-sheet-ipad.png | 1180×820 | Stay sheet |
| extra-stay-sheet-phone.png | 390×844 | Stay sheet |
| ux-p5-stay-sheet-ipad.png | 1180×820 | Stay sheet |
| extra-appointment-sheet-ipad.png | 1180×820 | Appointment sheet |
| extra-appointment-sheet-phone.png | 390×844 | Appointment sheet |
| extra-hotel-calendar-ipad.png | 1180×820 | Hotel calendar |
| extra-hotel-calendar-phone.png | 390×844 | Hotel calendar |
| extra-staff-calendar-ipad.png | 1180×820 | Staff calendar |
| extra-staff-calendar-phone.png | 390×844 | Staff calendar |
| extra-chats-ipad.png | 1180×820 | Chats |
| extra-chats-phone.png | 390×844 | Chats |
| ux-p6-phone-chat.png | 390×844 | Chats |
| extra-missing-information-ipad.png | 1180×820 | Missing information |
| extra-missing-information-phone.png | 390×844 | Missing information |
| ux-p6-desktop-missing.png | 1180×820 | Missing information |
| extra-settings-business-ipad.png | 1180×820 | Business settings |
| extra-settings-business-phone.png | 390×844 | Business settings |
| ux-p7-business-desktop.png | 1280×1173 | Business settings |
| extra-settings-team-ipad.png | 1180×820 | Team settings |
| extra-settings-team-phone.png | 390×844 | Team settings |
| ux-p7-team-phone.png | 390×844 | Team settings |
| extra-new-coupon-ipad.png | 1180×820 | New coupon |
| extra-new-coupon-phone.png | 390×844 | New coupon |
| ux-p8-new-coupon-phone.png | 390×844 | New coupon |
| extra-marketing-dashboard-ipad.png | 1180×820 | Marketing dashboard |
| extra-marketing-dashboard-phone.png | 390×844 | Marketing dashboard |
| ux-p8-dashboard-desktop.png | 1440×900 | Marketing dashboard |

## Below 9

Sorted by practical impact: money-action ambiguity/retry integrity, lost work and inaccessible controls, phone task completion, then navigation/copy/type/surface polish. Each tuple is a separate category deduction, even when one implementation can resolve several.

1. **Split payment — Clarity — 6/10.** In src/components/checkout/PayPanel.tsx SplitForm label the computed last row “Auto balance”; change the hero to “Remaining on PromptPay” using the final tender’s method, with “Included in payment 2” underneath. Keep the 28px amber remainder and Over by validation so the house treatment stays intact.
2. **Inline refund — States & feedback — 7/10.** In src/components/checkout/RefundForm.tsx snapshot amount, method and reason for the first submitted attempt; on uncertain response disable all three edits and show “Retry same refund”. Retain the original idempotency key and all caps/approval checks.
3. **Inline refund — Clarity — 7/10.** In src/components/checkout/RefundForm.tsx add “Record money already returned to the guest”; give ReasonField a visible “Reason (required)” label and an inline “Choose or enter a reason to continue” hint. Use PromptPay instead of QR.
4. **Hotel calendar — Responsive — 6/10.** In src/components/admin/AdminBookingsView.tsx provide a phone list with full guest, villa, dates and balance rows below the four KPIs; use the existing agenda view and keep month optional.
5. **Staff calendar — Layout & spacing — 7/10.** In src/components/reui/event-calendar/event-calendar-time-grid.tsx lower the now-indicator below event text/cards (currently z-40) and keep its time dot in the gutter; ensure event surfaces mask the line.
6. **Appointment sheet — Accessibility — 7/10.** In src/components/admin/AppointmentFinancials.tsx replace the disabled ButtonLink with a disabled Button (or remove href and intercept keyboard activation); restore the link when enabled.
7. **Staff calendar — Responsive — 6/10.** In src/components/admin/AdminStaffBookingsView.tsx use a phone agenda/one-staff day view with a compact header and viewport-fitting scroll area; retain the four-column resource grid at iPad width.
8. **Stay sheet — States & feedback — 8/10.** In src/components/admin/BookingSheet.tsx retain the per-booking notes draft or intercept every close route when notesChanged with “Discard unsaved notes?”; do not alter note revision checks.
9. **Appointment sheet — States & feedback — 8/10.** In src/components/admin/AppointmentSheet.tsx propagate edit dirty/saving state to the sheet, preserve the draft or confirm discard on all close routes, and prevent dismiss while saving.
10. **Hotel calendar — Accessibility — 6/10.** In src/components/reui/event-calendar/event-calendar-month-view.tsx give more triggers and day-detail entry points 44px hit areas; use min-h-11 tappable rows in the phone agenda instead of enlarging overlapping month bars.
11. **Missing information — Accessibility — 6/10.** In src/components/admin/admin-bulk.tsx wrap SelectCheckbox in a labelled size-11 hit region with the 16–20px input centered; in MissingInformationPanel.tsx give Open chat min-h-11 inline-flex and a visible focus ring.
12. **New booking — Accessibility — 7/10.** In src/components/admin/NewBookingDialog.tsx give these labels and suggestion buttons min-h-11; add a visible focus ring to the complete labelled checkbox row.
13. **Staff calendar — Accessibility — 7/10.** In src/components/admin/AdminCalendarHeader.tsx add pointer-coarse:min-h-11/min-w-11 to view buttons; in AdminStaffBookingsView.tsx make Show all and every filter label min-h-11 with a row focus indicator.
14. **Business settings — States & feedback — 7/10.** In src/components/admin/AdminSettingsView.tsx lift section drafts into the parent or guard setTab and beforeunload while dirty. Show “Unsaved changes” in the dirty Save bar and retain expectedRevision checks.
15. **New booking — States & feedback — 8/10.** In src/components/admin/NewBookingDialog.tsx store a phone-specific error, render it under PhoneInput with aria-invalid/aria-describedby, and focus/scroll nb-phone on failed validation.
16. **Team settings — States & feedback — 7/10.** In src/components/admin/TeamSettings.tsx expose rules dirty state to AdminSettingsView.tsx, retain the draft across tabs or guard discard, and add beforeunload while dirty. Preserve rules.revision checks.
17. **Split payment — States & feedback — 8/10.** In src/components/checkout/PayPanel.tsx SplitForm add an inline aria-live validation message: “Enter an amount above ฿0 for payment 1” or “Leave an amount for the final payment, or use a single payment.” Keep positive-amount checks.
18. **Manager approvals — States & feedback — 8/10.** In src/components/checkout/ApprovalsPanel.tsx ApprovalItem compute expired = now >= request.expiresAt, show “Expired · cashier must request again”, and disable both decisions; keep server revision/expiry verification.
19. **Chats — Layout & spacing — 8/10.** In src/components/admin/AdminSessionActions.tsx use flex-wrap with a w-full error row, or return the error into a separate header strip below the action group.
20. **Order line editor — Clarity — 7/10.** In src/components/checkout/OrderPanel.tsx DiscountField, make “without approval” visible, change placeholder to “10% or ฿120”, and retain the larger-discount manager-request flow.
21. **Chats — States & feedback — 8/10.** In src/components/admin/AdminSessionActions.tsx place action errors below the tools in a full-width role=alert region; retain the active chat and provide a Retry action where safe.
22. **Orders drawer — States & feedback — 8/10.** In src/components/checkout/OrderStrip.tsx OrderNumberLookup validate a positive safe integer before submission, show an inline error for 0/invalid input, and add “Check the order number or choose an open order above” to unavailable copy.
23. **New coupon — Efficiency — 7/10.** In src/components/admin/marketing/CouponEditor.tsx add a visible % / ฿ ToggleGroup beside the numeric discount field (or a % insertion button) and retain the existing parser, limits and publish review.
24. **Orders drawer — Clarity — 7/10.** In src/components/checkout/OrderStrip.tsx use cashier-specific intro: “Open orders, latest first. For today’s receipts, enter the order number below.” Label lookup “Order number shown on the receipt”. Keep cashier access limits.
25. **Hotel calendar — Color & contrast — 7/10.** In src/components/admin/AdminBookingsView.tsx monthDayNumber remove /50 from outside-day text; de-emphasize via bg-muted/30 and font-normal while keeping text-muted-foreground.
26. **Team settings — Clarity — 7/10.** In src/components/admin/TeamSettings.tsx inviteState change copy to “Invite expires 26 Nov” (include year when needed), and retain “Invite expired” for expired grants.
27. **Hotel calendar — Efficiency — 7/10.** In src/components/admin/AdminBookingsView.tsx default phones without a remembered choice to List/agenda; retain Month as an explicit view and keep remembered-view behavior.
28. **Staff calendar — Efficiency — 7/10.** In src/components/admin/AdminStaffBookingsView.tsx default phone to agenda or a one-staff picker; if resource view is selected, add “Swipe to see 2 more staff” and explicit next/previous staff controls.
29. **Cash payment — Clarity — 7/10.** In src/components/checkout/PayPanel.tsx render a ghost “Back to order” action for single-tender modes as well as split, disabled while submitting.
30. **Cash payment — Consistency — 8/10.** In src/components/checkout/PayPanel.tsx, make onPick of the active tender a no-op and provide a labelled Back to order control; preserve attempt-key lifetimes when leaving.
31. **New coupon — Clarity — 8/10.** In src/components/admin/marketing/CouponEditor.tsx label the numeric unit with a % / ฿ control and replace placeholder with “Amount”; show “20% off” or “฿500 off” beside the field before saving.
32. **New coupon — Accessibility — 8/10.** In src/components/admin/marketing/CouponEditor.tsx change both villa-scope radio labels to min-h-11 and add has-[:focus-visible]:ring-2/rounded-md around the complete hit area.
33. **Appointment sheet — Efficiency — 8/10.** In src/components/admin/AppointmentSheet.tsx make the Villa stay row an “Open stay” button opening BookingSheet for bookingId, preserving its access checks.
34. **Appointment sheet — Clarity — 8/10.** In src/components/admin/AppointmentSheet.tsx replace that value with the linked villa and booking reference (with a loading/removed fallback), using the existing bookingId.
35. **Missing information — Clarity — 8/10.** In src/components/admin/MissingInformationPanel.tsx add a visible “Status” label, use “Use a fact” and a short “Choosing a fact resolves this report · Undo available” hint in the picker.
36. **Marketing dashboard — Responsive — 8/10.** In src/components/admin/marketing/dashboard/DashboardTiles.tsx use a compact phone hero and a disclosure for its tracking bar/three-row legend; retain full expanded 5-column composition on iPad/desktop.
37. **Staff calendar — Clarity — 8/10.** In src/components/admin/AdminStaffBookingsView.tsx renderEvent off branch add visible “Not working” text or a labelled hatch, and add the same entry to the footer legend.
38. **Split payment — Consistency — 8/10.** In src/components/checkout/PayPanel.tsx SplitForm render TENDER_LABELS[method].short without the QR substitution; use the same PromptPay wording in RefundForm.tsx.
39. **Stay sheet — Efficiency — 8/10.** In src/components/admin/BookingSheet.tsx render tel: and mailto: anchors in the Phone/Email Detail rows, with min-h-11 inline-flex and focus-visible:ring-2; keep a copy option for shared desk devices.
40. **Marketing dashboard — Efficiency — 8/10.** In src/components/admin/marketing/dashboard/DashboardTiles.tsx collapse the tracking breakdown on phone behind “Tracking breakdown”; keep net collected and the Business total line visible, with a jump-to-chart action.
41. **Staff calendar — Hierarchy — 8/10.** In src/components/admin/AdminCalendarHeader.tsx compact date navigation and view into two phone rows; in AdminStaffBookingsView.tsx move Show cancelled into Filters and keep New appointment beside the date.
42. **Chats — Responsive — 8/10.** In src/components/admin/ChatsView.tsx restructure the list’s metadata onto its own row; in AdminSessionDetail.tsx make the identity block full-width below the tool row when needed instead of truncating property.
43. **Missing information — Responsive — 8/10.** In src/components/admin/MissingInformationPanel.tsx align the action row with the question by removing redundant max-lg:pl-7, keep Create fact beside it, and reserve min-w-[8rem] for Use a fact.
44. **Business settings — Responsive — 8/10.** In src/components/admin/SegmentedTabs.tsx add a right-edge scroll affordance/chevron when overflow exists (using scrollWidth/clientWidth); alternatively expose a phone “Settings section” select in AdminSettingsView.tsx.
45. **Team settings — Responsive — 8/10.** In src/components/admin/SegmentedTabs.tsx add an overflow arrow/edge affordance and ensure the selected tab scrolls into view; reuse the Business settings solution.
46. **New coupon — Responsive — 8/10.** In src/components/admin/marketing/CouponEditor.tsx condition the two-column layout on visible sidebar content, using one column for a blank new coupon and restoring the summary column once a discount exists.
47. **Hotel calendar — Typography — 7/10.** In src/components/admin/AdminBookingsView.tsx use List on phones with text-[15px] guest names and separate 12px villa/date metadata; in retained month mode use text-xs overflow labels.
48. **Staff calendar — Typography — 7/10.** In src/components/admin/AdminStaffBookingsView.tsx render phone appointments as text-[15px] guest plus a wrapping text-xs service/time row in agenda mode; retain concise grid chips for iPad.
49. **Chats — Typography — 7/10.** In src/components/admin/ChatsView.tsx give visitor name its own full-width text-[15px] row and move property below it; in AdminSessionDetail.tsx let the property line wrap to two lines on narrow screens.
50. **Missing information — Typography — 8/10.** In src/components/admin/MissingInformationPanel.tsx use a short visible placeholder “Use a fact” and preserve the full aria-label; give the trigger min-w-[8rem] with readable text-xs or text-sm.
51. **Split payment — Typography — 8/10.** In src/components/checkout/PayPanel.tsx SplitForm, replace text-[11px] with text-xs (or text-sm) and allow each method group a full-width row if needed.
52. **Order line editor — Responsive — 8/10.** In src/components/checkout/OrderPanel.tsx OrderLine, wrap metadata or move “Not scheduled” into its own chip beneath the title instead of one truncated line.
53. **Order line editor — Typography — 8/10.** In src/components/checkout/OrderPanel.tsx OrderLine, replace the subtitle block truncate text-xs with whitespace-normal text-xs leading-4; allow a second line.
54. **New coupon — Layout & spacing — 8/10.** In src/components/admin/marketing/CouponEditor.tsx apply lg:grid-cols-[minmax(0,1fr)_22rem] only when summary/status/history exists; for an empty new coupon use a centered max-w-3xl form with actions on its right edge.
55. **Staff calendar — Consistency — 8/10.** In src/components/admin/AdminStaffBookingsView.tsx replace the outer border bg-card div with Card (rounded-xl) and overflow-hidden; preserve internal grid dividers.

Overall average: **8.56/10** (1626 ÷ 190).
