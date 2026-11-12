#!/usr/bin/env node
// One explicit Phase 3b codemod. Run once at b2eaae5; --check is safe after the move.
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const endpoints = ['properties', 'publicProperties', 'adminProperties', 'adminReviews'];
const moves = new Map([
  ...endpoints.map(name => [`convex/${name}.ts`, `convex/catalog/${name}.ts`]),
  ['convex/lib/reviewStats.ts', 'convex/catalog/model.ts'],
  ['convex/lib/imageUrls.ts', 'convex/shared/imageUrls.ts'],
]);
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => writeFileSync(path.join(root, file), source);
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const check = process.argv.includes('--check');
const modules = endpoints.join('|');
const oldRefs = new RegExp(`\\b(?:api|internal)\\s*(?:\\.\\s*(?:${modules})\\b|\\[\\s*['"](?:${modules})['"]\\s*\\])|['"\\x60](?:${modules}):[A-Za-z_]`, 'g');

if (!check) {
  if (!existsSync(path.join(root, 'convex/properties.ts'))) throw new Error('Already moved; use --check');
  mkdirSync(path.join(root, 'convex/shared'), { recursive: true });
  const propertiesSource = read('convex/properties.ts');
  const projectionStart = propertiesSource.indexOf('export type PublicProperty');
  const projectionEnd = propertiesSource.indexOf('export const list');
  const projection = propertiesSource.slice(projectionStart, projectionEnd).replaceAll('toPublic', 'toPublicProperty').replace('function toPublicProperty', 'export function toPublicProperty');
  const requiredStart = propertiesSource.indexOf('export function required');
  const textListStart = propertiesSource.indexOf('function textList');
  const imageStart = propertiesSource.indexOf('export function imageUrl');
  const contentStart = propertiesSource.indexOf('/** True when guest-facing');
  write('convex/shared/validation.ts', "import { allowedImageUrl, IMAGE_HOSTS } from './imageUrls';\n\n" + propertiesSource.slice(requiredStart, textListStart) + propertiesSource.slice(imageStart, contentStart));
  let properties = propertiesSource.slice(0, projectionStart) + propertiesSource.slice(projectionEnd, requiredStart) + propertiesSource.slice(textListStart, imageStart) + propertiesSource.slice(contentStart);
  properties = properties.replace("import { allowedImageUrl, IMAGE_HOSTS } from './lib/imageUrls';", "import { amount, imageUrl, required } from './shared/validation';\nimport { toPublicProperty, type PublicProperty } from './catalog/model';").replaceAll('toPublic(', 'toPublicProperty(');
  write('convex/properties.ts', properties);
  const model = read('convex/lib/reviewStats.ts').replace("import type { Id }", "import type { Doc, Id }");
  write('convex/lib/reviewStats.ts', model + '\n' + projection);

  const changed = [];
  for (const file of tracked()) {
    if (!/\.(?:ts|tsx|mjs|js|md|html|json|jsonc)$/.test(file) || file.startsWith('convex/_generated/') || file === 'scripts/move-catalog-domain.mjs') continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    const before = read(file);
    let source = before;
    // Dot and bracket references, including source-text assertions, crons and scheduler calls.
    source = source.replace(new RegExp(`\\b(api|internal)\\.(?:${modules})\\b`, 'g'), match => match.replace('.', '.catalog.'));
    source = source.replace(new RegExp(`\\b(api|internal)\\[(['"])((?:${modules}))\\2\\]`, 'g'), '$1.catalog[$2$3$2]');
    // Serialized getFunctionName/CLI RPC identifiers, e.g. properties:list.
    source = source.replace(new RegExp(`([ '"\\x60])(${modules}):([A-Za-z_])`, 'g'), '$1catalog/$2:$3');
    // Current inventory uses slash-separated module names; retain all policies verbatim.
    if (file === 'docs/architecture/phase3a-access-inventory.md') source = source.replace(new RegExp(`(\\x60)(${modules})\\.`, 'g'), '$1catalog/$2.');
    // Resolve real relative ESM imports and test module-map keys, retaining .js extensions.
    if (/\.(?:ts|tsx|mjs|js)$/.test(file)) {
      const destination = moves.get(file) ?? file;
      source = source.replace(/(['"])(\.\.?\/[^'"\n]+)\1/g, (match, quote, specifier) => {
        const extension = /\.js$/.test(specifier) ? '.js' : /\.ts$/.test(specifier) ? '.ts' : '';
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.replace(/\.(?:js|ts)$/, ''))) + '.ts';
        let target = moves.get(resolved) ?? resolved;
        if (resolved === 'convex/properties.ts' && file !== 'convex/properties.ts') target = 'convex/shared/validation.ts';
        if (!moves.has(resolved) && destination === file && target === resolved) return match;
        let relative = path.posix.relative(path.posix.dirname(destination), target.slice(0, -3));
        if (!relative.startsWith('.')) relative = './' + relative;
        return quote + relative + extension + quote;
      });
      source = source.replaceAll('convex/lib/imageUrls', 'convex/shared/imageUrls');
    }
    if (source !== before) { write(file, source); changed.push(file); }
  }
  for (const [from, to] of moves) renameSync(path.join(root, from), path.join(root, to));
  // Imports added above are already relative to the old root module; the resolver moved them.
  process.stdout.write(`Updated ${changed.length} caller/import/inventory files; moved ${moves.size} modules.\n`);
}
const failures = [];
for (const file of tracked()) {
  if (!existsSync(path.join(root, file)) || !/\.(?:ts|tsx|mjs|js|md|html|json|jsonc)$/.test(file) || file === 'scripts/move-catalog-domain.mjs' || file.startsWith('convex/_generated/')) continue;
  if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
  for (const match of read(file).matchAll(oldRefs)) failures.push(`${file}: ${match[0]}`);
}
for (const name of endpoints) if (existsSync(path.join(root, `convex/${name}.ts`))) failures.push(`old endpoint convex/${name}.ts`);
if (failures.length) throw new Error(`Old runtime references remain:\n${failures.join('\n')}`);
process.stdout.write('No old runtime RPC references or endpoint files remain.\n');

