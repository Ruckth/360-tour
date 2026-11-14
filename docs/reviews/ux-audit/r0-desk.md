# R0 audit — bookings desk, calendars and chats

Graded against `scorecard-rubric.md` and `visual-brief.md`, using `docs/screenshots/audit-r0/` plus the code in `src/components/admin/` and `src/components/ui/`. iPad is 1180×820 and phone is 390×844.

**Area average: 7.6 / 10.** No screen reaches 9 in every category. The two calendars are the weakest (6.9 and 7.0), mostly because of the phone layout and the month grid's overflow logic.

Notes on the inputs:
- `ux-p6-desktop-missing.png` is 1180 px wide and matches the iPad capture pixel for pixel, so there is **no real desktop capture** for Missing information. `ux-p6-phone-chat.png` is the same as `extra-chats-phone.png`.
- The screenshots seem to be taken with a fine (mouse) pointer. On the phone, the hotel calendar still shows the drag hint, which the code hides with `pointer-coarse:hidden`, and no `pointer-coarse:min-h-11` sizes appear. Touch-only behaviour (44 px minimums, the always-visible "Answer as a business fact" link) was graded from code. Recapture with `hasTouch: true` and `isMobile: true`.

| Screen | Avg |
|---|---|
| New booking | 7.7 |
| Stay sheet | 8.4 |
| Appointment sheet | 7.7 |
| Hotel calendar | 6.9 |
| Staff calendar | 7.0 |
| Chats | 7.8 |
| Missing information | 7.7 |

---

### New booking (ux-p5-new-booking-phone.png; NewBookingDialog.tsx)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The three groups and the primary button are clear. "Block these dates instead" is bold black text with no button shape, so it competes with "Create booking". | Make it `variant="outline" size="sm"` with a `CalendarX` icon, or keep it ghost but add `text-muted-foreground font-medium`, so it clearly ranks second. |
| Typography | 7 | Dates read "Nov 20, 2026" (US format) while sheets and calendars use "Mon 9 Nov". `[&_label]:text-xs [&_label]:text-muted-foreground` also shrinks the "Create as confirmed" checkbox label to a faint 12 px caption, although it is a real choice. The phone placeholder "081 234 5678" renders at 16 px and darker than the other fields, so it reads as a pre-filled value. | Format the BookingRangePicker trigger with the shared `displayDate()` (en-GB, `EEE d MMM`). Exclude choice labels from the descendant rule: give the checkbox label `text-sm text-foreground` (or wrap it in a class the selector skips). Give PhoneInput's input `placeholder:text-muted-foreground`. |
| Layout & spacing | 8 | The grouping and 24 px gaps follow the brief. "Create as confirmed" sits in Guest, but it is a booking status. The scroller cuts the "Coupon code (optional)" label at its edge with no hint that more is below. | Move the checkbox under Price, just before the footer, as "Booking status". Add a scroll fade on the scroller: `[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]`. |
| Consistency | 7 | Native `accent-foreground` checkboxes appear here while the rest of the app uses buttons and toggles. "Custom price" sits inside a bordered card but "Coupon" does not. The date format differs from the sheet. | Replace both checkboxes with `ToggleGroup` or a switch row (48 px, label left, control right) like the brief's inset list. Put Custom price and Coupon in the same Card as two rows. |
| Color & contrast | 8 | Mostly fine. The phone placeholder is too dark (see Typography). | Same placeholder fix. |
| Efficiency | 9 | Villa and dates come pre-filled, guests defaults to 2, returning-guest suggestions fill the contact fields, and "Block instead" is one tap away. | — |
| Clarity | 8 | "Create as confirmed" does not say what unchecking does (it creates a pending booking with no email). | Use a 2-option segmented control, "Confirmed · Pending", with a 12 px hint: "Pending holds the dates without emailing the guest." |
| States & feedback | 7 | `problem`, `couponProblem` and `error` render at the bottom of the scroller. When the user is at the top, "Create booking" is disabled and the reason is off-screen. | Render the first blocking reason in the footer above the buttons (`text-xs text-destructive`, `aria-live="polite"`), next to the total. Keep the inline messages as they are. |
| Responsive | 8 | The phone layout is good and the footer is in thumb reach. Check-in/out sit side by side. There is no iPad capture. | Capture iPad. On sm+, consider `sm:max-w-lg` so the date buttons don't crowd. |
| Accessibility | 7 | The checkboxes are `size-4` with a ~20 px label row, below 44 px on touch. The Guests field is `type=number` with no visible maximum. | `label` rows: `min-h-11 items-center` and a `size-5` box (or the switch row above). Add a 12 px "Max {maxGuests}" hint under Guests, linked with `aria-describedby`. |

