#!/usr/bin/env node
// Start Sentry smoke: the production Start build's own browser and server Sentry initialization
// each send a synthetic exception to a loopback capture transport, the display pairing secret is
// scrubbed, and no source maps are published. No Sentry account, credentials or debug route.
//
//   node scripts/heavy.mjs node scripts/sentry-smoke.mjs [--skip-build] [--out <proof.json>]
//
// The DSN is baked into the browser bundle at build time, so the capture port is fixed.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const root = process.cwd();
const capturePort = 47911;
const appPort = 47912;
const projectId = '4242';
const dsn = `http://sentrysmokepublickey@127.0.0.1:${capturePort}/${projectId}`;
const secret = `smoke-${randomBytes(9).toString('hex')}`;
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
// Syntactically valid production-instance Clerk keys for an unresolvable domain: signed-out
// requests need no Clerk network access, and the browser blocks every non-loopback request.
const clerkPublishable = `pk_live_${Buffer.from('clerk.sentry-smoke.invalid$').toString('base64')}`;
// Inherit the shell (PATH, heavy-slot marker) but never Sentry credentials or real app keys.
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SENTRY|CLERK|CONVEX|POSTHOG|SITE_URL/.test(key)));
const env = {
  ...inherited, NODE_ENV: 'production',
  VITE_SENTRY_DSN: dsn, SENTRY_DSN: dsn,
  VITE_CONVEX_URL: `http://127.0.0.1:${capturePort}`, VITE_CONVEX_SITE_URL: `http://127.0.0.1:${capturePort}`,
  VITE_SITE_URL: `http://localhost:${appPort}`, SITE_URL: `http://localhost:${appPort}`,
  VITE_CLERK_PUBLISHABLE_KEY: clerkPublishable, CLERK_PUBLISHABLE_KEY: clerkPublishable,
  CLERK_SECRET_KEY: `sk_live_${'0'.repeat(40)}`,
  VITEST_MAX_WORKERS: '2',
};

/** @param {Buffer} body @param {string | undefined} encoding */
function parseEnvelope(body, encoding) {
  const text = (encoding === 'gzip' ? gunzipSync(body) : body).toString('utf8');
  const [header, ...rest] = text.split('\n');
  const items = [];
  for (let index = 0; index + 1 < rest.length; index += 2) {
    if (!rest[index]) continue;
    items.push({ header: JSON.parse(rest[index]), payload: rest[index + 1] });
  }
  return { header: JSON.parse(header), items, text };
}