// Compare the actual registered implementations against the required dependent base.
// A path move may change imports and this projection helper's name, never an RPC contract.
const base = 'b2eaae524f77efffd354120cd3791d189b2ff56f';
const historical = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
function registrations(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(ts.isVariableStatement).filter(node => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
    .flatMap(node => node.declarationList.declarations)
    .filter(decl => decl.initializer && ts.isCallExpression(decl.initializer) && /^(publicQuery|adminQuery|adminMutation)$/.test(decl.initializer.expression.getText(ast)))
    .map(decl => decl.getText(ast).replaceAll('toPublicProperty', 'toPublic'));
}
let count = 0;
for (const name of endpoints) {
  const before = registrations(name, historical(`convex/${name}.ts`));
  assert.deepEqual(registrations(name, read(`convex/catalog/${name}.ts`)), before, `${name} registrations changed`);
  count += before.length;
}
assert.equal(count, 35);
assert.equal(read('convex/shared/imageUrls.ts'), historical('convex/lib/imageUrls.ts'), 'Image URL policy changed');
process.stdout.write(`All ${count} catalog registrations and the image URL policy match the dependent base.\n`);

const baseProperties = historical('convex/properties.ts');
for (const name of ['required', 'amount', 'imageUrl']) {
  function declaration(source) {
    return ts.createSourceFile('helpers.ts', source, ts.ScriptTarget.Latest, true).statements
      .find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)?.getText();
  }
  assert.equal(declaration(read('convex/shared/validation.ts')), declaration(baseProperties), `${name} validation changed`);
}
process.stdout.write('Required/amount/image URL validation remains unchanged.\n');
