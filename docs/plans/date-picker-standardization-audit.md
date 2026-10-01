# Date / time picker implementation audit

Implemented against local main `605c30f`, following the approved [plan](./date-picker-standardization.md). No backend/schema or payload changes.

## Components and callers

| Shared component | Callers / purpose |
| --- | --- |
| `DatePicker` (Radix Popover + Calendar + Button) | Property reviews, time-off dates, staff roster week navigation, new appointment, reschedule |
| `TimePicker` (shadcn Select hours/minutes) | Optional time off, shifts/breaks, roster, break editing, settings |
| `DateTimePicker` | Admin chat filters through the existing label/default adapter |
| `Calendar`, `appearance="booking"` | Existing `BookingRangePicker` keeps availability loading, selection and checkout rules |
| `Calendar`, default appearance | Shared single/range styling, including the existing REUI Base UI calendar navigation adapter |

Date parsing/formatting now lives in `src/lib/dates/`. Date-only values remain local calendar dates; resort timestamp conversion and booking range rules remain in their domain modules. Thai booking captions retain Buddhist years.

Native date/time inputs in scope are migrated. Settings still declares `type: "time"` in its field configuration; rendering dispatches that configuration to `TimePicker`.

## Standards

Independent review found no documented-standard breaches or actionable baseline smells. Two functional findings were fixed:

- **P2 — invalid field focus:** when a custom picker precedes a required native input, native validation could move focus away. Focus now returns to the first invalid picker after browser reporting. Actual browser click and mixed-field validation passed.
- **P2 — reset accessibility:** reset could remove the visible message while retaining error attributes when an empty required default remained invalid. Reset now clears the picker's owned error attributes independently of value changes.

Re-review at `9f1d5c2` confirmed both resolved with no remaining blockers.

## Spec

Independent review identified two findings, both fixed:

- **P2 — native time step base:** a saved `09:10` with 15-minute steps must accept `09:25`, matching native input validation. Options and validation now use the existing default/value attribute as the step base, preserving saved precision.
- **P3 — date-time locale:** `DateTimePicker` now accepts and forwards `locale`.

Re-review at `9f1d5c2` confirmed both resolved with no remaining blockers. Domain checks retained blank time as whole day, optional To, appointment slot reset, roster Monday selection, inclusive time-off days and end-exclusive booking checkout.

**Review totals: Standards 2 findings resolved, 0 open; Spec 2 findings resolved, 0 open.**

## Verification

- `pnpm check`, `pnpm lint` and production `pnpm build`: **passed**. Build used a placeholder Convex endpoint and emitted expected villa-data fallback warnings; no backend deployment was run. The first build attempt hit Turbopack's external `node_modules` symlink restriction; a frozen offline dependency install in the isolated worktree resolved it without source/config changes. Typecheck was rerun after removing the temporary fixture's stale generated dev type.
- Full unit suite: **75 files / 605 tests passed**.
- Date-value, booking-date and whole-day time-off tests: **31 tests passed in each of `Asia/Bangkok` and `America/Los_Angeles`**.
- Public Playwright regression: **6 tests passed**, covering booking through demo payment, unified range selection, Thai Buddhist month, payment/success boundaries and home quick booking.
- Real component browser fixture: **7 interaction groups passed** — mixed custom/native validation and reset; date constraints/focus/FormData; optional-time clear and saved off-step minutes; date-time month/clear; nested Radix dialog; REUI Base UI single/range navigation; 320px layout with selected-date appearance in light/dark.
- The fixture used actual `TimeOffFields` and `AdminCalendarHeader`, alongside shared pickers. Its temporary route was removed before production verification. Source, smoke script, result JSON and screenshots are preserved locally in `output/date-picker-audit/` (untracked artifacts).

Authenticated admin CRUD and live backend writes were not exercised. UI behavior was verified using actual frontend components without deploying Convex; domain unit tests cover the unchanged timestamp/range boundaries. Browser work began in the shared T3 preview and continued headlessly after the preview explicitly reported unavailable.
