# Independent UX/UI scorecard — round 2

Reviewed detached `ux/integration` at `accf8b60be4ca860a11763721cf1aa86251fe71e` (2026-11-14). Read only the requested rubric and visual brief in `docs/reviews/ux-audit/`; no other files in that directory were read. All 50 PNGs in `docs/screenshots/audit-r2/` were opened and visually inspected individually. Grouped into 19 screens, with phone/iPad/desktop variants scored together. A 9 means shippable with at most a nit; averaging does not override a below-9 category.

Method: screenshot review plus static component/state review in checkout, desk sheets/calendars/chats, settings, marketing, shared UI and the unsaved-change hook. Read `tests/browser/now-screenshots.spec.ts` and all three touch-target specs to understand scenes, touch assumptions and measurement coverage. These tests were not executed and no live browser/Convex environment was started. Accessibility scores credit explicit code evidence (labels, focus, target classes and alternate calendar day cells); they are not a claim of a fresh runtime touch census or complete assistive-technology/contrast certification. In particular, approvals has only an iPad capture and Orders only a phone capture; their other-size judgement is code-based. Ordinary scrollable content is not called inaccessible merely because it is below the screenshot edge. All recommended changes retain approvals, permissions, revision checks and attempt keys.

### Checkout catalog (extra-checkout-start-ipad.png, extra-checkout-start-phone.png, ux-p1-phone-cashier-till.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Search, products and the order summary form a clear selling flow. | — |
| Typography | 9 | 15px item names, subdued duration and sans tabular prices are legible. | — |
| Layout & spacing | 9 | Two iPad columns and a single phone column align; the fixed order bar has pb-28 clearance in CatalogPane. | — |
| Consistency | 9 | Product cards, field outlines and category tabs repeat consistently. | — |
| Color & contrast | 9 | Navy actions, dark body text and restrained gold add affordances are clear. | — |
| Efficiency | 9 | Whole product cards add an item; the populated phone bar opens cash directly. | — |
| Clarity | 9 | Item names, durations and View order explain the available action. | — |
| States & feedback | 9 | CatalogPane has labelled loading skeletons and search/category empties; CheckoutView repeats write errors inside the phone sheet. | — |
| Responsive | 9 | Phone has a thumb-reachable order bar; iPad keeps the catalog and order side by side. | — |
| Accessibility | 9 | Catalog tiles are large buttons; search and icon actions are named; focus and coarse-pointer sizing are defined. | — |

Average: **9.00/10**. Meets 9+ in every category.

### Manager approvals (ux-p1-ipad-manager-approvals.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | The request, requested reduction and Approve are easy to locate. | — |
| Typography | 9 | 15px service title, 14px reason and tabular before/after totals read cleanly. | — |
| Layout & spacing | 9 | The compact request card uses its sheet width without stretching its copy. | — |
| Consistency | 9 | Card and outline/primary decision buttons match shared primitives. | — |
| Color & contrast | 9 | Neutral context and dark approval action keep emphasis controlled. | — |
| Efficiency | 9 | A manager can decide directly with the reason and amount in view. | — |
| Clarity | 9 | The named staff member, reason, totals and expiry explain the request. | — |
| States & feedback | 9 | ApprovalsPanel has loading, empty, per-request error and decision announcements; last decision returns to the prior view with a toast. | — |
| Responsive | 9 | The sheet is w-full on phone and sm:max-w-md on larger screens; only the iPad capture is supplied. | — |
| Accessibility | 9 | Title receives initial focus; close and decision buttons use touch sizing and accessible names. | — |

Average: **9.00/10**. Meets 9+ in every category.

### Order line editor (extra-line-open-ipad.png, extra-line-open-phone.png, ux-p2-phone-line-open.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | The current item and balance remain clear above the payment choices. | — |
| Typography | 9 | Money is sans/tabular; the label/control rows have a coherent scale. | — |
| Layout & spacing | 8 | On iPad, the editor is cut immediately after Price; Remove item and History are outside the visible row scroller. | F14: In src/components/checkout/OrderPanel.tsx make the iPad item scroller tall enough for header + four 48px editor rows (about 20rem at this fixture), or compact secondary tender actions into one row at this panel width. Preserve every method; show a bottom fade/`More item options` cue whenever content still overflows so Remove item is discoverable. |
| Consistency | 9 | Discount, Schedule and Price use a consistent inset settings list. | — |
| Color & contrast | 9 | Not scheduled has both amber styling and readable text; destructive removal is labelled. | — |
| Efficiency | 8 | The payment footer consumes almost half of the iPad order panel and hides the final item action. | F15: In src/components/checkout/OrderPanel.tsx make the iPad item scroller tall enough for header + four 48px editor rows (about 20rem at this fixture), or compact secondary tender actions into one row at this panel width. Preserve every method; show a bottom fade/`More item options` cue whenever content still overflows so Remove item is discoverable. |
| Clarity | 9 | Discount limit, schedule state and price are explicit. | — |
| States & feedback | 7 | LineEditor holds unsaved price/reason locally and unmounts on collapse; sheet dismissal is not draft-guarded. | F02: In src/components/checkout/OrderPanel.tsx lift LineEditor's price/reason draft (or report dirty upward), and guard item collapse, row changes and phone sheet close through confirmDiscard. Retain the draft on cancelled dismissal; keep approval/revision checks. |
| Responsive | 8 | Phone shows the full editor, while the same default iPad scene conceals its final row. | F16: In src/components/checkout/OrderPanel.tsx make the iPad item scroller tall enough for header + four 48px editor rows (about 20rem at this fixture), or compact secondary tender actions into one row at this panel width. Preserve every method; show a bottom fade/`More item options` cue whenever content still overflows so Remove item is discoverable. |
| Accessibility | 9 | Inputs and icon actions are named; OrderPanel has visible focus styles and inherited 44px coarse-pointer targets. | — |

