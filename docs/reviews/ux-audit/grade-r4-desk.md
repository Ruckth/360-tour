# Grade R4: bookings desk, calendars and chats

Grader: fresh-eyes senior product designer. Sources: `docs/screenshots/audit-r4/` (the files listed under each screen) plus code for the states a screenshot can't show. iPad 1180×820 and phone 390×844 are touch-emulated; `ux-p6-desktop-missing` is 1440, non-touch. I scored the locked decisions in `design-decisions.md` only on how well they're executed.

Note: the screenshots are fixture scenes without the app shell. Where the shell changes what a user sees (a duplicated page title), I took that from `AdminShell.tsx` and say so.

## Summary

| Screen | Hier | Type | Layout | Consist | Color | Effic | Clarity | States | Resp | A11y | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Stay sheet | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |
| Appointment sheet | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **9.0** |
| Hotel calendar | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | 8 | 9 | **8.9** |
| New booking | 9 | 9 | 8 | 9 | 9 | 9 | 9 | 9 | 9 | 9 | **8.9** |
| Chats | 9 | 9 | 9 | 8 | 9 | 9 | 8 | 9 | 9 | 9 | **8.8** |
| Staff calendar | 9 | 9 | 8 | 9 | 9 | 9 | 8 | 9 | 9 | 8 | **8.7** |
| Missing information | 8 | 8 | 8 | 9 | 9 | 9 | 8 | 9 | 9 | 9 | **8.6** |

**Area average: 8.84.** **Screens at 9+ in every category: 2 of 7** (stay sheet and appointment sheet).

---

### Stay sheet (extra-stay-sheet-ipad, extra-stay-sheet-phone, ux-p5-stay-sheet-ipad)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The balance (36px sans) and the dark Take payment button lead. Details recede into a key-value card. | Nit: "Record external payment…" is a semibold, near-black ghost button, so on iPad it reads almost as loud as the primary. Use `font-medium text-muted-foreground hover:text-foreground` in `BookingFinancials.tsx:241`. |
| Typography | 9 | Serif name 24px, labels 13px muted in a fixed 96px column, values 14px. Money is `font-sans tabular-nums`. | — |
| Layout & spacing | 9 | Three Cards on a 20px rhythm. The header actions line up with the title. | Nit: on phone there's a 1px left border on the full-width sheet (`extra-stay-sheet-phone`). Add `max-sm:border-l-0` to the sheet content. |
| Consistency | 9 | Same header (eyebrow · serif name · badge · ghost ✎ ⋯ ✕) and the same money card as the appointment sheet. | — |
| Color & contrast | 9 | Blue "Confirmed" badge. Everything else is neutral. | — |
| Efficiency | 9 | Take payment is one tap. Edit and ⋯ are in the header. Notes save inline and only when changed. | — |
| Clarity | 9 | "Stay ฿26,000 · Spa ฿1,500" explains the total. Plain labels. | — |
| States & feedback | 9 | Skeleton, "Booking not found", inline `role=alert` errors, spinners per action, "Load the latest notes" on a revision clash. Edits are blocked with a reason while checkout is live. | — |
| Responsive | 9 | Phone stacks Take payment full-width with the external-payment link under it. iPad puts them side by side. | — |
| Accessibility | 9 | Icon buttons are labelled ("Edit stay", "More booking actions", "Close"). Tel/mailto links are 44px tall. The InfoTip has a 44px `::after` area. | — |

### Appointment sheet (extra-appointment-sheet-ipad, extra-appointment-sheet-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Balance ฿1,200 plus Take payment. "Mark arrived" sits beside the status badge, as locked. | — |
| Typography | 9 | Matches the stay sheet. "Room ready 11:05" is a muted secondary line. | — |
| Layout & spacing | 9 | Clean card stack. The Villa stay row has a chevron affordance. | Nit: the 22px "Booked" badge next to the 44px "Mark arrived" button leaves the badge looking stranded. Add `h-7` to the StatusBadge in that row (`AppointmentSheet.tsx:181`) so the pair reads as one unit. |
| Consistency | 9 | Same component set as the stay sheet. History is a Disclosure card. | — |
| Color & contrast | 9 | Neutral, apart from the teal staff avatar. | — |
| Efficiency | 9 | Arrive, pay, and jump to the linked stay are one tap each. | — |
| Clarity | 9 | Staff row reads "Nok · Therapist". "until Sat 14 Nov" gives stay context. | — |
| States & feedback | 9 | Spinner on the status action, alert errors, money skeleton. | — |
| Responsive | 9 | Phone stacks the actions. Thumb reach is good. | — |
| Accessibility | 9 | "Edit appointment" and "Close" are labelled, and Close is disabled while a save is in flight. | — |

