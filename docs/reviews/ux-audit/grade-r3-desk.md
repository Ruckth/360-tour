# Round 3 grade: bookings desk, calendars and chats

Grader: senior product designer, fresh eyes. Sources: the screenshots in `docs/screenshots/audit-r3/` listed under each screen, plus the components in `src/components/admin/`, `src/components/ui/` and `src/hooks/`, read for states a screenshot can't show. iPad 1180×820 and phone 390×844 use touch emulation; `ux-p6-desktop-missing` is 1440 wide with a mouse.

Bar: a 9 means I would ship it with one nit at most. Locked decisions in `design-decisions.md` were not marked down: subtle segmented tones, "Mark arrived" inline with the badge, and rows that grow in the month grid.

---

### 1. Stay sheet (extra-stay-sheet-ipad.png, extra-stay-sheet-phone.png, ux-p5-stay-sheet-ipad.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | "Balance due ฿27,500" is a 36px hero with Take payment as the only primary button. Details and notes recede. | — |
| Typography | 9 | Serif 24px name; money is sans tabular (`text-4xl tabular-nums`); rows use a 13px muted label in a fixed 96px column and a 14px value. | — |
| Layout & spacing | 8 | On the phone, "Record external payment…" is a full-width centred ghost button and its ⓘ is pinned to the far right edge, away from the label. On the iPad the ⓘ floats after a long bold label. | `BookingFinancials.tsx:241`: change the button's `min-h-11 flex-1 sm:flex-none` to `min-h-11 flex-none` so the ⓘ sits next to the label in the centred `inline-flex … justify-center gap-1` span (it stays 44px tall). Do the same in `AppointmentFinancials.tsx:87`. |
| Consistency | 9 | Card surfaces, StatusBadge and header icon buttons (✎ ⋯ ✕) match the appointment sheet. | — |
| Color & contrast | 9 | Colour is used only for status. Primary is dark navy; links are underlined at 40%. | — |
| Efficiency | 9 | Take payment and Record are one tap away. Phone and email are tappable `tel:`/`mailto:` links. | — |
| Clarity | 8 | "Record external payment…" needs an ⓘ to explain itself, and "external" means nothing to desk staff. | Copy: "Record payment made elsewhere…" in both `BookingFinancials.tsx` and `AppointmentFinancials.tsx`. Keep the ⓘ ("e.g. a bank transfer"). |
| States & feedback | 9 | Loading skeleton, "Booking not found", inline errors and notices, notes revision check, "Notes saved", `DisabledReason` while Stripe checkout is live, unsaved-notes guard on close. | — |
| Responsive | 9 | Full-width sheet on the phone with stacked buttons; a 30rem side sheet on the iPad. | — |
| Accessibility | 9 | Icon buttons are labelled ("Edit stay", "More booking actions", "Close"). Targets are at least 44px on touch. Status has a dot and text. | — |

**Average 8.8**

### 2. Appointment sheet (extra-appointment-sheet-ipad.png, extra-appointment-sheet-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Same money-first structure as the stay sheet. "Mark arrived" sits beside "Booked" (locked). | — |
| Typography | 8 | Sub-lines vary: "until Sat 14 Nov" is 12px (`text-xs`), while "Room ready 11:05" and "3 nights · 2 guests" on the stay sheet are 14px muted. | `AppointmentSheet.tsx:256`: change the sub-line span from `text-xs` to `text-sm text-muted-foreground`. |
| Layout & spacing | 8 | In the "Villa stay" row the chevron follows the text mid-row instead of sitting at the row's right edge like a disclosure row. | `AppointmentSheet.tsx:256`: give the link button `w-full justify-between`. The chevron then aligns with the card's right padding. |
| Consistency | 9 | Shares `Detail` rows, Card, header buttons and financials with the stay sheet. | — |
| Color & contrast | 9 | The neutral "Booked" badge and staff avatar colour are fine. | — |
| Efficiency | 9 | Mark arrived is one tap. The linked stay opens in place. | — |
| Clarity | 8 | Same "Record external payment…" wording. | Same copy fix as the stay sheet. |
| States & feedback | 9 | Spinner on status change, "Loading stay…", errors inline, edit guarded by `useUnsavedGuard`, close disabled while saving. | — |
| Responsive | 9 | Phone full width, iPad side sheet. | — |
| Accessibility | 9 | "Open stay ·" sr-only prefix, labelled icon buttons, 44px link rows. | — |

**Average 8.7**