Average: **8.50/10**. Does not meet the every-category target.

### Orders (ux-p2b-phone-orders.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | The current/open orders lead, followed by lookup. | — |
| Typography | 9 | Order identifiers and totals are well weighted and prices align. | — |
| Layout & spacing | 9 | The bottom sheet fits two rows and the lookup without crowding. | — |
| Consistency | 9 | Rows, chevrons, input and button match checkout controls. | — |
| Color & contrast | 9 | Disabled Go is visibly muted, with a clear field boundary. | — |
| Efficiency | 9 | Open orders are one tap away; a numeric order lookup supports older sales. | — |
| Clarity | 8 | The description promises finding receipts by number, but the input accepts an order number and rejects R-prefixed receipt numbers. | F34: In src/components/checkout/OrderStrip.tsx change the sheet description to `Open orders · find a paid order by its order number (#).` Keep the input label Order number and the explicit R-prefixed receipt-number correction. |
| States & feedback | 9 | OpenOrdersList and OrderLookup cover loading, no results, validation, unavailable orders, paged loading and retry boundaries. | — |
| Responsive | 9 | The list is bounded by max-h-[50dvh] and scrolls; wider sheet layout is supported in code but not pictured. | — |
| Accessibility | 9 | Rows have descriptive accessible names and aria-current; lookup error is associated with the field. | — |

Average: **8.90/10**. Does not meet the every-category target.

### Cash payment (extra-cash-panel-ipad.png, extra-cash-panel-phone.png, ux-p3-phone-cash-1500.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Balance due, received cash, change and Confirm form a clear sequence. | — |
| Typography | 9 | 40px due and 32px change use sans tabular figures. | — |
| Layout & spacing | 9 | Exact cash is compact; the change block expands the sheet naturally. | — |
| Consistency | 9 | Tender selection and quick amounts use clear pressed states. | — |
| Color & contrast | 9 | Selected tender is dark; green change is labelled Change, and a shortfall is amber with text. | — |
| Efficiency | 10 | Exact is prefilled; common note amounts take one tap; focus selects the full input. | — |
| Clarity | 9 | Cash received and Confirm cash are short and explicit. | — |
| States & feedback | 9 | PayPanel handles short cash, submitting, changed orders, coupon refusal and same-attempt retries without double recording. | — |
| Responsive | 9 | The panel self-sizes on iPad; phone has keyboard-aware scrolling and a short-viewport sticky confirmation. | — |
| Accessibility | 9 | Fields are labelled, status changes are announced, payment controls are disabled in flight and Escape returns focus. | — |

Average: **9.10/10**. Meets 9+ in every category.

### Split payment (extra-split-ipad.png, extra-split-phone.png, ux-p3-ipad-split.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Due stays prominent and the final confirmation states the split amounts. | — |
| Typography | 9 | Totals and amount fields use sans tabular numerals. | — |
| Layout & spacing | 9 | Rows stack cleanly with generous amounts and method targets. | — |
| Consistency | 8 | The main tender track selects with black pills, while each payment method uses a pale outlined rectangle for the same selection job. | F31: In src/components/checkout/PayPanel.tsx replace SplitForm's custom outlined method row with ui/toggle-group.tsx `variant="segmented" tone="strong"`, the same rounded-full muted track, h-11 touch items and selected bg-foreground/text-background used for the top tender selector. |
| Color & contrast | 9 | Coverage has a check and text; overpayment uses an explicit error. | — |
| Efficiency | 9 | Typing one amount calculates the final payment automatically. | — |
| Clarity | 9 | Payment 1, Payment 2 and the confirmation make the allocation understandable. | — |
| States & feedback | 9 | Empty amounts explain why confirm is disabled; overage, coverage and same-attempt retries are handled. | — |
| Responsive | 9 | Phone retains all two-payment controls; container queries adapt narrower rows and added rows scroll. | — |
| Accessibility | 9 | Methods expose aria-pressed; amount labels/errors are linked; remove buttons are named and 44px. | — |

Average: **8.90/10**. Does not meet the every-category target.

