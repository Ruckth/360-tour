# Staff calendar final audit — 2026-10-01

Reviewed the calendar implementation from `ed07b4a` through `a86c001`, including the later shared date and time pickers. Independent standards and requirements reviews checked the resulting fixes before integration.

## Requirements review

| Finding | Change | Verification |
| --- | --- | --- |
| An in-flight booking could be dismissed, and its completion closed a newer form. | A synchronous submission guard prevents repeated submits; fields and dismissal stay locked until the request settles. | Browser reproduction before the fix; after the fix, duplicate submission creates one appointment, Escape keeps the form open, and success opens its details. |
| An externally moved appointment closed its sheet but retained its action state for the next guest. | Key the sheet by appointment identity so each selection owns fresh state. | Browser reproduction before the fix; after the fix, moving the booking out of range closes both dialogs and selecting another guest opens only their details. |
| Cleanup overlapping the next date was missing from the calendar. | Use `blockedUntil` for appointments that occupy time; terminal cancellation/no-show records use service end. | Convex regression covers booked and completed services crossing midnight, including the exact end boundary. |
| Weekly break confirmation did not show affected dates. | Show affected and exempt dates over the next four weeks, with an explicit statement that the weekly default continues afterward. Conflict checking still covers upcoming bookings beyond the preview horizon. | Convex regression verifies affected dates and overrides; browser check verifies the displayed dates and loading lock. |

## Standards review and refactoring

No additional production standards finding remained after review. Service changes now load the new service once and check its reviewed terms, qualification and occupancy in the same helper. Details and service updates remain atomic. Submission controls were formatted consistently. No Claude completion markers were found in tracked source or documentation.

## Validation

- Type checking and lint passed.
- All 607 unit tests in 75 files passed.
- The webpack production build passed using a placeholder Convex URL. Expected villa-query fallback messages appeared because that URL has no backend; this was a build check, not deployment verification.
- Browser checks passed for pending booking controls, repeated submission, selected-sheet lifecycle, weekly date previews, loading locks and discarded proposals.
- `git diff --check` passed.

## Local interaction preview

The localhost preview uses the real calendar components with isolated in-memory data. Its fixture stays outside the repository. The audit corrected lifecycle guards, included time-off reads and availability plus update/remove operations, and added controllable pending query results. Fixture type checking and browser checks passed, including stale time-off rejection and releasing availability after a change. Convex regression tests, rather than fixture behavior, establish the production backend rules.

Integration is into local main. No remote push or application/Convex deployment is part of this audit.
