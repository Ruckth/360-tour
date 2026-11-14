# Grade R5: bookings desk, calendars and chats

Grader: senior product designer, fresh eyes. Sources: `docs/screenshots/audit-r5/` (listed per screen) plus component code for states the screenshots can't show. Scored against `scorecard-rubric.md`, `visual-brief.md` (Package B) and the locked decisions. Locked choices (Mark arrived inline, Block-dates ghost under the dates, "Record external payment…" + ⓘ, Needs-you badge, subtle toggles, page-scrolling month grid) are scored only on how well they're executed.

Not covered by screenshots, so not graded: EditBookingDialog, BookingQuickActions, NewAppointmentDialog. Their code shares the patterns graded below.

---

### 1. Stay sheet (extra-stay-sheet-ipad.png, extra-stay-sheet-phone.png, ux-p5-stay-sheet-ipad.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Balance due at 36px sans is the first thing you see, with one primary "Take payment". Edit, ⋯ and ✕ sit in the header as ghost icons, as the brief asks. | — |
| Typography | 9 | Serif title, 12px eyebrow, `font-sans tabular-nums` money, 13px muted labels in a 96px column, 14px values. | — |
| Layout & spacing | 9 | Three Cards with an even 20px rhythm. The phone stacks the CTAs full width. | — |
| Consistency | 9 | Same header, money card and details card as the appointment sheet. | — |
| Color & contrast | 9 | Neutral surfaces. The blue Confirmed badge is the only colour. | — |
| Efficiency | 9 | One tap to pay. Notes save inline, and "Save notes" only appears once the notes change. | — |
| Clarity | 8 | The sample stay checks out today (Thu 12 Nov) and still owes ฿27,500, but the sheet never says "Leaves today". The phone list does say it, so the sheet has less context than the list. "by ploy" shows a raw lowercase handle. | `BookingSheet.tsx` Stay `Detail`: add a phase to the secondary line, e.g. `{nights} nights · {guests} guests · Leaves today` (Arrives today / In house / Leaves today, same logic as `renderAgendaEvent`). Use `amber-700` only when phase = Leaves today and owed > 0. Run `staffLabel()` output through the staff display name, or capitalise it. |
| States & feedback | 9 | Skeleton, not-found, `DisabledReason` while checkout is live, notes revision conflict with "Load the latest notes", unsaved guard on close. | Nit: "Take payment" is silently disabled while `spa` loads. Show `<Spinner/>` inside it when `!spa`. |
| Responsive | 9 | `sm:max-w-[30rem]` sheet on iPad, full width on phone with stacked full-width CTAs. | — |
| Accessibility | 9 | Icon buttons have labels, tel/mailto links are `min-h-11`, focus rings are set, and the ⓘ is a labelled button. | — |

### 2. Appointment sheet (extra-appointment-sheet-ipad.png, extra-appointment-sheet-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | ฿1,200 hero with "Take payment" primary. "Mark arrived" sits as an outline button beside the badge (locked). | — |
| Typography | 9 | Same scale as the stay sheet. "Room ready 11:05" is a muted secondary line. | — |
| Layout & spacing | 9 | Same Card rhythm. The Villa stay row is a full-width link with a chevron. | — |
| Consistency | 9 | Mirrors the stay sheet exactly (header icons, money card, 96px label column). | — |
| Color & contrast | 9 | Neutral, with the staff avatar colour as identity only. | — |
| Efficiency | 9 | Arrival, payment and edit are each one tap. The linked stay opens in place. | — |
| Clarity | 8 | "Source: Manual" is system jargon. The appointment is linked to the Ocean Suite stay, whose sheet also counts spa into its balance, yet this card shows "Balance due ฿1,200 · Take payment" with no hint that it's the same money. Staff can't tell where to collect it. | `AppointmentSheet.tsx`: map source `manual` → "Front desk". `AppointmentMoneyBlock`: when `appointment.bookingId`, add `<p className="text-[13px] text-muted-foreground">Also on the Ocean Suite stay bill</p>` under the amount. |
| States & feedback | 9 | Skeleton hero, pending spinner on the status button, Escape/outside-click blocked while a fee is saving, error/notice lines. | Nit: "Loading payment records…" is plain text. Use `<Skeleton className="h-10"/>` like the hero. |
| Responsive | 9 | Phone: full-width primary, centred ghost + ⓘ. | — |
| Accessibility | 9 | `sr-only` "Appointment ·" prefix on the title, labelled icons, 44px rows. | — |

