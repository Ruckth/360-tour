#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync, statSync, renameSync, rmSync } from 'node:fs';
import { homedir, constants } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

/** @param {number} pid */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return /** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH'; }
}

/** @param {string} slot */
function owner(slot) {
  try { return JSON.parse(readFileSync(path.join(slot, 'owner.json'), 'utf8')); }
  catch (error) {
    if (!['ENOENT', undefined].includes(/** @type {NodeJS.ErrnoException} */ (error).code)) throw error;
    return null;
  }
}

/** Leave time for a process that died between mkdir and writing its owner file.
 * @param {string} dir
 */
function abandoned(dir) {
  const record = owner(dir);
  if (record) return !alive(record.pid);
  try { return Date.now() - statSync(dir).mtimeMs > 5000; }
  catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
    return false;
  }
}

/** Serialize stale reclamation so two waiters cannot remove a newly acquired slot.
 * @param {string} slot
 */
function reclaim(slot) {
  if (!abandoned(slot)) return;
  const gate = path.join(slot, 'reclaim');
  try { mkdirSync(gate); }
  catch (error) {
    if (!['EEXIST', 'ENOENT'].includes(/** @type {NodeJS.ErrnoException} */ (error).code ?? '')) throw error;
    // Recover a reclaimer that itself crashed. Active reclaimers are never disturbed.
    if (abandoned(gate)) rmSync(gate, { recursive: true, force: true });
    return;
  }
  writeFileSync(path.join(gate, 'owner.json'), JSON.stringify({ pid: process.pid }));
  try {
    if (abandoned(slot)) {
      const tombstone = `${slot}.stale-${randomUUID()}`;
      renameSync(slot, tombstone);
      rmSync(tombstone, { recursive: true, force: true });
      return;
    }
  } finally {
    // Only remove our own gate; the slot may already have been acquired again.
    if (owner(gate)?.pid === process.pid) rmSync(gate, { recursive: true, force: true });
  }
}

/** @param {Record<string, string | undefined>} env */
export function bypassQueue(env) {
  return Boolean(env.CI || env.HEAVY_HELD || env.HEAVY_SLOTS === '0');
}

/** Atomic, machine-wide slot acquisition. Exported for fast temporary-directory tests.
 * @param {{directory: string, slots: number, command: string}} options
 * @returns {null | (() => void)}
 */
export function tryAcquire({ directory, slots, command }) {
  mkdirSync(directory, { recursive: true });
  for (let index = 0; index < slots; index++) {
    const slot = path.join(directory, `slot-${index}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try { mkdirSync(slot); }
      catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
        reclaim(slot);
        continue;
      }
      const token = randomUUID();
      try {
        writeFileSync(path.join(slot, 'owner.json'), JSON.stringify({ pid: process.pid, cwd: process.cwd(), command, startTime: new Date().toISOString(), token }));
      } catch (error) {
        rmSync(slot, { recursive: true, force: true });
        throw error;
      }
      return () => {
        if (owner(slot)?.token === token) rmSync(slot, { recursive: true, force: true });
      };
    }
  }
  return null;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) throw new Error('Usage: node scripts/heavy.mjs <cmd> [args...]');
  const slotSetting = process.env.HEAVY_SLOTS ?? '3';
  const slots = Number(slotSetting);
  if (!bypassQueue(process.env) && (!/^(0|[1-9]\d*)$/.test(slotSetting) || !Number.isSafeInteger(slots))) throw new Error('HEAVY_SLOTS must be a nonnegative integer');
  const directory = process.env.HEAVY_DIR || path.join(homedir(), '.cache/360-tour/heavy');
  const controller = new AbortController();
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  /** @type {(() => void) | null} */
  let release = null;
  /** @type {NodeJS.Signals | undefined} */
  let interrupted;
  /** @param {NodeJS.Signals} signal */
  const forward = signal => {
    interrupted = signal;
    controller.abort();
    if (child?.pid) {
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
      catch (error) { if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ESRCH') throw error; }
    }
  };
  const handlers = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP']);
  const listeners = handlers.map(signal => {
    const listener = () => forward(signal);
    process.on(signal, listener);
    return listener;
  });
  // Synchronous cleanup also covers uncaught errors and explicit process.exit paths.
  const cleanup = () => { if (child?.pid && child.exitCode === null && child.signalCode === null) forward('SIGTERM'); release?.(); };
  process.once('exit', cleanup);
  try {
    if (!bypassQueue(process.env)) {
      const start = Date.now();
      const options = { directory, slots, command: [command, ...args].join(' ') };
      release = tryAcquire(options);
      if (!release) {
        const busy = Array.from({ length: slots }, (_, index) => owner(path.join(directory, `slot-${index}`))?.command ?? 'initializing');
        console.error(`heavy: waiting for slot (${slots} busy: ${busy.join('; ')})`);
        while (!release) {
          await setTimeout(1000, undefined, { signal: controller.signal });
          release = tryAcquire(options);
        }
      }
      console.error(`heavy: acquired slot after ${((Date.now() - start) / 1000).toFixed(1)}s`);
    }
    if (interrupted) return;
    process.exitCode = await new Promise((resolve, reject) => {
      child = spawn(command, args, { stdio: 'inherit', detached: process.platform !== 'win32', env: { ...process.env, HEAVY_HELD: '1' } });
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve(code ?? (signal ? 128 + constants.signals[signal] : 1)));
    });
  } catch (error) {
    if (!interrupted) throw error;
  } finally {
    release?.();
    process.removeListener('exit', cleanup);
    handlers.forEach((signal, index) => process.removeListener(signal, listeners[index]));
    if (interrupted) process.exitCode = 128 + constants.signals[interrupted];
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`heavy: ${error.message}`); process.exitCode = 1; });
}
