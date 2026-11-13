import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Keep every former default test in exactly one project, including pure backend leaves.
 * Existing environment pragmas are authoritative, so DOM integration still uses the real harness.
 * @param {string} root
 */
export function testProjects(root) {
  /** @type {Record<'unit' | 'dom' | 'convex', string[]>} */
  const projects = { unit: [], dom: [], convex: [] };
  for (const dir of ['tests/unit', 'convex']) {
    for (const file of readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.test.ts')) continue;
      const relative = `${dir}/${file.split(path.sep).join('/')}`;
      const source = readFileSync(path.join(root, relative), 'utf8');
      const pragma = /^\s*\/\/\s*@vitest-environment\s+(\S+)/m.exec(source)?.[1];
      if (pragma && !['node', 'happy-dom', 'edge-runtime'].includes(pragma)) throw new Error(`Unclassified test environment: ${relative}`);
      projects[pragma === 'happy-dom' ? 'dom' : pragma === 'edge-runtime' ? 'convex' : 'unit'].push(relative);
    }
  }
  return projects;
}
