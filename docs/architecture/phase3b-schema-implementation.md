# Phase 3b: isolated schema split

Base: merged main `f2482a0237e28a82c71b0557ea9422f61233845a` (Phase 3a PR #64). The prepared `t3/split-convex-schema` checkout was clean and fast-forwarded to that exact base. No other checkout was modified. This PR implements only the first schema step of Phase 3b. `.arch-phase` remains **2**; catalog function moves are next, followed by the remaining domain moves and Phases 3c–f/4. Root owns review, merge and deployment.

## Ownership and unchanged contracts

`convex/schema.ts` is now a 23-line `defineSchema` assembly. Each table definition and its semantic comments moved to its owning domain's `tables.ts`, following the plan's full table disposition:

| Domain | Tables |
| --- | ---: |
| auth | 2 |
| catalog | 6 |
| bookings | 8 |
| services | 14 |
| pos | 16 |
| concierge | 2 |
| messaging | 8 |
| marketing | 14 |
| settings | 4 |
| Total | **74** |

No endpoint, command, API path, table name, document ID, field, optionality, validator, index or search index changed. Integer satang/basis points and the rate-limiter component remain intact. All 142 original schema comments were preserved. Existing leaf validator imports remain in place, with adjusted relative paths; no validator move or new facade was needed. Domain `model.ts` seams belong to the later command/helper moves; nine folders with tables do not mean those moves are complete. The 295-function access inventory and the Phase 4 return-validator detector are unchanged. No generated file, dependency pin or lockfile changed: installed Convex is **1.34.1**, convex-helpers **0.1.120**.

## Honest schema inspection and rollback artifacts

The repository-wide schema-reader audit found three static consumers: `scripts/arch-scorecard.mjs`, `scripts/architecture-reset.mjs`, and `scripts/architecture-maintenance.mjs`. They now share `scripts/lib/convex-schema.mjs`, which follows the actual default `defineSchema` assembly through repository import bindings, object aliases and spreads, recording each table's definition source. It accepts the historical monoliths as well as composition, rejects duplicate names/circular spreads/missing imports/unsupported forms, and never counts an unassembled `defineTable`, a component schema or node_modules table. Unsupported assembly syntax fails explicitly and must be taught to the inspector before adoption.

The scorecard's 74 target is unchanged. `domain-folders` now requires actual assembled table ownership, so empty folders cannot satisfy it. Reset preparation checks the new count is exactly 74, builds real 91-table historical and 74-table rollback ZIP manifests, and snapshots the complete reachable runtime schema-source graph with per-file hashes. Maintenance preparation checks that graph against the selected git revision before writing its existing maintenance files. The runbook explains why a top-level schema copy alone is insufficient.

Seed scenarios (`convex/maintenance/scenarios.ts`), test harnesses and the generated data model already import the runtime schema; no static filename assumption needed changing there. Access inventory helpers do not inspect schema definitions and remain unchanged. CI now fetches history so the offline historical-source regression tests can inspect the reviewed commits on both pushes and pull requests.

The 15 new tooling regressions cover reachable versus unused/component definitions, named/default aliases and spreads, duplicate overwrites, unsupported/dynamic/fake-builder forms, missing imports, cycles, historical 91/74-table schemas, static/runtime table-name agreement, complete empty ZIP contents/source snapshots/hashes, and maintenance source preservation/tamper rejection. The `HEAD` maintenance cases exercise composition on the committed tree.

## Exported-schema equivalence

Reproduce offline with Node 22:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/schema-equivalence.mjs --base f2482a0237e28a82c71b0557ea9422f61233845a
```

The script materializes only the exact base's schema dependency sources under ignored `output/phase3b-schema/`, then imports both schemas and compares their actual Convex `SchemaDefinition.export()` JSON. It normalizes object-key order and top-level table order only. Compound index field order, validator union order and every other array remain untouched. It compares all 74 tables' complete document validators, database/search/vector indexes (including staged definitions) and schema-validation settings, and cross-checks static discovery against the runtime export.

Result: **equal**, base/current/static table counts **74/74/74**. Both normalized exports have SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6` (compact canonical JSON). `base-schema.json`, `current-schema.json`, `schema-equivalence.json`, baseline/final scorecard JSON, comment-preservation evidence and validation logs are ignored local evidence, not a committed duplicate schema fixture. No backend was needed or contacted for equivalence.

## Baseline and final measurements

The baseline scorecard was captured on exact `f2482a0` before edits. The Phase 3a implementation record supplies the preceding full-check baseline: 2,847 tests, 223 browser checks, 13 smoke checks and 19 source gates.

| Metric | Base | Final |
| --- | ---: | ---: |
| Root tables | 74 | 74 |
| Domain folders | 3 | 9 |
| Raw public functions | 0 | 0 |
| Cross-domain imports bypassing model.ts | 2 | 2 |
| as never | 24 | 24 |
| src imports convex/lib | 76 | 76 |
| convex imports src | 1 | 1 |
| Demo-mode files | 34 | 34 |
| CI placeholder backend references | 3 | 3 |
| Architecture recipe document | 0 | 0 |
| Non-schema source files over 1,000 lines | 3 | 3 |
| No-login functions without returns | 52 | 52 |
| Phase 4 read-budget test | 0 | 0 |

The old domain metric counted folder existence (three existing domains); under the stricter ownership measurement, that monolithic base has zero domain-owned table sources. Final nine means nine real table owners. Every other source value remains unchanged. Phase 0–2 gate values remain: secret-fails-open 0; phase0-tests 5; static-dir 0; ignored-scratch 0; test-harness 1; tables 74; channel-events-table 1; retired-tables 0; old-table-names 0; legacy-files 0; migrations 0; phase1-tests 4; reexport-pages 0; channel-routes 0; server-secret-uses 0; as-never-webhooks 0; phase2-tests 6; global-rate-row 0. Clean-tree returns to zero after commit.

## Validation and limits

All commands use `PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Next production builds are serial. Completed checks:

| Check | Result |
| --- | --- |
| `pnpm verify` | App/test/Convex types, lint, **232 files / 2,862 tests**, and production Next build pass |
| `pnpm exec eslint . --max-warnings 0` | Pass, zero warnings |
| `pnpm knip` | Pass, including configuration hints |
| `pnpm test:booking-ui` | **223 passed**, 24 existing opt-in captures skipped |
| `E2E_PORT=3037 pnpm test:e2e:smoke` | **13 passed**, after its separate serial production build |
| Focused schema/reset/seed/architecture/security/messaging suites | **72 passed in 9 files**, including 15 new tooling regressions |
| `node scripts/schema-equivalence.mjs --base f2482a0237e28a82c71b0557ea9422f61233845a` | Exact Convex export equality, 74/74/74 tables |
| `pnpm arch:score --phase 2` and `--phase2` | **19/19 gates**, clean committed tree |
| Committed-HEAD focused recheck | **72 passed in 9 files**, including composed-source preservation/tamper cases |
| Offline reset artifact generation at `72a657f` | 91 historical / 74 current tables, complete source snapshots and empty ZIPs |

The focused command selects `tests/unit/convex-schema-tools.test.ts`, `tests/unit/arch-scorecard-cli.test.ts`, `tests/unit/convex-access-inventory.test.ts`, `convex/phase1Architecture.test.ts`, `convex/moneyCutover.test.ts`, `convex/phase0Security.test.ts`, `convex/maintenanceGate.test.ts`, `convex/messaging/ingress.test.ts`, and `convex/messaging/reliability.test.ts`. Git/ZIP integration tests have explicit 30-second timeouts to allow concurrent CI load without relaxing their assertions. The committed-tree Phase 2 gate and composition-at-HEAD cases both passed again before handback.

No shared or production backend deployment, reset, reseed, data mutation, secret change, provider configuration change, or social/email send was performed. No isolated backend was needed. No real Clerk login or live social card send is claimed; browser checks use the existing fixtures and disconnected demo configuration. Root's separately reported live Phase 2 status is in [phase2-production-cutover.md](phase2-production-cutover.md).
