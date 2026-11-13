#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { ConvexHttpClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { readDevConfig, refuseInheritedTarget, devEnvironment, requireAnonymousState } from './local-dev-config.mjs';
import { requireLocalBackend, createPrivateOutput } from './local-integration-config.mjs';
import { localProcesses, waitFor } from './local-processes.mjs';
import { seedEmpty } from './seed-empty.mjs';
import { localConvexCache } from './local-convex-cache.mjs';

process.umask(0o077);
const root = await fs.realpath(process.cwd());
const work = path.join(root, '.local-dev');
const project = path.join(work, 'backend');
let processes;
let lock;
let interrupted = false;
const abort = new AbortController();
let release;
const signal = new Promise(resolve => { release = resolve; });
for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, () => { interrupted = true; abort.abort(); release(); });
const wait = (check, label) => waitFor(check, label, 180000, abort.signal);
const localFetch = (resource, options = {}) => fetch(resource, { ...options, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
let secrets = [];
try {
  if (process.argv.length > 2) throw new Error('pnpm dev accepts no reset or remote-target options; configure .env.dev.local');
  refuseInheritedTarget(process.env);
  const config = await readDevConfig(path.join(root, '.env.dev.local'));
  secrets = Object.values(config).map(String);
  // Never follow a transplanted state directory into another checkout.
  await fs.mkdir(work, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(work)).isSymbolicLink()) throw new Error('.local-dev must not be a symlink');
  await fs.chmod(work, 0o700);
  lock = await fs.open(path.join(work, 'lock'), 'wx', 0o600).catch(() => { throw new Error('Local dev lock exists. Stop its owner; after a crash verify its processes stopped before removing .local-dev/lock. Data must be retained.'); });
  await lock.writeFile(String(process.pid));
  const identityFile = path.join(work, 'checkout.json');
  try {
    if (JSON.parse(await fs.readFile(identityFile, 'utf8')).root !== root) throw new Error('Local state belongs to another checkout');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.writeFile(identityFile, JSON.stringify({ root }), { mode: 0o600 });
  }
  const home = path.join(work, 'home');
  for (const dir of [home, project]) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await localConvexCache(root, home);
  for (const name of ['node_modules']) {
    const link = path.join(project, name);
    try { await fs.symlink(path.join(root, name), link, 'dir'); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (await fs.realpath(link) !== path.join(root, name)) throw new Error(`Unexpected local ${name} link`);
  }
  // A real functions path avoids component-bundler symlink identity issues.
  // CLI deployment state and dotenv writes remain relative to this private project cwd.
  await fs.writeFile(path.join(project, 'convex.json'), JSON.stringify({ functions: path.relative(project, path.join(root, 'convex')), codegen: { fileType: 'js/dts' } }), { mode: 0o600 });
  await fs.copyFile(path.join(root, 'package.json'), path.join(project, 'package.json'));
  const port = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); });
  });
  // Configured ports persist; occupied ports fail instead of selecting a shared backend.
  const portsFile = path.join(work, 'ports.json');
  let ports;
  try { ports = JSON.parse(await fs.readFile(portsFile, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    ports = { cloud: await port(), site: await port() };
    await fs.writeFile(portsFile, JSON.stringify(ports), { mode: 0o600 });
  }
  if (![ports.cloud, ports.site].every(value => Number.isInteger(value) && value >= 1024 && value <= 65535) || ports.cloud === ports.site) throw new Error('Invalid local ports file');
  const url = requireLocalBackend(`http://127.0.0.1:${ports.cloud}`);
  const configPath = path.join(project, '.convex/local/default/config.json');
  const selectionFile = path.join(project, 'selection.env');
  let selected = '';
  try {
    const existing = JSON.parse(await fs.readFile(configPath, 'utf8'));
    requireAnonymousState(existing, ports);
    selected = `CONVEX_DEPLOYMENT=anonymous:${existing.deploymentName}\n`;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Rebuild this allowlisted selector, never load stale private or root dotenv credentials.
  await fs.writeFile(selectionFile, selected, { mode: 0o600 });
  const env = { ...devEnvironment(process.env, home, config), NEXT_PUBLIC_CONVEX_URL: url, NEXT_PUBLIC_CONVEX_SITE_URL: `http://127.0.0.1:${ports.site}`, SITE_URL: `http://localhost:${config.port}` };
  processes = localProcesses(secrets);
  const start = async () => {
    // A fresh anonymous deployment has no selector yet. The CLI rejects an explicit
    // empty env file before reaching anonymous setup; blank inherited selectors
    // and the private HOME/project isolate that first start. Restarts use the file.
    processes.launch(process.execPath, [path.join(root, 'node_modules/convex/bin/main.js'), 'dev', ...(selected ? ['--env-file', selectionFile] : []), '--local', '--local-cloud-port', String(ports.cloud), '--local-site-port', String(ports.site), '--tail-logs', 'disable'], project, env);
    let backend;
    await wait(async () => {
      try {
        backend = JSON.parse(await fs.readFile(configPath, 'utf8'));
        requireAnonymousState(backend, ports);
        return (await localFetch(url + '/instance_name')).text().then(name => name === backend.deploymentName);
      } catch (error) { if (error.message.startsWith('Invalid isolated anonymous')) throw error; return false; }
    }, 'anonymous local backend');
    await fs.chmod(configPath, 0o600);
    secrets.push(backend.adminKey);
    const response = await localFetch(url + '/api/update_environment_variables', {
      method: 'POST', headers: { Authorization: `Convex ${backend.adminKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes: [{ name: 'CLERK_JWT_ISSUER_DOMAIN', value: config.CLERK_JWT_ISSUER_DOMAIN }, { name: 'ADMIN_EMAILS', value: config.LOCAL_DEV_OWNER_EMAILS }] }),
    });
    if (!response.ok) throw new Error('Failed to configure local Clerk issuer/owner allowlist');
    await response.body?.cancel();
    const client = new ConvexHttpClient(url, { logger: false, fetch: localFetch });
    client.setAdminAuth(backend.adminKey);
    // The first push waits for issuer configuration. Wait for this exact app's seed to exist.
    let result;
    await wait(async () => {
      try { result = await seedEmpty(() => client.mutation(makeFunctionReference('maintenance/seed:seedAll'), { scenario: 'demo-resort' })); return true; }
      catch (error) { if (/Could not find (?:public )?function|No functions found/.test(error.message)) return false; throw error; }
    }, 'backend deployment and empty-only seed');
    console.log(result === 'seeded' ? 'Local backend seeded from empty.' : 'Local backend data preserved; seed refused nonempty database.');
    processes.launch(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'dev', '--webpack', '--hostname', 'localhost', '--port', String(config.port)], root, env);
    await wait(async () => { try { const response = await localFetch(`http://localhost:${config.port}/admin/chats`); await response.body?.cancel(); return response.ok; } catch { return false; } }, 'Next development server');
    console.log(`Local development ready at http://localhost:${config.port}; Ctrl-C stops both processes and retains data.`);
    await processes.failure;
  };
  await Promise.race([start(), processes.failure, signal]);
} catch (error) {
  const output = createPrivateOutput(line => process.stderr.write(line), secrets);
  output.write(`Local development failed: ${error.message}\n`); output.end();
  process.exitCode = 1;
} finally {
  abort.abort();
  await processes?.stop();
  if (lock) { await lock.close(); await fs.rm(path.join(work, 'lock')); }
  if (interrupted) process.exitCode = 130;
}
