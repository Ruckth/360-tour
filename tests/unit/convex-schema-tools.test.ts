import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import schema from '../../convex/schema';
import { inspectSchema, schemaSourceReader } from '../../scripts/lib/convex-schema.mjs';

const scratch: string[] = [];
afterEach(() => { for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const inspect = (files: Record<string, string>) => inspectSchema(path => files[path]);
const server = "import { defineSchema as assemble, defineTable as table } from 'convex/server';";
const table = "table({ label: v.string() }).index('by_label', ['label'])";

it('follows reachable bindings and spreads, excluding unused and component definitions', () => {
  const result = inspect({
    'convex/schema.ts': `${server} import primary from './primary'; import { selected as alias } from './part'; const unused = { decoy: ${table} }; export default assemble({ ...primary, ...alias, direct: ${table} });`,
    'convex/primary.ts': `${server} const tables = { first: ${table} }; export default tables;`,
    'convex/part.ts': `${server} export const selected = { 'second': ${table} }; export const unused = { decoy: ${table} };`,
    'convex/component/schema.ts': `${server} export default assemble({ componentOnly: ${table} });`,
  });
  expect(result.tables).toEqual([
    { name: 'first', source: 'convex/primary.ts' },
    { name: 'second', source: 'convex/part.ts' },
    { name: 'direct', source: 'convex/schema.ts' },
  ]);
  expect(Object.keys(result.sources)).not.toContain('convex/component/schema.ts');
});

it('rejects overwritten tables rather than silently deduplicating spread assembly', () => {
  expect(() => inspect({
    'convex/schema.ts': `${server} import { tables } from './part'; export default assemble({ duplicate: ${table}, ...tables });`,
    'convex/part.ts': `${server} export const tables = { duplicate: ${table} };`,
  })).toThrow('Duplicate schema table: duplicate');
});

it.each([
  ['dynamic assembly', `${server} export default assemble(makeTables());`, 'Unsupported schema assembly'],
  ['computed table key', `${server} export default assemble({ [key]: ${table} });`, 'Unsupported table key'],
  ['fake builder', `const defineSchema = x => x; export default defineSchema({});`, 'Expected default defineSchema'],
  ['missing import', `${server} import { tables } from './missing'; export default assemble({ ...tables });`, 'Unresolved schema import'],
  ['package assembly', `${server} import { tables } from 'component-package'; export default assemble({ ...tables });`, 'repository imports'],
])('fails closed on %s', (_label, source, error) => {
  expect(() => inspect({ 'convex/schema.ts': source })).toThrow(error);
});

it('rejects circular schema spreads with a useful error', () => {
  expect(() => inspect({
    'convex/schema.ts': `${server} import { tables } from './part'; export default assemble({ ...tables });`,
    'convex/part.ts': 'export const tables = { ...tables };',
  })).toThrow('Circular schema assembly');
});

it('discovers historical 91/74-table monoliths and matches the assembled runtime schema', () => {
  const old = inspectSchema(schemaSourceReader('.', '72a657f'));
  expect(old.tables).toHaveLength(91);
  expect(old.tables.map(t => t.name)).toEqual(expect.arrayContaining(['bills', 'billRefunds', 'chatSessions']));
  const base = inspectSchema(schemaSourceReader('.', 'f2482a0237e28a82c71b0557ea9422f61233845a'));
  const current = inspectSchema(schemaSourceReader('.'));
  expect(base.tables).toHaveLength(74);
  expect(current.tables.map(t => t.name).sort()).toEqual(base.tables.map(t => t.name).sort());
  expect(current.tables.map(t => t.name).sort()).toEqual(Object.keys(schema.tables).sort());
}, 30_000);

it('creates complete reset/rollback ZIPs and hashes the composed schema source graph offline', () => {
  const out = mkdtempSync(join(tmpdir(), 'schema-reset-')); scratch.push(out);
  const result = spawnSync(process.execPath, ['scripts/architecture-reset.mjs', '--old-ref', '72a657f', '--out', out], { encoding: 'utf8' });
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  for (const [name, count] of [['old', 91], ['new', 74]] as const) {
    const tables = JSON.parse(readFileSync(join(out, `${name}-tables.json`), 'utf8')) as string[];
    expect(tables).toHaveLength(count);
    const zip = name === 'old' ? 'empty-root.zip' : 'empty-new-root.zip';
    const entries = execFileSync('python3', ['-c', 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert all(z.read(n)==b"" for n in z.namelist()); print(json.dumps(z.namelist()))', join(out, zip)], { encoding: 'utf8' });
    expect(JSON.parse(entries).sort()).toEqual(tables.map(t => `${t}/documents.jsonl`).sort());
    const snapshot = inspectSchema(schemaSourceReader(join(out, `${name}-schema-sources`)));
    expect(snapshot.tables.map(t => t.name).sort()).toEqual(tables.sort());
  }
  const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({ oldTableCount: 91, newTableCount: 74 });
  const current = inspectSchema(schemaSourceReader('.'));
  expect(Object.keys(manifest.schemaSources.new).sort()).toEqual(Object.keys(current.sources).sort());
  for (const [path, source] of Object.entries(current.sources)) expect(manifest.schemaSources.new[path]).toBe(createHash('sha256').update(source).digest('hex'));
}, 30_000);

function archive(ref: string) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-maintenance-')); scratch.push(dir);
  const read = schemaSourceReader('.', ref);
  const { sources } = inspectSchema(read);
  for (const [path, source] of Object.entries({ ...sources, 'convex/crons.ts': read('convex/crons.ts')!, 'package.json': read('package.json')! })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), source);
  }
  return dir;
}

it.each(['72a657f', 'f2482a0237e28a82c71b0557ea9422f61233845a', 'HEAD'])('preserves reviewed historical schema sources during maintenance preparation at %s', ref => {
  const dir = archive(ref);
  const result = spawnSync(process.execPath, ['scripts/architecture-maintenance.mjs', '--old-ref', ref, '--dir', dir], { encoding: 'utf8' });
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  const expected = inspectSchema(schemaSourceReader('.', ref));
  expect(inspectSchema(schemaSourceReader(dir)).sources).toEqual(expected.sources);
}, 30_000);

it('rejects changes to imported validators before maintenance writes', () => {
  const ref = 'f2482a0237e28a82c71b0557ea9422f61233845a', dir = archive(ref);
  const path = join(dir, 'convex/lib/financeValidators.ts');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n// changed validator source\n');
  const result = spawnSync(process.execPath, ['scripts/architecture-maintenance.mjs', '--old-ref', ref, '--dir', dir], { encoding: 'utf8' });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('convex/lib/financeValidators.ts');
}, 30_000);

it('rejects a changed table assembly source at the reviewed head before maintenance writes', () => {
  const ref = 'HEAD', dir = archive(ref);
  const reviewed = inspectSchema(schemaSourceReader('.', ref));
  const source = reviewed.tables[0].source;
  writeFileSync(join(dir, source), reviewed.sources[source] + '\n// changed table source\n');
  const result = spawnSync(process.execPath, ['scripts/architecture-maintenance.mjs', '--old-ref', ref, '--dir', dir], { encoding: 'utf8' });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain(source);
}, 30_000);