### Receipt (extra-receipt-ipad.png, extra-receipt-phone.png, ux-p4-phone-manager-receipt.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Receipt identity and New sale lead; item management is distinct from the paper. | — |
| Typography | 9 | Paper metadata is mono, with the main monetary columns explicitly sans/tabular. | — |
| Layout & spacing | 9 | Paper and Items are separated on iPad and stacked on phone. | — |
| Consistency | 9 | Card radius, print outline and primary New sale are consistent. | — |
| Color & contrast | 9 | Paid and Not scheduled use text with semantic tones. | — |
| Efficiency | 9 | Print, new sale, appointment linking and refunds are directly available. | — |
| Clarity | 9 | Issued receipt and editable post-payment actions are clearly separate. | — |
| States & feedback | 8 | ReceiptView guards refund drafts, but AfterPayment LinkDialog/UnlinkDialog close without checking a typed reason or changed selection. | F04: In src/components/checkout/AfterPayment.tsx give LinkDialog and UnlinkDialog a dirty guard for reason/selection/notify edits; route Escape, overlay, Cancel and Back through confirmDiscard. Keep the same attempt key on retries. |
| Responsive | 9 | Both layouts keep screen actions off the receipt paper; the Items list has bounded iPad scrolling. | — |
| Accessibility | 9 | Print/More/refund actions are named; notifications receive focus and use status semantics. | — |

Average: **8.90/10**. Does not meet the every-category target.

### Refund (extra-refund-ipad.png, extra-refund-phone.png, ux-p4-ipad-manager-refund.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Selected line and its Refund form remain together. | — |
| Typography | 9 | Labels and typed amounts maintain the UI/money scale. | — |
| Layout & spacing | 9 | The inline form remains inside Items; the iPad card scrolls rather than covering receipt paper. | — |
| Consistency | 9 | Amount presets, method buttons and reason chips have coherent grouped styling. | — |
| Color & contrast | 9 | The submit becomes destructive-outline when ready; selected options stay readable. | — |
| Efficiency | 9 | All, original tender and reason chips reduce typing. | — |
| Clarity | 9 | Records money already returned to the guest accurately explains the operation. | — |
| States & feedback | 8 | Cancel/New sale and page unload guard refundDirty, but shared useUnsavedGuard does not intercept same-document history navigation. | F05: In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| Responsive | 9 | Phone reveals the selected line/form by scrolling; iPad bounds the Items panel. The tight lower edge is a nit, not proof of an inaccessible action. | — |
| Accessibility | 9 | Form heading receives focus; method/amount/reason groups are labelled, errors are announced and controls have 44px targets. | — |

Average: **8.90/10**. Does not meet the every-category target.

### New booking (extra-new-booking-ipad.png, extra-new-booking-phone.png, ux-p5-new-booking-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Stay, Guest, Price and the footer total provide a sensible order. | — |
| Typography | 9 | Serif dialog title, restrained field labels and sans total are coherent. | — |
| Layout & spacing | 8 | The fixed scroller/footer split slices the Price card on phone; even iPad hides the coupon on initial open. | F17: In src/components/admin/NewBookingDialog.tsx render the optional Custom price toggle as a compact 48px settings row, move its rate caption inline, and place Coupon code directly in the Price group. On iPad ensure the initial scroller shows both rows; keep the fixed footer and continuation indicator on phone. |
| Consistency | 9 | Date fields, picker, switch and section titles share the system. | — |
| Color & contrast | 9 | Disabled Create booking is explained with readable text rather than color alone. | — |
| Efficiency | 8 | The optional Custom price surface occupies the initial Price area while the common coupon input needs a nested scroll. | F18: In src/components/admin/NewBookingDialog.tsx render the optional Custom price toggle as a compact 48px settings row, move its rate caption inline, and place Coupon code directly in the Price group. On iPad ensure the initial scroller shows both rows; keep the fixed footer and continuation indicator on phone. |
| Clarity | 9 | Names, dates, guests and missing-contact guidance are plain. | — |
| States & feedback | 8 | Availability/coupon failures and local close guards exist; browser Back/Forward bypasses the shared draft hook. | F06: In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| Responsive | 9 | Check-in/out remain side by side; the footer never overlays fields and the continuation message acknowledges scrolling. | — |
| Accessibility | 9 | Fields are explicitly labelled; phone errors are associated; dialog focus trapping and 44px picker/switch targets are defined. | — |

Average: **8.70/10**. Does not meet the every-category target.

### Stay details (extra-stay-sheet-ipad.png, extra-stay-sheet-phone.png, ux-p5-stay-sheet-ipad.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Guest identity, status and balance precede stay details. | — |
| Typography | 9 | Money is sans/tabular and key-value rows have fixed 96px labels. | — |
| Layout & spacing | 8 | Phone payment actions wrap into an accidental-looking second line, with the info icon detached beside the secondary text. | F19: In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| Consistency | 9 | Header actions and detail cards follow the appointment sheet pattern. | — |
| Color & contrast | 9 | Status and financial amounts have readable labels and contrast. | — |
| Efficiency | 9 | Payment and editing are direct; contact fields are tappable. | — |
| Clarity | 8 | Paid elsewhere… reads like an existing state although it opens a recording form. | F23: In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx rename `Paid elsewhere…` to `Record external payment…`; keep the explanatory InfoTip and existing payment-recording safeguards. |
| States & feedback | 7 | Notes have a close guard, but Take payment calls openCheckout then router.push without consulting the dirty-notes guard. | F01: In src/components/admin/BookingSheet.tsx pass the dirty-notes confirmDiscard callback into BookingFinancials.tsx; call it before takePayment/openCheckout (before creating/opening an order). Keep notes if declined. Also cover history traversal in src/hooks/use-unsaved-guard.tsx. |
| Responsive | 8 | iPad payment actions share a row; phone wraps them without a deliberate compact arrangement. | F20: In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| Accessibility | 9 | Edit/More/Close are named; telephone/email links have 44px activation height; focus styles and status text exist. | — |

