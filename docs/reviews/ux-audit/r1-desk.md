# R1 audit: bookings desk, calendars and chats

Graded from `docs/screenshots/audit-r1/` and the code in `src/components/admin/`, `src/components/reui/event-calendar/`, `src/components/ui/`, `src/hooks/`. iPad 1180×820 and phone 390×844 are touch; `ux-p6-desktop-missing` is 1440, non-touch. A 9 means it ships with only a nit. No fix below removes a money safeguard, revision check or approval step.

Note: `extra-stay-sheet-ipad.png` and `ux-p5-stay-sheet-ipad.png` are pixel-identical captures.

---

### 1. Stay sheet (extra-stay-sheet-ipad, extra-stay-sheet-phone, ux-p5-stay-sheet-ipad)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Balance due 36px sans hero, Take payment is the one filled button, guest name in serif, Edit/⋯/✕ in the header. | — |
| Typography | 9 | Money is `font-sans tabular-nums`, labels 13px muted, values 14px. | Nit: "by ploy" shows a raw lowercase handle. Make `staffLabel` return the display name. |
| Layout & spacing | 7 | The rows in the `<dl>` have uneven heights: Phone and Email ≈70px, Villa and Source ≈45px. That's because the `tel:`/`mailto:` links carry `min-h-11`. `dt` is `self-center`, so "Stay" and "Created" sit between two lines while "Villa" sits at the top. | `BookingSheet.tsx` `Detail`: use `items-start`, give `dt` `pt-px` (drop `self-center`) and the row `min-h-12`. On the links, keep the hit area without growing the row: `-my-3 inline-flex min-h-11 items-center`. |
| Consistency | 8 | The cards are hand-rolled `rounded-xl border bg-card` and don't use `Card`. In `EditBookingDialog`, Custom price is a native checkbox, while New booking has a switch. Its title is sans, while New booking's is `font-serif text-2xl`. | Wrap the `dl`, notes and money sections in `ui/card.tsx`. In `EditBookingDialog`, use the same switch row as `NewBookingDialog` (extract it to a `ui/switch-row.tsx`) and add `font-serif text-2xl font-semibold` to `DialogTitle`. |
| Color & contrast | 9 | Neutral, with only the status chip in colour. | — |
| Efficiency | 9 | Phone and email are one tap. Payment is one tap. Edit and ⋯ sit in the header. | — |
| Clarity | 8 | "Take payment" (opens the till) and "Record payment…" (logs money received elsewhere) sit side by side with equal weight. Staff have to know the difference. | `BookingFinancials.tsx`: rename to "Paid elsewhere…" and make it `variant="ghost"`, with an `InfoTip` ("Bank transfer or cash taken outside the till"). |
| States & feedback | 8 | Has a loading skeleton, a not-found state, and inline error/notice. Gaps: `EditBookingDialog` has no unsaved guard, so a tap on the backdrop silently drops a half-edited stay. "Notes saved." stays on screen indefinitely. | `EditBookingDialog`: `const { confirmDiscard } = useUnsavedGuard(dirty)`, with `onOpenChange={async o => !o && !saving && await confirmDiscard() && onClose()}`. Clear `notice` after 4s, or send it to `useToast`. |
| Responsive | 9 | 30rem sheet over the calendar on iPad, full width on phone. | — |
| Accessibility | 9 | Icon buttons are labelled and 44px on coarse pointers (`pointer-coarse:min-h-11` in `button.tsx`). Status uses a dot plus text. | — |

