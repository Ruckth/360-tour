#!/usr/bin/env node
// Compare the actual Convex exports, offline. Git sources are archived into ignored
// output, never checked out, deployed, or loaded from another working checkout.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import ts from 'typescript';
import { inspectSchema, schemaSourceReader } from './lib/convex-schema.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const base = value('--base');
if (!base || base.startsWith('--')) throw new Error('Supply --base <reviewed commit> for schema equivalence');
const out = resolve(root, value('--out', 'output/schema-equivalence'));
if (!out.startsWith(resolve(root, 'output') + '/')) throw new Error('Use ignored output/ for evidence');
const ref = execFileSync('git', ['rev-parse', base], { cwd: root, encoding: 'utf8' }).trim();
const before = inspectSchema(schemaSourceReader(root, ref));
const after = inspectSchema(schemaSourceReader(root));
const archive = resolve(out, `base-${ref}`);
for (const [path, source] of Object.entries(before.sources)) {
  const destination = resolve(archive, path);
  mkdirSync(resolve(destination, '..'), { recursive: true });
  writeFileSync(destination, source);
}
// Node 22 loader for this process only. TypeScript erases type-only imports;
// extensionless relative imports use the same TS/JS candidates as inspection.
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL);
      for (const suffix of ['.ts', '.js', '/index.ts']) if (existsSync(fileURLToPath(url) + suffix)) return next(url.href + suffix, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts') && !url.includes('/node_modules/')) {
      const result = next(url, { ...context, format: 'module' });
      return { format: 'module', source: ts.transpileModule(String(result.source), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext, verbatimModuleSyntax: false } }).outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});
let oldExport, newExport;
try {
  oldExport = JSON.parse((await import(pathToFileURL(resolve(archive, 'convex/schema.ts')).href)).default.export());
  newExport = JSON.parse((await import(pathToFileURL(resolve(root, 'convex/schema.ts')).href)).default.export());
} finally { hooks.deregister(); }
// Object-key and top-level table order alone may vary. Preserve every other
// array's order, including compound index fields, unions and search definitions.
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
function normalize(schema) { return ordered({ ...schema, tables: [...schema.tables].sort((a, b) => a.tableName.localeCompare(b.tableName)) }); }
const normalizedBefore = normalize(oldExport), normalizedAfter = normalize(newExport);
for (const [label, schema] of [['base', normalizedBefore], ['current', normalizedAfter]]) writeFileSync(resolve(out, `${label}-schema.json`), JSON.stringify(schema, null, 2) + '\n');
const equal = isDeepStrictEqual(normalizedBefore, normalizedAfter);
const hash = schema => createHash('sha256').update(JSON.stringify(schema)).digest('hex');
const evidence = { base: ref, equal, baseTables: oldExport.tables.length, currentTables: newExport.tables.length, staticTables: after.tables.length, baseSha256: hash(normalizedBefore), currentSha256: hash(normalizedAfter), normalization: 'Object keys and top-level table order only; all other array order preserved', tables: after.tables };
writeFileSync(resolve(out, 'schema-equivalence.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify({ ...evidence, tables: undefined }, null, 2));
if (!equal || !isDeepStrictEqual(after.tables.map(t => t.name).sort(), newExport.tables.map(t => t.tableName).sort())) process.exitCode = 1;
