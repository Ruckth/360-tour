# Phase 3d: direct Convex data flow and authenticated local acceptance

> Historical implementation evidence. Fixed-base move/proof commands below were retired in Phase 3e; retrieve them from parent `6a81d1715009bcb586f1dfd08f7b613b71334223` only to reproduce that history. Use [ARCHITECTURE.md](../../ARCHITECTURE.md) for current commands and ownership rules.


Required parent: `f0f52d1d8b4b761a0ee3fe8514c044c7dadd50f0` (PR80, `t3/phase3c-shared-rules`). Branch `t3/phase3d-direct-convex` starts directly at that commit in `/Users/macbook/.t3/worktrees/360-tour/t3-0ce11e3f-71e85bc023a0f754`; its history is retained. No subagents were used. Neither protected Development checkout was modified, stashed or reset. The original checkout supplied only the explicitly requested auth skill/reference and the three permitted Clerk test fields, read privately.

Scope is the plan's five rules, domain map, D2 and Phase 3d. Codebase-design's useful-interface principle removes the forwarding API layer; generated references now carry actual backend argument/result types to each caller. The existing Clerk integration, staff capabilities, domain ownership and shared policies remain authoritative. `.arch-phase` stays **2**. The broad guards/architecture recipe in 3e, development-loop redesign/Vitest projects/per-PR seeding in 3f, and Phase 4 remain deferred.

## Data ownership and coverage transfer

| Removed mechanism | Result and evidence |
| --- | --- |
| `src/lib/react/convex-api.ts`, `useConvexQuery` | Callers import generated `api` references and direct Convex hooks/client methods. `booking/backend-types.ts` contains only generated `FunctionReturnType` aliases, with no forwarding operations. Guest calls pass the existing per-conversation token explicitly. |
| Optional/null Convex provider and dummy client | One mandatory `ConvexProviderWithClerk` uses the existing Clerk `useAuth`. Root configuration and middleware fail clearly when required configuration is missing. Existing configuration aliases remain supported. |
| `dev:demo`, fake inventory/chat/payment success, bundled runtime villa fallback, demo disclaimer | Actual queries supply inventory, tours, reviews, conversations and bookings. Empty inventory remains empty. Missing booking credentials refuse access. Outages can retain previously fetched backend data, but cannot synthesize resort inventory or booking/payment success. |
| Checkout's 1,488-line in-memory business simulator | **117 lines**, eight canned JSON view states and a read-only design-state selector. Every write rejects with guidance to use signed-in local checkout. The existing development-only routes render the 404 boundary in a production build, including for an authenticated owner; Next streams the admin layout with HTTP 200, so acceptance checks the boundary and absence of checkout/design controls. No financial calculations, authorization model, DB writes or lifecycle transitions live in the design fixture. |
| Simulator-driven checkout interaction assertions | `tests/support/checkout-seed.ts` inserts actual schema rows into `convex-test`; `checkout-backend.ts` dispatches registered generated queries/mutations. It translates readable fixture aliases to real database IDs and controls transport failures, pending responses and source snapshot changes. It contains no alternative money/coupon/refund/approval/lifecycle implementation. **18 DOM suites / 125 checks** move directly to this backend integration; all **27 POS DOM suites / 225 checks** remain. |
| Browser checkout simulator | A Vite-only HTTP transport runs those same registered functions in Node. Existing keyboard, focus, small viewport, enlarged text, receipt, refund, role and race assertions remain. Approved-refund evidence reads the durable backend refund row instead of a spy on a simulated internal call. Synthetic component actors are explicitly separate from real JWT acceptance. |
| Demo E2E | Fresh seeded local Convex, real Clerk browser sign-in, persisted guest transcripts, actual booking creation and protected POS reads/writes. Dedicated real owner/cashier/nonstaff accounts prove access. Production preview routes are checked as unavailable. |

Adversarial validator tests retain their malformed payloads and assertions, with explicit generated argument types at the intentional runtime-validation boundary. The remaining `as never` casts, including the calendar vendor component and tests, are removed. Calendar callback assignments use their mapped generic type. Two backend comments that accidentally matched the scorecard's text pattern were reworded; no backend handler changes were needed.

