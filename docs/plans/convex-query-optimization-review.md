# Independent implementation review

Date: 2026-09-30. Implementation base: `6473a2b`. First reviewed commit: `64cb008`.

Independent Standards and Spec reviewers examined `git diff 6473a2b...64cb008`. The coordinator reproduced calendar and iCal failures with local `convex-test` probes; the Spec reviewer reproduced custom-scope resolution failure. Temporary probes were removed. No deployment or live database writes were performed.

## Standards

Three documented-standard findings and one judgment call:

- Calendar reads 100 host blocks before overlap filtering and can claim completeness after dropping a mirror-less long block. Detect property truncation too. This conflicts with the performance skill requirement to preserve results without dropped records.
- Availability permits 3,100 villa-days × 20 rows, and calendar permits independent large scans for 100 villas. Neither bounds the total transaction. Introduce shared limits with headroom and explicit incomplete/error behavior.
- Legacy message migration copies every message from up to 25 sessions. Three valid 8,192-message arrays already exceed the 16,000-document write limit. Bound writes across the transaction and preserve resumption.
- Possible Duplicated Code: payment validation and `blockBookingDates` both scan booking overlaps in the same mutation. Consolidate the atomic validation/hold operation.

Worst Standards severity: P2. Current transaction ceilings were verified against [Convex limits](https://docs.convex.dev/production/state/limits): 32,000 documents scanned, 16,000 documents written, 4,096 index ranges, 16 MiB read/written per invocation.

## Spec

Five correctness findings, rated P1 by the Spec reviewer:

- F2: A mirror-less long host block hidden behind 100 newer expired blocks disappears while calendar `complete` remains true. The spec forbids presenting a sliced calendar as complete.
- F3: Fetch results check only URL equality. URL A → B → A accepts an old A response, and stale errors can overwrite a newer successful sync. The spec requires a source revision guard across fetching and application.
- F7: Exact approved lookup still caps the undefined-property bucket. Custom and multi-property answers share that bucket; the selected answer can remain hidden behind 101 unrelated custom scopes. The spec requires global/custom/real/multi-property scope parity.
- F9: Session cursor pagination does not bound embedded message writes. Metadata migration also permits 100 × 1,000 message reads. The spec requires bounded, resumable transactions.
- F7 rollout: Returning indexed curated matches immediately bypasses an unbackfilled villa translation when a newly indexed global translation matches. The spec requires old/new reader compatibility and unchanged scope precedence during migration.

No unrelated scope creep was identified.

## Coordinator checks

Additional fixes requested: active curated candidates hidden by archived variants, selected-month read failures displayed as free dates, aggregate limits on duplicate availability rows, and use of the migrations component for non-trivial migrations as required by the migration skill.

First implementation validation under Node 22: typecheck, lint, 71 files / 533 unit tests, and the default Turbopack production build passed after replacing the isolated worktree's dependency symlink with an offline install. The webpack-only route export validation failure is outside the changed code; the normal project build succeeds.

## Resolution and final validation

The audit fixes address all findings above. A second review identified data-sized `Promise.all` fan-out in exact knowledge/curated lookups: total read budgets alone did not prevent more than 1,000 concurrent I/O requests. These reads now run sequentially, check range budgets before launching, and reuse previously read answer documents. Instrumented tests measure maximum requests in flight and confirm exhausted budgets prevent additional launches.

The revised implementation passed 72 files / 551 tests and the default Node 22 production build before the final concurrency change; its affected suites then passed 84 tests, including three added concurrency regressions.

The booking/home/chat E2E run passed 40 of 41 tests initially. The remaining test attempted to use the public language switcher on the unsupported `/ar` global 404, which has no public navigation. The test now returns to the home page before verifying Arabic is absent from the language menu, preserving its route and menu assertions. All 41 tests passed on the rerun.

The final Spec review identified one additional F7 blocker: approved AI context still selected 200 creation-ordered scopes before ranking by answer update time, and stopped global discovery after 200 unrelated scoped answers. The implementation replaces these cutoffs with complete budgeted candidate reads and early exit after 30 eligible answers. Four regressions fail on the prior implementation and pass after the fix. The targeted Spec re-review reports no remaining actionable merge blocker; Standards re-review also passed the other revised paths.

Final coordinator validation under Node 22.22.3: `pnpm verify` passed (app typecheck, lint, 72 files / 558 unit tests, default Turbopack production build). `pnpm exec tsc --noEmit -p convex/tsconfig.json` passed separately. The 41 Chromium E2E tests cover booking/payment demo flow, calendars, home booking, chat handoff, mobile behavior and localization. Live authenticated admin behavior, deployment metrics and production backfills were not exercised; backend admin behavior is covered by local Convex tests.

The E2E harness was a temporary config pointing at a directly launched local Next server with placeholder Convex/Clerk configuration; it avoided the repository's default `pnpm dev` deployment step. The temporary config and server were removed/stopped. Collaborative preview navigation succeeded, but its snapshot tool failed twice, so no manual snapshot assertions are claimed.

Integration completed locally into `codex/admin-completeness` with merge commit `ec182f7`. The main workspace's dependencies were installed from the frozen lockfile, and app/Convex typechecks passed again after integration. The Next type reference changed by preview generation was restored separately. Production deployment and backfills remain separate rollout steps; the implementation report contains the component-based dry-run, progress and backfill commands.