### Stay sheet (extra-stay-sheet-ipad.png, extra-stay-sheet-phone.png, ux-p5-stay-sheet-ipad.png; BookingSheet.tsx, BookingFinancials.tsx)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | "Balance due ฿27,500" (36 px sans) leads, with Take payment as the one filled button, and Edit / ⋯ / ✕ in the header. | — |
| Typography | 8 | Money uses sans and tabular numerals as the brief asks. The Notes textarea gets `max-md:text-base` (16 px) on the phone while the values above are 14 px, so the placeholder wraps. Source is a 12 px bold outline badge among 14 px values. | Keep 16 px for iOS zoom but shorten the placeholder to "Arrival time, requests…". Render Source as plain 14 px text, with marketing attribution as a muted second line. |
| Layout & spacing | 8 | The Notes Card wraps a bordered textarea (border inside border). The "Created" row takes ~45 px for low-value audit data. | Make the notes textarea borderless inside its card (`border-0 bg-muted/40 shadow-none`) or drop the outer card. Fold "Created" into the History disclosure header ("Created 13 Oct by ploy"). |
| Consistency | 8 | The appointment sheet has an "Appointment" eyebrow and this sheet has none. "Record refund" sits in the money card here but in a disclosure on the appointment sheet. | Add `<p className="mb-1 text-xs text-muted-foreground">Villa stay</p>` above the title, or remove the eyebrow from both. Put "Record refund" in the same place on both sheets. |
| Color & contrast | 9 | The status chip has colour and text, and the buttons are clear. | — |
| Efficiency | 8 | Phone and email are plain text, so desk staff on a phone can't tap to call or write. | `<a href={`tel:${booking.guestPhone}`} className="underline-offset-2 hover:underline">` and a matching `mailto:` link in `Detail`. |
| Clarity | 8 | "Already paid…" names a state, not an action, and doesn't say it records a payment taken outside checkout. | Rename it "Record payment…" (dialog title "Record a payment taken elsewhere"), in BookingFinancials and AppointmentFinancials. |
| States & feedback | 9 | Skeleton, "Booking not found", the checkout-live disabled reason, notes conflict with "Load the latest notes", and a dirty-only "Save notes" are all present. | — |
| Responsive | 8 | On iPad the overlay blurs the calendar completely, so staff lose context of the week they came from. The phone sheet is fine. | Use `bg-black/20` on the iPad sheet overlay instead of the heavy blur (`SheetOverlay` in ui/sheet.tsx: drop `backdrop-blur` at md+). |
| Accessibility | 9 | Icon buttons are labelled, `pointer-coarse:min-h-11` comes from Button, and status is shown as text. Nit: the pencil's `aria-label="Edit"` could say "Edit stay". | — |

