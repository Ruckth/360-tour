# Independent UX/UI scorecard — round 4
Checkout: detached latest `ux/integration` at `722dd34c6d4606bcb1ccaf451158f8209c97a36f`; `66fb4858` is an ancestor. Visual/source inspection began at `523d4c15533587579a2edc28b564b2c75e384da0`. The integration ref advanced during review; the intervening commit only adds an unrelated grading document. Its contents were not read. No product code or screenshot changed, so all evidence and scores apply to the final checked-out tip.
All 80 supplied PNGs were opened individually and visually inspected. Only the three requested documents in `docs/reviews/ux-audit/` were read. Screens are grouped by task; responsive sizes and filled/dirty variants count once. The six settings tabs count separately. The populated cashier till is grouped with the checkout catalog. Cash received variants, coupon blank/filled variants and team/business dirty variants are states of their screen.
Grading: integer 1–10; 9 means shippable with at most a nit. Screenshots establish visual evidence; component source establishes unscreenshotable states. Code-only findings are identified. No product edits, pushes, PRs, server startup, test execution or Convex deployment operations were performed. Touch-target test source was read for measured selectors, hit-area handling and coverage; this report does not claim a new passing run or a full assistive-technology certification. Shared focus/label primitives and light-theme tokens were also inspected.
Locked decisions are accepted: subtle non-tender selection, neutral ghost receipt Refund, growing month rows, single-column coupon summary, reserved Team menu column, invite tones, inline Mark arrived, truthful split coverage, server-owned expiry, the specified unsaved-navigation boundary, dirty-only saves, date-adjacent Block, external-payment wording, 0% placeholder, ringed cash presets and one Needs you badge. The line-editor reason-chip finding concerns a failure to execute the locked selection rule.

### Checkout catalog / till ([extra-checkout-start-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-checkout-start-desktop.png), [extra-checkout-start-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-checkout-start-ipad.png), [extra-checkout-start-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-checkout-start-phone.png), [ux-p1-phone-cashier-till.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p1-phone-cashier-till.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Item cards and search dominate; the order count and cash shortcut make the next sale step clear. | — |
| Typography | 8 | extra-checkout-start-ipad.png shows “per night · up to 4 gu…” rather than the full ordinary room metadata. | [CatalogPane.tsx:231](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/checkout/CatalogPane.tsx:231) — Replace the metadata span’s truncate with whitespace-normal break-words leading-snug; preserve the 12px muted metadata scale and keep price/add alignment with mt-auto. |
| Layout & spacing | 9 | Consistent card gaps; the tall empty order pane is a reserved work area rather than a misplaced action. | — |
| Consistency | 9 | Catalog cards, tab strip and outlined customer/order actions share the existing tokens. | — |
| Color & contrast | 9 | Prices and labels remain dark on warm surfaces; gold is limited to the add affordance. | — |
| Efficiency | 9 | Whole item cards add an item; search spans categories; the populated phone till exposes a direct cash shortcut. | — |
| Clarity | 9 | “Search all items”, “No items yet” and “Tap an item to add it” explain the task. | — |
| States & feedback | 9 | CatalogPane has labelled loading placeholders, no-results/custom-item recovery and empty-category copy; CheckoutView has inline write errors. | — |
| Responsive | 8 | The iPad catalog retains three columns beside a 420px order pane; Garden Villa’s capacity metadata is clipped while the phone and desktop show it. | [CatalogPane.tsx:125](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/checkout/CatalogPane.tsx:125) — Raise the three-column container breakpoint from @min-[46rem] to @min-[52rem] so the 1180px layout uses two catalog columns; keep three columns at 1440px. Permit metadata wrapping as a fallback. |
| Accessibility | 9 | Whole cards are large buttons; search and icon actions have names; checkout roots and portals carry coarse-pointer 44px minimums. | — |

Average: **8.80/10**. Every category 9+: **no**.

### Order line editor ([extra-line-open-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-line-open-desktop.png), [extra-line-open-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-line-open-ipad.png), [extra-line-open-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-line-open-phone.png), [ux-p2-phone-line-open.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p2-phone-line-open.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Balance due and Cash lead the footer; Schedule, Price and Remove are distinctly secondary. | — |
| Typography | 9 | The order title, 15px line name, 12px helper and 40px sans balance form a coherent scale. | — |
| Layout & spacing | 9 | The inset editor has aligned label/control rows and dividers; phone controls remain readable above payment actions. | — |
| Consistency | 8 | The over-limit discount state explicitly paints pressed reason chips bg-foreground/text-background; the shared ReasonField also defaults to a filled primary selection. | [OrderPanel.tsx:1002](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/checkout/OrderPanel.tsx:1002) — Remove the strong pressed-reason overrides. Add a subtle tone to [reason-field.tsx:76](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/ui/reason-field.tsx:76) using pressed bg-background text-foreground border-input, and pass it here. Keep Send to manager as the primary action and retain all approval requirements. |
| Color & contrast | 9 | Remove uses labelled destructive text; the neutral editor background separates settings from the paid total. | — |
| Efficiency | 9 | Discount is inline; schedule and price disclose locally rather than opening unrelated pages. | — |
| Clarity | 9 | “Up to 10% without approval”, “Not scheduled” and “Price” make the line rules explicit. | — |
| States & feedback | 9 | Discount parsing exposes aria-invalid/echo, sending status and inline errors; CheckoutDrafts retains and guards unsaved edits. | — |
| Responsive | 9 | The order becomes a phone sheet; payment alternatives become a readable 2×2 footer. | — |
| Accessibility | 9 | Labelled discount and schedule controls, expanded state, focus rings and portal touch sizing are implemented. | — |

