#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Both legacy commands can write to the shared cloud deployment selected by .env.local.
 * @param {Record<string, string | undefined>} env
 */
export function requireCloudDevOptIn(env) {
  if (env.ALLOW_CLOUD_DEV !== '1') throw new Error('Refusing shared cloud dev access. bun run dev runs a local backend. Set ALLOW_CLOUD_DEV=1 only to intentionally use the cloud dev deployment.');
}

function main() {
  requireCloudDevOptIn(process.env);
  const [command, ...args] = process.argv.slice(2);
  if (!['dev', 'seed'].includes(command)) throw new Error('Expected dev or seed');
  const child = spawn(process.execPath, [path.resolve('node_modules/convex/bin/main.js'), ...(command === 'dev' ? ['dev'] : ['run', 'maintenance/seed:seedAll']), ...args], { stdio: 'inherit' });
  /** @type {NodeJS.Signals[]} */
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) process.on(signal, () => child.kill(signal));
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