### 3. Hotel calendar (extra-hotel-calendar-ipad.png, extra-hotel-calendar-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Four KPI tiles, then the toolbar with one primary "New booking", then the grid. Today is marked with a filled circle. | — |
| Typography | 8 | On the phone list the amount ("฿26,000 due") is 14px regular and loses to the 15px medium name. It should be the second-strongest thing on the row. | `AdminBookingsView.tsx:274`: change the money span from `text-sm` to `text-[15px] font-medium`. |
| Layout & spacing | 8 | Phone rows stack four lines (name, villa, phase · dates, status badge) at about 108px each, so only four stays fit on screen. | In `renderAgendaEvent`, move `StatusBadge` into the right column: `<span className="grid shrink-0 justify-items-end gap-1">{amount}{badge}</span>`. Rows drop to about 80px. |
| Consistency | 8 | The hotel list row (badge plus amount) and the staff list row (neither, for Booked) differ for the same job. Lena Fischer shows "Paid" twice: green text and a Paid badge. | Use one agenda-row layout for both calendars: title 15/medium, meta 12 muted, right column for status and amount. Hide the amount text when the status badge already says Paid (`b.owed <= 0 && status === "paid"`). |
| Color & contrast | 9 | Status tint plus icon (clock, check, dashed circle). Out-of-month days are muted. Emerald text passes contrast. | — |
| Efficiency | 9 | Defaults to List on the phone and Month on the iPad. Drag-to-book. KPI tiles expand in place. | — |
| Clarity | 8 | The "Balance due ฿44,300" tile reads like the total outstanding. Only after tapping does "Due from today's guests" appear. | `TodayStrip.tsx`: label the tile "Due today" (keep "Due" on the phone), or show the "Due from today's guests" caption permanently under the value at `text-xs text-muted-foreground`. |
| States & feedback | 9 | Skeleton tiles, a loading spinner, "No stays in this period" with New booking, a "No villas yet" call to action, an incomplete-data alert, and an error notice in the legend bar. | — |
| Responsive | 9 | The phone gets a compact 4-up strip and a list. The iPad month grid uses the full width. | — |
| Accessibility | 9 | Icon and colour together. Month bars sit in 44px keyboard-operable cells (exception noted in the spec). Labelled ⋯ and New. | — |

**Average 8.6**

### 4. Staff calendar (extra-staff-calendar-ipad.png, extra-staff-calendar-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | One primary "New appointment". Staff columns with avatars, and a current-time line. | — |
| Typography | 9 | 14px semibold chip title, 12px meta, 12px legend. | — |
| Layout & spacing | 8 | "Next 16:00 ↓" (a 44px button) sits inside Mali's column header, pushes avatar and name about 4px below the other columns, and crowds the header. | `AdminStaffBookingsView.tsx` `OffscreenAppointmentCue`: position it `absolute right-2 top-1/2 -translate-y-1/2` inside a `relative` header span so the header height doesn't change, or pin it to the bottom of the column body (`absolute inset-x-0 bottom-2 mx-auto w-fit`). |
| Consistency | 8 | Phone list rows show no status or money for Booked, unlike the hotel list. The legend uses dots here and icons on the hotel calendar. | Use the shared agenda row from screen 3. Use the same legend style (icon plus label) on both calendars. |
| Color & contrast | 8 | A Booked chip (the most common status) is light grey and nearly the same as the hatched "Turnaround" block below it, so it reads as disabled. | Status chips get `border-l-[3px]` in the status colour (Booked `border-l-slate-700`) on a `bg-card` fill. Hatched grey stays for turnaround and off time only. |
| Efficiency | 9 | Tap a slot to create, drag to reschedule with a confirm step, staff and status filters. | — |
| Clarity | 8 | "2 in view" with a calendar icon needs decoding. | Copy: "2 appointments" (`{bookedCount} {bookedCount === 1 ? "appointment" : "appointments"}`). |
| States & feedback | 9 | "No appointments." with New, "No staff yet / No services yet" calls to action, error alert, loading spinner, `DisabledReason` on New when no services exist. | — |
| Responsive | 9 | Phone defaults to List with one toolbar row. iPad gives each of the four staff a column. | — |
| Accessibility | 8 | Under 12rem chip width (Week view, five or more staff, or the iPad portrait) the StatusBadge is hidden (`hidden @[12rem]:inline-flex`) and status becomes colour-only. | In `renderEvent`, render a status icon (`size-3`, Clock / UserCheck / Check / Ban as on hotel bars) with `@[12rem]:hidden` next to the name for every non-booked status. |

**Average 8.5**

