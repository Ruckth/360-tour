/**
 * Operator access for the Phase 4 smoke tools and the maintenance hold.
 * Secrets never come from argv, are sent only to the requested origin and are never printed. Each can be given as
 * `<NAME>_FILE` (a private, mode-600 file; preferred) or as `<NAME>` in the environment:
 *   VERCEL_PROTECTION_BYPASS  Vercel deployment-protection automation bypass
 *   CUTOVER_HOLD_TOKEN        passes the project-route maintenance hold (header `x-cutover-hold`)
 */
import fs from 'node:fs';

export const HOLD_HEADER = 'x-cutover-hold';
export const HOLD_ROUTE_NAME = 'Phase 4 maintenance hold';
/** Every path except the exact Instagram webhook, which the project rewrite forwards to Convex. */
export const HOLD_SRC = '^/(?!api/instagram/webhook$).*$';

/**
 * `<name>_FILE` (must not be group/other accessible) wins over `<name>`. @param {Record<string, string | undefined>} env
 * @param {string} name @returns {string | undefined}
 */
export function readSecret(env, name) {
  const file = env[`${name}_FILE`];
  if (!file) return env[name] || undefined;
  if ((fs.statSync(file).mode & 0o077) !== 0) throw new Error(`${name}_FILE must be mode 600 (readable by the owner only)`);
  const value = fs.readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`${name}_FILE is empty`);
  return value;
}

/** @param {Record<string, string | undefined>} env @returns {Record<string, string>} */
export function operatorHeaders(env = process.env) {
  const bypass = readSecret(env, 'VERCEL_PROTECTION_BYPASS'), hold = readSecret(env, 'CUTOVER_HOLD_TOKEN');
  return { ...(bypass && { 'x-vercel-protection-bypass': bypass }), ...(hold && { [HOLD_HEADER]: hold }) };
}

/**
 * Smoke target: https anywhere, plain http only on loopback (local stubs). Returns the parsed URL's href.
 * @param {string | undefined} base
 */
export function smokeUrl(base) {
  let url;
  try { url = new URL(base ?? ''); } catch { throw new Error('--url https://<deployment-or-domain> is required'); }
  if (url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) return url.href;
  throw new Error('--url must be https (plain http only on loopback)');
}

/**
 * GET carrying operator headers, confined to `base`'s origin: a target that resolves elsewhere throws before any
 * request, and redirects are returned rather than followed, so the headers never reach another origin.
 * @param {string} base @param {string | URL} target @param {Record<string, string>} headers
 */
export async function originFetch(base, target, headers) {
  const url = new URL(target, base);
  if (url.origin !== new URL(base).origin) throw new Error(`refusing to send operator headers to another origin (${url.host})`);
  return fetch(url, { headers, redirect: 'manual' });
}

// ---------- the hold as a project route ----------

const escapeRegex = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Exact, anchored host match for the Stage 0 production domains. @param {string[]} hosts */
export function hostValue(hosts) {
  if (!hosts.length || hosts.some(h => !/^[a-z0-9.-]+$/.test(h))) throw new Error('hold needs the Stage 0 production domain names (lowercase hostnames)');
  return `^(?:${[...hosts].sort().map(escapeRegex).join('|')})$`;
}

/**
 * The hold route as `GET /v1/projects/<id>/routes` is expected to return it: 503 only when the request host is one of
 * the Stage 0 production domains and the operator token header is absent. Previews, the immutable deployment URLs
 * (staged and Stage 0) and other projects never match the host condition.
 * @param {string} token @param {string[]} hosts
 */
export function holdRoute(token, hosts) {
  return {
    name: HOLD_ROUTE_NAME, description: 'Temporary Phase 4 cutover hold (production domains only)', enabled: true, staged: true, srcSyntax: 'regex', routeType: 'set_status',
    route: {
      src: HOLD_SRC, status: 503,
      has: [{ type: 'host', value: hostValue(hosts) }],
      missing: [{ type: 'header', key: HOLD_HEADER, value: `^${token}$` }],
      headers: { 'Retry-After': '600', 'Cache-Control': 'no-store' },
    },
  };
}

/** `POST /v1/projects/<id>/routes` body (appended after every existing route). @param {string} token @param {string[]} hosts */
export function holdRequestBody(token, hosts) {
  const { name, description, enabled, srcSyntax, route } = holdRoute(token, hosts);
  return { route: { name, description, enabled, srcSyntax, route }, position: { placement: 'end' } };
}

/** @param {any} value @param {string | undefined} actual */
function valueMatches(value, actual) {
  if (actual === undefined) return false;
  if (value === undefined) return true;
  if (typeof value === 'string') return new RegExp(`^(?:${value})$`).test(actual);
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.eq === 'string') return actual === value.eq;
  throw new Error(`unsupported condition value ${JSON.stringify(Object.keys(value ?? {}))}`); // fail closed on an unmodelled shape
}

