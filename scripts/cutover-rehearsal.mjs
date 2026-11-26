#!/usr/bin/env node
/**
 * Revision-aware Phase 4 cutover manifest and local forward/rollback rehearsal.
 *   node scripts/cutover-rehearsal.mjs manifest --old <ref> --new <ref> --out <dir>    (offline)
 *   node scripts/heavy.mjs node scripts/cutover-rehearsal.mjs rehearse --old <ref> --new <ref> [--smoke-gap-ms 300000] [--frontends]
 * The rehearsal only launches run-owned convex-local-backend processes bound to 127.0.0.1. Each carries a
 * unique instance name, a fresh instance secret and a blackholed action fetch proxy, so no provider is reachable.
 * It never reads .env files, a cloud deployment, a Vercel project or an alias.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { inspectSchema, schemaSourceReader } from './lib/convex-schema.mjs';
import { convexCachePath } from './local-convex-cache.mjs';
import { createPrivateOutput } from './local-integration-config.mjs';
import { HOLD_HEADER, HOLD_ROUTE_NAME, holdRoute, judgeHold, operatorHeaders, originFetch, planHold, readSecret, smokeUrl } from './lib/operator-access.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sha256 = (/** @type {string | Buffer} */ data) => createHash('sha256').update(data).digest('hex');
const git = (/** @type {string[]} */ args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

// ---------- offline manifest ----------

/** Component schemas are read from the exact installed package, after matching its locked version. */
/** @param {(path: string) => string | undefined} read @param {string} modulesDir */
function componentInventory(read, modulesDir) {
  const config = read('convex/convex.config.ts') ?? '';
  const imports = Object.fromEntries([...config.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+)\/convex\.config(?:\.js)?['"]/g)].map(m => [m[1], m[2]]));
  return [...config.matchAll(/app\.use\((\w+)(?:\s*,\s*\{\s*name:\s*['"](\w+)['"]\s*\})?\)/g)].map(([, binding, alias]) => {
    const pkg = imports[binding];
    if (!pkg) throw new Error(`Unresolved component import: ${binding}`);
    const dir = path.join(modulesDir, pkg);
    const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    const schema = fs.readFileSync(path.join(dir, 'dist/component/schema.js'), 'utf8');
    const tables = inspectSchema(p => p === 'convex/schema.ts' ? schema : undefined).tables.map(t => t.name);
    const defined = fs.readFileSync(path.join(dir, 'dist/component/convex.config.js'), 'utf8').match(/defineComponent\(\s*['"]([^'"]+)/)?.[1];
    const name = alias ?? defined;
    if (!name) throw new Error(`Unnamed component: ${pkg}`);
    return { name, package: pkg, version, tables };
  });
}

/** @param {string} lock @param {string} pkg */
function lockedVersion(lock, pkg) {
  const escaped = pkg.replace(/[/.]/g, m => `\\${m}`);
  return lock.match(new RegExp(`"${escaped}": \\["${escaped}@([^"]+)"`))?.[1] // bun.lock
    ?? lock.match(new RegExp(`\\n  '?${escaped}@([0-9][^(:']*)`))?.[1]; // pnpm-lock.yaml
}

/** @param {string} ref @param {string} [modulesDir] */
export function revisionInventory(ref, modulesDir = path.join(root, 'node_modules')) {
  const sha = git(['rev-parse', `${ref}^{commit}`]);
  const read = schemaSourceReader(root, sha);
  const schema = inspectSchema(read);
  const pkg = JSON.parse(read('package.json') ?? '{}');
  const lockName = read('bun.lock') !== undefined ? 'bun.lock' : 'pnpm-lock.yaml';
  const lock = read(lockName) ?? '';
  const components = componentInventory(read, modulesDir);
  for (const component of components) {
    if (lockedVersion(lock, component.package) !== component.version) throw new Error(`${sha.slice(0, 8)} locks ${component.package}@${lockedVersion(lock, component.package)}, installed ${component.version}; install the matching revision before generating its manifest`);
  }
  const crons = [...(read('convex/crons.ts') ?? '').matchAll(/crons\.\w+\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
  return {
    sha, packageManager: pkg.packageManager, node: pkg.engines?.node, convex: lockedVersion(lock, 'convex'),
    lockfile: { name: lockName, sha256: sha256(lock) }, vercel: JSON.parse(read('vercel.json') ?? '{}'),
    tables: schema.tables.map(t => t.name).sort(), components, crons,
    schemaSources: Object.fromEntries(Object.entries(schema.sources).map(([p, s]) => [p, sha256(s)])),
    maintenanceGate: read('convex/lib/maintenance.ts')?.includes("ARCH_RESET_PAUSED === '1'") ?? false,
    seed: /export const seedAll\b/.test(read('convex/maintenance/seed.ts') ?? '') ? 'maintenance/seed:seedAll {"scenario":"demo-resort"}' : null,
  };
}

/** Empty documents for every root and component table: an exact, side-specific clear snapshot. */
/** @param {string} file @param {{tables: string[], components: {name: string, tables: string[]}[]}} side */
function writeClearZip(file, side) {
  const entries = [...side.tables.map(t => `${t}/documents.jsonl`), ...side.components.flatMap(c => c.tables.map(t => `_components/${c.name}/${t}/documents.jsonl`))];
  execFileSync('python3', ['-I', '-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n in sys.argv[2:]: z.writestr(zipfile.ZipInfo(n,(1980,1,1,0,0,0)),"")', file, ...entries]);
  return { file: path.basename(file), entries: entries.length, sha256: sha256(fs.readFileSync(file)) };
}

/** @param {{old: string, new: string, out: string, oldModules?: string, newModules?: string}} options */
export function buildManifest(options) {
  fs.mkdirSync(options.out, { recursive: true, mode: 0o700 });
  const old = revisionInventory(options.old, options.oldModules), next = revisionInventory(options.new, options.newModules);
  const sources = new Set([...Object.keys(old.schemaSources), ...Object.keys(next.schemaSources)]);
  const manifest = {
    generatedAt: new Date().toISOString(), old, new: next,
    schema: {
      sourcesIdentical: [...sources].every(p => old.schemaSources[p] === next.schemaSources[p]),
      tablesAdded: next.tables.filter(t => !old.tables.includes(t)), tablesRemoved: old.tables.filter(t => !next.tables.includes(t)),
      componentsIdentical: JSON.stringify(old.components) === JSON.stringify(next.components),
    },
    artifacts: { clearOld: writeClearZip(path.join(options.out, 'clear-old.zip'), old), clearNew: writeClearZip(path.join(options.out, 'clear-new.zip'), next) },
  };
  if (!old.maintenanceGate || !next.maintenanceGate) throw new Error('Both revisions need the ARCH_RESET_PAUSED maintenance gate');
  if (!next.seed) throw new Error('NEW revision has no maintenance/seed:seedAll');
  fs.writeFileSync(path.join(options.out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return manifest;
}

// ---------- read-only Vercel project settings ----------

const BUILDING_STATES = new Set(['QUEUED', 'INITIALIZING', 'BUILDING']);
/** @typedef {{id: string, sha: string | null, state: string, created: number}} DeploymentBrief */

/**
 * Pure and fail-closed: the deployment that actually serves production, derived from the project's verified production
 * domains and each domain's alias. Never "the newest READY production deployment", which can be a staged build with no
 * alias. Other production deployments are reported separately as staged (READY, newer, unaliased), previous (READY, older:
 * rollback candidates) and queued (still building).
 * @param {{projectId: string, domains: any, aliases: Record<string, any>, deployments: Record<string, any>, list: any}} raw
 * @returns {{id: string, sha: string, url: string, domains: string[], created: number, staged: DeploymentBrief[], previous: DeploymentBrief[], queued: DeploymentBrief[]}}
 */
export function liveProduction(raw) {
  const domains = (raw.domains?.domains ?? [])
    .filter((/** @type {any} */ d) => d.verified === true && !d.redirect && !d.gitBranch && !d.customEnvironmentId && (!d.projectId || d.projectId === raw.projectId))
    .map((/** @type {any} */ d) => String(d.name)).sort();
  if (!raw.projectId || domains.length === 0) throw new Error('No verified production domain for the project: refusing to infer the live deployment');
  const mapped = domains.map((/** @type {string} */ domain) => {
    const alias = raw.aliases[domain];
    if (!alias?.deploymentId || alias.alias !== domain) throw new Error(`No alias evidence for ${domain}`);
    if (alias.projectId !== raw.projectId) throw new Error(`${domain} is aliased to another project (${alias.projectId})`);
    return { domain, deploymentId: String(alias.deploymentId) };
  });
  const ids = [...new Set(mapped.map((/** @type {{deploymentId: string}} */ m) => m.deploymentId))];
  if (ids.length !== 1) throw new Error(`Production domains map to different deployments: ${JSON.stringify(mapped)}`);
  const deployment = raw.deployments[ids[0]];
  if (!deployment || deployment.id !== ids[0] || deployment.projectId !== raw.projectId) throw new Error(`Live deployment ${ids[0]} is missing or belongs to another project`);
  if (deployment.readyState !== 'READY' || deployment.target !== 'production') throw new Error(`Live deployment ${ids[0]} is ${deployment.readyState}/${deployment.target}, not READY production`);
  const sha = deployment.meta?.githubCommitSha ?? deployment.meta?.gitCommitSha;
  if (!sha) throw new Error(`Live deployment ${ids[0]} has no commit SHA`);
  const created = Number(deployment.createdAt ?? deployment.created);
  if (!(raw.list?.deployments ?? []).some((/** @type {any} */ d) => d.uid === ids[0])) throw new Error(`Live deployment ${ids[0]} is missing from the production inventory`);
  const others = (raw.list?.deployments ?? []).filter((/** @type {any} */ d) => d.uid !== ids[0] && d.target === 'production');
  const brief = (/** @type {any} */ d) => /** @type {DeploymentBrief} */ ({ id: d.uid, sha: d.meta?.githubCommitSha ?? d.meta?.gitCommitSha ?? null, state: d.readyState ?? d.state, created: d.created });
  const ready = others.filter((/** @type {any} */ d) => (d.readyState ?? d.state) === 'READY');
  return {
    id: ids[0], sha, url: deployment.url, domains, created,
    staged: ready.filter((/** @type {any} */ d) => d.created > created).map(brief),
    previous: ready.filter((/** @type {any} */ d) => d.created <= created).map(brief),
    queued: others.filter((/** @type {any} */ d) => BUILDING_STATES.has(d.readyState ?? d.state)).map(brief),
  };
}

/**
 * Pure: reduce raw Vercel API responses to the cutover-relevant settings. Env values, protection-bypass secrets and
 * tokens are dropped here, before anything is written or printed.
 * @param {{project: any, routes: any, firewall: any, domains: any, aliases: Record<string, any>, deployments: Record<string, any>, list: any, envList?: any, sharedEnv?: any}} raw
 */
export function vercelSnapshot(raw) {
  const { project, routes, firewall } = raw;
  const envInventory = envInventoryState(project.env);
  const live = liveProduction({ projectId: project.id, domains: raw.domains, aliases: raw.aliases, deployments: raw.deployments, list: raw.list });
  return {
    project: {
      id: project.id, framework: project.framework ?? null, buildCommand: project.buildCommand ?? null, installCommand: project.installCommand ?? null,
      outputDirectory: project.outputDirectory ?? null, nodeVersion: project.nodeVersion ?? null, rootDirectory: project.rootDirectory ?? null,
      autoAssignCustomDomains: project.autoAssignCustomDomains ?? null, regions: project.resourceConfig?.functionDefaultRegions ?? null,
      // Vercel returns `target` as an array (or a single string); names and targets only, never values.
      env: (envInventory === 'ok' ? project.env : []).map((/** @type {any} */ e) => `${e.key}@${[e.target ?? []].flat().sort().join(',')}`).sort(),
    },
    // Outside `project`, so `--compare` against older snapshots is unaffected. Anything but 'ok' means `project.env`
    // above is not evidence of absence.
    envInventory,
    // Independent per-target inventories, names only: the project env endpoint and the team shared variables linked
    // to this project. Each is 'ok' only when it is complete (no hidden production entries, no further page).
    productionEnv: productionEnvInventories(project, raw.envList, raw.sharedEnv),
    // Conditions keep type and key only: the hold's `missing` header value is the operator token.
    // Stage 0 records the live routes version: the `restore` target for the hold's fallback rollback.
    routesVersion: routes.version ? { id: routes.version.id ?? null, ruleCount: routes.version.ruleCount ?? null } : null,
    routes: (routes.routes ?? []).map((/** @type {any} */ r) => ({ name: r.name, enabled: r.enabled, staged: r.staged, type: r.routeType, src: r.route?.src, dest: r.route?.dest,
      ...(r.route?.status !== undefined && { status: r.route.status }),
      ...((r.route?.has || r.route?.missing) && { conditions: [...(r.route.has ?? []).map((/** @type {any} */ c) => `has ${c.type}:${c.key ?? ''}`), ...(r.route.missing ?? []).map((/** @type {any} */ c) => `missing ${c.type}:${c.key ?? ''}`)] }) })),
    firewall: { enabled: firewall.firewallEnabled ?? null, rules: (firewall.rules ?? []).map((/** @type {any} */ r) => ({ name: r.name, active: r.active, action: r.action?.mitigate?.action ?? null })) },
    live,
    inventory: raw.list?.inventory ?? null,
  };
}

/**
 * Pure: whether the project API returned a usable env inventory: an array of entries with a string `key` and a
 * `target` that is a string, an array of strings, or absent (custom-environment-only). Never inspects values.
 * @param {unknown} env @returns {'ok' | 'missing' | 'malformed'}
 */
export function envInventoryState(env) {
  if (env === undefined || env === null) return 'missing';
  if (!Array.isArray(env)) return 'malformed';
  const targetOk = (/** @type {unknown} */ t) => t === undefined || t === null || typeof t === 'string' || (Array.isArray(t) && t.every(x => typeof x === 'string'));
  return env.every(e => e && typeof e === 'object' && typeof e.key === 'string' && targetOk(e.target)) ? 'ok' : 'malformed';
}

/** Frontend selectors that must not be set for the production target in project or shared env (per-deployment only). */
export const FORBIDDEN_PRODUCTION_ENV = ['FRONTEND', 'FRONTEND_ONLY_CONVEX_URL', 'START_PRODUCTION', 'START_PREVIEW', 'START_SSR_RUNTIME'];

const appliesToProduction = (/** @type {any} */ e) => [e.target ?? []].flat().includes('production');

/**
 * Pure: names-only production env from three sources. `embedded` is `project.env` from the project GET; `list` is
 * `GET /v10/projects/<id>/env` ({envs, hiddenProductionEnvCount} or {envs, pagination}); `shared` is
 * `GET /v1/env?projectId=<id>` ({data, pagination}), keeping entries whose `projectId` links this project.
 * @param {any} project @param {any} list @param {any} shared
 */
export function productionEnvInventories(project, list, shared) {
  /** @param {any} rows @param {string | null} problem */
  const result = (rows, problem) => problem ? { state: problem, names: [] }
    : { state: 'ok', names: [...new Set(rows.filter(appliesToProduction).map((/** @type {any} */ e) => e.key))].sort() };
  const embedded = envInventoryState(project.env) === 'ok' ? result(project.env, null) : result(null, envInventoryState(project.env));
  const listProblem = list === undefined || list === null ? 'unavailable' : envInventoryState(list.envs) !== 'ok' ? envInventoryState(list.envs)
    : list.hiddenProductionEnvCount ? `hidden production entries (${list.hiddenProductionEnvCount})` : list.pagination?.next ? 'paginated (unsupported)' : null;
  const sharedProblem = shared === undefined || shared === null ? 'unavailable' : envInventoryState(shared.data) !== 'ok' ? envInventoryState(shared.data)
    : shared.pagination?.next ? 'paginated (unsupported)' : shared.data.some((/** @type {any} */ e) => !Array.isArray(e.projectId)) ? 'malformed' : null;
  return {
    embedded,
    list: listProblem ? result(null, listProblem) : result(list.envs, null),
    shared: sharedProblem ? result(null, sharedProblem) : result(shared.data.filter((/** @type {any} */ e) => e.projectId.includes(project.id)), null),
  };
}

/**
 * Pure: the production env gate (`--forbid-start-production`, also `--production-env-gate`), for Stage 0 and the OLD
 * backend rebuild. Fails closed unless every inventory is complete and the two project inventories agree; then
 * requires the frontend selectors absent from production (project and linked shared). `expected` (names-only pin)
 * additionally requires the exact production name set. Other names, e.g. START_VILLA_INVALIDATION_*, are allowed.
 * @param {any} snap @param {string[] | null} expected @returns {{ok: boolean, failures: string[]}}
 */
export function productionEnvGate(snap, expected = null) {
  const failures = [];
  const inv = snap.productionEnv;
  if (snap.envInventory !== 'ok') failures.push(`env inventory ${snap.envInventory ?? 'missing'}: cannot prove START_PRODUCTION is absent from production`);
  for (const source of ['embedded', 'list', 'shared']) {
    if (inv?.[source]?.state !== 'ok') failures.push(`${source} production env inventory ${inv?.[source]?.state ?? 'missing'}: cannot prove the frontend selectors are absent`);
  }
  if (failures.length) return { ok: false, failures };
  if (JSON.stringify(inv.embedded.names) !== JSON.stringify(inv.list.names)) {
    const a = new Set(inv.embedded.names), b = new Set(inv.list.names);
    failures.push(`project env inventories disagree (only embedded: ${[...a].filter(n => !b.has(n)).join(', ') || '-'}; only listed: ${[...b].filter(n => !a.has(n)).join(', ') || '-'})`);
  }
  const all = [...new Set([...inv.list.names, ...inv.shared.names])].sort();
  for (const name of FORBIDDEN_PRODUCTION_ENV) {
    if (all.includes(name)) failures.push(`${name} applies to production${inv.shared.names.includes(name) ? ' (linked shared variable)' : ''}: remove it before this step (use a per-deployment --build-env instead)`);
  }
  if (expected) {
    const want = new Set(expected), extra = all.filter(n => !want.has(n)), missing = [...want].filter(n => !all.includes(n)).sort();
    if (extra.length || missing.length) failures.push(`production env names differ from the pinned list (unexpected: ${extra.join(', ') || '-'}; missing: ${missing.join(', ') || '-'})`);
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Pure: the opt-in `--forbid-start-production` gate. It fails closed when the env inventory is missing or malformed,
 * because an empty list would otherwise read as "START_PRODUCTION absent".
 * @param {{envInventory?: string, project: {env: string[]}}} snap @returns {{ok: boolean, reason?: string}}
 */
export function startProductionGate(snap) {
  if (snap.envInventory !== 'ok') return { ok: false, reason: `env inventory ${snap.envInventory ?? 'missing'}: cannot prove START_PRODUCTION is absent from production` };
  const hits = startProductionInProduction(snap);
  return hits.length ? { ok: false, reason: `START_PRODUCTION applies to production (${hits.join('; ')}): remove it before this step` } : { ok: true };
}

/**
 * Pure: `START_PRODUCTION` entries that apply to the production target, including multi-target variables
 * (`START_PRODUCTION@preview,production`). Preview- or development-only entries are ignored.
 * @param {{project: {env: string[]}}} snap @returns {string[]}
 */
export function startProductionInProduction(snap) {
  return snap.project.env.filter(entry => {
    const at = entry.lastIndexOf('@');
    return entry.slice(0, at) === 'START_PRODUCTION' && entry.slice(at + 1).split(',').includes('production');
  });
}

/**
 * Pure: expectations for a cutover from OLD to NEW. `vercel.json` at each SHA overrides the project setting it names.
 * @param {ReturnType<typeof vercelSnapshot>} snap @param {Record<'old' | 'new', {sha: string, vercel: any, node?: string}>} sides
 */
export function vercelFindings(snap, sides) {
  const effective = (/** @type {any} */ vercel) => ({
    framework: 'framework' in vercel ? (vercel.framework ?? 'other') : snap.project.framework,
    buildCommand: vercel.buildCommand ?? snap.project.buildCommand, installCommand: vercel.installCommand ?? snap.project.installCommand,
  });
  const instagram = snap.routes.find((/** @type {any} */ r) => r.src === '^/api/instagram/webhook$');
  const frontendEnv = snap.project.env.filter((/** @type {string} */ e) => /^(FRONTEND|FRONTEND_ONLY_CONVEX_URL|START_PRODUCTION|START_PREVIEW|START_SSR_RUNTIME)@/.test(e));
  return {
    effective: { old: effective(sides.old.vercel), new: effective(sides.new.vercel) },
    productionIsOld: snap.live.sha === sides.old.sha,
    unaliasedProductionBuilds: { staged: snap.live.staged.map(d => d.id), queued: snap.live.queued.map(d => d.id) },
    instagramRewrite: instagram ? { ok: Boolean(instagram.enabled && !instagram.staged && instagram.type === 'rewrite'), dest: instagram.dest, projectLevel: true } : { ok: false },
    frontendEnv,
    startProductionInProduction: startProductionInProduction(snap),
    autoPromoteRisk: snap.project.autoAssignCustomDomains === true && effective(sides.new.vercel).framework === 'other' && !frontendEnv.some((/** @type {string} */ e) => e.startsWith('FRONTEND@') || e.startsWith('FRONTEND_ONLY_CONVEX_URL@')),
    node: { project: snap.project.nodeVersion, engines: { old: sides.old.node ?? null, new: sides.new.node ?? null } },
    firewallRules: snap.firewall.rules.length,
    // Must be absent at Stage 0 and after reopening; present (enabled, not staged) only while the hold is published.
    maintenanceHold: snap.routes.filter((/** @type {any} */ r) => r.name === HOLD_ROUTE_NAME).map((/** @type {any} */ r) => ({ enabled: r.enabled, staged: r.staged, status: r.status ?? null })),
  };
}

/**
 * Pure: follow Vercel list pagination (`pagination.next`, sent back as `until`) until `next` is null. Fails closed on a
 * repeated or non-advancing cursor, an empty page that still claims a next page, or more than `maxPages` (truncation).
 * Every page must carry an explicit `pagination.next` (a number, or `null` on the terminal page); a missing pagination
 * object or cursor is refused rather than read as the end. A terminal page may be shorter than `limit`; no page may exceed it.
 * @param {(until: number | null) => any} getPage @param {{key: string, maxPages: number, limit: number}} o
 */
export function collectPages(getPage, o) {
  /** @type {any[]} */ const items = [];
  /** @type {Set<number>} */ const seen = new Set();
  /** @type {number | null} */ let cursor = null;
  for (let pages = 1; ; pages++) {
    const body = getPage(cursor), batch = body?.[o.key];
    if (!Array.isArray(batch)) throw new Error(`${o.key} page has no ${o.key} list`);
    if (batch.length > o.limit) throw new Error(`${o.key} page returned ${batch.length} items, more than the requested ${o.limit}`);
    items.push(...batch);
    const pagination = body.pagination;
    if (!pagination || typeof pagination !== 'object' || !Object.hasOwn(pagination, 'next')) throw new Error(`${o.key} page has no explicit pagination cursor`);
    const next = pagination.next;
    if (next === null) return { items, pages };
    if (batch.length === 0) throw new Error(`${o.key} page was empty but reported another page`);
    if (typeof next !== 'number' || seen.has(next) || (cursor !== null && next >= cursor)) throw new Error(`${o.key} pagination cursor did not advance`);
    if (pages >= o.maxPages) throw new Error(`${o.key} inventory truncated after ${o.maxPages} pages`);
    seen.add(next); cursor = next;
  }
}

const MAX_PRODUCTION_DOMAINS = 20; // one alias GET and at most one deployment GET each

/**
 * GET-only reader with an injectable `get(endpoint)`, so pagination and fail-closed rules are testable offline.
 * Production domains and this project's production deployments are both read to the terminal cursor: a slow build
 * created before the live deployment, or a rollback, can leave an active build on an older page. Every listed deployment
 * must be a production deployment of this project.
 * @param {(endpoint: string) => any} get @param {{project: string}} o
 */
export function readVercelWith(get, o) {
  const project = get(`/v9/projects/${encodeURIComponent(o.project)}`);
  if (!project?.id) throw new Error('Vercel project not found');
  const domainList = collectPages(until => get(`/v9/projects/${project.id}/domains?production=true&limit=50${until === null ? '' : `&until=${until}`}`), { key: 'domains', maxPages: 10, limit: 50 });
  const domains = { domains: domainList.items };
  const qualifying = domainList.items.filter((/** @type {any} */ d) => d.verified === true && !d.redirect && !d.gitBranch && !d.customEnvironmentId);
  if (qualifying.length > MAX_PRODUCTION_DOMAINS) throw new Error(`More than ${MAX_PRODUCTION_DOMAINS} production domains: refusing unbounded alias lookups`);
  /** @type {Record<string, any>} */ const aliases = {};
  /** @type {Record<string, any>} */ const deployments = {};
  for (const domain of qualifying) {
    const alias = get(`/v4/aliases/${encodeURIComponent(domain.name)}?projectId=${project.id}`);
    aliases[domain.name] = alias;
    if (alias.deploymentId && !deployments[alias.deploymentId]) deployments[alias.deploymentId] = get(`/v13/deployments/${encodeURIComponent(alias.deploymentId)}`);
  }
  const inventory = collectPages(until => get(`/v6/deployments?projectId=${project.id}&target=production&limit=100${until === null ? '' : `&until=${until}`}`),
    { key: 'deployments', maxPages: 10, limit: 100 });
  for (const d of inventory.items) {
    if (d.target !== 'production' || (d.projectId && d.projectId !== project.id)) throw new Error(`Deployment inventory returned ${d.uid} outside production of this project`);
  }
  // Independent env inventories; a failed read is recorded as unavailable (the gate then fails closed), so the
  // diagnostic snapshot still completes.
  const attempt = (/** @type {string} */ endpoint) => { try { return get(endpoint); } catch { return null; } };
  return vercelSnapshot({ project, domains, aliases, deployments, routes: get(`/v1/projects/${project.id}/routes`), firewall: get(`/v1/security/firewall/config/active?projectId=${project.id}`),
    envList: attempt(`/v10/projects/${project.id}/env`), sharedEnv: attempt(`/v1/env?projectId=${project.id}`),
    list: { deployments: inventory.items, inventory: { domainPages: domainList.pages, deploymentPages: inventory.pages, deployments: inventory.items.length } } });
}

/** GET-only: `vercel api -X GET` with the operator's existing CLI login. @param {{project: string, scope: string}} o */
function readVercel(o) {
  return readVercelWith(endpoint => {
    const result = spawnSync('npx', ['--yes', 'vercel@66.6.0', 'api', '-X', 'GET', endpoint, '--scope', o.scope], { cwd: tmpdir(), encoding: 'utf8', maxBuffer: 1 << 26 }); // outside the checkout: no vercel.json/.env pickup
    const text = result.stdout.includes('{') ? result.stdout : result.stderr; // the CLI prints JSON to stdout, notices to stderr
    if (result.status !== 0 || !text.includes('{')) throw new Error(`vercel api GET ${endpoint.split('?')[0]} failed (${result.status})`);
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  }, o);
}

/**
 * GET-only proof that a deployment still forwards the project-level Instagram rewrite to Convex: a random verify token
 * must get Convex's `403 Forbidden` (the Meta challenge handler), not a frontend 404/200. The rewrite targets the production
 * Convex site even from a Preview, so this sends one unauthenticated read that the backend rejects; it never POSTs.
 * @param {string} base @param {Record<string, string>} headers operator headers (`operatorHeaders()`), sent to `base` only, never printed
 */
export async function instagramRewriteProbe(base, headers = {}) {
  const url = new URL('/api/instagram/webhook', base);
  url.search = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': randomBytes(16).toString('hex'), 'hub.challenge': randomBytes(8).toString('hex') }).toString();
  const response = await originFetch(base, url, headers);
  const body = (await response.text()).slice(0, 200);
  // x-vercel-error (e.g. GONE for a removed deployment, NOT_FOUND) means the platform answered before any route ran: inconclusive, not a rewrite failure.
  const platformError = response.headers.get('x-vercel-error');
  return { status: response.status, forwardedToConvex: !platformError && response.status === 403 && body.trim() === 'Forbidden', platformError, server: response.headers.get('server') };
}

/** Anonymous GET-only checks for the operator smoke. Real-session checks (owner, cashier, booking) stay manual. */
export const PUBLIC_SMOKE = [
  { name: 'home', path: '/', status: 200 },
  { name: 'room', path: '/rooms/pool-villa', status: 200 },
  { name: 'tour', path: '/rooms/pool-villa?tour=1', status: 200 },
  { name: 'room-th', path: '/th/rooms/pool-villa', status: 200, lang: 'th' },
  { name: 'unknown-villa', path: '/rooms/__smoke-missing-villa__', status: 404 },
  { name: 'admin-signed-out', path: '/admin', maxStatus: 499 },
  { name: 'robots', path: '/robots.txt', status: 200 },
  { name: 'sitemap', path: '/sitemap.xml', status: 200 },
];

/**
 * Pure: judge one anonymous pass. `observed` maps check name → { status, html?, poweredBy? }.
 * @param {Record<string, {status: number, html?: string, poweredBy?: string | null}>} observed
 * @param {{frontend?: 'start' | 'next', clerk?: 'live' | 'test'}} expect
 */
export function judgePublicSmoke(observed, expect = {}) {
  const failures = [];
  for (const check of PUBLIC_SMOKE) {
    const o = observed[check.name];
    if (!o) { failures.push(`${check.name}: not observed`); continue; }
    if (check.status !== undefined && o.status !== check.status) failures.push(`${check.name}: ${o.status} ≠ ${check.status}`);
    if (check.maxStatus !== undefined && !(o.status >= 200 && o.status <= check.maxStatus)) failures.push(`${check.name}: ${o.status}`);
    if (check.lang && !new RegExp(`<html[^>]*lang="${check.lang}`).test(o.html ?? '')) failures.push(`${check.name}: lang ≠ ${check.lang}`);
  }
  const room = observed.room ?? {};
  const frontend = /next\.js/i.test(room.poweredBy ?? '') || /\/_next\/static\//.test(room.html ?? '') ? 'next' : /\$_TSR|__TSR|\/assets\/[^"']+\.js/.test(room.html ?? '') ? 'start' : 'unknown';
  const clerk = /pk_live_/.test(room.html ?? '') ? 'live' : /pk_test_/.test(room.html ?? '') ? 'test' : 'none';
  if (expect.frontend && frontend !== expect.frontend) failures.push(`frontend: ${frontend} ≠ ${expect.frontend}`);
  if (expect.clerk && clerk !== expect.clerk) failures.push(`clerk: ${clerk} ≠ ${expect.clerk}`);
  if (observed.instagram && !(observed.instagram.status === 403 && (observed.instagram.html ?? '').trim() === 'Forbidden')) failures.push(`instagram: ${observed.instagram.status}`);
  return { ok: failures.length === 0, frontend, clerk, failures };
}

/** @param {string} base @param {Record<string, string>} headers operator headers, confined to `base` by `originFetch` */
async function observePublicSmoke(base, headers) {
  /** @type {Record<string, {status: number, html?: string, poweredBy?: string | null}>} */ const observed = {};
  for (const check of PUBLIC_SMOKE) {
    const response = await originFetch(base, check.path, headers);
    observed[check.name] = { status: response.status, html: (await response.text()).slice(0, 400_000), poweredBy: response.headers.get('x-powered-by') };
  }
  const instagram = await instagramRewriteProbe(base, headers);
  observed.instagram = { status: instagram.status, html: instagram.forwardedToConvex ? 'Forbidden' : '' };
  return observed;
}

/** GET-only paths that must get the hold's 503 when sent without the hold header. */
export const HOLD_PROBE_PATHS = ['/', '/rooms/pool-villa?tour=1', '/admin', '/api/internal/villa-cache'];

/**
 * Anonymous hold probe: each path without the hold header (the protection bypass, if any, is still sent, so a 503 is
 * the route's and not deployment protection's). GET only, redirects not followed.
 * @param {string} base @param {Record<string, string>} headers
 */
async function observeHold(base, headers) {
  const withoutHold = Object.fromEntries(Object.entries(headers).filter(([name]) => name !== HOLD_HEADER));
  /** @type {Record<string, {status: number, retryAfter: string | null, platformError: string | null}>} */ const observed = {};
  for (const p of HOLD_PROBE_PATHS) {
    const response = await originFetch(base, p, withoutHold);
    await response.body?.cancel();
    observed[p] = { status: response.status, retryAfter: response.headers.get('retry-after'), platformError: response.headers.get('x-vercel-error') };
  }
  return observed;
}

/** Pure. @param {Record<string, {status: number, retryAfter: string | null, platformError: string | null}>} hold */
export function judgeHoldProbe(hold) {
  return HOLD_PROBE_PATHS.flatMap(p => {
    const o = hold[p];
    if (!o) return [`hold ${p}: not observed`];
    if (o.status !== 503 || o.platformError) return [`hold ${p}: ${o.status}${o.platformError ? ` (${o.platformError})` : ''} without the hold header, not the route's 503`];
    return o.retryAfter ? [] : [`hold ${p}: 503 without Retry-After`];
  });
}

// ---------- certify verdicts ----------

/** The Convex CLI's own marker for a push its schema validator rejected. */
const SCHEMA_VALIDATION_FAILED = /^✖ Schema validation failed\.$/m;
/** The validator's per-document line: table, then the reason. */
const SCHEMA_DOCUMENT = /^Document with ID "[^"\n]+" in table "(\w+)" does not match the schema: (.+)$/m;
/** Reasons that name one field, in the validator's own wording. */
const SCHEMA_FIELD = [
  /^Object contains extra field `(\w+)` that is not in the validator\./,
  /^Object is missing the required field `(\w+)`/,
];

/**
 * Pure: the certify verdict for one target deploy onto restored data. Only a recognized native schema-validation
 * failure, with the table and field it names, is `refused`. Anything else that failed (backend unreachable, process
 * killed, CLI or deploy error, or a validation failure without table/field evidence) is `inconclusive`: it says nothing
 * about compatibility and must not lead to a reset. Only the table, field and a fixed reason category are returned;
 * the CLI output itself stays in the private log.
 * @param {number | null} code CLI exit code (null: killed or never ran) @param {string} output full CLI output
 * @returns {{result: 'accepted'} | {result: 'refused', table: string, field: string, evidence: 'native schema validation'} | {result: 'inconclusive', reason: string}}
 */
export function classifyDeploy(code, output) {
  if (code === null) return { result: 'inconclusive', reason: 'deploy process did not exit normally' };
  if (code === 0 && !SCHEMA_VALIDATION_FAILED.test(output)) return { result: 'accepted' };
  if (code === 0) return { result: 'inconclusive', reason: 'deploy exited 0 but reported a schema validation failure' };
  if (!SCHEMA_VALIDATION_FAILED.test(output)) return { result: 'inconclusive', reason: 'deploy failed without a native schema validation failure' };
  const document = output.match(SCHEMA_DOCUMENT);
  const field = document && SCHEMA_FIELD.map(re => document[2].match(re)?.[1]).find(Boolean);
  if (!document || !field) return { result: 'inconclusive', reason: 'schema validation failed without table and field evidence' };
  return { result: 'refused', table: document[1], field, evidence: 'native schema validation' };
}

// ---------- snapshot inspection ----------

/** Per-table canonical digests (documents sorted by _id), storage blob hashes and dangling *Id references. */
/** @param {string} zip @returns {{tables: Record<string, {count: number, sha256: string}>, blobs: Record<string, string>, dangling: string[]}} */
export function summarizeSnapshot(zip) {
  return JSON.parse(execFileSync('python3', ['-I', '-c', `
import hashlib,json,re,sys,zipfile
z=zipfile.ZipFile(sys.argv[1]); tables={}; blobs={}; ids=set(); docs=[]
for n in z.namelist():
  if n.endswith('/documents.jsonl') and not n.split('/')[-2].startswith('_tables'):
    rows=[json.loads(l) for l in z.read(n).decode().splitlines() if l.strip()]
    rows.sort(key=lambda r:r.get('_id',''))
    canon='\\n'.join(json.dumps(r,sort_keys=True,separators=(',',':')) for r in rows)
    tables[n[:-len('/documents.jsonl')]]={'count':len(rows),'sha256':hashlib.sha256(canon.encode()).hexdigest()}
    ids.update(r['_id'] for r in rows if '_id' in r); docs+=[(n,r) for r in rows]
  elif re.match(r'^(_components/[^/]+/)?_storage/[^/]+$',n) and not n.endswith('.jsonl'):
    blobs[n]=hashlib.sha256(z.read(n)).hexdigest()
idre=re.compile(r'^[0-9a-z]{31,37}$'); dangling=[]
def walk(t,k,v):
  if isinstance(v,dict): [walk(t,kk,vv) for kk,vv in v.items()]
  elif isinstance(v,list): [walk(t,k,x) for x in v]
  elif isinstance(v,str) and k and re.search(r'Ids?$',k) and idre.match(v) and v not in ids: dangling.append(t+'.'+k)
for n,r in docs: [walk(n.split('/')[-2],k,v) for k,v in r.items() if not k.startswith('_')]
print(json.dumps({'tables':tables,'blobs':blobs,'dangling':sorted(set(dangling))}))
`, zip], { encoding: 'utf8', maxBuffer: 1 << 28 }));
}

/** @param {ReturnType<typeof summarizeSnapshot>} a @param {ReturnType<typeof summarizeSnapshot>} b */
export function compareSnapshots(a, b) {
  const differences = [];
  for (const name of new Set([...Object.keys(a.tables), ...Object.keys(b.tables)])) {
    if (a.tables[name]?.sha256 !== b.tables[name]?.sha256 && (a.tables[name]?.count || b.tables[name]?.count)) differences.push(name);
  }
  for (const name of new Set([...Object.keys(a.blobs), ...Object.keys(b.blobs)])) if (a.blobs[name] !== b.blobs[name]) differences.push(name);
  return differences;
}

const nonEmpty = (/** @type {ReturnType<typeof summarizeSnapshot>} */ s, includeStorage = false) =>
  Object.entries(s.tables).filter(([n, t]) => t.count && (includeStorage || !/(^|\/)_storage$/.test(n))).map(([n, t]) => `${n}=${t.count}`);

// ---------- local rehearsal ----------

const args = process.argv.slice(2);
const flag = (/** @type {string} */ name, /** @type {string | undefined} */ fallback = undefined) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;

async function rehearse() {
  process.umask(0o077);
  const gap = Number(flag('--smoke-gap-ms', '300000'));
  const runId = `r${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(3).toString('hex')}`;
  const mode = args[0] === 'certify' ? 'certify' : 'rehearse';
  const work = path.join(root, 'output', mode === 'certify' ? 'cutover-certificate' : 'cutover-rehearsal', runId);
  fs.mkdirSync(work, { recursive: true, mode: 0o700 });
  const home = path.join(work, 'home');
  fs.mkdirSync(home, { mode: 0o700 });
  const report = /** @type {Record<string, any>} */ ({ runId, startedAt: new Date().toISOString(), node: process.version, steps: /** @type {any[]} */ ([]) });
  const secrets = /** @type {string[]} */ ([]);
  const log = fs.openSync(path.join(work, 'rehearsal.log'), 'a', 0o600);
  const say = (/** @type {string} */ line) => {
    const out = createPrivateOutput(text => { process.stdout.write(text); fs.writeSync(log, text); }, secrets);
    out.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`); out.end();
  };
  /** @template T @param {string} name @param {() => Promise<T>} fn @returns {Promise<T>} */
  async function step(name, fn) {
    const started = Date.now();
    say(`▶ ${name}`);
    try {
      const details = await fn();
      report.steps.push({ name, ok: true, ms: Date.now() - started, details });
      say(`✔ ${name}${details === undefined ? '' : ` ${JSON.stringify(details).slice(0, 400)}`}`);
      return details;
    } catch (error) {
      report.steps.push({ name, ok: false, ms: Date.now() - started, error: String(/** @type {any} */ (error)?.message ?? error) });
      throw error;
    }
  }
  const writeReport = () => fs.writeFileSync(path.join(work, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });

  /** @param {string} command @param {string[]} argv @param {{cwd?: string, env?: Record<string, string>, logName?: string, allowFail?: boolean}} [o] */
  function run(command, argv, o = {}) {
    return /** @type {Promise<{code: number | null, output: string}>} */ (new Promise((resolve, reject) => {
      const fd = fs.openSync(path.join(work, o.logName ?? 'commands.log'), 'a', 0o600);
      fs.writeSync(fd, `\n$ ${command} ${argv.join(' ')}\n`);
      const child = /** @type {import('node:child_process').ChildProcessByStdio<null, import('node:stream').Readable, import('node:stream').Readable>} */ (spawn(command, argv, { cwd: o.cwd ?? root, env: /** @type {NodeJS.ProcessEnv} */ (o.env ?? baseEnv), stdio: ['ignore', 'pipe', 'pipe'] }));
      let output = '';
      for (const stream of [child.stdout, child.stderr]) stream.on('data', (/** @type {Buffer} */ chunk) => { output += chunk; fs.writeSync(fd, chunk); });
      child.once('error', reject);
      child.once('close', (/** @type {number | null} */ code) => {
        fs.closeSync(fd);
        if (code === 0 || o.allowFail) resolve({ code, output });
        else {
          let tail = ''; const out = createPrivateOutput(t => { tail += t; }, secrets); out.write(output.slice(-1500)); out.end();
          reject(new Error(`${path.basename(command)} ${argv.slice(0, 3).join(' ')} failed (${code}): ${tail}`));
        }
      });
    }));
  }
  const baseEnv = { PATH: process.env.PATH ?? '', HOME: home, LANG: 'en_US.UTF-8', CONVEX_TELEMETRY_DISABLED: '1', NEXT_TELEMETRY_DISABLED: '1' };

  // Sources: exact git archives; dependencies from each revision's own lockfile and package manager.
  const manifestDir = path.join(work, 'manifest');
  const src = { old: path.join(work, 'src-old'), new: path.join(work, 'src-new'), oldMaint: path.join(work, 'src-old-maint'), newMaint: path.join(work, 'src-new-maint') };
  /** @type {any} */ let manifest;
  await step('prepare exact OLD/NEW sources and lockfile installs', async () => {
    const shas = { old: git(['rev-parse', `${flag('--old')}^{commit}`]), new: git(['rev-parse', `${flag('--new', 'HEAD')}^{commit}`]) };
    for (const [key, dirs] of /** @type {const} */ ([['old', [src.old, src.oldMaint]], ['new', [src.new, src.newMaint]]])) {
      for (const dir of dirs) {
        fs.mkdirSync(dir, { mode: 0o700 });
        execFileSync('sh', ['-c', 'git archive "$1" | tar -x -C "$2"', 'sh', shas[key], dir], { cwd: root });
      }
      const pkg = JSON.parse(fs.readFileSync(path.join(dirs[0], 'package.json'), 'utf8'));
      const [manager, version] = String(pkg.packageManager).split('@');
      const lock = manager === 'bun' ? 'bun.lock' : 'pnpm-lock.yaml';
      if (manager === 'bun' && fs.existsSync(path.join(root, 'bun.lock')) && sha256(fs.readFileSync(path.join(root, 'bun.lock'))) === sha256(fs.readFileSync(path.join(dirs[0], lock)))) {
        await run('cp', ['-Rc', path.join(root, 'node_modules'), path.join(dirs[0], 'node_modules')]); // APFS clone of the identical lock
        await run('npx', ['--yes', `bun@${version}`, 'install', '--frozen-lockfile', '--offline'], { cwd: dirs[0], env: { ...baseEnv, HOME: homedir() } });
      } else if (manager === 'bun' || manager === 'pnpm') {
        await run('npx', ['--yes', `${manager}@${version}`, 'install', '--frozen-lockfile', '--prefer-offline'], { cwd: dirs[0], env: { ...baseEnv, HOME: homedir(), CI: '1' } });
      } else throw new Error(`Unsupported package manager ${pkg.packageManager}`);
      // Maintenance copy: reviewed seam, paused cron registry and the scheduler drain helper. Same dependency graph.
      await run(process.execPath, [path.join(root, 'scripts/architecture-maintenance.mjs'), '--dir', dirs[1], '--old-ref', shas[key]]);
      const maintPkg = JSON.parse(fs.readFileSync(path.join(dirs[1], 'package.json'), 'utf8'));
      if (JSON.stringify(maintPkg.dependencies) !== JSON.stringify(pkg.dependencies)) throw new Error(`${key} maintenance copy changed dependencies`);
      fs.symlinkSync(path.join(dirs[0], 'node_modules'), path.join(dirs[1], 'node_modules'), 'dir');
    }
    manifest = buildManifest({ old: shas.old, new: shas.new, out: manifestDir, oldModules: path.join(src.old, 'node_modules'), newModules: path.join(src.new, 'node_modules') });
    report.manifest = { old: manifest.old.sha, new: manifest.new.sha, schema: manifest.schema, artifacts: manifest.artifacts };
    return { old: shas.old.slice(0, 12), new: shas.new.slice(0, 12), schema: manifest.schema };
  });

  // Backends: run-owned identities; the binary is the one the shared Convex binary cache already holds.
  const binaries = path.join(convexCachePath(), 'binaries');
  const binary = path.join(binaries, fs.readdirSync(binaries).filter(n => n.startsWith('precompiled-')).sort().at(-1) ?? '', 'convex-local-backend');
  report.backendBinary = { path: path.relative(homedir(), binary), sha256: sha256(fs.readFileSync(binary)) };
  const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.on('error', reject); s.listen(0, '127.0.0.1', () => { const p = /** @type {net.AddressInfo} */ (s.address()).port; s.close(() => resolve(p)); }); });
  const blackhole = await freePort(); // nothing listens here: every action fetch fails before leaving the machine
  /** @type {Map<string, any>} */ const backends = new Map();
  /** @param {string} label @param {any} [existing] */
  async function startBackend(label, existing) {
    const b = existing ?? { label, instance: `rehearsal-${runId}-${label}`, secret: randomBytes(32).toString('hex'), cloud: await freePort(), site: await freePort(), dir: path.join(work, `backend-${label}`) };
    if (!existing) {
      fs.mkdirSync(b.dir, { mode: 0o700 });
      b.adminKey = execFileSync(binary, ['keygen', 'admin-key', '--instance-name', b.instance, '--instance-secret', b.secret], { encoding: 'utf8' }).trim();
      secrets.push(b.secret, b.adminKey);
      b.url = `http://127.0.0.1:${b.cloud}`; b.siteUrl = `http://127.0.0.1:${b.site}`;
    }
    const out = fs.openSync(path.join(b.dir, 'backend.log'), 'a', 0o600);
    b.child = spawn(binary, ['-i', '127.0.0.1', '-p', String(b.cloud), '--site-proxy-port', String(b.site), '--convex-origin', b.url, '--convex-site', b.siteUrl,
      '--instance-name', b.instance, '--instance-secret', b.secret, '--local-storage', path.join(b.dir, 'storage'), '--disable-beacon',
      '--convex-http-proxy', `http://127.0.0.1:${blackhole}`, path.join(b.dir, 'db.sqlite3')], { stdio: ['ignore', out, out] });
    fs.closeSync(out);
    b.exited = new Promise(resolve => b.child.once('exit', resolve));
    for (let i = 0; i < 150 && !(await identity(b)); i++) await delay(200);
    if (!(await identity(b))) throw new Error(`backend ${label} did not start`);
    backends.set(label, b);
    return b;
  }
  async function identity(/** @type {any} */ b) {
    try { return (await (await fetch(`${b.url}/instance_name`)).text()) === b.instance; } catch { return false; }
  }
  async function kill(/** @type {any} */ b, signal = 'SIGTERM') { b.child.kill(signal); await Promise.race([b.exited, delay(5000)]); if (b.child.exitCode === null && b.child.signalCode === null) { b.child.kill('SIGKILL'); await b.exited; } }
  /** Exact run-owned target assertion precedes every CLI call. */
  async function convex(/** @type {any} */ b, /** @type {string} */ dir, /** @type {string[]} */ argv, /** @type {{allowFail?: boolean}} */ o = {}) {
    if (!(await identity(b))) throw new Error(`Refusing ${argv[0]}: ${b.label} is not the run-owned ${b.instance}`);
    return /** @type {Promise<{code: number, output: string}>} */ (run(process.execPath, [path.join(dir, 'node_modules/convex/bin/main.js'), ...argv], {
      cwd: dir, env: { ...baseEnv, CONVEX_SELF_HOSTED_URL: b.url, CONVEX_SELF_HOSTED_ADMIN_KEY: b.adminKey }, logName: `convex-${b.label}.log`, ...o,
    }));
  }
  const setEnv = (/** @type {any} */ b, /** @type {string} */ name, /** @type {string | null} */ value) => convex(b, src.new, value === null ? ['env', 'remove', name] : ['env', 'set', '--', name, value]);
  const deploy = (/** @type {any} */ b, /** @type {string} */ dir) => convex(b, dir, ['deploy', '--typecheck', 'disable', '--yes']);
  /** @param {any} b @param {string} name */
  async function exportTo(b, name) {
    const file = path.join(work, name);
    await convex(b, src.new, ['export', '--include-file-storage', '--path', file]);
    fs.chmodSync(file, 0o600);
    return { file, sha256: sha256(fs.readFileSync(file)), summary: summarizeSnapshot(file) };
  }
  const importReplace = (/** @type {any} */ b, /** @type {string} */ dir, /** @type {string} */ zip, /** @type {{allowFail?: boolean}} */ o = {}) => convex(b, dir, ['import', '--replace-all', '--yes', zip], o);
  const { ConvexHttpClient } = await import(path.join(src.new, 'node_modules/convex/dist/esm/browser/index.js'));
  const { makeFunctionReference: ref } = await import(path.join(src.new, 'node_modules/convex/dist/esm/server/index.js'));
  const issuer = 'https://clerk.rehearsal.invalid';
  const people = { owner: 'owner@rehearsal.invalid', cashier: 'cashier@rehearsal.invalid', nonstaff: 'guest@rehearsal.invalid' };
  const client = (/** @type {any} */ b, /** @type {'admin' | 'owner' | 'cashier' | 'nonstaff' | undefined} */ who = undefined) => {
    const c = new ConvexHttpClient(b.url);
    if (who === 'admin') c.setAdminAuth(b.adminKey);
    else if (who) c.setAdminAuth(b.adminKey, { subject: `${who}-${runId}`, issuer, email: people[who], emailVerified: true, tokenIdentifier: `${issuer}|${who}-${runId}` });
    return c;
  };
  const webhookSecret = `whsec_${randomBytes(24).toString('hex')}`;
  secrets.push(webhookSecret);
  /** @param {any} b */
  async function configure(b) {
    for (const [name, value] of [['CLERK_JWT_ISSUER_DOMAIN', issuer], ['STRIPE_WEBHOOK_SECRET', webhookSecret]]) await setEnv(b, name, value);
  }
  // Archived rehearsal revisions keep their original access contract. Configure only the isolated copy.
  /** @param {any} b @param {string} source */
  async function configureOwner(b, source) {
    if (fs.existsSync(path.join(source, 'convex/auth/owners.ts'))) {
      await setEnv(b, 'ADMIN_EMAILS', null);
      await client(b, 'admin').mutation(ref('auth/owners:grantOwner'), { email: people.owner });
      await client(b, 'owner').mutation(ref('auth/staffAccess:claimInvite'), {});
    } else {
      await setEnv(b, 'ADMIN_EMAILS', people.owner);
    }
  }
  /** @param {any} b */
  async function scheduled(b) {
    const { output } = await convex(b, src.new, ['data', '_scheduled_functions', '--limit', '1000', '--format', 'jsonLines']);
    const rows = output.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
    const by = (/** @type {string} */ kind) => rows.filter(r => r.state?.kind === kind).map(r => r.name);
    return { pending: by('pending'), inProgress: by('inProgress'), failed: by('failed') };
  }
  // `convex data _cron_jobs` is empty on local backends; the admin-only dashboard system query lists the registered crons.
  /** @param {any} b @returns {Promise<string[]>} */
  async function cronJobs(b) {
    if (!(await identity(b))) throw new Error(`Refusing cron listing: ${b.label} is not the run-owned ${b.instance}`);
    const response = await fetch(`${b.url}/api/query`, { method: 'POST', headers: { Authorization: `Convex ${b.adminKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ path: '_system/frontend/listCronJobs', args: {}, format: 'json' }) });
    const result = /** @type {any} */ (await response.json());
    if (result.status !== 'success') throw new Error('cron listing failed');
    return result.value.map((/** @type {any} */ c) => String(c.name)).sort();
  }
  const sameCrons = (/** @type {string[]} */ actual, /** @type {string[]} */ expected) => JSON.stringify(actual) === JSON.stringify([...expected].sort());
  /** @param {any} b */
  async function drain(b) {
    const pages = [];
    for (let pass = 0; pass < 2; pass++) {
      let cursor = null, done = false;
      while (!done) {
        const page = /** @type {any} */ (await client(b, 'admin').mutation(ref('maintenance/reset:cancelScheduledPage'), { deployment: b.url, paginationOpts: { numItems: 100, cursor } }));
        pages.push({ pass, cancelled: page.cancelled, inProgress: page.inProgress });
        cursor = page.continueCursor; done = page.isDone;
      }
    }
    const rescan = pages.filter(p => p.pass === 1);
    const state = await scheduled(b);
    if (rescan.some(p => p.cancelled || p.inProgress) || state.pending.length || state.inProgress.length) throw new Error(`scheduler not drained: ${JSON.stringify(state)}`);
    return { cancelled: pages.reduce((n, p) => n + p.cancelled, 0), afterRescan: state };
  }
  /** @param {any} b */
  async function assertPaused(b) {
    const blocked = async (/** @type {() => Promise<unknown>} */ fn) => { try { await fn(); return false; } catch (/** @type {any} */ e) { return /MAINTENANCE|maintenance/i.test(String(e?.data?.code ?? e?.message ?? e)); } };
    const result = {
      publicQuery: await blocked(() => client(b).query(ref('catalog/publicProperties:list'), {})),
      publicMutation: await blocked(() => client(b).mutation(ref('bookings/bookings:create'), { propertySlug: 'pool-villa', guestName: 'Paused', guestEmail: 'paused@rehearsal.invalid', guestPhone: '+66800000000', checkIn: '2030-01-01', checkOut: '2030-01-02', guests: 1 })),
      stripeHttp: (await fetch(`${b.siteUrl}/stripe/webhook`, { method: 'POST', body: '{}' })).status,
      lineHttp: (await fetch(`${b.siteUrl}/line/webhook`, { method: 'POST', body: '{}' })).status,
    };
    if (!result.publicQuery || !result.publicMutation || result.stripeHttp !== 503 || result.lineHttp !== 503) throw new Error(`ingress not paused: ${JSON.stringify(result)}`);
    return result;
  }
  const storage = /** @type {{id: string, sha256: string}[]} */ ([]);
  /** @param {any} b @param {number} index */
  async function uploadProbe(b, index) {
    const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(2048 + index)]);
    const url = await client(b, 'owner').mutation(ref('catalog/adminProperties:generateUploadUrl'), {});
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
    const { storageId } = /** @type {any} */ (await response.json());
    storage.push({ id: storageId, sha256: sha256(bytes) });
  }
  /** Resolves each blob through the application's own upload check, then hashes the served bytes. Needs an unpaused backend. */
  /** @param {any} b */
  async function verifyStorage(b) {
    for (const blob of storage) {
      const saved = await client(b, 'owner').mutation(ref('catalog/adminProperties:saveUploadedImage'), { storageId: blob.id, kind: 'photo' });
      const response = saved?.url ? await fetch(saved.url) : null;
      if (!response?.ok || sha256(Buffer.from(await response.arrayBuffer())) !== blob.sha256) throw new Error(`storage ${blob.id} missing or changed`);
    }
    return storage.length;
  }
  /** @param {any} b @param {object} event */
  function signedWebhook(b, event) {
    const body = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', webhookSecret).update(`${t}.${body}`).digest('hex');
    return fetch(`${b.siteUrl}/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${signature}`, 'content-type': 'application/json' }, body });
  }
  let passNumber = 0;
  /** Operator-only tour, booking/payment sandbox and role smoke. Ingress stays gated: no frontend is public and providers are unreachable. */
  /** @param {any} b @param {string} label */
  async function smoke(b, label) {
    const n = ++passNumber, admin = client(b, 'admin');
    const villas = (await client(b).query(ref('catalog/publicProperties:list'), {}))?.villas;
    if (!Array.isArray(villas) || villas.length < 3) throw new Error(`expected ≥3 public villas, got ${villas?.length}`);
    const slug = villas.find(v => v.slug === 'pool-villa')?.slug ?? villas[0].slug;
    const villa = (await client(b).query(ref('catalog/publicProperties:getBySlug'), { slug }))?.villa;
    const rooms = await client(b).query(ref('catalog/properties:getTourRooms'), { slug });
    if (!villa || !rooms?.length) throw new Error('tour villa or scenes missing');
    const blobs = await verifyStorage(b);
    // Booking + payment sandbox: real public mutation, internal checkout reservation and the signed HTTP webhook.
    const day = (/** @type {number} */ offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const offset = 150 + n * 3; // within the 365-day booking window, one distinct stay per pass
    const booking = await client(b).mutation(ref('bookings/bookings:create'), { propertySlug: slug, guestName: `Rehearsal ${n}`, guestEmail: `smoke-${n}-${runId}@rehearsal.invalid`, guestPhone: `+668${String(10000000 + n).slice(-8)}`, checkIn: day(offset), checkOut: day(offset + 2), guests: 2 });
    const begun = await admin.mutation(ref('bookings/payments/stripe:beginCheckout'), { bookingId: booking.bookingId, accessToken: booking.accessToken, siteUrl: 'http://localhost:3000' });
    const session = `cs_rehearsal_${runId}_${n}`, intent = `pi_rehearsal_${runId}_${n}`;
    const request = begun.request;
    await admin.mutation(ref('bookings/payments/stripe:saveCheckoutSession'), { bookingId: booking.bookingId, accessToken: booking.accessToken, sessionId: session, url: `https://checkout.invalid/${session}`, expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
    const event = { id: `evt_${session}`, created: Math.floor(Date.now() / 1000), type: 'checkout.session.completed', data: { object: { id: session, client_reference_id: booking.bookingId, payment_status: 'paid', amount_total: request.total, currency: request.currency.toLowerCase(), payment_intent: intent } } };
    const first = await signedWebhook(b, event), replay = await signedWebhook(b, event);
    const forged = await fetch(`${b.siteUrl}/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}` }, body: JSON.stringify(event) });
    const paid = await client(b).query(ref('bookings/bookings:getById'), { id: booking.bookingId, accessToken: booking.accessToken });
    if (first.status !== 200 || replay.status !== 200 || forged.status !== 400 || paid?.paymentStatus !== 'paid') throw new Error(`payment sandbox: ${first.status}/${replay.status}/${forged.status}/${paid?.paymentStatus}/${paid?.status}`);
    // Roles: owner, cashier through the real invite/claim workflow, and a denied non-staff caller.
    const access = async (/** @type {'owner' | 'cashier' | 'nonstaff'} */ who) => (await client(b, who).query(ref('auth/staffAccess:myAccess'), {})).role ?? null;
    const { branches } = await client(b, 'owner').query(ref('auth/staffAccess:myAccess'), {});
    if (branches && !branches.length) throw new Error('No branch available for the rehearsal cashier');
    if (await access('cashier') !== 'cashier') {
      const team = await client(b, 'owner').query(ref('auth/staffAccess:listPeople'), {});
      const person = team.find((/** @type {{email: string}} */ row) => row.email === people.cashier);
      if (!person?.staffGrant) {
        await client(b, 'owner').mutation(ref('auth/staffAccess:setGrant'), {
          email: people.cashier, role: 'cashier', ...(branches ? { branchIds: [branches[0].id], expectedGrant: null } : {}),
        });
      }
    }
    await client(b, 'cashier').mutation(ref('auth/staffAccess:claimInvite'), {});
    const denied = async (/** @type {'owner' | 'cashier' | 'nonstaff'} */ who) => { try { await client(b, who).query(ref('auth/staffAccess:listPeople'), {}); return false; } catch { return true; } };
    const roles = { owner: await access('owner'), cashier: await access('cashier'), nonstaff: await access('nonstaff'), anonymous: (await client(b).query(ref('auth/staffAccess:myAccess'), {})).role ?? null,
      ownerTeam: !(await denied('owner')), cashierTeamDenied: await denied('cashier'), nonstaffTeamDenied: await denied('nonstaff') };
    if (roles.owner !== 'owner' || roles.cashier !== 'cashier' || roles.nonstaff || roles.anonymous || !roles.ownerTeam || !roles.cashierTeamDenied || !roles.nonstaffTeamDenied) throw new Error(`roles: ${JSON.stringify(roles)}`);
    const queue = await scheduled(b);
    const expected = /bookings\/(maintenance|payments\/stripe|emails)|messaging|marketing|catalog\/properties|crons?/;
    const unexpected = queue.pending.filter(name => !expected.test(name));
    if (queue.failed.length || queue.inProgress.length > 2 || unexpected.length) throw new Error(`scheduler after smoke: ${JSON.stringify({ ...queue, unexpected })}`);
    return { label, at: new Date().toISOString(), villas: villas.length, scenes: rooms.length, storageBlobs: blobs, payment: { webhook: first.status, replay: replay.status, forged: forged.status, status: paid.status }, roles, pending: queue.pending.length, failedScheduled: 0 };
  }
  /** @param {any} b @param {string} label */
  async function smokeTwice(b, label) {
    const first = await step(`${label}: smoke pass 1 (tour, booking/payment sandbox, roles)`, () => smoke(b, label));
    say(`… waiting ${gap / 1000}s before the second smoke pass`);
    await delay(gap);
    const second = await step(`${label}: smoke pass 2`, () => smoke(b, label));
    const separation = Date.parse(second.at) - Date.parse(first.at);
    report.steps.at(-1).details.separationMs = separation;
    if (separation < gap) throw new Error('smoke passes were not separated by the requested gap');
    return separation;
  }
  /** @param {any} b @param {string} label @param {() => Promise<{code: number | null}>} command */
  async function interrupted(b, label, command) {
    // Kill the backend process (SIGKILL) while a destructive CLI operation is in flight, then restart it from disk.
    const pending = command();
    await delay(Number(flag('--interrupt-after-ms', '150')));
    await kill(b, 'SIGKILL');
    const cli = await pending;
    await startBackend(label, b);
    return { cliExit: cli.code };
  }

  /**
   * Stage 0 compatibility certificate on real shapes. Restores an operator-supplied private export (verified against its
   * expected SHA-256) onto one run-owned loopback backend running the OLD maintenance copy, proves the restore by
   * re-export, then deploys NEW onto that data while still paused and records accepted or refused. Only counts, digests
   * and table/field names leave the private run directory; restored state is deleted afterwards unless --keep-state.
   */
  async function certifyFlow() {
    const backup = path.resolve(flag('--backup') ?? ''), expected = flag('--sha256') ?? '';
    /** @type {ReturnType<typeof summarizeSnapshot>} */ let source = { tables: {}, blobs: {}, dangling: [] };
    await step('verify private backup and expected SHA-256', async () => {
      const stat = fs.statSync(backup);
      if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Backup must be a regular file readable only by its owner (chmod 600)');
      const actual = sha256(fs.readFileSync(backup));
      if (actual !== expected) throw new Error('Backup SHA-256 does not match the expected value');
      const summary = summarizeSnapshot(backup);
      report.certificate = { backupSha256: actual, old: manifest.old.sha, new: manifest.new.sha, schemaSourcesIdentical: manifest.schema.sourcesIdentical };
      source = summary; // per-table digests stay in memory; only counts are printed and reported
      return { sha256: actual, nonEmptyTables: nonEmpty(summary).length, blobs: Object.keys(summary.blobs).length, dangling: summary.dangling.length };
    });
    const R = await step('start run-owned loopback restore target (egress blackholed, paused)', async () => {
      const b = await startBackend('r'); await configure(b); await setEnv(b, 'ARCH_RESET_PAUSED', '1');
      return { instance: b.instance, loopback: true };
    }).then(() => backends.get('r'));
    await step('deploy paused restore revision (--old) maintenance copy and restore the backup', async () => {
      await deploy(R, src.oldMaint);
      await importReplace(R, src.oldMaint, backup);
      return { paused: await assertPaused(R) };
    });
    const compareToBackup = async (/** @type {string} */ name) => {
      const restored = await exportTo(R, name);
      const differences = compareSnapshots(source, restored.summary);
      if (differences.length) throw new Error(`restored data differs from the backup in ${differences.length} tables/blobs: ${differences.join(', ')}`);
      return { tablesMatched: Object.keys(restored.summary.tables).length, blobsMatched: Object.keys(restored.summary.blobs).length };
    };
    report.certificate.restore = await step('re-export the restore and compare every table digest and blob hash', () => compareToBackup('export-restored.zip'));
    // The full CLI output goes to the private convex-r.log (mode 600) only; the verdict carries the table, field and a
    // fixed reason category. A deploy that never ran (target identity check, spawn failure) is inconclusive too.
    /** @returns {Promise<ReturnType<typeof classifyDeploy>>} */
    const tryNew = async () => convex(R, src.new, ['deploy', '--typecheck', 'disable', '--yes'], { allowFail: true })
      .then(r => classifyDeploy(r.code, r.output), () => classifyDeploy(null, ''));
    /** @param {ReturnType<typeof classifyDeploy>} v */
    const stopIfInconclusive = v => {
      if (v.result !== 'inconclusive') return;
      report.certificate.newOnRestoredData = v;
      fs.writeFileSync(path.join(work, 'certificate.json'), JSON.stringify({ ...report.certificate, at: new Date().toISOString(), runId }, null, 2) + '\n', { mode: 0o600 });
      say(`CERTIFICATE: inconclusive (${v.reason}); no compatibility verdict, no reset recommendation. Details: private convex-r.log`);
      throw new Error(`certify inconclusive: ${v.reason}`);
    };
    let verdict = await step('deploy target revision (--new) onto the restored data (still paused)', tryNew);
    stopIfInconclusive(verdict);
    // Clearing certificates addresses exactly one refusal: OLD's tourScenes validator lacks ordinaryTourCertified.
    if (verdict.result === 'refused' && verdict.table === 'tourScenes' && verdict.field === 'ordinaryTourCertified' && args.includes('--clear-tour-certificates')) {
      report.certificate.firstAttempt = verdict;
      const cleared = await step('clear ordinaryTourCertified with the restore revision maintenance mutation, then retry', async () => {
        let cursor = null, checkpoint = null, total = 0, done = false;
        while (!done) {
          const page = /** @type {any} */ (await client(R, 'admin').mutation(ref('maintenance/tourCertificates:page'), { targetOrigin: new URL(R.url).origin, snapshotSha256: expected, mode: 'clear', cursor, checkpoint }));
          total += page.cleared; cursor = page.cursor; checkpoint = page.checkpoint; done = page.isDone;
        }
        return { cleared: total };
      });
      report.certificate.cleared = cleared.cleared;
      verdict = await step('deploy target revision (--new) after clearing certificates', tryNew);
      stopIfInconclusive(verdict);
    }
    report.certificate.newOnRestoredData = verdict;
    if (verdict.result === 'accepted' && !report.certificate.cleared) report.certificate.afterNewDeploy = await step('re-export after target deploy: data unchanged', () => compareToBackup('export-after-new.zip'));
    fs.writeFileSync(path.join(work, 'certificate.json'), JSON.stringify({ ...report.certificate, at: new Date().toISOString(), runId }, null, 2) + '\n', { mode: 0o600 });
    say(`CERTIFICATE: target revision ${verdict.result} on restored data${verdict.result === 'refused' ? ` (${verdict.table}.${verdict.field}, native schema validation)` : ''}`);
  }

  try {
    if (mode === 'certify') { await certifyFlow(); report.ok = true; return; }
    const P = await step('start run-owned backend P (production stand-in)', async () => { const b = await startBackend('p'); await configure(b); return { instance: b.instance, url: b.url }; }).then(() => backends.get('p'));
    /** @type {any} */ let baseline;
    await step('OLD live state: deploy OLD, seed, smoke and upload storage', async () => {
      await deploy(P, src.old);
      await convex(P, src.old, ['run', 'maintenance/seed:seedAll', '{"scenario":"demo-resort"}']).then(r => fs.writeFileSync(path.join(work, 'old-seed.json'), r.output, { mode: 0o600 }));
      await configureOwner(P, src.old);
      await uploadProbe(P, 1); await uploadProbe(P, 2);
      const live = await smoke(P, 'OLD live');
      const crons = await cronJobs(P);
      if (!sameCrons(crons, manifest.old.crons)) throw new Error(`OLD registered crons ${JSON.stringify(crons)}`);
      return { live, storageBlobs: storage.length, cronJobs: crons.length };
    });
    // Forward rehearsal.
    const cutoverAt = Date.now();
    await step('quiesce OLD: money cutoff, maintenance flag, paused ingress', async () => {
      await setEnv(P, 'ARCH_MONEY_CUTOVER_AT', String(cutoverAt));
      await setEnv(P, 'ARCH_RESET_PAUSED', '1');
      return { cutoverAt, ...(await assertPaused(P)) };
    });
    await step('deploy OLD maintenance copy (crons paused, drain helper) and drain scheduler', async () => {
      await deploy(P, src.oldMaint);
      const crons = await cronJobs(P);
      if (crons.length !== 0) throw new Error(`maintenance copy left cron jobs registered: ${crons}`);
      return { cronJobs: 0, ...(await drain(P)), paused: await assertPaused(P) };
    });
    await step('export quiesced OLD with file storage', async () => {
      baseline = await exportTo(P, 'export-old.zip');
      report.exportOld = { sha256: baseline.sha256, tables: nonEmpty(baseline.summary, true), blobs: Object.keys(baseline.summary.blobs).length, dangling: baseline.summary.dangling };
      if (Object.keys(baseline.summary.blobs).length < storage.length) throw new Error('export is missing storage blobs');
      return report.exportOld;
    });
    await step('prove OLD export restore on isolated backend R', async () => {
      const R = await startBackend('r'); await configure(R); await setEnv(R, 'ARCH_RESET_PAUSED', '1');
      await deploy(R, src.oldMaint);
      await importReplace(R, src.oldMaint, baseline.file);
      const restored = await exportTo(R, 'export-r-restored.zip');
      const differences = compareSnapshots(baseline.summary, restored.summary);
      if (differences.length) throw new Error(`restore differs: ${differences.join(', ')}`);
      // Exact in-place compatibility probe: does the NEW schema accept the restored OLD data without a reset?
      const probe = await deploy(R, src.new).then(() => 'accepted', error => `rejected: ${String(error.message).slice(0, 300)}`);
      report.inPlaceCompatibility = probe;
      await kill(R); backends.delete('r');
      return { tablesMatched: Object.keys(restored.summary.tables).length, blobsMatched: Object.keys(restored.summary.blobs).length, newSchemaOnOldData: probe };
    });
    await step('interrupted OLD clear (backend SIGKILL mid-import), restart and classify', async () => {
      const zip = path.join(manifestDir, manifest.artifacts.clearOld.file);
      const result = await interrupted(P, 'p', () => importReplace(P, src.oldMaint, zip, { allowFail: true }));
      const after = (await exportTo(P, 'export-p-after-interrupted-clear.zip')).summary;
      const state = nonEmpty(after).length === 0 ? 'cleared' : compareSnapshots(baseline.summary, after).length === 0 ? 'untouched' : 'PARTIAL';
      if (state === 'PARTIAL') throw new Error(`partial clear: ${nonEmpty(after).join(', ')}`);
      return { ...result, state };
    });
    await step('complete OLD clear while OLD is deployed; verify root, component and scheduler state', async () => {
      await assertPaused(P);
      await drain(P);
      await importReplace(P, src.oldMaint, path.join(manifestDir, manifest.artifacts.clearOld.file));
      const after = (await exportTo(P, 'export-p-cleared.zip')).summary;
      if (nonEmpty(after).length) throw new Error(`not empty: ${nonEmpty(after).join(', ')}`);
      return { remaining: nonEmpty(after, true), componentTables: Object.keys(after.tables).filter(t => t.startsWith('_components/')) };
    });
    /** @type {Record<string, number>} */ let seedCounts;
    await step('deploy paused NEW and verify table inventory', async () => {
      await deploy(P, src.new);
      const tables = Object.keys((await exportTo(P, 'export-p-new-empty.zip')).summary.tables).filter(t => !t.startsWith('_')).sort();
      const missing = manifest.new.tables.filter((/** @type {string} */ t) => !tables.includes(t)), extra = tables.filter(t => !manifest.new.tables.includes(t));
      if (missing.length || extra.length) throw new Error(`table inventory mismatch: missing ${missing} extra ${extra}`);
      const crons = await cronJobs(P); // registered, but every handler returns early while ARCH_RESET_PAUSED=1
      if (!sameCrons(crons, manifest.new.crons)) throw new Error(`NEW registered crons ${JSON.stringify(crons)}`);
      return { tables: tables.length, cronJobs: crons.length, paused: await assertPaused(P) };
    });
    await step('interrupted reseed (backend SIGKILL mid-seed), restart, resume', async () => {
      const seed = () => convex(P, src.new, ['run', 'maintenance/seed:seedAll', '{"scenario":"demo-resort"}'], { allowFail: true });
      const result = await interrupted(P, 'p', seed);
      const after = (await exportTo(P, 'export-p-after-interrupted-seed.zip')).summary;
      const before = nonEmpty(after);
      let resumed = 'already-committed';
      if (before.length === 0) { const r = await seed(); if (r.code) throw new Error('resume seed failed'); fs.writeFileSync(path.join(work, 'new-seed.json'), r.output, { mode: 0o600 }); resumed = 'seeded-after-restart'; }
      return { ...result, stateAfterRestart: before.length ? 'committed' : 'empty', resumed };
    });
    await step('second identical seed is refused', async () => {
      const second = await convex(P, src.new, ['run', 'maintenance/seed:seedAll', '{"scenario":"demo-resort"}'], { allowFail: true });
      if (second.code === 0 || !/Seed requires an empty database; [A-Za-z]+ is not empty/.test(second.output)) throw new Error('second seed was not refused');
      return { refused: second.output.match(/Seed requires an empty database; \w+ is not empty/)?.[0] };
    });
    await step('compare seeded counts, references and public assets', async () => {
      const seeded = (await exportTo(P, 'export-p-new-seeded.zip')).summary;
      seedCounts = Object.fromEntries(Object.entries(seeded.tables).filter(([, t]) => t.count).map(([n, t]) => [n, t.count]));
      const expected = { properties: 3, tourScenes: 5, reviews: 7, reviewStats: 3, bookings: 2, bookingPayments: 1, orders: 3, orderLines: 1, conversations: 1, messages: 1 };
      const wrong = Object.entries(expected).filter(([t, c]) => seedCounts[t] !== c);
      const rows = (/** @type {string} */ table) => execFileSync('unzip', ['-p', path.join(work, 'export-p-new-seeded.zip'), `${table}/documents.jsonl`], { encoding: 'utf8' }).trim().split('\n').map(l => JSON.parse(l));
      const villas = rows('properties'), scenes = rows('tourScenes');
      const assets = [...villas.flatMap(v => v.images ?? []), ...scenes.map(s => s.imagePath)].filter(a => typeof a === 'string' && a.startsWith('/'));
      const missingAssets = assets.filter(a => !fs.existsSync(path.join(src.new, 'public', a.split('?')[0])));
      if (wrong.length || seeded.dangling.length || missingAssets.length) throw new Error(`seed mismatch ${JSON.stringify({ wrong, dangling: seeded.dangling, missingAssets })}`);
      return { keyCounts: expected, publicAssetsChecked: assets.length, dangling: 0 };
    });
    await step('lift internal pause (ingress still gated) for NEW acceptance', async () => { await setEnv(P, 'ARCH_RESET_PAUSED', null); await configureOwner(P, src.new); storage.length = 0; await uploadProbe(P, 3); return { providerFetch: 'blackholed', publicFrontend: 'not exposed' }; });
    if (args.includes('--frontends')) {
      await step('NEW default frontend (Start) SSR probe against accepted backend', () => frontendProbe('new'));
      // Frontend-only rollback while NEW still ships the Next entry: its explicit Next rebuild against the accepted
      // backend. After the Next entry's retirement the Next rollback is an archived (OLD) revision, probed below.
      if (await frontendTargetFor(src.new, 'next')) await step('NEW explicit FRONTEND=next rebuild SSR probe against accepted backend', () => frontendProbe('new', 'next'));
    }
    report.forwardSmokeSeparationMs = await smokeTwice(P, 'NEW forward');

    // Rollback rehearsal.
    await step('rollback: pause NEW, deploy NEW maintenance copy, drain', async () => {
      await setEnv(P, 'ARCH_RESET_PAUSED', '1');
      await deploy(P, src.newMaint);
      const crons = await cronJobs(P);
      if (crons.length !== 0) throw new Error(`NEW maintenance copy left cron jobs registered: ${crons}`);
      return { cronJobs: 0, ...(await drain(P)), paused: await assertPaused(P) };
    });
    await step('rollback: capture failed NEW state', async () => { const failed = await exportTo(P, 'export-new-failed.zip'); report.exportNewFailed = { sha256: failed.sha256, tables: nonEmpty(failed.summary).length }; return report.exportNewFailed; });
    await step('rollback: clear NEW records while NEW is deployed', async () => {
      await importReplace(P, src.newMaint, path.join(manifestDir, manifest.artifacts.clearNew.file));
      const after = (await exportTo(P, 'export-p-new-cleared.zip')).summary;
      if (nonEmpty(after).length) throw new Error(`not empty: ${nonEmpty(after).join(', ')}`);
      return { remaining: nonEmpty(after, true) };
    });
    await step('rollback: deploy paused OLD, restore verified OLD export, verify content and file checksums', async () => {
      await deploy(P, src.oldMaint);
      await importReplace(P, src.oldMaint, baseline.file);
      const restored = await exportTo(P, 'export-p-rolled-back.zip');
      const differences = compareSnapshots(baseline.summary, restored.summary);
      if (differences.length) throw new Error(`rollback restore differs: ${differences.join(', ')}`);
      storage.length = 0;
      for (const [name, hash] of Object.entries(baseline.summary.blobs)) if (!name.startsWith('_components/')) storage.push({ id: (name.split('/').at(-1) ?? '').replace(/\.[^.]+$/, ''), sha256: hash }); // export names blobs <id>.<ext>
      return { tablesMatched: Object.keys(restored.summary.tables).length, blobsMatched: Object.keys(restored.summary.blobs).length, paused: await assertPaused(P) };
    });
    await step('rollback: deploy OLD (crons restored) and lift internal pause', async () => {
      await deploy(P, src.old);
      await setEnv(P, 'ARCH_RESET_PAUSED', null);
      await configureOwner(P, src.old);
      const crons = await cronJobs(P);
      if (!sameCrons(crons, manifest.old.crons)) throw new Error(`restored OLD registered crons ${JSON.stringify(crons)}`);
      return { cronJobs: crons.length };
    });
    if (args.includes('--frontends')) {
      await step('OLD default frontend SSR probe against restored backend', () => frontendProbe('old'));
      // An OLD revision that ships both entries also rebuilds its Next entry: the archived Next rollback path.
      const oldNext = await frontendTargetFor(src.old, 'next');
      if (oldNext && (await frontendTargetFor(src.old))?.frontend !== 'next') await step('OLD explicit FRONTEND=next rebuild SSR probe against restored backend', () => frontendProbe('old', 'next'));
    }
    report.rollbackSmokeSeparationMs = await smokeTwice(P, 'OLD rollback');
    report.ok = true;
  } finally {
    for (const b of backends.values()) await kill(b).catch(() => {});
    for (const dir of Object.values(src)) fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
    if (mode === 'certify' && !args.includes('--keep-state')) {
      // Restored real data never outlives the certificate run: drop backend state, re-exports and source copies.
      for (const entry of fs.readdirSync(work)) if (/^(backend-|export-|src-)/.test(entry)) fs.rmSync(path.join(work, entry), { recursive: true, force: true });
    }
    fs.rmSync(home, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString();
    report.ok ??= false;
    writeReport();
    say(`${report.ok ? 'PASS' : 'FAIL'}: report ${path.relative(root, path.join(work, 'report.json'))}`);
  }

  /**
   * A revision's own frontend selection (scripts/frontend-target.mjs and package scripts), or null when that revision
   * cannot build the requested entry. Revisions without a selector (pre-Start `6e6a562c` and the Phase 3 OLD) build
   * their default Next with `build`; Phase 3 selects Start only through START_PRODUCTION/START_PREVIEW, which the
   * rehearsal environment never sets. The dual-entry checkpoint accepts FRONTEND=next; the Start-only head builds
   * only Start.
   * @param {string} dir @param {'start' | 'next' | undefined} requested
   * @returns {Promise<{ frontend: 'start' | 'next', script: string } | null>}
   */
  async function frontendTargetFor(dir, requested = undefined) {
    const selector = path.join(dir, 'scripts/frontend-target.mjs');
    if (!fs.existsSync(selector)) return requested === 'start' ? null : { frontend: 'next', script: 'build' };
    try {
      const target = (await import(selector)).frontendTarget(requested ? { FRONTEND: requested } : {});
      return !requested || target.frontend === requested ? target : null;
    } catch {
      return null;
    }
  }

  /**
   * Builds a revision's frontend through its own selection, never a hand-written build, and probes its room SSR.
   * @param {'old' | 'new'} side @param {'start' | 'next' | undefined} requested
   */
  async function frontendProbe(side, requested = undefined) {
    const P = backends.get('p');
    const port = await freePort(), dir = side === 'new' ? src.new : src.old;
    const target = await frontendTargetFor(dir, requested);
    if (!target) throw new Error(`${side} cannot build ${requested ?? 'its default frontend'}`);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    // Dedicated Clerk *test* tenant values, supplied privately through the environment and redacted from every log.
    const key = (flag('--clerk-publishable-key', process.env.REHEARSAL_CLERK_PUBLISHABLE_KEY) ?? ''), clerkSecret = process.env.REHEARSAL_CLERK_SECRET_KEY ?? '';
    if (/^(pk|sk)_live_/.test(key) || /^sk_live_/.test(clerkSecret)) throw new Error('Rehearsal frontends accept only Clerk test keys');
    secrets.push(key, clerkSecret);
    const env = { ...baseEnv, HOME: homedir(), HEAVY_HELD: process.env.HEAVY_HELD ?? '', NODE_ENV: 'production', ...(requested && { FRONTEND: requested }),
      NEXT_PUBLIC_CONVEX_URL: P.url, VITE_CONVEX_URL: P.url, NEXT_PUBLIC_CONVEX_SITE_URL: P.siteUrl, VITE_CONVEX_SITE_URL: P.siteUrl,
      NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`, VITE_SITE_URL: `http://localhost:${port}`, SITE_URL: `http://localhost:${port}`,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: key, VITE_CLERK_PUBLISHABLE_KEY: key, CLERK_PUBLISHABLE_KEY: key, CLERK_SECRET_KEY: clerkSecret };
    await run('npx', ['--yes', pkg.packageManager, 'run', target.script], { cwd: dir, env, logName: `frontend-${side}-${target.frontend}.log` });
    // The revision's own server command: each `build*` script pairs with its `preview*` script, and both servers read PORT.
    const preview = target.script.replace(/^build/, 'preview');
    if (!pkg.scripts?.[preview]) throw new Error(`${side} has no ${preview} script for ${target.script}`);
    const server = /** @type {import('node:child_process').ChildProcess} */ (spawn('npx', ['--yes', pkg.packageManager, 'run', preview], { cwd: dir, env: /** @type {NodeJS.ProcessEnv} */ ({ ...env, PORT: String(port), HOST: '127.0.0.1' }), stdio: 'ignore', detached: true }));
    try {
      let response;
      for (let i = 0; i < 150; i++) { try { response = await fetch(`http://localhost:${port}/rooms/pool-villa`); if (response.status < 500) break; } catch {} await delay(200); }
      const html = await response?.text() ?? '';
      const villa = (await client(P).query(ref('catalog/publicProperties:getBySlug'), { slug: 'pool-villa' }))?.villa;
      if (response?.status !== 200 || !villa?.name || !html.includes(villa.name)) throw new Error(`${side} ${target.frontend} /rooms/pool-villa: ${response?.status}`);
      return { frontend: target.frontend, script: target.script, preview, status: response.status, villaInHtml: true, bytes: html.length };
    } finally { try { process.kill(-(server.pid ?? 0), 'SIGTERM'); } catch { server.kill('SIGTERM'); } }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = args[0];
  if (command === 'manifest') {
    const old = flag('--old');
    if (!old) throw new Error('--old <ref> is required');
    const manifest = buildManifest({ old, new: flag('--new', 'HEAD') ?? 'HEAD', out: path.resolve(flag('--out', 'output/cutover-manifest') ?? ''), oldModules: flag('--old-modules'), newModules: flag('--new-modules') });
    console.log(JSON.stringify({ old: manifest.old.sha, new: manifest.new.sha, schema: manifest.schema, artifacts: manifest.artifacts }, null, 2));
  } else if (command === 'vercel-settings') {
    // Read-only. Stage 0 record, post-switch and post-rollback verification: --compare <earlier snapshot> diffs settings.
    const [old, next] = [revisionInventory(flag('--old', 'origin/main') ?? ''), revisionInventory(flag('--new', 'HEAD') ?? '')];
    const snapshot = readVercel({ project: flag('--project', '360-tour') ?? '', scope: flag('--scope', 'rugbykritsakorn-9882s-projects') ?? '' });
    const findings = vercelFindings(snapshot, { old: { sha: old.sha, vercel: old.vercel, node: old.node }, new: { sha: next.sha, vercel: next.vercel, node: next.node } });
    const previous = flag('--compare') ? JSON.parse(fs.readFileSync(flag('--compare') ?? '', 'utf8')).snapshot : null;
    const changed = previous ? ['project', 'routes', 'firewall'].filter(k => JSON.stringify(previous[k]) !== JSON.stringify(snapshot[/** @type {'project'} */ (k)])) : null;
    // After a promotion or reversal, require the public domains to resolve to exactly the intended deployment.
    const expected = { id: flag('--expect-live'), sha: flag('--expect-live-sha') };
    const mismatch = (expected.id && expected.id !== snapshot.live.id) || (expected.sha && expected.sha !== snapshot.live.sha);
    const result = { capturedAt: new Date().toISOString(), old: old.sha, new: next.sha, snapshot, findings, ...(changed && { changedSinceCompare: changed }),
      ...((expected.id || expected.sha) && { expectedLive: { ...expected, ok: !mismatch } }) };
    const out = flag('--out');
    if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(result, null, 2));
    if (mismatch) { console.error(`Live production is ${snapshot.live.id} (${snapshot.live.sha}), not the expected deployment`); process.exitCode = 1; }
    // Opt-in gate (Stage 0 and the OLD backend rebuild). The snapshot above is always written and printed first,
    // so a failing run stays inspectable.
    // --expected-production-env <file>: a names-only pin (one name per line), compared exactly.
    const pin = flag('--expected-production-env') ? fs.readFileSync(flag('--expected-production-env') ?? '', 'utf8').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')) : null;
    if (args.includes('--forbid-start-production') || args.includes('--production-env-gate') || pin) {
      const gate = productionEnvGate(snapshot, pin);
      for (const failure of gate.failures) console.error(failure);
      if (!gate.ok) process.exitCode = 1;
    }
  } else if (command === 'public-smoke') {
    // Anonymous GETs only. --repeat-after-ms 300000 runs the second pass of the operator protocol. Operator headers
    // (VERCEL_PROTECTION_BYPASS, CUTOVER_HOLD_TOKEN) go to --url's origin only. --expect-hold also requires `/` without
    // the hold header to get the hold's 503 (protection bypass still sent, so the 503 is the route's, not protection's).
    const base = smokeUrl(flag('--url'));
    const headers = operatorHeaders();
    if (args.includes('--expect-hold') && !headers[HOLD_HEADER]) throw new Error('--expect-hold needs CUTOVER_HOLD_TOKEN_FILE');
    const expect = { frontend: /** @type {'start' | 'next' | undefined} */ (flag('--expect-frontend')), clerk: /** @type {'live' | 'test' | undefined} */ (flag('--expect-clerk')) };
    const passes = [];
    for (let pass = 0; pass < (flag('--repeat-after-ms') ? 2 : 1); pass++) {
      if (pass) await delay(Number(flag('--repeat-after-ms')));
      const judged = judgePublicSmoke(await observePublicSmoke(base, headers), expect);
      if (args.includes('--expect-hold')) {
        const hold = await observeHold(base, headers);
        const failures = judgeHoldProbe(hold);
        if (failures.length) { judged.ok = false; judged.failures.push(...failures); }
        passes.push({ at: new Date().toISOString(), ...judged, hold });
      } else passes.push({ at: new Date().toISOString(), ...judged });
    }
    console.log(JSON.stringify({ base: new URL(base).host, passes }, null, 2));
    if (passes.some(p => !p.ok)) process.exitCode = 1;
  } else if (command === 'hold-plan') {
    // Offline. Builds the one staging write's request body from the Stage 0 snapshot (its production domains), fresh
    // GETs of the live routes and of the routes versions, and the hold token file. Refuses if another staged version
    // exists. Writes the body (it contains the token) to a new mode-600 file; prints only a token-free summary.
    const read = (/** @type {string} */ name) => JSON.parse(fs.readFileSync(flag(name) ?? '', 'utf8'));
    const token = readSecret(process.env, 'CUTOVER_HOLD_TOKEN');
    if (!token || !/^[a-f0-9]{32,}$/.test(token)) throw new Error('hold-plan needs CUTOVER_HOLD_TOKEN_FILE with at least 32 hex characters');
    const out = flag('--out');
    if (!out) throw new Error('hold-plan needs --stage0 <stage0.json> --routes <live-routes.json> --versions <versions.json> --out <body.json>');
    const plan = planHold({ stage0: read('--stage0'), current: read('--routes'), versions: read('--versions'), token });
    fs.writeFileSync(out, JSON.stringify(plan.body) + '\n', { mode: 0o600, flag: 'wx' }); // never overwrite an existing file
    console.log(JSON.stringify({ out, ...plan.summary }, null, 2));
  } else if (command === 'hold-check') {
    // Offline. Evaluates the hold matrix against --routes <file> (a raw routes GET, e.g. the staged version) with
    // CUTOVER_HOLD_TOKEN[_FILE] and the Stage 0 domains (--stage0), or, without --routes, against synthetic data.
    // --baseline <live-routes.json> also requires every other route to be unchanged. --reopen checks the version that
    // removes the hold. --other-host <host> adds a host (e.g. the staged immutable URL) that must stay unaffected.
    const file = flag('--routes');
    const stage0 = flag('--stage0') ? JSON.parse(fs.readFileSync(flag('--stage0') ?? '', 'utf8')) : null;
    const hosts = stage0?.snapshot?.live?.domains ?? (file ? null : ['tour.helpgueststay.com']);
    if (!hosts?.length) throw new Error('hold-check --routes needs --stage0 <stage0.json> for the production domains');
    const token = file ? readSecret(process.env, 'CUTOVER_HOLD_TOKEN') : randomBytes(24).toString('hex');
    if (!token) throw new Error('hold-check --routes needs CUTOVER_HOLD_TOKEN_FILE');
    const instagram = { name: 'Phase 2 Instagram ingress migration', enabled: true, staged: false, srcSyntax: 'regex', routeType: 'rewrite', route: { src: '^/api/instagram/webhook$', dest: 'https://wary-toad-189.convex.site/instagram/webhook' } };
    const routes = file ? JSON.parse(fs.readFileSync(file, 'utf8')).routes : [instagram, ...(args.includes('--reopen') ? [] : [holdRoute(token, hosts)])];
    const otherHosts = [...args.flatMap((a, i) => a === '--other-host' ? [args[i + 1]] : []), stage0?.snapshot?.live?.url].filter(Boolean);
    const baseline = flag('--baseline') ? JSON.parse(fs.readFileSync(flag('--baseline') ?? '', 'utf8')).routes : undefined;
    const result = { source: file ? 'routes-file' : 'synthetic', ...judgeHold(routes, token, { hosts, otherHosts, baseline, reopen: args.includes('--reopen') }) };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === 'instagram-probe') {
    const base = flag('--url');
    if (!base || !/^https:\/\//.test(base)) throw new Error('--url https://<deployment> is required');
    const result = await instagramRewriteProbe(base, operatorHeaders());
    console.log(JSON.stringify(result));
    if (!result.forwardedToConvex) process.exitCode = 1;
  } else if (command === 'rehearse' || command === 'certify') {
    if (!flag('--old')) throw new Error('--old <ref> is required');
    if (command === 'certify' && (!flag('--backup') || !/^[a-f0-9]{64}$/.test(flag('--sha256') ?? '') || !flag('--new'))) throw new Error('certify needs --backup <private.zip> --sha256 <hex> --old <sha> --new <sha>');
    await rehearse().catch(error => {
      const out = createPrivateOutput(text => process.stderr.write(text));
      out.write(String(error?.stack ?? error)); out.end();
      process.exitCode = 1;
    });
  } else {
    console.log('Usage: node scripts/cutover-rehearsal.mjs manifest|rehearse|certify|vercel-settings|instagram-probe|public-smoke|hold-plan|hold-check --old <ref> [--new <ref>] ...');
    process.exitCode = command ? 1 : 0;
  }
}
