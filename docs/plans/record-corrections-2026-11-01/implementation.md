# Record corrections delivery

Target: Ruckth/360-tour, branch fix/audited-record-corrections, base origin/main 09a8450.
User authorized implementation, testing, independent Kiro Opus 5.5 and GPT-6.1 Sol review/fix rounds, PR creation and merge after checks/review.

## Scope and acceptance

Track every item in independent-audit.md (prior findings 1–8 and B1–B15). Overlapping findings may share an implementation, but none may disappear silently. Application corrections must be reachable in the UI and recorded atomically, not just exposed as unused backend mutations.

- Orders: discoverable discard/restore with retained contents and source-link checks; complete readable, paginated history; dates on service rows; proper effective payment dates; corrections that preserve issued receipts.
- Bookings and money: recorded partial/full refunds independent of cancellation, correct net balances and linked-order visibility, explicit payment-entry/tender corrections without pretending that real money moved, price overrides with reason, revision protection, cancellation/reopen and retained deletion snapshots, historical entry without surprise notifications.
- Appointments: historical staff entry and rescheduling, status corrections with history/concurrency, archived-source handling, historical roster warnings, no-show fee path, creation/history/payment actor and timestamps.
- Customers: usable profile editor and history, archive/restore, deliberate duplicate merge preserving receipt snapshots and references, meaningful handling of the >100 open-order limit.
- Configuration: durable history for staff/services/properties/rooms/settings/time off/date blocks/roster, restored staff assignments, stable past roster defaults, past time-off entry and lookup, no redundant edit confirmation.

## Decisions

- Public self-service future booking remains strict; authenticated staff corrections allow past work with explicit effective dates and automatic recorded timestamps. Do not invent arbitrary 30/90-day limits.
- Preserve authentication, payment idempotency and concurrency checks, receipt snapshots, live provider checkout protection and genuine booking/resource integrity. Missing information must not be replaced with invented history.
- Routine edits log automatically and do not demand a reason modal. Financial reversals and exceptional historical conflicts require context/reason. Use existing UI components, theme and layouts.
- Void alone does not reverse money or make a paid source unpaid. Distinguish a mistaken recorded tender/payment from actual received funds. Preserve any provider-origin money. Payment corrections need a supported transaction model and tests before exposure.
- Old audit data remains readable; new history starts now. Do not claim reconstructed history is original evidence.
- All data mutations plus logs are atomic. New queries are bounded/paginated. Data shape additions preserve old records; tests cover legacy documents.
- No live data mutations or deployment during local verification. PR merge authorized once CI and independent reviews are resolved; do not bypass checks or repository protections.

## Work ownership

Initial backend: Sol owns convex/ and a backend-contract.md document here. No frontend edits.
Initial UI: Kiro owns only AdminStaffTimeOff.tsx, AdminStaffServicesManager.tsx, OrderPanel.tsx, and directly relevant unit tests. It removes UI-only past time-off limits/redundant confirmation and adds actual service date selection. No backend edits until coordination hands it the integration phase.
Parent integrates, tracks coverage, runs full verification, and manages git/PR. Agents do not commit, push, create PRs, or merge.

## Gates

Focused new regression tests for each correction path and rejection path; pnpm typecheck, lint, test:unit, build; relevant component browser tests and disconnected browser smoke tests. Existing passing tests alone do not prove new correction scenarios.
After implementation, independent Sol and Kiro audits at a fixed SHA/diff, repair all actionable findings, repeat changed-scope checks and review until no unresolved correctness/security/data-loss/required-workflow findings. Document residual limits honestly. Open PR, address automated review/CI, then merge without bypass.

## Progress

- [x] Matching source established and independent audits collected.
- [x] Fresh base fetched; dedicated branch created; unrelated output/ and tmp/ preserved.
- [x] Backend implementation and contract.
- [x] Frontend correction paths and history.
- [x] Complete audit-item coverage and regression evidence.
- [ ] Independent Sol and Kiro final reviews.
- [ ] PR checks, final review and merge.

## Integration checkpoint: appointments and past time off

- Parent connected TimeOffList to listTimeOffPage, with Upcoming/Past filters and continuation even when a filtered page is empty. Historical records remain editable/removable in the list.
- Pending TimeOffDialog writes prevent dismissal and repeated submission; focused behavioral test covers Escape, disabled Cancel and successful closure.
- Updated five existing history/status expectations to the requested creation-history and time-correction behavior, retaining availability, payment and revision checks.
- Verification: 48 existing admin/calendar backend tests passed; 13 entry/time-off UI/helper tests passed; normal scoped ESLint passed. Full intermediate unit run: 1399 passed, 1 old guest-cancellation history assertion failed; corrected to assert creation + cancellation metadata, then all 17 service-booking tests passed. Full suite must run again after remaining workers land.
- Customer slice reports 101 passing tests. Merge is still disabled until POS reviewed-customer revision integration and fixture activation; >100 nonempty edits remain guarded until then. Source merge >100 references additionally needs a scalable completion path before this can be called unrestricted cleanup.
- Appointment slice reports 111 passing tests; financial ledger remains separate. Configuration Sol now owns serviceSlots/adminServices solely for roster version integration, preserving completed appointment behavior.
- Financial Kiro CLI session 27273 owns pos/adminBookings/bookings/billMath/orderLinks, booking UI and financial modules. Do not overlap these edits while it runs.
- Remaining unassigned integration: complete order discard/restore and direct Orders controls; POS customer-revision contract and active merge; receipt/pay panel integration and financial caller tests; staff/service/timeOff history panel; effective roster integration verification; full UI/CI/review/PR/merge gates.

## Latest integration checkpoint (supersedes earlier ownership/remaining lists)

- Checkout/customer integration is delivered in checkout-delivery.md: reviewed customer revision protocol is active, edits no longer scan linked orders, and merges use resumable bounded jobs. Payment/receipt corrections and paginated item history are wired. Worker reports 304 focused tests plus 21 subsequent UI tests and full typechecks.
- Kiro CLI session 46727 now owns POS discard/restore and no-show fee APIs plus NewBookingDialog/AdminBookingsView controls. Sol appointment-finance/Stripe task owns payments/crons and appointment financials. Parent owns remaining integration, gates and git.
- Parent connected staff/service/time-off history disclosures and added a paginated cross-record history reader so removed time off remains discoverable. Dates render in Bangkok time. Added retained date-block create/edit/removal history, reviewed-snapshot guards on update/remove, and pending-save protection in DateBlockDialog. Its new-block form exposes all date-block history, including removed blocks.
- Parent focused verification: 69 tests across adminBookings, configurationHistory, configuration-history UI, date-block-corrections UI and staff-time-off-dialogs passed. Scoped lint passed. Combined typecheck reached new concurrent discarded-order fixture shape errors; resolve with actual lifecycle frontend integration, not dummy fields.
- Still outstanding: lifecycle/fee frontend and fixture integration, final appointment/Stripe-to-receipt integration, complete older financial history access, final full checks/browser tests, both independent reviews, PR/CI/merge. User reiterated merge once everything is finished.

## Completed integration before final review

All implementation owners have delivered and frozen edits. The authoritative integrated behavior and coverage map are in integration.md. Earlier ownership and outstanding integration lists are historical. Remaining gates: independent fixed-head Kiro/Sol reviews, actionable repairs, PR checks and merge.
