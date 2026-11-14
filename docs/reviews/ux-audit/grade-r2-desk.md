# R2 grade: bookings desk, calendars and chats

Graded from `docs/screenshots/audit-r2/` (iPad 1180×820 and phone 390×844 touch captures, desktop 1440 non-touch) plus the code in `src/components/admin/`, `src/components/reui/event-calendar/`, `src/components/ui/` and `src/hooks/`. I used only the rubric and the visual brief as reference. Scores are strict: a 9 means I would ship it with one nit at most.

## Summary

| Screen | Avg |
|---|---|
| Stay sheet | 8.5 |
| Appointment sheet | 8.4 |
| Hotel calendar | 8.0 |
| Staff calendar | 8.6 |
| Chats | 8.3 |
| Missing information | 8.3 |
| New booking | 8.4 |
| **Area** | **8.4** |

Problems that show up on several screens:
- **12px buttons on touch.** `Button size="sm"` is `text-xs` (12px semibold) inside a 44px touch box. Examples: "Mark arrived", "New booking", "4 of 4 staff", "Filters", "No reply needed", "Open chat". Fix in one place: `src/components/ui/button.tsx` `sm: "h-9 px-3 text-xs pointer-coarse:text-sm"`.
- **Surfaces don't match.** Sheets mix `Card px-4`, a raw `section rounded-xl border bg-card p-5` and a raw `div ... p-4`. The appointment sheet's history sits in a `border-t` band instead of a card.
- **Same job, different names.** Chats has "Save answer for AI" where Missing info has "Create fact". The hotel calendar says "List" where the staff calendar says "Agenda". The chat button reads "Done" on phone and "No reply needed" on iPad.

---

