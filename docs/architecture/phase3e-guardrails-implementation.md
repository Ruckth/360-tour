# Phase 3e: current-source guardrails and the feature recipe

Required and actual parent: `6a81d1715009bcb586f1dfd08f7b613b71334223`, PR81, branch `t3/phase3d-direct-convex`. The supplied isolated checkout was stale at `3ca332d`; `t3/phase3e-architecture-guardrails` was created **directly at the required parent**, preserving its complete history. Work stays in `/Users/macbook/.t3/worktrees/360-tour/t3-2a668883-6775949811293c77`. No subagents, other checkouts, shared/prod deployment, reset, eval, provider send or Preview operation were used. Root retains parent acceptance and this PR's independent review/CI/Preview/live acceptance.

Scope is the plan's five rules, domain map, D2, 3e and exit requirements, applying the codebase-design skill. The implementation strengthens useful existing interfaces rather than adding an architecture framework. **No Convex runtime implementation, schema, generated file, financial policy, pinned dependency, lockfile or Node version changes.** `.arch-phase` remains **2**. Static Phase 3 source targets alone do not prove 3f.

## Current ownership rather than historical source equality

`no-restricted-imports` gives direct feedback for raw public builders and browser backend imports. A small TypeScript source inspector supplements it for relative/alias paths, reexports, namespace/star forms, type imports, dynamic imports/require and registration ownership. ESLint and the scorecard consume the same current-source rules. Adversarial fixtures exercise `.ts`, `.tsx`, `.js` and `.mjs` deployed sources; unsupported computed module paths, builder aliases, namespace builder modules, indirect registrations and invalid syntax produce errors instead of counting zero. The existing fixed-path locale JSON loader is a narrow explicit exception.

- Raw public builders are permitted only in **`convex/auth/model.ts`**, not other auth files or an alternative `.js` model. Renamed raw/generic imports and namespace/reexport forms cannot bypass that rule. Existing named internal-builder reexports and maintenance-aware HTTP wrapping remain valid.
- Domain registrations live in domain endpoint files. They cannot migrate into root/lib, model/tables or private implementation files. Root assembles schema, HTTP, crons and configuration; the three existing backend lib leaves remain invocation accounting and environment configuration. New business ctx implementations have a domain owner.
- Cross-domain imports, including type imports and reexports, use `model.ts`. Schema's table assembly and HTTP's messaging-ingress factory are the existing narrow assembly exceptions. Maintenance remains operator infrastructure outside the nine business domains.
- Shared stays pure: shared rules, `convex/values`, the existing pure phone parser and type-only generated data-model imports. Server context, environment, network/runtime globals, builders, backend lib, browser code and unreviewed packages are rejected. Strings/comments do not count as execution. Renamed/destructured/indirect global forms are covered by adversarial examples.
- Browser imports preserve legitimate shared types/rules, generated API/data types and Convex client SDK types. Browser backend model/private/lib/endpoint imports are rejected, including type-only imports. Backend imports of browser code and production imports of test infrastructure are rejected.
- Tests deliberately may cross private interfaces. The emitted backend graph is checked for cycles, ambiguous deployed module names and endpoint reexports through model interfaces. Plain helpers can share a file with a registration: concierge's existing `runTurnHandler` stays valid. Named and aliased imported endpoint reexports are rejected without banning that helper.

No public endpoint total or exact business implementation is frozen. The access inventory still requires every current public registration and its explicit reason/capability/permission, but the old permanent `295` assertion is removed. Its current **295** rows remain unchanged; real features can extend the inventory.

## Type-aware promises and standard commands

Inspected installed Next **16.2.6** configuration: its existing TypeScript parser and plugin are both **8.59.3**. It already registers the plugin, so **no new dependency** is needed. The explicit `tsconfig.eslint.json` includes application, backend, tests, scripts and configuration, retaining the existing vendor/generated/output exclusions. All configured source extensions receive `@typescript-eslint/no-floating-promises: error`; no broad disables or `no-misused-promises` addition.

