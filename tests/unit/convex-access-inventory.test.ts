import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectConvexAccess } from '../../scripts/lib/convex-access.mjs';

it('detects aliased raw builders, namespace imports and raw reexports outside auth', () => {
  for (const source of [
    "import { query as open } from './_generated/server'; export const leak = open({args:{},handler:()=>null});",
    "import * as server from './_generated/server'; export const leak = server.mutation({args:{},handler:()=>null});",
    "export { action as open } from './_generated/server';",
    "import { queryGeneric as open } from 'convex/server'; export const leak = open({args:{},handler:()=>null});",
  ]) expect(inspectConvexAccess('convex/example.ts', source).violations.length).toBeGreaterThan(0);
  expect(inspectConvexAccess('convex/auth/model.ts', "import { query as rawQuery } from '../_generated/server';").violations).toEqual([]);
});

it('maps every public registration to the committed inventory and explicit policy', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
      ? e.name === '_generated' ? [] : walk(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.includes('.test.') ? [join(dir, e.name)] : []);
  }
  const inventory = readFileSync('docs/architecture/phase3a-access-inventory.md', 'utf8');
  const rows = walk('convex').flatMap(path => {
    const result = inspectConvexAccess(path, readFileSync(path, 'utf8'));
    expect(result.violations, path).toEqual([]);
    return result.registrations.map((r: { name: string; builder: string; policy: { reason?: string; capability?: string; permission?: string } }) => ({ ...r, key: `${path.slice(7, -3)}.${r.name}` }));
  });
  expect(rows).toHaveLength(295);
  for (const row of rows) {
    expect(inventory, row.key).toContain(`| \`${row.key}\` | \`${row.builder}\` |`);
    if (row.builder.startsWith('public')) expect(row.policy.reason?.trim(), row.key).toBeTruthy();
    if (row.builder.startsWith('staff')) expect(row.policy.capability, row.key).toBeTruthy();
    if (row.builder.startsWith('marketing')) expect(row.policy.permission, row.key).toBeTruthy();
  }
  expect(inventory.match(/^\| `[^`]+\.[^`]+` \|/gm)).toHaveLength(rows.length);
});