Average: **8.50/10**. Does not meet the every-category target.

### Appointment details (extra-appointment-sheet-ipad.png, extra-appointment-sheet-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Guest, arrival action, due and service details are easy to scan. | — |
| Typography | 9 | Sans monetary hero and muted key-value labels follow the scale. | — |
| Layout & spacing | 8 | The phone money card repeats the wrapped secondary-action/info-icon row and adds unnecessary vertical weight. | F21: In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| Consistency | 9 | The sheet header and detail rows match Stay details. | — |
| Color & contrast | 9 | Booked and money states include readable text; Mark arrived recedes as outline. | — |
| Efficiency | 9 | Arrival, payment, edit and related stay are direct. | — |
| Clarity | 8 | Paid elsewhere… does not name the write action that follows. | F24: In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx rename `Paid elsewhere…` to `Record external payment…`; keep the explanatory InfoTip and existing payment-recording safeguards. |
| States & feedback | 8 | Loading money skeletons and mutation feedback exist; edited appointment drafts still rely on a hook that misses history navigation. | F07: In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| Responsive | 8 | The 96px detail labels fit, but the phone money action area needs an intentional stack or compact row. | F22: In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| Accessibility | 9 | Named icon controls, labelled edit inputs and 44px contact links are present. | — |

Average: **8.60/10**. Does not meet the every-category target.

### Hotel calendar (extra-hotel-calendar-ipad.png, extra-hotel-calendar-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Today's four counters and New booking are prominent. | — |
| Typography | 9 | Day numbers, bar names and tabular KPI amounts have suitable scale. | — |
| Layout & spacing | 9 | The wide month grid and phone stay list are deliberately different presentations. | — |
| Consistency | 9 | Calendar toolbar, status chips and Card surface match desk conventions. | — |
| Color & contrast | 9 | Pending uses dashes; paid uses a check; phone statuses have text, reducing reliance on bar color. | — |
| Efficiency | 9 | View switching, date movement and filters are grouped; phone defaults to a usable list. | — |
| Clarity | 9 | Guest, villa, arrival/departure phase and due are explicit in phone rows. | — |
| States & feedback | 9 | Loading bookings, no stays/new-booking action, move failure and read-only notices are implemented. | — |
| Responsive | 9 | The 4-up phone strip is compact; iPad uses width for a month grid with internally scrolling rows. | — |
| Accessibility | 9 | Keyboard day cells and labelled controls provide alternatives to compact month bars; full agenda rows are large buttons. | — |

Average: **9.00/10**. Meets 9+ in every category.

### Staff calendar (extra-staff-calendar-ipad.png, extra-staff-calendar-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Staff lanes, date and New appointment organize the day. | — |
| Typography | 9 | Guest/time/service sizes are clear; phone uses a 15px name. | — |
| Layout & spacing | 9 | iPad lanes fill the panel; phone agenda rows avoid compressed lanes. | — |
| Consistency | 9 | Shared calendar toolbar and desk action styles are coherent. | — |
| Color & contrast | 9 | Booked has text on the grid; non-default agenda statuses remain explicit in code and time-off has a hatch. | — |
| Efficiency | 9 | Search, staff filtering and jump-to-next appointment support common desk tasks. | — |
| Clarity | 9 | Name, time, treatment and therapist can be read without opening a phone row. | — |
| States & feedback | 9 | Loading, no-events rendering, action errors and success toast paths are implemented. | — |
| Responsive | 9 | Phone defaults to Agenda, iPad to staff lanes; the blank agenda remainder is ordinary calendar space. | — |
| Accessibility | 9 | Agenda buttons retain natural accessible names, including sr-only Booked; focus rings and coarse-pointer controls are defined. | — |

Average: **9.00/10**. Meets 9+ in every category.