### Appointment sheet (extra-appointment-sheet-ipad.png, extra-appointment-sheet-phone.png; AppointmentSheet.tsx, AppointmentFinancials.tsx)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | "Mark arrived" floats alone as an outline button between the money card and the details, so it reads as an orphan. | Move the next-step button into the header row under the title, beside the status chip (`size="sm" variant="outline"`), or into the money card's button row as the second button when nothing is due. |
| Typography | 9 | Same scale as the stay sheet. | — |
| Layout & spacing | 7 | Email "—", Notes "—" and Villa stay "—" (or the vague "On a villa stay") take ~135 px for nothing, and the Mark-arrived row adds 60 px. | Hide empty `Detail` rows (`{appointment.guestEmail ? <Detail …/> : null}`). Show Notes as an editable field like the stay sheet. |
| Consistency | 8 | Its eyebrow and refund placement differ from the stay sheet (see Stay). "Take payment" is a `ButtonLink` here but a `Button` on the stay sheet. | Use one pattern on both sheets: an eyebrow on both, refunds in the money card, and Take payment as a Button that routes. |
| Color & contrast | 9 | Fine. | — |
| Efficiency | 7 | "Villa stay: On a villa stay" is not a link, and phone and email are not tappable. | Show "Lagoon Pool Villa · Anna Schmidt ›" as a link that opens that BookingSheet (needs `propertyName` and `guestName` on the appointment read). Add `tel:` and `mailto:` links. |
| Clarity | 7 | "On a villa stay" doesn't say which stay. "Turnaround to 11:05" is staff jargon. "Already paid…" has the same problem as on the stay sheet. | Use "Room ready 11:05" (or "Therapist free at 11:05"), name the linked stay, and use "Record payment…". |
| States & feedback | 7 | When `disabled`, Take payment is a link with `pointer-events-none opacity-50` and `aria-disabled`, which still activates from the keyboard. While loading, the amount shows "…" with no skeleton. | Render `<Button disabled={disabled} onClick={() => router.push(...)}>` instead of `ButtonLink`. Show `<Skeleton className="h-10 w-32" />` while `data` is undefined. |
| Responsive | 8 | The phone sheet is fine. On iPad it has the same heavy blur as the stay sheet. | Same overlay fix as the stay sheet. |
| Accessibility | 7 | The disabled link is still focusable (above). Status lives only in the chip, which is fine. | Same Button fix. |

### Hotel calendar (extra-hotel-calendar-ipad.png, extra-hotel-calendar-phone.png; AdminBookingsView.tsx, TodayStrip.tsx, reui/event-calendar/event-calendar-month-view.tsx)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The KPI tiles are 100 px tall with the value floating in white space. "New booking" is clear. | Tiles: `min-h-0 py-3 sm:min-h-20` and label and value on one baseline grid. The 28 px value stays. |
| Typography | 7 | Phone bars truncate to "M…" and "Anna Schmidt · Lagoon …". The phone "+3 more" is 10 px. The phone Balance-due tile is 16 px while the other tiles are 28 px (`text-base` in TodayStrip). | Phone: bar text shows only the guest's first name (`max-sm:` drop "· villa" and the time), and "+N more" uses `text-[11px]` minimum. Balance-due tile: `text-xl sm:text-[28px]` with the `฿` compact format (`฿44.3k`) below sm. |
| Layout & spacing | 6 | On Fri 13 and Sat 14, "+3 more" shows in an **empty** cell. The month view reserves lane 0 for Anna's bar even where it has ended, so free space hides bookings. The "+N more" pills sit at the top on 13 and 14 but below the bar on 11 and 12. The today cell (12) has a heavier bottom border. Two of the six rows are next month's days. | In `event-calendar-month-view.tsx` (~line 371), compute per column how many lanes are actually used (`covers(b, col)`) and let single-day events fill free lanes before overflow. Pin `moreIndicator` to the cell bottom (`mt-auto`). Drop the today-cell border override. Use `fixedWeeks={false}` so the month shows 5 rows when it fits. |
| Consistency | 7 | The view switcher is a "Month" Select here but a Day/Week/Agenda segmented control on Staff. There is no "Today" button here while Staff has one. The KPI tiles don't use `ui/stat.tsx`. | Use one `AdminCalendarHeader` pattern: a Today button, prev/next, the date, and a segmented view control (ToggleGroup, `rounded-full bg-muted`). Build tiles from `Stat` (or share its classes). |
| Color & contrast | 8 | Bars show status only through a 6 px dot and the tint. Out-of-month days at 50 % are fine. | Give cancelled and pending a non-colour cue: pending bars `border-dashed`, cancelled `line-through opacity-60`. |
| Efficiency | 7 | On the phone the month grid is the default, but it can't show a stay's name. The KPI tiles are toggles with no affordance, so staff never discover the guest list. | Phone defaults to an agenda list (arrivals and departures per day). Tiles get a `ChevronDown` (rotates when open) beside the label. |
| Clarity | 7 | It isn't clear what period "Balance due ฿44,300" covers. "Host block" / "OTA block" are jargon. | Label it "Due from today's guests". Legend: "Blocked by you" · "Blocked by OTA". |
| States & feedback | 8 | Loading spinner, the "may be missing" alert and the no-villas empty state exist. There is no empty-month message. | When the visible range has 0 bookings, show a centred muted line: "No stays this month · Drag across days or tap New booking". |
| Responsive | 5 | The phone squeezes the iPad grid: 1-letter weekdays, ~20 px bars, a 2-row toolbar plus a 3-line legend, and 2 dead rows. | Below sm, render a list view: day header, then rows (guest 15 px medium, villa · nights 13 px muted, status chip), with the toolbar on one row (prev · month · next · ⋯) and New booking as a FAB or bottom bar with matching bottom padding. |
| Accessibility | 6 | The "+N more" pill is `h-4` (16 px) and phone bars are ~20 px, both under 44 px on touch. Status relies on colour (above). | Phone list (above) fixes the targets. On iPad, use `moreIndicator` `h-6 px-2 pointer-coarse:h-7` and give the whole cell's lower area an `aria-label="Show 3 more on 13 Nov"` button. |

