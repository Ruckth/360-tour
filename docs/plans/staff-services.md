# Plan: Staff + services module (with AI booking)

## Goal
The resort sells add-on **services** (massage, private chef, yoga, airport transfer, boat trip…) that are performed by **staff**.
Booking a service takes that staff member's time automatically, so nobody gets double-booked.
Admins book from a staff calendar. The AI books over chat too.

Target UI: the ReUI resource day view (`@reui/c-event-calendar-2`), styled like the attached mock:
- one column per staff member (avatar, name, "N appointments")
- appointments show guest, status chip, and "time • service"
- breaks and time off drawn as hatched blocks (Lunch, Day off…)

## Current state
- The ReUI event calendar is already installed in `src/components/reui/event-calendar/` (commit 4fd8c1d) and used by `AdminBookingsView` for villa stays.
  - `renderResourceHeader` and `renderEvent` already exist, so the mock's avatar headers and status chips don't need library changes.
  - Re-running `pnpm dlx shadcn@latest add @reui/c-event-calendar-2` would try to overwrite those files. Only accept overwrites after diffing. The example file itself is small; we use it as the pattern, not as a dependency.
- Villa bookings: `bookings` table, one row per night in `availability`, AI prepare → confirm tools in `convex/lib/chatTools.ts`.
- Admin views are switched inside `AdminChatDashboard` (`"chats" | "bookings" | "questions"`).

## Key design decision: blocking is derived, not stored
There's no separate "staff blocked" table.
A staff member is busy at time T if any of these is true:
1. T is outside their working hours,
2. T falls in one of their breaks or time off, or
3. a non-cancelled appointment for them covers T (including buffer time).

Every create/move runs this check **inside the same Convex mutation** that writes the appointment.
Convex mutations are serializable, so two bookings racing for the same slot can't both succeed.
Cancelling an appointment frees the time automatically; there's nothing to clean up.

## 1. Schema (`convex/schema.ts`)
```ts
staff: {
  name, role, avatarUrl?, color,
  status: 'active' | 'archived',
  // Asia/Bangkok local time, "HH:mm"
  workingHours: [{ weekday: 0-6, start, end }],
  breaks: [{ weekday: 0-6, start, end, label }],   // recurring, e.g. Lunch
  createdAt, updatedAt
}  .index('by_status')

services: {
  slug, name, description, category,
  durationMin, bufferMin,            // buffer = cleanup/travel after the service
  price, currency,
  staffIds: Id<'staff'>[],           // who can perform it (small list, no join table)
  status: 'active' | 'archived',
  createdAt, updatedAt
}  .index('by_slug') .index('by_status')

staffTimeOff: {                      // one-off blocks: leave, training, "Theatre List"
  staffId, start, end (UTC ms), label, createdByAdminEmail
}  .index('by_staff_start', ['staffId', 'start'])

serviceAppointments: {
  serviceId, staffId,
  start, end,                        // UTC ms; end = start + duration
  blockedUntil,                      // end + buffer; used for conflict checks
  guestName, guestPhone, guestEmail?,
  bookingId?,                        // linked villa stay, if any
  chatSessionId?, source,            // same union as bookings.source
  status: 'booked' | 'arrived' | 'in_service' | 'completed' | 'cancelled' | 'no_show',
  paymentStatus: 'unpaid' | 'paid' | 'refunded',
  price, currency, confirmationCode, accessToken, createdAt
}  .index('by_staff_start', ['staffId', 'start'])
   .index('by_start') .index('by_booking') .index('by_chatSession') .index('by_guestPhone')

chatSessions.pendingServiceQuote?: { serviceSlug, staffId, start, guestName, guestPhone, price, currency, createdAt, appointmentId? }
```

## 2. Shared logic (`convex/lib/serviceSlots.ts`)
Every entry point uses the same three functions: admin UI, AI tools, and later the public web.
- `staffBusyRanges(ctx, staffId, dayStart, dayEnd)`: merges working-hours gaps, breaks, time off, and appointments into busy intervals.
- `findOpenSlots(ctx, { serviceId, date, staffId? })` → `[{ start, staffIds[] }]` on a 15-min step. A slot is open for a staff member when `[start, start + duration + buffer)` doesn't overlap anything busy.
- `createAppointmentRecord(ctx, input)`:
  - re-runs the check for the chosen staff member,
  - auto-assigns staff when none was requested (the qualified, free staff member with the fewest appointments that day),
  - inserts the appointment, or throws "That time was just taken".
- Timezone: resort time is `Asia/Bangkok` (via `@date-fns/tz`, already a dependency). Store instants as UTC ms and working hours as local `HH:mm`.