### Chats (extra-chats-ipad.png, extra-chats-phone.png, ux-p6-phone-chat.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | The transcript and bottom composer dominate; the selected conversation is clear. | — |
| Typography | 9 | Message bodies, guest name and timestamps have a consistent scale. | — |
| Layout & spacing | 8 | Four leading/trailing header actions leave a narrow identity column and a three-line phone identity block. | F25: In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| Consistency | 9 | Messages, composer and shared action controls are coherent. | — |
| Color & contrast | 8 | The phone header conveys Needs you as an amber dot with no visible text equivalent. | F26: In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| Efficiency | 9 | The phone composer stays reachable and completion advances to another chat. | — |
| Clarity | 8 | Phone Done names the result vaguely compared with desktop No reply needed; the warning reason is hidden in details. | F27: In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| States & feedback | 8 | Transcript skeletons, reply-window closure, send errors and per-chat drafts exist; history navigation can still bypass the shared unsaved guard. | F08: In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| Responsive | 8 | The phone header consumes 88px and squeezes the property into two lines instead of providing a compact status/identity layout. | F28: In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| Accessibility | 7 | h2 aria-label={guestName} overrides the embedded sr-only status; the remaining status dot is color-only in the visible header. | F03: In src/components/admin/AdminSessionDetail.tsx remove the guest-only h2 aria-label or include status in its accessible name; render status.label as visible 12px text beside/below the name, not just a dot/title. Keep the dot aria-hidden. |

Average: **8.30/10**. Does not meet the every-category target.

### Missing information (extra-missing-information-ipad.png, extra-missing-information-phone.png, ux-p6-desktop-missing.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Questions lead and Resolve/Create fact sit close to them. | — |
| Typography | 9 | 15px questions and 12px metadata distinguish content from context. | — |
| Layout & spacing | 8 | Phone rows expand to about 190–210px partly because Open chat occupies its own third action row. | F29: In src/components/admin/MissingInformationPanel.tsx move phone `Open chat` into the existing More menu (`max-lg`), retain direct access on wide screens, and remove its max-lg col-span-full action row. Keep Resolve/Create fact side by side; target roughly 140–160px mobile rows at these copy lengths. |
| Consistency | 9 | Table on wide screens and stacked rows use the same controls. | — |
| Color & contrast | 9 | Question text and subdued metadata are legible; state is named by the filter. | — |
| Efficiency | 9 | Resolution is one choice with Undo; approved facts are searchable and paginated. | — |
| Clarity | 9 | Question, repetition count and resolution choices have understandable labels. | — |
| States & feedback | 8 | Result skeletons, undo and action errors exist, but ResolveFactPicker has no LoadingFirstPage treatment and can show a premature no-match empty. | F13: In src/components/admin/MissingInformationPanel.tsx handle approvedFacts.status === `LoadingFirstPage` in ResolveFactPicker: show `Loading approved facts…` with role=status and suppress `No matching facts or sources` until the initial page resolves; structured sources can remain available. |
| Responsive | 8 | Resolve and Create fact share a row, but the extra full-width Open chat action prevents a compact phone list. | F30: In src/components/admin/MissingInformationPanel.tsx move phone `Open chat` into the existing More menu (`max-lg`), retain direct access on wide screens, and remove its max-lg col-span-full action row. Keep Resolve/Create fact side by side; target roughly 140–160px mobile rows at these copy lengths. |
| Accessibility | 9 | Selection wrappers, named comboboxes and icon menus have touch and keyboard affordances. | — |

Average: **8.70/10**. Does not meet the every-category target.

### Business settings (extra-settings-business-ipad.png, extra-settings-business-phone.png, ux-p7-business-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Four named groups and section descriptions structure the form. | — |
| Typography | 9 | Serif page title, 15px group headings and muted field labels are coherent. | — |
| Layout & spacing | 9 | Desktop one-third/two-thirds cards and stacked phone cards align cleanly. | — |
| Consistency | 9 | Cards, inputs, optional labels and the compact TimePicker share primitives. | — |
| Color & contrast | 9 | Readable labels and defined field outlines distinguish inputs from surfaces. | — |
| Efficiency | 9 | Common identity/contact values are grouped; time zone is searchable and Save appears when dirty. | — |
| Clarity | 8 | Defaults in use · save once to keep them asks for an action that is unavailable until a value changes. | F12: In src/components/admin/AdminSettingsView.tsx replace `Defaults in use · save once to keep them` with `Default settings are active. Changes are saved when you select Save.` Keep the Save bar dirty-only; do not instruct an unavailable initial save. |
| States & feedback | 8 | Field validation, stale revision handling and saved feedback exist; browser history navigation bypasses the draft guard. | F09: In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| Responsive | 9 | Phone gets one column and a scrollable section strip; desktop is bounded rather than stretched. | — |
| Accessibility | 9 | Labels/errors are linked and controls use shared focus and coarse-pointer sizing. | — |

Average: **8.80/10**. Does not meet the every-category target.

### Team settings (extra-settings-team-ipad.png, extra-settings-team-phone.png, ux-p7-team-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | People and Invite precede cashier rules. | — |
| Typography | 9 | 15px names, 13px emails and compact role text are readable. | — |
| Layout & spacing | 9 | Phone role/action rows wrap deliberately; desktop keeps roles close to Change. | — |
| Consistency | 9 | Cards, rule toggles and row actions follow the system. | — |
| Color & contrast | 8 | Pending Invited is rendered with the same neutral muted pill as active role badges, flattening an actionable lifecycle distinction. | F32: In src/components/admin/TeamSettings.tsx style unclaimed, unexpired invitation chips with `bg-amber-50 text-amber-800 border-amber-200` (and existing dark warning tokens), retaining neutral role badges and danger expiry chips. Use short copy `Invited · 26 Nov`. |
| Efficiency | 9 | Role editors open on demand and changes apply immediately; rule Save is dirty-only. | — |
| Clarity | 9 | Roles, expiry date and rule labels are understandable. | — |
| States & feedback | 8 | Per-person save errors, stale-rule recovery and invite drafts exist; browser history navigation bypasses the shared draft guard. | F10: In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| Responsive | 9 | Phone wraps each role/action row; wide People rows remain compact. | — |
| Accessibility | 9 | Change roles buttons are person-labelled; permission groups and inputs have names; coarse-pointer minimums and focus are defined. | — |