### Hotel calendar (extra-hotel-calendar-ipad, extra-hotel-calendar-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | KPI strip, then the calendar. "New booking" is the only filled button. | — |
| Typography | 9 | KPI values are 28px on iPad and 18px on phone. Day numbers are 13px top-left. Bars use two 12–13px lines. | — |
| Layout & spacing | 9 | Rows grow with content (locked). Bars sit cleanly. | Nits: (1) the today cell (12) is shaded only in a ~30px band behind the number, which looks like a stray grey block. Apply `todayClassName` to the whole cell in `event-calendar-month-view.tsx:~1004`, or drop the fill, since the filled circle already marks today. (2) Phone list: the "Paid"-only row centres its badge while other rows top-align amount and badge. Use `self-start` on the right column. |
| Consistency | 9 | Same toolbar pattern as the staff calendar. The view switch is the subtle segmented control. | — |
| Color & contrast | 9 | Blue = balance due, green = paid, amber dashed = pending, each with an icon and a legend. | — |
| Efficiency | 9 | KPI tiles expand into guest lists. Search by guest, phone or code. ⋯ holds the rarer tools. | — |
| Clarity | 9 | Legend text explains the encodings ("Pending · dashed border"). | — |
| States & feedback | 9 | Toolbar spinner while loading. "No villas yet" call to action. A destructive banner when a load is incomplete. Move errors stay inline. | Nit: an empty month gives no "No stays in November" hint. |
| Responsive | **8** | Phone defaults to List with a 4-up KPI strip, which is good. But the list sits inside a fixed-height inner scroller (`h-[calc(100dvh-13rem)]`, `scrollMode="contained"`) under a page that also scrolls. The card clips at the viewport ("Maya Lin ฿8,500 due" is cut at the bottom), so you get two scroll regions on an 844px screen. The staff calendar's phone list scrolls with the page. | `AdminBookingsView.tsx:348–349`: when `phone && view === "agenda"`, use `scrollMode="page"` and `className="[--ec-month-bar-h:2.375rem] w-full"`, mirroring `AdminStaffBookingsView.tsx:560`. |
| Accessibility | 9 | 44px targets are enforced by `touch-targets-b.spec.ts`. Status uses icon, colour and label. Day cells are keyboard-operable. | — |

### Staff calendar (extra-staff-calendar-ipad, extra-staff-calendar-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Day grid with staff columns. "New appointment" is primary. The now-line is red. | — |
| Typography | 9 | Staff name 14 semibold over a 12px count. Event title semibold with a 12px meta line. | — |
| Layout & spacing | **8** | The "Next 16:00 ↓" cue is `absolute right-0` in Mali's column header with no reserved space. It already crowds "1 appointment", and with a longer name (e.g. "Supaporn K.") it would overlap the name. The 16:00 card also peeks as a 2px sliver above the legend. | `AdminStaffBookingsView.tsx:742`: render the cue inline in the count line instead of absolute ("1 appointment · Next 16:00 ↓") as `variant="link"` with `h-auto p-0 text-xs pointer-coarse:min-h-11`, or reserve `pe-28` on the header when a cue exists. |
| Consistency | 9 | Toolbar matches the hotel calendar. The phone list matches the hotel phone list. | — |
| Color & contrast | 9 | Status colours plus icons. The legend is 12px muted and readable. | — |
| Efficiency | 9 | "4 of 4 staff" and Filters are one tap. The off-screen cue jumps straight to the next appointment. | — |
| Clarity | **8** | The "Turnaround" block uses the same diagonal hatch as "Not working" in the legend, so it reads as the therapist being off. | In `AdminStaffBookingsView.tsx:360`, when `eventData.kind === "turnaround"`, swap the hatch for `bg-muted/60 border border-dashed border-border` and use a `Timer` icon. Keep the hatch for Not working (`:356`) only. Breaks and turnaround currently share both the hatch and the Clock icon. |
| States & feedback | 9 | "No appointments." with a New appointment button. Separate setup empty states for no staff and no services. Alert banner, loading spinner. | — |
| Responsive | 9 | Phone switches to List, puts search behind an icon, and keeps staff and Filters as chips. iPad shows four columns. | — |
| Accessibility | **8** | The legend uses `Clock` for both "Booked" and "Break or time off" (`AdminStaffBookingsView.tsx:80` and `:640`). Only the icon colour (slate-700 vs muted) tells them apart, so the meaning is colour-only. | Use `Coffee` (lucide) for breaks in the legend (`:640`) and on break events (`:362`). |

