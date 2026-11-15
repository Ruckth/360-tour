#!/usr/bin/env node
/** Prepare a disposable OLD-schema source copy for a paused cutover. Never contacts a backend. */
import ts from 'typescript';
import { inspectSchema, schemaSourceReader } from './lib/convex-schema.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const destination = value('--dir');
if (!destination) throw new Error('Usage: node scripts/architecture-maintenance.mjs --dir <disposable-old-source-copy> --old-ref 72a657f');
const target = resolve(destination);
const root = fileURLToPath(new URL('..', import.meta.url));
if (target === root || existsSync(join(target, '.git'))) throw new Error('Use a disposable source archive, never a working checkout');
const reviewed = schemaSourceReader(root, value('--old-ref', '72a657f'));
// Reject a changed trust boundary before paying for the full schema graph inspection.
// All schema/validator checks still complete before any file is written.
const gate = join(target, 'convex/auth/model.ts');
const existingGate = reviewed('convex/auth/model.ts');
if (existingGate !== undefined && (!existsSync(gate) || readFileSync(gate, 'utf8') !== existingGate)) throw new Error('The disposable auth seam does not match the reviewed revision');
if (existingGate === undefined && existsSync(gate)) throw new Error('Unexpected auth seam in the disposable source copy');
const expected = inspectSchema(reviewed);
const actual = inspectSchema(schemaSourceReader(target));
for (const path of new Set([...Object.keys(expected.sources), ...Object.keys(actual.sources)])) {
  if (actual.sources[path] !== expected.sources[path]) throw new Error(`The disposable schema does not match the reviewed old revision: ${path}`);
}
let gateSource = existingGate;
if (existingGate !== undefined) {
  {
    // Messaging closure extracts this single backend predicate to break the
    // auth -> messaging model -> auth cycle. Verify its real binding and the
    // complete reviewed source before writing anything to the disposable copy.
    const tree = ts.createSourceFile('model.ts', existingGate, ts.ScriptTarget.Latest, true);
    const boundFlag = tree.statements.some(node => ts.isImportDeclaration(node)
      && node.moduleSpecifier.text === '../lib/maintenance'
      && !node.importClause?.isTypeOnly
      && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      && node.importClause.namedBindings.elements.some(entry => !entry.isTypeOnly
        && entry.name.text === 'maintenancePaused' && (entry.propertyName?.text ?? entry.name.text) === 'maintenancePaused'));
    if (!boundFlag && !existingGate.includes('ARCH_RESET_PAUSED')) throw new Error('Review maintenance support in the selected auth seam');
    const flagPath = 'convex/lib/maintenance.ts';
    const flagSource = boundFlag ? reviewed(flagPath) : undefined;
    const print = source => ts.createPrinter({ removeComments: true }).printFile(ts.createSourceFile('flag.ts', source, ts.ScriptTarget.Latest, true));
    if (boundFlag && (flagSource === undefined
      || print(flagSource) !== print("export const maintenancePaused = () => process.env.ARCH_RESET_PAUSED === '1';"))) {
      throw new Error('Review maintenance support in the selected auth seam');
    }
    if (boundFlag && (!existsSync(join(target, flagPath)) || readFileSync(join(target, flagPath), 'utf8') !== flagSource)) {
      throw new Error(`The disposable maintenance predicate does not match the reviewed revision: ${flagPath}`);
    }
  }
} else {
  // This reviewed seam predates table-specific guest and role builders. Current
  // auth code cannot be transplanted into the old 91-table application.
  gateSource = schemaSourceReader(root, value('--gate-ref', 'f2bd89a'))('convex/auth/model.ts');
  if (!gateSource?.includes('ARCH_RESET_PAUSED') || !['query', 'mutation', 'action', 'httpAction'].every(name => new RegExp(`export const ${name}\\b`).test(gateSource))) {
    throw new Error('Choose a reviewed maintenance seam with the historical raw builder interface');
  }
}
mkdirSync(dirname(gate), { recursive: true });
writeFileSync(gate, gateSource);
const reset = join(target, 'convex/maintenance/reset.ts');
mkdirSync(dirname(reset), { recursive: true });
writeFileSync(reset, readFileSync(join(root, 'scripts/reset-old-schema.ts.template')));
let changed = 0;
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '_generated' || entry.name === 'node_modules') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts') || path === gate) continue;
    const source = readFileSync(path, 'utf8');
    const updated = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]*_generated\/server)['"]/g, (match, names, module) => {
      if (!/\b(query|mutation|action|httpAction)\b/.test(names)) return match;
      let to = relative(dirname(path), gate).split(sep).join('/').replace(/\.ts$/, '');
      if (!to.startsWith('.')) to = './' + to;
      return match.replace(module, to);
    });
    if (updated !== source) { writeFileSync(path, updated); changed++; }
  }
}
visit(join(target, 'convex'));
const cronPath = join(target, 'convex/crons.ts');
const crons = readFileSync(cronPath, 'utf8');
const registry = crons.indexOf('const crons = cronJobs();');
if (registry < 0) throw new Error('Review the old cron registry before preparing maintenance');
writeFileSync(cronPath, crons.slice(0, registry) + 'const crons = cronJobs();\nexport default crons;\n');
const packagePath = join(target, 'package.json');
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
const current = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
pkg.dependencies['convex-helpers'] = current.dependencies['convex-helpers'];
writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`Prepared ${changed} guarded public-registration modules and paused crons in ${target}. Old schema preserved; no backend contacted. Install this copy's dependencies before deploying it.`);