Average: **8.80/10**. Does not meet the every-category target.

### Marketing dashboard (extra-marketing-dashboard-ipad.png, extra-marketing-dashboard-phone.png, ux-p8-dashboard-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Net collected is an unmistakable hero above supporting KPIs. | — |
| Typography | 9 | 40px hero, 28px supporting values and sans tabular money fit the brief. | — |
| Layout & spacing | 9 | The hero spans columns; charts and secondary metrics align within bounded cards. | — |
| Consistency | 9 | Stat/Card, shared segmented controls and on-demand info use one system. | — |
| Color & contrast | 9 | Dark figures and restrained series colors are readable; table access provides exact labelled values. | — |
| Efficiency | 9 | Range/property filters and chart metric switching support quick analysis. | — |
| Clarity | 9 | Tracked results and business total are separated and attribution is labelled. | — |
| States & feedback | 9 | DashboardView distinguishes first-run, empty range, truncated/incomplete data, loading, failed refresh with retained figures and retry. | — |
| Responsive | 9 | Phone uses a full-width hero and 2-up metrics with tracking detail folded; iPad/desktop expose the breakdown. | — |
| Accessibility | 9 | Info tips support touch; chart has a focusable summary and a data table; controls have names and 44px touch treatment. | — |

Average: **9.00/10**. Meets 9+ in every category.

### New coupon (extra-new-coupon-ipad.png, extra-new-coupon-phone.png, ux-p8-new-coupon-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
| --- | ---: | --- | --- |
| Hierarchy | 9 | Code, discount and coverage lead toward one primary Save & publish. | — |
| Typography | 9 | Serif New coupon, mono code and short muted labels follow the scale. | — |
| Layout & spacing | 8 | An otherwise empty Summary card still renders Set a discount to see the summary, adding a redundant surface before any discount exists. | F33: In src/components/admin/marketing/CouponEditor.tsx change the empty-discount Summary fallback from a Card to null; only render the aside Summary when the benefit is valid, led by the existing 28px discount summary. |
| Consistency | 9 | Cards, grouped coverage selectors and primary/outline actions are coherent. | — |
| Color & contrast | 9 | Selected options remain visibly distinct, with legible field boundaries. | — |
| Efficiency | 9 | More folds secondary rules; draft save is available without displacing the primary action. | — |
| Clarity | 9 | Code, Discount, Covers and Choose villas need little explanation. | — |
| States & feedback | 8 | Errors reveal More and focus the invalid field; save/publish failures are explained; browser Back/Forward still bypasses the dirty guard. | F11: In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| Responsive | 9 | Phone actions are fixed with matching bottom padding; tablet keeps actions beside the title. | — |
| Accessibility | 9 | Field errors are associated; segmented options and disclosure have keyboard semantics and measured-target coverage in the supplied tests. | — |

Average: **8.80/10**. Does not meet the every-category target.

## Below 9

Every below-9 (screen, category, score) appears once below, sorted by expected impact: lost drafts and accessibility first, then discoverability, clarity and visual consistency. Shared findings recur because the rubric grades each screen independently. The history-navigation gap is established by the hook's event coverage (`beforeunload` and document `click` only); this is a static finding, not a reproduced browser test. Same-document router/history transitions do not trigger those handlers.