### Chats (extra-chats-ipad, extra-chats-phone, ux-p6-phone-chat)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The selected row is tinted with a gold bar. "Waiting 3m" is bold amber. The thread fills the pane. The composer is pinned. | — |
| Typography | 9 | Row name 15 medium, place 12, preview 14. Header name 16 semibold, meta 13 muted. | — |
| Layout & spacing | 9 | Two-pane on iPad. Composer and Send are 44px. Bubbles have room to breathe. | — |
| Consistency | **8** | (1) In the real app the shell header already shows the h1 "Chats", and `ChatsView.tsx:630` shows a second serif "Chats" in the list card at md+ (`max-md:sr-only`), so iPad and desktop say it twice. (2) The "Needs you" badge comes before the channel · property text on phone but after it on iPad. | (1) Change the h2 to `sr-only` at all widths. Keep the Shortcuts button and right-align it with the tabs. (2) In `AdminSessionDetail.tsx:380–386`, render `StatusBadge` first in the `sm:flex` row, as on phone. |
| Color & contrast | 9 | Amber is used only for waiting. AI bubbles are lavender and labelled "AI". The disabled Send is clearly disabled. | — |
| Efficiency | 9 | "No reply needed" settles the chat and opens the next one. Desktop has the `e` shortcut. Filters show as removable chips. | Nit: no count on the "Needs you" tab. |
| Clarity | **8** | On phone, "No reply needed" is an icon-only ✓✓. Double-check reads as "read receipt", and the `title` tooltip never shows on touch. Every guest bubble also repeats "Anna Müller" above it in a one-to-one thread. | (1) In `AdminSessionActions.tsx:135`, show the label on phone too (`<span>No reply needed</span>`, no `hidden sm:inline`). To make room, move "Chat details" ⓘ into ⋯ below `sm`. (2) In the transcript, print the author label only when the author changes from the previous message. |
| States & feedback | 9 | List skeleton. Distinct empty copy for search, Needs you ("You're all caught up…") and first use. Send spinner, send error, "A new guest message arrived…" guard, follow-up and action errors. | — |
| Responsive | 9 | Phone goes list → thread with Back. The header fits in two rows. The composer is in thumb reach. | — |
| Accessibility | 9 | Back, details, settle and search are labelled. Channel icons have sr-only names. The settle-row hover button is hidden on coarse pointers. | — |

### Missing information (extra-missing-information-ipad, extra-missing-information-phone, ux-p6-desktop-missing)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | **8** | Each row has three equal-weight actions (a muted "Resolve…" trigger, then "Create fact" and "Open chat" as ghost buttons) plus ⋯. Nothing says which one to use. The muted "Resolve…" text also looks like an empty field. | `MissingInformationPanel.tsx:536–543`: drop the inline "Open chat" at lg. It's already in ⋯ (`:592`), as on phone. Give the Resolve trigger `text-foreground` (`:648`) so it reads as an action. |
| Typography | **8** | On phone the property name truncates to "Tideglass …" (`extra-missing-information-phone`). | `MissingInformationPanel.tsx:483`: `flex-nowrap` → `flex-wrap gap-y-1`. Remove `truncate` from the property span (`:501`) below lg. |
| Layout & spacing | **8** | On desktop the select-all checkbox (x≈201) doesn't line up with the row checkboxes (x≈207), because the header has `[&_label]:pointer-fine:size-8` and the rows don't (`:425`). | Apply the same `pointer-fine:size-8` box to the row `SelectCheckbox` cells, or remove it from the thead, so both columns share one box. |
| Consistency | 9 | Same Card, toolbar, select and stacked-table pattern as the other lists. | Nit: two chip styles in one meta line (filled "Asked 2×", outlined topic). |
| Color & contrast | 9 | Neutral. Destructive text appears only on row errors. | — |
| Efficiency | 9 | Picking a resolution resolves at once with a Toast Undo. Bulk select. Create fact is one tap. | — |
| Clarity | **8** | In the real app the page is "Business facts" (shell h1), then a serif h2 "Missing information", then a selected tab also called "Missing information". That's three titles for one view. "Resolve…" doesn't say it resolves by picking an existing fact. | `BusinessFactsView.tsx:41`: drop the h2/description header (the tab already names the section). Rename the trigger copy to "Resolve with a fact…" (`MissingInformationPanel.tsx:649`). |
| States & feedback | 9 | SkeletonRows. Empty states per search and per status. "Resolving…" status. Per-row alert errors. Combobox loading and empty text. "Truncated" notice. | — |
| Responsive | 9 | Phone stacks the row with Resolve and Create fact side by side and ⋯ top-right. Desktop is held to `max-w-6xl`. | — |
| Accessibility | 9 | Labelled search, status select and combobox. Channel icons have sr-only labels. 44px targets are covered by the spec. | — |

