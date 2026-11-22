# Phase 4 cutover: Next → TanStack Start (operator runbook)

Status: **prepared, not executed against any shared target.** This runbook and `scripts/cutover-rehearsal.mjs` implement the "Rehearse cutover and prove the gains" package of the [TanStack/Bun plan](../plans/tanstack-bun-performance.html). The implementation agent has only used run-owned local backends. Root owns every production, Preview, Vercel, provider and alias operation. The [Phase 1 reset runbook](phase1-reset-runbook.md) still supplies sequencing for provider pauses and drains. Its 91/74-table ZIPs, `72a657f` preconditions and seed expectations belong to another schema and **must not** be used here.

## 1. Revision pair and what the manifest says

| | OLD (**historical**, pre-Phase 3 production observed 2026-11-22; not the cutover OLD) | NEW (candidate) |
| --- | --- | --- |
| SHA | `6e6a562c` (then `origin/main`, Next): the production deployment at that time, `dpl_BXw8P9Sv…`, verified read-only (historical) | rehearsed `20b46534`; the tooling now targets `t3/phase4-cutover-start-default-integration` = this work merged with `eeb076a1` (Start default). The Phase 4 PR ends with two buildable commits: the Preview-accepted dual-entry Start-default checkpoint, then the Start-only head. Production builds the head (§7) |
| Toolchain | pnpm 10.30.3, `pnpm-lock.yaml`, Node 22 | Bun 1.4.5, `bun.lock`, Node 22 |
| Vercel framework | project setting `nextjs` (`vercel.json` has no `framework` key) | `vercel.json` `"framework": null` → **Other** for that deployment. The project setting stays `nextjs` |
| Vercel `installCommand` | `pnpm install` | `npx --yes bun@1.4.5 install --frozen-lockfile` |
| Vercel `buildCommand` | `pnpm vercel-build` | `npx --yes bun@1.4.5 run vercel-build` |
| Production build | `convex deploy --cmd 'pnpm build'` → Next | Start-only head: `convex deploy --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'bun run build'` → Nitro Build Output; `FRONTEND=next` is refused before any deploy. The dual-entry checkpoint (and the rehearsed SHAs below) used `bun run build:start`, with `FRONTEND=next` → `build:next`, which also needs `"framework": "nextjs"` in `vercel.json`. `FRONTEND_ONLY_CONVEX_URL=https://wary-toad-189.convex.cloud` builds the frontend only, with no `convex deploy` |
| Root tables / components | 97 / `rateLimiter` (`@convex-dev/rate-limiter@0.3.2`, table `rateLimits`) | identical |
| Schema source graph | — | **byte-identical** (`schema.sourcesIdentical: true`) |
| Crons | 10 | 10 (same names) |
| Maintenance gate / seed | `ARCH_RESET_PAUSED`, `maintenance/seed:seedAll` | same |

The NEW backend adds the internal action `catalog/properties:deliverVillaInvalidation` and changes `adminReviews`/`propertyEdits` behavior. Its schema is unchanged, and the rehearsal deployed NEW onto the restored OLD export without error (`newSchemaOnOldData: accepted`). **For this pair, production needs no reset or reseed.** The cutover is an in-place backend deploy plus a framework switch. The clear/restore path below is rehearsed as the contingency. It becomes mandatory only if a later Phase 3/4 integration produces `sourcesIdentical: false` **and** the in-place probe rejects the old data.

**The OLD column is historical.** It records the `6e6a562c` pnpm production observed on 2026-11-22. The actual OLD at the Phase 4 cutover is the Phase 3 merge `c7e07a2256d08c0a7ebff201a1c625b711046692` (verified Stage 0 deployment `dpl_4X95Z9YtScq1mr2P6Gjd1xZ4LSfM`), with these conventions; regenerate the table for the exact pair:

- **Toolchain:** Bun 1.4.5 and `bun.lock`; Vercel install `npx --yes bun@1.4.5 install --frozen-lockfile`, build `npx --yes bun@1.4.5 run vercel-build`. `vercel.json` has no `framework` key, so the project preset `nextjs` applies.
- **Production build:** always deploys the backend: `convex deploy --typecheck enable` with `--cmd 'bun run build'` (Next, `next build`, `NEXT_PUBLIC_CONVEX_URL`). Only `START_PRODUCTION=1` selects `bun run build:start` (Start, `VITE_CONVEX_URL`). There is no `FRONTEND` selector and no `FRONTEND_ONLY_CONVEX_URL`: an OLD production build can never skip `convex deploy`. Preview builds Start only with `START_PREVIEW=1`.
- **Serving:** `bun run preview` (`next start`) for the Next build, `bun run preview:start` for Start.
- Only the dual-entry checkpoint and the Start-only head honor `FRONTEND_ONLY_CONVEX_URL`.

Regenerate both items for the exact final SHAs; the values above are not portable:

```sh
node scripts/cutover-rehearsal.mjs manifest --old <prod-sha> --new <final-E-sha> --out output/cutover-manifest
node scripts/heavy.mjs node scripts/cutover-rehearsal.mjs rehearse --old <prod-sha> --new <final-E-sha>   # ~15 min incl. two 5-min gaps
```

`manifest` is offline. It records full SHAs, package manager, lockfile hash, `vercel.json`, the reachable schema-source SHA-256 graph, table and component inventories (installed component versions must equal each lock), crons, gate/seed presence, and deterministic side-specific `clear-old.zip`/`clear-new.zip` with their hashes. `rehearse` writes everything to `output/cutover-rehearsal/<run>/` (mode 700; exports and seed outputs are 600, gitignored). That includes `report.json` with every step, each export's SHA-256, and per-table canonical digests.

## 2. What the rehearsal does (run-owned targets only)

- **Targets.** Each target is a `convex-local-backend` process started directly from the shared binary cache, bound to `127.0.0.1` with a unique `rehearsal-<run>-<label>` instance name, a fresh instance secret and its own SQLite and storage. The CLI talks to it through `CONVEX_SELF_HOSTED_URL`/`ADMIN_KEY` with a private `HOME` and no inherited environment, so `.env.local` and cloud or provider credentials are never read. Before every CLI call the tool checks `/instance_name` against the run-owned identity. It uses `--yes` only after that check.
- **Outbound disabled.** `--convex-http-proxy` points action `fetch` at a closed local port, so Stripe, Resend, LINE, Meta and the model providers are unreachable. Payment is tested with a run-owned `STRIPE_WEBHOOK_SECRET` and locally signed events.
- **CLI lifecycle.** `convex dev` is not used: it couples deployment to a file watcher and one checkout. Running the binary directly and pushing with `convex deploy` lets one persistent target receive OLD → maintenance → NEW → OLD revisions, survive SIGKILL/restart, and be exported and imported, without touching any project or deployment selection.

Sequence: exact `git archive` of each SHA, each installed from its own lockfile. Maintenance copies come from `scripts/architecture-maintenance.mjs` (paused cron registry plus the drain helper from `reset-old-schema.ts.template`, which now also accepts an exact self-hosted origin).

1. **OLD live:** deploy OLD to P, seed `demo-resort`, upload two storage blobs, run one smoke pass, and verify that 10 cron jobs are registered.
2. **Quiesce:** set `ARCH_MONEY_CUTOVER_AT` and then `ARCH_RESET_PAUSED=1`. Confirm that a public query and mutation are refused, and that Stripe and LINE HTTP return 503. Deploy the OLD maintenance copy and check that 0 cron jobs remain. Drain the scheduler, rescan, and require 0 pending and 0 in progress.
3. **Export** OLD with file storage. **Pre-verified restore:** import it into isolated backend R, re-export, and compare every table's canonical digest and every blob hash. Then probe a NEW deploy on that data.
4. **Interrupted clear:** SIGKILL P during `import --replace-all clear-old.zip`, restart from disk, and classify the result as cleared, untouched or partial (partial fails). Then finish the clear while OLD is deployed and verify that root and component tables are empty. Storage is retained by design.
5. Deploy **paused NEW** and require the exported table set to equal the manifest. **Interrupted reseed:** SIGKILL during `seedAll`, restart, classify, and resume. A **second identical seed must be refused** (`Seed requires an empty database`). Then check key counts, dangling `*Id` references, and that `/public` assets exist.
6. Lift the internal pause while ingress stays gated, then run **smoke pass 1, wait 5 min, smoke pass 2**.
7. **Rollback:** pause NEW, deploy the NEW maintenance copy and drain it, export the failed NEW state, and clear NEW while NEW is deployed. Deploy paused OLD, restore the verified OLD export, and require identical digests and blob hashes. Deploy plain OLD (10 crons restored), lift the pause, and run **smoke pass 1, wait 5 min, smoke pass 2**.