/** @param {any} c @param {{host: string, headers: Record<string, string>}} request */
function conditionHolds(c, request) {
  if (c.type === 'header') return valueMatches(c.value, request.headers[String(c.key).toLowerCase()]);
  if (c.type === 'host') return valueMatches(c.value, request.host.toLowerCase());
  throw new Error(`unsupported condition type ${c.type}`);
}

/**
 * Pure model of Vercel project routes for one request: the first enabled route whose `src` matches the pathname
 * (query excluded) and whose has/missing conditions hold decides. A route with only response headers continues.
 * `staged: true` routes count only when `includeStaged` (the staged version being reviewed before publish).
 * @param {any[]} routes raw `routes` array @param {{host: string, path: string, headers?: Record<string, string>}} request
 * @returns {{outcome: 'status', status: number, route: string} | {outcome: 'rewrite', dest: string, route: string} | {outcome: 'deployment'}}
 */
export function evaluateRoutes(routes, request, includeStaged = true) {
  const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const pathname = new URL(request.path, 'https://route.invalid').pathname;
  for (const r of routes) {
    if (!r.enabled || (r.staged && !includeStaged)) continue;
    const route = r.route ?? {};
    if (r.srcSyntax && r.srcSyntax !== 'regex') throw new Error(`unsupported srcSyntax ${r.srcSyntax}`);
    if (!new RegExp(route.src).test(pathname)) continue;
    if (!(route.has ?? []).every((/** @type {any} */ c) => conditionHolds(c, { host: request.host, headers }))) continue;
    if ((route.missing ?? []).some((/** @type {any} */ c) => conditionHolds(c, { host: request.host, headers }))) continue;
    if (typeof route.status === 'number' && !route.dest) return { outcome: 'status', status: route.status, route: r.name };
    if (route.dest) return { outcome: 'rewrite', dest: route.dest, route: r.name };
  }
  return { outcome: 'deployment' };
}

/** Comparable form of a non-hold route (id, name, enabled, rule). @param {any} r */
const comparable = r => JSON.stringify({ id: r.id ?? null, name: r.name, enabled: r.enabled, route: r.route });

/**
 * Pure: the non-hold routes of `routes` must equal `baseline`, in order. Catches an unrelated staged edit that a
 * publish would otherwise carry live along with the hold. @param {any[]} routes @param {any[]} baseline
 */
export function unrelatedRouteChanges(routes, baseline) {
  const others = routes.filter(r => r.name !== HOLD_ROUTE_NAME).map(comparable), base = baseline.filter(r => r.name !== HOLD_ROUTE_NAME).map(comparable);
  if (baseline.some(r => r.name === HOLD_ROUTE_NAME)) return ['baseline already contains the hold route'];
  return others.length === base.length && others.every((r, i) => r === base[i]) ? [] : [`non-hold routes differ from the baseline (${others.length} vs ${base.length} routes)`];
}

/**
 * Pure: the hold matrix. `hosts` are the Stage 0 production domains (held); `otherHosts` are hosts that must be
 * unaffected (Previews, the staged and Stage 0 immutable URLs). `token` is used only to build requests and never
 * appears in the result. With `reopen`, no route may hold anything and the hold route must be absent.
 * @param {any[]} routes @param {string} token
 * @param {{hosts: string[], otherHosts?: string[], baseline?: any[], reopen?: boolean}} o
 */
