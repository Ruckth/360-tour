#!/usr/bin/env node
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { availablePort, derivePort, portsFilename, readWorktreePorts } from './worktree-ports.mjs';

/** @param {string} file */
async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}

/** @param {string} main @param {string} root */
export async function lockfilesMatch(main, root) {
  const hash = async (/** @type {string} */ dir) => createHash('sha256').update(await fs.readFile(path.join(dir, 'pnpm-lock.yaml'))).digest('hex');
  try { return await hash(main) === await hash(root); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}

/** Copy secrets exclusively: an existing destination (including a symlink) is never touched.
 * @param {string} sourceDir @param {string} root @param {(message: string) => void} [log]
 */
export async function copyEnvFiles(sourceDir, root, log = console.log) {
  for (const name of ['.env.local', '.env.dev.local', '.env.e2e.local']) {
    const destination = path.join(root, name), source = path.join(sourceDir, name);
    if (await exists(destination)) continue;
    let contents;
    try {
      const input = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if (!(await input.stat()).isFile()) throw new Error(`Expected regular env file: ${source}`);
        contents = await input.readFile();
      } finally { await input.close(); }
    }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      log(`Missing ${name}; put it at ${source} and rerun pnpm worktree:setup.`);
      continue;
    }
    const file = await fs.open(destination, 'wx', 0o600).catch(error => {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      return null;
    });
    if (!file) continue;
    try { await file.writeFile(contents); await file.chmod(0o600); }
    finally { await file.close(); }
    log(`Copied ${name} (mode 600).`);
  }
}

/** @param {string} command @param {string[]} args @param {string} cwd */
async function run(command, args, cwd) {
  const started = performance.now();
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: 'inherit' });
      child.once('error', reject);
      child.once('exit', (code, signal) => code === 0 ? resolve(undefined) : reject(new Error(`${command} failed (${signal ?? code})`)));
    });
  } finally { console.log(`${command} ${args.join(' ')}: ${((performance.now() - started) / 1000).toFixed(1)}s`); }
}

export async function setupWorktree() {
  const started = performance.now();
  const git = async (/** @type {string[]} */ args) => (await promisify(execFile)('git', args)).stdout.trim();
  const root = await fs.realpath(await git(['rev-parse', '--show-toplevel']));
  const main = await fs.realpath(path.dirname(await git(['rev-parse', '--path-format=absolute', '--git-common-dir'])));
  if (root === main) { console.log('Main checkout: worktree setup has nothing to do.'); return; }

  const modules = path.join(root, 'node_modules');
  if (!(await exists(modules))) {
    // pnpm reconciles an existing node_modules against the lockfile, so a clone from a
    // different lockfile is still a valid (and much faster) starting point than an empty one.
    let cloned = false;
    if (process.platform === 'darwin' && await exists(path.join(main, 'node_modules'))) {
      try { await run('cp', ['-Rc', path.join(main, 'node_modules'), modules], root); cloned = true; }
      catch {
        console.log('APFS dependency clone failed; using a normal install.');
        await fs.rm(modules, { recursive: true, force: true });
      }
    }
    const network = cloned && await lockfilesMatch(main, root) ? '--offline' : '--prefer-offline';
    try { await run('pnpm', ['install', '--frozen-lockfile', network], root); }
    catch {
      if (network !== '--offline') throw new Error('pnpm install failed');
      console.log('Offline dependency repair failed; retrying online.');
      await run('pnpm', ['install', '--frozen-lockfile'], root);
    }
  } else await run('pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], root);

  await copyEnvFiles(process.env.WORKTREE_ENV_DIR ?? path.join(homedir(), '.config', '360-tour'), root);
  const previous = readWorktreePorts(root);
  const choose = (/** @type {string} */ key, /** @type {number} */ start) => {
    const value = previous[key];
    return availablePort(value >= start && value < start + 900 ? value : derivePort(root, start), start);
  };
  const ports = { LOCAL_DEV_PORT: await choose('LOCAL_DEV_PORT', 3100), BOOKING_UI_PORT: await choose('BOOKING_UI_PORT', 4100) };
  await fs.writeFile(path.join(root, portsFilename), JSON.stringify(ports, null, 2) + '\n', { mode: 0o600 });
  await fs.chmod(path.join(root, portsFilename), 0o600);
  console.log(`Worktree ports: LOCAL_DEV_PORT=${ports.LOCAL_DEV_PORT}, BOOKING_UI_PORT=${ports.BOOKING_UI_PORT}`);
  console.log(`Worktree setup total: ${((performance.now() - started) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  setupWorktree().catch(error => { console.error(`Worktree setup failed: ${error.message}`); process.exitCode = 1; });
}