### 5. Chats (extra-chats-ipad.png, extra-chats-phone.png, ux-p6-phone-chat.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 8 | The iPad thread header takes three rows (name and actions, channel line, then the "Needs you" and "Waiting for staff" chips), about 165px before the first message. Two chips say the same thing. | `AdminSessionDetail.tsx:375-385`: on sm+, put the StatusBadge on the channel line (`Website · Tideglass Pool Residence · [Needs you]`). Render the automation chip only when it adds information ("AI paused", "AI replying"), not "Waiting for staff" while `needsReply`. |
| Typography | 9 | Name 16px semibold, meta 13px muted, list row 15px medium, 12px timestamps. | — |
| Layout & spacing | 8 | On the phone the composer textarea is 50px tall and `rounded-2xl`, while Send is 44px and `rounded-lg`, so tops and radii don't match. The iPad header is tall (see above). | `AdminSessionDetail.tsx:514`: set ChatInput to `min-h-11 py-2 leading-6 max-md:rounded-xl`. Give the Send button `max-md:rounded-xl`. |
| Consistency | 8 | Disabled Send is the primary at 45% opacity (muddy grey with white text). Disabled "Create booking" uses `bg-muted text-muted-foreground`. Same job, two treatments. | `ui/button.tsx` default variant: add `disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100`, and remove the local override in `NewBookingDialog.tsx`. |
| Color & contrast | 9 | Amber "Waiting 3m" (amber-800), gold selected row, lavender AI bubble. All meaning-driven. | — |
| Efficiency | 9 | Queue tabs, one-tap "No reply needed" (✓✓ on the phone), j/k/r/e shortcuts with a mouse, settle from a list row on hover. | — |
| Clarity | 8 | "Needs you" and "Waiting for staff" duplicate each other on the iPad (see Hierarchy). | Same fix as Hierarchy. |
| States & feedback | 9 | Skeleton rows, per-queue empty states ("You're all caught up…"), send error, reply-window warning, "Load older messages", draft guard via `useUnsavedGuard` in `useAdminReplyComposer`. | — |
| Responsive | 9 | Two panes on the iPad. On the phone a full-screen thread with back, the composer respecting the safe area, and an icon-only action. | — |
| Accessibility | 9 | "Back to chats", "Chat details" and "No reply needed" are labelled. 44px minimum on coarse pointers. Tabs use the tablist pattern. | — |

**Average 8.6**

### 6. Missing information (extra-missing-information-ipad.png, extra-missing-information-phone.png, ux-p6-desktop-missing.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | The question at 15px medium leads. The inline Resolve control is the obvious action. | — |
| Typography | 9 | 15/12 row scale, eyebrow table headers, serif page title. | — |
| Layout & spacing | 8 | On the phone each card has three left edges: Resolve at x≈33, the checkbox centred in a 44px column at x≈45, and the question at x≈89. In "Do you have a baby cot?" the property name wraps to its own meta line, so that card is taller than the others. | `MissingInformationPanel.tsx` row: change the third cell from `max-lg:col-span-full` to `max-lg:col-start-2` so Resolve aligns with the question. Make the meta `<p>` `flex-nowrap`, keeping the property `min-w-0 truncate`. |
| Consistency | 9 | Underlined `SegmentedTabs` (the documented sub-navigation), StatusBadge, MoreMenu. | — |
| Color & contrast | 9 | Neutral chips; colour only in status badges. | — |
| Efficiency | 9 | Picking a fact resolves at once with an Undo toast. Create fact is one tap away. Bulk select. | — |
| Clarity | 8 | On the phone the Status label is `sr-only`, so the filter reads as a bare "New" next to search, which looks like a create button. | Line 322: keep the label visible, or prefix the trigger on the phone: `<span className="sm:hidden text-muted-foreground">Status: </span>`. |
| States & feedback | 9 | Several empty states with recovery actions, skeleton rows, "Resolving…" status, error alert, bulk bar. | — |
| Responsive | 9 | Table on the iPad and desktop (centred, not stretched at 1440). Cards on the phone with ⋯ in the corner. | — |
| Accessibility | 9 | Checkboxes are labelled with the question. The combobox has a full accessible name. Targets are 44px. | — |

**Average 8.8**

### 7. New booking (extra-new-booking-ipad.png, extra-new-booking-phone.png, ux-p5-new-booking-phone.png)

