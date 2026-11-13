# Local development and isolated PR Previews

Phase 3f local development and live Preview exits are accepted; `.arch-phase` is **3**. Root owns shared/production operations and retention deletion. [Implementation evidence](phase3f-implementation.md) records the tested head and limitations.

## One persistent local command

Use Node 22 and install with `pnpm install --frozen-lockfile`. Create **ignored mode-600 `.env.dev.local`**, containing only:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<matching real Clerk test publishable key>
CLERK_SECRET_KEY=<matching real Clerk test secret key>
CLERK_JWT_ISSUER_DOMAIN=<matching real HTTPS issuer>
LOCAL_DEV_OWNER_EMAILS=<explicit comma-separated test-owner emails>
LOCAL_DEV_PORT=3000
```

The three Clerk fields must identify the same active test tenant, with its `convex` JWT template and audience `convex`. Sign in through the actual Clerk UI with an allowlisted test account. The dev command never impersonates a user or creates a shared owner. An invalid tenant, template or owner remains an actual auth failure; no fake auth or placeholder client exists.

```sh
pnpm dev
# Ctrl-C stops Next, the Convex CLI and its backend; data survives.
pnpm dev                 # same backend/data, nonempty seed refusal is expected
```

The command refuses inherited Convex deploy keys, targets and override tokens **before launching anything**. Its private selector file is rebuilt from a validated anonymous state record; even stale CLI dotenv selectors cannot choose a shared target. Unset those variables; do not substitute a shared URL. It reads only `.env.dev.local`, never ordinary dotenv files for deployment selection. Next receives explicit local URLs, the Clerk fields and disabled external-service/deploy values, which prevent its dotenv loader from restoring business credentials. Dev `HOME` is private and contains no normal Convex login. Anonymous Convex can contact Convex infrastructure for binary download/anonymous provisioning; it creates no project Preview and requires no paid upgrade or deploy key.

Private `.local-dev/` belongs to this checkout: a realpath ownership marker, exclusive invocation lock, stable free ports, isolated CLI project and home, SQLite/storage, mode-600 config and mode-700 directory. The CLI project's supported `convex.json.functions` path points at the real checkout source; Convex watches/updates it directly and generates the existing JS/declaration format. The node_modules link contains no state. CLI dotenv writes stay under `.local-dev/backend`, not the ordinary app env. Only downloadable Convex binaries/dashboard share this checkout's private `output/convex-cache`; deployment/config/auth homes stay isolated. Next dev uses its supported webpack mode and binds `localhost`, matching the Clerk development origin. Do not copy this state between checkouts. A second invocation fails on the lock. After an uncatchable crash, first verify that **this invocation's** processes stopped, then remove only its stale `.local-dev/lock`. No reset command exists. Do not remove the state directory as a routine restart procedure. Occupied ports and malformed/transplanted state fail; they never select another backend.

The command configures only its anonymous loopback backend's Clerk issuer and owner allowlist, invokes the existing atomic `maintenance/seed:seedAll` with `demo-resort`, and starts Next after that finishes. The mutation checks every schema table before its first write. Its exact nonempty refusal retains the database; every other error fails startup. It does not reset, replace, import, partially repair or duplicate an existing seed. Signal/child failure stops owned process groups and releases the lock. Backend source/type errors use Convex's normal watch-and-retry behavior; first successful deployment is required before Next starts.

`pnpm dev:full` is an alias. `pnpm dev:next` and `pnpm dev:convex` remain low-level commands for deliberately configured operator sessions; they do not provide this isolation. `pnpm seed` remains an explicit operator mutation and is not needed for local startup.

## Focused tests and full coverage

```sh
VITEST_MAX_WORKERS=4 pnpm test:pure             # pure rules, Node and tooling tests
VITEST_MAX_WORKERS=4 pnpm test:dom pos-order-recovery
VITEST_MAX_WORKERS=4 pnpm test:convex adminChat
VITEST_MAX_WORKERS=4 pnpm test:unit             # ALL three projects, former default preserved
VITEST_MAX_WORKERS=4 pnpm exec vitest --project dom  # focused watch mode
pnpm test:booking-ui                          # component/browser checks, same harness
pnpm verify:integration                       # complete isolated backend/build/real Clerk E2E
pnpm test:dev                                 # persistent dev lifecycle acceptance
```

The projects partition the former `tests/unit/**/*.test.ts` and `convex/**/*.test.ts` defaults exactly once. Existing `happy-dom`/`edge-runtime` declarations choose DOM/Convex projects; other tests run in Node, including pure backend leaves. DOM and Convex retain the real rate-limiter component setup and existing backend harness. Unknown environment declarations fail configuration. No tests, assertions, coverage paths, explicit 30-second archive budgets or typed ESLint tests are dropped. `test:unit` retains its historical full-suite meaning so `verify`, CI and integration keep full default coverage.

`test:dev` refuses an existing `.env.dev.local` instead of overwriting it. Supply only the three test fields through CI or ignored mode-600 `.env.e2e.local`. It creates unique run-owned owner/cashier/nonstaff Clerk test users, configures its local owner explicitly, signs in actual browser sessions, persists a local order, restarts, checks exact order equality, verifies seed refusal, and exercises SIGINT, terminal-close SIGHUP and occupied-port failure cleanup. It deletes its users, closes its browser/processes and removes its temporary dev config on finish/failure. Its local database remains private and retained. A repeat can prove preservation; first empty seeding is evidenced only on initially empty state. It sends no business email, social, model, payment or refund requests. Tests may call Clerk test-tenant administration and sign-in services.

## Vercel Preview ordering and root configuration

The root correction pins Convex **1.50.0**. Its deploy command runs `--cmd` **before** pushing functions; `--preview-run` runs **after** the push. Thus `convex deploy --cmd 'pnpm build' --preview-run ...` can statically cache an empty catalog. The current `pnpm vercel-build` Preview path instead:

1. Validates Vercel Git Preview metadata for `Ruckth/360-tour`, a non-default branch and the exact configured project-scoped Preview Deploy Key (`preview:<team>:<project>|…`). Personal, project-admin, concrete-deployment and production keys are refused.
2. Uses installed `convex deploy --preview-name <exact-branch> --cmd 'node scripts/preview-capture.mjs'`. After claim/default inheritance, that pre-push command resolves the exact branch identity and inspects `convex env list` privately. It rejects nonempty business-provider variables before any function push, then captures the canonical URL in a private temporary file; it never builds or seeds. A rejection can leave a claimed empty deployment, but installs no functions/crons. The CLI then pushes backend/components.
3. Resolves the same branch using installed `convex dashboard --no-open --preview-name <branch>` (metadata only; no browser is opened). The CLI's `authorize_preview` selection is restricted by the project Preview key in a fresh private HOME and a mode-600 explicit env file containing only that Preview key. An empty env file hides `process.env.CONVEX_DEPLOY_KEY` in the pinned CLI and is not valid. Its strict `https://dashboard.convex.dev/d/<deployment-name>` identity must map to exactly the captured canonical cloud URL. Production `wary-toad-189`, shared dev `optimistic-turtle-573`, custom/noncanonical URLs and conflicting selectors are refused.
4. Calls the unchanged atomic seed through that same authorized branch selection. Empty seeds once; an exact nonempty refusal preserves existing Preview state on pushes/rebuilds. All other failures stop the build. Seed output/guest credentials are captured privately and discarded, not printed.
5. Builds Next with the verified URL, after the seed completes, and with deploy/provider/telemetry credentials pinned empty in the build subprocess so dotenv cannot restore them. `SITE_URL` and `NEXT_PUBLIC_SITE_URL` use the current Vercel Preview URL. Failure never falls through to Next. Temporary target/config files are removed.

