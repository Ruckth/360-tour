# Independent review round 2

Both independent reviewers assessed head `2c1cdd981a9ae6efdca5a84645de57af780670b1`. Kiro Opus 5.5 reviewed standards/correctness and Sol 6.1 reviewed specification/correctness. All earlier findings were closed except their shared integration finding: the combined cancellation/refund dialog could not identify a refund source when a stay had multiple payments. Both requested this repair before merging. No new high-severity finding or hard standards violation was reported.

## Shared finding: combined cancellation and refund

The cancellation dialog now loads the same bounded financial history as standalone refunds and shares its payment/receipt/older-unitemised source selector. It sends the selected typed reference and limits the amount to that source. Loading or incomplete history prevents refund submission; cancellation keeping payment remains available. Refunds from additional sources can be recorded separately.

The submitted atomic cancellation/refund payload is frozen after an attempt so a lost-response retry sends identical source, amount, business time, actor-bound request key and audit details. Ordinary cancellation without a refund does not acquire a false durable-retry promise. The old source-less full-refund API preserves its ambiguity guard and gives a recovery instruction that its caller can actually follow.

Regression evidence covers two actual payments and a selected partial refund, exact atomic replay with unchanged history and a single refund, selected payment counters, legacy ambiguity rollback, mixed older/itemised deposits and source caps, mounted source selection, loading state, and frozen retry data.

## Validation before final review

- Full unit suite: 1,605 tests in 149 files passed before the final two added regressions.
- Final focused backend/mounted UI suite: 41 tests in two files passed, including both additional regressions.
- App, test and Convex typechecks passed; test typecheck passed again after the last regressions.
- Scoped ESLint and diff checks passed.
- Previous head had all three CI checks green, including production build, 44 booking browser workflows and smoke tests. The new commit requires fresh CI and independent review before merge.

Only isolated test data was written. No live business data or manual deployments were used for verification.