Average: **8.90/10**. Every category 9+: **no**.

### Cash payment ([extra-cash-1500-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-cash-1500-desktop.png), [extra-cash-panel-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-cash-panel-desktop.png), [extra-cash-panel-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-cash-panel-ipad.png), [extra-cash-panel-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-cash-panel-phone.png), [ux-p3-phone-cash-1500.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p3-phone-cash-1500.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 10 | The large due amount, received field, change block and single Confirm cash make the money decision immediate. | — |
| Typography | 9 | 40px due, 24px input and 32px change use sans numerals; supporting copy recedes. | — |
| Layout & spacing | 9 | Equal-width note chips, grouped change and compact time disclosure avoid dead space. | — |
| Consistency | 9 | The tender track and cash chips execute their distinct locked selected treatments correctly. | — |
| Color & contrast | 9 | Emerald appears with the word Change; shortage has amber plus a numeric/text explanation. | — |
| Efficiency | 9 | Exact opens prefilled; one note tap calculates change; confirmation remains a separate deliberate step. | — |
| Clarity | 9 | “Cash received”, “Change” and “Received now · Edit time” name what staff must check. | — |
| States & feedback | 9 | Short cash is explained and blocked; errors expose same-attempt Retry; changed orders require review; submitting freezes the attempt. | — |
| Responsive | 9 | Phone uses a bottom sheet; the amount is revealed on visualViewport resize; the confirmation can stick above a reduced keyboard viewport. | — |
| Accessibility | 9 | Input labels, announced change/shortage, pressed note states and coarse-pointer target minimums are present. | — |

Average: **9.10/10**. Every category 9+: **yes**.

### Split payment ([extra-split-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-split-desktop.png), [extra-split-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-split-ipad.png), [extra-split-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-split-phone.png), [ux-p3-ipad-split.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p3-ipad-split.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Due stays above allocations; the covered summary and single confirmation describe the complete payment. | — |
| Typography | 9 | Amounts use sans tabular numerals; row labels and method names remain legible. | — |
| Layout & spacing | 9 | Each allocation groups its amount and method; equal-width method tracks fit without overlap. | — |
| Consistency | 9 | Top mode is strong; per-payment method controls correctly use subtle tone. | — |
| Color & contrast | 9 | Covered includes a check and text; over-allocation uses explicit “Over by” text. | — |
| Efficiency | 10 | Only the first amount needs typing for a two-way split; the final payment automatically takes the rest. | — |
| Clarity | 9 | “Payment 2 · rest” explains the calculated amount; Confirm names both amounts and methods. | — |
| States & feedback | 9 | Empty typed rows show a specific validation line without falsely claiming coverage; same-attempt retries retain the submitted allocation. | — |
| Responsive | 9 | Phone allocations stack within the sheet; iPad and desktop retain the same readable grouping. | — |
| Accessibility | 9 | Amount and method groups are named per payment; validation is connected; remove buttons are named and touch sized. | — |

Average: **9.10/10**. Every category 9+: **yes**.