The real backend exposed a browser-handoff race concealed by the null-client path: storing newly created guest credentials changed `ensureSession` identity and cancelled the in-flight effect before it could install the external-browser URL. The effect now reads the latest callback through a ref. Instagram/LINE browser-gate acceptance uses an actual token-bearing persisted guest conversation. The exact parent's fixed-time resort-calendar regression remains unchanged and passes.

## Local backend and real Clerk authentication

The implementation follows the current [Convex Clerk integration](https://docs.convex.dev/auth/clerk) and [Clerk Playwright documentation](https://clerk.com/docs/guides/development/testing/playwright/overview), and the installed Clerk testing/backend API declarations. The existing `@clerk/testing` dependency is reused; the lockfile and dependencies do not change.

`pnpm test:e2e` runs `scripts/local-integration.mjs`. `pnpm verify:integration` runs types, lint, the full unit/backend suite, a serialized production build, component browser coverage and the actual-backend E2E suite in one isolated lifecycle. `-- <command>` supports focused local verification without replacing the backend/auth path.

The runner:

- Allows only the three Clerk fields from an ignored local env file or explicit CI environment; inherited deployment/provider credentials are excluded and disabled service values are pinned empty so Next cannot restore them from dotenv.
- Requires `pk_test_` / `sk_test_`, matching publishable-key host and active OIDC issuer, and the existing `convex` JWT template with audience `convex`. It does not modify tenant configuration or production policies.
- Creates three uniquely named, run-owned test-only users with an ownership marker and run identifier. It never reuses shared users, so overlapping local/PR/main runs cannot sign each other out. No human owner, email, invitation, impersonation, admin-auth login or token/client mock is used.
- Starts anonymous Convex with unique local cloud/site ports in a fresh ignored project and isolated CLI HOME; application ports are also allocated locally. The existing seed rejects a nonempty database. Local admin credentials are confined to empty seeding and the dedicated cashier grant import, never browser auth evidence.
- Supplies only the local issuer/owner allowlist and test cashier grant to that fresh backend. No original Convex or external provider credentials are copied. The app builds against the actual seeded backend.
- Uses private ignored env/artifact files (0600), directories (0700), and a private umask. Authenticated screenshots, video and traces are disabled and never uploaded. Each child process group is stopped on completion/failure; run-owned test users are deleted with their sessions on completion. Partial provisioning is cleaned up, and unrelated users and sessions are untouched.

Browser sign-in uses `clerkSetup` and `clerk.signIn({ page, emailAddress })`, then the browser's actual Clerk session obtains its `convex` JWT. That token authorizes `ConvexHttpClient` calls against the isolated server; the application independently uses `ConvexProviderWithClerk`. No `setAdminAuth` acceptance client exists.

Auth acceptance verifies anonymous and signed-in nonstaff denial, owner access plus team controls, cashier checkout plus refusal of people/price-override access and absence of Settings, and owner UI add/quantity/cash-receipt persistence across reload. Cash recording is local only. Services retain their existing one-row-per-service quantity policy; the live quantity case uses room nights. Persisted transcript fixtures use a real signed-in staff account and the existing web-only reply commands. With external model calls disabled, unknown questions produce the real backend's staff handoff; tests start fresh conversations for independent automatic-reply cases instead of inventing follow-up answers after handoff. Date-language cases freeze their intended October clock rather than changing date expectations as real time advances.

Final review also restored the parent behavior for an unknown/retired villa URL: the initial selection comes from the actual backend list, and reactive removal of the selected villa highlights an existing backend villa. The selector exposes its pressed state; an actual-server E2E covers this case.

## Contracts and metrics

Actual `schema.export()` equality against the exact parent: **74 parent/current/static tables**, SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. Normalization sorts object keys and top-level table order only.

The unchanged independent contract checker, explicitly pointed at the exact parent and actual isolated-local function metadata, reports **381/381 identical registration initializers**, **55 identical scheduler/cron calls**, stable HTTP source, all **295 public RPCs**, and ten HTTP actions. No schema, registration, validator, job identity, payment, durable workflow or access policy changed. Historical fixed-base proof scripts and their assertions/budgets are untouched.

```sh
node scripts/schema-equivalence.mjs --base f0f52d1d8b4b761a0ee3fe8514c044c7dadd50f0 --out output/phase3d
node scripts/check-pos-closure-contracts.mjs --base f0f52d1d8b4b761a0ee3fe8514c044c7dadd50f0 --local-spec output/phase3d/local-function-spec.json
```

| Metric | Parent | Phase 3d |
| --- | ---: | ---: |
| Scored app `as never` occurrences | 24 | 0 |
| Optional/demo-mode files | 34 | 0 |
| CI placeholder-backend occurrences | 3 | 0 |
| Non-vendor source files over 1,000 lines | 1 | 0 |
| Checkout design fixture lines | 1,488 | 117 |
| Domain folders / cross-domain private leaks | 9 / 0 | 9 / 0 |
| Tables / public RPCs | 74 / 295 | 74 / 295 |

The scorecard and thresholds are unchanged. All actual `as never` type assertions are also absent from source, backend and tests, including the scorecard-excluded calendar code. Phase 3 is not declared complete: the architecture recipe remains absent, and Phase 4 still reports 52 no-login return-validator gaps and the absent read-budget gate.

## Verification

Node **22.22.3**, `VITEST_MAX_WORKERS=4`, serialized Next builds. Private logs and schema/CLI evidence are ignored under `output/phase3d/`.

| Check | Result |
| --- | --- |
| Full `pnpm verify:integration` on committed implementation `8e878683687936f703f4e3e2230e42cb2d251696` | App/test/backend types, lint, **242 files / 2,904 tests**, production build passed |
| `pnpm exec eslint . --max-warnings 0`; `pnpm knip` | Passed, zero warnings/findings/config hints |
| Full component browser suite | **228 passed**, 24 existing optional captures skipped; all five exact-parent fixed-time cases retained |
| Actual local Convex + real Clerk complete E2E | **73 passed** (72 acceptance cases plus Clerk setup), including actual JWT access controls, persisted guest data, owner cash receipt and retired-villa URL selection |
| Exact-parent schema / registrations / HTTP / scheduler / local metadata | Passed as detailed above |
| Both committed Phase 2 gate spellings | **19/19 passed** on clean commits; historical schema/archive and CLI proof suites **23/23 passed** |

During development, the runner's isolated HOME initially hid the installed Playwright browser cache. The runner now supplies the explicit platform browser cache while keeping the Convex CLI HOME isolated. Initial real-backend E2E also exposed stale demo response expectations and the handoff race described above; assertions now read persisted server replies and explicitly cover real staff handoff. No security, financial, fixed-clock or historical proof assertion was dropped to fix these failures. A later cleanup of an old env file interrupted one Vite fixture import (connection refused before rendering); the unchanged retry/idempotency case and full lifecycle pass with source/env files held stable.

The output boundary buffers complete lines and redacts both raw and encoded credentials, Clerk identifiers, JWTs, token parameters, guest/admin secrets, auth headers/cookies and emails. The new regression deliberately splits sensitive values across process chunks while asserting that HTTP/error evidence remains visible. SDK preflight/cleanup failures use the same redaction. Signal and normal cleanup share one finalization promise. An AST walk of **995 source/backend/test files** found **zero** `as never` assertions.

An initial diagnostic process listing included transient local-backend instance secrets; a later Clerk-testing teardown warning included a token-bearing dev-browser URL. The affected deployments were stopped and discarded, dedicated test sessions were revoked, and retained diagnostic logs were sanitized. No production credential or human account was involved. Authenticated Playwright traces remain disabled. All owned listeners and active dedicated test sessions were checked absent at handoff.

## CI and limitations

Verification triggers on **main pushes and PRs**, rather than both branch pushes and PRs. Concurrency cancels superseded runs. Fork PRs receive no secrets and fail the required secret preflight rather than reporting a skipped verification job as passing; there is no `pull_request_target` and no authenticated artifacts are uploaded. The workflow fails before integration when required secrets are absent. It uses no placeholder Convex URL or Clerk key: the runner supplies a fresh local backend URL and validates the real test tenant.

Root configured these repository secrets privately on 13 November 2026, using a dedicated Clerk **test** tenant with the existing `convex` JWT template (`aud: convex`) and browser sign-in enabled:

| Repository secret | Runtime field |
| --- | --- |
| `E2E_CLERK_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (`pk_test_`) |
| `E2E_CLERK_SECRET_KEY` | `CLERK_SECRET_KEY` (`sk_test_`) |
| `E2E_CLERK_JWT_ISSUER_DOMAIN` | `CLERK_JWT_ISSUER_DOMAIN`, matching active issuer |

No Convex deployment/admin key, production provider secret, human account, extra E2E email secret or stored browser session is required. The runner provisions its own dedicated identities. Candidate local test fields were validated privately and real browser login succeeded; there is no missing local credential prerequisite.

The implementation commits are `09f1c6880639e6c00debbe3c76930fabe8c22215` and `8e878683687936f703f4e3e2230e42cb2d251696`; the final evidence commit changes this record only. Root owns writing GitHub secrets, final exact-head CI validation, independent reviews, any Preview/live acceptance and merge. No remote CI success, shared/prod deployment or live pending-work/delivery inspection is claimed. No real external payment/refund, email, model or social send was performed. Local cash recording and registered-backend financial integration tests do not establish external-provider acceptance. No watches or external messages were created.


## Root review follow-up

Spec and Standards reviews independently identified cross-run Clerk teardown: the original three fixed users let one CI invocation revoke another invocation's sessions. Root replaced reuse with unique invocation-owned users (short enough to satisfy email limits), with cleanup of partial provisioning and deletion of only those users and sessions. The runner acquires identities inside its cleanup lifetime. An offline regression models overlapping runs, retains an unrelated human account, and proves cleanup isolation, idempotency and partial-failure cleanup.

Spec review also identified a lost recovery deadline when the forwarding wrappers were removed. Browser handoff now bounds optional session/token preparation at eight seconds and offers the tokenless external-browser link while disconnected. Direct typed Convex calls remain. Hook regressions cover both never-settling session creation and handoff creation, including late session completion without a stale handoff request.

The independent audit found that the hook could select six suggestions although markShown accepts five. Root retained the six-chip initial layout and candidate deduplication, and tracks impressions in valid batches of five and one. A hook-level regression uses all twelve candidates and actual registered Convex queries/mutations to prove all six impressions persist. Together the new and existing focused isolation tests pass eight checks. A test's initial render was corrected to await the actual backend impression commit before asserting the reactive result.

Other direct Convex mutations retain the client's normal disconnected queue behavior rather than the deleted forwarding layer's generic timeouts. The optional external-browser transfer has its own recovery deadline. Test-only cache/transport duplication is a nonblocking cleanup candidate; no financial rules are copied there. Root configured the three test-tenant repository secrets using stdin and private local configuration; no secret value was logged or committed. Root full integration, exact-head CI/Preview and production acceptance remain pending at this record update. The original diagnostic exposures involved discarded local credentials and revoked test sessions; production and human accounts were not involved.


The first independent root full integration passed 2,909 tests, types, lint, build and 228 component checks, then exposed three E2E expectations tied to unrecorded chips: the initial six-chip layout and repeated follow-up questions. The final implementation preserves the six-chip layout and tracks it in two bounded writes, rather than reducing the layout to five. English/Thai/German E2E now wait for all six actual backend impressions before checking that two fresh follow-ups appear and that no initial chip reappears. Named family recommendations, locale text, booking cards, persisted replies and initial six-chip accessibility assertions remain. The updated eight focused regression checks and lint pass; a full fresh-backend/Clerk repeat is running. This changes no backend visibility policy or five-item request bound.
