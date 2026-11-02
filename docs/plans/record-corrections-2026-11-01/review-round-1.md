# Independent review round 1

Reviewed head c863f12, base09a8450, PR34. Kiro Opus5.5 CLI performed Standards/correctness review; Sol6.1 performed Spec/correctness review. Both requested changes; no hard documented standards violation was identified. Kiro findings were source-inferred; Sol reproduced five bounded in-memory scenarios and identified other UI/legacy gaps from source. This is not final approval.

## Findings and resolution tracking

- Sol S1: legacy manual appointment payment reversal unavailable. Completed: proven-origin legacy reversal with receipt/refund/ambiguity/revision/retry guards; original unknown tender/date remain unknown. See appointment-review-fixes.md.
- Sol S2: fully historical appointments start booked rather than completed. Completed: authenticated ended services default completed/unpaid, creation history agrees, subsequent POS collection retains completed status. Mounted form explains the default.
- Sol C1 / Kiro C2: full provider refund blocks a reserved extension payment and makes live stay read-only. Completed provider payment semantics and regression coverage in provider-review-fixes.md; parent removed the live-refunded edit/cancel UI and mutation blocker and added regression coverage. Unknown legacy refund balances remain protected from recollection.
- Sol C2: omitted known refund source loses receipt history and per-payment counters. Parent auto-resolves a sole unambiguous source; multiple sources require selection. Older unitemised money is separately bounded by remaining net minus known payments/receipts. UI no longer offers an unrestricted source-less return.
- Sol C3: stay refund replay ignores changed metadata. Parent stores a normalized actor/source/currency/method/reason/effective-time fingerprint and freezes the full submitted UI payload. Exact committed retries work after revision changes; changed fields reject.
- Kiro C1: POS unreceived reversal bypasses live Stripe checkout protection. Completed atomic proof-phase live-checkout guard; rejected reversal leaves a full database snapshot unchanged.
- Kiro C3: legacy provider money becomes unreconcilable after itemised extensions. Completed provenance capture before the first itemised extension and exact provider reconciliation tests; ambiguous older evidence remains explicit manual review.
- Kiro C4: legacy already-recorded checkout redelivery returns a permanent failure. Completed proof-bound exact legacy replay and mismatch regressions.

The separate CI failure at200% phone text was repaired in799dfdf: separate native date/time inputs, bounded payment fieldset, stronger reachability checks. All44 browser tests and11 payment-correction tests passed.

## Standards observations

Kiro reported heuristic duplication in settled-money predicates, page/key validation, differing cleanReason functions, leftover staging flags, string history entity types and a large POS module. These were not hard violations. This repair round prioritizes concrete correctness and workflow findings; broad module refactors would expand review risk. Obsolete staging guards may be removed where directly verified by provider integration.

## Parent repair verification

59 focused booking/backend, order lifecycle and mounted financial UI tests passed, including source linkage, mixed-source bounds, exact/mismatched replay and live refunded Edit/Cancel visibility. An additional 92 wider regression tests passed; one old mixed-source refund fixture now explicitly identifies the unitemised deposit and passes in the focused rerun. Combined app/test/backend typechecks passed at the intermediate repair checkpoint. Combined final checks and independent re-review remain pending until all owners freeze edits.

Appointment repairs passed231 focused regressions and all three typechecks, scoped lint and diff checks. Kiro provider repair was interrupted by a transient connection reset after implementation; the same model resumed regression and handoff work. No merge decision has been made.

All repair owners froze edits. Provider checks:911 backend tests passed, all typechecks and scoped lint passed; an obsolete UI calendar read-only expectation was corrected by parent. The browser assertions initially passed44 but worker shutdown timed out; a subsequent one-worker run passed all44 and exited0. Parent combined pnpm verify is the final local gate before the next fixed-head review.

Final combined local repair gate: pnpm verify exited0 (1,603 tests/149 files, app/test/Convex types, lint and production build). Browser rerun:44 passed/exit0 with one worker. This evidence validates the repair commit, not independent review approval.
