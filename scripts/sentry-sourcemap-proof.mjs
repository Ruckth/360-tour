#!/usr/bin/env node
// Credential-gated Start source-map upload proof against a loopback fake Sentry API.
//
//   node scripts/heavy.mjs node scripts/sentry-sourcemap-proof.mjs [--out <proof.json>]
//
// 1. Plain build (no SENTRY_AUTH_TOKEN): no request reaches the fake API, no maps are published.
// 2. Credentialed build (synthetic token/org/project, SENTRY_URL = loopback): the official
//    @sentry/tanstackstart-react plugin uploads an artifact bundle. Its debug IDs must match the
//    published client and final Nitro server JavaScript, its maps must resolve first-party code
//    to src/**/*.ts(x), and no map, map reference or token may remain in the build output.
// No real Sentry account, credentials or network access is involved.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { comparableCode, evaluateCoverage } from './lib/sentry-coverage.mjs';

const root = process.cwd();
const port = 47921;
const sentryUrl = `http://127.0.0.1:${port}/`;
const token = `sntrys_${randomBytes(24).toString('hex')}`;
const org = 'smoke-org';
const project = 'smoke-project';
const args = process.argv.slice(2);
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/SENTRY/.test(key)));

// ---- Fake Sentry API (chunk upload + artifact bundle assembly) ----
const requests = [];
const events = [];
const dsnProject = '4242';
const dsn = `http://sentryproofpublickey@127.0.0.1:${port}/${dsnProject}`;
const appPort = 47922;
const chunks = new Map();
const bundles = [];
let authorized = true;

/** Minimal multipart parser: returns each part's body. @param {Buffer} body @param {string} type */
function multipartParts(body, type) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(type);
  if (!boundary) return [];
  const marker = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts = [];
  let start = body.indexOf(marker);
  while (start >= 0) {
    const next = body.indexOf(marker, start + marker.length);
    if (next < 0) break;
    const part = body.subarray(start + marker.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split >= 0) parts.push({ headers: part.subarray(0, split).toString(), data: part.subarray(split + 4) });
    start = next;
  }
  return parts;
}

const server = http.createServer((request, response) => {
  const body = [];
  request.on('data', (chunk) => body.push(chunk));
  request.on('end', () => {
    const data = Buffer.concat(body);
    const url = new URL(request.url ?? '/', sentryUrl);
    const runtime = url.pathname === `/api/${dsnProject}/envelope/` || url.pathname === '/api/query';
    if (!runtime) {
      requests.push({ method: request.method, path: url.pathname });
      if (request.headers.authorization !== `Bearer ${token}`) authorized = false;
    }
    const json = (value) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); };
    if (url.pathname === `/api/0/organizations/${org}/chunk-upload/`) {
      if (request.method === 'GET') {
        return json({
          url: `${sentryUrl}api/0/organizations/${org}/chunk-upload/`, chunkSize: 8388608, chunksPerRequest: 64,
          maxFileSize: 2147483648, maxRequestSize: 33554432, concurrency: 1, hashAlgorithm: 'sha1',
          compression: ['gzip'], accept: ['artifact_bundles', 'artifact_bundles_v2', 'release_files', 'sources', 'debug_files'],
        });
      }
      for (const part of multipartParts(data, String(request.headers['content-type']))) {
        const raw = /gzip/.test(part.headers) || (part.data[0] === 0x1f && part.data[1] === 0x8b) ? gunzipSync(part.data) : part.data;
        chunks.set(createHash('sha1').update(raw).digest('hex'), raw);
      }
      return json({});
    }
    if (url.pathname === `/api/${dsnProject}/envelope/`) {
      const text = (request.headers['content-encoding'] === 'gzip' ? gunzipSync(data) : data).toString('utf8');
      const lines = text.split('\n');
      for (let index = 1; index + 1 < lines.length; index += 2) {
        if (lines[index] && JSON.parse(lines[index]).type === 'event') events.push(JSON.parse(lines[index + 1]));
      }
      return json({});
    }
    if (url.pathname === '/api/query') {
      return json({ status: 'success', value: null, logLines: [] });
    }
    if (/\/artifactbundle\/assemble\/$/.test(url.pathname)) {
      const { checksum, chunks: wanted = [] } = JSON.parse(data.toString() || '{}');
      const missing = wanted.filter((sum) => !chunks.has(sum));
      if (missing.length === 0 && !bundles.some((bundle) => bundle.checksum === checksum)) {
        bundles.push({ checksum, data: Buffer.concat(wanted.map((sum) => chunks.get(sum))) });
      }
      return json({ state: missing.length ? 'not_found' : 'ok', missingChunks: missing });
    }
    // Releases and other metadata calls: accept without side effects.
    return json(request.method === 'GET' ? [] : {});
  });
});

