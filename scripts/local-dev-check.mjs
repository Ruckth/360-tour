#!/usr/bin/env node
// Opt-in real local lifecycle acceptance. No shared backend, business providers or saved browser state.
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { clerk, clerkSetup } from '@clerk/testing/playwright';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { testUsers } from './e2e-clerk.mjs';
import { clerkFields } from './local-dev-config.mjs';
import { disabledServices, createPrivateOutput } from './local-integration-config.mjs';
import { waitFor } from './local-processes.mjs';

process.umask(0o077);
const root = process.cwd(), configFile = path.join(root, '.env.dev.local');
if (await fs.lstat(configFile).then(() => true, () => false)) throw new Error('Refusing to overwrite .env.dev.local; run lifecycle acceptance in an unconfigured isolated checkout');
const supplied = Object.fromEntries(clerkFields.map(key => [key, process.env[key]]));
const contents = await fs.readFile('.env.e2e.local', 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
for (const line of contents.split('\n')) {
  const [key, ...rest] = line.split('=');
  if (clerkFields.includes(key) && !supplied[key]) supplied[key] = rest.join('=').replace(/^['"]|['"]$/g, '');
}
const secrets = Object.values(supplied);
const output = createPrivateOutput(line => process.stdout.write(line), secrets);
let provisioned, browser, child, blocker;
const children = [];
const blockerSockets = new Set();
let cleanup;
function finalize() {
  return cleanup ??= (async () => {
    const failures = [];
    for (const ownChild of children) if (ownChild.exitCode === null && ownChild.signalCode === null) ownChild.kill('SIGINT');
    try { await stop(); } catch (error) { failures.push(error); }
    try { await browser?.close(); } catch (error) { failures.push(error); }
    // External identity cleanup must not depend on an idle TCP socket closing.
    try { await provisioned?.cleanupSessions(); } catch (error) { failures.push(error); }
    await fs.rm(configFile, { force: true });
    for (const socket of blockerSockets) socket.destroy();
    if (blocker) await new Promise(resolve => blocker.close(resolve));
    if (failures.length) throw new Error(`Lifecycle cleanup failed in ${failures.length} operation(s)`);
    console.log('Owned processes and unique Clerk test users cleaned; local data retained.');
  })();
}
for (const name of ['SIGINT', 'SIGTERM']) process.on(name, () => { void finalize().finally(() => process.exit(130)); });
let activeLog = '';
const port = await new Promise((resolve, reject) => {
  const server = net.createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const result = server.address().port; server.close(() => resolve(result)); });
});
const report = [];
const app = `http://localhost:${port}`;
const childEnv = { PATH: process.env.PATH, ...disabledServices };
async function start() {
  activeLog = '';
  child = spawn(process.execPath, ['scripts/local-dev.mjs'], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', value => { activeLog += value; output.write(value); });
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`Dev exited before readiness: ${activeLog}`);
    return activeLog.includes('Local development ready at');
  }, 'development loop readiness');
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGINT');
  await waitFor(async () => child.exitCode !== null || child.signalCode !== null, 'SIGINT cleanup', 15000);
  assert.equal(child.exitCode, 130);
}
async function stoppedPorts() {
  const ports = JSON.parse(await fs.readFile('.local-dev/ports.json', 'utf8'));
  for (const port of [ports.cloud, ports.site]) {
    await waitFor(async () => { try { await fetch(`http://127.0.0.1:${port}/instance_name`); return false; } catch { return true; } }, 'owned backend port closure', 10000);
  }
  await assert.rejects(fs.stat('.local-dev/lock'), { code: 'ENOENT' });
}
async function login(page, role) {
  await page.goto(app + '/admin/chats', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await clerk.signIn({ page, emailAddress: provisioned.users[role].email });
  const token = await page.evaluate(async () => window.Clerk.session.getToken({ template: 'convex' }));
  assert.ok(token);
  const ports = JSON.parse(await fs.readFile('.local-dev/ports.json', 'utf8'));
  const client = new ConvexHttpClient(`http://127.0.0.1:${ports.cloud}`, { logger: false });
  client.setAuth(token);
  return client;
}
try {
  provisioned = await testUsers(supplied);
  await fs.writeFile(configFile, clerkFields.map(key => `${key}=${supplied[key]}`).join('\n') + `\nLOCAL_DEV_OWNER_EMAILS=${provisioned.users.owner.email}\nLOCAL_DEV_PORT=${port}\n`, { mode: 0o600, flag: 'wx' });
  await start();
  const firstConfig = JSON.parse(await fs.readFile('.local-dev/backend/.convex/local/default/config.json', 'utf8'));
  assert.ok(firstConfig.deploymentName.startsWith('anonymous-'));
  report.push(activeLog.includes('Local backend seeded from empty.') ? 'Fresh anonymous backend seeded from empty before Next.' : 'Existing local data retained; empty-only seed refused.');
  const configStat = await fs.stat('.local-dev/backend/.convex/local/default/config.json');
  assert.equal(configStat.mode & 0o077, 0);
  const duplicate = spawnSync(process.execPath, ['scripts/local-dev.mjs'], { cwd: root, env: childEnv, encoding: 'utf8' });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /Local dev lock exists/);
  report.push('Concurrent startup refused the lock without stopping its owner.');
  for (const [key, value] of Object.entries(supplied)) process.env[key] = value;
  await clerkSetup({ dotenv: false, publishableKey: supplied.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, secretKey: supplied.CLERK_SECRET_KEY });
  browser = await chromium.launch();
  let page = await browser.newPage();
  const owner = await login(page, 'owner');
  assert.equal((await owner.query(makeFunctionReference('auth/staffAccess:myAccess'), {})).role, 'owner');
  const saved = await owner.mutation(makeFunctionReference('pos/commands/addItem:addItem'), { item: { kind: 'extra', name: 'Phase3f persistent local item', price: 12300 } });
  const before = await owner.query(makeFunctionReference('pos/orders:getOrder'), { orderId: saved.orderId });
  assert.ok(before.lines.some(line => line._id === saved.lineId));
  report.push('Real Clerk owner browser JWT authorized a durable local order write.');
  await clerk.signOut({ page }); await page.close();
  page = await browser.newPage();
  const nonstaff = await login(page, 'nonstaff');
  assert.equal((await nonstaff.query(makeFunctionReference('auth/staffAccess:myAccess'), {})).role, null);
  await assert.rejects(nonstaff.query(makeFunctionReference('pos/catalog:stableCatalog'), {}));
  await clerk.signOut({ page }); await page.close();
  report.push('Real Clerk nonstaff JWT refused protected catalog access.');
  await stop(); await stoppedPorts();
  await assert.rejects(fetch(app + '/en'));
  report.push('SIGINT stopped Next and Convex, released the lock and retained private data.');
  await start();
  assert.ok(activeLog.includes('Local backend data preserved; seed refused nonempty database.'));
  const afterConfig = JSON.parse(await fs.readFile('.local-dev/backend/.convex/local/default/config.json', 'utf8'));
  assert.equal(afterConfig.deploymentName, firstConfig.deploymentName);
  page = await browser.newPage();
  const restartedOwner = await login(page, 'owner');
  const after = await restartedOwner.query(makeFunctionReference('pos/orders:getOrder'), { orderId: saved.orderId });
  assert.deepEqual(after, before);
  // The mutation itself still refuses a populated DB; no reset/repair path exists.
  const admin = new ConvexHttpClient(`http://127.0.0.1:${afterConfig.ports.cloud}`, { logger: false });
  admin.setAdminAuth(afterConfig.adminKey);
  await assert.rejects(admin.mutation(makeFunctionReference('maintenance/seed:seedAll'), { scenario: 'demo-resort' }), /Seed requires an empty database/);
  assert.deepEqual(await restartedOwner.query(makeFunctionReference('pos/orders:getOrder'), { orderId: saved.orderId }), before);
  await clerk.signOut({ page }); await page.close();
  report.push('Restart reused the exact anonymous deployment; real Clerk query read the identical saved order; direct reseed refused without changing it.');
  await stop(); await stoppedPorts();
  blocker = net.createServer();
  blocker.on('connection', socket => { blockerSockets.add(socket); socket.on('close', () => blockerSockets.delete(socket)); });
  await new Promise(resolve => blocker.listen(port, 'localhost', resolve));
  activeLog = '';
  child = spawn(process.execPath, ['scripts/local-dev.mjs'], { cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(child);
  for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', value => { activeLog += value; });
  await waitFor(async () => child.exitCode !== null, 'Next port failure cleanup', 180000);
  assert.equal(child.exitCode, 1);
  assert.ok(activeLog.includes('exited') || activeLog.includes('failed'));
  await stoppedPorts();
  report.push('Occupied Next port caused failure, stopped its backend and released the lock.');
  console.log(report.join('\n'));
} catch (error) {
  output.write(`Local lifecycle acceptance failed: ${error.stack || error.message}\n${activeLog}\n`); output.end(); process.exitCode = 1;
} finally {
  await finalize();
  await delay(100);
}
