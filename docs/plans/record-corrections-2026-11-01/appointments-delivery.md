# Appointment corrections delivery

Implemented locally on `fix/audited-record-corrections`. No commit, push, PR, deployment, live data write, package installation, child agent, or generated-file edit was performed. Concurrent customer/checkout/time-off UI changes were preserved.

## Delivered behavior

- Staff appointment entry preserves the calendar's actual selected past date and time. Past dates have no age cap, and actual historical times support whole-minute precision, including times absent from the current slot grid. Past work requires an explicit staff choice; it never substitutes a different time or auto-invents a historical assignment.
- Public/chat shared-helper calls still require future 15-minute starts. Only an explicit historical policy on an authenticated admin helper call permits past entry. Setting `source: 'admin'` alone does not permit it.
- Fully historical windows (`blockedUntil <= now`) may reference archived staff/services and staff no longer in the current service assignment. Creation retains staff/service descriptions. Current roster, break, time-off and assignment discrepancies are warnings recorded atomically, rather than claims about historical qualifications or historical rosters. An overlapping historical appointment requires a reason (trimmed, maximum 500 characters).
- Any appointment status can have its time/staff corrected with `expectedRevision`. Duration, turnaround, price, currency, payment state, receipt, issued order lines and tenders stay as recorded. Current/future time-blocking occupancy remains strict; an override reason cannot bypass it. Cancelled/no-show time corrections remain non-blocking until a separate status reopen succeeds.
- Correct status is reachable in the appointment sheet, including completed, cancelled, no-show and mistaken in-service records. Reversing any of those four states requires a reason. Every status correction requires a reviewed revision and an actual effective timestamp; reopens recheck availability. Fully past roster discrepancies/overlaps follow the same logged historical policy; current/future conflicts cannot be overridden. Leaving cancelled clears its obsolete cancellation metadata.
- Ordinary forward status buttons remain direct actions and now send the viewed revision. Mark paid opens a date/time entry for money already received, records `paidAt`/`paidBy`, sends the revision, and clears obsolete `refundedAt` only on an otherwise-unpaid source. Refunded-to-paid is rejected server-side. The existing open-order double-charge check is preserved.
- Creation logs its actor, actual service time and selected non-secret facts, including public/chat creation with a channel actor. No access token is copied to either history table. Change recording writes field differences, actor, recording time, effective time/reason and historical warnings in the same transaction. Rebooking logs the reference on the original as well as the new creation.
- Appointment history uses cursor pagination and offers Load earlier history. Creation is labelled explicitly; dates, payments, staff/service snapshots and exceptions are readable. Legacy appointments without historical evidence display that absence rather than invented creation events.
- Staff/service create, update, archive, assignment matrix changes and time-off create/edit/remove append selected non-secret snapshots to `recordChanges` atomically. Photo URLs/storage secrets are omitted. New staff archives retain service assignment IDs; restoring through `updateStaff({status:'active'})` restores surviving saved assignments, checks assignment size and audits service changes. Staff archived before this field existed retain their genuinely unknown assignment history.

## Endpoint and helper contracts

All endpoints below are in `api.adminServices` and require `requireAdmin`.