`--preview-name` requests server-side reuse atomically; `--preview-create` deliberately deletes/recreates and is forbidden in this workflow. The old pinned 1.34.1 CLI did not support reuse; actual successive pushes exposed this before acceptance. A real installed-CLI loopback test now asserts `claim_preview_deployment` sends the exact branch and `reuse: true`. Explicit `env list --include-values` is captured privately for the pre-push guard; the new CLI may otherwise show names only to an agent. Anonymous local startup uses its isolated selection directly, without the now-deprecated `--local` flag.

The existing Vercel Git integration is the workflow; there is no duplicate GitHub deploy job, personal-token CI or new cloud framework. Root owns these **external operations**, not the implementer:

- Keep Vercel's existing **Preview-only** `CONVEX_DEPLOY_KEY` project Preview key. Verify its team/project scope; no token request, key value disclosure or quota upgrade is required.
- Set Preview-only nonsecret `CONVEX_PREVIEW_TEAM`, `CONVEX_PREVIEW_PROJECT`, and `CONVEX_PREVIEW_DEFAULT_BRANCH` to the actual Convex slugs and Git default branch. Expose Vercel Git system variables. Keep the build command `pnpm vercel-build` (also set in `vercel.json`). No production environment change is part of this PR.
- Set the matching test Clerk frontend variables in Vercel Preview and the matching `CLERK_JWT_ISSUER_DOMAIN`/explicit preview `ADMIN_EMAILS` through Convex project **Preview defaults**, before the first push. Validate the actual tenant/JWT template and Clerk allowed/custom domains. Remove business credentials from the Preview type of project defaults before claiming a deployment. Preserve dev/prod defaults and existing deployment environments. A post-push/pre-seed check alone is too late because pushed crons/routes are already active. Do not copy external business credentials into Preview defaults. Keep model, social, email, payment and refund providers disabled for acceptance.
- After reviewing/merging the stack, trigger one authorized Preview. Verify its dashboard project/type/branch identity against production/shared-dev baselines; inspect actual seeded catalog, real Clerk owner and nonstaff access, a local-only durable write and a second push/rebuild retaining that write without reseed. Verify Next's rendered catalog is populated on its first build. Root owns actual Preview creation, live acceptance, GH/Vercel environment settings and any eventual production cutover.