// ---- Source map decoding (VLQ) ----
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Original source for a generated 0-based line/column. @param {any} map @param {number} line @param {number} column */
function originalSource(map, line, column) {
  const state = [0, 0, 0, 0];
  let best;
  map.mappings.split(';').forEach((group, index) => {
    state[0] = 0;
    for (const segment of group.split(',')) {
      if (!segment) continue;
      const values = [];
      let value = 0, shift = 0;
      for (const char of segment) {
        const digit = BASE64.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else { values.push(value & 1 ? -(value >>> 1) : value >>> 1); value = 0; shift = 0; }
      }
      state[0] += values[0];
      if (values.length >= 4) { state[1] += values[1]; state[2] += values[2]; state[3] += values[3]; }
      if (index === line && values.length >= 4 && state[0] <= column) best = { source: map.sources[state[1]], line: state[2] + 1, column: state[3] };
    }
  });
  return best;
}

/** @param {string} code @param {string} needle */
function position(code, needle) {
  const offset = code.indexOf(needle);
  if (offset < 0) return undefined;
  const before = code.slice(0, offset).split('\n');
  return { line: before.length - 1, column: before.at(-1).length };
}

async function listFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
  } catch { return []; }
}

function build(label, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', 'build:start'], { cwd: root, env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (chunk) => { log += chunk; });
    child.stderr.on('data', (chunk) => { log += chunk; });
    child.on('close', (code) => (code ? reject(new Error(`${label} build failed (${code}):\n${log.slice(-4000)}`)) : resolve(log)));
  });
}

/** Maps, map references and the token anywhere in `.output`. */
async function outputLeaks() {
  const all = await listFiles(path.join(root, '.output'));
  const publicFiles = all.filter((file) => file.includes(`${path.sep}.output${path.sep}public${path.sep}`));
  const text = all.filter((file) => /\.(?:m?js|cjs|css|json|html)$/.test(file));
  let mapReferences = 0, tokenFiles = 0;
  for (const file of text) {
    const content = await fs.readFile(file, 'utf8');
    if (file.includes(`${path.sep}public${path.sep}`) && content.includes('sourceMappingURL=')) mapReferences++;
    if (content.includes(token)) tokenFiles++;
  }
  return {
    publicMapFiles: publicFiles.filter((file) => file.endsWith('.map')).length,
    publicSourceMappingUrlReferences: mapReferences,
    serverMapFiles: all.filter((file) => file.includes(`${path.sep}server${path.sep}`) && file.endsWith('.map')).length,
    filesContainingToken: tokenFiles,
  };
}