| Category | Score | Evidence | Fix needed for 9+ |
|---|---|---|---|
| Hierarchy | 9 | Stay / Guest / Price groups. The footer total is 18px semibold sans with the single primary button. | — |
| Typography | 8 | The coupon placeholder "e.g. SUMMER15" is `font-mono font-semibold`, heavier than every label and value on the form. | `NewBookingDialog.tsx` coupon Input: add `placeholder:font-sans placeholder:font-normal placeholder:tracking-normal`. The typed code stays mono. |
| Layout & spacing | 7 | The brief asks for 24px between groups; the code uses `gap-4` (16px). Inside groups `gap-1` (phone) or `gap-2` puts each 12px label 4–8px under the input above ("Check-in" under Villa, "Email (optional)" under Phone). "Block these dates instead" is stranded between Stay and Guest. | Fieldset: `gap-6`. Sections: `gap-4` between fields, with label→input `gap-1.5` inside each field. Move "Block these dates instead" into `DialogFooter` on the left as `variant="ghost" size="sm"`. |
| Consistency | 8 | "Custom price" is a hand-rolled `role="switch"` button (also copied in `BookingMoneyFields`/`BookingSheet`). There is no `ui/switch`. Disabled-button styling is overridden locally. | Extract `src/components/ui/switch.tsx` (h-6 w-10 track, `bg-foreground` on, `bg-muted-foreground/70` off) and use it in all three places. Move the disabled style into `button.tsx` (see Chats). |
| Color & contrast | 9 | Muted disabled state with a reason line, red only for real errors. | — |
| Efficiency | 9 | Villa and dates prefill from the calendar, guests defaults to 2, returning-guest suggestions, live coupon quote. | — |
| Clarity | 8 | "Block these dates instead" is 14px semibold muted text that reads like a sub-heading, not an action. | With the footer move above, add an icon: `<Ban className="size-4" />` "Block dates instead". |
| States & feedback | 9 | Live blocking reason ("Enter the guest's name and phone number."), coupon checking spinner, availability Retry, `fieldset disabled` while saving, idempotency key, unsaved guard on close. | — |
| Responsive | 8 | On the phone the dialog is `h-dvh`, but the footer floats with about 44px of blank sheet below it, so Create booking isn't at the thumb edge. Check-in and check-out sit side by side (good). | Make the form `h-full` and the fieldset `flex-1` (`max-sm:flex-1`) so the footer pins to the bottom, and add `pb-[max(0.75rem,env(safe-area-inset-bottom))]` to the footer. |
| Accessibility | 9 | Every input is labelled, sr-only description, `aria-invalid` on phone, coupon and price, `role="alert"` on errors, 44px targets. | — |

**Average 8.4**

---

## Visual bugs

| File | Bug |
|---|---|
| extra-staff-calendar-ipad.png | The "Next 16:00 ↓" pill inside Mali's header pushes avatar and name about 4px below Nok, Ploy and Dao. The header looks crowded. |
| extra-staff-calendar-ipad.png | The Booked "Ken Tanaka" chip (light grey) looks almost the same as the hatched Turnaround block under it and reads as disabled. |
| extra-stay-sheet-phone.png, extra-appointment-sheet-phone.png | The ⓘ is detached at the far right edge of the centred "Record external payment…" row. |
| extra-appointment-sheet-ipad/phone.png | In "Villa stay", the chevron floats mid-row after the text. "until Sat 14 Nov" is 12px while the other sub-lines are 14px. |
| extra-chats-ipad.png | Duplicate status chips ("Needs you" and "Waiting for staff"). The header is three rows, about 165px. |
| extra-chats-phone.png, ux-p6-phone-chat.png | The composer textarea (50px, rounded-2xl) is taller than Send (44px, rounded-lg), so tops and radii don't match. |
| extra-chats-ipad/phone.png | Disabled Send renders as a muddy grey fill (45% opacity primary) with white text, unlike the other disabled primaries. |
| extra-missing-information-phone.png | Resolve's left edge sits about 12px left of the checkbox: three left edges per card. The baby-cot card wraps "Tideglass Pool Residence" onto a second meta line. |
| extra-missing-information-phone.png | The unlabelled "New" status select next to search reads as a create button. |
| extra-new-booking-ipad/phone.png, ux-p5-new-booking-phone.png | Field labels sit 4–8px under the previous input (cramped). "Block these dates instead" is stranded between groups. The bold mono coupon placeholder is heavier than the labels. |
| extra-new-booking-phone.png, ux-p5-new-booking-phone.png | The footer isn't pinned: a blank strip of about 44px under Total and Create booking. |
| extra-hotel-calendar-phone.png | Lena Fischer shows "Paid" twice (green text and a badge). Four-line rows of about 108px fit only four stays per screen. |

## Summary

| Screen | Avg | Lowest |
|---|---|---|
| Stay sheet | 8.8 | Layout 8, Clarity 8 |
| Appointment sheet | 8.7 | Typography 8, Layout 8, Clarity 8 |
| Hotel calendar | 8.6 | Typography, Layout, Consistency, Clarity 8 |
| Staff calendar | 8.5 | Layout, Consistency, Color, Clarity, Accessibility 8 |
| Chats | 8.6 | Hierarchy, Layout, Consistency, Clarity 8 |
| Missing information | 8.8 | Layout 8, Clarity 8 |
| New booking | 8.4 | Layout 7 |

**Area average: 8.63.** Screens at 9+ in every category: **0 of 7**.

Nothing here is structural. Every gap is spacing, a copy line, or a shared primitive (disabled button style, switch, agenda row, status stripe). Six or seven small changes would move most screens to 9.
