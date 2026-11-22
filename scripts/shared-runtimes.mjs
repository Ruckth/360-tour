// Runtimes whose importers must share one installed implementation, checked with Node's package
// lookup from each importer's real directory (independent of Bun's physical layout). Separate
// copies make the client bundle carry the same runtime twice on every page that loads both importers.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

/** Each importer is a chain of packages resolved in turn from the checkout root. */
export const SHARED_RUNTIMES = /** @type {const} */ ([
  // Start's Clerk SDK and the @clerk/react it resolves.
  { name: 'Clerk', shared: '@clerk/shared', importers: [['@clerk/tanstack-react-start'], ['@clerk/tanstack-react-start', '@clerk/react']] },
  {
    name: 'Floating UI',
    shared: '@floating-ui/react-dom',
    importers: [['@radix-ui/react-popper'], ['@radix-ui/react-tooltip', '@radix-ui/react-popper']],
  },
]);

/** @param {string} fromDir @param {string} name @returns {string | undefined} real package directory */
export function resolvePackageDir(fromDir, name) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** @param {string} dir */
const manifest = dir => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));

/**
 * @param {string} root checkout root
 * @param {(typeof SHARED_RUNTIMES)[number]} rule
 * @returns {{ importer: string, required: string, sharedDir: string, version: string }[] | undefined}
 *   undefined when an importer or its runtime is not installed
 */
export function sharedRuntime(root, rule) {
  const rows = [];
  for (const chain of rule.importers) {
    /** @type {string | undefined} */
    let importerDir = root;
    for (const name of chain) importerDir = importerDir && resolvePackageDir(importerDir, name);
    const sharedDir = importerDir && resolvePackageDir(importerDir, rule.shared);
    if (!importerDir || !sharedDir) return undefined;
    rows.push({ importer: chain.join(' > '), required: manifest(importerDir).dependencies[rule.shared], sharedDir, version: manifest(sharedDir).version });
  }
  return rows;
}

/** The lockfile expects one shared runtime unless it nests the runtime under an importer chain. */
export function lockExpectsShared(/** @type {string} */ lockText, /** @type {(typeof SHARED_RUNTIMES)[number]} */ rule) {
  return !rule.importers.some(chain => lockText.includes(`"${[...chain, rule.shared].join('/')}"`));
}

/**
 * Why this checkout's installed dependencies contradict its lockfile (one line per runtime), or an
 * empty list. An inherited install (an APFS clone of another checkout or an older install here)
 * can keep nested copies a frozen install does not prune. Runtimes the lockfile itself nests, and
 * runtimes that are not installed, are not judged.
 * @param {string} root
 */
export function staleSharedRuntimes(root) {
  const lock = path.join(root, 'bun.lock');
  if (!existsSync(lock)) return [];
  const lockText = readFileSync(lock, 'utf8');
  return SHARED_RUNTIMES.flatMap(rule => {
    if (!lockExpectsShared(lockText, rule)) return [];
    const rows = sharedRuntime(root, rule);
    if (!rows || new Set(rows.map(row => row.sharedDir)).size === 1) return [];
    return [`${rule.name}: ${rows.map(row => `${row.importer} resolves ${rule.shared} ${row.version}`).join(' and ')} from separate copies`];
  });
}
