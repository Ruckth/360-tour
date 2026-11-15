import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { copyEnvFiles, lockfilesMatch } from '../../scripts/worktree-setup.mjs';
import { availablePort, bookingUIPort, derivePort, localDevPort, portsFilename, readWorktreePorts } from '../../scripts/worktree-ports.mjs';
import { convexCachePath, localConvexCache } from '../../scripts/local-convex-cache.mjs';
import { requireCloudDevOptIn } from '../../scripts/cloud-dev.mjs';

const temporary: string[] = [];
async function temp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-setup-'));
  temporary.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });

describe('worktree setup', () => {
  it('compares lockfile contents, including missing and changed lockfiles', async () => {
    const main = await temp(), worktree = await temp();
    expect(await lockfilesMatch(main, worktree)).toBe(false);
    await fs.writeFile(path.join(main, 'pnpm-lock.yaml'), 'same');
    await fs.writeFile(path.join(worktree, 'pnpm-lock.yaml'), 'same');
    expect(await lockfilesMatch(main, worktree)).toBe(true);
    await fs.writeFile(path.join(worktree, 'pnpm-lock.yaml'), 'different');
    expect(await lockfilesMatch(main, worktree)).toBe(false);
  });

  it('copies absent env files privately, preserves existing files and never logs secrets', async () => {
    const source = await temp(), worktree = await temp(), messages: string[] = [];
    const log = (message: string) => { messages.push(message); };
    await copyEnvFiles(source, worktree, log);
    expect(messages).toHaveLength(3);
    expect(messages[0]).toContain(path.join(source, '.env.local'));
    for (const name of ['.env.local', '.env.dev.local', '.env.e2e.local']) await fs.writeFile(path.join(source, name), 'private-fixture', { mode: 0o644 });
    await copyEnvFiles(source, worktree, log);
    for (const name of ['.env.local', '.env.dev.local', '.env.e2e.local']) {
      expect(await fs.readFile(path.join(worktree, name), 'utf8')).toBe('private-fixture');
      expect((await fs.stat(path.join(worktree, name))).mode & 0o777).toBe(0o600);
      await fs.writeFile(path.join(worktree, name), 'retained');
    }
    await copyEnvFiles(source, worktree, log);
    expect(await fs.readFile(path.join(worktree, '.env.dev.local'), 'utf8')).toBe('retained');
    expect(messages.join('\n')).not.toContain('private-fixture');
    await fs.rm(path.join(worktree, '.env.dev.local'));
    await fs.symlink(path.join(source, '.env.dev.local'), path.join(worktree, '.env.dev.local'));
    await copyEnvFiles(source, worktree, log);
    expect((await fs.lstat(path.join(worktree, '.env.dev.local'))).isSymbolicLink()).toBe(true);
  });

  it('refuses symlinked source secrets', async () => {
    const source = await temp(), worktree = await temp();
    await fs.writeFile(path.join(source, 'secret'), 'private');
    await fs.symlink(path.join(source, 'secret'), path.join(source, '.env.local'));
    await expect(copyEnvFiles(source, worktree)).rejects.toThrow();
    await expect(fs.lstat(path.join(worktree, '.env.local'))).rejects.toThrow();
  });

  it('derives stable ports in separate ranges and steps past occupied ports', async () => {
    const root = '/worktrees/example';
    const preferred = derivePort(root);
    expect(derivePort(root)).toBe(preferred);
    expect(preferred).toBeGreaterThanOrEqual(3100);
    expect(preferred).toBeLessThanOrEqual(3999);
    expect(derivePort(root, 4100)).toBe(preferred + 1000);
    // Acquire a free candidate first so the test does not depend on other local agents.
    const first = await availablePort(preferred, 3100);
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(first, '127.0.0.1', resolve); });
    try { expect(await availablePort(first, 3100)).not.toBe(first); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('resolves the same component port for Vite and Playwright with env overrides first', async () => {
    const root = await temp();
    expect(readWorktreePorts(root)).toEqual({});
    expect(bookingUIPort(root, {})).toBe(4319);
    expect(localDevPort(root, 3000, {})).toBe(3000);
    await fs.writeFile(path.join(root, portsFilename), JSON.stringify({ LOCAL_DEV_PORT: 3210, BOOKING_UI_PORT: 4210 }));
    expect(bookingUIPort(root, {})).toBe(4210);
    expect(localDevPort(root, 3000, {})).toBe(3210);
    expect(localDevPort(root, 3000, { LOCAL_DEV_PORT: '3333' })).toBe(3333);
    expect(bookingUIPort(root, { E2E_COMPONENT_PORT: '4321' })).toBe(4321);
    expect(bookingUIPort(root, { BOOKING_UI_PORT: '4322', E2E_COMPONENT_PORT: '4321' })).toBe(4322);
    expect(() => bookingUIPort(root, { BOOKING_UI_PORT: 'NaN' })).toThrow('Invalid');
    await fs.writeFile(path.join(root, portsFilename), '{"LOCAL_DEV_PORT":1}');
    expect(() => readWorktreePorts(root)).toThrow('Invalid');
  });
});

describe('shared binary cache', () => {
  it('uses the real user cache or XDG cache, independently of the backend private HOME', () => {
    expect(convexCachePath({}, '/users/me')).toBe('/users/me/.cache/360-tour/convex');
    expect(convexCachePath({ XDG_CACHE_HOME: '/shared/cache' }, '/users/me')).toBe('/shared/cache/360-tour/convex');
  });

  it('shares only the cache with mode 700 and accepts repeated setup', async () => {
    const root = await temp(), cache = path.join(root, 'shared');
    for (const name of ['private-a', 'private-b']) {
      const home = path.join(root, name);
      await localConvexCache(home, cache);
      await localConvexCache(home, cache);
      expect(await fs.realpath(path.join(home, '.cache/convex'))).toBe(await fs.realpath(cache));
    }
    expect((await fs.stat(cache)).mode & 0o777).toBe(0o700);
  });

  it('preserves ordinary private caches and refuses unexpected or dangling links', async () => {
    const root = await temp(), cache = path.join(root, 'shared'), home = path.join(root, 'private');
    const link = path.join(home, '.cache/convex');
    await fs.mkdir(link, { recursive: true });
    await fs.writeFile(path.join(link, 'retained'), 'data');
    await localConvexCache(home, cache);
    expect(await fs.readFile(path.join(link, 'retained'), 'utf8')).toBe('data');
    await fs.rm(link, { recursive: true });
    await fs.symlink(root, link);
    await expect(localConvexCache(home, cache)).rejects.toThrow('Unexpected');
    await fs.rm(link);
    await fs.symlink(path.join(root, 'absent'), link);
    await expect(localConvexCache(home, cache)).rejects.toThrow();
  });
});

it('requires exact opt-in before either cloud command can start', () => {
  for (const env of [{}, { ALLOW_CLOUD_DEV: 'true' }, { CONVEX_DEPLOYMENT: 'dev:shared' }]) expect(() => requireCloudDevOptIn(env)).toThrow('pnpm dev runs a local backend');
  expect(() => requireCloudDevOptIn({ ALLOW_CLOUD_DEV: '1' })).not.toThrow();
});
