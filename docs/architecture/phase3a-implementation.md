# Phase 3a implementation evidence

Prepared checkout: `t3/phase3a-access-builders`, fast-forwarded from `3ca332d` to the required dependent local Phase 2 base `8489abec615c8f8febb19cf56e079f661b6f4196`. The original development checkout was never modified. Root owns the Phase 2 cutover/merge and independent review. This work implements only Phase 3a; `.arch-phase` remains **2**.

## Registration interface

`convex/auth/model.ts` uses the existing `convex-helpers@0.1.120` custom-function interface for queries, mutations and actions. Every public registration runs maintenance first, followed by its trust check, then its original handler. Internal query/mutation/action exports and worker/seed maintenance policies remain intact. Raw public builders are neither re-exported nor imported outside auth.

- `public*` requires an explicit nonempty registration reason. This includes public booking creation, booking record tokens, signed proposal links, handoff claims, display pairing/bootstrap and sign-out lease cleanup. Their existing capability, rate-limit and per-record checks remain in place.
- `guestQuery`/`guestMutation` resolve the session and check its hashed guest token and web channel in the same transaction. Existing optional legacy credential arguments still fail closed with `INVALID_GUEST_TOKEN`; no tokenless access is admitted. The returned `guestSession` replaces repeated checks in guest handlers. Internal social/worker entry points retain their original checks.
- `deviceQuery`/`deviceMutation` resolve hashed display tokens with the existing length limit. Invalid/revoked tokens expose no order and retain the existing unpaired/no-op response; pending/active behavior remains in the display handlers.
- `admin*` calls the authoritative `requireAdmin` operations policy, including managers. `staff*` takes an explicit capability and calls `requireStaff`; owner-only settings/team functions use `manageTeam`. Cashier business-date receipt visibility, customer projections, approvals, per-order ownership, revisions and pairing/driver/lease checks remain in handlers/helpers.
- `authenticated*` checks server-derived Clerk identity without demanding a staff grant. Invitation claims, self-owned user records and approval cancellation retain their narrower checks. Record history selects its existing entity-specific marketing/owner/operations policy. Bootstrap reads retain anonymous/null behavior with explicit reasons.
- Separate `marketingQuery`/`marketingMutation` preserve independent marketing grants and permissions without silently demanding a staff role. Draft restrictions, partner checks and privacy redaction remain intact.
- Actions never read the database directly. Staff/admin actions use the existing internal access query with caller identity; authenticated actions derive identity from `ctx.auth`. Tests prove anonymous/nonstaff rejection and action denial after grant revocation.

The [complete inventory](phase3a-access-inventory.md) lists all **295** public query/mutation/action registrations and every HTTP route, with rationale and additional record checks. Test-only probe registrations are injected into convex-test modules and are never deployed.

## Source measurements and scope

| Measurement | Required Phase 2 base | Phase 3a |
| --- | ---: | ---: |
| Maintenance-only raw-named public registrations outside auth | 294 | 0 |
| Explicit trust registrations | 1 | 295 |
| Total public query/mutation/action registrations | 295 | 295 |
| Root schema tables | 74 | 74 |
| Uses of the retired single `chat:global` key | 0 | 0 |
| Locked Convex version | 1.34.1 | 1.34.1 |
| Exact convex-helpers pin | 0.1.120 | 0.1.120 |

The raw-public source gate now parses TypeScript imports/registrations and catches aliased raw imports, generated-server namespace imports, raw generic builders and reexports. ESLint also rejects raw public-builder imports outside auth. Inventory tests require every registration to appear in the committed table and every public/staff/marketing registration to declare its policy. No earlier metric target was changed.

The no-login return-validator detector also includes explicit public mutations/actions. It honestly reports **52** remaining return-validator gaps for Phase 4, now that formerly raw-named endpoints are classified. Later Phase 3 domain moves, shared-rule extraction, schema splitting, demo removal, documentation restructuring and Phase 4 hot-path work are outside this patch. Money storage/calculation, 74-table schema, rate-limiter component, dependencies, lockfile and UI structure are unchanged.

## Validation

All commands use Node 22 via `PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Next production builds run serially. Final checks completed successfully:

| Check | Result |
| --- | --- |
| `pnpm verify` | App/test/Convex types, lint, 231 files / 2,847 tests and production Next build pass |
| `pnpm exec eslint . --max-warnings 0` | Pass, zero warnings |
| `pnpm knip` | Pass, including configuration hints |
| `pnpm test:booking-ui` | 223 passed; 24 existing opt-in captures skipped |
| `E2E_PORT=3037 pnpm test:e2e:smoke` | 13 passed, after its own serial production build |
| Focused auth/security suite | 156 passed in 9 files |
| `pnpm arch:score --phase 2` and `--phase2` | 19/19 gates on the committed tree |
| `pnpm arch:score --json` | `raw-public-functions = 0`; 74 root tables; future Phase 3/4 work remains visible |

The focused security run passes **156 tests in 9 files**: access builder probes, Phase 0 security, staff roles, displays, booking administration, payment capabilities, maintenance, inventory and architecture CLI tests. It includes foreign/missing/social guest credentials, foreign booking record tokens, signed-in nonstaff self access, independent marketing permissions, owner/manager/cashier policies, action grant revocation, cashier historical receipt/history restrictions, pairing and HTTP maintenance. Full-suite coverage retains signed proposal and durable-worker maintenance tests.

`pnpm test:booking-ui`: **223 passed, 24 existing opt-in captures skipped**. These are browser UI harness checks, not live Clerk/backend authentication.

No shared/production deploy, reset, data mutation, secret change or provider/email message was performed. No actual Clerk browser login or live identity-provider acceptance is claimed. Convex authorization tests use convex-test identities; smoke uses the existing explicitly disconnected demo configuration. No temporary backend, private credential or local seeded database was created. Root owns independent audit, live Clerk/backend acceptance and later phases.
