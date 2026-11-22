import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { inspectSchema, schemaSourceReader } from '../../scripts/lib/convex-schema.mjs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { promisify } from 'node:util';
import { HOLD_HEADER, HOLD_ROUTE_NAME, evaluateRoutes, holdRequestBody, holdRoute, judgeHold, operatorHeaders, originFetch, planHold, readSecret, smokeUrl } from '../../scripts/lib/operator-access.mjs';
import { buildManifest, collectPages, readVercelWith, compareSnapshots, FORBIDDEN_PRODUCTION_ENV, HOLD_PROBE_PATHS, judgeHoldProbe, productionEnvGate, productionEnvInventories, startProductionGate, startProductionInProduction, instagramRewriteProbe, judgePublicSmoke, liveProduction, summarizeSnapshot, vercelFindings, vercelSnapshot } from '../../scripts/cutover-rehearsal.mjs';

const scratch: string[] = [];
afterAll(() => scratch.forEach(dir => rmSync(dir, { recursive: true, force: true })));
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'cutover-')); scratch.push(dir); return dir; };
const zip = (file: string, entries: Record<string, string>) =>
  execFileSync('python3', ['-I', '-c', 'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for n,c in json.loads(sys.argv[2]).items(): z.writestr(n,c)', file, JSON.stringify(entries)]);

it('builds a revision-bound manifest with deterministic root and component clear snapshots', () => {
  const [a, b] = [temp(), temp()];
  const first = buildManifest({ old: 'HEAD', new: 'HEAD', out: a });
  const second = buildManifest({ old: 'HEAD', new: 'HEAD', out: b });
  const tables = inspectSchema(schemaSourceReader('.')).tables.map(t => t.name).sort();
  expect(first.new.tables).toEqual(tables);
  expect(first.schema).toEqual({ sourcesIdentical: true, tablesAdded: [], tablesRemoved: [], componentsIdentical: true });
  expect(first.new.components).toEqual([{ name: 'rateLimiter', package: '@convex-dev/rate-limiter', version: expect.any(String), tables: ['rateLimits'] }]);
  expect(first.artifacts.clearNew.sha256).toBe(second.artifacts.clearNew.sha256);
  const names = JSON.parse(execFileSync('python3', ['-I', '-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert all(z.read(n)==b"" for n in z.namelist()); print(json.dumps(z.namelist()))', join(a, 'clear-new.zip')], { encoding: 'utf8' }));
  expect(names.sort()).toEqual([...tables.map(t => `${t}/documents.jsonl`), '_components/rateLimiter/rateLimits/documents.jsonl'].sort());
  expect(JSON.parse(readFileSync(join(a, 'manifest.json'), 'utf8')).new.sha).toMatch(/^[0-9a-f]{40}$/);
}, 30_000);

it('compares exports by canonical content and storage bytes, and reports dangling ids', () => {
  const dir = temp();
  const id = (c: string) => c.repeat(32);
  const base = { 'properties/documents.jsonl': `{"_id":"${id('a')}","name":"Pool"}\n`, 'bookings/documents.jsonl': `{"_id":"${id('b')}","propertyId":"${id('a')}","stripeId":"pi_x"}\n`, [`_storage/${id('s')}.png`]: 'bytes', '_tables/documents.jsonl': '{"name":"properties","id":1}\n' };
  zip(join(dir, 'a.zip'), base);
  zip(join(dir, 'reordered.zip'), { ...base, 'properties/documents.jsonl': `{"name":"Pool","_id":"${id('a')}"}\n` });
  zip(join(dir, 'changed.zip'), { ...base, [`_storage/${id('s')}.png`]: 'other', 'bookings/documents.jsonl': `{"_id":"${id('b')}","propertyId":"${id('c')}"}\n` });
  const a = summarizeSnapshot(join(dir, 'a.zip'));
  expect(a.tables.properties.count).toBe(1);
  expect(a.dangling).toEqual([]);
  expect(compareSnapshots(a, summarizeSnapshot(join(dir, 'reordered.zip')))).toEqual([]);
  const changed = summarizeSnapshot(join(dir, 'changed.zip'));
  expect(changed.dangling).toEqual(['bookings.propertyId']);
  expect(compareSnapshots(a, changed).sort()).toEqual(['_storage/' + id('s') + '.png', 'bookings'].sort());
});

const OLD = 'a'.repeat(40), STAGED = 'b'.repeat(40);
type Alias = { alias: string; deploymentId: string; projectId: string };
type Deployment = { id: string; projectId: string; readyState: string; target: string; createdAt: number; url?: string; meta: { githubCommitSha?: string } };
const raw = (overrides: Record<string, unknown> = {}) => ({
  project: { id: 'prj_1', framework: 'nextjs', buildCommand: 'pnpm vercel-build', installCommand: 'pnpm install', nodeVersion: '24.x', autoAssignCustomDomains: true,
    protectionBypass: { secret123: { scope: 'automation-bypass' } }, env: [{ key: 'CLERK_SECRET_KEY', value: 'sk_live_hidden', target: ['production'] }], ...overrides },
  routes: { routes: [{ name: 'ig', enabled: true, staged: false, routeType: 'rewrite', route: { src: '^/api/instagram/webhook$', dest: 'https://wary-toad-189.convex.site/instagram/webhook' } }] },
  firewall: { firewallEnabled: true, rules: [] },
  domains: { domains: [{ name: 'tour.example.com', verified: true, redirect: null, projectId: 'prj_1' }, { name: 'old.example.com', verified: true, redirect: 'tour.example.com', projectId: 'prj_1' }] },
  aliases: { 'tour.example.com': { alias: 'tour.example.com', deploymentId: 'dpl_old', projectId: 'prj_1' } } as Record<string, Alias>,
  deployments: { dpl_old: { id: 'dpl_old', projectId: 'prj_1', readyState: 'READY', target: 'production', createdAt: 100, url: 'old.vercel.app', meta: { githubCommitSha: OLD } } } as Record<string, Deployment>,
  // Newest first, as the API lists them: a READY staged build with no alias, a queued build, the live one and an older candidate.
  list: { deployments: [
    { uid: 'dpl_queued', target: 'production', readyState: 'QUEUED', created: 300, meta: {} },
    { uid: 'dpl_staged', target: 'production', readyState: 'READY', created: 200, meta: { githubCommitSha: STAGED } },
    { uid: 'dpl_old', target: 'production', readyState: 'READY', created: 100, meta: { githubCommitSha: OLD } },
    { uid: 'dpl_prev', target: 'production', readyState: 'READY', created: 50, meta: { githubCommitSha: 'c'.repeat(40) } },
  ] },
});
const sides = { old: { sha: OLD, vercel: { buildCommand: 'pnpm vercel-build', installCommand: 'pnpm install' }, node: '22.x' }, new: { sha: 'b'.repeat(40), vercel: { framework: null, buildCommand: 'bun run vercel-build' }, node: '22.x' } };