| ID | Screen | Category | Score | Concrete buildable fix |
| --- | --- | --- | ---: | --- |
| F01 | Stay details | States & feedback | 7 | In src/components/admin/BookingSheet.tsx pass the dirty-notes confirmDiscard callback into BookingFinancials.tsx; call it before takePayment/openCheckout (before creating/opening an order). Keep notes if declined. Also cover history traversal in src/hooks/use-unsaved-guard.tsx. |
| F02 | Order line editor | States & feedback | 7 | In src/components/checkout/OrderPanel.tsx lift LineEditor's price/reason draft (or report dirty upward), and guard item collapse, row changes and phone sheet close through confirmDiscard. Retain the draft on cancelled dismissal; keep approval/revision checks. |
| F03 | Chats | Accessibility | 7 | In src/components/admin/AdminSessionDetail.tsx remove the guest-only h2 aria-label or include status in its accessible name; render status.label as visible 12px text beside/below the name, not just a dot/title. Keep the dot aria-hidden. |
| F04 | Receipt | States & feedback | 8 | In src/components/checkout/AfterPayment.tsx give LinkDialog and UnlinkDialog a dirty guard for reason/selection/notify edits; route Escape, overlay, Cancel and Back through confirmDiscard. Keep the same attempt key on retries. |
| F05 | Refund | States & feedback | 8 | In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| F06 | New booking | States & feedback | 8 | In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| F07 | Appointment details | States & feedback | 8 | In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| F08 | Chats | States & feedback | 8 | In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| F09 | Business settings | States & feedback | 8 | In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| F10 | Team settings | States & feedback | 8 | In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| F11 | New coupon | States & feedback | 8 | In src/hooks/use-unsaved-guard.tsx, cover same-document Back/Forward with a router/history navigation blocker that retains the current draft/URL until confirmDiscard resolves; cancellation must restore the current history entry without unmounting the editor. Keep the existing beforeunload and anchor guards. |
| F12 | Business settings | Clarity | 8 | In src/components/admin/AdminSettingsView.tsx replace `Defaults in use · save once to keep them` with `Default settings are active. Changes are saved when you select Save.` Keep the Save bar dirty-only; do not instruct an unavailable initial save. |
| F13 | Missing information | States & feedback | 8 | In src/components/admin/MissingInformationPanel.tsx handle approvedFacts.status === `LoadingFirstPage` in ResolveFactPicker: show `Loading approved facts…` with role=status and suppress `No matching facts or sources` until the initial page resolves; structured sources can remain available. |
| F14 | Order line editor | Layout & spacing | 8 | In src/components/checkout/OrderPanel.tsx make the iPad item scroller tall enough for header + four 48px editor rows (about 20rem at this fixture), or compact secondary tender actions into one row at this panel width. Preserve every method; show a bottom fade/`More item options` cue whenever content still overflows so Remove item is discoverable. |
| F15 | Order line editor | Efficiency | 8 | In src/components/checkout/OrderPanel.tsx make the iPad item scroller tall enough for header + four 48px editor rows (about 20rem at this fixture), or compact secondary tender actions into one row at this panel width. Preserve every method; show a bottom fade/`More item options` cue whenever content still overflows so Remove item is discoverable. |
| F16 | Order line editor | Responsive | 8 | In src/components/checkout/OrderPanel.tsx make the iPad item scroller tall enough for header + four 48px editor rows (about 20rem at this fixture), or compact secondary tender actions into one row at this panel width. Preserve every method; show a bottom fade/`More item options` cue whenever content still overflows so Remove item is discoverable. |
| F17 | New booking | Layout & spacing | 8 | In src/components/admin/NewBookingDialog.tsx render the optional Custom price toggle as a compact 48px settings row, move its rate caption inline, and place Coupon code directly in the Price group. On iPad ensure the initial scroller shows both rows; keep the fixed footer and continuation indicator on phone. |
| F18 | New booking | Efficiency | 8 | In src/components/admin/NewBookingDialog.tsx render the optional Custom price toggle as a compact 48px settings row, move its rate caption inline, and place Coupon code directly in the Price group. On iPad ensure the initial scroller shows both rows; keep the fixed footer and continuation indicator on phone. |
| F19 | Stay details | Layout & spacing | 8 | In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| F20 | Stay details | Responsive | 8 | In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| F21 | Appointment details | Layout & spacing | 8 | In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| F22 | Appointment details | Responsive | 8 | In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx use an explicit phone action stack (`grid grid-cols-1 sm:flex`) with full-width Take payment and an outline secondary row; place its InfoTip inside that row's aligned label group. Avoid the current flex-wrap orphan. |
| F23 | Stay details | Clarity | 8 | In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx rename `Paid elsewhere…` to `Record external payment…`; keep the explanatory InfoTip and existing payment-recording safeguards. |
| F24 | Appointment details | Clarity | 8 | In src/components/admin/BookingFinancials.tsx and AppointmentFinancials.tsx rename `Paid elsewhere…` to `Record external payment…`; keep the explanatory InfoTip and existing payment-recording safeguards. |
| F25 | Chats | Layout & spacing | 8 | In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| F26 | Chats | Color & contrast | 8 | In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| F27 | Chats | Clarity | 8 | In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| F28 | Chats | Responsive | 8 | In src/components/admin/AdminSessionDetail.tsx reserve phone header width for identity: make AdminSessionActions.tsx's No reply needed action an icon-only 44px button with its full aria-label, move channel/property onto a full-width 13px second line, and show a compact visible `Needs you`/status label. Replace ambiguous visible `Done` with the icon plus the existing explicit accessible action name. |
| F29 | Missing information | Layout & spacing | 8 | In src/components/admin/MissingInformationPanel.tsx move phone `Open chat` into the existing More menu (`max-lg`), retain direct access on wide screens, and remove its max-lg col-span-full action row. Keep Resolve/Create fact side by side; target roughly 140–160px mobile rows at these copy lengths. |
| F30 | Missing information | Responsive | 8 | In src/components/admin/MissingInformationPanel.tsx move phone `Open chat` into the existing More menu (`max-lg`), retain direct access on wide screens, and remove its max-lg col-span-full action row. Keep Resolve/Create fact side by side; target roughly 140–160px mobile rows at these copy lengths. |
| F31 | Split payment | Consistency | 8 | In src/components/checkout/PayPanel.tsx replace SplitForm's custom outlined method row with ui/toggle-group.tsx `variant="segmented" tone="strong"`, the same rounded-full muted track, h-11 touch items and selected bg-foreground/text-background used for the top tender selector. |
| F32 | Team settings | Color & contrast | 8 | In src/components/admin/TeamSettings.tsx style unclaimed, unexpired invitation chips with `bg-amber-50 text-amber-800 border-amber-200` (and existing dark warning tokens), retaining neutral role badges and danger expiry chips. Use short copy `Invited · 26 Nov`. |
| F33 | New coupon | Layout & spacing | 8 | In src/components/admin/marketing/CouponEditor.tsx change the empty-discount Summary fallback from a Card to null; only render the aside Summary when the benefit is valid, led by the existing 28px discount summary. |
| F34 | Orders | Clarity | 8 | In src/components/checkout/OrderStrip.tsx change the sheet description to `Open orders · find a paid order by its order number (#).` Keep the input label Order number and the explicit R-prefixed receipt-number correction. |

