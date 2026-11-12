#!/usr/bin/env node
/** Offline preparation only. This program never calls a deployment, imports data, or deploys code. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
if (args.includes('--help')) {
  console.log('node scripts/architecture-reset.mjs --old-ref <old-schema-commit> --out <new-empty-output-directory>');
  process.exit(0);
}
const oldRef = value('--old-ref', '72a657f');
const out = resolve(value('--out', 'output/phase1-reset'));
const oldSchema = execFileSync('git', ['show', `${oldRef}:convex/schema.ts`], { encoding: 'utf8' });
const tables = [...oldSchema.matchAll(/^\s*([A-Za-z]+):\s*defineTable\(/gm)].map(m => m[1]);
if (!tables.includes('bills') || !tables.includes('billRefunds') || !tables.includes('chatSessions') || new Set(tables).size !== tables.length) throw new Error('Choose the OLD schema with the reviewed staff/refund dependencies');
mkdirSync(out, { recursive: true });
const helper = readFileSync(new URL('./reset-old-schema.ts.template', import.meta.url), 'utf8');
writeFileSync(resolve(out, 'reset.ts'), helper);
writeFileSync(resolve(out, 'old-schema.ts'), oldSchema);
writeFileSync(resolve(out, 'old-tables.json'), JSON.stringify(tables, null, 2) + '\n');
execFileSync('python3', ['-c', `import json,sys,zipfile
from pathlib import Path
out=Path(sys.argv[1])
for name,tables in [('empty-root.zip',json.loads((out/'old-tables.json').read_text())),('empty-migrations.zip',['migrations'])]:
 with zipfile.ZipFile(out/name,'w') as z:
  for table in tables: z.writestr(table+'/documents.jsonl','')
`, out]);
const manifest = { oldRef: execFileSync('git', ['rev-parse', oldRef], { encoding: 'utf8' }).trim(), oldTableCount: tables.length, schemaSha256: createHash('sha256').update(oldSchema).digest('hex'), artifacts: ['reset.ts', 'old-schema.ts', 'old-tables.json', 'empty-root.zip', 'empty-migrations.zip'] };
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${tables.length}-table OLD-schema reset artifacts in ${out}. No deployment was contacted. Follow docs/architecture/phase1-reset-runbook.md.`);