let failed = false;
try {
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  // 1. No credentials: the plugin is not installed; nothing may be uploaded.
  await build('plain', { SENTRY_URL: sentryUrl });
  const plain = { requests: requests.length, ...(await outputLeaks()) };

  // 2. Synthetic credentials against the loopback API.
  // Record which server maps exist between emission and post-upload deletion.
  const seenMaps = new Map();
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      for (const file of await listFiles(path.join(root, '.output', 'server'))) {
        if (!file.endsWith('.map') || seenMaps.has(file)) continue;
        try { seenMaps.set(file, JSON.parse(await fs.readFile(file, 'utf8')).sources ?? []); } catch { /* deleted or partly written */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  try {
    await build('credentialed', { SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: project, SENTRY_URL: sentryUrl });
  } finally {
    watching = false;
    await watcher;
  }
  const leaks = await outputLeaks();
  if (bundles.length === 0) throw new Error(`No artifact bundle assembled; requests: ${JSON.stringify(requests)}`);

  // Unpack every uploaded artifact bundle (zip with manifest.json).
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'sentry-bundle-'));
  const uploaded = new Map(); // debugId -> { source, sourceMap }
  try {
    for (const [index, bundle] of bundles.entries()) {
      const dir = path.join(work, String(index));
      await fs.mkdir(dir);
      await fs.writeFile(path.join(dir, 'bundle.zip'), bundle.data);
      execFileSync('unzip', ['-q', 'bundle.zip'], { cwd: dir });
      const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      for (const [file, entry] of Object.entries(manifest.files)) {
        const debugId = entry.headers?.['debug-id'];
        if (!debugId) continue;
        const record = uploaded.get(debugId) ?? {};
        const content = await fs.readFile(path.join(dir, file), 'utf8');
        if (entry.type === 'source_map') record.sourceMap = JSON.parse(content);
        else if (entry.type === 'minified_source') record.source = { url: entry.url, content };
        uploaded.set(debugId, record);
      }
    }
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }

  // Published JavaScript carries a debug ID comment; each must match an uploaded pair.
  const published = [];
  for (const file of await listFiles(path.join(root, '.output'))) {
    if (!/\.m?js$/.test(file)) continue;
    const content = await fs.readFile(file, 'utf8');
    // The bundler plugin embeds each chunk's debug ID in a runtime snippet the SDK reads.
    const debugId = /_sentryDebugIds\[[^\]]+\]\s*=\s*["'`]([0-9a-f-]{36})["'`]/.exec(content)?.[1];
    if (debugId) published.push({ file: path.relative(root, file), side: file.includes(`${path.sep}public${path.sep}`) ? 'client' : 'server', debugId, content });
  }
  // Strict coverage: every published file links, except the characterized generated-only files.
  const mapEmitted = (file) => seenMaps.has(path.join(root, `${file}.map`));
  const coverage = evaluateCoverage(published, uploaded, mapEmitted, root);
  const linked = published.filter(({ debugId, content }) => uploaded.get(debugId)?.sourceMap && comparableCode(uploaded.get(debugId)?.source?.content ?? '') === comparableCode(content));
  const unlinked = coverage.unlinked;

  // Negative controls on the same real data; each must fail.
  const sampled = new Set(['_ssr/routing-', '__root-', 'index-']);
  const victim = linked.find((item) => item.side === 'server' && ![...sampled].some((part) => item.file.includes(part)));
  // Target the files the coverage actually classified, not every similarly named chunk.
  const classified = (kind) => published.find((item) => item.file === coverage.unlinked.find((entry) => entry.generatedOnlyKind === kind)?.file);
  const barrel = classified('reexport-barrel');
  const runtime = classified('rolldown-runtime');
  const withoutVictim = new Map(uploaded);
  if (victim) withoutVictim.delete(victim.debugId);
  const negativeControls = [
    { name: 'drop one non-sampled uploaded server map', file: victim?.file, result: victim && evaluateCoverage(published, withoutVictim, mapEmitted, root) },
    { name: 'pure re-export chunk gains an emitted map', file: barrel?.file, result: barrel && evaluateCoverage(published, uploaded, (file) => file === barrel.file || mapEmitted(file), root) },
    { name: 'runtime helper chunk gains application code', file: runtime?.file, result: runtime && evaluateCoverage(published.map((item) => item === runtime ? { ...item, content: `${item.content}\n//#region src/app.ts\nexport const app = 1;\n` } : item), uploaded, mapEmitted, root) },
  ].map(({ name, file, result }) => ({ name, file, failed: Boolean(result) && !result.pass, failures: result?.failures ?? ['control not applicable'] }));

  // An actual server event: run the final server with the fake DSN and throw inside first-party code.
  const chunk = published.find((item) => item.side === 'server' && /function localizeHref\(/.test(item.content) && /export \{[^}]*\blocalizeHref\b/.test(item.content));
  let serverEvent = { captured: false };
  if (chunk) {
    const app = spawn('node', ['--import', path.join(root, 'scripts', 'sentry-sourcemap-preload.mjs'), path.join(root, '.output', 'server', 'index.mjs')], {
      cwd: root, stdio: 'ignore',
      env: {
        ...inherited, NODE_ENV: 'production', PORT: String(appPort), SENTRY_DSN: dsn, SENTRY_PROOF_CHUNK: path.join(root, chunk.file),
        CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from('clerk.sentry-proof.invalid$').toString('base64')}`, CLERK_SECRET_KEY: `sk_live_${'0'.repeat(40)}`,
      },
    });
    try {
      const until = async (check, label) => {
        for (const end = Date.now() + 30000; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 250))) if (await check()) return;
        throw new Error(`Timed out waiting for ${label}`);
      };
      // The first request loads the server entry, which initializes Sentry.
      await until(async () => { try { await (await fetch(`http://127.0.0.1:${appPort}/terms`)).arrayBuffer(); return true; } catch { return false; } }, 'proof server');
      app.kill('SIGUSR2');
      await until(() => events.some((event) => event.exception), 'server exception event');
      const event = events.find((item) => item.exception);
      const exception = event.exception.values.at(-1);
      const images = new Map((event.debug_meta?.images ?? []).map((image) => [image.code_file, image.debug_id]));
      const frames = (exception.stacktrace?.frames ?? []).filter((frame) => frame.filename?.includes(`${path.sep}.output${path.sep}server${path.sep}`) || frame.abs_path?.includes('/.output/server/'));
      const resolvedStack = frames.map((frame) => {
        const filename = frame.abs_path ?? frame.filename;
        const debugId = images.get(filename) ?? images.get(frame.filename);
        const map = debugId ? uploaded.get(debugId)?.sourceMap : undefined;
        const original = map && frame.lineno && frame.colno ? originalSource(map, frame.lineno - 1, frame.colno - 1) : undefined;
        let originalLine;
        if (original?.source && !original.source.startsWith('node_modules')) {
          originalLine = readFileSync(path.join(root, original.source), 'utf8').split('\n')[original.line - 1]?.trim();
        }
        return {
          generated: `${path.relative(root, filename.replace(/^file:\/\//, ''))}:${frame.lineno}:${frame.colno}`,
          function: frame.function, debugIdPresent: Boolean(debugId), mapUploaded: Boolean(map), original, originalLine,
        };
      });
      serverEvent = {
        captured: true, exception: `${exception.type}: ${exception.value}`, mechanism: exception.mechanism?.type,
        debugMetaImages: images.size, finalServerFrames: resolvedStack,
      };
    } finally {
      app.kill('SIGTERM');
    }
  }

  // Resolve first-party code in published output to its original source through the uploaded map.
  const probes = [
    { side: 'client', needle: 'Page temporarily unavailable', expect: 'src/start-app/routes/__root.tsx' },
    { side: 'server', needle: 'Invalid shell request', expect: 'src/start-app/routes/__root.tsx' },
  ];
  const resolved = probes.map((probe) => {
    for (const item of linked.filter((entry) => entry.side === probe.side)) {
      const at = position(item.content, probe.needle);
      if (!at) continue;
      const original = originalSource(uploaded.get(item.debugId).sourceMap, at.line, at.column);
      let sourceLineContainsNeedle = false;
      if (original?.source) {
        const lines = readFileSync(path.join(root, original.source), 'utf8').split('\n');
        sourceLineContainsNeedle = lines[original.line - 1]?.includes(probe.needle) ?? false;
      }
      return { ...probe, file: item.file, generated: { line: at.line + 1, column: at.column }, original, sourceLineContainsNeedle };
    }
    return { ...probe, original: undefined };
  });

  const paths = [...new Set(requests.map((entry) => `${entry.method} ${entry.path.replace(org, '<org>')}`))].sort();
  const result = {
    schemaVersion: 1,
    tooling: '@sentry/tanstackstart-react/vite 11.16.0 (bundled @sentry/bundler-plugins 11.16.0, sentry CLI SDK 0.50.0)',
    target: 'loopback fake Sentry API; synthetic token, org and project',
    plainBuild: plain,
    credentialedBuild: {
      requestPaths: paths, allRequestsAuthorized: authorized,
      artifactBundles: bundles.length, uploadedDebugIds: uploaded.size,
      publishedWithDebugId: { client: published.filter((p) => p.side === 'client').length, server: published.filter((p) => p.side === 'server').length },
      linkedToUploadedMaps: coverage.linked,
      coverageFailures: coverage.failures,
      negativeControls,
      serverMapsObservedBeforeDeletion: seenMaps.size,
      unlinked,
      serverEvent,
      resolvedFrames: resolved.map(({ side, needle, file, generated, original, sourceLineContainsNeedle }) => ({ side, needle, file, generated, original, sourceLineContainsNeedle })),
      ...leaks,
    },
  };
  const checks = {
    noUploadWithoutCredentials: plain.requests === 0,
    noPublishedMapsWithoutCredentials: plain.publicMapFiles === 0 && plain.publicSourceMappingUrlReferences === 0,
    uploadedWithSyntheticToken: bundles.length > 0 && authorized,
    everyClientDebugIdLinked: coverage.allClientLinked,
    everyServerDebugIdLinkedOrCharacterized: coverage.allServerLinkedOrCharacterized,
    noCoverageFailures: coverage.failures.length === 0,
    negativeControlsFail: negativeControls.every((control) => control.failed),
    serverEventTopFrameResolvesToSource: serverEvent.captured && serverEvent.finalServerFrames.at(-1)?.original?.source === 'src/i18n/routing.ts' && Boolean(serverEvent.finalServerFrames.at(-1)?.originalLine?.includes('href.search')),
    framesResolveToFirstPartySource: resolved.length > 0 && resolved.every((r) => r.original?.source === r.expect && r.sourceLineContainsNeedle),
    noPublishedMapsAfterUpload: leaks.publicMapFiles === 0 && leaks.publicSourceMappingUrlReferences === 0,
    noServerMapsLeftAfterUpload: leaks.serverMapFiles === 0,
    tokenNotInOutput: leaks.filesContainingToken === 0 && plain.filesContainingToken === 0,
  };
  const proof = { ...result, checks, outcome: Object.values(checks).every(Boolean) ? 'pass' : 'fail' };
  console.log(JSON.stringify(proof, null, 2));
  if (out) await fs.writeFile(out, JSON.stringify(proof, null, 2) + '\n');
  failed = proof.outcome !== 'pass';
} catch (error) {
  console.error(`Source-map proof failed: ${error.message}`);
  failed = true;
} finally {
  server.close();
  process.exitCode = failed ? 1 : 0;
}