### 2. Appointment sheet (extra-appointment-sheet-ipad, extra-appointment-sheet-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The next step, "Mark arrived", is a 44px outlined button jammed against a 20px "Booked" chip inside the title block. It reads like a second chip and competes with Take payment. | `AppointmentSheet.tsx`: move the next-step button out of `SheetDescription` into its own row under the header: `<div className="flex gap-2"><Button className="flex-1 sm:flex-none">…</Button></div>`. Keep the existing balance-due outline/filled swap. |
| Typography | 8 | The "Villa stay" value renders semibold (ghost `Button` inherits `font-semibold`) when every other value is 14px regular. On phone it wraps to "Ken / Tanaka". | Villa stay row: `variant="link"` with `font-normal text-foreground underline-offset-2`. Copy is `Ocean Suite · until 14 Nov`; drop the guest name, which is the same person. |
| Layout & spacing | 7 | Same uneven rows as the stay sheet (Phone ≈70px vs Service ≈45px). The header row grows to 44px because of the button. History sits outside the card with no top rule. | Apply the same `Detail` fix as the stay sheet (the components are shared in spirit, so extract `ui/detail-list.tsx`). Put History in a `Card` or under `border-t pt-4`. |
| Consistency | 8 | On the stay sheet, the next step (Confirm/Reopen) goes below the money card. On the appointment sheet, it goes in the header. | Use one slot for both: a next-step row directly under the header, in `BookingSheet` and `AppointmentSheet`. |
| Color & contrast | 9 | Staff avatar colour is paired with the name. | — |
| Efficiency | 9 | One tap to Mark arrived, and corrections live under ⋯. | — |
| Clarity | 8 | "Open stay · Ocean Suite · Ken Tanaka" repeats the guest. The ⋯ item "Correct…" doesn't say what it corrects. | Rename the ⋯ item to "Fix time, turnaround or status…". Use the Villa stay copy given under Typography. |
| States & feedback | 9 | Pending spinner on the next step, an unsaved guard on the edit form, "Loading stay…", and inline errors. | — |
| Responsive | 8 | On phone, Mark arrived and Take payment are at the very top, out of thumb reach, and the long details push History off-screen. | Below `sm`, pin the next-step row and Take payment in a bottom bar: `sticky bottom-0 -mx-5 border-t bg-card px-5 py-3 sm:static sm:border-0`. Add matching `pb-20` to the sheet body. |
| Accessibility | 8 | The button sits inside `SheetDescription`, so the dialog's accessible description reads "Booked Mark arrived". | Leave only `<StatusBadge>` inside `SheetDescription`. The row move under Hierarchy fixes this too. |

### 3. Hotel calendar (extra-hotel-calendar-ipad, extra-hotel-calendar-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | iPad reads well: KPI tiles, toolbar, month grid, New booking as primary. On phone, four tiles, a full-width New booking and a toolbar take about 300px before the first stay. | Phone: move New booking into the calendar header as `+ New` (as Staff does, via `AdminCalendarHeader primaryAction`) and delete the `w-full sm:hidden` button in `AdminBookingsView.tsx:233`. |
| Typography | 7 | Phone tile labels are `text-[11px]`, below the 12px floor. "Balance due" wraps to two lines and "฿44.3k" is an abbreviation. On iPad, bar labels truncate ("Lena Fischer · Tidegla…"). | `TodayStrip.tsx`: labels `text-xs truncate`. Phone label "Due", full label from `sm:`. Phone value `formatMoney(owed)` at `text-lg`, dropping the k-abbreviation. Bars: show the guest only, with the villa in the aria-label/tooltip, since the villa is clear from the filter or the Villas view. |
| Layout & spacing | 6 | Month rows are equal height, so the one busy week hides three stays behind "+3 more" while three empty weeks waste about 280px. Lena's stay (Wed 11 → Sat 14) breaks into two bars with Thursday missing, because Anna's bar takes the lane on her check-out day. | Month view: let rows size to content, `[grid-auto-rows:minmax(5.5rem,auto)]` with the grid scrolling inside the card, and stop auto-capping lanes from cell height (`event-calendar-month-view.tsx` `autoCap`). Draw the check-out day as a half bar (end at 50% of the cell) so a same-day check-out and check-in share a lane, as PMS calendars do. |
| Consistency | 8 | The toolbar differs from Staff: New booking is in row 1 here, row 2 there. Search is here but not there. Phone primary is full-width here and `+ New` there. List rows show status as plain grey text, while sheets use `StatusBadge`. | Put `primaryAction` at row 1 right in both views. In `renderAgendaEvent`, replace the status `<span>` with `<StatusBadge {...hotelStatus(statusKey(b))} />`. |
| Color & contrast | 8 | Pastel bars separate Confirmed, Paid, Host block and Cancelled by hue alone. Maya Lin's bar is a lighter blue than Anna's, both Confirmed, so it's unclear what the difference means. | Hotel bar styles: Paid gets a leading `Check` icon (size-3), Cancelled gets line-through plus outline only, Host/OTA blocks get the hatched fill used on Staff. Make all confirmed bars the same tint. |
| Efficiency | 7 | On touch, tapping an empty month day does nothing (`onSlotClick` only acts in the Villas view, and the cell "+" is hover-only), so iPad staff must press New booking and re-pick the dates. "+N more" adds a tap. | `AdminBookingsView.tsx` `onSlotClick`: also handle `slot.view === "month"` on coarse pointers with `openNew(checkIn, addDaysIso(checkIn,1))`. The row fix under Layout removes most "+N more". |
| Clarity | 7 | Phone list amounts are `b.owed` with no label, so a paid stay shows "฿0", which reads like a free booking. Lena appears under both Thursday and Friday with no "in house" cue. | `renderAgendaEvent`: show `owed > 0 ? "฿26,000 due" : "Paid"`, with "Paid" in emerald text. Add "Arrives", "In house" or "Leaves" before the dates according to the day header. |
| States & feedback | 8 | Has a spinner, disabled tiles showing "–", a "No villas yet" prompt and an incomplete-load alert. The List empty state is the generic "No events". | Pass `i18n.labels.noEvents: "No stays in these two weeks."` in `CALENDAR_I18N` and render a `New booking` button under it. Show TodayStrip tiles as `Skeleton h-6 w-10` instead of "–" while loading. |
| Responsive | 7 | The phone 4-up strip is cramped. On iPad, the month grid gives a third of its height to empty weeks (see Layout). | Phone tiles: `px-2 py-2 min-h-14`, label 12px on one line, value 18px. This keeps the brief's compact 4-up. The iPad fix is the one under Layout. |
| Accessibility | 7 | On iPad (touch), month bars are about 24px tall and "+N more" is `pointer-coarse:h-7` (28px), both under 44px. The legend relies on colour alone. | Bars `pointer-coarse:min-h-8` plus a full-cell tap target that opens the day popover. `moreIndicator`: `pointer-coarse:h-11 pointer-coarse:px-3`. Put the status text in each bar's `aria-label` (`${title}, ${status}`). |