### New booking (extra-new-booking-ipad, extra-new-booking-phone, ux-p5-new-booking-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Three titled groups (Stay · Guest · Price). The footer holds only the 18px total and Create booking. Block-instead is a ghost under the dates (locked). | — |
| Typography | 9 | 16px semibold group titles, 12px muted labels, 18px sans total. | — |
| Layout & spacing | **8** | (1) On iPad the Price row is misaligned: the "Custom price" card (y 618–667) has no label above it, so it doesn't line up with the labelled Coupon input (636–679). (2) On phone the footer's top border slices through the "Coupon code (optional)" label, with no scroll-edge cue. | (1) `NewBookingDialog.tsx:384`: give Custom price the same structure as the coupon field: a `Label` "Custom price" above, then an `h-11` bordered row holding "฿12,000/night" and the switch. Tops and bottoms then align. (2) Add `shadow-[0_-8px_12px_-10px_rgb(0_0_0/0.15)]` to the `DialogFooter` (`:466`) so content visibly scrolls under it. |
| Consistency | 9 | Subtle segmented control for Confirmed/Pending. Same pickers as the edit dialog. | Nit: hand-rolled `role=switch` (there's no `ui/switch`). Fine, but extract it if a second one appears. |
| Color & contrast | 9 | Neutral. The disabled Create button is clearly disabled and has a reason line. | — |
| Efficiency | 9 | Villa and dates come prefilled, Confirmed and 2 guests are defaults, and past guests are suggested from the phone number. | — |
| Clarity | 9 | "Guests (max 4)". "Enter the guest's name and phone number." explains why the button is disabled. | — |
| States & feedback | 9 | Unsaved-change guard on close and on block-instead. Fieldset is disabled while saving, with a spinner. Coupon check is live. Availability failure has a Retry. The entered values survive a failed submit. | — |
| Responsive | 9 | Full-height on phone with the footer outside the scroller. Check-in and check-out stay side by side on phone. | — |
| Accessibility | 9 | Section `aria-labelledby`, `aria-invalid` plus described-by errors, a labelled switch, `aria-live` footer. Covered by the touch spec. | — |

---

## Visual bugs

1. **extra-hotel-calendar-phone**: the List view is clipped inside a fixed-height inner scroller (the card ends at y≈815 and "Maya Lin ฿8,500 due" is cut), on top of the page scroll.
2. **extra-staff-calendar-ipad**: the "Next 16:00 ↓" cue is absolutely positioned over Mali's column header with no reserved space, and overlaps with longer names.
3. **extra-staff-calendar-ipad**: the legend uses the same Clock icon for "Booked" and "Break or time off". The "Turnaround" hatch is identical to the "Not working" swatch.
4. **extra-new-booking-ipad**: the Custom price card and the Coupon input are vertically misaligned (about 18px at the top, 12px at the bottom).
5. **extra-new-booking-phone / ux-p5-new-booking-phone**: the "Coupon code (optional)" label is sliced by the footer border, with no scroll shadow.
6. **ux-p6-desktop-missing**: the select-all checkbox is about 6px left of the row checkboxes.
7. **extra-missing-information-phone**: the property name truncates to "Tideglass …".
8. **extra-hotel-calendar-ipad**: the today cell is shaded only in a ~30px band behind "12" instead of the whole cell.
9. **extra-hotel-calendar-phone**: the "Paid"-only row centres its badge while other rows top-align.
10. **extra-chats-ipad vs extra-chats-phone**: the "Needs you" badge is in a different position in the header meta row (after the text on iPad, before it on phone).
11. **Chats, iPad/desktop (from code)**: a second "Chats" serif title in the list card under the shell's "Chats" h1.
12. **extra-stay-sheet-phone / extra-appointment-sheet-phone**: a 1px left border is visible on the full-width phone sheet (nit).
13. **extra-staff-calendar-ipad**: a 2px sliver of the 16:00 event peeks above the legend (nit).