**Smoke pass:**

- **Tour:** public villa list (≥3), villa by slug, tour scenes, and each tracked storage blob fetched through the app's own upload check and byte-hashed.
- **Booking/payment sandbox:** public `bookings:create`, internal checkout reservation with a fake session, a signed `checkout.session.completed` to `/stripe/webhook` (200), a replay (200, idempotent) and a forged signature (400). The booking must end `paid`/`confirmed`.
- **Roles:** the owner via `ADMIN_EMAILS`; the cashier through the real `setGrant` → `claimInvite` invitation flow; a non-staff user and an anonymous caller are both denied `listPeople`.
- **Scheduler:** there must be no failed scheduled function and only allowlisted pending jobs.

`--frontends` builds frontends inside the archive (no checkout `.env*`) against P through each revision's **own** selection: `scripts/frontend-target.mjs` plus its package script, run with that revision's package manager. Each probe requires `/rooms/pool-villa` to return 200 with the villa name. After the forward run it builds the NEW default and, only while NEW still ships Next, NEW `FRONTEND=next`. Historically (NEW = the dual-entry `9cd9836c`) that was Start `build:start` plus `build:next`; for the Start-only head it is Start `build` alone. After rollback it builds the OLD default through OLD's own scripts with no `START_*` variable set: `build`, which is Next at both `6e6a562c` and the Phase 3 OLD, served by its `preview` (`next start`). It adds OLD `FRONTEND=next` only when OLD has a frontend selector that accepts it (the dual-entry checkpoint). It needs a Clerk **test** publishable key in `REHEARSAL_CLERK_PUBLISHABLE_KEY`.

## 2a. Read-only Vercel settings and the Instagram rewrite

```sh
node scripts/cutover-rehearsal.mjs vercel-settings --old <prod-sha> --new <final-sha> --out output/cutover-settings/stage0.json   # GET-only
node scripts/cutover-rehearsal.mjs vercel-settings --old <prod-sha> --new <final-sha> --compare output/cutover-settings/stage0.json
VERCEL_PROTECTION_BYPASS=<secret> node scripts/cutover-rehearsal.mjs instagram-probe --url https://<preview-or-staged-deployment>
```

`vercel-settings` uses the operator's existing Vercel CLI login and sends only `vercel@66.6.0 api -X GET` requests, from outside the checkout. It reads the project, project routes, the active firewall configuration and recent production deployments. It keeps env var **names and targets only**, with no values and no protection-bypass secrets, and writes the result as a mode-600 file. It computes the effective framework and commands for each SHA, where `vercel.json` overrides the project setting it names. `--compare` reports which of project, routes and firewall changed since an earlier snapshot. That is how the settings restore is checked after a switch or a rollback.

**Live target (`snapshot.live`).** The serving deployment is derived from the public domain, never from "the newest READY production deployment". A staged production build is READY but has no alias, so that rule would pick the wrong rollback target. The derivation runs:

1. verified, non-redirect production domains (`GET /v9/projects/{id}/domains?production=true`);
2. each domain's alias (`GET /v4/aliases/{domain}?projectId=`);
3. that alias's deployment (`GET /v13/deployments/{id}`).

It **fails closed** (exit non-zero, no snapshot written) if any of these hold:

- there is no verified production domain;
- a domain has no alias, or its alias belongs to another project;
- the domains map to different deployments;
- the deployment belongs to another project, is not READY production, or has no commit SHA.

**Inventory pagination.** Both lists are read with Vercel's `pagination.next` cursor, sent back as `until`. Production domains (50 per page, at most 10 pages) are read completely. Production deployments of this project (`projectId` plus `target=production`, 100 per page, at most 10 pages) are also read to the terminal cursor. A slow build created before the live deployment, for example one overtaken by a manual promotion, or a live deployment changed by a rollback, can leave an active build on an older page. `queued` therefore lists every QUEUED, INITIALIZING or BUILDING production build regardless of age. The read **fails closed** when:

- a cursor repeats or does not move back in time;
- an empty page still reports a next page;
- a page lacks an explicit `pagination.next`: a full page with a missing pagination object or cursor is refused, never read as the end. Only an explicit `next: null` ends a list, and that terminal page may be shorter than the limit;
- a page returns more items than requested;
- the page cap is reached, which means truncation (more than 500 domains or 1,000 production deployments);
- a listed deployment is outside production of this project;
- the live deployment is absent from the inventory;
- there are more than 20 qualifying production domains, which bounds the alias and deployment lookups to one GET each.

`snapshot.inventory` records the domain pages, the deployment pages and the number of deployments read. On 2026-11-22 a GET-only run (with the earlier stop-at-live reader) read 1 domain page and 1 deployment page; both lists ended within that page. Staged and queued were empty, and `--expect-live dpl_BXw8P9Sv…` / `6e6a562c…` exited 0.

Every other production deployment is reported separately:

- `staged`: READY, newer than live, unaliased;
- `previous`: READY, older; these are the rollback candidates;
- `queued`: QUEUED, INITIALIZING or BUILDING.

`findings.unaliasedProductionBuilds` lists the staged and queued IDs. `--expect-live <dpl_id> [--expect-live-sha <sha>]` exits 1 unless the public domains resolve to exactly that deployment. `--forbid-start-production` exits 1 when `START_PRODUCTION` applies to the production target, including a multi-target variable such as `START_PRODUCTION@preview,production`; Preview- or development-only entries are ignored. An older revision whose build honours that variable would otherwise rebuild the wrong frontend. It also fails closed when the project API's env inventory is missing or malformed (`snapshot.envInventory` ≠ `ok`), since an empty list would otherwise read as absence.

**Production env gate** (`--forbid-start-production`, or its alias `--production-env-gate`). It records three names-only inventories in `snapshot.productionEnv`:
- `embedded`: `project.env` from the project GET;
- `list`: the independent per-target `GET /v10/projects/<id>/env`;
- `shared`: `GET /v1/env?projectId=<id>`, the team shared variables linked to this project.

Values are never kept. The gate fails closed unless all three are complete: present and well-formed, `hiddenProductionEnvCount` 0, and no further page, since neither endpoint documents a page cursor. It also requires the two project inventories to agree. It then requires `FRONTEND`, `FRONTEND_ONLY_CONVEX_URL`, `START_PRODUCTION`, `START_PREVIEW` and `START_SSR_RUNTIME` absent from the production target, project or linked shared. Other names are not restricted, including the required `START_VILLA_INVALIDATION_SECRET`/`START_VILLA_INVALIDATION_ORIGIN`. `--expected-production-env <file>` (one name per line, `#` comments) additionally requires the exact production name set, so an unreviewed addition or removal also stops the step. A failed env read does not abort the snapshot; it is recorded as `unavailable` and fails only the gate. Read-only check on 2026-11-22: the list endpoint returned 31 entries (22 on production, `hiddenProductionEnvCount: 0`, no selectors), and the shared endpoint returned 0 linked variables with `next: null`. Both flags fail only after the snapshot is printed and written, so a failing run stays inspectable; without them the command is diagnostic only. Use it after every promotion and every reversal.

**Historical** read-only check on 2026-11-22 (pre-Phase 3 production, not the cutover OLD): `tour.helpgueststay.com` → `dpl_BXw8P9SvHneaUJvsGFiWRSoynLHr` at `6e6a562c9d0424f091654ba1e8b69a27b5e92242`, with staged `[]`, queued `[]`, and previous `dpl_5dBaMv2X…`, `dpl_3mdr9r3f…`. `--expect-live` with that ID and SHA exited 0; a deliberately wrong ID exited 1.

`instagram-probe` sends one GET with a random `hub.verify_token`. It passes only when it receives Convex's `403 Forbidden` from the Meta challenge handler; a frontend 404 or HTML fails it. Because the route forwards to the **production** Convex site even from a Preview, the probe never POSTs.