const envelopes = [];
const capture = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', '*');
    if (request.method === 'OPTIONS') return response.end();
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${capturePort}`);
    if (url.pathname === `/api/${projectId}/envelope/`) {
      const key = url.searchParams.get('sentry_key') ?? /sentry_key=([^,\s]+)/.exec(String(request.headers['x-sentry-auth'] ?? ''))?.[1];
      envelopes.push({ ...parseEnvelope(Buffer.concat(chunks), request.headers['content-encoding']), dsnKeyMatches: key === 'sentrysmokepublickey' });
      response.setHeader('content-type', 'application/json');
      return response.end('{}');
    }
    // Minimal anonymous Convex query stub so SSR renders without a backend.
    if (url.pathname === '/api/query') {
      const name = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}').path ?? '';
      response.setHeader('content-type', 'application/json');
      return response.end(JSON.stringify({ status: 'success', value: String(name).endsWith('featuredReviews') ? [] : null, logLines: [] }));
    }
    response.statusCode = 404;
    response.end();
  });
});

/** @param {string} command @param {string[]} commandArgs @param {Record<string, string | undefined>} extra */
function run(command, commandArgs, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (chunk) => { log += chunk; });
    child.stderr.on('data', (chunk) => { log += chunk; });
    child.on('close', (code) => (code ? reject(new Error(`${command} failed (${code}):\n${log.slice(-4000)}`)) : resolve(log)));
  });
}

/** @param {() => Promise<boolean> | boolean} check @param {string} label */
async function waitFor(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Every built file, relative to `.output`. @param {string} dir @returns {Promise<string[]>} */
async function files(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.relative(path.join(root, '.output'), path.join(entry.parentPath, entry.name)));
}

/** JSON paths (never values) where the secret appears, per envelope item type. */
function secretLocations() {
  const found = [];
  const walk = (value, where) => {
    if (typeof value === 'string') { if (value.includes(secret)) found.push(where); }
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, `${where}.${key}`);
  };
  for (const envelope of envelopes) {
    walk(envelope.header, 'envelope');
    for (const item of envelope.items) {
      let payload;
      try { payload = JSON.parse(item.payload); } catch { payload = item.payload; }
      walk(payload, item.header.type);
    }
  }
  return found;
}

const eventFor = (message) => envelopes.flatMap((envelope) => envelope.items
  .filter((item) => item.header.type === 'event')
  .map((item) => ({ envelope, event: JSON.parse(item.payload) })))
  .find(({ event }) => event.exception?.values?.some((value) => value.value === message));

let server;
let browser;
let failed = false;
try {
  await new Promise((resolve) => capture.listen(capturePort, '127.0.0.1', resolve));
  if (!args.includes('--skip-build')) {
    if (process.env.SENTRY_AUTH_TOKEN) throw new Error('Unset SENTRY_AUTH_TOKEN: the smoke proves a credential-free build');
    await run('bun', ['run', 'build']);
  }

  // Source maps: none in the public assets, and no public file references one.
  const publicFiles = await files(path.join(root, '.output/public'));
  const publicMaps = publicFiles.filter((file) => file.endsWith('.map'));
  const mapReferences = [];
  for (const file of publicFiles.filter((name) => /\.(?:m?js|css)$/.test(name))) {
    if ((await fs.readFile(path.join(root, '.output', file), 'utf8')).includes('sourceMappingURL=')) mapReferences.push(file);
  }
  const serverMaps = (await files(path.join(root, '.output/server'))).filter((file) => file.endsWith('.map'));

  server = spawn('node', ['--import', path.join(root, 'scripts', 'sentry-smoke-preload.mjs'), path.join(root, '.output', 'server', 'index.mjs')], {
    // Server output stays unread: the preload's own console line contains the secret.
    cwd: root, env: { ...env, PORT: String(appPort), SENTRY_SMOKE_SECRET: secret }, stdio: 'ignore',
  });
  await waitFor(async () => { try { return (await fetch(`http://localhost:${appPort}/display`)).status < 500; } catch { return false; } }, 'Start server');

  // Server: synthetic unhandled rejection through the application's own initialization.
  server.kill('SIGUSR2');
  await waitFor(() => Boolean(eventFor('start-sentry-smoke-server')), 'server exception envelope');

  // Browser: the client bundle's own initialization on a display pairing URL.
  browser = await chromium.launch();
  const context = await browser.newContext();
  const outbound = [];
  await context.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    if (hostname === '127.0.0.1' || hostname === 'localhost') return route.continue();
    outbound.push(hostname);
    return route.abort();
  });
  const page = await context.newPage();
  // The SDK drops the fragment from request.url; the query form exercises the event URL scrub.
  await page.goto(`http://localhost:${appPort}/display?pair=${secret}#pair=${secret}`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const carrier = /** @type {Record<string, any> | undefined} */ (/** @type {any} */ (window).__SENTRY__);
    return Boolean(carrier && Object.values(carrier).some((entry) => entry?.defaultCurrentScope?.getClient?.()));
  }, undefined, { timeout: 30000 });
  await page.evaluate(() => { setTimeout(() => { throw new Error('start-sentry-smoke-client'); }, 0); });
  await waitFor(() => Boolean(eventFor('start-sentry-smoke-client')), 'browser exception envelope');

  const serverEvent = eventFor('start-sentry-smoke-server');
  const clientEvent = eventFor('start-sentry-smoke-client');
  const allText = envelopes.map((envelope) => envelope.text).join('\n');
  const serverCrumb = serverEvent.event.breadcrumbs?.find((crumb) => crumb.message?.includes('sentry smoke navigation'));
  const proof = {
    schemaVersion: 1,
    capture: 'loopback HTTP transport (no Sentry account or credentials)',
    sourceMaps: { publicMapFiles: publicMaps.length, publicSourceMappingUrlReferences: mapReferences.length, serverMapFiles: serverMaps.length, authTokenPresent: false },
    server: {
      sdk: serverEvent.event.sdk?.name, platform: serverEvent.event.platform,
      exception: serverEvent.event.exception.values.at(-1).value, mechanism: serverEvent.event.exception.values.at(-1).mechanism?.type,
      envelopeDsnMatches: serverEvent.envelope.dsnKeyMatches,
      pairingBreadcrumb: serverCrumb ? serverCrumb.message.replace(/smoke-[0-9a-f]+/, '<secret>') : null,
    },
    browser: {
      sdk: clientEvent.event.sdk?.name, platform: clientEvent.event.platform,
      exception: clientEvent.event.exception.values.at(-1).value, mechanism: clientEvent.event.exception.values.at(-1).mechanism?.type,
      envelopeDsnMatches: clientEvent.envelope.dsnKeyMatches,
      requestUrl: clientEvent.event.request?.url,
      blockedOutboundRequests: outbound.length,
    },
    envelopesCaptured: envelopes.length,
    secretInAnyEnvelope: allText.includes(secret),
    secretLocations: secretLocations(),
    envelopeHeaderKeys: [...new Set(envelopes.flatMap((envelope) => Object.keys(envelope.header)))].sort(),
    itemTypes: [...new Set(envelopes.flatMap((envelope) => envelope.items.map((item) => item.header.type)))].sort(),
  };
  const checks = {
    noPublicSourceMaps: publicMaps.length === 0 && mapReferences.length === 0,
    serverEnvelope: proof.server.exception === 'start-sentry-smoke-server' && proof.server.envelopeDsnMatches,
    browserEnvelope: proof.browser.exception === 'start-sentry-smoke-client' && proof.browser.envelopeDsnMatches,
    serverBreadcrumbScrubbed: proof.server.pairingBreadcrumb === 'sentry smoke navigation http://127.0.0.1/display#pair=[redacted]',
    browserUrlScrubbed: typeof proof.browser.requestUrl === 'string' && proof.browser.requestUrl.startsWith(`http://localhost:${appPort}/display`) && !proof.browser.requestUrl.includes(secret),
    secretNeverSent: !proof.secretInAnyEnvelope && proof.secretLocations.length === 0,
  };
  const result = { ...proof, checks, outcome: Object.values(checks).every(Boolean) ? 'pass' : 'fail' };
  console.log(JSON.stringify(result, null, 2));
  if (out) await fs.writeFile(out, JSON.stringify(result, null, 2) + '\n');
  if (result.outcome !== 'pass') failed = true;
} catch (error) {
  console.error(`Sentry smoke failed: ${error.message}`);
  failed = true;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  capture.close();
  process.exitCode = failed ? 1 : 0;
}
