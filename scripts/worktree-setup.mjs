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
import { staleSharedRuntimes } from './shared-runtimes.mjs';

/** @param {string} file */
async function exists(file) {
  try { await fs.lstat(file); return true; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}

/** @param {string} main @param {string} root */
export async function lockfilesMatch(main, root) {
  const hash = async (/** @type {string} */ dir) => createHash('sha256').update(await fs.readFile(path.join(dir, 'bun.lock'))).digest('hex');
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
      log(`Missing ${name}; put it at ${source} and rerun bun run worktree:setup.`);
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

/**
 * A frozen install does not prune packages an inherited install (APFS clone or an older install in
 * this checkout) left behind. If the lockfile expects a runtime to be shared (Clerk's
 * @clerk/shared, Floating UI's react-dom) but the installed importers resolve separate copies,
 * rebuild only this checkout's dependencies with a clean frozen install. A consistent install
 * returns immediately.
 * @param {string} root
 * @param {(command: string, args: string[], cwd: string) => Promise<void>} [runCommand]
 */
export async function recoverStaleInstall(root, runCommand = run) {
  const stale = staleSharedRuntimes(root);
  if (!stale.length) return false;
  console.log(`Inherited dependencies disagree with bun.lock (${stale.join('; ')}); reinstalling this checkout's node_modules.`);
  await fs.rm(path.join(root, 'node_modules'), { recursive: true, force: true });
  await runCommand('bun', ['install', '--frozen-lockfile', '--prefer-offline'], root);
  const still = staleSharedRuntimes(root);
  if (still.length) throw new Error(`Clean frozen install still resolves separate runtimes: ${still.join('; ')}`);
  return true;
}

export async function setupWorktree() {
  const started = performance.now();
  const git = async (/** @type {string[]} */ args) => (await promisify(execFile)('git', args)).stdout.trim();
  const root = await fs.realpath(await git(['rev-parse', '--show-toplevel']));
  const main = await fs.realpath(path.dirname(await git(['rev-parse', '--path-format=absolute', '--git-common-dir'])));
  if (root === main) { console.log('Main checkout: worktree setup has nothing to do.'); return; }

  const modules = path.join(root, 'node_modules');
  let cloned = false;
  if (process.platform === 'darwin' && !(await exists(modules)) &&
      await exists(path.join(main, 'node_modules')) && await lockfilesMatch(main, root)) {
    try { await run('cp', ['-Rc', path.join(main, 'node_modules'), modules], root); cloned = true; }
    catch {
      console.log('APFS dependency clone failed; using a normal install.');
      await fs.rm(modules, { recursive: true, force: true });
    }
  }
  if (cloned) {
    try { await run('bun', ['install', '--frozen-lockfile', '--offline'], root); }
    catch {
      console.log('Offline dependency repair failed; retrying online.');
      await fs.rm(modules, { recursive: true, force: true });
      await run('bun', ['install', '--frozen-lockfile'], root);
    }
  } else {
    await run('bun', ['install', '--frozen-lockfile', '--prefer-offline'], root);
  }
  await recoverStaleInstall(root);

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