The setup follows current primary documentation: [typed linting](https://typescript-eslint.io/getting-started/typed-linting/), [parser project settings](https://typescript-eslint.io/packages/parser/#project) and [no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/). The docs emphasize that `void` records intent and does not handle failure.

Initial typed lint found **seven** issues. Five effect calls already own cancellation and catch their actual query/configuration failures at the UI operation. They now explicitly `void` those calls with a local explanation; their existing failure handling is retained. Two coupon test setup writes now await the actual backend snapshot update before payment. There are no new catch-away failures, blanket void sweep, global promise exemptions or production handler changes. ESLint integration tests demonstrate real promise type information in app/backend/test contexts and actual ownership rule wiring.

`pnpm lint` now includes `--max-warnings 0`, so `pnpm verify`, local integration and CI use the same requirement. Existing CI's explicit zero-warning lint is retained. `ARCHITECTURE.md` documents all nine owners, shared/pricing/ctx distinctions, access builders, direct Convex flow and a worked property-note table/endpoint/admin-page recipe. `AGENTS.md` links it; the PR template includes validation, screenshots, protected-auth evidence and honest limitations. README and DEPLOYMENT remove stale demo/placeholder/setup-state instructions and distinguish current local integration from future 3f work.

## Retired tools and preserved evidence

Consumer tracing covered scripts, package commands, test imports/spawn calls, Knip entry patterns, workflows, README/DEPLOYMENT and architecture records. The one-shot tools had no active package/test/workflow consumers; Knip's generic `scripts/**` entry only treated them as roots. Their remaining names were historical record commands and cross-references among the generators themselves. Concise record banners now identify them as historical and link current instructions. Existing detailed records and the POS ownership JSON remain as evidence, not active command requirements.

Deleted (recoverable from the exact parent above):

| Group | Removed files under `scripts/` |
| --- | --- |
| Domain moves | `move-auth-domain.mjs`, `move-catalog-domain.mjs`, `move-bookings-domain.mjs`, `move-services-domain.mjs`, `move-pos-domain.mjs`, `move-concierge-domain.mjs`, `move-settings-domain.mjs`, `move-messaging-domain.mjs`, `move-marketing-domain.mjs` |
| Closure moves | `move-bookings-closure.mjs`, `move-services-closure.mjs`, `move-pos-closure.mjs` |
| Fixed-base proofs | `check-pos-closure-contracts.mjs`, `check-services-photos-closure.mjs`, `check-maintenance-closure.mjs` |
| One-time ownership snapshot generator | `audit-pos-registration-owners.mjs` |

The old shared ownership tests' fixed-base declaration equality, exact model export equality and permanent twelve-POS-helper count are retired. Their useful current ownership and emitted-graph checks move into the adversarial architecture suite; the actual fixed-time resort rule assertion remains. POS/services current ownership tests and shared money/date/quote/policy tests remain active.

**Before deletion**, the old independent checker verified **381** exact-parent registration initializers and builder bindings, complete HTTP/ingress source and **55** scheduler/cron calls. Its private report SHA-256 is `c19441e0f16b9c9be7f4ae1757963ee5f7103b8b740775035353c565bc43698f`. Current verification uses `check-function-contracts.mjs --base <reviewed-parent>`: no historical default, timestamp normalizer or fixed endpoint/scheduler quota. It fails unsupported registration forms, normalizes module identity for supported source extensions and can compare actual local CLI metadata. It is an optional equivalence check for a specific refactor, not a restriction on new features.

The active offline schema inspector, `schema-equivalence.mjs`, `architecture-reset.mjs`, `architecture-maintenance.mjs` and reset template remain. Schema equivalence requires an explicit base, compares actual exports and their static assembly, and no longer hardcodes a universal 74-table quota. Historical 91/74 schema restoration, complete reset/rollback ZIP assertions, modified/missing source refusal and **explicit 30-second archive budgets are untouched**. No security, money, archive or maintenance-gate assertion is weakened.

## Before / after and verification

Node **22.22.3**, `PATH=/opt/homebrew/opt/node@22/bin:$PATH`, `VITEST_MAX_WORKERS=4`; Next builds serialized. The only permitted external credential read was the three dedicated Clerk test fields from root's ignored architecture checkout file, privately copied into this checkout's ignored mode-600 `.env.e2e.local`. No dirty-user environment was read. Local integration provisions unique run-owned Clerk users and deletes them; actual auth targets only its fresh local Convex and outbound business providers remain disabled. Authenticated state, screenshots/traces, local credentials and logs stay ignored/private.

| Check/metric | Before | After |
| --- | --- | --- |
| Raw public builders / browser backend imports / backend→src / cross-domain private imports | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0, measured with stronger source rules |
| Business domains | 9 | 9 |
| Architecture recipe | 0 | 1 |
| New source ownership/purity violations | Not measured | 0 |
| `as never`, demo-mode, CI placeholder and >1,000-line files | 0 each | 0 each |
| `.arch-phase` | 2 | 2 |
| Whole unit/backend suite | 245 files / 2,909 tests (parent evidence) | 247 files / 2,954 tests passed; 47 new guard checks replace two obsolete historical checks |
| Typechecks / zero-warning lint / Knip | Parent passed | Passed |
| Isolated production Next build | Parent passed | Passed |
| Adversarial guards + actual ESLint wiring + CLI-gate checks | — | 50 checks passed within original budgets |
| Schema/rollback/historical archive suite | Active | 20 checks passed with existing 30-second budgets |
| Actual schema exports | 74 tables | Same 74 tables; equal SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6` |
| Registration/HTTP/scheduler comparison | 381 / complete source / 55 | Equal to required parent |

`pnpm verify:integration -- node output/phase3e/acceptance.mjs` passed end to end: full verification above, **228 functional component/browser checks** (same 24 opt-in skips), **73 actual-backend E2E checks**, local function-spec comparison and run-owned user/process cleanup. It uses actual Clerk owner/cashier/nonstaff sessions; no admin-impersonation substitute is used for acceptance. The private one-run acceptance command captures CLI metadata during the same local backend lifetime before running the ordinary Playwright suite. Actual metadata confirms **381 RPCs, 295 public RPCs and 10 HTTP actions**. No authenticated traces were uploaded.

Clean committed gate results are added after the implementation commit.

The first full run passed 2,952 checks and hit two existing five-second CLI test timeouts because the new scanner unnecessarily transpiled every source to check syntax. The scanner now uses parser diagnostics directly; focused CLI/adversarial checks and the full 2,954-test repeat pass without relaxing a budget. An initial command also supplied an extra `--`; it failed earlier at the test timeouts and never attempted that malformed custom command. The corrected integration invocation uses one separator. These are validation/tooling corrections, not runtime policy changes.

## Remaining limits

No Phase 3f dev-command redesign, Vitest projects, per-PR seeded Preview deployment or retention was implemented. No Phase 4 return-validator sweep, read-budget/performance or audit-writer work was implemented. Full static Phase 3 source checks do not establish all Phase 3 exits, so the ratchet stays 2. Root owns parent PR81 CI/merge/live acceptance, this draft's independent review and new Preview isolation/compatibility, and any deployment/provider/live financial acceptance. Local real-Clerk tests do not establish live social/model/email/payment/refund delivery.