Stage 0 snapshot captured 2026-11-22 (`output/cutover-settings/stage0-202611221127.json`, private), with `--new` = the integration branch. **Historical:** it shows the `6e6a562c` pnpm production; repeat it on the actual Phase 3 OLD (§4 Stage 0):

- **Production deployment:** `dpl_BXw8P9SvHneaUJvsGFiWRSoynLHr` at `6e6a562c` (`productionIsOld: true`), aliases `tour.helpgueststay.com` and the `*.vercel.app` project aliases. Its deployment settings record framework `nextjs`, `pnpm vercel-build` and `pnpm install`.
- **Project settings:** framework `nextjs`, build `pnpm vercel-build`, install `pnpm install`, output default, root default, Node **24.x**, regions `iad1`, `autoAssignCustomDomains: true`. Both SHAs declare `engines.node` `22.x`, which governs the build and function runtime; record both values.
- **Instagram rewrite:** a **project-level Vercel Route**, not in either SHA's source: `Phase 2 Instagram ingress migration`, enabled, not staged, `^/api/instagram/webhook$` → `https://wary-toad-189.convex.site/instagram/webhook`. Because it lives in project configuration, it survives a source or framework change. Whether it applies ahead of the Nitro Build Output routes is **not yet proved**: run `instagram-probe` on the first Start Preview or staged production deployment.
- **Firewall:** enabled, with 0 custom rules.
- **Env:** no `FRONTEND`, `FRONTEND_ONLY_CONVEX_URL` or `START_*` variables in any target.
- **Finding: `autoPromoteRisk: true`.** With `autoAssignCustomDomains` on and Start as the source default, **merging the NEW SHA to `main` would build Start and alias it to production immediately**. `FRONTEND=next` is not a safe guard under `"framework": null`. Stage 1 therefore turns automatic domain assignment off **before** the merge.

## 3. Evidence: proved vs. still open

**Historical acceptance run `r20261122051731-1a7967` (pair `6e6a562c → 9cd9836c`) — PASS, 26/26 steps** (2026-11-22, 05:17:31Z–05:30:47Z). It started on the measurement-window signal and was run with `--frontends --smoke-gap-ms 300000`, Node v22.22.3 and `convex-local-backend` `precompiled-2026-11-21-cf39368` (SHA-256 `c20e92b9…5d92`).

- **Revisions:** OLD `6e6a562c9d0424f091654ba1e8b69a27b5e92242` (pnpm 10.30.3, Next); NEW `9cd9836ca70e92ec13ff7355b423728435b58817` (Bun 1.4.5, Start default plus the Next entry, compatible Phase 3 changes).
- **Manifest:** schema sources identical, 97 tables, `rateLimiter` component, 10 crons. `clear-old.zip` and `clear-new.zip` both have 98 entries, SHA-256 `811a0093…185b`.
- **OLD live:** seed, 2 storage blobs, one smoke pass, and exactly the 10 OLD cron names registered.
- **Quiesce:** query and mutation refused; Stripe and LINE HTTP 503.
- **OLD maintenance:** 0 crons; 3 jobs cancelled; the rescan showed 0 pending, 0 running and 0 failed.
- **Export:** OLD export `16986c71…e345` (23 non-empty tables, 2 blobs, 0 dangling references). It restored on R with 100 table digests and 2 blobs identical. NEW deployed onto the OLD data (`accepted`).
- **Interrupted clear:** SIGKILL landed before commit (`untouched`). The full clear then left only `_storage` (retained by design).
- **NEW paused:** 97 tables and the 10 NEW cron names registered while paused.
- **Interrupted reseed:** the database was `empty` after restart and was reseeded. The second seed was refused. Key counts matched; 0 dangling references; 13 public assets present.
- **Frontends against the accepted NEW backend:** Start (`build:start`) and the `FRONTEND=next` rebuild (`build:next`) both returned `/rooms/pool-villa` 200 with the villa name.
- **NEW smoke:** two passes **300,857 ms** apart. Tour, payment sandbox (signed webhook 200, replay 200, forged 400, booking `confirmed`) and roles (owner, invited cashier, non-staff and anonymous) all passed, with 0 failed scheduled jobs.
- **Rollback:**
  - The NEW maintenance copy left 0 crons; drain cancelled 6 jobs; the failed NEW state was captured (`6febdde5…3548`); the NEW clear succeeded.
  - Paused OLD plus the verified export restored with 100 digests and 2 blobs identical. Plain OLD then registered exactly its 10 crons.
  - OLD Next (`build`) returned the room page 200 with the villa name.
- **OLD rollback smoke:** two passes **300,825 ms** apart, all checks passed.

**Attempt 1** `r20261122051449-d302f9` (kept) failed after 70 s on a harness defect: `convex data _cron_jobs` is empty on local backends. The earlier "0 crons" readings were therefore meaningless. Since `5104f1a2`, crons are read with the admin system query `_system/frontend/listCronJobs` and compared by exact name set.

No timed measurement was taken. The Next builds used Next's default static-generation workers.

Earlier debug run `r20261122041304-94b792` (5 s smoke gap, not an acceptance run) passed **22 of 23 steps**:

- **Sources and install:** exact OLD and NEW SHAs, each installed from its own lockfile.
- **OLD live state:** smoke passed and storage blobs were uploaded.
- **Quiesce:** paused ingress confirmed (query and mutation refused, HTTP 503); 0 cron jobs after the maintenance deploy; 3 pending jobs cancelled and the rescan was clean.
- **Export and restore:** the export matched on R across 100 table digests and 2 blobs. NEW deployed onto the OLD data.
- **Interrupted clear:** it landed before commit (`untouched`); the completed clear left root and component tables empty.
- **NEW deploy and seed:** NEW deployed paused with the 97-table inventory. The interrupted seed left the database empty and was resumed. The second seed was refused. Key counts matched, with 0 dangling references and 13 public assets present.
- **NEW smoke:** both NEW smoke passes passed.
- **Rollback:** drain cancelled 6 jobs; the failed NEW state was captured; the NEW clear succeeded; the OLD restore matched across 100 digests and 2 blobs.
- **Failure:** the OLD rollback smoke failed only because the tool resolved storage IDs from export names (`<id>.png`). That is fixed (extension stripped).

The cron-count assertions were added after that run.

| Claim | Status (historical pairs named below; rerun on the final SHAs) |
| --- | --- |
| Tool, manifest and clear ZIPs are reproducible and revision-aware | Proved (unit tests plus run) |
| OLD export restore is byte-verified on an isolated OLD target before any clear | Proved |
| Forward and reverse data path, drain, pause gate, interrupted clear and seed, double-seed refusal | Proved at backend level |
| NEW schema accepts OLD data in place (no reset needed) | Proved for `6e6a562c → 20b46534` and `6e6a562c → 9cd9836c` |
| **Full green run with two smoke passes 5 minutes apart in both directions** | **Proved** for `6e6a562c → 9cd9836c` (`r20261122051731-1a7967`) |
| Interrupted clear landing *after* commit | Not observed; rerun with `--interrupt-after-ms` to sample it |
| Start, `FRONTEND=next` and OLD Next SSR against rehearsal data (`--frontends`, revision-owned build scripts) | **Proved** locally (room page 200 with villa content), in the same run |
| Retained project settings and Instagram project route (read-only) | Recorded at Stage 0; `--compare` is ready for after the switch and the rollback |
| Instagram rewrite still forwarding with the Start (Nitro) output | **Proved on a protected Start Preview.** On 2026-11-22 at 04:41:25Z, one random-token GET was sent to `dpl_5bVyjUusgUQsX3p4RtPesoeTMT7H`: READY Preview, framework Other, CLI-deployed from `output/private-preview/remote-start-aea4cc51`; its Vercel git metadata reads `b1958145`. It returned `403`, body `Forbidden`, no `x-vercel-error`, `x-vercel-cache: MISS`. That is Convex's Meta challenge rejection through the project route `^/api/instagram/webhook$` → `wary-toad-189.convex.site`, ahead of the Nitro output. An earlier attempt on `dpl_DAWng3…` was inconclusive (`410 GONE`, deployment removed). Repeat on the staged production deployment and alias in Stage 3 |
| Real Clerk browser sessions, Vercel Nitro output, Bun SSR runtime, firewall/alias behavior, provider pauses | Not provable locally: needs Preview and root |
| Phase 4 performance budgets (stage E vs A–D) | Out of scope here; wait for coordination before any heavy timed browser benchmark |