## 3. Admin backend (`convex/adminServices.ts`, all `requireAdmin`)
- Staff CRUD (+ archive), service CRUD (+ archive), time-off add/remove.
- `listSchedule({ from, to, staffIds? })` returns staff, appointments, and breaks/time off expanded as blocks for the range.
- `createAppointment`, `rescheduleAppointment` (validates like create; used by drag/resize), `updateAppointmentStatus`, `markPaid`, `cancel`.

## 4. Admin UI
There are two kinds of booking, so the single sidebar **Bookings** item splits into two:
- **Hotel bookings**: the existing villa-stay calendar (`AdminBookingsView`, unchanged apart from the label).
- **Staff bookings**: the new staff/services schedule, `AdminStaffBookingsView.tsx`.

Wiring:
- `AdminDashboardView` in `AdminSidebar.tsx`: `"chats" | "hotel" | "staff" | "questions"`.
  - Icons: `BedDouble` for hotel, `CalendarClock` for staff.
  - Group both under a "Bookings" label, or list them flat.
- `AdminChatDashboard.tsx`: page title and view switch (~L960) render the matching view.

The Staff bookings view follows the patterns in `AdminBookingsView.tsx`:
- `EventCalendar` with `defaultView="resource"` and Day/Week switch. Resources are active staff.
  - `renderResourceHeader`: avatar, name, appointment count.
  - `renderEvent`: guest initials, status chip, time • service.
  - Breaks and time off are `readOnly` events with a hatched style.
- Toolbar:
  - Today / ‹ › / date
  - Day | Week
  - "N of M staff" multi-select
  - Filters (service, status)
  - "N booked in view"
  - **New appointment**
- **New appointment** dialog (service → date → open slots from `findOpenSlots` → staff (optional) → guest).
  - Clicking an empty slot opens it pre-filled.
  - Guest details can be pre-filled from an existing villa booking.
- Clicking an appointment opens a side sheet with details and actions: Arrived, In service, Completed, Mark paid, Cancel.
- Drag/resize reschedules through `rescheduleAppointment`. The calendar reverts the move if the server rejects it.
- Staff and Services management: two simple table + dialog screens reached from the same view: tabs `Calendar | Staff | Services`.
- The mock's "Log History" tab is deferred; see Later.

## 5. AI booking (`convex/lib/chatTools.ts`, `convex/chatAi.ts`)
Uses the same two-step, confirmation-enforced pattern as villa bookings.
- `list_services` (all channels, read-only): name, duration, price, description.
- `check_service_availability({ serviceSlug, date, time? })`: returns open times. If `time` is taken, it returns the nearest alternatives.
- `prepare_service_booking({ serviceSlug, date, time, guestName, staffPreference? })` (messaging channels):
  - validates the request and auto-assigns staff,
  - stores `pendingServiceQuote`,
  - the AI reads back service, time, staff first name, and price, then asks the guest to reply "yes".
- `confirm_service_booking()`: no args. It re-checks the slot and creates the appointment, which blocks the staff member's time. If the slot was taken in the meantime, it returns alternatives.
- Extend `get_my_bookings` / `cancel_booking` to include appointments (reference prefix `SVC-`).
- Phone comes from the session (as in the villa flow), never from model args.
- Guests with a villa stay: `bookingId` is linked automatically when the phone matches an upcoming stay.
- Prompt: one short section on services and the prepare → confirm flow.
- Web chat: `list_services` and `check_service_availability` only at first. A service booking card comes later, mirroring the villa booking card.

## 6. Seed + tests
- Seed: 4–5 staff (therapists, chef, driver) with lunch breaks, 5–6 services from `src/lib/data/experiences.ts`, and a day of sample appointments.
- `convex-test` unit tests:
  - slot finder respects working hours, breaks, time off, buffers, and existing appointments
  - two overlapping creates → second fails
  - cancel frees the slot
  - auto-assign picks a free, qualified staff member
  - `confirm_service_booking` fails without a quote, with a stale quote, or when the slot is taken
- Add AI eval cases to `scripts/ai-booking-eval.ts`.
- Playwright: schedule renders seeded staff columns; create appointment → it appears and blocks the slot.

## Order / PRs
1. **PR 1 – Backend**: schema, `serviceSlots` lib, admin mutations/queries, seed, and tests.
2. **PR 2 – Admin staff bookings UI**: split the sidebar into Hotel / Staff bookings, resource calendar matching the mock, new-appointment dialog, detail sheet, and staff/services management.
3. **PR 3 – AI booking**: tools, prompt, `get_my_bookings`/`cancel_booking` extension, and evals.
4. Later:
   - Log History (audit table of who changed what)
   - public web booking card
   - services that need two staff or a room (couples massage)
   - reminders (LINE/WhatsApp message before the appointment)

## Open questions
1. Who can book a service: only guests with a villa stay, or anyone?
2. Payment: separate pay link per service, or added to the villa bill?
3. Do any services need more than one staff member, or a physical room with limited capacity?
4. Can the AI assign any qualified staff member, or should guests be able to request a specific person?
