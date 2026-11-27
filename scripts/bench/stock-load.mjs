#!/usr/bin/env node
/**
 * Reproducible isolated-local Stock load & acceptance probe.
 *
 * - Spawns a fresh anonymous local Convex backend on ephemeral 127.0.0.1 ports.
 * - Never touches cloud Convex, `.local-dev`, Stripe, Clerk, or any external provider.
 * - Injects `convex/maintenance/stockBenchFixture.ts` ONLY into the disposable backend copy.
 * - Covers:
 *   1. Skewed data seeding at 1x and 2x (hot branch >= 50%, hot variant 20k/40k movements + 500/1000 historical lines,
 *      newly cataloged variant with no balance, Needs recount rows, rare movement types, 20-branch buyer, PRs & POs).
 *   2. Exact DB read/range/byte/write budget proofs at 1x and 2x (+ 1x->2x invariance <= 10%).
 *   3. 10 concurrent WebSocket/HTTP staff sessions: live subscriptions, POS checkout sales (cash tender),
 *      50-line receipts sharing the hot variant, order creation, competing receipts on one PO, and live refresh latency.
 *   4. Unrelated-branch live subscription isolation proof.
 *   5. Convex engine `/api/stream_function_logs` telemetry (executionMs, handlerMs, read/write docs & bytes, OCC retries).
 *   6. Exact post-load balance & On order (stockIncoming) reconciliations (zero drift).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { localConvexCache } from '../local-convex-cache.mjs';
import { disabledServices, requireLocalBackend } from '../local-integration-config.mjs';
import { postStockWithRetry } from '../../src/lib/stock-posting.ts';

process.umask(0o077);

const root = process.cwd();
const PRESETS = {
  // Exact full pilot gate from docs/plans/stock-workflows.html lines 346-347.
  pilot: {
    orders1x: 10_000,
    linesPerOrder: 5, // 50,000 lines at 1x, 100,000 at 2x
    movements1x: 100_000,
    variants: 2_000,
    hotBranchShare: 0.55,
    hotVariantMovements1x: 20_000,
    hotVariantLines1x: 500,
    requests1x: 1_000,
    extraBranches: 18, // 20 total branches
    durationSeconds: 300,
    minSamplesPerPath: 200,
    sessions: 10,
    writePaceMs: 600,
    run2x: true,
  },
  // Full 1x & 2x pilot dataset scale, shorter timed load window for staged qualification.
  staged: {
    orders1x: 10_000,
    linesPerOrder: 5,
    movements1x: 100_000,
    variants: 2_000,
    hotBranchShare: 0.55,
    hotVariantMovements1x: 20_000,
    hotVariantLines1x: 500,
    requests1x: 1_000,
    extraBranches: 18,
    durationSeconds: 30,
    minSamplesPerPath: 20,
    sessions: 10,
    writePaceMs: 850,
    run2x: true,
  },
  // Fast functional/smoke proof of the entire probe at smaller scale.
  smoke: {
    orders1x: 1_000,
    linesPerOrder: 5,
    movements1x: 10_000,
    variants: 500,
    hotBranchShare: 0.55,
    hotVariantMovements1x: 2_000,
    hotVariantLines1x: 100,
    requests1x: 200,
    extraBranches: 18,
    durationSeconds: 15,
    minSamplesPerPath: 10,
    sessions: 10,
    writePaceMs: 250,
    run2x: true,
  },
};

const GATES = {
  listP95Ms: 500,
  receipt50P95Ms: 1_000,
  liveRefreshP95Ms: 2_000,
  listMaxDocs: 150,
  listMaxRanges: 60,
  listMaxBytes: 256 * 1024,
  receiptMaxDocs: 350,
  receiptMaxRanges: 225,
  receiptMaxWrites: 350,
  scale2xMaxReadGrowthPct: 10,
  pilotOrders1x: 10_000,
  pilotLines1x: 50_000,
  pilotMovements1x: 100_000,
  pilotVariants: 2_000,
  pilotDurationSeconds: 300,
  pilotMinSamples: 200,
};

function parseArgs(argv) {
  let presetName = 'staged';
  const overrides = {};
  let outPath = null;
  let keepWorkdir = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--preset') presetName = argv[++i];
    else if (arg === '--duration') overrides.durationSeconds = Number(argv[++i]);
    else if (arg === '--min-samples') overrides.minSamplesPerPath = Number(argv[++i]);
    else if (arg === '--orders') overrides.orders1x = Number(argv[++i]);
    else if (arg === '--movements') overrides.movements1x = Number(argv[++i]);
    else if (arg === '--variants') overrides.variants = Number(argv[++i]);
    else if (arg === '--write-pace-ms') overrides.writePaceMs = Number(argv[++i]);
    else if (arg === '--skip-2x') overrides.run2x = false;
    else if (arg === '--out') outPath = argv[++i];
    else if (arg === '--keep-workdir') keepWorkdir = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const base = PRESETS[presetName];
  if (!base) throw new Error(`Unknown preset "${presetName}". Choose pilot, staged, or smoke.`);
  return { presetName, config: { ...base, ...overrides }, outPath, keepWorkdir };
}

function summarize(values) {
  if (!values.length) return { n: 0, min: null, median: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return {
    n: sorted.length,
    min: Number(sorted[0].toFixed(2)),
    median: Number(median.toFixed(2)),
    p95: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve(addr.port));
    });
  });
}

async function until(fn, label, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function resortTodayIso(now = Date.now()) {
  const shifted = new Date(now + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function extractErrorCode(error) {
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object' && 'code' in error.data) {
      return String(error.data.code);
    }
    const msg = String(error.message ?? error);
    const match = /"code"\s*:\s*"([A-Z0-9_]+)"/.exec(msg);
    if (match) return match[1];
  }
  return null;
}

const fnRef = (name) => makeFunctionReference(name);

const FIXTURE = {
  bootstrap: fnRef('maintenance/stockBenchFixture:bootstrap'),
  seedCatalogBatch: fnRef('maintenance/stockBenchFixture:seedCatalogBatch'),
  seedHistoricalMovementsBatch: fnRef('maintenance/stockBenchFixture:seedHistoricalMovementsBatch'),
  seedHistoricalOrdersBatch: fnRef('maintenance/stockBenchFixture:seedHistoricalOrdersBatch'),
  seedHistoricalRequestsBatch: fnRef('maintenance/stockBenchFixture:seedHistoricalRequestsBatch'),
  seedReceivableOrders: fnRef('maintenance/stockBenchFixture:seedReceivableOrders'),
  sumMovementsPage: fnRef('maintenance/stockBenchFixture:sumMovementsPage'),
  readStockLevelExact: fnRef('maintenance/stockBenchFixture:readStockLevelExact'),
  sumOpenDuePage: fnRef('maintenance/stockBenchFixture:sumOpenDuePage'),
  readIncomingExact: fnRef('maintenance/stockBenchFixture:readIncomingExact'),
  readOrderForCheckout: fnRef('maintenance/stockBenchFixture:readOrderForCheckout'),
  probeQueryBudget: fnRef('maintenance/stockBenchFixture:probeQueryBudget'),
  probeReceiptBudget: fnRef('maintenance/stockBenchFixture:probeReceiptBudget'),
};

const API = {
  listBalances: fnRef('commerce/stock:listBalances'),
  listActivity: fnRef('commerce/stock:listActivity'),
  postOperation: fnRef('commerce/stock:postOperation'),
  orders: fnRef('commerce/purchasing:orders'),
  order: fnRef('commerce/purchasing:order'),
  requests: fnRef('commerce/purchasing:requests'),
  saveOrder: fnRef('commerce/purchasing:saveOrder'),
  issuePurchaseOrder: fnRef('commerce/purchasing:issuePurchaseOrder'),
  receivePurchaseOrder: fnRef('commerce/purchasing:receivePurchaseOrder'),
  incoming: fnRef('commerce/purchasing:incoming'),
  retailBrowse: fnRef('pos/retail:browse'),
  retailAdd: fnRef('pos/retail:add'),
  getOrder: fnRef('pos/orders:getOrder'),
  acknowledgeCutover: fnRef('commerce/paymentCutover:acknowledge'),
  startPaymentAttempt: fnRef('pos/commands/startPaymentAttempt:startPaymentAttempt'),
  armPaymentLeg: fnRef('pos/commands/armPaymentLeg:armPaymentLeg'),
  recordPaymentLeg: fnRef('pos/commands/recordPaymentLeg:recordPaymentLeg'),
  settlePaymentAttempt: fnRef('pos/commands/settleOrder:settlePaymentAttempt'),
};

class LogCollector {
  constructor(backendUrl, adminKey) {
    this.backendUrl = backendUrl;
    this.adminKey = adminKey;
    this.seen = new Set();
    this.byFunction = new Map();
    this.timer = null;
  }

  async poll() {
    try {
      const response = await fetch(`${this.backendUrl}/api/stream_function_logs?cursor=0`, {
        headers: { Authorization: `Convex ${this.adminKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return;
      const payload = await response.json();
      for (const entry of payload.entries ?? []) {
        if (entry.kind !== 'Completion' || entry.componentPath) continue;
        const id = `${entry.requestId}:${entry.executionId}`;
        if (this.seen.has(id)) continue;
        this.seen.add(id);
        const fn = entry.identifier;
        if (!fn || fn.startsWith('maintenance/stockBenchFixture:')) continue;
        let bucket = this.byFunction.get(fn);
        if (!bucket) {
          bucket = {
            udfType: entry.udfType,
            total: 0,
            cached: 0,
            fresh: 0,
            errors: 0,
            occRetriesTotal: 0,
            occRetryEvents: 0,
            executionMs: [],
            handlerMs: [],
            readDocs: [],
            readBytes: [],
            writeDocs: [],
            writeBytes: [],
          };
          this.byFunction.set(fn, bucket);
        }
        bucket.total++;
        if (entry.cachedResult === true) bucket.cached++;
        else bucket.fresh++;
        if (entry.error != null) bucket.errors++;
        const retries = Number(entry.occInfo?.retryCount ?? 0);
        if (retries > 0) {
          bucket.occRetriesTotal += retries;
          bucket.occRetryEvents++;
        }
        if (Number.isFinite(entry.executionTime)) bucket.executionMs.push(entry.executionTime * 1000);
        if (!entry.cachedResult && Number.isFinite(entry.userExecutionTime)) bucket.handlerMs.push(entry.userExecutionTime * 1000);
        const stats = entry.usageStats ?? {};
        if (!entry.cachedResult && Number.isFinite(stats.databaseReadDocuments)) bucket.readDocs.push(stats.databaseReadDocuments);
        if (!entry.cachedResult && Number.isFinite(stats.databaseReadBytes)) bucket.readBytes.push(stats.databaseReadBytes);
        if (Number.isFinite(stats.databaseWriteDocuments)) bucket.writeDocs.push(stats.databaseWriteDocuments);
        if (Number.isFinite(stats.databaseWriteBytes)) bucket.writeBytes.push(stats.databaseWriteBytes);
      }
    } catch {
      // Ignore transient poll errors during shutdown.
    }
  }

  start() {
    this.timer = setInterval(() => {
      void this.poll();
    }, 500);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.poll();
  }

  reset() {
    this.byFunction.clear();
  }

  summary() {
    const out = {};
    for (const [fn, b] of [...this.byFunction.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out[fn] = {
        udfType: b.udfType,
        total: b.total,
        fresh: b.fresh,
        cached: b.cached,
        errors: b.errors,
        occRetriesTotal: b.occRetriesTotal,
        occRetryEvents: b.occRetryEvents,
        executionMs: summarize(b.executionMs),
        handlerMs: summarize(b.handlerMs),
        readDocs: summarize(b.readDocs),
        readBytes: summarize(b.readBytes),
        writeDocs: summarize(b.writeDocs),
      };
    }
    return out;
  }
}

async function main() {
  const { presetName, config, outPath, keepWorkdir } = parseArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  await fs.mkdir(path.join(root, 'output'), { recursive: true, mode: 0o700 });
  const work = await fs.mkdtemp(path.join(root, 'output', 'stock-bench-'));
  await fs.chmod(work, 0o700);
  const home = path.join(work, 'home');
  const project = path.join(work, 'backend');
  await fs.mkdir(home, { mode: 0o700 });
  await localConvexCache(home);
  await fs.mkdir(project, { mode: 0o700 });
  await fs.cp(path.join(root, 'convex'), path.join(project, 'convex'), { recursive: true });
  // Keep the disposable backend 100% offline/localhost-only: setAdminAuth injects staff identities without Clerk OIDC.
  await fs.writeFile(path.join(project, 'convex/auth.config.ts'), 'export default { providers: [] };\n', { mode: 0o600 });
  const fixtureSource = await fs.readFile(path.join(root, 'scripts/bench/stock-bench-fixture.ts.tpl'), 'utf8');
  await fs.writeFile(path.join(project, 'convex/maintenance/stockBenchFixture.ts'), fixtureSource, { flag: 'wx', mode: 0o600 });
  await fs.copyFile(path.join(root, 'package.json'), path.join(project, 'package.json'));
  await fs.symlink(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir');

  const cloudPort = await freePort();
  const sitePort = await freePort();
  const backendUrl = requireLocalBackend(`http://127.0.0.1:${cloudPort}`);

  const childEnv = {
    ...disabledServices,
    PATH: process.env.PATH,
    HOME: home,
    LANG: 'en_US.UTF-8',
    CONVEX_AGENT_MODE: 'anonymous',
    CONVEX_TELEMETRY_DISABLED: '1',
  };

  const logFd = await fs.open(path.join(work, 'backend.log'), 'w', 0o600);
  const backendChild = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/convex/bin/main.js'),
      'dev',
      '--local-cloud-port',
      String(cloudPort),
      '--local-site-port',
      String(sitePort),
      '--until-success',
      '--start',
      "exec node -e 'const owner = process.ppid; setInterval(() => { try { process.kill(owner, 0) } catch { process.exit(0) } }, 250)'",
      '--typecheck',
      'disable',
      '--tail-logs',
      'disable',
    ],
    {
      cwd: project,
      env: childEnv,
      stdio: ['ignore', logFd.fd, logFd.fd],
      detached: process.platform !== 'win32',
    },
  );
  await logFd.close();
  const childDone = new Promise((resolve) => backendChild.on('close', resolve));
  const openWsClients = [];

  let cleaned = false;
  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    for (const client of openWsClients) {
      try {
        await client.close();
      } catch {
        // Ignore close errors during shutdown.
      }
    }
    if (backendChild.exitCode === null && backendChild.signalCode === null) {
      try {
        process.kill(-backendChild.pid, 'SIGTERM');
      } catch {
        backendChild.kill('SIGTERM');
      }
      await Promise.race([childDone, delay(4_000)]);
      if (backendChild.exitCode === null && backendChild.signalCode === null) {
        try {
          process.kill(-backendChild.pid, 'SIGKILL');
        } catch {
          // Already gone.
        }
      }
    }
    if (!keepWorkdir) {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    }
  }

  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      void cleanup().finally(() => process.exit(1));
    });
  }

  try {
    console.log(`[stock-bench] Starting isolated anonymous Convex backend on 127.0.0.1:${cloudPort} (preset=${presetName})...`);
    const configPath = path.join(project, '.convex/local/default/config.json');
    let backendConfig;
    await until(async () => {
      try {
        backendConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
        return Boolean(backendConfig?.adminKey);
      } catch {
        return false;
      }
    }, 'local backend config');
    await fs.chmod(configPath, 0o600);
    try {
      await until(async () => {
        const log = await fs.readFile(path.join(work, 'backend.log'), 'utf8');
        if (backendChild.exitCode !== null) {
          throw new Error(`Local Convex backend exited (${backendChild.exitCode}):\n${log.slice(-2000)}`);
        }
        return log.includes('Convex functions ready');
      }, 'Convex functions ready', 60_000);
    } catch (error) {
      const log = await fs.readFile(path.join(work, 'backend.log'), 'utf8').catch(() => '');
      throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- backend.log ---\n${log.slice(-2000)}`);
    }

    const admin = new ConvexHttpClient(backendUrl, { logger: false });
    admin.setAdminAuth(backendConfig.adminKey);

    let seedThrottleRetries = 0;
    async function seedMutation(ref, args) {
      for (let attempt = 0; attempt < 25; attempt++) {
        try {
          return await admin.mutation(ref, args);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (msg.includes('TooManyWrites') || msg.includes('4 MiB')) {
            seedThrottleRetries++;
            await delay(Math.min(1500, 250 * (attempt + 1)));
            continue;
          }
          throw error;
        }
      }
      throw new Error('Exceeded seeding retry budget on TooManyWrites');
    }

    const makeHttpStaff = (subject) => {
      const c = new ConvexHttpClient(backendUrl, { logger: false });
      c.setAdminAuth(backendConfig.adminKey, {
        issuer: boot.issuer,
        subject,
        email: `${subject}@stock-bench.local`,
        emailVerified: true,
      });
      return c;
    };

    const makeWsStaff = (subject) => {
      const c = new ConvexClient(backendUrl, { skipConvexDeploymentUrlCheck: true, logger: false });
      c.setAdminAuth(backendConfig.adminKey, {
        issuer: boot.issuer,
        subject,
        email: `${subject}@stock-bench.local`,
        emailVerified: true,
      });
      openWsClients.push(c);
      return c;
    };

    console.log('[stock-bench] Bootstrapping branches, staff grants, suppliers, and catalog...');
    const boot = await admin.mutation(FIXTURE.bootstrap, { extraBranches: config.extraBranches });

    const variantIds = [];
    const catalogBatch = 200;
    for (let start = 0; start < config.variants; start += catalogBatch) {
      const count = Math.min(catalogBatch, config.variants - start);
      const ids = await seedMutation(FIXTURE.seedCatalogBatch, {
        categoryId: boot.categoryId,
        startIndex: start,
        count,
      });
      variantIds.push(...ids);
    }
    const hotVariantId = variantIds[0];
    const newNoBalanceVariantId = variantIds[1];
    const recountVariantIds = variantIds.slice(2, Math.min(42, variantIds.length));
    // 50 variants for 50-line POs/receipts: shared hotVariant + 49 dedicated receipt variants (2..50).
    const fiftyLineVariantIds = [hotVariantId, ...variantIds.slice(2, 51)];
    // Non-overlapping catalog variants for POS sales, order creation, and non-hot competing races so ONLY hotVariantId is shared.
    const otherWriterVariantIds = variantIds.length > 51 ? variantIds.slice(51) : variantIds.slice(2);
    const poolVariantIds = variantIds.slice(2); // Excludes hotVariant and newNoBalanceVariant for background historical spread.
    const touchedVariants = new Set([hotVariantId, newNoBalanceVariantId, ...fiftyLineVariantIds.slice(1)]);

    async function seedScaleIncrement(scaleLabel, seedOffset) {
      const t0 = performance.now();
      const hotOrdersTotal = Math.round(config.orders1x * config.hotBranchShare);
      const coldOrdersTotal = config.orders1x - hotOrdersTotal;
      const hotMovementsTotal = Math.round(config.movements1x * config.hotBranchShare);
      const coldMovementsTotal = config.movements1x - hotMovementsTotal;
      const actorToken = `${boot.issuer}|staff-0`;
      const actorLabel = 'staff-0@stock-bench.local';
      const baseTs = Date.now() - (scaleLabel === '1x' ? 90 : 45) * 24 * 60 * 60 * 1000;

      // Seed orders + lines in batches of 60 orders (300 lines + 60 headers = 360 docs per batch) to stay smoothly under 1s timeout & 4 MiB/s write rate even at 200k+ rows.
      const ordersBatchSize = 60;
      let hotLinesLeft = config.hotVariantLines1x;
      let openOrdersLeft = 30;
      let batchIdx = seedOffset * 1000;
      let totalOrdersSeeded = 0;
      let totalLinesSeeded = 0;

      for (let done = 0; done < hotOrdersTotal; done += ordersBatchSize) {
        const chunk = Math.min(ordersBatchSize, hotOrdersTotal - done);
        const hotChunk = Math.min(hotLinesLeft, chunk);
        const openChunk = Math.min(openOrdersLeft, chunk);
        const res = await seedMutation(FIXTURE.seedHistoricalOrdersBatch, {
          branchId: boot.hotBranchId,
          supplierId: boot.supplierIds[batchIdx % boot.supplierIds.length],
          variantIds: poolVariantIds,
          hotVariantId,
          ordersCount: chunk,
          linesPerOrder: config.linesPerOrder,
          hotVariantLinesInBatch: hotChunk,
          openOrdersInBatch: openChunk,
          batchSeed: batchIdx++,
          baseTimestamp: baseTs + done * 100,
          actorToken,
          actorLabel,
        });
        hotLinesLeft -= res.hotLinesInserted;
        openOrdersLeft -= openChunk;
        totalOrdersSeeded += res.ordersInserted;
        totalLinesSeeded += res.linesInserted;
      }

      for (let done = 0; done < coldOrdersTotal; done += ordersBatchSize) {
        const chunk = Math.min(ordersBatchSize, coldOrdersTotal - done);
        const res = await seedMutation(FIXTURE.seedHistoricalOrdersBatch, {
          branchId: boot.coldBranchId,
          supplierId: boot.supplierIds[batchIdx % boot.supplierIds.length],
          variantIds: poolVariantIds,
          hotVariantId,
          ordersCount: chunk,
          linesPerOrder: config.linesPerOrder,
          hotVariantLinesInBatch: 0,
          openOrdersInBatch: done === 0 ? 5 : 0,
          batchSeed: batchIdx++,
          baseTimestamp: baseTs + done * 100,
          actorToken,
          actorLabel,
        });
        totalOrdersSeeded += res.ordersInserted;
        totalLinesSeeded += res.linesInserted;
      }

      // Seed movements in batches of 400 docs (<= 26 unique variants/batch) to stay fast & well under 1s mutation timeout at 200k+ rows.
      const moveBatchSize = 400;
      let hotMovementsLeft = config.hotVariantMovements1x;
      let rareLeft = 60;
      let totalMovementsSeeded = 0;
      let markedRecount = false;

      for (let done = 0; done < hotMovementsTotal; done += moveBatchSize) {
        const chunk = Math.min(moveBatchSize, hotMovementsTotal - done);
        const hotChunk = Math.min(hotMovementsLeft, Math.floor(chunk * 0.6));
        const rareChunk = Math.min(rareLeft, Math.max(0, chunk - hotChunk));
        const res = await seedMutation(FIXTURE.seedHistoricalMovementsBatch, {
          branchId: boot.hotBranchId,
          variantIds: poolVariantIds,
          hotVariantId,
          hotVariantCount: hotChunk,
          rareKindCount: rareChunk,
          totalCount: chunk,
          batchSeed: batchIdx++,
          baseTimestamp: baseTs + done * 10,
          actorToken,
          actorLabel,
          markRecountVariantIds: !markedRecount ? recountVariantIds : undefined,
        });
        markedRecount = true;
        hotMovementsLeft -= hotChunk;
        rareLeft -= rareChunk;
        totalMovementsSeeded += res.inserted;
      }

      for (let done = 0; done < coldMovementsTotal; done += moveBatchSize) {
        const chunk = Math.min(moveBatchSize, coldMovementsTotal - done);
        const res = await seedMutation(FIXTURE.seedHistoricalMovementsBatch, {
          branchId: boot.coldBranchId,
          variantIds: poolVariantIds,
          hotVariantId,
          hotVariantCount: 0,
          rareKindCount: 0,
          totalCount: chunk,
          batchSeed: batchIdx++,
          baseTimestamp: baseTs + done * 10,
          actorToken,
          actorLabel,
        });
        totalMovementsSeeded += res.inserted;
      }

      // Seed purchase requests so PR list and item-filter queries hit realistic skewed volume.
      const reqBatchSize = 150;
      for (let done = 0; done < config.requests1x; done += reqBatchSize) {
        const chunk = Math.min(reqBatchSize, config.requests1x - done);
        await seedMutation(FIXTURE.seedHistoricalRequestsBatch, {
          branchId: boot.hotBranchId,
          variantIds: poolVariantIds,
          hotVariantId,
          requestsCount: chunk,
          batchSeed: batchIdx++,
          baseTimestamp: baseTs + done * 100,
          requesterToken: actorToken,
          requesterLabel: actorLabel,
        });
      }

      return {
        scaleLabel,
        elapsedSec: Number(((performance.now() - t0) / 1000).toFixed(2)),
        seedThrottleRetries,
        ordersAdded: totalOrdersSeeded,
        linesAdded: totalLinesSeeded,
        movementsAdded: totalMovementsSeeded,
        requestsAdded: config.requests1x,
        hotBranchOrdersAdded: hotOrdersTotal,
        hotBranchMovementsAdded: hotMovementsTotal,
        hotVariantLinesAdded: config.hotVariantLines1x,
        hotVariantMovementsAdded: config.hotVariantMovements1x,
      };
    }

    async function measureExactBudgets(scaleLabel) {
      // Seed the 50-line receivable PO first so stockIncoming rows exist consistently across 1x and 2x list probes.
      const [po50] = await seedMutation(FIXTURE.seedReceivableOrders, {
        branchId: boot.hotBranchId,
        supplierId: boot.supplierIds[0],
        variantIds: fiftyLineVariantIds,
        ordersCount: 1,
        qtyPerLine: 5,
        prefix: `B50-${scaleLabel}`,
        actorToken: `${boot.issuer}|staff-0`,
        actorLabel: 'staff-0@stock-bench.local',
      });

      const probes = [
        { name: 'balances_default', probe: 'stock.listBalances', subject: 'staff-0', branchId: boot.hotBranchId },
        { name: 'balances_search_name', probe: 'stock.listBalances', subject: 'staff-0', branchId: boot.hotBranchId, search: 'Apex Hot' },
        { name: 'balances_search_sku', probe: 'stock.listBalances', subject: 'staff-0', branchId: boot.hotBranchId, search: 'HOT-SKU-0001' },
        { name: 'balances_search_new_nobal', probe: 'stock.listBalances', subject: 'staff-0', branchId: boot.hotBranchId, search: 'NEW-NOBAL-0002' },
        { name: 'balances_needs_recount', probe: 'stock.listBalances', subject: 'staff-0', branchId: boot.hotBranchId, recountOnly: true },
        { name: 'balances_20branch_buyer', probe: 'stock.listBalances', subject: 'staff-8', branchId: boot.hotBranchId },
        { name: 'activity_all', probe: 'stock.listActivity', subject: 'staff-0', branchId: boot.hotBranchId },
        { name: 'activity_hot_variant', probe: 'stock.listActivity', subject: 'staff-0', branchId: boot.hotBranchId, variantId: hotVariantId },
        { name: 'activity_rare_write_off', probe: 'stock.listActivity', subject: 'staff-0', branchId: boot.hotBranchId, kind: 'write_off' },
        { name: 'orders_open', probe: 'purchasing.orders.open', subject: 'staff-0', branchId: boot.hotBranchId },
        { name: 'orders_open_20branch_buyer', probe: 'purchasing.orders.open', subject: 'staff-8', branchId: boot.hotBranchId },
        { name: 'orders_hot_variant_on_order', probe: 'purchasing.orders.item', subject: 'staff-0', branchId: boot.hotBranchId, variantId: hotVariantId, openOnly: true },
        { name: 'orders_hot_variant_all', probe: 'purchasing.orders.item', subject: 'staff-0', branchId: boot.hotBranchId, variantId: hotVariantId, openOnly: false },
        { name: 'requests_all', probe: 'purchasing.requests.all', subject: 'staff-0', branchId: boot.hotBranchId },
        { name: 'requests_hot_variant', probe: 'purchasing.requests.item', subject: 'staff-0', branchId: boot.hotBranchId, variantId: hotVariantId },
        { name: 'retail_browse_default', probe: 'retail.browse', subject: 'staff-0', branchId: boot.hotBranchId, search: '' },
        { name: 'retail_browse_search', probe: 'retail.browse', subject: 'staff-0', branchId: boot.hotBranchId, search: 'HOT-SKU-0001' },
      ];

      const listBudgets = {};
      for (const spec of probes) {
        const res = await admin.query(FIXTURE.probeQueryBudget, {
          subject: spec.subject,
          probe: spec.probe,
          branchId: spec.branchId,
          ...(spec.variantId ? { variantId: spec.variantId } : {}),
          ...(spec.search !== undefined ? { search: spec.search } : {}),
          ...(spec.recountOnly !== undefined ? { recountOnly: spec.recountOnly } : {}),
          ...(spec.kind ? { kind: spec.kind } : {}),
          ...(spec.openOnly !== undefined ? { openOnly: spec.openOnly } : {}),
        });
        const isStockList = !spec.name.startsWith('retail_browse');
        const passDocs = res.db.documents <= GATES.listMaxDocs;
        const passRanges = res.db.ranges <= GATES.listMaxRanges;
        const passBytes = res.db.bytes <= GATES.listMaxBytes;
        listBudgets[spec.name] = {
          category: isStockList ? 'stock_list' : 'pos_browse',
          pageLen: res.pageLen,
          db: res.db,
          readBudget: res.readBudget,
          passed: passDocs && passRanges && passBytes,
        };
      }

      const receiptT0 = performance.now();
      const receiptProbe = await admin.mutation(FIXTURE.probeReceiptBudget, {
        subject: 'staff-0',
        orderId: po50.orderId,
        expectedIssuedRevision: po50.issuedRevision,
        operationKey: `budget-receipt-50-${scaleLabel}-${randomUUID().slice(0, 8)}`,
        lines: po50.lines.map(l => ({ orderLineId: l.orderLineId, accepted: 5 })),
      });
      const receiptStandaloneMs = Number((performance.now() - receiptT0).toFixed(2));
      const receipt50Budget = {
        linesReceived: po50.lines.length,
        standaloneMs: receiptStandaloneMs,
        db: receiptProbe.db,
        readBudget: receiptProbe.readBudget,
        passed:
          receiptProbe.db.documents <= GATES.receiptMaxDocs &&
          receiptProbe.db.ranges <= GATES.receiptMaxRanges &&
          receiptProbe.db.writes <= GATES.receiptMaxWrites,
      };
      return { listBudgets, receipt50Budget };
    }

    async function runConcurrentWorkload(scaleLabel) {
      const collector = new LogCollector(backendUrl, backendConfig.adminKey);
      // Warm-up poll to mark prior seed/probe logs as seen.
      await collector.poll();
      collector.reset();
      collector.start();

      // Prepare pools of receivable 50-line POs and competing-receipt POs in safe <=1,000-write batches.
      const receiptTarget = Math.max(25, Math.ceil(config.durationSeconds * 1.4));
      const receiptPool = [];
      for (let created = 0; created < receiptTarget; created += 20) {
        const chunk = Math.min(20, receiptTarget - created);
        const batch = await seedMutation(FIXTURE.seedReceivableOrders, {
          branchId: boot.hotBranchId,
          supplierId: boot.supplierIds[0],
          variantIds: fiftyLineVariantIds,
          ordersCount: chunk,
          qtyPerLine: 4,
          prefix: `R50-${scaleLabel}-${created}`,
          actorToken: `${boot.issuer}|staff-5`,
          actorLabel: 'staff-5@stock-bench.local',
        });
        receiptPool.push(...batch);
      }
      const competeTarget = Math.max(25, Math.ceil(config.durationSeconds * 1.15));
      const competePool = [];
      const altCompeteVariant = otherWriterVariantIds[0];
      touchedVariants.add(altCompeteVariant);
      for (let created = 0; created < competeTarget; created += 100) {
        const chunk = Math.min(100, competeTarget - created);
        const useHot = Math.floor(created / 100) % 2 === 0;
        const batch = await seedMutation(FIXTURE.seedReceivableOrders, {
          branchId: boot.hotBranchId,
          supplierId: boot.supplierIds[1],
          variantIds: [useHot ? hotVariantId : altCompeteVariant],
          ordersCount: chunk,
          qtyPerLine: 10,
          prefix: `CMP-${scaleLabel}-${created}`,
          actorToken: `${boot.issuer}|staff-7`,
          actorLabel: 'staff-7@stock-bench.local',
        });
        competePool.push(...batch);
      }

      // Open 10 concurrent WebSocket staff sessions + 1 unrelated cold-branch observer.
      const wsSessions = Array.from({ length: config.sessions }, (_, i) => makeWsStaff(`staff-${i}`));
      const httpSessions = Array.from({ length: config.sessions }, (_, i) => makeHttpStaff(`staff-${i}`));
      const coldWs = makeWsStaff('staff-cold');

      // Acknowledge tills for the two POS checkout sessions (staff-3, staff-4).
      const tills = {};
      for (const idx of [3, 4]) {
        const deviceKey = `bench-pos-device-${scaleLabel}-${idx}`;
        const ack = await httpSessions[idx].mutation(API.acknowledgeCutover, {
          deviceKey,
          loadedMode: 'attempts',
          loadedRevision: 0,
        });
        tills[idx] = {
          tillId: ack.tillId,
          deviceKey,
          tabKey: `bench-pos-tab-session-${scaleLabel}-${idx}`,
          load: { tillId: ack.tillId, deviceKey, loadedMode: 'attempts', loadedRevision: 0 },
        };
      }

      // Subscribe live views: hot-branch balances (for live refresh latency) & cold-branch views (for isolation).
      let hotLiveLatestOnHand = null;
      const hotWaiters = [];
      let coldBalancesUpdates = 0;
      let coldOrdersUpdates = 0;
      let coldInitialReady = 0;

      const unsubHotBalances = wsSessions[0].onUpdate(
        API.listBalances,
        { branchId: boot.hotBranchId, search: 'HOT-SKU-0001', paginationOpts: { numItems: 25, cursor: null } },
        (res) => {
          const row = res?.page?.find(r => r.variantId === hotVariantId);
          if (!row) return;
          hotLiveLatestOnHand = row.onHand;
          const now = performance.now();
          for (let i = hotWaiters.length - 1; i >= 0; i--) {
            if (hotLiveLatestOnHand >= hotWaiters[i].targetOnHand) {
              hotWaiters[i].resolve(now);
              hotWaiters.splice(i, 1);
            }
          }
        },
      );
      const unsubHotActivity = wsSessions[1].onUpdate(
        API.listActivity,
        { branchId: boot.hotBranchId, paginationOpts: { numItems: 25, cursor: null } },
        () => {},
      );
      const unsubHotOrders = wsSessions[2].onUpdate(
        API.orders,
        { branchId: boot.hotBranchId, view: { kind: 'phase', phase: 'open' }, paginationOpts: { numItems: 25, cursor: null } },
        () => {},
      );
      const unsubColdBalances = coldWs.onUpdate(
        API.listBalances,
        { branchId: boot.coldBranchId, paginationOpts: { numItems: 25, cursor: null } },
        () => {
          coldBalancesUpdates++;
          if (coldBalancesUpdates === 1) coldInitialReady++;
        },
      );
      const unsubColdOrders = coldWs.onUpdate(
        API.orders,
        { branchId: boot.coldBranchId, view: { kind: 'phase', phase: 'open' }, paginationOpts: { numItems: 25, cursor: null } },
        () => {
          coldOrdersUpdates++;
          if (coldOrdersUpdates === 1) coldInitialReady++;
        },
      );

      await until(() => hotLiveLatestOnHand !== null && coldInitialReady >= 2, 'initial live WebSocket views', 20_000);
      const coldBalancesBaseline = coldBalancesUpdates;
      const coldOrdersBaseline = coldOrdersUpdates;

      const latencies = {
        list_balances: [],
        list_balances_search: [],
        list_balances_recount: [],
        list_balances_20branch: [],
        list_activity_all: [],
        list_activity_hot_variant: [],
        list_activity_rare_write_off: [],
        list_orders_open: [],
        list_orders_on_order_hot: [],
        list_requests_hot_item: [],
        retail_browse: [],
        pos_checkout_sale: [],
        order_create_and_issue: [],
        receipt_50_lines: [],
        live_refresh_ms: [],
      };
      const failures = [];
      const competing = {
        races: 0,
        exactOneWinner: 0,
        cleanStaleOrOverReceipt: 0,
        unexpectedErrors: 0,
        errorCodes: {},
      };

      const startMs = performance.now();
      const deadline = startMs + config.durationSeconds * 1000;
      const shouldContinue = () => performance.now() < deadline;

      async function recordLatency(bucketName, fn) {
        const t0 = performance.now();
        try {
          const result = await fn();
          latencies[bucketName].push(performance.now() - t0);
          return result;
        } catch (error) {
          failures.push({ op: bucketName, message: error instanceof Error ? error.message : String(error) });
          return null;
        }
      }

      // Readers (sessions 0, 1, 2 + session 8 as 20-branch buyer).
      const runReader = async (sessionIdx) => {
        const client = httpSessions[sessionIdx];
        let step = 0;
        while (shouldContinue()) {
          const pick = step++ % 11;
          const page = { numItems: 25, cursor: null };
          if (pick === 0) {
            await recordLatency('list_balances', () =>
              client.query(API.listBalances, { branchId: boot.hotBranchId, paginationOpts: page }));
          } else if (pick === 1) {
            await recordLatency('list_balances_search', () =>
              client.query(API.listBalances, {
                branchId: boot.hotBranchId,
                search: step % 2 === 0 ? 'Apex Hot' : 'NEW-NOBAL-0002',
                paginationOpts: page,
              }));
          } else if (pick === 2) {
            await recordLatency('list_balances_recount', () =>
              client.query(API.listBalances, { branchId: boot.hotBranchId, recountOnly: true, paginationOpts: page }));
          } else if (pick === 3) {
            await recordLatency('list_balances_20branch', () =>
              httpSessions[8].query(API.listBalances, { branchId: boot.hotBranchId, paginationOpts: page }));
          } else if (pick === 4) {
            await recordLatency('list_activity_all', () =>
              client.query(API.listActivity, { branchId: boot.hotBranchId, paginationOpts: page }));
          } else if (pick === 5) {
            await recordLatency('list_activity_hot_variant', () =>
              client.query(API.listActivity, { branchId: boot.hotBranchId, variantId: hotVariantId, paginationOpts: page }));
          } else if (pick === 6) {
            await recordLatency('list_activity_rare_write_off', () =>
              client.query(API.listActivity, { branchId: boot.hotBranchId, kind: 'write_off', paginationOpts: page }));
          } else if (pick === 7) {
            await recordLatency('list_orders_open', () =>
              client.query(API.orders, { branchId: boot.hotBranchId, view: { kind: 'phase', phase: 'open' }, paginationOpts: page }));
          } else if (pick === 8) {
            await recordLatency('list_orders_on_order_hot', () =>
              client.query(API.orders, { branchId: boot.hotBranchId, view: { kind: 'item', variantId: hotVariantId, openOnly: true }, paginationOpts: page }));
          } else if (pick === 9) {
            await recordLatency('list_requests_hot_item', () =>
              client.query(API.requests, { branchId: boot.hotBranchId, view: { kind: 'item', variantId: hotVariantId }, paginationOpts: page }));
          } else {
            await recordLatency('retail_browse', () =>
              client.query(API.retailBrowse, { branchId: boot.hotBranchId, search: 'HOT-SKU-0001', paginationOpts: { numItems: 24, cursor: null } }));
          }
        }
      };

      // POS checkout sales (sessions 3, 4) — cash tender only, zero external payment calls.
      // Shares hotVariantId 50% of the time; other 50% uses non-overlapping catalog variants (not the other 49 receipt lines).
      const runPosCashier = async (sessionIdx) => {
        const client = httpSessions[sessionIdx];
        const till = tills[sessionIdx];
        const today = resortTodayIso();
        let seq = 0;
        while (shouldContinue()) {
          const variantId = seq % 2 === 0
            ? hotVariantId
            : otherWriterVariantIds[(sessionIdx * 31 + seq) % otherWriterVariantIds.length];
          touchedVariants.add(variantId);
          const unitPrice = 25000 + ((variantIds.indexOf(variantId)) % 20) * 1000;
          const opSeq = `${scaleLabel}-${sessionIdx}-${seq++}`;
          await recordLatency('pos_checkout_sale', async () => {
            const added = await client.mutation(API.retailAdd, {
              branchId: boot.hotBranchId,
              variantId,
              quantity: 1,
              expectedPrice: unitPrice,
              clientKey: `pos-add-${opSeq}-${randomUUID().slice(0, 8)}`,
            });
            const orderView = await client.query(API.getOrder, { orderId: added.orderId, view: 'checkout' });
            const order = orderView?.order;
            if (!order) throw new Error('Order disappeared before settlement');
            const started = await client.mutation(API.startPaymentAttempt, {
              orderId: added.orderId,
              tillId: till.tillId,
              tabKey: till.tabKey,
              load: till.load,
              clientKey: `pos-pay-${opSeq}-${randomUUID().slice(0, 8)}`,
              expectedRevision: order.revision,
              expectedDue: order.due,
              businessDate: today,
              customers: [],
              vouchers: [],
              legs: [{ key: 'cash', method: 'cash', amount: order.due }],
            });
            if (started.status !== 'ready') throw new Error(`startPaymentAttempt returned ${JSON.stringify(started)}`);
            const attempt = {
              attemptId: started.attempt.attemptId,
              ownerRevision: started.attempt.ownerRevision,
              tillId: till.tillId,
              tabKey: till.tabKey,
            };
            const armed = await client.mutation(API.armPaymentLeg, { ...attempt, load: till.load, legKey: 'cash' });
            if (armed.status !== 'instruct') throw new Error(`armPaymentLeg returned ${JSON.stringify(armed)}`);
            const recorded = await client.mutation(API.recordPaymentLeg, {
              ...attempt,
              legKey: 'cash',
              outcome: 'taken',
              received: order.due,
            });
            if (recorded.status !== 'recorded') throw new Error(`recordPaymentLeg returned ${JSON.stringify(recorded)}`);
            const settled = await client.mutation(API.settlePaymentAttempt, attempt);
            if (settled.status !== 'settled') throw new Error(`settlePaymentAttempt returned ${JSON.stringify(settled)}`);
            return settled;
          });
          await delay(config.writePaceMs);
        }
      };

      // Order creation & issue (session 5) — shares hotVariantId 50% of the time; non-hot lines come from otherWriterVariantIds.
      const runOrderCreator = async () => {
        const client = httpSessions[5];
        let seq = 0;
        while (shouldContinue()) {
          const opId = `${scaleLabel}-ord-${seq++}-${randomUUID().slice(0, 6)}`;
          const otherLen = otherWriterVariantIds.length;
          const idxA = (seq * 7) % otherLen;
          const idxB = (idxA + 1) % otherLen;
          const firstVariant = seq % 2 === 0 ? hotVariantId : otherWriterVariantIds[idxA];
          const secondVariant = otherWriterVariantIds[idxB];
          touchedVariants.add(firstVariant);
          touchedVariants.add(secondVariant);
          await recordLatency('order_create_and_issue', async () => {
            const draft = await client.mutation(API.saveOrder, {
              branchId: boot.hotBranchId,
              supplierId: boot.supplierIds[seq % boot.supplierIds.length],
              lines: [
                { variantId: firstVariant, quantity: 5, unitCost: 5000 },
                { variantId: secondVariant, quantity: 5, unitCost: 5000 },
              ],
              operationKey: `save-${opId}`,
            });
            const issueArgs = {
              orderId: draft.id,
              expectedRevision: draft.revision,
              operationKey: `issue-${opId}`,
            };
            await postStockWithRetry(() => client.mutation(API.issuePurchaseOrder, issueArgs));
          });
          await delay(config.writePaceMs);
        }
      };

      // 50-line receipts sharing hotVariant (session 6) — uses production postStockWithRetry with identical payload/key.
      const runReceipt50 = async () => {
        const client = httpSessions[6];
        let cursor = 0;
        while (shouldContinue()) {
          let po = receiptPool[cursor++];
          if (!po) {
            const more = await seedMutation(FIXTURE.seedReceivableOrders, {
              branchId: boot.hotBranchId,
              supplierId: boot.supplierIds[0],
              variantIds: fiftyLineVariantIds,
              ordersCount: 10,
              qtyPerLine: 4,
              prefix: `R50X-${scaleLabel}-${cursor}`,
              actorToken: `${boot.issuer}|staff-6`,
              actorLabel: 'staff-6@stock-bench.local',
            });
            receiptPool.push(...more);
            po = receiptPool[cursor - 1];
          }
          const receiptArgs = {
            orderId: po.orderId,
            expectedIssuedRevision: po.issuedRevision,
            operationKey: `rec50-${scaleLabel}-${cursor}-${randomUUID().slice(0, 8)}`,
            lines: po.lines.map(l => ({ orderLineId: l.orderLineId, accepted: 4 })),
          };
          await recordLatency('receipt_50_lines', () =>
            postStockWithRetry(() => client.mutation(API.receivePurchaseOrder, receiptArgs)));
          await delay(config.writePaceMs);
        }
      };

      // Competing receipts on one PO (sessions 7 & 8 racing concurrently on due=10 with 8+8) — same production retry helper per closure.
      const runCompetingReceipts = async () => {
        const c1 = httpSessions[7];
        const c2 = httpSessions[8];
        let cursor = 0;
        while (shouldContinue()) {
          let po = competePool[cursor++];
          if (!po) {
            const more = await seedMutation(FIXTURE.seedReceivableOrders, {
              branchId: boot.hotBranchId,
              supplierId: boot.supplierIds[1],
              variantIds: [cursor % 2 === 0 ? hotVariantId : altCompeteVariant],
              ordersCount: 10,
              qtyPerLine: 10,
              prefix: `CMPX-${scaleLabel}-${cursor}`,
              actorToken: `${boot.issuer}|staff-7`,
              actorLabel: 'staff-7@stock-bench.local',
            });
            competePool.push(...more);
            po = competePool[cursor - 1];
          }
          competing.races++;
          const lineId = po.lines[0].orderLineId;
          const argsA = {
            orderId: po.orderId,
            expectedIssuedRevision: po.issuedRevision,
            operationKey: `cmpA-${scaleLabel}-${cursor}-${randomUUID().slice(0, 6)}`,
            lines: [{ orderLineId: lineId, accepted: 8 }],
          };
          const argsB = {
            orderId: po.orderId,
            expectedIssuedRevision: po.issuedRevision,
            operationKey: `cmpB-${scaleLabel}-${cursor}-${randomUUID().slice(0, 6)}`,
            lines: [{ orderLineId: lineId, accepted: 8 }],
          };
          const [r1, r2] = await Promise.allSettled([
            postStockWithRetry(() => c1.mutation(API.receivePurchaseOrder, argsA)),
            postStockWithRetry(() => c2.mutation(API.receivePurchaseOrder, argsB)),
          ]);
          const fulfilled = [r1, r2].filter(r => r.status === 'fulfilled');
          const rejected = [r1, r2].filter(r => r.status === 'rejected');
          if (fulfilled.length === 1 && rejected.length === 1) {
            competing.exactOneWinner++;
            const errCode = extractErrorCode(rejected[0].reason) ?? 'UNKNOWN';
            competing.errorCodes[errCode] = (competing.errorCodes[errCode] ?? 0) + 1;
            if (['OVER_RECEIPT', 'ORDER_STATE', 'STALE'].includes(errCode)) {
              competing.cleanStaleOrOverReceipt++;
            } else {
              competing.unexpectedErrors++;
            }
          } else {
            competing.unexpectedErrors++;
          }
          await delay(config.writePaceMs);
        }
      };

      // Live view refresh latency probe (session 9): commit a positive adjustment and time until WS view updates.
      const runLiveRefreshProbe = async () => {
        const client = httpSessions[9];
        let seq = 0;
        while (shouldContinue()) {
          let staleRetries = 0;
          while (shouldContinue() && staleRetries < 4) {
            try {
              const beforeLevel = await admin.query(FIXTURE.readStockLevelExact, {
                branchId: boot.hotBranchId,
                variantId: hotVariantId,
              });
              const delta = 50; // Large positive bump so concurrent small sales cannot mask it.
              const targetOnHand = beforeLevel.onHand + delta;
              let resolveWaiter;
              const waiterPromise = new Promise((resolve) => {
                resolveWaiter = resolve;
              });
              const waiter = { targetOnHand, resolve: resolveWaiter };
              hotWaiters.push(waiter);
              const commitStart = performance.now();
              await client.mutation(API.postOperation, {
                branchId: boot.hotBranchId,
                kind: 'adjust',
                reason: 'Live view refresh probe',
                reasonCode: 'found',
                operationKey: `live-probe-${scaleLabel}-${seq++}-${randomUUID().slice(0, 8)}`,
                lines: [{ variantId: hotVariantId, quantity: delta, expectedRevision: beforeLevel.revision }],
              });
              const committedAt = performance.now();
              const observedAt = await Promise.race([
                waiterPromise,
                delay(5_000).then(() => null),
              ]);
              const idx = hotWaiters.indexOf(waiter);
              if (idx >= 0) hotWaiters.splice(idx, 1);
              if (observedAt !== null) {
                latencies.live_refresh_ms.push(Math.max(0, observedAt - committedAt));
              } else {
                failures.push({ op: 'live_refresh_ms', message: `Live view did not reflect onHand>=${targetOnHand} within 5000ms (start=${commitStart.toFixed(0)})` });
              }
              break;
            } catch (error) {
              const code = extractErrorCode(error);
              if (code === 'STALE_STOCK_BALANCE') {
                staleRetries++;
                continue;
              }
              failures.push({ op: 'live_refresh_ms', message: error instanceof Error ? error.message : String(error) });
              break;
            }
          }
          await delay(Math.min(900, Math.max(400, config.writePaceMs)));
        }
      };

      await Promise.all([
        runReader(0),
        runReader(1),
        runReader(2),
        runPosCashier(3),
        runPosCashier(4),
        runOrderCreator(),
        runReceipt50(),
        runCompetingReceipts(),
        runLiveRefreshProbe(),
      ]);

      await delay(300);
      const coldBalancesExtraUpdates = coldBalancesUpdates - coldBalancesBaseline;
      const coldOrdersExtraUpdates = coldOrdersUpdates - coldOrdersBaseline;

      unsubHotBalances();
      unsubHotActivity();
      unsubHotOrders();
      unsubColdBalances();
      unsubColdOrders();
      await collector.stop();

      const elapsedSec = Number(((performance.now() - startMs) / 1000).toFixed(2));
      const latencySummary = Object.fromEntries(
        Object.entries(latencies).map(([k, vals]) => [k, summarize(vals)]),
      );
      const failureCountsByOp = {};
      const failureSamplesByOp = {};
      for (const f of failures) {
        failureCountsByOp[f.op] = (failureCountsByOp[f.op] ?? 0) + 1;
        failureSamplesByOp[f.op] ??= [];
        if (failureSamplesByOp[f.op].length < 3) failureSamplesByOp[f.op].push(f.message);
      }
      return {
        scaleLabel,
        elapsedSec,
        sessions: config.sessions,
        latencySummary,
        competing,
        unrelatedBranchIsolation: {
          coldBalancesExtraUpdates,
          coldOrdersExtraUpdates,
          isolated: coldBalancesExtraUpdates === 0 && coldOrdersExtraUpdates === 0,
        },
        unrecoveredFailures: failures.length,
        failureCountsByOp,
        failureSamplesByOp,
        convexTelemetry: collector.summary(),
      };
    }

    async function reconcile() {
      const checkedVariants = [...touchedVariants];
      const balanceDrifts = [];
      const incomingDrifts = [];
      let totalMovementsReconciled = 0;
      let totalOpenLinesReconciled = 0;

      for (const variantId of checkedVariants) {
        let cursor = null;
        let deltaSum = 0;
        for (;;) {
          const page = await admin.query(FIXTURE.sumMovementsPage, {
            branchId: boot.hotBranchId,
            variantId,
            cursor,
          });
          deltaSum += page.deltaSum;
          totalMovementsReconciled += page.rowCount;
          if (page.isDone) break;
          cursor = page.continueCursor;
        }
        const level = await admin.query(FIXTURE.readStockLevelExact, {
          branchId: boot.hotBranchId,
          variantId,
        });
        if (level.onHand !== deltaSum) {
          balanceDrifts.push({ branch: 'hot', variantId, expectedOnHand: deltaSum, actualOnHand: level.onHand });
        }

        let incCursor = null;
        let dueSum = 0;
        for (;;) {
          const page = await admin.query(FIXTURE.sumOpenDuePage, {
            branchId: boot.hotBranchId,
            variantId,
            cursor: incCursor,
          });
          dueSum += page.dueSum;
          totalOpenLinesReconciled += page.rowCount;
          if (page.isDone) break;
          incCursor = page.continueCursor;
        }
        const incoming = await admin.query(FIXTURE.readIncomingExact, {
          branchId: boot.hotBranchId,
          variantId,
        });
        if (incoming.quantity !== dueSum) {
          incomingDrifts.push({ branch: 'hot', variantId, expectedIncoming: dueSum, actualIncoming: incoming.quantity });
        }
      }

      // Verify newly cataloged variant still has no stockLevels row unless touched.
      const newVariantLevel = await admin.query(FIXTURE.readStockLevelExact, {
        branchId: boot.hotBranchId,
        variantId: newNoBalanceVariantId,
      });

      return {
        variantsChecked: checkedVariants.length,
        totalMovementsReconciled,
        totalOpenLinesReconciled,
        balanceDriftCount: balanceDrifts.length,
        incomingDriftCount: incomingDrifts.length,
        balanceDrifts: balanceDrifts.slice(0, 10),
        incomingDrifts: incomingDrifts.slice(0, 10),
        newNoBalanceVariantExistsInStockLevels: newVariantLevel.exists,
        passed: balanceDrifts.length === 0 && incomingDrifts.length === 0,
      };
    }

    // ---------- 1x Phase ----------
    console.log(`[stock-bench] Seeding 1x dataset (${config.orders1x} orders, ${config.orders1x * config.linesPerOrder} lines, ${config.movements1x} movements, ${config.variants} variants)...`);
    const seed1x = await seedScaleIncrement('1x', 1);
    console.log(`[stock-bench] Seeded 1x in ${seed1x.elapsedSec}s. Probing exact DB budgets at 1x...`);
    const budgets1x = await measureExactBudgets('1x');
    console.log(`[stock-bench] Running ${config.sessions}-session concurrent load at 1x for ${config.durationSeconds}s...`);
    const load1x = await runConcurrentWorkload('1x');
    console.log('[stock-bench] Reconciling balances & On order after 1x load...');
    const reconcile1x = await reconcile();
    const jsonFile = outPath
      ? path.resolve(root, outPath)
      : path.join(root, 'output', `stock-bench-${presetName}-${runId}.json`);
    await fs.writeFile(
      jsonFile,
      JSON.stringify({ schemaVersion: 1, status: 'in_progress_after_1x', preset: presetName, config, gates: GATES, seed1x, budgets1x, load1x, reconcile1x }, null, 2) + '\n',
      { mode: 0o600 },
    );

    // ---------- 2x Phase ----------
    let seed2x = null;
    let budgets2x = null;
    let load2x = null;
    let reconcile2x = null;
    let scalingComparison = null;

    if (config.run2x) {
      console.log(`[stock-bench] Doubling historical data to 2x (+${config.orders1x} orders, +${config.orders1x * config.linesPerOrder} lines, +${config.movements1x} movements)...`);
      seed2x = await seedScaleIncrement('2x', 2);
      console.log(`[stock-bench] Seeded 2x delta in ${seed2x.elapsedSec}s. Probing exact DB budgets at 2x...`);
      budgets2x = await measureExactBudgets('2x');
      console.log(`[stock-bench] Running ${config.sessions}-session concurrent load at 2x for ${config.durationSeconds}s...`);
      load2x = await runConcurrentWorkload('2x');
      console.log('[stock-bench] Reconciling balances & On order after 2x load...');
      reconcile2x = await reconcile();

      scalingComparison = {};
      for (const name of Object.keys(budgets1x.listBudgets)) {
        const d1 = budgets1x.listBudgets[name].db.documents;
        const d2 = budgets2x.listBudgets[name].db.documents;
        const r1 = budgets1x.listBudgets[name].db.ranges;
        const r2 = budgets2x.listBudgets[name].db.ranges;
        const docGrowthPct = d1 === 0 ? 0 : Number((((d2 - d1) / d1) * 100).toFixed(2));
        const rangeGrowthPct = r1 === 0 ? 0 : Number((((r2 - r1) / r1) * 100).toFixed(2));
        scalingComparison[name] = {
          docs1x: d1,
          docs2x: d2,
          docGrowthPct,
          ranges1x: r1,
          ranges2x: r2,
          rangeGrowthPct,
          within10Pct: docGrowthPct <= GATES.scale2xMaxReadGrowthPct && rangeGrowthPct <= GATES.scale2xMaxReadGrowthPct,
        };
      }
    }

    // ---------- Gate evaluation ----------
    const listLatencyKeys = [
      'list_balances', 'list_balances_search', 'list_balances_recount', 'list_balances_20branch',
      'list_activity_all', 'list_activity_hot_variant', 'list_activity_rare_write_off',
      'list_orders_open', 'list_orders_on_order_hot', 'list_requests_hot_item', 'retail_browse',
    ];
    const checkLoadGates = (load) => {
      const listP95Ok = listLatencyKeys.every(k => (load.latencySummary[k]?.p95 ?? 0) <= GATES.listP95Ms);
      const receiptP95Ok = (load.latencySummary.receipt_50_lines?.p95 ?? Infinity) <= GATES.receipt50P95Ms;
      const liveP95Ok = (load.latencySummary.live_refresh_ms?.p95 ?? Infinity) <= GATES.liveRefreshP95Ms;
      const competingOk = load.competing.races > 0 && load.competing.unexpectedErrors === 0 && load.competing.exactOneWinner === load.competing.races;
      const zeroFailures = load.unrecoveredFailures === 0;
      const isolated = load.unrelatedBranchIsolation.isolated;
      return { listP95Ok, receiptP95Ok, liveP95Ok, competingOk, zeroFailures, isolated };
    };

    const gates1x = checkLoadGates(load1x);
    const gates2x = load2x ? checkLoadGates(load2x) : null;
    const stockListsOk = (budgets) =>
      Object.values(budgets.listBudgets).filter(b => b.category === 'stock_list').every(b => b.passed);
    const posBrowseOk = (budgets) =>
      Object.values(budgets.listBudgets).filter(b => b.category === 'pos_browse').every(b => b.passed);
    const allListBudgets1xOk = stockListsOk(budgets1x);
    const allListBudgets2xOk = budgets2x ? stockListsOk(budgets2x) : null;
    const scalingOk = scalingComparison ? Object.values(scalingComparison).every(s => s.within10Pct) : null;

    const pendingPilotRequirements = [];
    if (config.orders1x < GATES.pilotOrders1x || config.orders1x * config.linesPerOrder < GATES.pilotLines1x || config.movements1x < GATES.pilotMovements1x || config.variants < GATES.pilotVariants) {
      pendingPilotRequirements.push(`Data scale below pilot minimum (${config.orders1x}/${config.orders1x * config.linesPerOrder}/${config.movements1x}/${config.variants} vs ${GATES.pilotOrders1x}/${GATES.pilotLines1x}/${GATES.pilotMovements1x}/${GATES.pilotVariants})`);
    }
    if (!config.run2x) pendingPilotRequirements.push('2x historical data repetition was skipped (--skip-2x)');
    if (config.durationSeconds < GATES.pilotDurationSeconds) {
      pendingPilotRequirements.push(`Load duration ${config.durationSeconds}s per scale < required ${GATES.pilotDurationSeconds}s (5 min) pilot soak gate`);
    }
    const minObservedSamples = Math.min(
      ...Object.values(load1x.latencySummary).map(s => s.n),
      ...(load2x ? Object.values(load2x.latencySummary).map(s => s.n) : []),
    );
    if (minObservedSamples < GATES.pilotMinSamples) {
      pendingPilotRequirements.push(`Minimum path sample count ${minObservedSamples} < required ${GATES.pilotMinSamples} samples/path pilot gate`);
    }

    const staticBudgetGates = {
      stockListBudgets1xOk: allListBudgets1xOk,
      stockListBudgets2xOk: allListBudgets2xOk,
      posBrowseBudgets1xOk: posBrowseOk(budgets1x),
      posBrowseBudgets2xOk: budgets2x ? posBrowseOk(budgets2x) : null,
      receipt50Budget1xOk: budgets1x.receipt50Budget.passed,
      receipt50Budget2xOk: budgets2x ? budgets2x.receipt50Budget.passed : null,
      scaling1xTo2xOk: scalingOk,
      passed:
        allListBudgets1xOk &&
        posBrowseOk(budgets1x) &&
        budgets1x.receipt50Budget.passed &&
        (budgets2x ? allListBudgets2xOk && posBrowseOk(budgets2x) && budgets2x.receipt50Budget.passed : true) &&
        scalingOk !== false,
    };
    const localTimingGates = {
      scale1x: { listP95Ok: gates1x.listP95Ok, receiptP95Ok: gates1x.receiptP95Ok, liveP95Ok: gates1x.liveP95Ok },
      scale2x: gates2x ? { listP95Ok: gates2x.listP95Ok, receiptP95Ok: gates2x.receiptP95Ok, liveP95Ok: gates2x.liveP95Ok } : null,
      passed:
        gates1x.listP95Ok &&
        gates1x.receiptP95Ok &&
        gates1x.liveP95Ok &&
        (!gates2x || (gates2x.listP95Ok && gates2x.receiptP95Ok && gates2x.liveP95Ok)),
    };
    const correctnessGates = {
      scale1x: {
        competingOk: gates1x.competingOk,
        zeroFailures: gates1x.zeroFailures,
        isolated: gates1x.isolated,
        reconcileOk: reconcile1x.passed,
      },
      scale2x: gates2x
        ? {
            competingOk: gates2x.competingOk,
            zeroFailures: gates2x.zeroFailures,
            isolated: gates2x.isolated,
            reconcileOk: reconcile2x?.passed ?? null,
          }
        : null,
      passed:
        gates1x.competingOk &&
        gates1x.zeroFailures &&
        gates1x.isolated &&
        reconcile1x.passed &&
        (!gates2x || (gates2x.competingOk && gates2x.zeroFailures && gates2x.isolated && reconcile2x?.passed === true)),
    };
    const allQualityGatesPassed = staticBudgetGates.passed && localTimingGates.passed && correctnessGates.passed;
    const pilotScopeMet = pendingPilotRequirements.length === 0;
    const fullPilotGateMet = pilotScopeMet && allQualityGatesPassed;

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      preset: presetName,
      runtime: { node: process.version, platform: process.platform, arch: process.arch },
      config,
      gates: GATES,
      seed1x,
      budgets1x,
      load1x,
      reconcile1x,
      seed2x,
      budgets2x,
      load2x,
      reconcile2x,
      scalingComparison,
      evaluation: {
        staticBudgetGates,
        localTimingGates,
        correctnessGates,
        stockListBudgets1xOk: allListBudgets1xOk,
        stockListBudgets2xOk: allListBudgets2xOk,
        posBrowseBudgets1xOk: posBrowseOk(budgets1x),
        posBrowseBudgets2xOk: budgets2x ? posBrowseOk(budgets2x) : null,
        receipt50Budget1xOk: budgets1x.receipt50Budget.passed,
        receipt50Budget2xOk: budgets2x ? budgets2x.receipt50Budget.passed : null,
        budgets1xOk: allListBudgets1xOk && posBrowseOk(budgets1x) && budgets1x.receipt50Budget.passed,
        budgets2xOk: budgets2x ? allListBudgets2xOk && posBrowseOk(budgets2x) && budgets2x.receipt50Budget.passed : null,
        scaling1xTo2xOk: scalingOk,
        load1xGates: gates1x,
        load2xGates: gates2x,
        reconcile1xOk: reconcile1x.passed,
        reconcile2xOk: reconcile2x ? reconcile2x.passed : null,
        allQualityGatesPassed,
        pilotScopeMet,
        fullPilotGateMet,
        pendingPilotRequirements,
      },
    };

    await fs.writeFile(jsonFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });

    console.log('\n=== STOCK LOAD & ACCEPTANCE SUMMARY ===');
    console.log(`Report written to: ${jsonFile}`);
    console.log(`Preset: ${presetName} | 1x seeded in ${seed1x.elapsedSec}s | 2x seeded in ${seed2x?.elapsedSec ?? 'N/A'}s`);
    console.log(`Static Budget Gates: ${staticBudgetGates.passed} (1x=${report.evaluation.budgets1xOk}, 2x=${report.evaluation.budgets2xOk}, 1x->2x<=10%=${scalingOk})`);
    console.log(`Local Timing Gates: ${localTimingGates.passed} | Correctness Gates: ${correctnessGates.passed}`);
    console.log(`1x Load Gates:`, gates1x);
    if (gates2x) console.log(`2x Load Gates:`, gates2x);
    console.log(`Reconcile 1x: drift(bal=${reconcile1x.balanceDriftCount}, inc=${reconcile1x.incomingDriftCount}) | 2x: ${reconcile2x ? `drift(bal=${reconcile2x.balanceDriftCount}, inc=${reconcile2x.incomingDriftCount})` : 'N/A'}`);
    console.log(`Quality Gates Passed: ${allQualityGatesPassed} | Pilot Scope Met: ${pilotScopeMet} | Full Pilot Gate Met: ${fullPilotGateMet}`);
    if (pendingPilotRequirements.length) {
      console.log('Pending full pilot scope items:');
      for (const item of pendingPilotRequirements) console.log(`  - ${item}`);
    } else if (fullPilotGateMet) {
      console.log('Full pilot gate PASSED (scope + all quality/timing/budget/reconciliation gates)!');
    } else {
      console.log('Full pilot scope met, but one or more quality/timing/budget gates FAILED.');
    }

    if (!allQualityGatesPassed) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

await main();
