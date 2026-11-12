#!/usr/bin/env node
/** Prepare a disposable OLD-schema source copy for a paused cutover. Never contacts a backend. */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
const args = process.argv.slice(2);
const value = (flag, fallback) => args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback;
const destination = value('--dir');
if (!destination) throw new Error('Usage: node scripts/architecture-maintenance.mjs --dir <disposable-old-source-copy> --old-ref 72a657f');
const target = resolve(destination);
const root = resolve(new URL('..', import.meta.url).pathname);
if (target === root || existsSync(join(target, '.git'))) throw new Error('Use a disposable source archive, never a working checkout');
const expected = execFileSync('git', ['show', `${value('--old-ref', '72a657f')}:convex/schema.ts`], { cwd: root, encoding: 'utf8' });
if (readFileSync(join(target, 'convex/schema.ts'), 'utf8') !== expected) throw new Error('The disposable schema does not match the reviewed old revision');
const gate = join(target, 'convex/auth/model.ts');
mkdirSync(dirname(gate), { recursive: true });
writeFileSync(gate, readFileSync(join(root, 'convex/auth/model.ts')));
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