A protected Preview of `93c2c0d9` built the default TanStack Start entry on Bun 1.4.4 with the tracked `framework: null` setting. The build log confirmed the frontend-only path against the existing seeded test backend. An ordinary villa and its direct tour returned 200. Only the direct tour added the five viewer modules, all of which returned JavaScript with immutable cache headers. An unknown villa returned 404 and omitted the five modules. [Hosted entry and asset checks](../plans/benchmarks/start-default-preview.json)

**What the final E candidate still needs.** Rerun `manifest` and `rehearse --frontends` on the exact production SHA and the integrated Phase 3/4 E SHA. If Phase 3 changes any schema source, the in-place probe result decides between the in-place cutover (§4) and the reset path (§6). Then run the seeded Preview acceptance on the same SHA (Start is the default build: Clerk test sessions, the 61 parity rows) plus `instagram-probe` and `vercel-settings --compare`, and produce the measured budget table.

## 4. Staged production procedure (in-place; schema-compatible pair)

Do every step from §4 onward only with root's approval and on the verified production mapping (`wary-toad-189`). Never infer it from `.env.local`.

**Vercel CLI.** Every Vercel write and every reopen or rollback command runs as `VC="npx --yes vercel@66.6.0"` (the version the read-only tooling pins), from a private directory outside the checkout (`mkdir -m 700 …; cd …; umask 077`), so no `vercel.json`, `.vercel/` link or `.env*` is picked up. Pass `--scope rugbykritsakorn-9882s-projects` explicitly. `$VC` below means exactly that.

**Stage 0: record (no changes).**

- **Production env pin:** after the gate passes, review `snapshot.productionEnv.list.names` and save it as the names-only pin: `node -e 'const s=require("./stage0.json").snapshot.productionEnv;console.log([...new Set([...s.list.names,...s.shared.names])].sort().join("\n"))' > stage0-production-env.names`. Every later gated run (§4 Stage 3 checks, §5.3) adds `--expected-production-env stage0-production-env.names`. A deliberate change, such as provisioning `START_VILLA_INVALIDATION_SECRET` for push invalidation, means updating the pin in the same reviewed step.
- **Routes record:** `vercel api -X GET /v1/projects/<id>/routes` and `…/routes/versions` into private files. The snapshot below also keeps `snapshot.routesVersion` (the live routes version id, the routes restore point) and `snapshot.live.domains` (the hosts the §4c hold is scoped to).
- **Settings snapshot:** run `vercel-settings --production-env-gate --out stage0.json` and confirm `productionIsOld`, `instagramRewrite.ok` and no frontend env variables. On the Phase 3 OLD, `START_PRODUCTION` must be absent from production: an OLD rebuild then builds Next with `bun run build`. The flag fails the snapshot if it is present, because `START_PRODUCTION=1` would make an OLD rollback rebuild Start. Also record the OLD SHA's own `package.json` scripts, `vercel.json` and `scripts/vercel-build.mjs` (Bun; always `convex deploy`; no `FRONTEND_ONLY_CONVEX_URL`). Record `snapshot.live.id` and `snapshot.live.sha` as the **rollback target**. The verified Stage 0 OLD at the freeze is `dpl_4X95Z9YtScq1mr2P6Gjd1xZ4LSfM` at `c7e07a2256d08c0a7ebff201a1c625b711046692` (the Phase 3 merge), derived from `tour.helpgueststay.com`. Before any alias move or OLD deploy, read `snapshot.live.id` and `snapshot.live.sha` from a fresh Stage 0 snapshot and use only those values; if they differ from this record, stop and re-verify. Do not take the rollback target from a deployment list. `staged` and `queued` must both be empty before Stage 1.
- **Convex:** backend deploy timestamp, environment variable names, cron list and scheduler state. For villa push invalidation, record whether Convex `START_VILLA_INVALIDATION_ORIGIN` and `START_VILLA_INVALIDATION_SECRET`, and the Vercel production `START_VILLA_INVALIDATION_SECRET`, are set. Keep any prior values only in the operator's secret store; §5 restores exactly that state.
- **Providers:** webhook URLs and status for Stripe, LINE, Facebook, WhatsApp and Instagram, and the iCal feeds.
- **Contracts:** `node scripts/check-function-contracts.mjs --base <prod-sha>`. The in-place NEW backend must keep every contract the still-serving Next frontend calls.
- **Backup:** `convex export --include-file-storage --prod`, mode 600 with its SHA-256. Restore it onto an isolated backend and check digests as the rehearsal does. This is rollback insurance even though no reset is planned.

**Stage 1: stage without traffic.**

