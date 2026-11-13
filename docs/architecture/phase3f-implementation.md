# Phase 3f: local development and seeded Previews

Phase 3 dev/Preview exits are accepted and `.arch-phase` is **3**. `pnpm dev` owns one persistent private anonymous Convex backend and Next process; each PR Preview seeds only an empty database and retains its data across builds. Final root validation passed on Node 22: **2,991 unit/backend tests, 228 component/browser checks and 73 real-Clerk E2E checks**. All **30/30 Phase 3 gates** pass. Production merge/deployment acceptance is tracked separately below; Phase 4 contracts and measured hot spots remain.

PR: [#83](https://github.com/Ruckth/360-tour/pull/83). Required child parent `c856341e97058523895c043c42b2027e75cff5de` remains in history. Root merged production main `ad07a13d8701bfd1d1739f353f22762cd8a36b11`, preserving the later Phase 3e image and historical-archive fixes. Original child implementation/evidence is recoverable at `20467c4b9359eaab3d188feec5d93897414408c1`; accepted runtime fixes are in `7d4346c`, with the source-test optimization in `161541b`.

## Result and ownership

- `pnpm dev` requires explicit mode-600 Clerk test configuration and local owners, starts only an anonymous checkout-owned backend, seeds it atomically from empty, then starts Next. A realpath marker, exclusive lock, stable ports, isolated HOME/project and validated selector protect persistent SQLite/storage. Ordinary dotenv cannot restore deployment/provider credentials. SIGINT, SIGTERM, SIGHUP, startup failure and child exit clean up only this invocation's process groups. There is no reset path.
- `test:unit` retains every default test, partitioned into 90 Node/unit, 68 DOM and 91 Convex files. Focused `test:pure`, `test:dom` and `test:convex` use the same assertions and real component harness. `VITEST_MAX_WORKERS` is explicitly consumed, defaulting to four. Archive and test deadlines are unchanged. Ownership tests parse each implementation once per export group instead of repeatedly for every name.
- Convex is pinned to **1.50.0** for supported atomic branch Preview reuse. `vercel-build` requires the existing project-scoped Preview key, this repository's Vercel Git metadata and explicit team/project/default-branch scope. `--preview-name` requests `reuse: true`; `--preview-create` is excluded because it recreates data. After claim and before push, the hook checks exact branch identity and privately inspects provider variables. It then captures the URL, permits backend deployment, seeds only if empty and finally builds Next. Provider values never reach logs; Next receives explicit disabled values plus its own Preview site URL.
- The installed CLI's explicit mode-600 env file contains only the Preview key. Fresh local anonymous setup omits an empty selector-file argument until its anonymous selector exists. Local commands omit the newly deprecated `--local` option. Official generated bindings now import the component package's typed `ComponentApi` and expose the generated environment export.
- `preview:retention` is an offline dry-run planner with no network, key, scheduled cleanup or deletion implementation. Seven-day age/merge proofs, exact project/type/branch identity, protected complete export, SHA-256, root/component table/storage inventories and every ZIP member's CRC are required before it emits an operator endpoint. No Preview was deleted for this work.

No application RPC path/args/auth policy, HTTP/scheduler implementation, money policy or schema changed. The 74-table schema is exactly equal to production main, hash `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. Registration/source comparisons preserve 381 RPCs, 295 public functions, ten HTTP actions and 55 scheduler/cron callsites. No rendered product UI changed.

## Validation and review

| Check | Root result |
| --- | --- |
| `pnpm verify:integration` | 249 files / 2,991 tests; types, lint0, production build; 228 component checks; 73 actual-Clerk E2E checks |
| `pnpm test:dev` with Convex 1.50.0 | Passed existing-data preservation, real owner write/nonstaff denial, exact restart equality, seed refusal, lock exclusion, SIGINT/SIGHUP and occupied-port cleanup |
| Focused CLI/architecture/access | 77 passed; real installed CLI's loopback request asserts exact branch and `reuse: true` |
| Focused ownership | 4 passed; same assertions/deadlines with fewer AST parses |
| Knip | Passed |
| Actual schema / source contracts versus `ad07a13d…` | Equal schema; unchanged RPC/HTTP/scheduler contracts |
| Clean Phase 3 score | 30/30; no earlier-phase regression |
| Native Spec / Standards | No findings in the original implementation |
| Independent Claude audit | Completed on retry after a Cloudflare authentication failure; identified CLI env-file, pre-push provider and SIGHUP gaps, corrected before acceptance |

Root's first unconstrained run exposed resource-contention timeouts. Explicit bounded workers resolved the broad failures; a later unchanged ownership test still hit its five-second limit, so redundant AST parsing was removed. No assertion, test budget or coverage path was weakened. The corrected final integration run passed completely.

## Actual Preview acceptance

Authoritative Convex metadata proves Preview `careful-mammoth-88`, id **7085345**, belongs to project **1942094** and branch `t3/phase3f-local-dev-preview`, separate from production `wary-toad-189` and shared dev `optimistic-turtle-573`.

1. Vercel `dpl_J6NTfzPt6kxcf1ymtn6K5VMsUwPK` (`73665da`) rendered all three seeded villas. A unique real Clerk owner browser JWT created/read one unpaid test order; real nonstaff and anonymous clients were denied protected access.
2. Vercel `dpl_4rHqTVey2men1CRc7tN79dFazsv1` (`7d4346c`) retained the exact same backend id and complete order snapshot. Owner/nonstaff/anonymous checks passed again. Build logs confirmed `Preview initialization: preserved`, seed-before-Next ordering and no villa-read failures.
3. Vercel `dpl_5qJmQQHm2qwPhSaW4KPtQmnqCLTA` (`161541b`, test/docs-only follow-up) remained Ready on the same backend with preserved state.

This live sequence caught the old 1.34.1 CLI's unconditional replacement behavior before an acceptance write existed in the replaced deployment. The supported CLI upgrade and real request regression close that gap.

Root configured only Preview scope and test-tenant settings: the three nonsecret Vercel scope variables; separate Preview Clerk credentials and matching Preview issuer; and removal of AI_API_KEY, RESEND_API_KEY and CONVEX_SERVER_SECRET from defaults for newly created Previews. Development/production defaults were compared exactly and preserved. Production's existing sensitive Clerk row was restricted to Production without sending or reading its secret value. The single-variable decrypted public-key API proved the Preview tenant; the list API returns ciphertext and cannot establish it.

Actual Preview provider keys were absent throughout acceptance. The existing Vercel automation bypass was attached only to the exact Preview origin, never third-party Clerk requests. The temporary owner allowlist was restored and all three run-owned Clerk test users deleted. No business model, email, social, payment or refund request was sent. Authenticated state/logs stayed private; no authenticated traces/screenshots were uploaded. Retention deletion, shared-backend reset and provider-console changes were not performed.

## Production and next phase

Before merge, root captured a read-only production baseline: 391 registered contracts and all 74 application tables plus storage; protected operations reads, anonymous denials, unchanged Stripe cutoff and an unpaused backend. Production acceptance will compare that baseline after the Git deployment and verify the current alias plus 19 public routes across 11 locales.

Phase 4 remains: 52 no-login return-validator gaps, measured inbox read cost, incremental review totals, availability owner index and one canonical appointment audit write. It is implemented separately. See the [operations runbook](phase3f-operations.md) for current commands and rollout interfaces.