it('reduces Vercel settings without env values or bypass secrets and derives cutover expectations', () => {
  const snap = vercelSnapshot(raw());
  expect(JSON.stringify(snap)).not.toMatch(/sk_live|secret123/);
  expect(snap.project.env).toEqual(['CLERK_SECRET_KEY@production']);
  const findings = vercelFindings(snap, sides);
  expect(findings.effective.old.framework).toBe('nextjs');
  expect(findings.effective.new).toMatchObject({ framework: 'other', buildCommand: 'bun run vercel-build', installCommand: 'pnpm install' });
  expect(findings).toMatchObject({ productionIsOld: true, instagramRewrite: { ok: true }, autoPromoteRisk: true, unaliasedProductionBuilds: { staged: ['dpl_staged'], queued: ['dpl_queued'] } });
  expect(vercelFindings(vercelSnapshot(raw({ autoAssignCustomDomains: false })), sides).autoPromoteRisk).toBe(false);
  expect(vercelFindings(vercelSnapshot({ ...raw(), routes: { routes: [] } }), sides).instagramRewrite.ok).toBe(false);
});

it('derives the live rollback target from the domain alias, not the newest READY production build', () => {
  const live = liveProduction({ projectId: 'prj_1', ...raw() });
  expect(live).toMatchObject({ id: 'dpl_old', sha: OLD, domains: ['tour.example.com'] });
  expect(live.staged.map(d => d.id)).toEqual(['dpl_staged']);
  expect(live.queued.map(d => d.id)).toEqual(['dpl_queued']);
  expect(live.previous.map(d => d.id)).toEqual(['dpl_prev']);
  // After promotion the alias moves; the same derivation follows it.
  const promoted = raw();
  promoted.aliases['tour.example.com'].deploymentId = 'dpl_staged';
  promoted.deployments.dpl_staged = { id: 'dpl_staged', projectId: 'prj_1', readyState: 'READY', target: 'production', createdAt: 200, meta: { githubCommitSha: STAGED } };
  expect(liveProduction({ projectId: 'prj_1', ...promoted })).toMatchObject({ id: 'dpl_staged', sha: STAGED, previous: [{ id: 'dpl_old' }, { id: 'dpl_prev' }] });
});

it('fails closed on missing, foreign, split or unready live evidence', () => {
  const variant = (change: (r: ReturnType<typeof raw>) => void) => { const r = raw(); change(r); return () => liveProduction({ projectId: 'prj_1', ...r }); };
  expect(variant(r => { r.domains.domains = []; })).toThrow(/No verified production domain/);
  expect(variant(r => { r.domains.domains[0].verified = false; })).toThrow(/No verified production domain/);
  expect(variant(r => { delete r.aliases['tour.example.com']; })).toThrow(/No alias evidence/);
  expect(variant(r => { r.aliases['tour.example.com'].projectId = 'prj_other'; })).toThrow(/another project/);
  expect(variant(r => { r.deployments.dpl_old.projectId = 'prj_other'; })).toThrow(/another project/);
  expect(variant(r => { r.deployments.dpl_old.readyState = 'ERROR'; })).toThrow(/not READY production/);
  expect(variant(r => { r.deployments.dpl_old.meta = {}; })).toThrow(/no commit SHA/);
  expect(variant(r => {
    r.domains.domains.push({ name: 'www.example.com', verified: true, redirect: null, projectId: 'prj_1' });
    r.aliases['www.example.com'] = { alias: 'www.example.com', deploymentId: 'dpl_staged', projectId: 'prj_1' };
  })).toThrow(/different deployments/);
  expect(() => vercelSnapshot({ ...raw(), domains: { domains: [] } })).toThrow(/No verified production domain/);
});