1. Turn the project's automatic production domain assignment **off**, and record that it was on. This removes `autoPromoteRisk`. Do not change the framework, install, build or output project settings: NEW's `vercel.json` overrides them per deployment, and leaving them alone keeps the OLD rollback build intact.

   For a Git-triggered merge, the project setting is `autoAssignCustomDomains` on `PATCH /v9/projects/{idOrName}`. Change that field alone and read it back before merging. A manual `$VC deploy --prod --skip-domain` applies to that individual CLI deployment. Promote the accepted production deployment with `$VC promote <deployment-id>`. Record the prior project value for restoration. [Project API](https://vercel.com/docs/rest-api/projects/update-an-existing-project) · [Staged production deployments](https://vercel.com/docs/deployments/promoting-a-deployment)
2. Merge NEW to `main`, or create a production deployment of the NEW SHA. The production build of the Start-only head runs `convex deploy` in place (schema-compatible) and then `bun run build` (Start) with the deploy-callback URL. The result is READY but not aliased. Record the Convex backend revision before and after. From this point Next (old alias) is served by the NEW backend, which is why the Stage 0 contract check matters.
   - If the backend is already deployed and only the NEW frontend must be re-staged, set `FRONTEND_ONLY_CONVEX_URL` **for that one deployment only** (the Start-only head and the dual-entry checkpoint honor it; the Phase 3 OLD does not): `$VC deploy --prod --skip-domain --build-env FRONTEND_ONLY_CONVEX_URL=https://wary-toad-189.convex.cloud --scope …`. It runs no `convex deploy`, and production accepts only that exact URL. Never add it, or any other frontend selector (`FRONTEND`, `START_PRODUCTION`, `START_PREVIEW`, `START_SSR_RUNTIME`), as a production project or linked shared variable: every later production build, including an OLD rollback build, would inherit it. The production env gate (§2a) fails on any of them.
   - **Push-invalidation precondition** (the [accepted room-cache contract](../plans/benchmarks/room-preview-cache.md#what-a-guest-sees-after-a-write)). First prove it on a **dedicated Preview**: a Start Preview deployment paired with its own Preview Convex backend, never production Convex. Set the Convex `START_VILLA_INVALIDATION_ORIGIN` to that Preview's exact origin and the same `START_VILLA_INVALIDATION_SECRET` on both. Edit a villa there and confirm the signed invalidation gets HTTP 204 with shared-cache acknowledgement. Then do the production staging below. For push invalidation, provision the same server-only `START_VILLA_INVALIDATION_SECRET` on Start and Convex. Set the Convex `START_VILLA_INVALIDATION_ORIGIN` to the accepted Start origin. A protected origin also needs its server-side automation bypass. Verify a signed invalidation receives HTTP 204 with shared-cache acknowledgement. After promotion, use the stable production origin. Keep secrets out of reports and restore the previous settings on rollback. If operating with TTL-only refresh, record that choice and check archive and reactivation as in the hosted study. [Villa freshness and writer coverage](../plans/benchmarks/room-preview-cache.md)
3. On the staged deployment URL (with protection bypass):
   - `instagram-probe` must report `forwardedToConvex: true`;
   - `/rooms/pool-villa?tour=1`, the EN and TH headers and the admin sign-in page must render;
   - the assets must contain no Preview `convex.cloud` URL.
4. Confirm the staged function reports the tested Bun 1.4 runtime before promoting it. Bun is the default for Start deployments. To stage the tested fallback on Node 22, rebuild that one deployment with `$VC deploy --prod --skip-domain --build-env START_SSR_RUNTIME=node --scope …` and repeat the same checks on the new deployment. Never set `START_SSR_RUNTIME` as a production project or linked shared variable: the production env gate (§2a) fails on it.

**Stage 2: hold traffic (maintenance plan, §4c).**

1. Publish the project-route hold (§4c). It returns 503 with `Retry-After: 600` on the Stage 0 production domains only, for every path except the exact `/api/instagram/webhook`. The operator passes it with the `x-cutover-hold` token from a private file. Previews and the staged deployment URL are not held. Leave builds enabled and do not pause the project. Convex `*.convex.site` webhooks (Stripe, LINE, Facebook, WhatsApp) never touch Vercel; Meta's Instagram deliveries keep flowing through the exempt project rewrite.
2. No data operation happens in this pair, so open Checkout sessions may complete normally through the Convex webhook.

**Stage 3: switch.**

1. Before promoting, run `vercel-settings`. The intended deployment must appear in `staged`, and the live deployment must still be the Stage 0 target. Promote that exact deployment ID (manual alias). Then `vercel-settings --expect-live <staged-id> --expect-live-sha <NEW-sha>` must exit 0 before the smoke passes.
2. Run the §4a production checks twice, 5 minutes apart: first on the staged deployment URL before promotion (with bypass), then on `tour.helpgueststay.com` after promotion. Each pass runs `public-smoke` and the anonymous browser tour. Also check that Convex logs and the scheduler show no new failures. Signed-in roles and booking/payment are gated earlier, by the seeded Preview and the isolated rehearsal (§4a.1–2), not here.
3. Reopen (§4c: restore the pre-hold routes version and read it back), run `public-smoke` once more on the alias **without** `CUTOVER_HOLD_TOKEN_FILE`, and observe for 30 min: error rate, Convex function failures, and Stripe and provider delivery dashboards.
4. Turn automatic domain assignment back on only after acceptance. Then run `vercel-settings --compare stage0.json`. The expected change is none, or only the deliberate `autoAssignCustomDomains` toggle; routes and firewall must be unchanged, and `findings.maintenanceHold` must be `[]`.

## 4a. Operator smoke protocol: what gates merge and promotion

Each item states which credentials it uses. **Exact-seeded** means run-owned test data with the dedicated Clerk **test** tenant or impersonated identities. **Live/anonymous** means production with no credentials.

**1. Seeded Preview (exact-seeded, real Clerk test sessions). Gate before merge.**

- **What runs:** on the seeded Preview of the release SHA, the [Preview QA run](../../tests/e2e/preview-qa.md) uses real Clerk **test** sign-ins for the owner, cashier and non-staff accounts.
- **What it covers:** booking to the payment screen, Stripe sandbox and test configuration only, and role enforcement.
- **Isolation:** the Preview's provider isolation stays on.
- **Recording:** record the deployment ID and SHA.

**2. Isolated forward/rollback rehearsal (exact-seeded). Gate before merge.**

- **What runs:** `rehearse --frontends --smoke-gap-ms 300000` on the exact production SHA and release SHA.
- **What it requires:** both five-minute smoke pass pairs, in each direction, must include:
  - tour reads;
  - a **signed sandbox Stripe webhook** that confirms the booking, with replay accepted and a forged signature rejected;
  - roles: owner, invited cashier, non-staff and anonymous.
- **Backup:** the targeted backup, byte-verified isolated restore and rollback restore are part of this gate.
- **Status:** historical pass for `6e6a562c` → `9cd9836c` (§3); rerun on the final SHAs.

**3. Production staging and post-promotion (live/anonymous only). Twice, 5 minutes apart, per target.**

```sh
node scripts/cutover-rehearsal.mjs vercel-settings --old <prod-sha> --new <NEW-sha> --expect-live <dpl> --expect-live-sha <sha>
node scripts/cutover-rehearsal.mjs public-smoke --url <staged-url | https://tour.helpgueststay.com> --expect-frontend start --expect-clerk live --repeat-after-ms 300000
node scripts/tour-smoke.mjs --url <staged-url | https://tour.helpgueststay.com>      # run twice, 5 min apart
```

- **`public-smoke`** (GET-only):
  - home, room, direct tour and TH room (`lang="th"`) return 200;
  - an unknown villa returns 404;
  - signed-out `/admin` returns below 500;
  - `robots.txt` and `sitemap.xml` return 200;
  - the renderer and the live Clerk key in the room HTML match the expectation;
  - the Instagram project route returns Convex's 403.
- **`tour-smoke`** (a real anonymous browser):
  - It opens `/rooms/pool-villa?tour=1` with no credentials.
  - It waits until the viewer reports a ready scene and has painted a frame, holds the canvas still to confirm nothing moves without input, then mouse-drags.
  - It requires the camera yaw, read through the app's own `__tourBench` frame hook, and the centre canvas pixels to change.
  - Convex `Mutation`/`Action` frames and HTTP writes are dropped and counted; any Convex write attempt fails the run. Analytics requests (PostHog, Sentry, Vercel Insights and similar) are aborted.
  - Operator headers (`VERCEL_PROTECTION_BYPASS`, and `CUTOVER_HOLD_TOKEN` during the hold, each preferably as a mode-600 `…_FILE`) go only to same-origin requests. Those requests are fetched with redirects off and fulfilled, so a redirect to another origin is followed by the browser as a new request without the headers. (`route.continue({headers})`, used before, would have carried them across a redirect.)
- **Operator headers in both tools.** Secrets come from a mode-600 file (`<NAME>_FILE`) or the environment, never argv, and are never printed. `public-smoke` and `instagram-probe` send them only to `--url`'s origin, refuse a target resolving to any other origin before sending, and do not follow redirects (a redirect is reported as a status failure). `--expect-hold` additionally sends GETs without the hold header to `/`, `/rooms/pool-villa?tour=1`, `/admin` and `/api/internal/villa-cache`, and requires the route's 503 with `Retry-After` and no `x-vercel-error` on each. Both tools accept plain `http://` only on loopback (`127.0.0.1`, `localhost`, `[::1]`). Unit tests run the real CLI against two local servers (a cross-origin redirect, the hold) and assert that the other origin is never contacted and neither secret appears in stdout or stderr.
- **Rollback:** use `--expect-frontend next` against the restored alias.
- **Results so far (2026-11-22, anonymous; not the release smoke):**
  - **Live Next alias `tour.helpgueststay.com`:** `public-smoke` passed at 06:02Z (renderer `next`, Clerk `live`).
    - `tour-smoke` attempt 1 at 06:09:43Z failed only the stillness check: a single 500 ms sample caught the crossfade and overlays settling, while the drag itself turned the camera. The harness now waits up to 15 s for two identical frames 400 ms apart.
    - Attempt 2 at 06:10:12Z **passed**: document 200, scene ready, settled before input, yaw 0 → −0.836, pixels changed, 0 Convex writes, 0 analytics requests, 0 page errors.
  - **Protected Start Preview `dpl_2rHWKHdXzL9WkjjNCAAZUgADoXQW`:** project `360-tour`, READY, framework Other, git `93c2c0d966ec177138d73ce2f221bc03b62e853a` (`perf-phase4-default-preview`, the documented hosted check). The existing automation bypass was read by GET, kept in memory and sent to same-origin requests only.
    - `public-smoke` **passed** at 06:10:52Z (renderer `start`, Clerk `test`).
    - `tour-smoke` **passed** at 06:11:09Z and again at 06:11:49Z, the second run after host recording was added. Both had yaw 0 → −0.836/−0.838, pixels changed, 0 Convex writes and 0 page errors. One blocked write, the Clerk test-tenant client handshake (`hopeful-narwhal-71.clerk.accounts.dev`), was not needed for the tour.
  - The release smoke (staged plus promoted, twice, 5 minutes apart) and the exact final-SHA rehearsal remain to be run.

**Elective, not a prerequisite.** If the owner supplies their existing live session, they may open `/admin` once after promotion. Do not create production Clerk users, send verification mail, make a provider charge or create a live booking for this cutover. Production has a live Clerk tenant and the dedicated E2E identities belong to the test tenant, so live signed-in role checks are recorded as "not run (elective)" unless the owner provides that session. The code shows that a live web booking would write production rows, and Pay would create a live Stripe Checkout session; neither is part of the gate.

## 4b. Schema compatibility before rollout (Phase 2 vs Phase 3)

1. **Offline certificate.** Run `node scripts/cutover-rehearsal.mjs manifest --old <prod-sha> --new <candidate-sha>`.
   - If `schema.sourcesIdentical` is true and the table and component inventories match, an in-place deploy cannot change stored shapes. That held for the historical pairs `6e6a562c` → `20b46534` and `9cd9836c`.
   - Archive `manifest.json`, which records full SHAs, schema-source hashes and lockfiles.
2. **If any schema source differs** (for example, Phase 3 storage changes): run `rehearse --old <prod-sha> --new <candidate-sha>`. Its R step deploys NEW onto the restored OLD export and records `inPlaceCompatibility`. `accepted` proves the code path on the demo data only.
   - Before production, certify against real shapes with the Stage 0 production export:

     ```sh
     node scripts/heavy.mjs node scripts/cutover-rehearsal.mjs certify \
       --backup /private/operator/stage0.zip --sha256 <recorded-sha256> --old <prod-sha> --new <release-sha>
     ```

   - **Inputs and refusals:** the backup must be mode 600 and match `--sha256`, otherwise the command refuses before doing any work.
   - **Restore:** it installs each SHA from its own lockfile and starts one run-owned `127.0.0.1` backend. That backend has a fresh instance secret and a blackholed action-fetch proxy, so there is no egress, and `ARCH_RESET_PAUSED=1` stays set throughout. It deploys the OLD maintenance copy, imports the backup, re-exports, and requires every table digest and blob hash to match.
   - **The test:** it then deploys NEW onto that data while still paused, and records `accepted`, `refused` or `inconclusive`. `refused` requires the Convex CLI's native `✖ Schema validation failed.` marker plus a document line naming the table and field; every other failure (backend unreachable, process killed, other CLI or deploy errors, validation output without table and field) is `inconclusive`. A refusal names only the table and field; the full CLI message stays in the private log.
   - **Outputs:** `output/cutover-certificate/<run>/certificate.json` and `report.json` (mode 600) hold the SHAs, the backup hash, counts, digests and the verdict. Restored backend state, re-exports and source copies are deleted at the end unless `--keep-state`.
   - **Coordination:** it needs dependency installs and one local backend, but no frontend builds. Run it in a functional window.
   - **Decision:** `accepted` certifies the in-place cutover for that backup; `refused` selects the reset path (§6); `inconclusive` writes the certificate, prints no verdict or reset recommendation and exits nonzero: fix the cause and rerun. `--clear-tour-certificates` retries only after the `tourScenes.ordinaryTourCertified` refusal.
4. **Rollback constraint for `ordinaryTourCertified`.** Phase 3 adds the optional `tourScenes.ordinaryTourCertified: true`. The Phase 3 merge `c7e07a2256d08c0a7ebff201a1c625b711046692` and R use the identical validator (`v.optional(v.literal(true))` in `convex/catalog/validators.ts`), so a rollback to P3 keeps those records valid and needs no clearing or pause. The constraint below applies only when a chosen older revision's schema actually rejects the field (pre-Phase 3, such as historical `6e6a562c`).
   - For such a pre-Phase 3 revision only: once NEW has certified any room, deploying its functions onto that data is refused by schema validation. The OLD Next frontend alias reversal alone is unaffected, because it uses only reads that ignore the field.
   - **Before a pre-Phase 3 backend deploy (§5.3)** on post-cutover data (never for P3 `c7e07a22`):
     1. Pause public writes (`ARCH_RESET_PAUSED=1`).
     2. While NEW is still deployed, clear the markers with `maintenance/tourCertificates:page` in `mode: 'clear'` (see `docs/architecture/tour-certificate-recovery.md`), paging until `isDone`.
     3. Run the same mutation in `mode: 'check'`; it must report 0.
     4. Only then deploy OLD.
   - **An older backup can support a pre-Phase 3 downgrade** when an isolated restore and certificate prove it contains zero markers and that the target accepts its data. A Phase 3 Stage 0 export may already contain markers. Restoring a backup also discards writes made after its capture (§6 rollback).
   - `certify --clear-tour-certificates` rehearses exactly this on a copy. It restores a NEW-marked backup under NEW, expects OLD to be refused, clears the markers through the restore revision's maintenance mutation, and expects OLD to be accepted.
   - **Historical synthetic demonstration (pre-Phase 3 OLD `6e6a562c`), 2026-11-22, functional window, heavy queue.** Its native refusal applies only to pre-Phase 3 schemas (private runs under `output/cutover-certificate/`, mode 700):
     - **Forward** `r20261122062605-96f0ac`, synthetic seeded OLD export `16986c71…e345` restored under `6e6a562c9d0424f091654ba1e8b69a27b5e92242`:
       - the restore re-export matched 100 table digests and 2 blobs;
       - NEW `35568ba9ee28a90c51555f6d945e0fe07fd2ab6f` (schema sources differ: the optional marker) was **accepted**;
       - the data was unchanged after the deploy (100 tables, 2 blobs).
     - **Rollback constraint** `r20261122062741-b17479`, the same data with one `tourScenes.ordinaryTourCertified: true` (`845a52e9…487f`), restored under `35568ba9…`:
       - the restore matched 100 tables and 2 blobs;
       - OLD `6e6a562c…` was **refused** on `tourScenes.ordinaryTourCertified`; the private log shows Convex schema validation rejecting the extra field;
       - `maintenance/tourCertificates:page` `clear` cleared 1 marker, after which OLD was **accepted**.
     - **Cleanup:** after each run only `certificate.json`, `report.json`, the logs and the manifest remain; backend state, re-exports and source copies were deleted and no backend process remained.
     - **Not yet done:** the real Stage 0 production certificate on the final release SHA.
5. **Exact-SHA final rehearsal is reserved.** After Phase 3/4 integrate, rerun `manifest` plus `rehearse --frontends --smoke-gap-ms 300000` on the exact production SHA and the exact release SHA. The existing reports cover only the SHAs named in §3.
   - **Prepared, not run.** It waits until root names both targets: the exact production revision (the verified Stage 0 OLD, the Phase 3 merge `c7e07a2256d08c0a7ebff201a1c625b711046692` at `dpl_4X95Z9YtScq1mr2P6Gjd1xZ4LSfM`, re-read from the fresh Stage 0 snapshot) and the exact integrated E release SHA. The release SHA is the Start-only Phase 4 PR head with its `bun.lock`: Stage E measures that shipping code, not the dual-entry checkpoint. Then, in a functional window:

     ```sh
     node scripts/cutover-rehearsal.mjs manifest --old <prod-sha> --new <release-sha> --out output/cutover-manifest-final
     REHEARSAL_CLERK_PUBLISHABLE_KEY=… REHEARSAL_CLERK_SECRET_KEY=…   # Clerk test tenant, loaded privately from .env.e2e.local
     node scripts/heavy.mjs node scripts/cutover-rehearsal.mjs rehearse --old <prod-sha> --new <release-sha> --frontends --smoke-gap-ms 300000
     ```

   - If the manifest reports `sourcesIdentical: false`, `rehearse` records `inPlaceCompatibility` on demo data. The production decision still needs `certify` on the Stage 0 export (§4b.2).
   - Use only full 40-character SHAs and record the run ID with them.

## 4c. Maintenance hold (Hobby: project route `set-status`, production domains only)

**What the plan supports.** The team is on Hobby. A firewall custom rule (3 allowed) can only `deny` with **403**, with no custom status. A project-level route with `set-status` returns a real **503** with headers and needs no redeploy. It is staged first, goes live only when its version is promoted, and is reversible by restoring the previous routes version. The Instagram rewrite is already a project route, proved to run ahead of the Nitro output.

**Scope.** Project routes apply to every deployment, so the hold carries a `has` **host** condition: an anchored, escaped match of the Stage 0 `snapshot.live.domains` (at the 2026-11-22 read exactly `^(?:tour\.helpgueststay\.com)$`; build it from the fresh Stage 0 list). Everything else keeps its usual protection and stays reachable without the token:

- Previews and branch aliases;
- the staged immutable URL used for the Stage 3 pre-promotion pass;
- the Stage 0 deployment's own URL;
- other projects;
- **the project's `*.vercel.app` production aliases.** They serve the same production deployment but are not in `snapshot.live.domains` (they are automatic aliases, not project domains), so they stay **unheld and publicly reachable** for the whole hold.

  The hold is a maintenance page for the public domain, not an access barrier. Writes during the window are governed by the backend, which stays live in this schema-compatible pair, not by the hold. If a window ever needs those aliases closed, it needs a backend pause (the §6 reset path), not a wider route.

`hold-check` proves this with the identical guest paths (`/`, `/rooms/pool-villa?tour=1`, `/admin`) on those hosts and on look-alike hosts.

**Secrets and logs.**
- The token lives only in a mode-600 file (`CUTOVER_HOLD_TOKEN_FILE`; the tools also accept `VERCEL_PROTECTION_BYPASS_FILE`). It never appears on argv, in the environment, in shell history or in tool output.
- It reaches Vercel only inside the request-body file of the one staging write (`--input <file>`). Every response that echoes the route goes to a mode-600 file (`umask 077`), never the terminal.
- Never use `--verbose`, `--generate`, `-F/-f` fields, `set -x`, `$VC routes list|inspect|export` or the dashboard rule view in a recorded or shared session: they show the condition value. Use `hold-check`, which prints only verdicts.
- The token is also readable by team members while the rule exists. That is acceptable for a one-off random value; delete it after reopening.

**Commands.** Run them from a private directory outside the checkout: `mkdir -m 700 hold && cd hold && umask 077`. Set `VC="npx --yes vercel@66.6.0"`, `P=prj_cSlaoSa0yWsv97kM49lPozo7S3dD`, `S=rugbykritsakorn-9882s-projects`, and `CR=<checkout>/scripts/cutover-rehearsal.mjs`.

```sh
openssl rand -hex 24 > hold.token; export CUTOVER_HOLD_TOKEN_FILE=$PWD/hold.token      # only the path is exported
# 1. Fresh live state (no secrets yet). hold-plan refuses if any staged routes version exists.
$VC api -X GET /v1/projects/$P/routes --scope "$S" > live-routes.json
$VC api -X GET /v1/projects/$P/routes/versions --scope "$S" > versions.json
node $CR hold-plan --stage0 ../stage0.json --routes live-routes.json --versions versions.json --out hold-body.json
#    prints hosts, liveRoutesVersion (= PRE_HOLD, the reopen target), matchesStage0Routes, case count; no token
# 2. The one staging write: structured body from the private file, response kept off the terminal.
$VC api /v1/projects/$P/routes -X POST --input hold-body.json --scope "$S" > add-response.json
$VC api -X GET /v1/projects/$P/routes/versions --scope "$S" > versions-staged.json
STAGED=$(node -e 'const v=require("./versions-staged.json").versions.filter(v=>v.isStaging);if(v.length!==1)process.exit(1);console.log(v[0].id)')
$VC api -X GET "/v1/projects/$P/routes?versionId=$STAGED" --scope "$S" > staged-routes.json
node $CR hold-check --routes staged-routes.json --stage0 ../stage0.json --baseline live-routes.json --other-host <staged-deployment-host>
# 3. Promote exactly that version (an id, not "whatever is staged"), then read back the live routes.
printf '{"id":"%s","action":"promote"}' "$STAGED" | $VC api /v1/projects/$P/routes/versions -X POST --input - --silent --scope "$S"
$VC api -X GET /v1/projects/$P/routes --scope "$S" > live-held.json
node $CR hold-check --routes live-held.json --stage0 ../stage0.json --baseline live-routes.json
node $CR public-smoke --url https://tour.helpgueststay.com --expect-frontend next --expect-clerk live --expect-hold
env -u CUTOVER_HOLD_TOKEN_FILE -u CUTOVER_HOLD_TOKEN -u VERCEL_PROTECTION_BYPASS_FILE -u VERCEL_PROTECTION_BYPASS \
  node "$CR" instagram-probe --url https://tour.helpgueststay.com
```

- **`hold-check`** (offline). It evaluates the routes in order against a fixed matrix:
  - on each production domain, `/`, a tour, `/admin` and the `/api/internal/villa-cache` callback return 503;
  - `/api/instagram/webhook` (with a query) reaches the Convex rewrite, with or without the token;
  - the Instagram exemption is exact: a trailing slash or a suffix is held;
  - the token passes in any header case; a wrong, prefix or empty token is held;
  - the same guest paths on the Preview, immutable, other-project and look-alike hosts are unaffected;
  - the hold is the last route;
  - with `--baseline`, every other route is identical (id, name, enabled, rule).

  Without `--routes` it runs on synthetic data. It **fails closed** on any condition type or value shape it does not model (only `host`/`header` with a string regex or `{eq}`), so an unexpected stored shape stops the cutover instead of passing.
- **Unrelated staged changes.**
  - `hold-plan` refuses when any staged version exists. It also refuses when the routes GET lacks `version.id`, or when that id is not the single `isLive` entry of the versions GET, the documented shapes `{routes, version: {id}}` and `{versions: [{id, isLive, isStaging}]}`. The add then creates our own staged version.
  - Promotion names that version's id.
  - If someone stages a change between the plan and the add, the add merges into their version. The `--baseline` check then fails: **do not promote and do not discard** (discard would drop their change). Remove the hold route from staging and coordinate.
- **Must hold after promotion:**
  - `public-smoke --expect-hold` passes: all checks pass with the token, and each of the four hold-probe paths without it returns 503 with `Retry-After` and no `x-vercel-error`;
  - `instagram-probe` without the token reports `forwardedToConvex: true`;
  - `vercel-settings` shows `findings.maintenanceHold = [{enabled: true, staged: false, status: 503}]`;
  - a Preview's `/rooms/pool-villa` gives its usual protection response (401/redirect to Vercel login) without the hold token, not 503.
- **Side effects while held:** the Convex villa-cache invalidation POST to the production domain gets 503, so Start falls back to its TTL. Crawlers see 503 with `Retry-After`.
- **Reopen (and the hold's rollback).**
  1. First confirm `hold-check --routes <fresh live GET> --baseline live-routes.json` still passes, so nothing else was published meanwhile.
  2. Then `$VC routes restore <PRE_HOLD> --scope "$S"`, which restores the exact pre-hold production version and stages nothing. Read back `GET /v1/projects/$P/routes > live-reopened.json`.
  3. `hold-check --routes live-reopened.json --stage0 ../stage0.json --baseline live-routes.json --reopen` and `vercel-settings --compare ../stage0.json` must show `routes` unchanged and `maintenanceHold: []`.
  4. `public-smoke` must pass without the token.
  5. Then `rm hold.token hold-body.json add-response.json staged-routes.json live-held.json`, keeping the token-free files.

  If restore is refused, `$VC routes remove "Phase 4 maintenance hold" --scope "$S"` stages a removal: promote it by id as in step 3, after a `--baseline … --reopen` check of that staged version.
- **Stage 0 settings restore** (after a full rollback): Stage 0 recorded `snapshot.routesVersion.id`. `vercel-settings --compare stage0.json` must show `routes` and `firewall` unchanged. If they differ and the difference is the cutover's own, `$VC routes restore <stage0 routesVersion.id>` and read back again.
- **Firewall fallback** (if the stored shape fails `hold-check`, or the published hold does not return 503): restore `PRE_HOLD`, then one custom rule: host equals each Stage 0 domain AND path not equal to `/api/instagram/webhook` AND header `x-cutover-hold` not equal to the token → `deny` (403). Under the fallback, `--expect-hold` fails on 403; check that status by hand.
- **Proved vs. not:**
  - Proved offline by unit tests: the matrix (including the identical guest path on another project's Preview and on the staged URL), header confinement, secret-file handling, the redaction, and the staging and baseline guards.
  - Needs the cutover-time write:
    - how Vercel stores the `host`/`header` conditions (the first `hold-check` on `staged-routes.json`);
    - whether `GET ?versionId=` returns the staged rules;
    - Vercel's regex engine on the lookahead, and its host-case normalization (the model lowercases hosts; browsers send lowercase);
    - the 503 body;
    - that `restore` leaves staging untouched.

  Staging alone does not affect traffic.

## 5. Rollback (schema-compatible pair)

1. Publish the §4c hold again (operator token, Instagram exemption).
2. **Frontend:** first confirm that `queued` is empty and automatic domain assignment is off, so no build can re-alias production afterwards. Then move the alias to the **Stage 0 `snapshot.live.id`**, read from the fresh Stage 0 `stage0.json` (at the freeze `dpl_4X95Z9YtScq1mr2P6Gjd1xZ4LSfM` at `c7e07a2256d08c0a7ebff201a1c625b711046692`), not the newest READY deployment. On Hobby, `$VC rollback` only reaches the immediately previous production deployment, so use it only if nothing else was promoted since the cutover; otherwise `$VC alias set <stage0-deployment-url> tour.helpgueststay.com`. Verify the public mapping with `vercel-settings --expect-live <stage0-live-id> --expect-live-sha <stage0-live-sha>`, which must exit 0. This needs no rebuild and no settings change, because the project settings were never edited (historical observation 2026-11-22: framework `nextjs`, pnpm commands; Phase 3 and later revisions override install and build with Bun in `vercel.json`; confirm in the fresh Stage 0 snapshot).
3. **Backend, only if the NEW functions are the problem:** if the chosen OLD is older than Phase 3, first apply the `ordinaryTourCertified` constraint (§4b.4); it does not apply to the Phase 3 merge `c7e07a22`. Then run `vercel-settings --production-env-gate --expected-production-env stage0-production-env.names` (it must exit 0; update the pin first for any change that was deliberate since Stage 0). Then create a production deployment of the OLD SHA, with `START_PRODUCTION` absent (Stage 0). Its `vercel.json` has no `framework`, so the unchanged project preset `nextjs` applies. The Phase 3 OLD installs with Bun and its `vercel-build` always runs `convex deploy --typecheck enable --cmd 'bun run build'` (Next); it cannot build frontend-only. (Historically `6e6a562c` ran `convex deploy --cmd 'pnpm build'`.) Verify that this subsequent OLD build is READY and appears in `staged`, then alias it. `--expect-live <its-id> --expect-live-sha <OLD-sha>` must exit 0.
   - The Start-only NEW SHA has no Next entry and refuses `FRONTEND=next` before any deploy. A Next rebuild uses the dual-entry checkpoint with its own `FRONTEND=next` (per-deployment `--build-env` only) plus `"framework": "nextjs"` in its `vercel.json` (§7). That is a source change, so it is not the emergency path. The rehearsal proves only that the checkpoint's rebuild builds and serves locally against rehearsal data (§3).
4. **Villa invalidation settings:** restore the Stage 0 state of Convex `START_VILLA_INVALIDATION_ORIGIN` and `START_VILLA_INVALIDATION_SECRET`, and of the Vercel `START_VILLA_INVALIDATION_SECRET`, before reopening traffic. Usually that means removing the origin, so the still-deployed NEW backend stops posting to an origin that now serves OLD Next, which has no Start cache endpoint. If Start is promoted again later, start a new cache namespace or expire the affected shared generations, as the contract requires after a restore or import.
5. Run `vercel-settings --compare stage0.json`; it must show no unexpected change. Run `instagram-probe` against the production alias.
6. Run two smoke passes 5 min apart with `CUTOVER_HOLD_TOKEN_FILE` and `--expect-frontend next --expect-hold`. Reopen (§4c) only if both pass with no new scheduler failures; otherwise keep the hold published and retain both exports.

## 6. Reset path (only if a final pair is not schema-compatible)

Follow the rehearsed order in §2 against the verified deployment with `--prod` on every command:

1. Set `ARCH_MONEY_CUTOVER_AT` before the first blocked delivery.
2. Pause providers per the Phase 1 runbook §2.
3. Set `ARCH_RESET_PAUSED=1` and deploy the OLD maintenance copy (`scripts/architecture-maintenance.mjs --old-ref <prod-sha>`).
4. Drain with `maintenance/reset:cancelScheduledPage` (deployment name argument) to 0/0.
5. Export with storage, then restore-verify on an isolated backend.
6. Import the manifest's `clear-old.zip` and confirm the CLI prompt. Do not use `--yes` on production.
7. Deploy NEW paused, run `seedAll` once (a second run is refused), and verify counts.
8. Lift the pause behind the firewall and run the two smoke passes. Then build, promote and reopen as in §4.

Rollback mirrors §2.7 with `clear-new.zip` and the verified OLD export. Restore provider callbacks and Stripe reconciliation per the Phase 1 runbook §5.

## 7. After the Next entry's retirement

The Phase 4 PR carries the retirement as its last commit. Its parent is the **dual-entry checkpoint**: the audited Start-default commit that still ships the Next entry, accepted on Preview before the retirement commit is accepted. It is the first independently buildable ancestor in the PR, and both commits become ordinary main history when the PR merges. No separate tag or PR is involved. The checkpoint was never the public production alias: the verified Stage 0 Next deployment (`dpl_4X95Z9YtScq1mr2P6Gjd1xZ4LSfM`, the Phase 3 merge `c7e07a2256d08c0a7ebff201a1c625b711046692`) stays production until the Phase 4 cutover, which promotes the Start-only head.

`DUAL_ENTRY_CHECKPOINT_SHA` in `scripts/dual-entry-checkpoint.mjs` records the checkpoint as an ordinary full SHA. `verifyCheckpointParent` (run in CI by `tests/unit/dual-entry-checkpoint.test.ts`) finds the single commit in full history that deleted both `src/app/layout.tsx` and `next.config.ts`, and requires its first parent to equal that SHA and to ship both entries.

**Packaging and the final SHA.**
1. Package the PR as two commits: the checkpoint C, then the Start-only commit R, with C as R's first parent.
2. Set `DUAL_ENTRY_CHECKPOINT_SHA` in R to C's full SHA. C precedes R, so R can name it.
3. Any later rebase or amend of C or R changes C's SHA, and the guard then fails until the constant is updated.
4. Merge with a **merge commit** (the repository allows them). A merge commit records no deletion of its own, and full-history search follows the PR side, so R stays the retirement commit and C stays its parent in main's ordinary history.
5. A squash or rebase merge would rewrite or drop C; the guard fails, so do not use one.
6. Later ordinary commits on main do not affect the check.
7. **Release evidence:** the exact shipping revision's Stage E and rehearsal records are not in R. The Phase 4 PR links them by an immutable evidence commit (a full SHA) whose records name R's SHA. Earlier R6 records (`docs/plans/benchmarks/start-only-r6-verification.md`, `start-sentry-r6.md`) are provisional and do not replace them.

The packaged value is the permanent checkpoint C `93b08fd084679fba52431ab2abed0afabcc4abe2`, whose own parent is the Phase 3 merge `c7e07a2256d08c0a7ebff201a1c625b711046692`. The Start-only head refuses `FRONTEND=next` before any deploy, with a git-free message naming Instant Rollback, that SHA and this section.

- **Frontend rollback to Next:** Instant Rollback, or reverse the alias, to the Stage 0 live Next deployment (§5). This needs no rebuild.
- **Next rebuild:** use that revision's own commands.
  - **Dual-entry checkpoint:** `FRONTEND=next` through its `vercel-build`, plus `"framework": "nextjs"` in its `vercel.json`. It is the only Next-capable revision that honors `FRONTEND_ONLY_CONVEX_URL`, so it alone can rebuild Next against the accepted backend without a `convex deploy`.
  - **Phase 3 OLD:** its own Bun `vercel-build` with `START_PRODUCTION` absent always deploys its backend, then builds Next with `bun run build` (§5). Use it only as the backend-plus-frontend rollback.
  - **Historical `6e6a562c`:** pnpm, `convex deploy --cmd 'pnpm build'`.
- **Historic verification:** a historic revision's tools run from a checkout of that revision with its own scripts (`build:next`/`preview:next`, `test:e2e:start`, `bench:routes --check-budgets`, `bench:routes:start`, its parity runner). The Start-only head does not re-implement them.
- **Rehearsal:** `cutover-rehearsal.mjs rehearse --frontends` builds every revision through its own selection (`scripts/frontend-target.mjs` or its absence) and serves it with the matching `preview*` script. It probes NEW's explicit Next rebuild only while NEW still ships Next, and adds an OLD explicit `FRONTEND=next` rebuild whenever OLD ships both entries. The final E rehearsal uses the actual Phase 3 production SHA as OLD and the Start-only head as NEW; OLD rebuilds Next through its own `build`/`preview` with no `START_*` variable.
- **Route inventory:** the parity manifest coverage check and the admin route map read the archived `src/app` tree with git at the recorded SHA (tooling and CI, which fetch full history). `DUAL_ENTRY_CHECKPOINT_REF=<candidate>` substitutes another dual-entry commit for an isolated rehearsal only.