## Visual bugs

These are visible defects/discoverability or brief mismatches in the supplied captures, kept separate from the code-only guard findings. Some are polish issues rather than blocked actions.

| ID | Filename(s) in docs/screenshots/audit-r2/ | Observed issue | Build location |
| --- | --- | --- | --- |
| V1 | extra-line-open-ipad.png | The item editor ends visibly after Price, with Remove item and History hidden in an unadvertised inner scroller. Phone counterparts show Remove item. This is discoverability/clipping, not a claim that the action cannot be reached by scrolling. | OrderPanel.tsx: rebalance footer/item height and provide continuation affordance (F14–F16). |
| V2 | extra-new-booking-phone.png; ux-p5-new-booking-phone.png; extra-new-booking-ipad.png | The Price group is sliced at the footer boundary on phone; Coupon code is absent from the initial view even on iPad. More booking options below is present, so content is not proved inaccessible. | NewBookingDialog.tsx: compact optional custom-price settings and expose coupon (F17–F18). |
| V3 | extra-stay-sheet-phone.png; extra-appointment-sheet-phone.png | The payment card wraps its secondary text action and information icon onto a loose second line; iPad keeps these on one row. | BookingFinancials.tsx / AppointmentFinancials.tsx: deliberate mobile stack and aligned info grouping. |
| V4 | extra-chats-phone.png; ux-p6-phone-chat.png | The identity/property block takes three text lines, while current Needs you status has become only an amber dot and the completion action says Done. | AdminSessionDetail.tsx / AdminSessionActions.tsx: compact action and full-width metadata/status line. |
| V5 | extra-missing-information-phone.png | Each report adds a mostly empty row for Open chat; the second item spans about 210px, reducing visible question density. | MissingInformationPanel.tsx: move phone Open chat to More and keep the two common resolution actions inline. |
| V6 | extra-new-coupon-ipad.png; extra-new-coupon-phone.png; ux-p8-new-coupon-phone.png | A separate empty Summary surface remains visible with Set a discount to see the summary; the brief asks to hide it until a discount exists. | CouponEditor.tsx: render null for the empty Summary fallback. |
| V7 | extra-split-ipad.png; extra-split-phone.png; ux-p3-ipad-split.png | Selected Cash/PromptPay inside the split rows use pale outlined rectangles, unlike the black pill selection used in the main tender track. | PayPanel.tsx: use the same strong segmented tender component. |
| V8 | extra-settings-team-ipad.png; extra-settings-team-phone.png; ux-p7-team-phone.png | Invited status uses a neutral grey pill visually like the active role badges, rather than the brief's warning treatment. | TeamSettings.tsx: amber invitation-state chip, with expiry still stated. |
| V9 | ux-p7-business-desktop.png | Defaults in use · save once to keep them is visible at the bottom, while the clean form has no Save action. | AdminSettingsView.tsx: replace the instruction with accurate default-state copy. |

## Averages

| Screen | Mean of 10 categories | Every category 9+ |
| --- | ---: | :---: |
| Checkout catalog | 9.00 | Yes |
| Manager approvals | 9.00 | Yes |
| Order line editor | 8.50 | No |
| Orders | 8.90 | No |
| Cash payment | 9.10 | Yes |
| Split payment | 8.90 | No |
| Receipt | 8.90 | No |
| Refund | 8.90 | No |
| New booking | 8.70 | No |
| Stay details | 8.50 | No |
| Appointment details | 8.60 | No |
| Hotel calendar | 9.00 | Yes |
| Staff calendar | 9.00 | Yes |
| Chats | 8.30 | No |
| Missing information | 8.70 | No |
| Business settings | 8.80 | No |
| Team settings | 8.80 | No |
| Marketing dashboard | 9.00 | Yes |
| New coupon | 8.80 | No |

Overall: **8.81/10** (1674/1900 points; 19 equally weighted screens × 10 categories). **6/19 screens meet 9+ in all ten categories.** **34/190 category scores are below 9.**