### 3. Hotel calendar (extra-hotel-calendar-ipad.png, extra-hotel-calendar-phone.png, extra-hotel-calendar-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The four KPI tiles take 108px on iPad and desktop. Three of them show only a label and one digit, so they are mostly empty and push the month grid down. Balance due, the only money tile, carries the same weight as "In house 1". | `TodayStrip.tsx`: tile classes `sm:min-h-0 sm:py-3 sm:gap-1` (drop `sm:min-h-20 sm:py-4`). Put the chevron next to the value instead of on its own line, and give Balance due its caption inline so all tiles are the same ~76px height. |
| Typography | 9 | KPI values 28px sans, day numbers 13px top-left, bars 12px with medium names. | Nit: villa line in bars `opacity-75` so name and villa separate. |
| Layout & spacing | 8 | Event bars are translucent, so day gridlines run through every multi-day bar (Anna Schmidt, Lena Fischer). The today-column tint also darkens the Thu segment of Anna's bar, which then looks like two bars. On desktop the page title sits at x=24 while the content column starts at x=105. | Bars: make the fill opaque, e.g. `bg-[color-mix(in_oklab,var(--event-color)_14%,var(--color-card))]` in the month-bar style in `event-calendar-month-view.tsx` / the event colour helper, and raise the bar overlay `z-10` above the cell borders. Title: render the page header for `/admin/hotel` and `/admin/staff` inside the same `mx-auto max-w-7xl px-6` wrapper as `AdminBookingsView`. |
| Consistency | 9 | Toolbar matches the staff calendar (Today, ‹ month ›, subtle segmented view, one primary). | — |
| Color & contrast | 8 | Blue, green and amber carry status, which is right. But because the bars are translucent, the same status shows two shades depending on what's behind it. On iPad the legend only appears below the fold, so the colours go unexplained on first view. | Opaque fills (above). Move the legend into the toolbar's second row as an `InfoTip` labelled "Colours" (`AdminCalendarHeader` children), or show it above the grid on `sm`. |
| Efficiency | 8 | The phone list is a 14-day agenda that repeats every in-house stay under each day (Lena Fischer and Maya Lin appear under both Thursday and Friday), so finding today's work means scrolling past duplicates. | `AdminBookingsView` phone agenda: per day, list only Arrives/Leaves rows, then one collapsible row "2 in house" (muted, 13px) that expands to the rest. |
| Clarity | 8 | Bars fill the whole check-out day. A stay that leaves Thu looks like it occupies Thu, so same-day turnover reads as overlap (Ocean Suite: Ken leaves 14 Sat, Somchai arrives 16). | Month bars: end the last segment at 50% of the check-out cell and start the first at 50% of the check-in cell (hotel convention), via an `endInset`/`startInset` style on the segment in `event-calendar-month-view.tsx`. At minimum, add "→ out Thu" text on the last segment. |
| States & feedback | 9 | Loading spinner, "No stays in this period" + New booking, "No villas yet" + Add a villa, incomplete-load alert, drag-blocked notices. | — |
| Responsive | 9 | Phone gets the compact 4-up strip, a List view picker, an icon-only search popover and "+ New". iPad and desktop get the month grid. | Nit: phone tile chevron `size-2.5` is nearly invisible. Use `size-3`. |
| Accessibility | 9 | Status icons back the colours, the legend has text, "+N more" is `pointer-coarse:h-11`, Balance due has an aria-label, and the touch spec covers this page. | — |

### 4. Staff calendar (extra-staff-calendar-ipad.png, extra-staff-calendar-phone.png, extra-staff-calendar-desktop.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Staff columns with avatars and counts, one primary "New appointment", a clear now-line. | — |
| Typography | 9 | 14px semibold names in chips, 12px meta, 15px rows in the phone list. | — |
| Layout & spacing | 8 | Hour labels sit below their gridline ("10:00" at y=370, but the 10:00 line is at y=357), so the 09:50 chip seems to start before 09:50. On iPad the Turnaround block is 43px (~40 min) for a 15-minute turnaround ("Room ready 11:05"). The touch min-height is inflating a non-interactive block, and the slot looks blocked until ~11:20. | `event-calendar-time-grid.tsx`: put the hour label on its line (`-translate-y-1/2` from the row top, first label clamped). `AdminStaffBookingsView` turnaround/break render: exempt the non-tappable turnaround event from `pointer-coarse:min-h-11` (e.g. `pointer-coarse:min-h-0`) so its height matches its duration. |
| Consistency | 9 | Same toolbar, search and segmented view as the hotel calendar. Legend in the same footer style. | — |
| Color & contrast | 9 | Status colours + icons + legend. Turnaround is neutral dashed. | — |
| Efficiency | 9 | The "Next 16:00 ↓" cue scrolls to off-screen work. Phone defaults to List. Staff and filters are one popover each. | — |
| Clarity | 9 | "2 appointments", "4 of 4 staff", plain status names. | — |
| States & feedback | 9 | Loading spinner, "No appointments." + CTA, setup notices for no staff/services, error alert, `DisabledReason` on New when there are no services. | — |
| Responsive | 9 | Phone: a list view with two toolbar rows, iPad: 4 columns fill the width, desktop: no stretch. | — |
| Accessibility | 9 | Status icons have `aria-label`, cue button "Show appointment at 16:00", 44px headers. | — |