| API | Arguments / return semantics |
| --- | --- |
| `createAppointment` | Existing arguments plus optional `historicalReason`. Admin endpoint explicitly passes `{kind:'admin_historical', reason?}` to `createAppointmentRecord`. Historical entry requires explicit `staffId`; current/future creation still requires active assigned sources and availability. Returns existing `{appointmentId, staffId, confirmationCode, accessToken}`; token is never audited. |
| `findOpenSlots` | Existing `{serviceId,date,staffId?}` shape and array return. With an explicit staff and a past date, offers historical grid shortcuts regardless of today's roster/assignment. Current/future entries remain active/assigned and free. The UI can enter a historical exact minute independently of those shortcuts. |
| `previewAppointmentTime` | `{serviceId,staffId,start,appointmentId?}` → `{warnings:string[],needsReason:boolean,problem:string|null}`. Uses the appointment's retained duration/turnaround when correcting it. Returns actionable invalid-time/current-availability problems rather than crashing on an ordinary invalid selection. Mutation revalidates everything. |
| `rescheduleOptions` | Existing `{appointmentId,date}` → `{staff:[{_id,name}],slots}`. Historical dates include archived staff; past shortcuts do not assert current qualifications. Current/future options preserve the incumbent assignment or require a current service assignment. |
| `rescheduleAppointment` | Existing `{appointmentId,expectedRevision,start,staffId}` plus optional `historicalReason`. Supports all statuses. Only scheduling/staff snapshot fields change. No notifications are sent. |
| `correctAppointmentStatus` | `{appointmentId,expectedRevision,status,reason?,effectiveAt}`. All six statuses accepted except a no-op. Reason required when the old status is completed/cancelled/no_show/in_service. `effectiveAt` must be a safe integer and not future. No-show cannot be effective before the service start. Reopens recheck the occupied window. |
| `updateAppointmentStatus` | Existing forward-only transition graph. Adds optional `expectedRevision` for backwards compatibility; the actual sheet supplies it. No reason prompt. The dedicated correction API above always requires a revision. |
| `markAppointmentPaid` | `{appointmentId,expectedRevision?,effectiveAt?}`. Only unpaid, non-cancelled appointments; preserves open-order checks. Effective time defaults to now for legacy callers and cannot be future. Sheet always sends its revision and selected time. Does not charge money. |
| `refundAppointment` | Existing recorded-full-refund behavior, plus optional `expectedRevision` and `effectiveAt`; sheet supplies revision. Effective time defaults to now and cannot be future. Broad refund/payment correction ledger remains the money worker's scope. |
| `listAppointmentHistoryPage` | `{appointmentId,paginationOpts:{numItems,cursor}}` → native `{page,isDone,continueCursor,...}`. Page size integer 1–100; newest recorded events first, including creation. The old `listAppointmentHistory` remains the explicitly limited 50-event compatibility reader; the UI no longer uses it. |
| `listTimeOffPage` | **Time-off UI integration endpoint:** `{staffId,range:'upcoming'|'past'|'all',from?,to?,paginationOpts:{numItems,cursor}}`. Returns native pagination, newest start first. Optional start-based range is `[from,to)`, not an interval-overlap search. `past` means `end <= now`, `upcoming` means `end > now`; `all` retains both. Status filtering happens after the bounded page read, so an empty page can still have `isDone:false`. Always follow `continueCursor` until `isDone`, rather than treating an empty page as completion. Page size integer 1–100. No frontend time-off owner files were edited. |

`createAppointmentRecord(ctx,input,policy?)` authenticates again when `policy` is supplied. `assertAppointmentStart(start,policy?)` retains future-only public defaults; historical admin starts use minute precision, future starts keep 15-minute alignment. `canReschedule` retains the public/upcoming-booked rule; `canCorrectAppointmentTime` is the admin counterpart used by the sheet and calendar. `boundedIntegrityRows` fails after 2,000 examined rows; it never silently approves against a truncated prefix. Catalog reads examine 201 rows and explicitly fail above the supported 200 rather than silently losing archived sources. Schedule ranges remain at most 14 days and explicitly fail above 2,000 visible appointments. Time-off lookup/duration keeps the existing 60-day per-record duration limit, with no historical age limit. Ended time off is no longer blocked by a past appointment still marked booked.

The generic history integration uses the parent's existing `recordHistory.list({entityType,entityId,paginationOpts})` reader. Entity types written here are `appointment`, `staff`, `service`, `timeOff`; time-off kinds are `created`, `updated`, `removed`. Staff/service snapshots exclude avatar/image URLs. The parent's shared helper and reader were reviewed and reused, not modified.

## Exact owned files

- `convex/adminServices.ts`
- `convex/lib/serviceSlots.ts`
- `convex/lib/appointmentChanges.ts`
- `convex/lib/appointmentWindow.ts`
- `convex/schema.ts`: **only** `staff.archivedServiceIds` and `serviceAppointments.{serviceNameSnapshot,staffNameSnapshot,createdBy,paidAt,paidBy}`; every addition optional. Other schema diffs belong to concurrent workers.
- `src/components/admin/NewAppointmentDialog.tsx`
- `src/components/admin/RescheduleDialog.tsx`
- `src/components/admin/AppointmentSheet.tsx`
- `src/components/admin/AppointmentHistory.tsx`
- `src/components/admin/AdminStaffBookingsView.tsx`
- New `src/components/admin/AppointmentCorrectionDialog.tsx`
- New `src/components/admin/appointment-entry.ts`
- New `convex/appointmentCorrections.test.ts`
- New `tests/unit/appointment-entry.test.ts`
- This report.