### Orders ([extra-orders-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-orders-desktop.png), [extra-orders-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-orders-ipad.png), [ux-p2b-phone-orders.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p2b-phone-orders.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Open orders lead, then order-number lookup; Current identifies the active sale. | — |
| Typography | 9 | Order labels, customer metadata and right-aligned sans amounts are distinct. | — |
| Layout & spacing | 9 | Rows have consistent dividers and ample activation area; lookup input and Go align. | — |
| Consistency | 9 | Same sheet/panel primitive and order-row language as checkout. | — |
| Color & contrast | 9 | Current is a neutral badge; disabled Go has a clear inactive treatment. | — |
| Efficiency | 9 | One tap reopens an order; cashier number lookup avoids exposing unavailable historical receipts. | — |
| Clarity | 9 | The description distinguishes open orders from today’s receipts; invalid receipt-number input gets specific guidance. | — |
| States & feedback | 9 | OpenOrdersList has loading/empty/pagination states; local error boundaries retry without losing the lookup; missing numbers show recovery copy. | — |
| Responsive | 9 | The desktop/iPad side panel becomes a compact phone bottom sheet. | — |
| Accessibility | 9 | Rows expose aria-current and full spoken summaries; lookup is labelled and errors connected; dismiss is touch sized. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Approvals ([extra-approvals-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-approvals-desktop.png), [extra-approvals-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-approvals-phone.png), [ux-p1-ipad-manager-approvals.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p1-ipad-manager-approvals.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Who asks, the discount and Approve are immediately visible in each request card. | — |
| Typography | 9 | 15px request summary, 12px context and sans before/after totals read clearly. | — |
| Layout & spacing | 9 | Cards separate independent requests; actions align consistently at the lower right. | — |
| Consistency | 9 | Approve is primary and Decline outline throughout; standard rounded cards and panel headers. | — |
| Color & contrast | 9 | Expiry adds amber only when soon; quote and totals remain readable on neutral surfaces. | — |
| Efficiency | 9 | Each request includes reason and financial impact, allowing a decision without leaving the panel. | — |
| Clarity | 9 | “Mint asks for a ฿180 discount (15%)” and the before/after total give concrete context. | — |
| States & feedback | 9 | Loading/empty states, per-request errors, busy decisions and result status/toast are present; expiry is display-only as locked. | — |
| Responsive | 9 | The phone stacks cards in a bottom sheet; iPad/desktop keep the current work visible beside the panel. | — |
| Accessibility | 9 | Focus starts at the title; actions and expiry info are named, keyboard accessible and touch sized. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Receipt ([extra-receipt-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-receipt-desktop.png), [extra-receipt-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-receipt-ipad.png), [extra-receipt-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-receipt-phone.png), [ux-p4-phone-manager-receipt.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p4-phone-manager-receipt.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Paid receipt identity and New sale lead; per-line scheduling actions remain in the Items card. | — |
| Typography | 9 | Receipt paper uses mono body while money explicitly uses sans tabular spans; screen titles and line amounts remain coherent. | — |
| Layout & spacing | 9 | The receipt paper and action card align without buttons intruding on the printed artifact. | — |
| Consistency | 10 | Paper, Items and History consistently separate print content, current actions and audit detail across viewports. | — |
| Color & contrast | 9 | Paid is green with a check; Not scheduled is amber with text; Refund remains neutral ghost as locked. | — |
| Efficiency | 9 | Link appointment is beside its line; print and New sale are reachable; history stays folded until needed. | — |
| Clarity | 9 | “Paid by card”, “Link appointment” and “Not scheduled” describe the actual next actions. | — |
| States & feedback | 9 | Receipt loading/not-found/unpaid states exist; share errors are visible; history ledgers have local loading/empty/error states. | — |
| Responsive | 9 | Two columns on iPad/desktop; phone collapses paper into Receipt preview and keeps actions above Items. | — |
| Accessibility | 9 | Print and more actions are named; refund controls identify their line; disclosure and focus-return paths are implemented. | — |

Average: **9.10/10**. Every category 9+: **yes**.

### Refund ([extra-refund-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-refund-desktop.png), [extra-refund-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-refund-ipad.png), [extra-refund-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-refund-phone.png), [ux-p4-ipad-manager-refund.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p4-ipad-manager-refund.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Opening a line shows an inline Refund form with amount, destination, reason and a single recording action. | — |
| Typography | 9 | Amount is sans/tabular; section, helper and control labels retain a coherent hierarchy. | — |
| Layout & spacing | 9 | The form is contained under its line; the paper remains separate; content can scroll to the complete form. | — |
| Consistency | 9 | Amount, method and reason choices all correctly use subtle selection; recording is destructive outline. | — |
| Color & contrast | 9 | Inactive submission is neutral; errors are destructive text; the word Refund provides context beyond color. | — |
| Efficiency | 9 | All and the original tender default sensibly; quick reasons avoid typing. | — |
| Clarity | 9 | “Records money already returned to the guest” distinguishes recording from sending money. | — |
| States & feedback | 9 | Invalid amount, no remaining balance, pending approval, recording errors and ambiguous same-refund retries are handled; ReceiptView guards dirty cancellation. | — |
| Responsive | 9 | Phone condenses the method/reason tracks; the form is scrolled into view on open without moving paper controls into it. | — |
| Accessibility | 9 | Amount/method/reason are labelled; validation is connected; opening focuses the form heading and closing restores the line action. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Hotel calendar ([extra-hotel-calendar-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-hotel-calendar-ipad.png), [extra-hotel-calendar-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-hotel-calendar-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Today’s counts and balance sit above the month; New booking is the clear action. | — |
| Typography | 9 | Day labels, guest/property lines and sans KPI values remain readable. | — |
| Layout & spacing | 9 | Month rows grow with actual stays; bars span the correct day cells and the page carries the month. | — |
| Consistency | 9 | Calendar toolbar, view track, filter and status badges match desk controls. | — |
| Color & contrast | 9 | Stays use status icons/text as well as color; the current day is unmistakable. | — |
| Efficiency | 9 | Search, villa filter, month navigation and today shortcuts support front-desk lookup. | — |
| Clarity | 9 | Phone list gives guest, villa, dates, status and amount due together. | — |
| States & feedback | 9 | Loading is signalled, empty periods offer New booking, move errors remain visible and successful changes use a toast. | — |
| Responsive | 9 | Phone defaults to a useful agenda instead of squeezing a seven-column grid; iPad uses the month width. | — |
| Accessibility | 9 | Large agenda rows, labelled toolbar controls and keyboard-operable day cells provide alternatives to compact month bars. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Staff calendar ([extra-staff-calendar-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-staff-calendar-ipad.png), [extra-staff-calendar-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-staff-calendar-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Staff lanes and appointments dominate; New appointment leads the toolbar. | — |
| Typography | 9 | Staff names, 12px time/metadata and appointment titles are legible in the available lane width. | — |
| Layout & spacing | 9 | Lane headers align with the time grid; turnaround is visually attached to the appointment. | — |
| Consistency | 9 | Desk calendar controls and subtle view selection match the hotel calendar. | — |
| Color & contrast | 9 | Turnaround uses hatching and a label; status legend includes text/icons rather than only hues. | — |
| Efficiency | 9 | Per-lane Next 16:00 reveals the offscreen appointment; staff and service filters remain nearby. | — |
| Clarity | 9 | Appointment count and staff selection are explicit; phone rows name time, service and therapist. | — |
| States & feedback | 9 | Loading, empty appointments, blocked creation and mutation errors are surfaced; offscreen appointment cues prevent apparent missing bookings. | — |
| Responsive | 9 | Phone uses List; iPad uses four staff columns with a scrollable time grid appropriate to the schedule. | — |
| Accessibility | 9 | Controls are labelled and coarse-pointer sized; event components provide keyboard focus and meaningful event names. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### New booking ([extra-new-booking-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-booking-ipad.png), [extra-new-booking-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-booking-phone.png), [ux-p5-new-booking-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p5-new-booking-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Stay, Guest and Price create a clear path to Total and Create booking. | — |
| Typography | 9 | 24px serif title, 16px group titles and 12px labels keep the form scannable. | — |
| Layout & spacing | 9 | 24px group gaps; paired check-in/out on phone; footer is a sibling of the scrolling fieldset and cannot permanently cover fields. | — |
| Consistency | 9 | Subtle status selector, standard fields and a ghost Block action follow the settled rules. | — |
| Color & contrast | 9 | Disabled creation is explained in adjacent helper text; custom-price switch has a visible position change. | — |
| Efficiency | 9 | Villa and guest count default; date range is paired; returning guests can populate contact details. | — |
| Clarity | 9 | Total includes nights; incomplete form says to enter name and phone; Block sits directly under dates as locked. | — |
| States & feedback | 9 | Availability loading/error/retry, coupon checking/refusal, phone errors and creation errors retain the draft; close and navigation guard unsaved changes. | — |
| Responsive | 9 | Phone is a full-height form with scrolling fields and a fixed-in-layout footer; iPad fits the grouped form. | — |
| Accessibility | 9 | Fields and switches are named; invalid phone focuses its field; dismiss and country/date controls have touch target support. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Stay sheet ([extra-stay-sheet-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-stay-sheet-ipad.png), [extra-stay-sheet-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-stay-sheet-phone.png), [ux-p5-stay-sheet-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p5-stay-sheet-ipad.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest identity, confirmed status and combined balance due lead directly to Take payment. | — |
| Typography | 9 | Sans 36px balance and 13px labels / 14px values avoid the serif money collision. | — |
| Layout & spacing | 9 | 96px label column, dividers and three clearly separated cards create an orderly sheet. | — |
| Consistency | 9 | Edit, more and close share the header; money card and detail rows align with the appointment sheet. | — |
| Color & contrast | 9 | Status is text plus badge; payment remains primary and external recording secondary. | — |
| Efficiency | 9 | Payment and guest contact links are near the top; edit is one header action. | — |
| Clarity | 9 | Stay/spa subtotals explain the combined balance; Record external payment retains its explanatory info. | — |
| States & feedback | 9 | Loading skeletons/not-found copy, action errors, dirty-note save/retry and guarded close/edit drafts are implemented. | — |
| Responsive | 9 | Full phone sheet and bounded iPad side sheet use the same readable key/value structure. | — |
| Accessibility | 9 | Header icons have names; contact links and form controls are keyboard accessible with focus styles and touch sizing. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Appointment sheet ([extra-appointment-sheet-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-appointment-sheet-ipad.png), [extra-appointment-sheet-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-appointment-sheet-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest, Booked + Mark arrived, and balance due identify status and the immediate money task. | — |
| Typography | 9 | 36px sans balance, 15px name/value content and muted labels stay coherent. | — |
| Layout & spacing | 9 | Mark arrived is correctly inline with status; aligned detail rows group therapist and date context. | — |
| Consistency | 9 | Header icon placement, money card and external-payment action match the stay sheet. | — |
| Color & contrast | 9 | Booked text and dot do not rely on color alone; primary payment stays distinct from status action. | — |
| Efficiency | 9 | Staff can mark arrived inline, take payment or open the linked villa stay directly. | — |
| Clarity | 9 | “Room ready 11:05” and linked-stay end date add useful operating context. | — |
| States & feedback | 9 | Financial loading uses a skeleton; status failures and notices are local; editor drafts/close are guarded and saving is blocked appropriately. | — |
| Responsive | 9 | Phone remains an uncluttered full sheet; iPad is a bounded side sheet with the calendar visible. | — |
| Accessibility | 9 | Edit/more/close and status controls are named; detail links and controls have visible focus and coarse-pointer sizing. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Chats ([extra-chats-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-chats-ipad.png), [extra-chats-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-chats-phone.png), [ux-p6-phone-chat.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p6-phone-chat.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Guest identity, Needs you and reply composer form a clear conversation hierarchy. | — |
| Typography | 9 | 16px guest header, 13px property/channel and readable message text fit phone and iPad. | — |
| Layout & spacing | 9 | Compact header and bottom composer leave a large transcript; no redundant needs-reply strip. | — |
| Consistency | 9 | No reply needed becomes a named icon on phone; one Needs you badge follows the locked status policy. | — |
| Color & contrast | 9 | Guest and AI bubbles are distinguishable with author labels; Needs you is explicit amber text. | — |
| Efficiency | 9 | iPad list/detail supports quick switching; contact data moves into details on phone. | — |
| Clarity | 9 | Channel-specific reply placeholder and No reply needed describe outcomes without automation jargon in the main header. | — |
| States & feedback | 9 | Empty/loading transcript and lists, sending/error/delivery statuses, window expiry and per-chat retained drafts are implemented; composer guards unsaved navigation. | — |
| Responsive | 9 | Phone shows one conversation with a thumb-reachable composer; iPad keeps a useful two-pane layout. | — |
| Accessibility | 9 | Icon buttons and composer are named; send disabled states are described; message-saving actions remain visible on touch. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Missing information ([extra-missing-information-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-missing-information-ipad.png), [extra-missing-information-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-missing-information-phone.png), [ux-p6-desktop-missing.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p6-desktop-missing.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Question text leads each row; Resolve and Create fact are adjacent task actions. | — |
| Typography | 8 | The current truncate span cuts off an ordinary property name; there is no title or visible expansion for this text. | [MissingInformationPanel.tsx:503](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/MissingInformationPanel.tsx:503) — Remove truncate from propertyName and allow its full text to wrap on its own metadata line using min-w-0 whitespace-normal break-words. |
| Layout & spacing | 9 | iPad rows are compact and aligned; phone gives actions their own row. | — |
| Consistency | 9 | Shared filters, badges, ghost Create fact and row menu follow the admin component vocabulary. | — |
| Color & contrast | 9 | Asked count and topic are text; neutral action surfaces preserve focus on the question. | — |
| Efficiency | 9 | Resolving via a fact applies immediately with Undo; creating a fact remains a direct alternative. | — |
| Clarity | 9 | Questions retain guest wording; “Asked 2×” and named topics add context without explanatory clutter. | — |
| States & feedback | 9 | Loading/filtered-empty states, per-row resolution errors, pending controls, paginated fact search and Undo feedback are implemented. | — |
| Responsive | 8 | At 390px the property is reduced to “Tideglass …” in the metadata row, even though a dedicated metadata line could use the row width. | [MissingInformationPanel.tsx:486](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/MissingInformationPanel.tsx:486) — Let the metadata container use flex-wrap; render propertyName as a full-width basis-full sm:basis-auto span with whitespace-normal and break-words. Keep Resolve and Create fact side by side. |
| Accessibility | 9 | Checkbox labels, searchable named resolution controls, row menus and info targets have keyboard/touch support. | — |

Average: **8.80/10**. Every category 9+: **no**.

### Business settings ([extra-settings-business-dirty-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-business-dirty-ipad.png), [extra-settings-business-dirty-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-business-dirty-phone.png), [extra-settings-business-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-business-ipad.png), [extra-settings-business-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-business-phone.png), [ux-p7-business-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p7-business-desktop.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Business profile and four titled groups give the long settings form a clear structure. | — |
| Typography | 9 | 30px serif title, 15px group headings and 12px field labels follow the brief. | — |
| Layout & spacing | 10 | Four Cards use aligned one-third descriptions / two-thirds fields on iPad/desktop and a deliberate single column on phone. | — |
| Consistency | 9 | Standard fields, TimePicker, History and dirty-only action bar use shared primitives. | — |
| Color & contrast | 9 | Focused input has a solid ring; secondary metadata and field edges remain discernible. | — |
| Efficiency | 9 | Contact fields pair where width allows; time selection uses the dedicated picker; Save appears only for real edits. | — |
| Clarity | 9 | Optional fields are labelled; Identity/Contact/Location/Policy copy describes where data is used. | — |
| States & feedback | 9 | Field errors focus the first invalid input; save errors retain the bar; defaults are explained once; revision changes preserve drafts; successful saves toast. | — |
| Responsive | 9 | Phone stacks each group with adequate padding; action bar has matching bottom space and focused-field reveal handling. | — |
| Accessibility | 9 | Labels, invalid-field descriptions, focus rings, touch-sized input primitives and guarded tabs/navigation are present. | — |

Average: **9.10/10**. Every category 9+: **yes**.

### Booking rules settings ([extra-settings-bookingRules-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-bookingRules-ipad.png), [extra-settings-bookingRules-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-bookingRules-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | The section title and single rules card identify the task; History stays secondary. | — |
| Typography | 9 | Labels and values use the established settings scale without awkward wrapping. | — |
| Layout & spacing | 9 | Two-column iPad and single-column phone forms maintain generous alignment and spacing. | — |
| Consistency | 9 | The form uses the same settings renderer, TimePicker and dirty-only Save bar. | — |
| Color & contrast | 9 | Inputs, labels and focus rings use shared high-contrast tokens. | — |
| Efficiency | 9 | All routine timing/stay rules are editable together; explanatory detail is available on demand. | — |
| Clarity | 8 | “Hold unpaid bookings for” = 30 and “Chat summary valid for” = 15 have no visible unit; minutes are only inside info tips. | [AdminSettingsView.tsx:155](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/AdminSettingsView.tsx:155) — Change labels to “Hold unpaid bookings for (minutes)” and “Chat summary valid for (minutes)”, or add a visible “min” suffix beside each input. Retain the existing explanations and validation. |
| States & feedback | 9 | Common SettingsForm covers validation, loading, saving/error feedback, conflict warning and unsaved navigation. | — |
| Responsive | 9 | The phone form is purposefully stacked and later fields remain scrollable. | — |
| Accessibility | 9 | Fields have associated labels, errors and numeric input mode; info buttons and inputs have touch target support. | — |

Average: **8.90/10**. Every category 9+: **no**.

### AI assistant settings ([extra-settings-ai-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-ai-ipad.png), [extra-settings-ai-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-ai-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Tone and reply length precede extra instructions; the sparse form has a clear purpose. | — |
| Typography | 9 | 30px serif title, muted labels and 14–16px input values follow settings scale. | — |
| Layout & spacing | 9 | Two short fields share a row on iPad; wide instructions get their own full row. | — |
| Consistency | 9 | Same Card, History, input and dirty-save behavior as the other editable settings sections. | — |
| Color & contrast | 9 | Neutral surfaces and solid focus rings avoid ambiguous input boundaries. | — |
| Efficiency | 9 | Three fields cover the common adjustments; deeper explanations stay in info tips. | — |
| Clarity | 9 | Section copy names the channels affected; Max words per reply is explicit. | — |
| States & feedback | 9 | SettingsForm validates numeric bounds, reports save failures locally, preserves edits on conflict and guards navigation. | — |
| Responsive | 9 | Phone stacks the fields and maintains a usable instructions area. | — |
| Accessibility | 9 | Each field and info action is labelled with visible focus; shared inputs meet coarse-pointer minimums. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Email settings ([extra-settings-email-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-email-ipad.png), [extra-settings-email-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-email-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Sender and notification recipient precede the guest-facing footer. | — |
| Typography | 9 | Title, labels and footer text retain a restrained settings scale. | — |
| Layout & spacing | 9 | Paired iPad fields and full-width footer align; phone spacing is comfortable. | — |
| Consistency | 9 | Shared settings form components, History and dirty Save behavior are retained. | — |
| Color & contrast | 9 | Placeholder text is legible and distinct from the entered footer. | — |
| Efficiency | 9 | The small form keeps all routine email customization together. | — |
| Clarity | 9 | Sender name, Owner notification email and Footer are concrete labels; info tips explain default inheritance. | — |
| States & feedback | 9 | Email validation and local save errors use the shared renderer; drafts survive failure and are guarded on navigation. | — |
| Responsive | 9 | Phone fields stack without squeezing text or action controls. | — |
| Accessibility | 9 | Labels and error associations are supplied by SettingsForm; input focus and touch sizing come from shared primitives. | — |

Average: **9.00/10**. Every category 9+: **yes**.

### Channels settings ([extra-settings-channels-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-channels-ipad.png), [extra-settings-channels-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-channels-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Messaging channels and Backend services group operational status; Retry is visible in the warning. | — |
| Typography | 9 | Channel names and 12px dated metrics remain legible across the two layouts. | — |
| Layout & spacing | 9 | Four-column metrics on iPad become a tidy two-column grid inside each phone channel row. | — |
| Consistency | 9 | Standard cards, status badges and the shared warning treatment match the settings vocabulary. | — |
| Color & contrast | 9 | Warnings and failed counts use meaning-driven colors with explicit labels/numbers. | — |
| Efficiency | 9 | Recent events, replies and failure counts are visible without opening individual channels. | — |
| Clarity | 7 | Both captures expose “website environment variables: Request failed (404)”; all four channels say “Unknown” without saying what remains usable. | [AdminSettingsView.tsx:460](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/AdminSettingsView.tsx:460) — Replace the banner with “Connection status could not be checked. Recent message activity is still shown.” Keep Retry; put the raw HTTP/configuration detail in a disclosure labelled “Technical details”. |
| States & feedback | 8 | channelHealthMeta returns Unknown before considering known failure counts; WhatsApp has 2 failures in 7 days but the same badge as zero-failure channels. | [AdminSettingsView.tsx:555](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/AdminSettingsView.tsx:555) — Separate configuration-check status from observed delivery health. When configuration is unavailable, label it “Connection not checked”; still show “Recent reply failures” for known failed24h/failed7d counts, alongside the existing dated counts. Do not imply a live connection has been verified. |
| Responsive | 9 | Phone preserves the metric grouping and retry target without horizontal overflow. | — |
| Accessibility | 9 | Retry is labelled and touch sized; metrics use definition lists; status badges and failure counts have text equivalents. | — |

Average: **8.70/10**. Every category 9+: **no**.

### Team settings ([extra-settings-team-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-team-desktop.png), [extra-settings-team-dirty-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-team-dirty-ipad.png), [extra-settings-team-dirty-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-team-dirty-phone.png), [extra-settings-team-ipad-full.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-team-ipad-full.png), [extra-settings-team-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-team-ipad.png), [extra-settings-team-phone-full.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-team-phone-full.png), [extra-settings-team-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-settings-team-phone.png), [ux-p7-team-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p7-team-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | People and Rules for all cashiers distinguish access management from checkout policy. | — |
| Typography | 9 | 15px names, 13px emails, neutral role badges and amber invite dates remain readable. | — |
| Layout & spacing | 9 | Roles/actions align and the reserved more-menu column is preserved; phone uses a separate actions line. | — |
| Consistency | 9 | Pending invites are correctly amber and expired ones destructive; non-tender permission controls use subtle tone. | — |
| Color & contrast | 9 | Role versus invite status are visually distinct; access actions remain neutral. | — |
| Efficiency | 9 | Invite is direct; Change reveals immediate role selectors; cashier policies save together only when dirty. | — |
| Clarity | 9 | “Role changes apply immediately” explains the local editor; rules say who can act without asking. | — |
| States & feedback | 9 | Loading, row-specific saving/error/success, stale-rule reload, dirty guards and failed policy-save feedback are implemented. | — |
| Responsive | 9 | Full phone/iPad captures show orderly rows and readable policy choices; dirty bar has bottom padding. | — |
| Accessibility | 8 | PeoplePanel keys PersonRow by both roles. A successful role edit removes its open Select and trigger; no focus restoration exists in this file. | [TeamSettings.tsx:205](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/TeamSettings.tsx:205) — Use person.email as the stable row key. Close the role editor explicitly on successful change and focus that row’s “Change roles for <name>” button via a ref; after removing the final access, focus the next person or Invite. Preserve immediate saves and access-removal confirmation. |

Average: **8.90/10**. Every category 9+: **no**.

### Marketing dashboard ([extra-marketing-dashboard-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-marketing-dashboard-ipad.png), [extra-marketing-dashboard-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-marketing-dashboard-phone.png), [ux-p8-dashboard-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p8-dashboard-desktop.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 10 | Net collected is the 40px hero, with business total folded into it and supporting KPIs visibly secondary. | — |
| Typography | 9 | 40px hero, 28px supporting values and 12–13px labels/hints use sans money throughout. | — |
| Layout & spacing | 9 | Hero spans two grid columns; supporting cards align; chart header and legend have coherent spacing. | — |
| Consistency | 9 | Stat/Card, info tips, subtle measure filters and shared date controls are consistently applied. | — |
| Color & contrast | 9 | Categorical series are named; selected/hidden series also change border/text treatment; financial text is high contrast. | — |
| Efficiency | 9 | Date/property/basis controls are together; export and spend are reachable; chart offers a table alternative. | — |
| Clarity | 9 | “Results from tracked links”, attribution basis and as-of time define what the numbers represent. | — |
| States & feedback | 9 | Initial loading/error/retry, first-run/empty-range states, incomplete-data warnings and failed-refresh retention with as-of copy are implemented. | — |
| Responsive | 9 | Phone gives the hero full width, two-up metrics and a collapsed tracking breakdown; iPad/desktop use available width. | — |
| Accessibility | 9 | Info tips support touch/keyboard; chart has a spoken summary and complete table twin; filters are named and touch sized. | — |

Average: **9.10/10**. Every category 9+: **yes**.

### New coupon ([extra-new-coupon-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-coupon-desktop.png), [extra-new-coupon-filled-desktop.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-coupon-filled-desktop.png), [extra-new-coupon-filled-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-coupon-filled-ipad.png), [extra-new-coupon-filled-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-coupon-filled-phone.png), [extra-new-coupon-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-coupon-ipad.png), [extra-new-coupon-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-new-coupon-phone.png), [ux-p8-new-coupon-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p8-new-coupon-phone.png))
| Category | Score | Evidence | Fix needed for 9+ |
|---|---:|---|---|
| Hierarchy | 9 | Code and Discount lead; Save & publish is the single primary action; valid summary follows below the form. | — |
| Typography | 9 | Serif New coupon title and 28px benefit summary follow the brief; only coupon code treatment is mono. | — |
| Layout & spacing | 9 | The locked single max-w-3xl column avoids an empty side column; form and summary share aligned edges. | — |
| Consistency | 9 | All form choices use subtle selected tone; Card radius and phone action bar match the system. | — |
| Color & contrast | 9 | Neutral selections do not compete with publication; unsaved state is labelled. | — |
| Efficiency | 9 | Core coupon fields are immediate; campaign/dates/limits/terms fold under More; draft save remains available. | — |
| Clarity | 9 | Summary states benefit, scope, booking/stay windows and rules in plain language. | — |
| States & feedback | 9 | Validation reveals/focuses the first error, including folded rules; save/publish failures preserve draft status; loading/read-only/archive and unsaved navigation are handled. | — |
| Responsive | 9 | Phone stacks inputs and has bottom padding for the fixed action bar; summary can be scrolled fully above it. | — |
| Accessibility | 9 | Fields/groups are labelled; percent/baht controls have spoken names; errors are linked and publication is keyboard accessible. | — |

Average: **9.00/10**. Every category 9+: **yes**.

## Below 9

Sorted by practical impact; repeated category entries describe distinct rubric failures, not additional screens.

| Impact | Screen | Category | Score | Concrete buildable fix |
|---|---|---|---:|---|
| High | Channels settings | Clarity | 7 | [AdminSettingsView.tsx:460](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/AdminSettingsView.tsx:460) — Replace the banner with “Connection status could not be checked. Recent message activity is still shown.” Keep Retry; put the raw HTTP/configuration detail in a disclosure labelled “Technical details”. |
| High | Channels settings | States & feedback | 8 | [AdminSettingsView.tsx:555](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/AdminSettingsView.tsx:555) — Separate configuration-check status from observed delivery health. When configuration is unavailable, label it “Connection not checked”; still show “Recent reply failures” for known failed24h/failed7d counts, alongside the existing dated counts. Do not imply a live connection has been verified. |
| High | Team settings | Accessibility | 8 | [TeamSettings.tsx:205](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/TeamSettings.tsx:205) — Use person.email as the stable row key. Close the role editor explicitly on successful change and focus that row’s “Change roles for <name>” button via a ref; after removing the final access, focus the next person or Invite. Preserve immediate saves and access-removal confirmation. |
| Medium | Booking rules settings | Clarity | 8 | [AdminSettingsView.tsx:155](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/AdminSettingsView.tsx:155) — Change labels to “Hold unpaid bookings for (minutes)” and “Chat summary valid for (minutes)”, or add a visible “min” suffix beside each input. Retain the existing explanations and validation. |
| Medium | Missing information | Responsive | 8 | [MissingInformationPanel.tsx:486](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/MissingInformationPanel.tsx:486) — Let the metadata container use flex-wrap; render propertyName as a full-width basis-full sm:basis-auto span with whitespace-normal and break-words. Keep Resolve and Create fact side by side. |
| Medium | Missing information | Typography | 8 | [MissingInformationPanel.tsx:503](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/admin/MissingInformationPanel.tsx:503) — Remove truncate from propertyName and allow its full text to wrap on its own metadata line using min-w-0 whitespace-normal break-words. |
| Medium | Checkout catalog / till | Responsive | 8 | [CatalogPane.tsx:125](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/checkout/CatalogPane.tsx:125) — Raise the three-column container breakpoint from @min-[46rem] to @min-[52rem] so the 1180px layout uses two catalog columns; keep three columns at 1440px. Permit metadata wrapping as a fallback. |
| Medium | Checkout catalog / till | Typography | 8 | [CatalogPane.tsx:231](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/checkout/CatalogPane.tsx:231) — Replace the metadata span’s truncate with whitespace-normal break-words leading-snug; preserve the 12px muted metadata scale and keep price/add alignment with mt-auto. |
| Medium | Order line editor | Consistency | 8 | [OrderPanel.tsx:1002](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/checkout/OrderPanel.tsx:1002) — Remove the strong pressed-reason overrides. Add a subtle tone to [reason-field.tsx:76](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/src/components/ui/reason-field.tsx:76) using pressed bg-background text-foreground border-input, and pass it here. Keep Send to manager as the primary action and retain all approval requirements. |

## Visual bugs

1. **Catalog metadata clipped on iPad** — [extra-checkout-start-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-checkout-start-ipad.png) shows Garden Villa as “per night · up to 4 gu…”. The same persistent catalog defect is visible in [extra-line-open-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-line-open-ipad.png), [extra-cash-panel-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-cash-panel-ipad.png), [extra-split-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-split-ipad.png), [extra-orders-ipad.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-orders-ipad.png) and [ux-p3-ipad-split.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/ux-p3-ipad-split.png). Fix CatalogPane’s container breakpoint/metadata wrapping as above.

2. **Property identity clipped on phone** — [extra-missing-information-phone.png](/Users/macbook/.t3/worktrees/360-tour/t3-56bb35d6-9ce4336486c83589/docs/screenshots/audit-r4/extra-missing-information-phone.png) shows “Tideglass …” on the baby-cot question. Let the property wrap on its own metadata line.

The refund phone capture is intentionally scrolled to its inline form. The full-page filled-coupon capture records a fixed bar at the capture viewport position; CouponEditor already supplies bottom clearance. Neither is counted as a proven content-occlusion bug. Channels’ 404 is an observed fixture error state; the report grades its presentation, not an unverified production outage. Team focus and selected discount-reason tone are code-only findings without a corresponding supplied screenshot.

## Per-screen averages

| Screen | Average / 10 | Every category 9+ |
|---|---:|---|
| Checkout catalog / till | 8.80 | No |
| Order line editor | 8.90 | No |
| Cash payment | 9.10 | Yes |
| Split payment | 9.10 | Yes |
| Orders | 9.00 | Yes |
| Approvals | 9.00 | Yes |
| Receipt | 9.10 | Yes |
| Refund | 9.00 | Yes |
| Hotel calendar | 9.00 | Yes |
| Staff calendar | 9.00 | Yes |
| New booking | 9.00 | Yes |
| Stay sheet | 9.00 | Yes |
| Appointment sheet | 9.00 | Yes |
| Chats | 9.00 | Yes |
| Missing information | 8.80 | No |
| Business settings | 9.10 | Yes |
| Booking rules settings | 8.90 | No |
| AI assistant settings | 9.00 | Yes |
| Email settings | 9.00 | Yes |
| Channels settings | 8.70 | No |
| Team settings | 8.90 | No |
| Marketing dashboard | 9.10 | Yes |
| New coupon | 9.00 | Yes |

**Overall average: 8.98/10** (2065 / 2300; equal weight across 23 screens and 10 categories). **17/23 screens are 9+ in every category.** There are 9 below-9 screen/category pairs across 6 screens.