### 4. Staff calendar (extra-staff-calendar-ipad, extra-staff-calendar-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Date nav, view switch and New appointment are clear. Mali's header says "1 appointment", but it's at 16:00, below the fold, with no cue. | Show a small "↓ 16:00" chip at the foot of a column when its appointments are outside the scrolled window, or see Efficiency. |
| Typography | 9 | Staff names 14px semibold, meta 12px, agenda rows 15/12. | — |
| Layout & spacing | 8 | On phone, the legend wraps to three lines pinned under a mostly empty Agenda card. In Agenda, the only colour on screen is each row's own chip, so the legend adds nothing. | `AdminStaffBookingsView.tsx` legend: add `hidden` when `view === "agenda"` and `max-sm:hidden` otherwise. Do the same in the hotel view. |
| Consistency | 7 | Toolbar layout, primary placement, "Filters" checklist vs ⋯ menu, and missing search all differ from the hotel calendar (see screen 3). Staff uses `Card` and Hotel a hand-rolled div. | Settle one `AdminCalendarHeader` layout: row 1 is nav, view switch and primary; row 2 is filters. Use `Card` in both views. |
| Color & contrast | 8 | Booked (slate) and Cancelled (grey) dots are almost the same. | Cancelled: line-through title and an outline-only chip, so colour isn't the only cue. Give Booked a darker slate in `appointmentStatusColor`. |
| Efficiency | 8 | `scrollToHour={8}` is fixed, so later bookings need a manual scroll. | `scrollToHour = Math.min(nowHour, earliestVisibleAppointmentHour)` for the shown day. |
| Clarity | 8 | Every Agenda row carries a grey "Booked" chip (noise). The "Break / turnaround / time off" legend item is long. | Show the chip only when status ≠ booked. Legend copy: "Break or time off". |
| States & feedback | 8 | Has a spinner, "No staff/services yet" prompts and an error alert. An empty Agenda says the generic "No events". | `CALENDAR_I18N.labels.noEvents: "No appointments."` plus a `New appointment` button. |
| Responsive | 8 | Phone defaults to Agenda (good). The legend waste is covered under Layout. iPad fits four staff columns well. | The legend fix under Layout. |
| Accessibility | 9 | Event blocks have text status chips, and controls are 44px on coarse pointers. | — |