### Stay sheet (extra-stay-sheet-ipad.png, extra-stay-sheet-phone.png, ux-p5-stay-sheet-ipad.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The ฿27,500 balance hero is the first thing you see, with one filled "Take payment" button. Edit, ⋯ and ✕ are ghost icons in the header, as the brief asks. | — |
| Typography | 9 | Hero is `font-sans text-4xl font-semibold tabular-nums`. Rows are 13px muted label (96px column) and 14px value. Serif is used only for the guest name. | — |
| Layout & spacing | 8 | On phone, "Paid elsewhere…" + ⓘ wraps to its own line, and the ghost button's padding pushes it 16px right of Take payment's edge. The notes card is a large empty textarea at the bottom. | `BookingFinancials.tsx` line 224 action row: on phone, stack both buttons full width (`max-sm:grid max-sm:grid-cols-1`, Take payment `h-12 w-full`, Paid elsewhere `w-full justify-center`, with the ⓘ inside the ghost button's trailing slot). Textarea `min-h-20` with `field-sizing-content`. |
| Consistency | 8 | Three paddings across three surfaces: money is a raw `section ... p-5`, details are `Card px-4`, notes are a raw `div ... p-4`. | Use `Card` for all three with one padding (`p-4`). Swap the raw section/div in `BookingFinancials.tsx:212` and `BookingSheet.tsx:343`. |
| Color & contrast | 9 | Neutral palette. The status chip is tinted and labelled. | — |
| Efficiency | 9 | Take payment is one tap. Save notes appears only when the notes have changed. Rare actions are in ⋯. | — |
| Clarity | 8 | "Paid elsewhere…" is a bare text button whose meaning is in an ⓘ. Phone and email are links that look like plain text. | Rename to "Record other payment…" (keep the ⓘ). Add `underline decoration-muted-foreground/40 underline-offset-4` to the tel/mailto links in `BookingSheet.tsx`. |
| States & feedback | 8 | "Notes saved." shows as a `notice` above the details card, far from the notes field and off screen on phone. Loading skeleton, not-found state and notes revision conflict are handled well. | Move the notes success line inline under the Save notes button: add a `notesNotice` state rendered next to `notesError`. Keep `notice` for header actions only. |
| Responsive | 8 | iPad sheet width (30rem) is good. Phone payment row wraps (see Layout). | Same fix as Layout. |
| Accessibility | 9 | Icon buttons have aria-labels, links are `min-h-11`, buttons get `pointer-coarse:min-h-11 min-w-11` from the shared Button, and there is an unsaved-notes guard. | — |

### Appointment sheet (extra-appointment-sheet-ipad.png, extra-appointment-sheet-phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | "Mark arrived" sits alone between the header and the money card, as a third band competing with the balance hero. | `AppointmentSheet.tsx:206`: render the next-step button inline with the StatusBadge (`SheetDescription className="mt-2 flex items-center gap-2"`) so status and next step read as one unit, and remove the empty-able `div`. |
| Typography | 8 | "Mark arrived" is `size="sm"` (12px semibold) while every other button on the sheet is 14px. | Drop `size="sm"` (or apply the global `pointer-coarse:text-sm` fix). |
| Layout & spacing | 8 | Same "Paid elsewhere…" wrap on phone as the stay sheet. History is a `border-t pt-4` band, not a card, so the sheet ends with a loose divider row. | Stacked phone action row as on the stay sheet (`AppointmentFinancials.tsx:83`). Wrap the financials and history block (`AppointmentSheet.tsx:268`) in `Card className="p-4 shadow-none"`. |
| Consistency | 8 | The history band doesn't match the stay sheet. The "Villa stay" row is a `Button variant="link"` styled as plain text, unlike other tappable rows. | Card the history section. Style "Villa stay" as a navigable row: add `ChevronRight` and `underline-offset-4 hover:underline`. |
| Color & contrast | 9 | Fine. The money action switches to outline while a balance is due, so there's one filled button. | — |
| Efficiency | 9 | One next-step button. Corrections are grouped under one "Fix time, turnaround or status…" item. | — |
| Clarity | 8 | Nothing shows that "Ocean Suite · until Sat 14 Nov" opens the stay. | Add a chevron and the copy "Open stay · Ocean Suite, until Sat 14 Nov" (sr-only prefix "Open stay"). |
| States & feedback | 9 | Money skeleton, "Loading stay…", inline error/notice, buttons disabled while fees are pending, unsaved draft guard, Escape and outside clicks blocked while saving. | — |
| Responsive | 8 | Phone payment row wraps. | Same as Layout. |
| Accessibility | 9 | Labelled icon buttons. The title carries a "Appointment ·" sr-only prefix. Tap targets are 44px. | — |

### Hotel calendar (extra-hotel-calendar-ipad.png, extra-hotel-calendar-phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Today tiles, then the calendar. "New booking" is the only filled button. | — |
| Typography | 8 | Toolbar labels are 12–13px semibold ("New booking", the phone "List" picker `text-xs`). Bars are two 12px lines, which is fine. | Global `sm` button `pointer-coarse:text-sm`. In `AdminCalendarHeader.tsx` mobile view `SelectTrigger`, change `text-xs` to `text-sm`. |
| Layout & spacing | 7 | iPad: the week of 29–30 Nov is missing. The month body scrolls inside the card, the second week grows four bar lanes tall, and nothing shows there is more below the legend. Phone: the grey day-header band stops 10px short of the card's right edge. | Month: give rows equal height and cap lanes, e.g. AdminBookingsView `className="[--ec-month-bar-h:2rem]"` and `maxEventsPerCell={3}` (currently `"auto"`) so extra stays fold into "+N more". If it must scroll, add a bottom fade (`[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]`). Agenda header in `event-calendar-agenda-view.tsx:146`: `!native && "me-2.5 pointer-coarse:me-0"`. |
| Consistency | 7 | Search is an icon button on the iPad hotel calendar but a full input on the staff calendar. Phone hotel hides search in ⋯ while phone staff shows a search icon. "List" here vs "Agenda" on staff for the same view. | Use the staff pattern on both: an inline `Input` w-60 at `sm+` and a search icon Popover on phone (`AdminBookingsView.tsx:346`). Use one name for the view in `CALENDAR_I18N` and the staff i18n ("List" on both). |
| Color & contrast | 8 | Confirmed and Pending bars both carry a clock icon. The legend explains colours only, not the clock, the check or the dashed pending border. | Add to the legend row in `AdminBookingsView.tsx:401`: "◷ Balance due · ✓ Paid · dashed = pending". |
| Efficiency | 8 | Phone search takes three taps (⋯ → Search bookings → dialog). | Search icon button in the phone toolbar (see Consistency). |
| Clarity | 8 | The clock icon is undefined. The phone tile label "Due" is shortened from "Balance due". | Legend fix above. Phone tile label "Owed". |
| States & feedback | 9 | Loading spinner and skeleton tiles; "No stays in this period" with a New booking button; "No villas yet" with Add a villa; incomplete-load alert; move errors inline; undo toasts. | — |
| Responsive | 8 | Phone defaults to the list view and a compact 4-up strip, both good. iPad loses the last week (see Layout). | Same as Layout. |
| Accessibility | 8 | Pending vs confirmed is told apart only by colour plus a dashed border; both use the same icon. | In `AdminBookingsView.tsx:253`, use `CircleDashed` for pending and keep `Clock` for confirmed-with-balance. |

### Staff calendar (extra-staff-calendar-ipad.png, extra-staff-calendar-phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Staff columns, the now line and the primary New appointment button are clear. | — |
| Typography | 8 | Event block crams a 14px bold name, a 12px "Booked" chip and a 12px meta line. Toolbar buttons are 12px semibold. | Hide the "Booked" chip in blocks for the default status (as the agenda already does). Global `sm` text fix. |
| Layout & spacing | 8 | An unlabelled ~12px hatched "not working" sliver sits above 09:00 in every column. Phone: the agenda card is a fixed `h-[calc(100dvh-13rem)]`, leaving ~420px of empty white card below two rows. | Start the grid exactly on the first working hour (round `minTime` down to the hour). Phone: `h-auto max-h-[calc(100dvh-13rem)]` on the EventCalendar when `view === "agenda"`. |
| Consistency | 8 | The agenda hides the "Booked" chip, while the hotel list always shows a status chip. "Agenda" vs hotel "List". | Pick one rule for both lists (show the chip only when it isn't the default status) and use one view name. |
| Color & contrast | 9 | Status colours always come with a text chip. | — |
| Efficiency | 9 | Tap a slot to book, filter popovers, search inline on iPad. | — |
| Clarity | 8 | The "↓ 16:00" pill is cryptic. "2 booked in view" counts appointments that are off screen. | `AdminStaffBookingsView.tsx:720` label `Next {time} ↓` / `Earlier {time} ↑`. Change "booked in view" to "{n} today" in day view and "{n} this week" in week view. |
| States & feedback | 9 | Loading spinner; "No appointments" with a button; no staff/services setup banner; error banner; New appointment disabled with a reason. | — |
| Responsive | 9 | iPad shows all four staff columns. Phone defaults to the agenda. | — |
| Accessibility | 9 | Off-screen cue has an aria-label; checkbox rows are min-h-11; legend has text labels. | — |

### Chats (extra-chats-ipad.png, extra-chats-phone.png, ux-p6-phone-chat.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Transcript and composer dominate. "Waiting 3m" in amber shows urgency in the list. | — |
| Typography | 8 | Phone subtitle wraps ("Website · Tideglass / Pool Residence") because of `text-balance`. The list title "Chats" is 16px sans while other pages use serif titles. "No reply needed" is 12px semibold. | `AdminSessionDetail.tsx:364` subtitle: `truncate` instead of `text-balance`. `ChatsView.tsx:630` title `font-serif text-2xl font-semibold`. Global `sm` text fix. |
| Layout & spacing | 8 | The phone header grows to three lines (88px). | The truncate fix keeps it at two lines. |
| Consistency | 8 | "Save answer for AI" here vs "Create fact" in Missing info for the same job. "Done" on phone vs "No reply needed" on iPad. | Rename to "Create fact" (`AdminSessionDetail.tsx:455`). Use the same visible label at both sizes (icon + "Done" with the ⓘ tooltip "No reply needed"), or icon-only on phone as the brief says. |
| Color & contrast | 9 | Amber is used only for waiting. The AI bubble is tinted and labelled "AI". | — |
| Efficiency | 9 | "e" shortcut, the next chat opens automatically, Enter sends. | — |
| Clarity | 7 | The header says "AI couldn't answer" while the transcript shows the AI did answer and the guest said thanks. "Save answer for AI" sits under "That's all I needed." | `automationLabel` when `needsReply`: "Waiting for staff". Show the save/create-fact link only under guest messages the AI escalated (`inboxReason === "unknown"`), not under the latest guest message in general. |
| States & feedback | 9 | Skeleton rows and transcript; tailored empty states (caught up / no match / no chats yet); send error; reply-window warnings; sending spinner; "No reply needed · name" confirmation in the list. | — |
| Responsive | 8 | iPad two-pane layout is good. The phone header wraps (see Typography). | Same truncate fix. |
| Accessibility | 8 | On phone the status is only an amber/green dot. The label is `sr-only`, so sighted users get colour only. | Replace the dot with a compact text chip on phone (`StatusBadge` with `text-[11px] px-1.5`, "Needs you"), or prefix the subtitle with "Needs you ·". |

### Missing information (extra-missing-information-ipad.png, extra-missing-information-phone.png, ux-p6-desktop-missing.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Each row has four equal-weight actions (Resolve…, Create fact, Open chat, ⋯) and no single next step. | Move "Open chat" into the row's ⋯ menu, leaving Resolve + Create fact. |
| Typography | 8 | "Open chat" is 12px semibold next to "Create fact" at 14px medium. | `MissingInformationPanel.tsx:531`: drop `size="sm"`, use `className="px-2 text-sm font-medium"` like Create fact (or move it to ⋯). |
| Layout & spacing | 7 | Phone: "Open chat" is orphaned on its own row, the property name wraps under the date, and each report is ~190px tall, so only three fit. iPad/desktop: the "Status" label floats loose before its select. | Move Open chat to ⋯ (rows drop to ~130px). On phone, put the meta line's property after the topic chip with `truncate`. Toolbar: drop the visible "Status" label and use `aria-label` only, as on phone. |
| Consistency | 8 | "Create fact" vs Chats' "Save answer for AI". Ghost buttons in one row use different sizes. | Same rename as Chats. One ghost style. |
| Color & contrast | 9 | Neutral palette with a muted "Asked 2×" badge. | — |
| Efficiency | 9 | Picking resolves immediately and the toast offers Undo. Bulk select is available. | — |
| Clarity | 8 | The "Resolve…" placeholder doesn't say what it resolves with. The aria-label does, but sighted staff don't get it. | Placeholder "Answer with a fact…" (`MissingInformationPanel.tsx:638`). |
| States & feedback | 9 | Skeleton rows, several empty states, "Resolving…" status, alerts, undo toast. | — |
| Responsive | 8 | Phone rows are squeezed (see Layout). Desktop isn't stretched. | Same as Layout. |
| Accessibility | 9 | Pickers have per-row aria-labels, checkboxes are labelled, touch targets are 44px. | — |

### New booking (extra-new-booking-ipad.png, extra-new-booking-phone.png, ux-p5-new-booking-phone.png)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Stay / Guest / Price groups, Total in an 18px semibold footer, one primary button. | — |
| Typography | 8 | Villa and date values are semibold while text inputs are regular, so filled values look like labels. | Picker trigger values `font-normal` in `VillaPicker` and `DeskBookingRangePicker` triggers, inside the dialog. |
| Layout & spacing | 7 | The scroll fold cuts the Price card in half on both viewports (bottom border missing, villa rate hidden on phone), patched with a "More booking options below ↓" strip. The footer stacks four rows (~150px) and eats the form. | One-row footer in `NewBookingDialog.tsx:473`: `flex items-center justify-between`, with Total + nights on the left and Create booking on the right. Show the reason line underneath only while blocked. Move "Block these dates instead" under the date pickers as a ghost button. Replace the hint strip with a bottom fade mask on the fieldset when `moreFields`. |
| Consistency | 8 | The custom-price switch is hand-built (`button role=switch` + spans) instead of a shared switch component. "Block these dates instead" is a 12px muted ghost button, while other ghost buttons are 14px. | Pull the switch out into `ui/switch.tsx`, reused by Edit stay. Use the default ghost size for Block. |
| Color & contrast | 8 | Disabled "Create booking" is white at 45% opacity on grey, which is faint and looks broken rather than waiting. | `disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100` on the submit button. The reason line already explains it. |
| Efficiency | 9 | Villa, dates and guests are prefilled. Returning-guest suggestions. Coupon is checked live. | — |
| Clarity | 9 | "Enter the guest's name and phone number." explains the disabled state. "Guests (max 4)". | — |
| States & feedback | 9 | Coupon checking spinner; Retry availability; inline phone error; unsaved-changes guard on close and on Block instead; saving disables the fieldset. | — |
| Responsive | 8 | Check-in and check-out sit side by side on phone. The heavy footer and the fold cut hurt the phone most. | Same as Layout. |
| Accessibility | 9 | Labelled sections, aria-invalid / role=alert, switch role, sr-only description. | — |

---

## Below 9, sorted by impact

1. Hotel calendar · Layout · 7: the 29–30 Nov week is hidden with no cue. Equal-height month rows, a 3-lane cap with "+N more", or a bottom fade.
2. New booking · Layout · 7: Price card cut by the fold and a four-row footer. Use a one-row footer (Total left, Create right), move Block under the dates, and use a fade mask instead of the "More options ↓" strip.
3. Chats · Clarity · 7: "AI couldn't answer" contradicts the transcript, and "Save answer for AI" shows under a thank-you. Change the label to "Waiting for staff" and show Create fact only under escalated questions.
4. Missing information · Layout · 7: phone rows are ~190px with an orphaned "Open chat". Move Open chat into ⋯ and truncate the meta line.
5. Hotel calendar · Consistency · 7: search and view names differ from the staff calendar. Same search control on both calendars, and "List" on both.
6. All sheets and toolbars · Typography · 8: 12px semibold `sm` buttons on touch. `button.tsx` `sm` gets `pointer-coarse:text-sm`.
7. Stay and appointment sheets · Layout/Responsive · 8: "Paid elsewhere…" wraps on phone. Stack full-width buttons on phone.
8. Appointment sheet · Hierarchy · 8: "Mark arrived" floats alone. Put it inline with the status badge at default size.
9. Chats · A11y · 8: phone status is a colour-only dot. Use a compact "Needs you" text chip.
10. Hotel calendar · Color/A11y/Clarity · 8: the clock icon is unexplained and pending looks the same as confirmed. Add icons to the legend and use `CircleDashed` for pending.
11. Stay/appointment sheets · Consistency · 8: three different surfaces. Use `Card p-4` throughout and card the history section.
12. Stay sheet · States · 8: "Notes saved." appears far from the notes field. Show it inline under Save notes.
13. Staff calendar · Clarity · 8: "↓ 16:00" and "booked in view". Change to "Next 16:00 ↓" and "2 today".
14. Staff calendar · Layout · 8: hatched sliver above 09:00, and the phone agenda card is mostly empty. Start the grid on the hour and let the agenda card hug its rows.
15. New booking · Color · 8: faint disabled primary. Use muted bg/fg at full opacity.
16. Missing information · Typography/Hierarchy · 8: mixed button sizes and four equal actions. Open chat goes to ⋯ (or text-sm medium).
17. Chats · Typography/Consistency · 8: wrapped phone subtitle, sans page title, "Done" vs "No reply needed". Truncate the subtitle, serif title, one label.
18. Hotel calendar · Efficiency · 8: phone search takes three taps. Search icon in the phone toolbar.
19. New booking · Typography/Consistency · 8: bold picker values and a hand-built switch. `font-normal` values and a shared `ui/switch`.
20. Appointment sheet · Clarity · 8: the "Villa stay" link looks like text. Add a chevron and underline.

## Visual bugs

- **extra-hotel-calendar-ipad.png**: the last week (29–30 Nov) isn't visible. The month body scrolls inside the card below the legend with no scroll cue.
- **extra-new-booking-ipad.png, extra-new-booking-phone.png, ux-p5-new-booking-phone.png**: the Price card is clipped mid-card by the scroll fold (no bottom border). On phone the "Villa rate" line is hidden. A "More booking options below ↓" strip sits above the footer.
- **extra-hotel-calendar-phone.png, extra-staff-calendar-phone.png**: the grey agenda day-header band stops ~10px short of the card's right edge (`me-2.5` scrollbar inset), leaving a visible notch.
- **extra-stay-sheet-phone.png, extra-appointment-sheet-phone.png**: "Paid elsewhere…" + ⓘ wraps to a second line, indented ~16px from Take payment's left edge.
- **extra-chats-phone.png, ux-p6-phone-chat.png**: the header subtitle wraps to "Website · Tideglass / Pool Residence" (three-line header). Status is an amber dot only.
- **extra-missing-information-phone.png**: "Open chat" is orphaned on its own row. "Tideglass Pool Residence" wraps to a separate meta line.
- **extra-missing-information-ipad.png, ux-p6-desktop-missing.png**: "Open chat" (12px semibold) sits beside "Create fact" (14px medium), so the weights and sizes don't match.
- **extra-staff-calendar-ipad.png, extra-appointment-sheet-ipad.png**: an unlabelled ~12px hatched sliver spans all columns above the 09:00 line.
- **extra-staff-calendar-phone.png**: the agenda card runs to a fixed height, about 420px of empty white card under two rows.
- **extra-appointment-sheet-ipad.png, extra-appointment-sheet-phone.png**: "Mark arrived" is a 12px label in a 44px button, floating alone between the header and the money card.
- **extra-new-booking-ipad.png, extra-new-booking-phone.png**: disabled "Create booking" text is faint (white at 45% on grey).
- **extra-chats-ipad.png**: the "AI couldn't answer" chip contradicts the visible AI reply.
- **extra-chats-ipad.png, extra-chats-phone.png**: "Save answer for AI" sits under "Perfect, thank you! That's all I needed."
- **extra-hotel-calendar-phone.png**: phone KPI tiles are tight. Chevrons crowd "In house" and "Due", and "฿44,300" nearly touches the tile edge.