it('accepts only the Convex Meta challenge rejection as proof the Instagram rewrite forwards', async () => {
  let status = 403, body = 'Forbidden', seenBypass: string | undefined, platformError = '';
  const server = createServer((request, response) => { seenBypass = request.headers['x-vercel-protection-bypass'] as string; response.writeHead(status, platformError ? { 'x-vercel-error': platformError } : {}); response.end(body); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    expect(await instagramRewriteProbe(base, { 'x-vercel-protection-bypass': 'bypass' })).toMatchObject({ status: 403, forwardedToConvex: true });
    expect(seenBypass).toBe('bypass');
    status = 404; body = '<html>Not found</html>';
    expect((await instagramRewriteProbe(base)).forwardedToConvex).toBe(false);
    status = 410; body = 'The deployment has been removed';
    platformError = 'GONE';
    expect(await instagramRewriteProbe(base)).toMatchObject({ forwardedToConvex: false, platformError: 'GONE' });
  } finally { server.close(); }
});

it('judges the anonymous operator smoke, including renderer and Clerk mode', () => {
  const page = (extra = '') => ({ status: 200, html: `<html lang="en"><script src="/assets/main-abc.js"></script>${extra}</html>`, poweredBy: null });
  const observed = {
    home: page(), room: page('pk_live_x'), tour: page(), 'room-th': { status: 200, html: '<html lang="th">' }, 'unknown-villa': { status: 404 },
    'admin-signed-out': { status: 307 }, robots: { status: 200 }, sitemap: { status: 200 }, instagram: { status: 403, html: 'Forbidden' },
  };
  expect(judgePublicSmoke(observed, { frontend: 'start', clerk: 'live' })).toEqual({ ok: true, frontend: 'start', clerk: 'live', failures: [] });
  const next = { ...observed, room: { status: 200, html: '<script src="/_next/static/x.js"></script>pk_test_y', poweredBy: 'Next.js' }, 'unknown-villa': { status: 200 }, instagram: { status: 404, html: '' } };
  expect(judgePublicSmoke(next, { frontend: 'start', clerk: 'live' }).failures).toEqual(['unknown-villa: 200 ≠ 404', 'frontend: next ≠ start', 'clerk: test ≠ live', 'instagram: 404']);
});

it('keeps the browser tour smoke anonymous and write-free', async () => {
  const { requestPolicy, isConvexWriteFrame, judgeTour } = await import('../../scripts/tour-smoke.mjs');
  const origin = 'https://tour.example.com';
  expect(requestPolicy('https://us.i.posthog.com/e/', 'POST', origin)).toBe('block-analytics');
  expect(requestPolicy('https://tour.example.com/_vercel/insights/view', 'POST', origin)).toBe('block-analytics');
  expect(requestPolicy('https://x-1.convex.cloud/api/mutation', 'POST', origin)).toBe('block-convex-write');
  expect(requestPolicy('https://clerk.example.com/v1/client', 'POST', origin)).toBe('block-write');
  expect(requestPolicy('https://tour.example.com/rooms/a', 'GET', origin)).toBe('same-origin');
  expect(requestPolicy('https://img.example.net/p.jpg', 'GET', origin)).toBe('pass');
  expect(isConvexWriteFrame('{"type":"Mutation","udfPath":"x"}')).toBe(true);
  expect(isConvexWriteFrame('{"type":"ModifyQuerySet"}')).toBe(false);
  const good = { status: 200, sceneReady: true, yawBefore: 0, yawAfter: 0.4, stableBeforeDrag: true, pixelsChanged: true, blocked: { analytics: 2, writes: 1, convexWrites: 0 }, pageErrors: [] };
  expect(judgeTour(good)).toEqual({ ok: true, failures: [] });
  expect(judgeTour({ ...good, yawAfter: 0, blocked: { analytics: 0, writes: 0, convexWrites: 1 } }).failures).toEqual(['drag did not turn the camera', '1 Convex write attempts']);
});

/** Fake Vercel list API: newest first, `limit` per page, `until` exclusive, `next` null on the last page. */
function pagedApi(lists: Record<string, { created: number }[]>, limit: number, extra: Record<string, unknown>, calls: string[] = []) {
  return (endpoint: string) => {
    calls.push(endpoint);
    const url = new URL(endpoint, 'https://api.invalid');
    const list = Object.entries(lists).find(([prefix]) => url.pathname.startsWith(prefix));
    if (!list) { const hit = extra[url.pathname]; if (hit === undefined) throw new Error(`unexpected ${url.pathname}`); return hit; }
    const until = url.searchParams.get('until');
    const rows = list[1].filter(r => until === null || r.created < Number(until)).slice(0, limit);
    const key = url.pathname.includes('/domains') ? 'domains' : 'deployments';
    const more = list[1].filter(r => until === null || r.created < Number(until)).length > rows.length;
    return { [key]: rows, pagination: { count: rows.length, next: more ? rows.at(-1)!.created : null } };
  };
}

it('reads paginated domains and all production deployments, including active builds older than live', () => {
  const live = { id: 'dpl_live', projectId: 'prj_1', readyState: 'READY', target: 'production', createdAt: 500, url: 'live.vercel.app', meta: { githubCommitSha: OLD } };
  const domains = [
    { name: 'preview.example.com', verified: true, redirect: null, gitBranch: 'dev', created: 900 },
    { name: 'old.example.com', verified: true, redirect: 'tour.example.com', created: 800 },
    { name: 'tour.example.com', verified: true, redirect: null, created: 700 }, // page 2 with limit 2
  ];
  const prod = (uid: string, created: number, readyState: string) => ({ uid, created, readyState, target: 'production', meta: { githubCommitSha: uid === 'dpl_live' ? OLD : STAGED } });
  const deployments = [prod('dpl_q1', 990, 'BUILDING'), prod('dpl_x', 980, 'ERROR'), prod('dpl_q2', 970, 'QUEUED'), prod('dpl_staged', 960, 'READY'),
    prod('dpl_live', 500, 'READY'), prod('dpl_prev', 400, 'READY'), prod('dpl_old1', 300, 'READY'),
    // Created before live (e.g. a slow build overtaken by a manual promotion, or live changed by a rollback): page 4 with limit 2.
    prod('dpl_slow', 250, 'BUILDING'), prod('dpl_old2', 200, 'READY'), prod('dpl_q_old', 150, 'QUEUED')];
  const calls: string[] = [];
  const get = pagedApi({ '/v9/projects/prj_1/domains': domains, '/v6/deployments': deployments }, 2, {
    '/v9/projects/360-tour': { id: 'prj_1', env: [] }, '/v4/aliases/tour.example.com': { alias: 'tour.example.com', deploymentId: 'dpl_live', projectId: 'prj_1' },
    '/v13/deployments/dpl_live': live, '/v1/projects/prj_1/routes': { routes: [] }, '/v1/security/firewall/config/active': { rules: [] },
  }, calls);
  const snap = readVercelWith(get, { project: '360-tour' });
  // The fixture serves no env endpoints: a failed read is recorded, not fatal, and the gate fails closed on it.
  expect(snap.productionEnv.list.state).toBe('unavailable');
  expect(productionEnvGate(snap).ok).toBe(false);
  expect(calls).toEqual(expect.arrayContaining(['/v10/projects/prj_1/env', '/v1/env?projectId=prj_1']));
  const withEnv = readVercelWith(pagedApi({ '/v9/projects/prj_1/domains': domains, '/v6/deployments': deployments }, 2, {
    '/v9/projects/360-tour': { id: 'prj_1', env: [] }, '/v4/aliases/tour.example.com': { alias: 'tour.example.com', deploymentId: 'dpl_live', projectId: 'prj_1' },
    '/v13/deployments/dpl_live': live, '/v1/projects/prj_1/routes': { routes: [] }, '/v1/security/firewall/config/active': { rules: [] },
    '/v10/projects/prj_1/env': { envs: [], hiddenProductionEnvCount: 0 }, '/v1/env': { data: [], pagination: { count: 0, next: null, prev: null } },
  }), { project: '360-tour' });
  expect(productionEnvGate(withEnv)).toEqual({ ok: true, failures: [] });
  expect(snap.live).toMatchObject({ id: 'dpl_live', domains: ['tour.example.com'] });
  expect(snap.live.staged.map(d => d.id)).toEqual(['dpl_staged']);
  expect(snap.live.queued.map(d => d.id).sort()).toEqual(['dpl_q1', 'dpl_q2', 'dpl_q_old', 'dpl_slow']);
  expect(snap.live.previous.map(d => d.id)).toEqual(['dpl_prev', 'dpl_old1', 'dpl_old2']);
  expect(snap.inventory).toEqual({ domainPages: 2, deploymentPages: 5, deployments: 10 });
  expect(calls.filter(c => c.startsWith('/v6/deployments')).at(-1)).toContain('until=250'); // the last page holds dpl_old2 and dpl_q_old; its next is null
  expect(calls.filter(c => c.startsWith('/v4/aliases') || c.startsWith('/v13/deployments'))).toEqual(['/v4/aliases/tour.example.com?projectId=prj_1', '/v13/deployments/dpl_live']);
});

it('fails closed on repeated cursors, empty continuation pages, truncation and foreign inventory', () => {
  const page = (next: number | null, n = 1) => ({ deployments: Array.from({ length: n }, (_, i) => ({ uid: `d${next}-${i}` })), pagination: { next } });
  expect(() => collectPages(() => page(100), { key: 'deployments', maxPages: 5, limit: 5 })).toThrow(/did not advance/);
  let cursors = [200, 300];
  expect(() => collectPages(() => page(cursors.shift() ?? null), { key: 'deployments', maxPages: 5, limit: 5 })).toThrow(/did not advance/);
  expect(() => collectPages(() => page(100, 0), { key: 'deployments', maxPages: 5, limit: 5 })).toThrow(/empty but reported another page/);
  let n = 1000;
  expect(() => collectPages(() => page(n--), { key: 'deployments', maxPages: 3, limit: 5 })).toThrow(/truncated after 3 pages/);
  expect(() => collectPages(() => ({ items: [] }), { key: 'deployments', maxPages: 3, limit: 5 })).toThrow(/no deployments list/);
  cursors = [];
  expect(collectPages(() => page(null, 2), { key: 'deployments', maxPages: 1, limit: 5 })).toMatchObject({ pages: 1 });

  const base = { '/v9/projects/360-tour': { id: 'prj_1', env: [] }, '/v4/aliases/tour.example.com': { alias: 'tour.example.com', deploymentId: 'dpl_live', projectId: 'prj_1' },
    '/v13/deployments/dpl_live': { id: 'dpl_live', projectId: 'prj_1', readyState: 'READY', target: 'production', createdAt: 500, meta: { githubCommitSha: OLD } },
    '/v1/projects/prj_1/routes': { routes: [] }, '/v1/security/firewall/config/active': { rules: [] } };
  const domains = [{ name: 'tour.example.com', verified: true, redirect: null, created: 1 }];
  const run = (deployments: object[]) => () => readVercelWith(pagedApi({ '/v9/projects/prj_1/domains': domains, '/v6/deployments': deployments as { created: number }[] }, 100, base), { project: '360-tour' });
  expect(run([{ uid: 'dpl_live', created: 500, readyState: 'READY', target: 'preview' }])).toThrow(/outside production of this project/);
  expect(run([{ uid: 'dpl_live', created: 500, readyState: 'READY', target: 'production', projectId: 'prj_other' }])).toThrow(/outside production of this project/);
  expect(run([{ uid: 'dpl_other', created: 600, readyState: 'READY', target: 'production' }])).toThrow(/missing from the production inventory/);
  // More production deployments than 10 pages of 100: the inventory refuses rather than truncating.
  const flood = Array.from({ length: 1001 }, (_, i) => ({ uid: i === 0 ? 'dpl_live' : `dpl_${i}`, created: 5000 - i, readyState: 'READY', target: 'production' }));
  expect(run(flood)).toThrow(/truncated after 10 pages/);
  const many = Array.from({ length: 21 }, (_, i) => ({ name: `d${i}.example.com`, verified: true, redirect: null, created: 100 - i }));
  expect(() => readVercelWith(pagedApi({ '/v9/projects/prj_1/domains': many, '/v6/deployments': [] }, 50, base), { project: '360-tour' })).toThrow(/More than 20 production domains/);
});

it('requires an explicit terminal cursor and refuses malformed, oversized, duplicate or truncated pages', () => {
  const base = { '/v9/projects/360-tour': { id: 'prj_1', env: [] }, '/v4/aliases/tour.example.com': { alias: 'tour.example.com', deploymentId: 'dpl_live', projectId: 'prj_1' },
    '/v13/deployments/dpl_live': { id: 'dpl_live', projectId: 'prj_1', readyState: 'READY', target: 'production', createdAt: 500, meta: { githubCommitSha: OLD } },
    '/v1/projects/prj_1/routes': { routes: [] }, '/v1/security/firewall/config/active': { rules: [] } };
  const domain = (i: number) => ({ name: i === 0 ? 'tour.example.com' : `x${i}.example.com`, verified: true, redirect: i === 0 ? null : 'tour.example.com', created: 10_000 - i });
  const deployment = (i: number) => ({ uid: i === 0 ? 'dpl_live' : `dpl_${i}`, created: 5000 - i, readyState: 'READY', target: 'production' });
  type Page = Record<string, unknown> & { pagination?: { next?: number | null; count?: number } };
  // Real request limits: domains 50 per page, deployments 100 per page.
  const api = (domains: object[], deployments: object[], mutate: (key: string, body: Page, page: number) => Page = (_k, b) => b) => {
    const inner = pagedApi({ '/v9/projects/prj_1/domains': domains as { created: number }[], '/v6/deployments': deployments as { created: number }[] }, 0, base);
    const pages: Record<string, number> = {};
    return (endpoint: string) => {
      const url = new URL(endpoint, 'https://api.invalid');
      const limit = Number(url.searchParams.get('limit') ?? 0);
      if (!limit) return inner(endpoint);
      const list = url.pathname.includes('/domains') ? domains : deployments;
      const until = url.searchParams.get('until');
      const rest = (list as { created: number }[]).filter(r => until === null || r.created < Number(until));
      const rows = rest.slice(0, limit);
      const key = url.pathname.includes('/domains') ? 'domains' : 'deployments';
      pages[key] = (pages[key] ?? 0) + 1;
      return mutate(key, { [key]: rows, pagination: { count: rows.length, next: rest.length > rows.length ? rows.at(-1)!.created : null } }, pages[key]);
    };
  };
  const read = (get: (e: string) => unknown) => () => readVercelWith(get, { project: '360-tour' });
  const fullDomains = Array.from({ length: 60 }, (_, i) => domain(i));      // page 1 is full (50)
  const fullDeployments = Array.from({ length: 150 }, (_, i) => deployment(i)); // page 1 is full (100)
  // Well-formed: full first pages continue, the shorter terminal pages end with explicit next: null.
  expect(readVercelWith(api(fullDomains, fullDeployments), { project: '360-tour' }).inventory).toEqual({ domainPages: 2, deploymentPages: 2, deployments: 150 });
  for (const key of ['domains', 'deployments']) {
    const drop = (field: 'pagination' | 'next') => (k: string, body: Page, page: number) => {
      if (k !== key || page !== 1) return body;
      if (field === 'pagination') { delete body.pagination; } else { delete body.pagination?.next; }
      return body;
    };
    expect(read(api(fullDomains, fullDeployments, drop('pagination')))).toThrow(new RegExp(`${key} page has no explicit pagination cursor`));
    expect(read(api(fullDomains, fullDeployments, drop('next')))).toThrow(new RegExp(`${key} page has no explicit pagination cursor`));
    expect(read(api(fullDomains, fullDeployments, (k, body, page) => k === key && page === 2 ? { ...body, pagination: { next: (body[k] as unknown[]).length ? 10 ** 9 : null } } : body))).toThrow(/did not advance/);
    expect(read(api(fullDomains, fullDeployments, (k, body) => k === key ? { ...body, [k]: [...(body[k] as unknown[]), ...(body[k] as unknown[])] } : body))).toThrow(/more than the requested/);
  }
  // Caps: more than 10 full pages of domains or production deployments is truncation, not success.
  expect(read(api(Array.from({ length: 501 }, (_, i) => domain(i)), fullDeployments))).toThrow(/domains inventory truncated after 10 pages/);
  expect(read(api(fullDomains, Array.from({ length: 1001 }, (_, i) => deployment(i))))).toThrow(/deployments inventory truncated after 10 pages/);
});

it('flags START_PRODUCTION only where it applies to the production target', () => {
  // The project API's env inventory: key, encrypted value, target array (or a single string), plus other fields.
  const env = (key: string, target: string[] | string) => ({ key, value: 'encrypted-not-read', type: 'encrypted', target, id: `env_${key}` });
  const snap = (...entries: ReturnType<typeof env>[]) => vercelSnapshot(raw({ env: entries }));
  expect(snap(env('START_PRODUCTION', ['production', 'preview'])).project.env).toEqual(['START_PRODUCTION@preview,production']);
  expect(JSON.stringify(snap(env('START_PRODUCTION', ['production'])))).not.toContain('encrypted-not-read');
  expect(startProductionInProduction(snap(env('START_PRODUCTION', ['preview', 'production'])))).toEqual(['START_PRODUCTION@preview,production']);
  expect(startProductionInProduction(snap(env('START_PRODUCTION', 'production')))).toEqual(['START_PRODUCTION@production']);
  expect(startProductionInProduction(snap(env('START_PRODUCTION', ['preview'])))).toEqual([]);
  expect(startProductionInProduction(snap(env('START_PRODUCTION', ['development', 'preview'])))).toEqual([]);
  expect(startProductionInProduction(snap(env('START_PRODUCTION_NOTE', ['production']), env('FRONTEND', ['production'])))).toEqual([]);
  expect(vercelFindings(snap(env('START_PRODUCTION', ['preview', 'production'])), sides).startProductionInProduction).toEqual(['START_PRODUCTION@preview,production']);
});

it('fails the opt-in START_PRODUCTION gate closed when the env inventory is missing or malformed', () => {
  const env = (key: string, target: unknown) => ({ key, value: 'encrypted-not-read', type: 'encrypted', target });
  const variants: Record<string, unknown> = { missing: undefined, null: null, object: { key: 'START_PRODUCTION' }, 'no key': [{ value: 'encrypted-not-read', target: ['production'] }], 'bad target': [env('START_PRODUCTION', 7)] };
  for (const [name, value] of Object.entries(variants)) {
    const r = raw({ env: value });
    if (value === undefined) delete (r.project as Record<string, unknown>).env;
    const snap = vercelSnapshot(r); // the diagnostic snapshot is still produced
    expect(snap.envInventory, name).toBe(name === 'missing' || name === 'null' ? 'missing' : 'malformed');
    expect(snap.project.env, name).toEqual([]);
    expect(JSON.stringify(snap)).not.toContain('encrypted-not-read');
    expect(startProductionGate(snap), name).toMatchObject({ ok: false, reason: expect.stringMatching(/cannot prove START_PRODUCTION is absent/) });
  }
  expect(startProductionGate(vercelSnapshot(raw({ env: [] })))).toEqual({ ok: true });
  expect(startProductionGate(vercelSnapshot(raw({ env: [env('START_PRODUCTION', ['preview']), env('X', undefined)] })))).toEqual({ ok: true });
  expect(startProductionGate(vercelSnapshot(raw({ env: [env('START_PRODUCTION', 'production')] })))).toMatchObject({ ok: false, reason: expect.stringMatching(/applies to production/) });
  // A pre-existing snapshot file without envInventory never passes the gate.
  expect(startProductionGate({ project: { env: [] } }).ok).toBe(false);
});

const run = promisify(execFile);
const listen = async (handler: Parameters<typeof createServer>[1]) => {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
};

it('sends operator headers to the requested origin only and never prints them', async () => {
  const BYPASS = 'bypass-secret-' + 'f'.repeat(16), TOKEN = 'hold-token-' + 'e'.repeat(16);
  const seenA: IncomingHttpHeaders[] = [], seenB: IncomingHttpHeaders[] = [];
  const other = await listen((request, response) => { seenB.push(request.headers); response.end('elsewhere'); });
  const page = '<html lang="th"><script src="/assets/main-abc.js"></script>pk_live_x</html>';
  let unheld = '';
  const methods = new Set<string>();
  const site = await listen((request, response) => {
    seenA.push(request.headers); methods.add(request.method ?? '');
    const url = new URL(request.url ?? '/', 'http://x');
    if (request.headers[HOLD_HEADER] !== TOKEN && !url.pathname.startsWith('/api/instagram/') && url.pathname !== unheld) { response.writeHead(503, { 'retry-after': '600' }); return response.end('held'); }
    if (url.pathname === '/robots.txt') { response.writeHead(302, { location: `${other.base}/steal` }); return response.end(); } // cross-origin redirect
    if (url.pathname.startsWith('/api/instagram/')) { response.writeHead(403); return response.end('Forbidden'); }
    if (url.pathname.includes('__smoke-missing')) { response.writeHead(404); return response.end(page); }
    response.end(page);
  });
  try {
    const secrets = mkdtempSync(join(tmpdir(), 'hold-secret-'));
    writeFileSync(join(secrets, 'hold.token'), `${TOKEN}\n`, { mode: 0o600 });
    // Hold token from a mode-600 file (the documented path), bypass from the environment: both channels covered.
    const env = { ...process.env, VERCEL_PROTECTION_BYPASS: BYPASS, CUTOVER_HOLD_TOKEN_FILE: join(secrets, 'hold.token') };
    const cli = ['scripts/cutover-rehearsal.mjs', 'public-smoke', '--url', site.base, '--expect-hold'];
    const result = await run(process.execPath, cli, { env }).then(r => ({ ...r, code: 0 }), (e: { stdout: string, stderr: string, code: number }) => e);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain(BYPASS);
    expect(output).not.toContain(TOKEN);
    const pass = JSON.parse(result.stdout).passes[0];
    expect(Object.keys(pass.hold)).toEqual(HOLD_PROBE_PATHS);
    for (const p of HOLD_PROBE_PATHS) expect(pass.hold[p]).toMatchObject({ status: 503, retryAfter: '600' });
    expect(pass.failures).toEqual(['robots: 302 ≠ 200']); // the redirect is reported, not followed
    expect(seenB).toEqual([]); // the other origin was never contacted
    const withHold = seenA.filter(h => h[HOLD_HEADER] === TOKEN);
    expect(withHold.length).toBe(seenA.length - HOLD_PROBE_PATHS.length); // all but the anonymous hold probes
    expect([...methods]).toEqual(['GET']);
    // A stub that leaves the villa-cache callback (or a guest path) unheld fails --expect-hold.
    for (const path of ['/api/internal/villa-cache', '/admin']) {
      unheld = path;
      const failed = await run(process.execPath, cli, { env }).then(() => null, (e: { stdout: string }) => e);
      expect(JSON.parse(failed?.stdout ?? '{}').passes[0].failures).toContain(`hold ${path}: 200 without the hold header, not the route's 503`);
    }
    unheld = '';
    expect(seenA.every(h => h['x-vercel-protection-bypass'] === BYPASS)).toBe(true);
    // Resolving to another origin throws before any request.
    await expect(originFetch(site.base, `//127.0.0.1:${new URL(other.base).port}/x`, { a: 'b' })).rejects.toThrow(/another origin/);
    await expect(originFetch(site.base, `${other.base}/x`, {})).rejects.toThrow(/another origin/);
    expect(seenB).toEqual([]);
    rmSync(secrets, { recursive: true, force: true });
  } finally { site.server.close(); other.server.close(); }
  expect(operatorHeaders({})).toEqual({});
  expect(judgeHoldProbe({ '/': { status: 503, retryAfter: null, platformError: null } })).toEqual(['hold /: 503 without Retry-After', 'hold /rooms/pool-villa?tour=1: not observed', 'hold /admin: not observed', 'hold /api/internal/villa-cache: not observed']);
  expect(judgeHoldProbe(Object.fromEntries(HOLD_PROBE_PATHS.map(p => [p, { status: 503, retryAfter: '600', platformError: p === '/admin' ? 'NOT_FOUND' : null }])))).toEqual(['hold /admin: 503 (NOT_FOUND) without the hold header, not the route\'s 503']);
  // Plain http only on loopback, for both smoke tools.
  expect(smokeUrl('https://tour.example.com')).toBe('https://tour.example.com/');
  for (const ok of ['http://127.0.0.1:3000', 'http://localhost:5173/x', 'http://[::1]:8080']) expect(() => smokeUrl(ok)).not.toThrow();
  for (const bad of ['http://tour.example.com', 'http://127.0.0.1.evil.example', 'http://localhost.evil.example', 'ftp://127.0.0.1', undefined, 'not a url']) expect(() => smokeUrl(bad), String(bad)).toThrow();
  const tourCli = await run(process.execPath, ['scripts/tour-smoke.mjs', '--url', 'http://tour.example.com']).then(() => null, (e: { stderr: string }) => e);
  expect(tourCli?.stderr).toMatch(/plain http only on loopback/);
  expect(operatorHeaders({ CUTOVER_HOLD_TOKEN: 't' })).toEqual({ [HOLD_HEADER]: 't' });
});

it('adds tour-smoke operator headers to same-origin requests without following redirects', async () => {
  const { handleRequest } = await import('../../scripts/tour-smoke.mjs');
  const calls: unknown[][] = [];
  const fakeRoute = (url: string, method = 'GET') => ({
    request: () => ({ url: () => url, method: () => method, headers: () => ({ accept: '*/*' }) }),
    fetch: async (o: unknown) => { calls.push(['fetch', url, o]); return { status: 302 }; },
    fulfill: async (o: unknown) => { calls.push(['fulfill', url, o]); },
    continue: async (...a: unknown[]) => { calls.push(['continue', url, ...a]); },
    abort: async () => { calls.push(['abort', url]); },
  });
  const blocked = { analytics: 0, writes: 0, convexWrites: 0, writeHosts: [] as string[] };
  const op = { 'x-vercel-protection-bypass': 'b', [HOLD_HEADER]: 't' };
  const origin = 'https://tour.example.com';
  await handleRequest(fakeRoute(`${origin}/rooms/a`), origin, op, blocked);
  await handleRequest(fakeRoute('https://evil.example.net/x'), origin, op, blocked);
  await handleRequest(fakeRoute(`${origin}/rooms/a`), origin, {}, blocked);
  expect(calls).toEqual([
    ['fetch', `${origin}/rooms/a`, { headers: { accept: '*/*', ...op }, maxRedirects: 0 }],
    ['fulfill', `${origin}/rooms/a`, { response: { status: 302 } }], // the browser follows it as a new, intercepted request
    ['continue', 'https://evil.example.net/x'],
    ['continue', `${origin}/rooms/a`],
  ]);
});

it('reads hold and bypass secrets from private files only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'secret-'));
  try {
    const file = join(dir, 's');
    writeFileSync(file, 'abc\n', { mode: 0o600 });
    expect(readSecret({ X_FILE: file, X: 'env' }, 'X')).toBe('abc'); // the file wins
    expect(readSecret({ X: 'env' }, 'X')).toBe('env');
    expect(readSecret({}, 'X')).toBeUndefined();
    chmodSync(file, 0o644);
    expect(() => readSecret({ X_FILE: file }, 'X')).toThrow(/mode 600/);
    writeFileSync(file, '\n'); chmodSync(file, 0o600);
    expect(() => readSecret({ X_FILE: file }, 'X')).toThrow(/empty/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const PROD = 'tour.helpgueststay.com';
const INSTAGRAM_ROUTE = { id: 'r_ig', name: 'Phase 2 Instagram ingress migration', enabled: true, staged: false, srcSyntax: 'regex', routeType: 'rewrite', route: { src: '^/api/instagram/webhook$', dest: 'https://wary-toad-189.convex.site/instagram/webhook' } };

it('holds only the Stage 0 production hosts and leaves Previews and immutable URLs unaffected', () => {
  const TOKEN = 'a'.repeat(48);
  const routes = [INSTAGRAM_ROUTE, holdRoute(TOKEN, [PROD])];
  const staged = '360-tour-k3j2h1g0f-team.vercel.app', stage0Url = '360-tour-bxw8p9svh-team.vercel.app';
  const good = judgeHold(routes, TOKEN, { hosts: [PROD], otherHosts: [staged, stage0Url] });
  expect(good.failures).toEqual([]);
  expect(good.unaffectedHosts).toEqual(expect.arrayContaining([staged, stage0Url, '360-tour-git-feature-team.vercel.app', 'other-project-abc123-team.vercel.app', `x${PROD}`, `${PROD}.evil.example`]));
  expect(JSON.stringify(good)).not.toContain(TOKEN);
  // The identical guest path: held on the production domain, untouched on another project's Preview and the staged URL.
  for (const path of ['/rooms/pool-villa?tour=1', '/']) {
    expect(evaluateRoutes(routes, { host: PROD, path })).toMatchObject({ outcome: 'status', status: 503 });
    expect(evaluateRoutes(routes, { host: 'other-project-abc123-team.vercel.app', path })).toEqual({ outcome: 'deployment' });
    expect(evaluateRoutes(routes, { host: staged, path })).toEqual({ outcome: 'deployment' });
  }
  const mutate = (fn: (r: ReturnType<typeof holdRoute>) => void) => { const r = holdRoute(TOKEN, [PROD]); fn(r); return judgeHold([INSTAGRAM_ROUTE, r], TOKEN, { hosts: [PROD], otherHosts: [staged] }); };
  expect(mutate(r => { r.route.has = []; }).failures).toContain(`/rooms/pool-villa?tour=1 on ${staged} unaffected: status:503 ≠ deployment`); // unscoped hold
  expect(mutate(r => { r.route.src = '^/(?!api/instagram/webhook).*$'; }).failures).toEqual([`instagram exemption is exact (trailing slash) on ${PROD}: deployment ≠ status:503`, `instagram exemption is exact (suffix) on ${PROD}: deployment ≠ status:503`]);
  expect(mutate(r => { r.route.missing = []; }).failures).toContain(`operator passes on ${PROD}: status:503 ≠ deployment`);
  expect(mutate(r => { r.route.missing = [{ type: 'header', key: HOLD_HEADER, value: TOKEN.slice(0, 8) + '.*' }]; }).ok).toBe(false); // a prefix must not pass
  expect(mutate(r => { r.route.status = 403; }).ok).toBe(false);
  expect(mutate(r => { r.enabled = false; }).ok).toBe(false);
  expect(mutate(r => { r.route.has = [{ type: 'host', value: { eq: PROD } } as never]; }).ok).toBe(true);
  expect(() => mutate(r => { r.route.has = [{ type: 'host', value: { re: PROD } } as never]; })).toThrow(/unsupported condition value/);
  expect(() => mutate(r => { r.route.missing = [{ type: 'cookie', key: 'x', value: TOKEN }]; })).toThrow(/unsupported condition type/);
  expect(judgeHold([INSTAGRAM_ROUTE], TOKEN, { hosts: [PROD] }).failures[0]).toBe(`no route named "${HOLD_ROUTE_NAME}"`);
  expect(judgeHold([holdRoute(TOKEN, [PROD]), INSTAGRAM_ROUTE], TOKEN, { hosts: [PROD] }).failures).toContain('hold route is not the last route');
  expect(evaluateRoutes([holdRoute(TOKEN, [PROD])], { host: PROD, path: '/' }, false)).toEqual({ outcome: 'deployment' }); // staged excluded
  // Two production domains: both held, exactly.
  const two = judgeHold([INSTAGRAM_ROUTE, holdRoute(TOKEN, [PROD, 'www.helpgueststay.com'])], TOKEN, { hosts: [PROD, 'www.helpgueststay.com'] });
  expect(two.failures).toEqual([]);
  // Reopen: the hold is gone and nothing is held.
  expect(judgeHold([INSTAGRAM_ROUTE], TOKEN, { hosts: [PROD], reopen: true, baseline: [INSTAGRAM_ROUTE] }).failures).toEqual([]);
  expect(judgeHold(routes, TOKEN, { hosts: [PROD], reopen: true }).ok).toBe(false);
});

it('refuses to stage over unrelated routing changes and keeps the token off the printed plan', async () => {
  const TOKEN = 'b'.repeat(48);
  const stage0 = { snapshot: { live: { domains: [PROD], url: '360-tour-bxw8p9svh-team.vercel.app' }, routes: [{ name: INSTAGRAM_ROUTE.name, enabled: true, src: INSTAGRAM_ROUTE.route.src, dest: INSTAGRAM_ROUTE.route.dest }] } };
  const current = { routes: [INSTAGRAM_ROUTE], version: { id: 'v_live' } };
  const versions = { versions: [{ id: 'v_live', isLive: true, isStaging: null }] };
  const plan = planHold({ stage0, current, versions, token: TOKEN });
  expect(plan.body).toEqual(holdRequestBody(TOKEN, [PROD]));
  expect(plan.body.position).toEqual({ placement: 'end' });
  expect(plan.body.route.route.has).toEqual([{ type: 'host', value: '^(?:tour\\.helpgueststay\\.com)$' }]);
  expect(plan.summary).toMatchObject({ hosts: [PROD], liveRoutesVersion: 'v_live', existingRoutes: 1, matchesStage0Routes: true });
  expect(JSON.stringify(plan.summary)).not.toContain(TOKEN);
  expect(() => planHold({ stage0, current, versions: { versions: [...versions.versions, { id: 'v_other', isStaging: true }] }, token: TOKEN })).toThrow(/staged routes version already exists \(v_other\)/);
  expect(() => planHold({ stage0, current: { ...current, version: { id: 'v_old' } }, versions, token: TOKEN })).toThrow(/not the live version/);
  expect(() => planHold({ stage0: { snapshot: { live: {} } }, current, versions, token: TOKEN })).toThrow(/no snapshot.live.domains/);
  expect(() => planHold({ stage0, current: { routes: [INSTAGRAM_ROUTE, holdRoute(TOKEN, [PROD])], version: { id: 'v_live' } }, versions, token: TOKEN })).toThrow(/already exists/);
  // The live routing version id is required, as the routes GET returns it ({routes, version: {id}}).
  expect(() => planHold({ stage0, current: { routes: [INSTAGRAM_ROUTE] }, versions, token: TOKEN })).toThrow(/no version.id/);
  expect(() => planHold({ stage0, current: { routes: [INSTAGRAM_ROUTE], version: {} }, versions, token: TOKEN })).toThrow(/no version.id/);
  expect(() => planHold({ stage0, current, versions: { versions: [{ id: 'v_live', isLive: false }] }, token: TOKEN })).toThrow(/exactly one live/);
  // Staged version with an unrelated edit next to the hold: the baseline check fails before publish.
  const edited = { ...INSTAGRAM_ROUTE, route: { ...INSTAGRAM_ROUTE.route, dest: 'https://elsewhere.example/hook' } };
  expect(judgeHold([edited, holdRoute(TOKEN, [PROD])], TOKEN, { hosts: [PROD], baseline: [INSTAGRAM_ROUTE] }).failures).toContain('non-hold routes differ from the baseline (1 vs 1 routes)');
  expect(judgeHold([INSTAGRAM_ROUTE, holdRoute(TOKEN, [PROD])], TOKEN, { hosts: [PROD], baseline: [INSTAGRAM_ROUTE] }).ok).toBe(true);
  // The CLI: hold-plan writes a new mode-600 body and prints no token; hold-check reads the token from a file.
  const dir = mkdtempSync(join(tmpdir(), 'hold-'));
  try {
    const f = (name: string, data: unknown) => { const p = join(dir, name); writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 }); return p; };
    const env = { ...process.env, CUTOVER_HOLD_TOKEN_FILE: f('hold.token', TOKEN) };
    const argv = ['scripts/cutover-rehearsal.mjs', 'hold-plan', '--stage0', f('stage0.json', stage0), '--routes', f('live.json', current), '--versions', f('versions.json', versions), '--out', join(dir, 'body.json')];
    const planned = await run(process.execPath, argv, { env });
    expect(planned.stdout + planned.stderr).not.toContain(TOKEN);
    expect(statSync(join(dir, 'body.json')).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(join(dir, 'body.json'), 'utf8'))).toEqual(plan.body);
    await expect(run(process.execPath, argv, { env })).rejects.toMatchObject({ stderr: expect.stringMatching(/EEXIST/) }); // never overwritten
    const stagedFile = f('staged.json', { routes: [INSTAGRAM_ROUTE, { ...holdRoute(TOKEN, [PROD]), id: 'r_hold' }] });
    const checked = await run(process.execPath, ['scripts/cutover-rehearsal.mjs', 'hold-check', '--routes', stagedFile, '--stage0', join(dir, 'stage0.json'), '--baseline', join(dir, 'live.json'), '--other-host', '360-tour-k3j2h1g0f-team.vercel.app'], { env });
    expect(checked.stdout + checked.stderr).not.toContain(TOKEN);
    expect(JSON.parse(checked.stdout)).toMatchObject({ source: 'routes-file', ok: true, holdRoute: { position: 1 } });
    const reopened = await run(process.execPath, ['scripts/cutover-rehearsal.mjs', 'hold-check', '--routes', join(dir, 'live.json'), '--stage0', join(dir, 'stage0.json'), '--baseline', join(dir, 'live.json'), '--reopen'], { env });
    expect(JSON.parse(reopened.stdout)).toMatchObject({ ok: true, holdRoute: null });
    const synthetic = await run(process.execPath, ['scripts/cutover-rehearsal.mjs', 'hold-check']);
    expect(JSON.parse(synthetic.stdout)).toMatchObject({ source: 'synthetic', ok: true, hosts: [PROD] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // Snapshots keep the hold's condition types and keys and the routes version, never the token.
  const withHold = vercelSnapshot({ ...raw(), routes: { routes: [INSTAGRAM_ROUTE, holdRoute(TOKEN, [PROD])], version: { id: 'v_live', ruleCount: 2 } } });
  expect(JSON.stringify(withHold)).not.toContain(TOKEN);
  expect(withHold.routesVersion).toEqual({ id: 'v_live', ruleCount: 2 });
  expect(withHold.routes[1]).toMatchObject({ status: 503, conditions: ['has host:', `missing header:${HOLD_HEADER}`] });
  expect(vercelFindings(withHold, sides).maintenanceHold).toEqual([{ enabled: true, staged: true, status: 503 }]);
  expect(vercelFindings(vercelSnapshot(raw()), sides).maintenanceHold).toEqual([]);
});

it('gates production env on independent per-target inventories, names only', () => {
  const env = (key: string, target: unknown) => ({ key, value: `value-of-${key}`, type: 'encrypted', target });
  const prodEnv = [env('CLERK_SECRET_KEY', ['production', 'preview']), env('START_VILLA_INVALIDATION_SECRET', ['production']), env('START_VILLA_INVALIDATION_ORIGIN', 'production'), env('FRONTEND', ['preview'])];
  const shared = (rows: unknown[]) => ({ data: rows, pagination: { count: rows.length, next: null, prev: null } });
  const snap = (o: { embedded?: unknown, list?: unknown, sharedEnv?: unknown } = {}) =>
    vercelSnapshot({ ...raw({ env: o.embedded ?? prodEnv }), envList: o.list === undefined ? { envs: prodEnv, hiddenProductionEnvCount: 0 } : o.list, sharedEnv: o.sharedEnv === undefined ? shared([]) : o.sharedEnv });
  const good = snap();
  expect(good.productionEnv.list).toEqual({ state: 'ok', names: ['CLERK_SECRET_KEY', 'START_VILLA_INVALIDATION_ORIGIN', 'START_VILLA_INVALIDATION_SECRET'] });
  expect(JSON.stringify(good)).not.toMatch(/value-of-/);
  // START_VILLA_INVALIDATION_* are legitimate; a Preview-only FRONTEND is ignored.
  expect(productionEnvGate(good)).toEqual({ ok: true, failures: [] });
  for (const name of FORBIDDEN_PRODUCTION_ENV) {
    const withIt = [...prodEnv, env(name, ['preview', 'production'])];
    expect(productionEnvGate(snap({ embedded: withIt, list: { envs: withIt, hiddenProductionEnvCount: 0 } })).failures, name).toEqual([`${name} applies to production: remove it before this step (use a per-deployment --build-env instead)`]);
  }
  // A linked shared variable counts; one linked to another project does not.
  expect(productionEnvGate(snap({ sharedEnv: shared([{ ...env('FRONTEND_ONLY_CONVEX_URL', ['production']), projectId: ['prj_1'] }]) })).failures).toEqual(['FRONTEND_ONLY_CONVEX_URL applies to production (linked shared variable): remove it before this step (use a per-deployment --build-env instead)']);
  expect(productionEnvGate(snap({ sharedEnv: shared([{ ...env('FRONTEND', ['production']), projectId: ['prj_other'] }]) })).ok).toBe(true);
  // Fail closed: hidden production entries, a further page, an unavailable or malformed source, disagreement.
  expect(productionEnvGate(snap({ list: { envs: prodEnv, hiddenProductionEnvCount: 2 } })).failures).toEqual(['list production env inventory hidden production entries (2): cannot prove the frontend selectors are absent']);
  expect(productionEnvGate(snap({ list: { envs: prodEnv, pagination: { next: 123 } } })).ok).toBe(false);
  expect(productionEnvGate(snap({ list: null })).failures).toEqual(['list production env inventory unavailable: cannot prove the frontend selectors are absent']);
  expect(productionEnvGate(snap({ sharedEnv: null })).failures).toEqual(['shared production env inventory unavailable: cannot prove the frontend selectors are absent']);
  expect(productionEnvGate(snap({ sharedEnv: { data: [{ key: 'X', target: ['production'] }], pagination: { next: null } } })).ok).toBe(false); // no projectId array
  expect(productionEnvGate(snap({ list: { envs: prodEnv.slice(1), hiddenProductionEnvCount: 0 } })).failures).toEqual(['project env inventories disagree (only embedded: CLERK_SECRET_KEY; only listed: -)']);
  // The names-only pin.
  const pin = ['CLERK_SECRET_KEY', 'START_VILLA_INVALIDATION_ORIGIN', 'START_VILLA_INVALIDATION_SECRET'];
  expect(productionEnvGate(good, pin).ok).toBe(true);
  expect(productionEnvGate(good, [...pin.slice(1), 'SITE_URL']).failures).toEqual(['production env names differ from the pinned list (unexpected: CLERK_SECRET_KEY; missing: SITE_URL)']);
  expect(productionEnvInventories({ id: 'prj_1', env: [] }, undefined, undefined).list.state).toBe('unavailable');
});

