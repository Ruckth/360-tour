import fs from 'node:fs/promises';
import path from 'node:path';

/** Share only downloadable binaries/dashboard inside this checkout, never deployment/auth state.
 * @param {string} root @param {string} home
 */
export async function localConvexCache(root, home) {
  const cache = path.join(root, 'output', 'convex-cache');
  await fs.mkdir(cache, { recursive: true, mode: 0o700 });
  await fs.chmod(cache, 0o700);
  const parent = path.join(home, '.cache'), link = path.join(parent, 'convex');
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  try { await fs.symlink(cache, link, 'dir'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // Previous persistent-dev versions used an ordinary private binary cache.
    // Keeping it is safe; never move or replace existing files automatically.
    if (!(await fs.lstat(link)).isSymbolicLink()) return;
    if (await fs.realpath(link) !== cache) throw new Error('Unexpected local Convex binary-cache link');
  }
}
