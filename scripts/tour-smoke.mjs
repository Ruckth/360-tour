#!/usr/bin/env node
/**
 * Anonymous, no-mutation browser tour check for a staged deployment or the production alias:
 *   node scripts/tour-smoke.mjs --url https://<host> [--room pool-villa]
 * Opens /rooms/<room>?tour=1 in Chromium with no credentials, waits for the real viewer to report a ready scene,
 * drags, and requires the camera yaw (the app's own __tourBench frame hook) and the canvas pixels to change.
 * Convex Mutation/Action frames and HTTP writes are dropped and recorded; analytics requests are aborted.
 * Operator headers (VERCEL_PROTECTION_BYPASS, CUTOVER_HOLD_TOKEN for the maintenance hold) are attached to same-origin
 * requests only. Those requests are fetched with redirects off, so a redirect elsewhere is followed by the browser as a
 * new request that gets no operator headers.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { operatorHeaders, smokeUrl } from './lib/operator-access.mjs';

const ANALYTICS = /posthog|sentry\.io|\/_vercel\/(insights|speed-insights)|google-analytics|googletagmanager|plausible|segment\.(io|com)/i;

/** Pure: what to do with one HTTP request. @param {string} url @param {string} method @param {string} origin */
export function requestPolicy(url, method, origin) {
  if (ANALYTICS.test(url)) return 'block-analytics';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    return /\.convex\.(cloud|site)\/api\/(mutation|action|run)/.test(url) ? 'block-convex-write' : 'block-write';
  }
  return new URL(url).origin === origin ? 'same-origin' : 'pass';
}

/**
 * One intercepted request. `route` is Playwright's Route (or a test double with the same methods).
 * @param {any} route @param {string} origin @param {Record<string, string>} operator
 * @param {{analytics: number, writes: number, convexWrites: number, writeHosts: string[]}} blocked
 */
export async function handleRequest(route, origin, operator, blocked) {
  const request = route.request();
  const policy = requestPolicy(request.url(), request.method(), origin);
  if (policy === 'block-analytics') { blocked.analytics++; return route.abort(); }
  if (policy === 'block-write' || policy === 'block-convex-write') {
    blocked[policy === 'block-write' ? 'writes' : 'convexWrites']++;
    const host = new URL(request.url()).host; // host only: no path or query, which may carry identifiers
    if (!blocked.writeHosts.includes(host)) blocked.writeHosts.push(host);
    return route.abort();
  }
  if (policy === 'same-origin' && Object.keys(operator).length) {
    // route.continue({headers}) would carry the headers across a redirect; fetch without following instead.
    const response = await route.fetch({ headers: { ...request.headers(), ...operator }, maxRedirects: 0 });
    return route.fulfill({ response });
  }
  return route.continue();
}

/** Pure: a Convex sync-protocol client frame that would write. @param {string | Buffer} message */
export function isConvexWriteFrame(message) {
  try { return ['Mutation', 'Action'].includes(JSON.parse(String(message)).type); } catch { return false; }
}

/** Pure: verdict for one tour run. @param {any} run */
export function judgeTour(run) {
  const failures = [];
  if (run.status !== 200) failures.push(`document ${run.status}`);
  if (!run.sceneReady) failures.push('viewer never reported a ready scene');
  if (run.yawBefore === null || run.yawAfter === null) failures.push('no painted panorama frame observed');
  else if (Math.abs(run.yawAfter - run.yawBefore) < 0.01) failures.push('drag did not turn the camera');
  if (!run.stableBeforeDrag) failures.push('canvas never settled without input (15 s)');
  if (!run.pixelsChanged) failures.push('canvas pixels did not change after drag');
  if (run.blocked.convexWrites) failures.push(`${run.blocked.convexWrites} Convex write attempts`);
  if (run.pageErrors.length) failures.push(`page errors: ${run.pageErrors.slice(0, 3).join(' | ')}`);
  return { ok: failures.length === 0, failures };
}

export async function tourSmoke(/** @type {{base: string, room?: string, headers?: Record<string, string>}} */ o) {
  const { chromium } = await import('@playwright/test');
  const origin = new URL(o.base).origin;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const blocked = { analytics: 0, writes: 0, convexWrites: 0, writeHosts: /** @type {string[]} */ ([]) };
  /** @type {string[]} */ const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(String(error.message).slice(0, 200)));
    await page.route('**/*', route => handleRequest(route, origin, o.headers ?? {}, blocked));
    await page.routeWebSocket(/\.convex\.cloud\//, ws => {
      const server = ws.connectToServer();
      ws.onMessage(message => { if (isConvexWriteFrame(message)) blocked.convexWrites++; else server.send(message); });
      server.onMessage(message => ws.send(message));
    });
    await page.addInitScript(() => {
      /** @type {any} */ const w = window;
      w.__smokeYaw = null;
      w.__tourBench = { mark() {}, frame(/** @type {number} */ yaw) { w.__smokeYaw = yaw; } };
    });
    const response = await page.goto(new URL(`/rooms/${o.room ?? 'pool-villa'}?tour=1`, o.base).href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const sceneReady = await page.waitForFunction(() => document.querySelector('[data-testid="tour-viewer"]')?.getAttribute('data-scene-status') === 'ready'
      && /** @type {any} */ (window).__smokeYaw !== null, null, { timeout: 90_000 }).then(() => true, () => false);
    const canvas = page.locator('[data-testid="tour-viewer"] canvas').first();
    const box = sceneReady ? await canvas.boundingBox() : null;
    let yawBefore = null, yawAfter = null, stableBeforeDrag = false, pixelsChanged = false;
    if (box) {
      const clip = { x: box.x + box.width / 2 - 80, y: box.y + box.height / 2 - 60, width: 160, height: 120 };
      const shot = () => page.screenshot({ clip });
      // Demand rendering settles after the scene crossfade and overlay transitions; require two identical frames
      // 400 ms apart (within 15 s) so a later change can only come from the drag.
      let before = await shot();
      for (let tries = 0; tries < 37 && !stableBeforeDrag; tries++) {
        await page.waitForTimeout(400);
        const next = await shot();
        stableBeforeDrag = next.equals(before);
        before = next;
      }
      yawBefore = await page.evaluate(() => /** @type {any} */ (window).__smokeYaw);
      const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(x, y); await page.mouse.down();
      for (let step = 1; step <= 8; step++) await page.mouse.move(x - step * 30, y);
      await page.mouse.up();
      await page.waitForTimeout(700);
      yawAfter = await page.evaluate(() => /** @type {any} */ (window).__smokeYaw);
      pixelsChanged = !before.equals(await shot());
    }
    const run = { at: new Date().toISOString(), host: new URL(o.base).host, status: response?.status() ?? 0, sceneReady, yawBefore, yawAfter, stableBeforeDrag, pixelsChanged, blocked, pageErrors };
    return { ...run, ...judgeTour(run) };
  } finally { await browser.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), flag = (/** @type {string} */ name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const base = smokeUrl(flag('--url'));
  const result = await tourSmoke({ base, room: flag('--room'), headers: operatorHeaders() });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