### 5. Chats (extra-chats-ipad, extra-chats-phone, ux-p6-phone-chat)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The split view on iPad is clear. The phone header is three rows (name, channel and villa, chips, about 130px) before the first message. | `AdminSessionDetail.tsx`: one header row on phone. Name 16px semibold, with channel·villa as a 13px muted second line under it. Move the "Needs you" status to a dot before the name (`size-2 rounded-full bg-amber-500` plus `sr-only` text). Fold "AI replying" into the ⓘ sheet. |
| Typography | 8 | `StatusBadge` is forced to `text-[11px]`. The author label repeats above every bubble. | Remove `className="text-[11px]"`. Show the author label only when the author changes from the previous message. |
| Layout & spacing | 8 | "Reply via Website" adds a composer row the header already answers. The composer has no safe-area padding. On phone, the page card's rounded top edge shows at y≈16. | Make the composer label `sr-only` and put the channel in the placeholder ("Reply on Website…"). Form: `pb-[max(0.75rem,env(safe-area-inset-bottom))]`. Phone chat container: `max-lg:rounded-none max-lg:border-0`. |
| Consistency | 8 | "Needs you" is a `StatusBadge` while "AI replying" is a hand-rolled `rounded-full bg-muted px-2 py-1` pill with a different height and padding. | Use `Badge variant="secondary"` (same height) for the automation state, or move it out (see Hierarchy). |
| Color & contrast | 9 | Amber "Waiting 3m", with distinct guest and AI bubbles. | — |
| Efficiency | 8 | The list's "mark settled" action is `pointer-coarse:hidden`, so on iPad and phone staff must open each chat to dismiss it. On phone, "No reply needed" is an icon-only ✓✓ with its meaning only in `title`. | Wrap chat list rows in the existing `ui/SwipeRail.tsx` (swipe → "No reply needed") on coarse pointers. Phone header button: icon plus the short label "Done" (`sm:` keeps the full label). |
| Clarity | 7 | "Needs you" and "AI replying" appear together, so it's unclear who is answering. "Answer as a business fact" is jargon. | When `needsReply && !aiPaused`, show "AI couldn't answer" instead of "AI replying". Rename the link "Save answer for AI". |
| States & feedback | 9 | Skeleton transcript, per-tab empty states, reply-window closed or closing, and sending/error. | — |
| Responsive | 8 | Phone is single-pane with Back and the composer at the thumb, but the header is too tall (see Hierarchy). | See Hierarchy. |
| Accessibility | 8 | Icon buttons are labelled and 44px on touch. Badge text at 11px. The ✓✓ meaning isn't visible on touch, where there's no tooltip. | The fixes under Typography and Efficiency. |