### Staff calendar (extra-staff-calendar-ipad.png, extra-staff-calendar-phone.png; AdminStaffBookingsView.tsx, AdminCalendarHeader.tsx)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | "New appointment" is clear on iPad but sits mid-row on the phone. | Phone: move New appointment into the first toolbar row, at the end, as an icon+label `size="sm"` button. |
| Typography | 8 | The phone card truncates to "Thai massage 6" and hides the Booked chip. | Below sm, let the card wrap to 2 lines (`line-clamp-2`) and drop the chip. Status is already shown by the card's colour plus an icon. |
| Layout & spacing | 6 | The red now-line draws straight through "Ken Tanaka". On the phone only 08:00–11:00 is visible, the legend follows, then ~100 px of blank page. The toolbar stacks 4 rows (~260 px) before the grid. Closed-hours shading leaves a 14 px gap at each column's right edge. | Now-line: `z-0` under events, or events `z-10 bg-card` (events-on-top). Phone: calendar height `h-[calc(100dvh-var(--admin-tab-bar)-12rem)]` and move the legend into ⋯ / an info tip. Collapse the phone toolbar to 2 rows (date row + Day/Week/Agenda + ⋯ holding staff, filters and show-cancelled). Closed-hours block: `inset-x-0`. |
| Consistency | 6 | A square `border bg-card` container (line 446) where Hotel uses a rounded Card. The view switcher, Today button and New-button row differ from Hotel (see Hotel). | Line 446: `rounded-xl overflow-hidden` (Card). Share one header layout with Hotel. |
| Color & contrast | 8 | The beige closed-hours shading isn't explained. The legend uses a clock icon for break/turnaround/time off, not the actual fill. | Legend swatch: `size-3 rounded-sm bg-[the closed fill]` "Closed", plus a hatched swatch for "Turnaround". |
| Efficiency | 7 | The phone shows 2 of 4 staff with a sideways scroll and no hint. | Phone default is Agenda, or one staff column with a staff segmented picker. If columns stay, add a right-edge fade and a "2 of 4 staff →" hint. |
| Clarity | 7 | "2 booked in view" while Mali's appointment is out of sight. Turnaround shows as a label in a hatched box. | "2 today · 1 later" or scroll to the first appointment on load. Keep "Turnaround" but explain it once via InfoTip in the legend. |
| States & feedback | 8 | A loading spinner exists. An empty day just shows "0 appointments" per column. | When all columns are empty, show a centred muted line: "No appointments on Thu 12 Nov · New appointment". |
| Responsive | 5 | The phone is a squeezed iPad view (above). | Phone: Agenda by default, one-row toolbar, full-height list. |
| Accessibility | 7 | The segmented control is good. Short events are ~30 px tall on touch, and the now-line covers text. | Minimum rendered event height of 44 px on `pointer-coarse` (keep proportional time, overlap allowed), plus the now-line z-order fix. |

