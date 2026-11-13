import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
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

// Immutable git templates are reusable; each test still receives a fresh writable archive.
const archiveTemplates = new Map<string, Record<string, string>>();
function archive(ref: string) {
  const revision = execFileSync('git', ['rev-parse', `${ref}^{commit}`], { encoding: 'utf8' }).trim();
  let files = archiveTemplates.get(revision);
  if (!files) {
    const read = schemaSourceReader('.', revision);
    const { sources } = inspectSchema(read);
    const gate = read('convex/auth/model.ts');
    const maintenance = read('convex/lib/maintenance.ts');
    files = { ...sources, ...(gate ? { 'convex/auth/model.ts': gate } : {}), ...(maintenance ? { 'convex/lib/maintenance.ts': maintenance } : {}), 'convex/crons.ts': read('convex/crons.ts')!, 'package.json': read('package.json')! };
    archiveTemplates.set(revision, files);
  }
  const dir = mkdtempSync(join(tmpdir(), 'schema-maintenance-')); scratch.push(dir);
  for (const [path, source] of Object.entries(files)) {
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
  const gate = schemaSourceReader('.', ref)('convex/auth/model.ts');
  if (gate) expect(readFileSync(join(dir, 'convex/auth/model.ts'), 'utf8')).toBe(gate);
  const maintenance = schemaSourceReader('.', ref)('convex/lib/maintenance.ts');
  if (maintenance) expect(readFileSync(join(dir, 'convex/lib/maintenance.ts'), 'utf8')).toBe(maintenance);
}, 30_000);

it('prepares a functioning historical maintenance gate without importing current table or role models', () => {
  const dir = archive('72a657f');
  const result = spawnSync(process.execPath, ['scripts/architecture-maintenance.mjs', '--old-ref', '72a657f', '--dir', dir], { encoding: 'utf8' });
  expect(result.stderr).toBe(''); expect(result.status).toBe(0);
  const read = schemaSourceReader('.', '72a657f');
  mkdirSync(join(dir, 'convex/_generated'), { recursive: true });
  writeFileSync(join(dir, 'convex/_generated/server.js'), read('convex/_generated/server.js')!);
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'), 'dir');
  const gate = join(dir, 'convex/auth/model.cjs');
  writeFileSync(gate, ts.transpileModule(readFileSync(join(dir, 'convex/auth/model.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);
  const runtime = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const gate = require(process.argv[1]);
    (async () => {
      for (const name of ['query', 'mutation', 'action']) {
        const probe = gate[name]({ args: {}, handler: () => 'allowed' });
        process.env.ARCH_RESET_PAUSED = '0'; assert.equal(await probe._handler({}, {}), 'allowed');
        process.env.ARCH_RESET_PAUSED = '1'; await assert.rejects(() => probe._handler({}, {}), error => error.data.code === 'MAINTENANCE');
      }
      const internal = gate.internalMutation({ args: {}, handler: () => 'internal' });
      assert.equal(await internal._handler({}, {}), 'internal');
      const http = gate.httpAction(async () => new Response('allowed'));
      assert.equal((await http._handler({}, new Request('https://example.test'))).status, 503);
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, gate], { encoding: 'utf8' });
  expect(runtime.stderr).toBe(''); expect(runtime.status).toBe(0);
}, 30_000);

it('rejects a modified existing access seam rather than replacing its trust policies', () => {
  const ref = 'f2482a0', dir = archive(ref);
  writeFileSync(join(dir, 'convex/auth/model.ts'), '// unexpected access seam');
  const result = spawnSync(process.execPath, ['scripts/architecture-maintenance.mjs', '--old-ref', ref, '--dir', dir], { encoding: 'utf8' });
  expect(result.status).not.toBe(0); expect(result.stderr).toContain('auth seam does not match');
});

it('runs reset and maintenance preparation through repository paths containing spaces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schema-spaced-')); scratch.push(dir);
  const alias = join(dir, 'repository with spaces'); symlinkSync(process.cwd(), alias, 'dir');
  const reset = spawnSync(process.execPath, ['--preserve-symlinks-main', join(alias, 'scripts/architecture-reset.mjs'), '--old-ref', '72a657f', '--out', join(dir, 'artifacts')], { encoding: 'utf8' });
  expect(reset.stderr).toBe(''); expect(reset.status).toBe(0);
  const maintenance = spawnSync(process.execPath, ['--preserve-symlinks-main', join(alias, 'scripts/architecture-maintenance.mjs'), '--old-ref', '72a657f', '--dir', archive('72a657f')], { encoding: 'utf8' });
  expect(maintenance.stderr).toBe(''); expect(maintenance.status).toBe(0);
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


it.each(['changed', 'missing'])('rejects a %s extracted maintenance predicate before archive writes', mode => {
  const ref = 'HEAD', dir = archive(ref);
  const path = join(dir, 'convex/lib/maintenance.ts');
  if (mode === 'changed') writeFileSync(path, readFileSync(path, 'utf8') + '\n// changed reviewed predicate source\n');
  else rmSync(path);
  const result = spawnSync(process.execPath, ['scripts/architecture-maintenance.mjs', '--old-ref', ref, '--dir', dir], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('maintenance predicate does not match');
  expect(existsSync(join(dir, 'convex/maintenance/reset.ts'))).toBe(false);
}, 30_000);