export function judgeHold(routes, token, o) {
  const op = { [HOLD_HEADER]: token };
  const guest = ['/', '/rooms/pool-villa?tour=1', '/admin'];
  const lookalikes = o.hosts.flatMap(h => [`x${h}`, `${h}.evil.example`, `preview-${h.replace(/\./g, '-')}.vercel.app`]);
  const others = [...new Set([...(o.otherHosts ?? []), '360-tour-git-feature-team.vercel.app', 'other-project-abc123-team.vercel.app', ...lookalikes])];
  const held = o.reopen ? 'deployment' : 'status:503';
  /** @type {{name: string, host: string, path: string, headers?: Record<string, string>, expect: string}[]} */
  const cases = [];
  for (const host of o.hosts) {
    for (const path of guest) cases.push({ name: `${path} on ${host}`, host, path, expect: held });
    cases.push(
      { name: `villa-cache callback on ${host}`, host, path: '/api/internal/villa-cache', expect: held },
      { name: `instagram forwarded on ${host}`, host, path: '/api/instagram/webhook?hub.mode=subscribe', expect: 'rewrite' },
      { name: `instagram exemption is exact (trailing slash) on ${host}`, host, path: '/api/instagram/webhook/', expect: held },
      { name: `instagram exemption is exact (suffix) on ${host}`, host, path: '/api/instagram/webhookx', expect: held },
      { name: `operator passes on ${host}`, host, path: '/', headers: op, expect: 'deployment' },
      { name: `operator passes (header case) on ${host}`, host, path: '/rooms/pool-villa', headers: { 'X-Cutover-Hold': token }, expect: 'deployment' },
      { name: `operator still reaches instagram on ${host}`, host, path: '/api/instagram/webhook', headers: op, expect: 'rewrite' },
      { name: `wrong token on ${host}`, host, path: '/', headers: { [HOLD_HEADER]: `${token}0` }, expect: held },
      { name: `token prefix on ${host}`, host, path: '/', headers: { [HOLD_HEADER]: token.slice(0, -1) }, expect: held },
      { name: `empty token on ${host}`, host, path: '/', headers: { [HOLD_HEADER]: '' }, expect: held },
      { name: `host case on ${host}`, host: host.toUpperCase(), path: '/', expect: held },
    );
  }
  for (const host of others) for (const path of guest) cases.push({ name: `${path} on ${host} unaffected`, host, path, expect: 'deployment' });
  const results = cases.map(c => {
    const r = evaluateRoutes(routes, { host: c.host, path: c.path, headers: c.headers });
    const got = r.outcome === 'status' ? `status:${r.status}` : r.outcome;
    return { case: c.name, expect: c.expect, got, ok: got === c.expect };
  });
  const hold = routes.find(r => r.name === HOLD_ROUTE_NAME);
  const failures = results.filter(r => !r.ok).map(r => `${r.case}: ${r.got} ≠ ${r.expect}`);
  if (!o.reopen && !hold) failures.unshift(`no route named "${HOLD_ROUTE_NAME}"`);
  if (o.reopen && hold) failures.unshift(`route "${HOLD_ROUTE_NAME}" is still present`);
  if (!o.reopen && hold && routes.indexOf(hold) !== routes.length - 1) failures.push('hold route is not the last route');
  if (o.baseline) failures.push(...unrelatedRouteChanges(routes, o.baseline));
  return { ok: failures.length === 0, hosts: o.hosts, unaffectedHosts: others, holdRoute: hold ? { enabled: hold.enabled, staged: hold.staged ?? null, position: routes.indexOf(hold) } : null, cases: results.length, failures };
}

/**
 * Pure: everything checked before the one staging write. Refuses when another staged routes version exists (a later
 * publish would carry it live), when the current live routes already hold, or when the domains are not Stage 0's.
 * @param {{stage0: any, current: any, versions: any, token: string}} o
 */
export function planHold(o) {
  const hosts = o.stage0?.snapshot?.live?.domains;
  if (!Array.isArray(hosts) || !hosts.length) throw new Error('Stage 0 snapshot has no snapshot.live.domains');
  if (!Array.isArray(o.versions?.versions)) throw new Error('versions file has no versions list');
  const staging = o.versions.versions.filter((/** @type {any} */ v) => v.isStaging);
  if (staging.length) throw new Error(`a staged routes version already exists (${staging.map((/** @type {any} */ v) => v.id).join(', ')}): review or discard it before the hold`);
  const live = o.versions.versions.filter((/** @type {any} */ v) => v.isLive);
  if (live.length !== 1) throw new Error(`expected exactly one live routes version, found ${live.length}`);
  if (!Array.isArray(o.current?.routes)) throw new Error('current routes file has no routes list');
  // GET /v1/projects/<id>/routes returns {routes, version: {id, ...}}; without the version id the plan cannot prove which
  // version it was read from, so it refuses.
  if (typeof o.current.version?.id !== 'string' || !o.current.version.id) throw new Error('current routes file has no version.id (the live routing version)');
  if (o.current.version.id !== live[0].id) throw new Error('current routes file is not the live version');
  if (o.current.routes.some((/** @type {any} */ r) => r.name === HOLD_ROUTE_NAME)) throw new Error('the hold route already exists');
  const reduce = (/** @type {any} */ r) => JSON.stringify([r.name, r.enabled, r.route?.src ?? r.src, r.route?.dest ?? r.dest ?? null]);
  const matchesStage0 = JSON.stringify(o.current.routes.map(reduce)) === JSON.stringify((o.stage0.snapshot.routes ?? []).map(reduce));
  const expected = [...o.current.routes.map((/** @type {any} */ r) => ({ ...r, staged: false })), holdRoute(o.token, hosts)];
  const check = judgeHold(expected, o.token, { hosts, otherHosts: [o.stage0.snapshot.live.url].filter(Boolean) });
  if (!check.ok) throw new Error(`the planned hold fails its own matrix: ${check.failures.join('; ')}`);
  return { body: holdRequestBody(o.token, hosts), summary: { hosts, liveRoutesVersion: live[0].id, existingRoutes: o.current.routes.length, matchesStage0Routes: matchesStage0, cases: check.cases } };
}