### Chats (extra-chats-ipad.png, extra-chats-phone.png, ux-p6-phone-chat.png; ChatsView.tsx, AdminSessionDetail.tsx, AdminSessionActions.tsx)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The header leads well. In the list, the amber "Waiting 3m" outweighs the guest name because the name is cut to "Anna …". | See Typography. |
| Typography | 7 | At 1180 px the 20 rem list truncates every name ("Anna …", "Somcha…", "Kenji Wa…") because the villa name (`max-w-[45%]`) and the timer share the first line. | ChatsView ~line 855: first line is the name + timer only. Move `· {place}` to the start of line 2 (`text-xs`) before the preview, or widen to `lg:grid-cols-[22rem_minmax(0,1fr)]`. |
| Layout & spacing | 8 | Fine. Under the composer on the phone there is ~40 px of dead space. | Composer `pb-[max(0.75rem,env(safe-area-inset-bottom))]` and no extra wrapper margin. |
| Consistency | 8 | The list uses an underline tab bar while elsewhere SegmentedTabs is a pill. The "Needs you" chip matches the StatusBadge. | Use one tab style (SegmentedTabs) for Needs you / In progress / Done. |
| Color & contrast | 8 | The amber "Waiting" text at 12 px is borderline. | Use `TONES.warning.text` at the 700 shade (≥ 4.5:1) or `font-semibold`. |
| Efficiency | 8 | On touch (`pointer-coarse:opacity-100`), every guest message shows "Answer as a business fact", which clutters long threads. "Shortcuts" shows on iPad, where there is no keyboard. | Show the link only on the latest unanswered guest message on coarse pointers, and put the rest in a long-press / ⋯. Add `pointer-coarse:hidden` to the Shortcuts button. |
| Clarity | 6 | "AI on · Next issue: AI" is unreadable jargon. The reply-window-ended box is 3 sentences. | Use one chip: "AI replying" / "AI paused" / "Staff handles next question", with the detail in the ⓘ sheet. Window box: "WhatsApp only allows replies within 24 h of the guest's last message. You can reply when they write again." |
| States & feedback | 9 | Skeleton rows, three distinct empty states, the closing-soon warning, the window-ended block, send pending and send errors are all present. | — |
| Responsive | 8 | The phone header is one line as the brief asks. The property name truncates ("Tideglass Pool Resid…"). The iPad list is too narrow (above). | Phone: drop the channel word and keep only the icon (`sr-only` label) so the property fits. |
| Accessibility | 8 | Icon buttons are labelled and 44 px on coarse pointers. The phone's ✓✓ "No reply needed" is icon-only, which is clear enough with its aria-label but not to sighted users. | On the phone, show a tooltip on long-press, or use the label "Done" (short enough to fit). |

