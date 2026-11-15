# Phase 3b: catalog backend domain

> Historical implementation evidence. Fixed-base move/proof commands below were retired in Phase 3e; retrieve them from parent `6a81d1715009bcb586f1dfd08f7b613b71334223` only to reproduce that history. Use [ARCHITECTURE.md](../../ARCHITECTURE.md) for current commands and ownership rules.


Required dependent base: `localarch/phase3b-schema-review` at `b2eaae524f77efffd354120cd3791d189b2ff56f` (PR #65, schema split and revision-specific maintenance fixes). The prepared `t3/catalog-backend-domain` checkout was clean and fast-forwarded to that commit. Its unpublished history is preserved. The original development checkout and other checkouts were not modified. This step moves only catalog; `.arch-phase` stays **2**. Root owns independent review, merges, shared/production deployments and cutover.

## RPC mapping

Every function name, visibility, builder, policy, argument validator, handler and return shape is preserved. The serialized module path gains `catalog/`; JavaScript references gain `.catalog`. The 35 registrations comprise 12 anonymous queries and 23 admin queries/mutations. There are no moved internal registrations.

| Old module | New module | Unchanged function names |
| --- | --- | --- |
| `properties` | `catalog/properties` | `list`, `getBySlug`, `getById`, `getRooms`, `getTourRooms`, `getOtaComparison`, `listOtaRates`, `upsertOtaRate`, `removeOtaRate`, `getSocialProof`, `getReviews`, `getTourSnippets`, `adminList`, `adminGet`, `update`, `updateRoom` |
| `publicProperties` | `catalog/publicProperties` | `list`, `getBySlug`, `featuredReviews` |
| `adminProperties` | `catalog/adminProperties` | `get`, `create`, `duplicate`, `setSlug`, `setStatus`, `deleteDraft`, `generateUploadUrl`, `saveUploadedImage`, `createRoom`, `deleteRoom`, `reorderRooms`, `setHotspots` |
| `adminReviews` | `catalog/adminReviews` | `list`, `create`, `update`, `remove` |

For example, serialized `properties:getOtaComparison` becomes `catalog/properties:getOtaComparison`, and `api.publicProperties.list` becomes `api.catalog.publicProperties.list`. Old endpoint files are deleted. No compatibility endpoints, aliases, proxy wrappers or generic CRUD framework are introduced. The guest public-property projection intentionally remains different from the public-site villa/review projection; their existing field lists, null/default handling and privacy behavior are preserved.

`scripts/move-catalog-domain.mjs` is the single explicit reference codemod. It moves modules, resolves relative ESM imports (including `.js` extensions and explicit module-map keys), updates dot/bracket `api`/`internal` references and serialized CLI/getFunctionName names across tracked source, tests and scripts, and rewrites the current 295-function access inventory. Historical benchmark transcripts retain their original observed paths. Existing convex-test glob maps already discover nested catalog modules; no test loader or backend stub was substituted.

Run the post-move check with Node 22:

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH node scripts/move-catalog-domain.mjs --check
```

It rejects old runtime references and old endpoint files, compares all 35 registered implementations against the required base (normalizing only the projection helper's rename), and checks the lifted validation functions and complete image URL policy against the original source. The source inventory still enumerates exactly **295** explicit public trust registrations and checks every policy. No new casts are added.

## Helper seams

- `catalog/model.ts` is the sole catalog helper interface for other backend domains. It owns the unchanged `recomputeSocialProof(ctx, propertyId)` implementation formerly in `lib/reviewStats.ts`; the maintenance seed scenario now imports it here. It also owns the explicit active-property projection, renamed from `toPublic` to `toPublicProperty`, and its `PublicProperty` type. No endpoint is re-exported.
- `shared/validation.ts` holds the existing pure `required`, `amount` and `imageUrl` functions unchanged. Catalog endpoint modules import them directly. They preserve the exact validation errors, safe-integer tests and image policy.
- `shared/imageUrls.ts` is the unchanged image-host policy formerly in `lib/imageUrls.ts`. Its existing messaging/card and public-service readers import the pure shared rule directly; `next.config.ts` points its synchronization comment here. `shared` has no context parameters, generated-server imports or backend calls.
- Endpoint-local editing/projection helpers remain private implementation details. Configuration/record-history writers, slug/upload validation and the other domains' existing helpers remain in place. This PR does not move bookings, services, POS, concierge or settings commands.

The catalog table owner still defines exactly properties, tourScenes, tourSnippets, reviews, reviewStats and otaRates. No table definition, schema assembly, validator/index, money unit, dependency pin, rate-limiter component or maintenance tool was changed. Admin access continues to use the existing owner/manager policy. Draft/archive parent checks, iCal-token privacy, OTA rate editing, integer SATANG/BPS, review statistics, upload rejection cleanup, deletion blockers and configuration history remain intact.

## Schema and measurements

`node scripts/schema-equivalence.mjs --base b2eaae524f77efffd354120cd3791d189b2ff56f` compares actual Convex exports, not source spelling. Result: **equal**, 74/74/74 base/current/static tables, SHA-256 `c684d5d73ba0329cd5a230ff6ce63d05b10aaee7196350e6c3b0cbda397a3ff6`. The composed/historical schema tools and the parent's revision-specific maintenance access seam, old raw-builder fallback and spaced-path handling remain unchanged and are covered by the tooling suites.

| Metric | Required base | Catalog |
| --- | ---: | ---: |
| Tables / real domain owners | 74 / 9 | 74 / 9 |
| Explicit public registrations / raw public registrations | 295 / 0 | 295 / 0 |
| Cross-domain imports bypassing model.ts | 2 | 2 |
| `src` imports of `convex/lib` | 76 | 75 |
| `convex` imports of `src` | 1 | 1 |
| `as never` | 24 | 24 |
| Demo-mode files / CI placeholder references | 34 / 3 | 34 / 3 |
| Architecture recipe document / files over 1,000 lines | 0 / 3 | 0 / 3 |
| No-login return-validator gaps / Phase 4 read-budget test | 52 / 0 | 52 / 0 |

The remaining two cross-domain violations are the existing messaging imports of concierge copy; catalog adds none. The 52 Phase 4 gaps remain visible. No detector or metric target is relaxed. All Phase 0–2 values remain at the reviewed base. The clean-tree check is run again after committing.

## Validation and limits

All commands use `PATH=/opt/homebrew/opt/node@22/bin:$PATH`. Next production builds run serially. Detailed logs, exported schema comparison and local acceptance evidence are under ignored `output/phase3b-catalog/`.

| Check | Result |
| --- | --- |
| `pnpm verify` | App/test/Convex types, lint, **232 files / 2,865 tests**, production Next build pass |
| `pnpm exec eslint . --max-warnings 0` | Pass, zero warnings |
| `pnpm knip` | Pass, including configuration hints |
| `pnpm test:booking-ui` | **223 passed**, 24 existing opt-in captures skipped |
| `E2E_PORT=3037 pnpm test:e2e:smoke` | **13 passed**, after a separate serial production build |
| Focused catalog/projections/OTA/security/inbox/cards/worker/tooling suites | **165 passed in 14 files** |
| Codemod `--check` | No old runtime paths/files; all **35** registrations and lifted validation/image policy match base |
| Exported-schema comparison vs `b2eaae5` | Exact equality, 74 tables and unchanged export hash |
| Actual isolated local HTTP acceptance | Three villas, public projections/tours/reviews/OTA, anonymous admin denial and existing booking capability read pass |
| `pnpm arch:score --phase 2` / `--phase2` | **19/19 gates**, clean committed tree |

Real CLI component-aware API/type generation uses installed Convex **1.34.1** and convex-helpers **0.1.120**. An isolated anonymous backend was created in this checkout only, with its target checked as `anonymous:anonymous-agent`, cloud URL `http://127.0.0.1:3210`, and project-local state under `.convex/local/default/`. It has a nonfunctional local JWT issuer (`https://catalog-local.invalid`) solely to satisfy auth-config analysis. No production credential was copied. The local database was seeded once with the existing `demo-resort` scenario. Actual HTTP queries exercised all three villas, public listing/detail/featured reviews, tour ordering and OTA comparisons, verified private fields are absent, rejected an anonymous admin query, and read an existing booking with its capability token. The seed was not a reset or backfill.

An initial overlapping dev/codegen push hit an OCC error; a subsequent serial codegen completed. The focused property test caught the codemod's initial misclassification of the literal image suffix as a relative path; the resolver now requires `./` or `../`, and the full moved image policy is checked byte for byte. No application behavior was deliberately changed to pass validation.

No real Clerk sign-in, real social/email send, provider callback acceptance, shared-backend data mutation, reset, deployment, secret change or live operational cutover is claimed. Worker/booking reliability tests use the existing Convex transactional harness and external-channel test adapters; browser fixtures remain the existing harness, and smoke remains the existing disconnected demo configuration. Local HTTP acceptance uses the real isolated backend and generated source paths. Root still needs live Clerk/backend acceptance during its controlled cutover.

## Required root-controlled deployment order

This rename is an incompatible RPC-path change. Old clients cannot call the removed modules after deployment, and a new frontend cannot read the old backend's catalog modules. No rolling compatibility window is provided.

0. **Do not merge before the gated backend cutover.** The Vercel Git integration automatically starts the production build when `main` changes. Keep the PR open while completing the traffic gate, drain, backup, backend push and backend acceptance below; merge only inside that gated window after the renamed backend reads work. The merge-triggered build can then produce the new frontend against the accepted backend. If merging earlier is unavoidable, disable production Git deployment first and restore it only after backend acceptance. Confirm the preview build targets a dedicated preview deployment before pushing this incompatible change; a shared development or production deploy key is unsuitable for Preview.
1. Root completes PR #65, merges `origin/main` into this dependent branch without discarding unpublished commits, reviews the final diff and reruns required gates. Until PR #65 lands, the PR targets `t3/split-convex-schema`; afterward it targets `main`.
2. Root gates traffic and coordinates maintenance, backups, ingress, callbacks and jobs under the existing production runbooks. Drain old frontend requests; stale browser sessions need a reload onto the coordinated frontend release. Inspect scheduled-function state for any references to the four removed modules, including externally submitted jobs. Drain/cancel such jobs before removing their functions rather than relying on nonexistent wrappers.
3. Root pushes and **accepts the new backend first**, with the unchanged schema/data. Clear the backend maintenance pause when appropriate while public traffic remains gated. Verify the renamed anonymous catalog queries return the expected active villas, tours, reviews and OTA prices. A backend still paused can also make frontend data loaders fall back to empty results.
4. Only after that backend is accepted and its catalog reads work, build and publish a fresh frontend against it. The existing `vercel-build` runs `pnpm build` **before** its final Convex push; it cannot perform this rename cutover on its own. Building first risks prerendering and caching an empty home page or sitemap. Rebuild/invalidate any artifacts made against the old or paused backend, and verify home/villa/sitemap output before restoring traffic.
5. Root checks worker/callback and booking/payment behavior, restores traffic and jobs, and records actual operations separately. A rollback must coordinate frontend/backend RPC paths in the same gated order; no data reset is needed for this code-only move.

Scheduler compatibility: none of the 35 moved catalog functions is a source cron or `ctx.scheduler` target, and no moved function schedules work. Existing messaging worker/concierge, booking/payment and maintenance scheduler identifiers and argument shapes are unchanged. Their source callers now resolve the new catalog paths (concierge context and the OTA comparison tool). Existing scheduled worker jobs therefore run the updated implementations after backend acceptance; they do not need a catalog argument migration. Stored or external references to removed catalog RPC names are still incompatible and require the root's explicit audit above. No scheduler, callback or deploy operation described here was performed on shared development or production.

## Parent review

The parent merged the completed schema PR into this branch at `58a6370` and retargeted PR #66 to `main`. Standards and spec reviews found no issues. The independent audit confirmed the 35 contracts and identified the automatic Git deployment hazard; step 0 now makes the merge timing explicit. Parent `pnpm verify` passed all 2,865 tests, types, lint and the production build. A read-only production scheduler inventory found four completed jobs, no unfinished jobs and no catalog targets. Production catalog cutover is still pending; these checks do not claim a real Clerk sign-in or social send.
