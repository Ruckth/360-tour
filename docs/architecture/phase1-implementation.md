# Phase 1 implementation evidence

Phase 1a–e is implemented. The source and local checks pass; no shared development or production data was cleared, seeded, or deployed. The parent owns independent review, merge, and the live cutover described in [the reset runbook](phase1-reset-runbook.md).

The branch preserves the unpublished Phase 0 base, merges the reviewed staff/refund stack, and merges `origin/main` at `72a657f`. Cashier receipt write visibility from `1832607` remains in all five paid-correction functions and its previous/future business-date regression passes.

## Result

- Schema: 91 integrated tables → 74. Fourteen explicitly retired tables are deleted; four webhook event tables become one channel-indexed `channelEvents`. All nine domains, including 14 live marketing tables, remain. The old 55-table estimate was stale.
- D6 names include `orderRefunds` and `orderLineLinks`. API IDs/types and tests use the renamed tables. Existing channel ingress remains in Next until Phase 2.
- Retired Q&A storage, authoring/read paths, keyword answers, obsolete reply modes, backfills, migrations component, and unused UI/dependencies are removed. Static suggestions, staff handoff, approved business facts and unknown-question review remain tested.
- Stored money is integer satang and percentages are basis points. `convex/shared/money.ts` owns rounding. Stays, orders, services, coupons, spend, referrals, refunds, corrections, replays, UI forms, demo prices, and Stripe use that contract. Stripe charges the stored amount directly. Signed deleted-booking events return 200 and record deduplicated orphan history.
- Actual public pages live under `[locale]`; re-export copies are gone. Knip understands Next routes and Convex's dynamic entry points and runs in CI with configuration hints treated as errors.
- `empty`, `demo-resort`, and `busy-weekend` are internal seed scenarios. They refuse a nonempty database. The same `seed:seedAll` contract is callable from the test harness or an explicitly configured integration/E2E backend. Demo is tested from empty; busy creates six stays and 12 occupied nights. Records include normalized contacts, money totals and service/staff snapshots.

## Validation (Node 22)

| Command | Result |
| --- | --- |
| `pnpm arch:score --phase 1` on a committed clean tree | 14/14 |
| `pnpm verify` | 234 files, 2,910 tests; all typechecks, lint (0 warnings), production build pass |
| `pnpm knip` | pass, including configuration hints |
| `pnpm test:booking-ui` | 223 pass; 24 existing opt-in screenshot cases skipped |
| `pnpm test:e2e:smoke` | 12 pass (disconnected production UI, port 3027) |
| Staff, POS refunds, money cutover and Phase 1 suites | 90/90 |
| Channel adapters, server secret and Phase 1 suites | 25/25 |

Before implementation the original scorecard passed 7/14 Phase 1 gates: 91 tables, 14 retired tables, 15 old names in its original list, 32 files mentioning obsolete compatibility, nine migration definitions, 15 page re-exports and no Phase 1 named tests. It now passes 14/14. The table count is strengthened from informational to an explicit 74-table target; the old-name list also covers refund/link tables. All prior security test-name gates remain.

Convex API code was regenerated through the CLI's offline non-component generator (`pnpm exec convex codegen --system-udfs --typecheck disable`), followed by all three real typechecks. No Convex deploy was run. The React best-practices checklist was applied to the TSX edits; browser tests exercise input drafts, keyboard/focus flows, refund retries, receipts, responsive layouts and accessibility.

`node scripts/architecture-reset.mjs --old-ref 72a657f --out output/phase1-reset-reviewed-final` prepared the exact 91-table old-schema manifest, scheduler helper and empty snapshot archives offline. CLI flags and ZIP layout were checked against the installed Convex CLI. This does not execute the destructive steps.

## Remaining external work

Follow the runbook on an isolated backend first, then the parent's selected shared deployment: verify mapping, pause guest/staff writes and provider ingress, expire Stripe sessions, export storage/data, pause eight crons and drain/cancel scheduled work (including the old migrations component), clear under the old schema, deploy, reseed, verify live owner/cashier/booking/POS/refund/chat behavior and restore traffic. The production mapping supplied by the parent is `wary-toad-189`; secrets remain outside git.

## Parent audit follow-up

The independent audit identified public/admin money presentation errors (homepage percentage, OTA edit drafts, checkout override placeholder/limits, chart ticks, provider-refund history and tool minimum-spend values). These boundaries now convert exactly once, with OTA round-trip, chart and homepage regressions. Signed Stripe callbacks normalize untrusted booking reference strings before lookup, preserve separate expiry/completion orphan records, and acknowledge known pre-cutover financial orphans only. Newer missing-booking money remains a visible failed Stripe delivery for reconciliation rather than silently disappearing.

The maintenance registration seam in `convex/auth/model.ts` gates every public query, mutation, action and HTTP handler using `ARCH_RESET_PAUSED`, while retaining internal seed/reset access. This brings forward the shared builder seam planned for Phase 3 so the cutover gate survives deployment. Existing per-record authorization is unchanged. Offline maintenance preparation preserves the old schema and pauses crons; rollback artifacts now include the new 74-table snapshot and scheduler helper. POS coupon allocations now consistently retain satang fractions instead of choosing whole-baht splits.

Parent verification on Node 22: 2,917 tests across 236 files, all typechecks, production build, Knip, and zero-warning lint pass after the audit fixes. The final component-browser run passes 223 checks (24 opt-in capture cases skipped). The isolated live preview confirmed booking creation with guest emails disabled, integer quotes, a 9,045-satang settlement, a 1,005-satang refund and 8,040 remaining, payment/refund replay, cashier historical-receipt denial, and guest transcript ownership. These backend tests used admin-auth identity impersonation; they did not exercise actual Clerk browser sign-in and sent no external guest messages.

An isolated old-schema rehearsal deployed the 91-table application with crons paused, populated 49 documents including old baht amounts and one stored file, cancelled one pending scheduled function, exported, cleared, restored, and compared every table/storage count successfully. The empty-root import retained the stored file. A second clear prepared that backend for the reviewed 74-table deployment and seed. No shared or production data has been changed by these rehearsals.

The isolated rehearsal subsequently deployed the reviewed new schema successfully, removed the migrations component and seeded all 74 tables under `ARCH_RESET_PAUSED=1`; expected sample counts matched. Final browser smoke coverage passes 13 cases including the homepage percentage regression. Native Chromium accepts the OTA fractional price input (10000.50 with step0.01); the amount round-trip is verified separately in DOM tests.