### Missing information (extra-missing-information-ipad.png, extra-missing-information-phone.png, ux-p6-desktop-missing.png; MissingInformationPanel.tsx, BusinessFactsView.tsx, admin-bulk.tsx)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 7 | No page title: the tab bar is the top of the page, unlike "Hotel bookings" and "Staff bookings". | BusinessFactsView: add `<h1 className="font-serif text-2xl font-semibold">Guest questions</h1>` above the SegmentedTabs, with a count badge on "Missing information". |
| Typography | 7 | The column headers are uppercase, letter-spaced `admin-eyebrow` ("QUESTION · RESOLVE"), off the brief's scale. On the phone the select truncates to "Resolve…". "Create fact" is 12 px bold. | `STACKED_TABLE.head`: `text-xs font-medium text-muted-foreground normal-case tracking-normal`. Phone select placeholder: "Pick a fact". "Create fact": `size="default"` (14 px). |
| Layout & spacing | 8 | The rows are ~64 px and the select sits beside the button on the phone as the brief asks. The phone action row is indented `pl-7` under the checkbox, so it wastes width. | Phone: `max-lg:pl-0` on the action cell. |
| Consistency | 7 | This is the only uppercase table header in the area. The panel sits in a square `border bg-card` section (BusinessFactsView line 48). The underline tabs differ from the pill SegmentedTabs elsewhere. | Section: `rounded-xl overflow-hidden` (Card), plus the header fix above. |
| Color & contrast | 8 | The 12 px muted metadata line is fine. The "Asked 2×" chip is bold 11 px on a beige fill, borderline. | Chip: `text-xs font-medium` and `bg-muted text-foreground`. |
| Efficiency | 9 | One pick resolves the question with an Undo toast, and Create fact is one tap away. | — |
| Clarity | 8 | The "New" filter has no visible label. The search placeholder is long ("Search missing-information reports"). | Use the Select trigger label "Status: New". Placeholder: "Search questions". |
| States & feedback | 9 | Skeleton, four empty-state variants, pending-disabled rows and an Undo toast are all present. | — |
| Responsive | 7 | No desktop capture (the "desktop" file is 1180 px). On the phone the select truncates. On iPad the Question column is 600 px wide for 30-character questions while Resolve is cramped. | Capture at 1440. Table: `lg:[&_th:nth-child(2)]:w-[45%]`. Phone: select `flex-1` + button `shrink-0` with the shorter placeholder. |
| Accessibility | 7 | `SelectCheckbox` is `pointer-coarse:size-5` (20 px), with no padded hit area. | Wrap it in `<label className="grid size-11 place-items-center -m-3">` on coarse pointers. |

---

## Visual bugs

1. **"+3 more" in empty cells (Fri 13, Sat 14).** Bookings hide behind the pill even though the cell has free lanes. — `extra-hotel-calendar-ipad.png`, `extra-hotel-calendar-phone.png`
2. **"+N more" pills misaligned.** They sit at the top of the cell on 13 and 14 but below the bar on 11 and 12. — `extra-hotel-calendar-ipad.png`
3. **Today cell (12) has a heavier bottom border** than its neighbours. — `extra-hotel-calendar-ipad.png`
4. **Bars truncated to nothing on the phone.** "M…" for Maya Lin, "Somchai Pras…", "Anna Schmidt · Lagoon …". The "+3 more" on Sat clips at the right edge. — `extra-hotel-calendar-phone.png`
5. **The phone Balance-due KPI is 16 px** next to 28 px siblings. — `extra-hotel-calendar-phone.png`
6. **The drag hint shows on the phone** ("Drag across days to book…"). This is a fine-pointer capture artefact, but it also wraps to 2 lines. — `extra-hotel-calendar-phone.png`
7. **The now-line strikes through "Ken Tanaka"** on the event card. — `extra-staff-calendar-ipad.png`, `extra-staff-calendar-phone.png`
8. **The phone staff grid is clipped to 08:00–11:00** with ~100 px of blank page below the legend. The card text cuts off at "Thai massage 6". — `extra-staff-calendar-phone.png`
9. **Closed-hours shading stops ~14 px short of each column's right edge.** — `extra-staff-calendar-ipad.png`
10. **The staff calendar container is square** while the hotel calendar is rounded. — `extra-staff-calendar-ipad.png` vs `extra-hotel-calendar-ipad.png`
11. **Chat list names truncated at iPad width:** "Anna …", "Somcha…", "Kenji Wa…". — `extra-chats-ipad.png`
12. **Phone chat header property truncated:** "Tideglass Pool Resid…". — `extra-chats-phone.png`, `ux-p6-phone-chat.png`
13. **The phone resolve select truncates to "Resolve…".** — `extra-missing-information-phone.png`
14. **New booking: the phone placeholder looks like a filled value** (darker and larger than the other placeholders). The "Coupon code (optional)" label is cut at the scroller edge with no fade. — `ux-p5-new-booking-phone.png`
15. **New booking: "Create as confirmed" renders as a faint 12 px caption** beside a 16 px checkbox. — `ux-p5-new-booking-phone.png`
16. **Appointment sheet: an orphan "Mark arrived" row and three empty "—" rows.** — `extra-appointment-sheet-ipad.png`, `extra-appointment-sheet-phone.png`
17. **Stay sheet: the notes textarea is a bordered box inside a bordered card.** — `extra-stay-sheet-ipad.png`, `extra-stay-sheet-phone.png`

