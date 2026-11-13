# Phase 3b: generic maintenance ownership closure

> Historical implementation evidence. Fixed-base move/proof commands below were retired in Phase 3e; retrieve them from parent `6a81d1715009bcb586f1dfd08f7b613b71334223` only to reproduce that history. Use [ARCHITECTURE.md](../../ARCHITECTURE.md) for current commands and ownership rules.


Exact parent: `2f438327b881132503d1231fb65b6c83e3584ceb`, Services photos [PR #78](https://github.com/Ruckth/360-tour/pull/78), branch `t3/complete-services-photo-ownership`. Branch `t3/complete-maintenance-ownership` starts directly at that commit in the prepared isolated checkout `/Users/macbook/.t3/worktrees/360-tour/t3-52b220e0-92ed465ee3babfd8`. Exact parent history is preserved. No subagents or changes to the original dirty development checkout or root architecture checkout.

The plan's five rules, nine-domain map and Phase 3 assign scenarios and evals to maintenance. This closes generic maintenance ownership after the [Services photo closure](phase3b-services-photos-implementation.md) and preserves the [twelve-helper POS model](phase3b-pos-closure-implementation.md) and Services private photos. It does not complete Phase 3.

## Eight internal path changes

| Former CLI/RPC name | Canonical CLI/RPC name | Builder |
| --- | --- | --- |
| `seed:seedAll` | `maintenance/seed:seedAll` | internalMutation |
| `aiEval:seed` | `maintenance/aiEval:seed` | internalMutation |
| `aiEval:cancelTestBookings` | `maintenance/aiEval:cancelTestBookings` | internalMutation |
| `aiEval:cleanup` | `maintenance/aiEval:cleanup` | internalMutation |
| `chatEval:createSession` | `maintenance/chatEval:createSession` | internalMutation |
| `chatEval:writeMessage` | `maintenance/chatEval:writeMessage` | internalMutation |
| `chatEval:comparisonTurn` | `maintenance/chatEval:comparisonTurn` | internalAction |
| `chatEval:messagingTurn` | `maintenance/chatEval:messagingTurn` | internalAction |

The actual registrations move from the three root modules into `convex/maintenance/`. Every validator, argument/return contract, handler, visibility and guard is preserved. Only relative dependency paths and the four `internal.maintenance.chatEval.writeMessage` references change. No forwarding module, compatibility endpoint, duplicate implementation, model export or general framework is added.

The six actual `seeds/*` implementations move to `maintenance/seeds/*`: `properties`, `rooms`, `reviews`, `tourSnippets`, `staffServices` and `aiEvalData`. Existing `maintenance/scenarios` remains the scenario owner. These deliberately isolated fixtures write several domains' tables, an explicit scenario/eval exception rather than an app-facing ownership bypass. Business helpers still enter through Catalog, Bookings, Services, POS, Messaging and Concierge `model.ts`, with the caller's ctx and transaction intact. No new domain-private import is introduced.

Scenarios retain all-table empty-database refusal, including `empty`; `demo-resort` remains the default. Eval cleanup retains literal `confirm: 'AI-EVAL'`, cancellation skips paid bookings, and eval message writes retain session/length/pause guards and separation from production admission/alerts. Comparison/messaging handlers retain model flags, tool/LLM traces and channel behavior. Accuracy eval retains `forcedModel`, `modelOverride: true`, `routingCoverage: false`, SATANG/BPS arithmetic and baht presentation. Existing assertions and explicit 30-second archive budgets are unchanged.

Actual test/eval/demo callers, package `seed`, generated API bindings and current `DEPLOYMENT.md` guidance use the canonical paths. Deployment instructions now state empty-database refusal instead of `already_seeded`, remove the nonexistent staff-upgrade advice, and map current `--preview-run` and future Phase 3f harness use. Historical plan/implementation/review/benchmark/demo reports and fixed-base move codemods remain evidence; they were not rewritten or run against this checkout as mutators.

## Contract and behavior evidence

The small read-only `scripts/check-maintenance-closure.mjs` compares all **699 production convex/src source files** to the exact parent, allowing only the nine module moves and specified import/reference/comment paths. It checks original registration declarations and generated-server bindings, every other source/dependency binding, package scripts/lockfile, generated API imports, generated server/data-model files and phase. It uses the existing access inspector rather than generating another migration framework.

Exactly **8 internal paths** move; the other **373 RPCs**, **295 explicit public / zero raw public functions**, full HTTP routing/ingress source and **55 scheduler/cron source calls** remain identical. Real installed Convex CLI metadata independently matches all **381 RPC identifiers**, the eight new internal registrations, and **10 HTTP actions**. Actual CLI calls to all eight retired paths fail with missing-function errors. No new seed, cleanup or model-turn CLI function was invoked.

The existing offline schema utility compares actual `schema.export()` values: **74 base/current/static tables**, equal SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. Only object keys and top-level table order normalize; all other array order matters. `.arch-phase` stays **2**.

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/check-maintenance-closure.mjs output/phase3b-maintenance/local-function-spec.json
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base 2f438327b881132503d1231fb65b6c83e3584ceb --out output/phase3b-maintenance
```

New convex-test coverage rejects all eight old modules, rolls back a complete scenario in the caller transaction, checks refusal with only a conversation present, exercises actual seed/cancel/cleanup helpers including paid-booking preservation and confirmation validation, and tests eval writer guards and model/trace arguments with a mocked pipeline. Existing scenario, money, security, domain and ownership tests retain their assertions.

Real Convex **1.34.1** initialized a new anonymous checkout-local backend at `http://127.0.0.1:3540` (HTTP 3541), `.convex/local/default/`. CLI processes used an empty inherited environment and a new ignored HOME under this checkout, with no copied credentials/shared configuration. Initial initialization stopped for the missing issuer; setting only `https://maintenance-local.invalid` on that local backend allowed component-aware generation, standalone codegen and function-spec capture. The local session was stopped afterward. All database fixture operations occurred in convex-test. No shared/dev/prod deploy/reset/seed/eval, secret access, real authentication/provider/model/email/social call, external message or Preview inspection/deletion occurred.

Node **22.22.3**, frozen dependencies; disconnected application environment. Validation:

| Check | Result |
| --- | --- |
| `pnpm verify` | Pass: all app/test/Convex types, lint, **240 files / 2,891 tests**, production Next build |
| `pnpm exec eslint . --max-warnings 0`; `pnpm knip` | Pass: zero warnings; no Knip findings/config hints |
| Focused seed/eval/security/domain/ownership suites | **18 files / 151 tests passed** |
| Existing booking UI suite, two workers | **223 passed**, 24 existing opt-in captures skipped; ignored config changes only server cwd/port to **4499** |
| `E2E_PORT=3095 pnpm test:e2e:smoke` | **13 passed**; separate production build serialized after verify |
| Source/binding, actual schema exports, real CLI codegen/spec and eight negative CLI calls | Pass, as above |
| Clean committed implementation `7d7a713` | Both Phase 2 gate spellings **19/19**; historical archive/gate suites **2 files / 23 tests passed** |

Final focused checks include the added eval admission assertion; final `pnpm check` rechecks all types. Validation logs and schema/CLI evidence are ignored under `output/phase3b-maintenance/`. The evidence-only documentation commit is followed by another clean-tree gate check; it changes no validated source.

## Operator retirement and remaining work

Public/frontend, HTTP and scheduler names stay stable, so this change introduces no global app traffic gate. **Operator-only CLI namespace retirement still needs root action:** identify and stop/drain actual seed/eval producers (including operator terminals, demo/accuracy/booking harnesses and external automation); inspect relevant stored/inflight jobs before removing old namespaces; preserve arguments, due times, attempts, tool/booking/payment identities and delivery uncertainty. Drain or reconcile an already-running old eval before deploying its renamed `writeMessage` target. Never replay an ambiguous eval/tool turn or destructive seed. Scheduler-source equality does not establish that an external operator never scheduled an old internal path.

No live queue count, empty-queue assertion or model/delivery acceptance is claimed. Root owns reviews, parent PR #77/#78 CI/merge acceptance, actual new Preview acceptance, production operations and merge. Supplied production baseline is healthy Services at `ce7b1c4`, with no gate or pause; this task neither inspected nor changed it.

After this move, production root TypeScript contains only `schema.ts`, `http.ts`, `crons.ts`, `auth.config.ts`, `convex.config.ts` and the type declaration `env.d.ts`; there are **zero root RPC registrations** (HTTP routing remains root plumbing). Auditing actual lib source finds no remaining domain database/storage ctx helper: `readBudget`, `readRangeWithinBudget` and `reserveWrites` in `lib/readBudget.ts` are generic per-ctx budgets. `lib/adminEmails.ts` and `lib/maintenance.ts` are backend environment/config leaves retained to avoid model cycles. Pure lib policies/types and frontend duplication are still debt, not proof of Phase 3 completion.

Next is **3c**: `orderMath` and `appointmentWindow` first, fixed UTC+7 shared time (including `todayIso`), frontend rule duplicate removal and the backend-to-src phone import. Then **3d–f** cover the real seeded local harness, demo/wrapper removal, lint/architecture recipe and dev loop; Phase **4** safety/performance work remains. Existing gates and later-phase metrics are not relaxed.


## Root review

Separate Spec and Standards reviews found no findings. The independent maintenance/eval audit found no correctness, security, money or operational blocker, with 63 focused tests, Convex types and lint passing. Root clarified the complete seed-refusal error template in the current deployment guide; historical reports remain dated evidence. No implementation or contract changes followed review.

Root independently passed full verify (**2,891 tests**, app/test/Convex types, lint and Next build), the 699-file source proof, actual schema export equality against merged main `5449e0ed8fc396a28cd7e64dbce3020ea05e4240`, Knip and 19 committed-tree gates. The reviewed-head Preview is READY on isolated `patient-cormorant-738`, excluding shared production/development; the final documentation commit still needs its exact-head CI and Preview checks. Parents #77 and #78 are now merged and accepted in production, including 28 protected-table/storage comparisons and all 19 public routes, with no active gate or pause. Operator-producer/job inspection must be refreshed at this PR's actual namespace retirement; source equality and the earlier read-only preflight do not establish absence of other operators or in-flight direct actions. No seed, cleanup or eval is required for live acceptance.