### 6. Missing information (extra-missing-information-ipad, extra-missing-information-phone, ux-p6-desktop-missing)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Question rows read well, but the table header is about 68px tall for two 12px labels. That's because `SelectCheckbox` is `size-11` in `thead` on desktop too. | In `thead`, wrap the checkbox in `pointer-fine:size-8` (keep 44px on coarse pointers) and set `th` to `py-2`. |
| Typography | 8 | "Create fact" is 12px semibold next to a 14px select, and "Asked 2×" is `text-[11px]`. | Create fact: `size="default" variant="ghost" className="text-sm font-medium"`. Badge: `text-xs`. |
| Layout & spacing | 7 | Phone: in the "baby cot" row, "Open chat" wraps to its own 44px line with about 20px of empty space above it. That's because the link's `min-h-11` sits inside a wrapping `flex-wrap` meta line. The phone select is `min-w-[8rem]` and leaves dead space. | Link: `-my-3 min-h-11` so the hit area doesn't grow the line. On phone, move Open chat into the action row as a ghost button. Phone action row: `grid grid-cols-[1fr_auto]` so the select fills it. |
| Consistency | 8 | "Open chat" (link) and "Create fact" (ghost button) look alike but are different components. The phone Status filter sits on its own row with an inline label, unlike other filter bars. | Make both ghost buttons. Phone: put search and Status on one row (`grid-cols-[1fr_8rem]`) with the label `sr-only`. |
| Color & contrast | 8 | The "Use a fact" placeholder renders in full foreground colour and looks like a chosen value. | `ui/select.tsx` `SelectTrigger`: add `data-[placeholder]:text-muted-foreground`. |
| Efficiency | 9 | Picking a fact resolves at once, with Undo, plus bulk select. | — |
| Clarity | 7 | "Use a fact" reads as already selected (see Color). The topic word runs into the villa name: "Tideglass Pool Residence Family". | Placeholder "Resolve with…". Render the topic as `Badge variant="outline"` or separate it with "·". |
| States & feedback | 9 | Has empty states for search, new, all and status, plus a skeleton, an error alert and an Undo toast. | — |
| Responsive | 8 | Desktop is capped and fine. On phone the stacking works but has the gaps described under Layout. | The fixes under Layout. |
| Accessibility | 9 | 44px checkbox labels, per-row aria-labels on the select and ⋯, sr-only channel names. | — |

### 7. New booking (extra-new-booking-ipad, extra-new-booking-phone, ux-p5-new-booking-phone)
| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Stay, Guest and Price groups with a footer total at 18px. On iPad the Price card is cut by the footer. "Booking status" (Confirmed or Pending), a real decision, sits below the fold at the very end. | Move the status `ToggleGroup` into the footer row, left of Create booking (keep "Block these dates instead" in ⋯ or below), or into the Stay group under the dates. |
| Typography | 9 | 12px muted labels, 16px semibold section titles, sans tabular total. | — |
| Layout & spacing | 7 | The scroller's `mask-image` fade makes "Custom price" look faded at rest. The "Block these dates instead" ghost text is indented about 9px from the content edge (x 364 vs 355 on iPad, 29 vs 20 on phone). | Drop the mask, or show it only while scrolled (`data-scrolled`). Ghost button: `-ms-2 px-2` so the text lines up with the labels. |
| Consistency | 8 | Custom price is a hand-rolled `role="switch"`, while `EditBookingDialog` uses a native checkbox. The "Booking status" title is `text-sm font-medium` while the other sections are `text-base font-semibold`. | Extract one switch row (shared with Edit). Make the status `h3` `text-base font-semibold`, or fold it into a group. |
| Color & contrast | 8 | Disabled Create booking (`bg-muted text-muted-foreground` on beige) looks like a secondary button rather than a pending primary. Phone placeholder is `muted-foreground/60` (about 2.6:1). | Disabled primary: keep `bg-primary` at `disabled:opacity-45` (the default) so it still reads as the primary. Placeholder: `placeholder:text-muted-foreground`. |
| Efficiency | 9 | Villa defaulted, dates prefilled from the calendar, returning-guest suggestions, live coupon quote. | — |
| Clarity | 8 | The footer says "Enter the guest's name and phone number." before anything is typed. `problem`, `couponProblem` and `error` render twice: at the bottom of the scroller (lines 453–455) and again in the footer `blockingReason`. | Delete the three duplicate `<p>`s in the scroller (the footer already announces them via `aria-live`). Until the first submit attempt, show the guest hint in muted text and the other problems in `text-destructive`. |
| States & feedback | 7 | No unsaved guard. Backdrop, Escape or ✕ after typing a guest silently discards everything. BookingSheet, AppointmentSheet and Settings all guard. | `NewBookingDialog`: `const dirty = Boolean(guest.name \|\| guest.phone \|\| guest.email \|\| customTotal \|\| couponInput)`, `const { confirmDiscard } = useUnsavedGuard(dirty)`, `onOpenChange={async n => !n && !saving && await confirmDiscard() && onClose()}`. |
| Responsive | 8 | Phone has check-in/out side by side and a sticky footer. On iPad the 820px-tall modal still hides Price and Status. | The status move under Hierarchy. On iPad, use `sm:max-w-2xl` with Guest name/Guests and Phone/Email in 2 columns (`sm:grid-cols-2`) so the whole form fits without scrolling. |
| Accessibility | 8 | All inputs are labelled and the disabled reason is announced. The phone prefix shows only a flag, with no "+66", so the country code isn't visible as text. | `PhoneInput` country button: render the dial code next to the flag (`+66`, `text-sm tabular-nums`). |