No changes to `convex/pos.ts`, `convex/adminBookings.ts`, shared generated files, other schema sections or another worker's UI source.

## Verification

- `pnpm exec vitest run convex/appointmentCorrections.test.ts convex/serviceSlots.test.ts convex/roster.test.ts convex/pos.test.ts tests/unit/schedule-changes.test.ts tests/unit/staff-booking-helpers.test.ts tests/unit/appointment-entry.test.ts`: **7 files, 111 tests passed**. New suites contribute 17 backend cases and 5 entry-selection cases. Covers admin past/public rejected, source-label bypass rejection, archived sources, exact-minute entry, reasoned historical overlap, current/future override rejection, creation actor/no token, all four mistaken statuses, stale writes, conflicting reopen, transactional failed-save rollback/retry, receipt/order/tender immutability, payment effective time/refund loophole, >50-event pagination, legacy rows, time-off audit/lookup and archived assignment restoration.
- Focused ESLint on every owned changed/new TypeScript/TSX file: **passed**.
- Final rerun after audit-marker/read-bound refinements: new appointment backend/entry suites **22/22 passed**, owned-file ESLint passed, backend typecheck passed.
- `pnpm typecheck:app`, `pnpm typecheck:tests`, `pnpm typecheck:convex`: **passed individually** after concurrent checkout/customer type errors were resolved by their owner. Final combined `pnpm typecheck`: **passed** (app, tests, backend).
- `git diff --check` on the owned tracked files/schema: **passed**. Generated-file status stayed clean.
- Existing `pnpm exec vitest run convex/adminServices.test.ts convex/staffCalendarChanges.test.ts`: **44 passed, 4 failed** against obsolete assertions described below. These existing test files were outside the assigned new-test ownership and were left intact for parent integration.
- No browser session, build, full repo lint/unit suite, deployment or live provider action was run by this worker. Parent owns integrated browser/full-suite verification.

### Existing assertion updates for parent integration

1. `convex/adminServices.test.ts:65`, **adds and clears guest details later, preserving the slot and recording history**: expects exactly two detail edits; now also has the required original creation event. Expect three and verify that event.
2. `convex/adminServices.test.ts:178`, **reschedules with conflict checks and enforces status transitions**: expects a completed appointment time correction to be rejected. That is now an authorized revision-guarded correction; assert the changed time and retained status/payment terms.
3. `convex/staffCalendarChanges.test.ts:63`, **cancels while keeping the record and payment state, frees the slot and records who and why**: expects exactly two events and only one changed field per event. Now includes creation plus payment actor/effective time and cancellation metadata. Assert those fields with `arrayContaining` and preserve existing money/availability assertions.
4. `convex/staffCalendarChanges.test.ts:127`, **reschedules to another time and qualified staff, keeping length, turnaround and price**: expects arrived time correction to be rejected. Now verify the revision-guarded correction and retained status/terms.

## Explicit remaining integrations / excluded scope

- Parent runs normal local Convex codegen after integrating all workers. Added exports in the existing `adminServices` module already typecheck through its existing generated module import. The parent's new `recordHistory` module still requires ordinary generated API refresh; do not hand-edit generated files.
- Kiro/parent connects `listTimeOffPage` to the time-off UI with the exact sparse-page/range contract above and provides configuration-history UI as desired. Backend time-off create/edit/remove auditing is complete here.
- No-show fee checkout support, partial refunds, real/manual payment reversal and a proper money correction ledger are deliberately left to the money worker. The existing full recorded refund is not presented as that ledger. POS settlement actor/effective-date enrichment also belongs there; manual appointment payment entry is implemented here.
- Full roster effective dating remains outside this task. Weekly pattern edits can still change today's interpretation of a past day without an override. This implementation labels that uncertainty when entering/correcting historical work and records the discrepancy, without pretending to reconstruct a historical roster.
- Archived staff assignments removed before this change cannot be reconstructed honestly. New archives retain their known assignments; surviving saved service references restore atomically. Missing/deleted legacy descriptions are not invented.
- Legacy forward status/manual paid/refund API callers may omit the newly optional revision; the shipped UI sends one. The new explicit correction API and every time/detail correction require a revision. Parent may coordinate a future breaking API migration if it requires mandatory revisions on all legacy operational clients.

Final combined `pnpm typecheck`: **passed**, exit code 0. The environment emits its existing engine warning (project requests Node 22; local runtime is Node 24.19.0).