No toast-over-input problems are visible in these captures. ChatsView doesn't use `Toast`. MissingInformationPanel's Undo toast clears `data-admin-bottom-bar` pages only, which is fine here.

## Below 9, by impact

1. Hotel calendar · Responsive · 5 · The phone needs an agenda/list view below sm, a one-row toolbar, and New booking in thumb reach.
2. Staff calendar · Responsive · 5 · Phone defaults to Agenda (or one staff column), a 2-row toolbar, a full-height grid, and the legend moved into ⋯.
3. Hotel calendar · Layout · 6 · Fix the month-view lane overflow so free lanes show bookings, pin "+N more" to the cell bottom, and show 5-row months.
4. Hotel calendar · Accessibility · 6 · The "+N more" pill is 16 px. Make it `h-6`/`pointer-coarse:h-7` and add a non-colour status cue on bars.
5. Staff calendar · Layout · 6 · Put the now-line under events, use a full-height phone grid, and make closed-hours shading `inset-x-0`.
6. Staff calendar · Consistency · 6 · Use a rounded Card container and share one calendar header with Hotel (Today, segmented view control).
7. Chats · Clarity · 6 · Replace "AI on · Next issue: AI" with one plain chip, and cut the reply-window copy to 2 sentences.
8. New booking · States · 7 · Show the reason the button is disabled in the footer, not at the bottom of the scroller.
9. Appointment sheet · States/Accessibility · 7 · Replace the disabled `ButtonLink` (keyboard can still activate it) with a disabled Button, and show a skeleton for the amount.
10. Appointment sheet · Efficiency/Clarity · 7 · Make the linked stay a named link, make phone and email tappable, and use "Room ready 11:05".
11. Appointment sheet · Layout · 7 · Hide empty rows and fold "Mark arrived" into the header or money row.
12. Chats · Typography · 7 · Move the villa name to line 2 so guest names show in full at iPad width.
13. Hotel calendar · Typography/Efficiency/Clarity/Consistency · 7 · Shorter phone bar labels, a chevron on KPI tiles, "Due from today's guests", and one header pattern.
14. Missing information · Hierarchy/Typography/Consistency/Responsive/Accessibility · 7 · Add a serif page title, use normal-case headers, a rounded Card, 44 px checkbox hit areas, and a desktop capture.
15. New booking · Typography/Consistency/Accessibility · 7 · en-GB dates, a full-size "Create as confirmed" (as a Confirmed · Pending segmented control), switch rows instead of 16 px checkboxes, and a fixed placeholder colour.
16. Staff calendar · Efficiency/Clarity · 7 · Hint the sideways staff scroll, make "2 booked in view" match what is visible, and add a closed-hours legend swatch.
17. Stay sheet · Typography/Layout/Consistency/Efficiency/Clarity/Responsive · 8 · `tel:`/`mailto:` links, "Record payment…", a borderless notes field, a matching eyebrow, and a lighter iPad overlay.
18. Chats · several at 8 · Show "Answer as a business fact" only on the latest unanswered message on touch, hide Shortcuts on touch, and use a darker amber for the timer.