---

## Visual bugs
1. **extra-hotel-calendar-ipad**: Lena Fischer's stay (Wed 11 → Sat 14) is drawn as two separate bars. The Thursday segment is hidden in "+3 more" and the Wednesday piece truncates to "Tidegla…".
2. **extra-hotel-calendar-ipad**: The busy week shows one bar per day plus "+3 / +2 / +2 more", while weeks 1, 4 and 5 sit empty at the same row height.
3. **extra-stay-sheet-ipad/phone, ux-p5-stay-sheet-ipad, extra-appointment-sheet-ipad/phone**: Detail rows have uneven heights (Phone/Email ≈70px vs Villa/Source ≈45px). Labels are vertically centred while values are top-aligned.
4. **extra-appointment-sheet-phone**: The Villa stay value is semibold and wraps to "Ken / Tanaka".
5. **extra-appointment-sheet-ipad/phone**: The 44px "Mark arrived" button sits beside a 20px "Booked" chip in the title block, misaligned and chip-like.
6. **extra-hotel-calendar-phone**: The "Balance due" tile label wraps to two lines, labels are 11px, chevrons are crammed against them, and the value is "฿44.3k".
7. **extra-hotel-calendar-phone**: List amounts have no label. Paid stays show "฿0".
8. **extra-missing-information-phone**: In the "baby cot" row, the meta line wraps and "Open chat" lands on its own line with a gap above it.
9. **extra-missing-information-ipad, ux-p6-desktop-missing**: The table header row is about 68px tall for 12px labels. The "Use a fact" placeholder is full-strength text.
10. **extra-new-booking-ipad**: The Price card is clipped by the footer and the mask fade makes "Custom price" look disabled. Booking status is fully below the fold.
11. **extra-new-booking-ipad/phone, ux-p5-new-booking-phone**: "Block these dates instead" is indented about 9px from the form's left edge.
12. **extra-new-booking-phone, ux-p5-new-booking-phone**: The phone prefix shows only a flag (no "+66"). The disabled Create booking looks like a secondary button.
13. **extra-chats-phone, ux-p6-phone-chat**: The header takes three rows (about 130px). The 11px "Needs you" badge and the taller "AI replying" pill don't match. The page card's rounded top border shows at y≈16.
14. **extra-staff-calendar-phone**: A three-line legend is pinned under a mostly empty Agenda card.
15. **extra-staff-calendar-ipad**: Mali's header says "1 appointment", but the appointment (16:00) is off-screen with no cue.
16. No toast was seen covering an input. In code, `ui/toast.tsx` clears only `data-admin-bottom-bar` pages. If the Appointment sheet gets the sticky phone bar proposed above, mark it `data-admin-bottom-bar="sm"`.

## Per-screen averages
| Screen | H | T | L | Cn | Co | E | Cl | S | R | A | Avg |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Stay sheet | 9 | 9 | 7 | 8 | 9 | 9 | 8 | 8 | 9 | 9 | **8.5** |
| Appointment sheet | 8 | 8 | 7 | 8 | 9 | 9 | 8 | 9 | 8 | 8 | **8.2** |
| Hotel calendar | 8 | 7 | 6 | 8 | 8 | 7 | 7 | 8 | 7 | 7 | **7.3** |
| Staff calendar | 8 | 9 | 8 | 7 | 8 | 8 | 8 | 8 | 8 | 9 | **8.1** |
| Chats | 8 | 8 | 8 | 8 | 9 | 8 | 7 | 9 | 8 | 8 | **8.1** |
| Missing information | 8 | 8 | 7 | 8 | 8 | 9 | 7 | 9 | 8 | 9 | **8.1** |
| New booking | 8 | 9 | 7 | 8 | 8 | 9 | 8 | 7 | 8 | 8 | **8.0** |

**Area average: 8.0.** No screen passes. Hotel calendar is furthest behind.
