import fs from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

/** @param {Record<string, string | undefined>} [env] @param {string} [userHome] */
export function convexCachePath(env = process.env, userHome = homedir()) {
  return path.join(env.XDG_CACHE_HOME || path.join(userHome, '.cache'), '360-tour', 'convex');
}

/** Share only downloadable binaries/dashboard, never deployment/auth state.
 * home remains the backend's private HOME, not the user's actual home.
 * @param {string} home @param {string} [cache]
 */
export async function localConvexCache(home, cache = convexCachePath()) {
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  if (!(await fs.lstat(cache)).isDirectory()) throw new Error('Shared Convex cache must be a real directory');
  await fs.chmod(cache, 0o700);
  cache = await fs.realpath(cache);
  const parent = path.join(home, '.cache'), link = path.join(parent, 'convex');
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  try { await fs.symlink(cache, link, 'dir'); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    // Previous persistent-dev versions used an ordinary private binary cache.
    // Keeping it is safe; never move or replace existing files automatically.
    if (!(await fs.lstat(link)).isSymbolicLink()) return;
    if (await fs.realpath(link) !== cache) throw new Error('Unexpected local Convex binary-cache link');
  }
}
