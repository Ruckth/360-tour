#!/usr/bin/env node
/** Offline preparation only. This program never calls a deployment, imports data, or deploys code. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inspectSchema, schemaSourceReader } from './lib/convex-schema.mjs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
if (args.includes('--help')) {
  console.log('node scripts/architecture-reset.mjs --old-ref <old-schema-commit> --out <new-empty-output-directory>');
  process.exit(0);
}
const oldRef = value('--old-ref', '72a657f');
const out = resolve(value('--out', 'output/phase1-reset'));
const old = inspectSchema(schemaSourceReader(root, oldRef));
const oldSchema = old.sources['convex/schema.ts'];
const tables = old.tables.map(table => table.name);
if (!tables.includes('bills') || !tables.includes('billRefunds') || !tables.includes('chatSessions') || new Set(tables).size !== tables.length) throw new Error('Choose the OLD schema with the reviewed staff/refund dependencies');
const current = inspectSchema(schemaSourceReader(root));
const newSchema = current.sources['convex/schema.ts'];
const newTables = current.tables.map(table => table.name);
if (newTables.length !== 74 || !newTables.includes('orders') || newTables.includes('bills') || new Set(newTables).size !== newTables.length) throw new Error('The current schema must contain the reviewed final table names');
mkdirSync(out, { recursive: true });
const schemaSources = {};
for (const [label, schema] of [['old', old], ['new', current]]) {
  schemaSources[label] = {};
  for (const [path, source] of Object.entries(schema.sources)) {
    const destination = resolve(out, `${label}-schema-sources`, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, source);
    schemaSources[label][path] = createHash('sha256').update(source).digest('hex');
  }
}
const helper = readFileSync(new URL('./reset-old-schema.ts.template', import.meta.url), 'utf8');
writeFileSync(resolve(out, 'reset.ts'), helper);
writeFileSync(resolve(out, 'reset-new.ts'), helper.replace('on the OLD schema revision', 'on the NEW schema revision for rollback'));
writeFileSync(resolve(out, 'new-schema.ts'), newSchema);
writeFileSync(resolve(out, 'new-tables.json'), JSON.stringify(newTables, null, 2) + '\n');
writeFileSync(resolve(out, 'old-schema.ts'), oldSchema);
writeFileSync(resolve(out, 'old-tables.json'), JSON.stringify(tables, null, 2) + '\n');
execFileSync('python3', ['-c', `import json,sys,zipfile
from pathlib import Path
out=Path(sys.argv[1])
for name,tables in [('empty-root.zip',json.loads((out/'old-tables.json').read_text())),('empty-migrations.zip',['migrations']),('empty-new-root.zip',json.loads((out/'new-tables.json').read_text()))]:
 with zipfile.ZipFile(out/name,'w') as z:
  for table in tables: z.writestr(table+'/documents.jsonl','')
`, out]);
const manifest = { schemaSources, oldRef: execFileSync('git', ['rev-parse', oldRef], { cwd: root, encoding: 'utf8' }).trim(), oldTableCount: tables.length, newTableCount: newTables.length, newSchemaSha256: createHash('sha256').update(newSchema).digest('hex'), schemaSha256: createHash('sha256').update(oldSchema).digest('hex'), artifacts: ['reset.ts', 'old-schema.ts', 'old-tables.json', 'empty-root.zip', 'empty-migrations.zip', 'empty-new-root.zip', 'reset-new.ts', 'new-schema.ts', 'new-tables.json', 'old-schema-sources/', 'new-schema-sources/'] };
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${tables.length}-table OLD-schema reset artifacts in ${out}. No deployment was contacted. Follow docs/architecture/phase1-reset-runbook.md.`);