### 5. Chats (extra-chats-ipad.png, extra-chats-phone.png, extra-chats-desktop.png, ux-p6-phone-chat.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | iPad and desktop are good. On the phone, the full "No reply needed" button gets its own row and is as prominent as the guest's name, so the header takes 3 rows (~146px) before the first message. | `AdminSessionDetail.tsx` header row: drop `flex-wrap` on phone (`flex-nowrap sm:flex-wrap`). `AdminSessionActions.tsx`: wrap the label in `<span className="sr-only sm:not-sr-only">No reply needed</span>` so the phone gets an icon button (aria-label stays). Result: back · name · ⓘ · ✓✓ · ⋯ on one line, then status/channel. |
| Typography | 9 | 15px medium names, 12px meta, 14px bubbles, 16px header name. | — |
| Layout & spacing | 8 | Phone header has dead space left of ⓘ on row 2. On desktop the list reserves an invisible hover-button column, so "Waiting 3m" ends 40px short of the Filters edge (on iPad it's flush). | Phone: as above. `ChatsView.tsx` row hover button: `absolute right-2 top-1/2 -translate-y-1/2` and fade the timestamp out on hover (`group-hover:opacity-0` on the time span), so the row text keeps the full width. |
| Consistency | 9 | Same search + Filters pattern as the other desk pages, StatusBadge reused. | Nit: search input uses `border-input` (darker) beside the Filters outline `border-border`, so the borders differ. |
| Color & contrast | 8 | The selected row uses a gold tint and a gold left bar, the same warm family as "Waiting 3m" (amber) and the "Needs you" badge, so selection reads as urgency. | `ChatsView.tsx` selected row: `border-border bg-muted before:bg-foreground` instead of `border-gold/15 bg-gold/10 before:bg-gold-text`. Keep amber only for waiting. |
| Efficiency | 9 | One-tap "No reply needed" (`e` shortcut), hover settle in the list, Shortcuts dialog, queue tabs. | — |
| Clarity | 9 | "Reply on Website…", AI bubble labelled "AI", one Needs-you badge (locked). | — |
| States & feedback | 9 | Skeleton rows, three empty-state messages, transcript skeleton, older-messages loader, reply-window-ended card, send errors, Send disabled until there's text. | — |
| Responsive | 8 | iPad two-pane uses the width well. The phone header isn't designed for the phone (brief item 8 is still open). | See Hierarchy fix. |
| Accessibility | 9 | Back, ⓘ and ⋯ are labelled. The base Button gives `pointer-coarse:min-h-11 min-w-11`. Channel icons have sr-only text. | — |

### 6. Missing information (extra-missing-information-ipad.png, extra-missing-information-phone.png, extra-missing-information-desktop.png, ux-p6-desktop-missing.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | Each row has four actions of equal weight (Resolve… select, Create fact, Open chat, ⋯). The outlined select is the heaviest thing on the row, but it isn't the common action. | Once the copy is fixed (Clarity), make the select `variant="ghost"` with a border only on hover/focus, or keep it outlined and make "Open chat" icon-only (`size="icon"`, aria-label "Open chat") so the row has one obvious control. |
| Typography | 9 | Question 15px medium, meta 12px muted, as the brief asks. | — |
| Layout & spacing | 8 | On the phone, row 2's meta wraps to three lines (date + icon / "Tideglass Pool Residence" / "Family"), because the property span is `basis-full`. Rows are uneven in height. | `MissingInformationPanel.tsx` property span: replace `basis-full … sm:basis-auto` with `min-w-0 truncate max-w-[12rem]` so date · icon · property · chip stay on one line where they fit. |
| Consistency | 8 | Two chip styles in one row: the filled bold "Asked 2×" and outlined topic chips ("Dining", "Pets"). The outlined ones look like tappable filter buttons but do nothing. | Topic `Badge`: `variant="secondary"` with `font-normal text-muted-foreground` (no border). "Asked 2×": the same badge with `font-medium`. |
| Color & contrast | 9 | Neutral. Destructive is used only for row errors. | — |
| Efficiency | 9 | Resolve inline, Create fact one tap, bulk select, status filter defaults to New. | — |
| Clarity | 7 | "Resolve…" doesn't say what it does: it opens a search over approved facts and links one. Nothing tells staff whether "Create fact" also resolves the report. The channel globe has no visible meaning. | Copy: trigger "Answer with a fact…" (column header "Answer"), and "Create fact" → "New fact". Add a 12px muted line under the list header once: "Linking or creating a fact resolves the report." Wrap the channel icon in a `Tooltip` with its source label. |
| States & feedback | 9 | Skeleton rows, four empty-state variants, "Resolving…" status in the trigger, per-row errors, loading/"Load more facts" in the combobox. | — |
| Responsive | 9 | Phone stacks into cards with the select + Create fact side by side and Open chat moved into ⋯. iPad and desktop use the table. | — |
| Accessibility | 9 | Checkboxes labelled per question, combobox input labelled, sr-only channel names, 44px items on touch. | — |

### 7. New booking (extra-new-booking-ipad.png, extra-new-booking-phone.png, extra-new-booking-desktop.png, ux-p5-new-booking-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Three titled groups. The footer holds only Total (18px semibold) and Create booking, as locked. | — |
| Typography | 8 | Date triggers use 13px text in 48px boxes, while every other field is 14px (16px on phone) in 44px. The default rate inside the Custom price control is 12px muted and reads like placeholder text. | `DeskBookingRangePicker.tsx` trigger: `h-11 text-sm` (drop `h-12 text-[13px]`). Custom price rate text: `text-[13px]`. |
| Layout & spacing | 8 | Field heights in one form are 44 (villa) / 48 (dates) / 44 (inputs), so the date row sits visibly taller. | Same trigger fix. All fields then share `h-11` on touch. |
| Consistency | 8 | Two field styles: date triggers are filled/tinted buttons, text inputs are bordered white. Custom price is a button dressed as an input with a switch inside, a third style. | Date triggers: `variant="outline"` with `bg-background border-input shadow-sm` to match `Input`. Custom price: see Clarity. |
| Color & contrast | 9 | Neutral. Disabled Create booking is muted, with its reason shown underneath. | — |
| Efficiency | 9 | Sensible defaults (Confirmed, 2 guests, +66, prefilled dates), returning-guest suggestions, live coupon pricing. | — |
| Clarity | 8 | "Custom price [฿12,000/night ◯]" looks like a filled, disabled input. It isn't obvious that the switch replaces the villa rate. | Turn it into a settings row: `<Label>Custom price</Label>` left, `Switch` right, no input chrome. Under it, 13px muted: "Villa rate ฿12,000/night · ฿36,000 for 3 nights". Reveal Stay total + Reason when on. |
| States & feedback | 9 | One blocking-reason line (error-toned when it's a problem), saving spinner + disabled fieldset, Retry availability, coupon checking/invalid/worse states, unsaved-changes guard. | — |
| Responsive | 9 | Phone: full-height sheet, check-in/out side by side, safe-area footer separate from the scroller (never covers a field). | — |
| Accessibility | 9 | Every input labelled, `role="switch"` + `aria-checked`, aria-live total and reason, phone error `role="alert"` with focus. | — |

---

## Visual bugs

1. **Translucent month bars**: gridlines show through every multi-day bar, and the today tint makes the Thu segment of Anna Schmidt's bar darker. `extra-hotel-calendar-ipad.png`, `extra-hotel-calendar-desktop.png`, `extra-stay-sheet-ipad.png`.
2. **Turnaround inflated on touch**: a 15-min turnaround draws as ~40 min (43px) on iPad and ~20 min on desktop. `extra-staff-calendar-ipad.png`, `extra-appointment-sheet-ipad.png` vs `extra-staff-calendar-desktop.png`.
3. **Hour labels offset below their gridline**: the 09:50 chip looks earlier than its time. `extra-staff-calendar-desktop.png`, `extra-staff-calendar-ipad.png`.
4. **Desktop page title not aligned with the content column** (x=24 vs x=105). `extra-hotel-calendar-desktop.png`, `extra-staff-calendar-desktop.png`.
5. **Phone chat header wraps to 3 rows**, with an empty left half on row 2. `extra-chats-phone.png`, `ux-p6-phone-chat.png`.
6. **Desktop chat list timestamps inset 40px** by an invisible hover column (flush on iPad). `extra-chats-desktop.png` vs `extra-chats-ipad.png`.
7. **Mixed field heights and styles in New booking** (date triggers 48px tinted, inputs 44px bordered). `extra-new-booking-ipad.png`, `extra-new-booking-phone.png`.
8. **Missing-info phone row wraps meta to 3 lines** (row 2). `extra-missing-information-phone.png`.
9. **Selected chat row in gold**, which reads as the amber waiting state. `extra-chats-ipad.png`, `extra-chats-desktop.png`.

## Averages

| Screen | Avg |
|---|---|
| Stay sheet | 8.9 |
| Appointment sheet | 8.9 |
| Staff calendar | 8.9 |
| Chats | 8.6 |
| New booking | 8.6 |
| Hotel calendar | 8.5 |
| Missing information | 8.5 |
| **Area** | **8.7** |

Screens at 9+ in every category: **0 / 7**. The two sheets and the staff calendar are each one fix away.