The Production branch of the build wrapper retains the existing deploy/Next command with an explicit production deployment-key guard and **never seeds**. This PR does not establish production deployment/ordering acceptance. Backend deploy success followed by seed/build failure leaves the isolated Preview for diagnosis and a later retry; it never deletes it.

Primary references checked alongside installed source/help: [Convex Vercel integration](https://docs.convex.dev/production/hosting/vercel), [deploy command](https://docs.convex.dev/cli/reference/deploy), [dashboard metadata command](https://docs.convex.dev/cli/reference/dashboard), [local deployments](https://docs.convex.dev/cli/local-deployments), [functions-path configuration](https://docs.convex.dev/config/convex.json), [Vitest projects](https://vitest.dev/guide/projects), [Vercel system variables](https://vercel.com/docs/environment-variables/system-environment-variables) and [Vercel Git integration](https://vercel.com/docs/git). Installed behavior is authoritative for this pinned lockfile; recheck the ordering and CLI formats on upgrade.

## Conservative Preview retention: operator dry-run

There is no urgent cleanup: root already exported/backed up and removed obsolete merged PR60–71 architecture previews with fresh project/type/branch/merge proofs; the last supplied project count is around 27. Do not delete another preview to make this implementation pass. Seven days after **both deployment creation and PR merge** is the minimum retention, not an automatic deletion date.

`pnpm preview:retention` is an **offline planner**. It never reads keys, calls a network, exports data or deletes anything; there is deliberately no `--apply`. Root can use it instead of the ignored ad hoc tool after inspecting its evidence. It requires one explicit architecture branch, project id/team/slug, fresh complete inventory and GitHub proof. Default/production/shared-dev, wrong-type/project, unrelated branches, fork PRs, nonarchitecture branches, stacked PRs not yet merged to the default branch, open/closed-unmerged PRs, and reused branches with new commits are protected. A deployment name resembling a branch is never identity proof.

Root's authorized operator procedure:

1. In a private mode-700 directory, capture a fresh project identity and the supported Management API `GET https://api.convex.dev/v1/projects/<project-id>/list_deployments`. Preserve the raw response. Read the exact Preview association from authoritative metadata; **never derive it from a deployment name**. If metadata does not prove project/type/preview identifier/creation time, stop. Use project-scoped credentials appropriate to the operation. No personal/prod-admin key belongs in CI; this tool has no CI credentials.
2. Capture complete, freshly paginated GitHub PR proof for the exact branch in `Ruckth/360-tour` (`gh pr list --repo Ruckth/360-tour --state all --head <branch> --json number,state,mergedAt,headRefName,headRefOid,baseRefName,headRepository`). Confirm every result from this repository and the branch's current head (`gh api repos/Ruckth/360-tour/branches/<URL-encoded-branch>`), or its confirmed deletion. Preserve raw responses, query time and repository identity. A branch ref moved past its merged PR is protected. A missing response is not proof of deletion. Do not truncate away newer/open PRs. Read proofs only; no comments/messages are sent.
3. Normalize those reviewed responses into the following mode-600 evidence file. The normalization is an operator attestation attached to raw sources, not a cryptographic claim made by the planner. Do not populate unknown fields by guessing. `createdAt`, `observedAt` and `mergedAt` are ISO timestamps. Observation must be within 15 minutes and not in the future.

```json
{
  "observedAt": "<fresh observation time>",
  "project": { "id": 123, "team": "<team>", "slug": "<project>", "defaultBranch": "main" },
  "branch": { "name": "t3/phase3b-bookings", "exists": true, "headSha": "<40-hex-current-head>" },
  "deployments": [{ "id": 456, "name": "<actual-deployment>", "projectId": 123, "deploymentType": "preview", "previewIdentifier": "t3/phase3b-bookings", "createdAt": "<creation time>" }],
  "pulls": [{ "number": 42, "state": "MERGED", "mergedAt": "<merge time>", "headRefName": "t3/phase3b-bookings", "headRefOid": "<40-hex-merged-head>", "baseRefName": "main", "headRepository": { "nameWithOwner": "Ruckth/360-tour" }, "repository": { "nameWithOwner": "Ruckth/360-tour" } }]
}
```

For a confirmed deleted branch use `exists: false, headSha: null`. Include **all** PRs for the branch, not only its oldest merged PR.

```sh
pnpm preview:retention --evidence <private-evidence.json> --project-id <id> --team <team> --project <project> --branch <exact-architecture-branch>
```

4. Only for an eligible exact Preview, root first exports a **complete backup including component data and file storage** using the supported installed CLI `convex export --preview-name <exact-branch> --include-file-storage --path <private-snapshot.zip>` with that project's Preview key in an isolated HOME/explicit env file. Confirm the resolved target against the inventory before export. Never reuse production/shared data. Keep the export, raw proofs and SHA-256 permanently protected through the cleanup/rollback window. Record a manifest entry `{deploymentId,deploymentName,projectId,previewIdentifier,path,exportedAt,includeFileStorage:true,sha256}`. `exportedAt` must be freshly captured after the export. Run the planner again with `--backups <private-manifest.json>`. It verifies mode-600 file/mode-700 directory, exact identity, freshness, hash, root table/storage inventories, the installed rateLimiter component table/storage inventories and **every ZIP member's CRC** under a 30-second budget before emitting an operator endpoint. No endpoint is emitted for a protected or unbacked preview.
5. Immediately before deletion, root must re-fetch project/type/branch inventory, complete GitHub merge/current-head proofs and Preview association, rerun the planner, and compare the exact deployment id/name and backup digest. Stop on any mismatch, new unmerged work, missing proof or export failure. Only then may the authorized root operator use the documented `POST https://api.convex.dev/v1/deployments/<exact-deployment-name>/delete`. This is destructive and is intentionally **outside** the planner. Preserve backup and proof after deletion; verify only the intended Preview disappeared and production/shared-dev/protected previews remain unchanged. A later push can recreate the branch Preview from empty, so do not schedule automatic reaping of active work.

Supported endpoints and backup recommendation: [list deployments](https://docs.convex.dev/management-api/list-deployments), [delete deployment](https://docs.convex.dev/management-api/delete-deployment). No top-level thread, scheduled task, cloud retention worker, paid upgrade or live cleanup is introduced.

Root review corrections: the real installed CLI is exercised against a loopback-only authorization fixture; signal acceptance now includes SIGHUP. The worker ceiling explicitly consumes `VITEST_MAX_WORKERS` (default 4), capped by available CPUs; Vitest does not consume that project convention automatically. Test deadlines and assertions are unchanged. Root removed only Preview defaults for AI_API_KEY, RESEND_API_KEY and CONVEX_SERVER_SECRET, checked dev/prod defaults unchanged, and configured the three nonsecret Vercel Preview scope settings while preserving existing deploy keys. Live first-build/auth/rebuild acceptance passed; the original Preview owner allowlist was restored and all run-owned test users removed.
