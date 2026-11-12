#!/usr/bin/env node
// Explicit, one-shot Phase 3b SERVICES codemod; --check compares the preserved base.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'a3be68d6a23b4ce933766d37ff53d329063a8713';
const modules = ['adminServices', 'publicServices', 'serviceBookings', 'roster', 'crons'];
const destinations = { publicServices: 'services/publicServices', serviceBookings: 'services/serviceBookings', roster: 'services/roster', crons: 'services/maintenance' };
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const historical = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const declaredName = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|admin|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const sources = Object.fromEntries(modules.map(name => [name, historical(`convex/${name}.ts`)]));
const trees = Object.fromEntries(modules.map(name => [name, ast(name, sources[name])]));
const movedNodes = name => trees[name].statements.filter(registration).filter(node => name !== 'crons' || declaredName(node) === 'cleanStaffAvatarUploads');
const mapping = new Map();
for (const name of modules) for (const node of movedNodes(name)) {
  const fn = declaredName(node);
  const dest = name === 'adminServices' ? (/adminQuery\(/.test(node.getText()) ? 'services/admin' : `services/commands/${fn}`) : destinations[name];
  mapping.set(`${name}:${fn}`, `${dest}:${fn}`);
}
function target(module, fn) {
  // Negative security tests may name an endpoint that was deliberately never registered.
  return mapping.get(`${module}:${fn}`) ?? (module === 'crons' ? `${module}:${fn}` : `${destinations[module] ?? 'services/admin'}:${fn}`);
}
function rewriteRefs(source) {
  const names = modules.join('|');
  return source
    .replace(new RegExp(`\\b(api|internal)\\.(${names})\\.([A-Za-z_$][\\w$]*)`, 'g'), (_, access, module, fn) => `${access}.${target(module, fn).replaceAll('/', '.').replace(':', '.')}`)
    .replace(new RegExp(`\\b(api|internal)\\[(['"])(${names})\\2\\]\\.([A-Za-z_$][\\w$]*)`, 'g'), (_, access, _quote, module, fn) => `${access}.${target(module, fn).replaceAll('/', '.').replace(':', '.')}`)
    .replace(new RegExp(`([ '"\x60])(${names}):([A-Za-z_$][\\w$]*)`, 'g'), (_, prefix, module, fn) => prefix + target(module, fn));
}
function relative(from, to, extension = '') {
  let result = path.posix.relative(path.posix.dirname(from), to.replace(/\.ts$/, ''));
  if (!result.startsWith('.')) result = './' + result;
  return result + extension;
}
function rewriteImports(source, from, destination) {
  return source.replace(/(['"])(\.\.?\/[^'"\n]+)\1/g, (match, quote, specifier) => {
    const extension = /\.(js|ts)$/.exec(specifier)?.[0] ?? '';
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier.replace(/\.(js|ts)$/, ''))) + '.ts';
    const sourceModule = modules.find(name => resolved === `convex/${name}.ts`);
    let to = resolved;
    if (sourceModule === 'adminServices' || sourceModule === 'roster' || sourceModule === 'serviceBookings') to = 'convex/services/model.ts';
    else if (sourceModule === 'publicServices') to = 'convex/services/publicServices.ts';
    if (!sourceModule && from === destination) return match;
    return quote + relative(destination, to, extension) + quote;
  }).replaceAll('"convex/adminServices"', '"convex/services/model"').replaceAll("'convex/adminServices'", "'convex/services/model'");
}
// TypeScript's organizeImports removes unused bindings and merges duplicate imports.
function organize(file, source) {
  const host = {
    getScriptFileNames: () => [file], getScriptVersion: () => '0',
    getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined,
    getCurrentDirectory: () => root, getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }),
    getDefaultLibFileName: () => 'lib.d.ts', fileExists: () => false, readFile: () => undefined,
  };
  const service = ts.createLanguageService(host);
  const changes = service.organizeImports({ type: 'file', fileName: file }, { insertSpaceAfterCommaDelimiter: true, indentSize: 2 }, {});
  for (const change of changes.flatMap(c => c.textChanges).sort((a, b) => b.span.start - a.span.start)) source = source.slice(0, change.span.start) + change.newText + source.slice(change.span.start + change.span.length);
  service.dispose();
  for (const node of [...ast(file, source).statements].filter(ts.isImportDeclaration).reverse()) source = source.slice(0, node.getStart()) + node.getText().replace(/\s+/g, ' ') + source.slice(node.end);
  return source;
}
const extraHelpers = { roster: new Set(['STALE_ROSTER', 'RosterConflict']), serviceBookings: new Set(['NOT_SCHEDULED']), crons: new Set(['STAFF_AVATAR_UPLOAD_TTL_MS']) };
const adminHelpers = trees.adminServices.statements.filter(node => !ts.isImportDeclaration(node) && !registration(node));
const lifted = [...adminHelpers, ...Object.entries(extraHelpers).flatMap(([name, names]) => trees[name].statements.filter(node => names.has(declaredName(node))))];
const helperNames = lifted.map(declaredName);
const imports = name => trees[name].statements.filter(ts.isImportDeclaration).map(n => n.getText()).join('\n');
const generated = new Set(['convex/services/model.ts']);

if (!process.argv.includes('--check')) {
  if (!process.argv.includes('--rebuild-modules')) assert.equal(read('convex/adminServices.ts'), sources.adminServices, 'Run the move on the exact dependent base');
  const groups = new Map();
  for (const name of modules) {
    if (name === 'adminServices') {
      for (const node of movedNodes(name)) {
        const dest = `convex/${mapping.get(`${name}:${declaredName(node)}`).split(':')[0]}.ts`;
        if (!groups.has(dest)) groups.set(dest, { name, nodes: [] });
        groups.get(dest).nodes.push(node);
      }
    } else if (name === 'crons') groups.set('convex/services/maintenance.ts', { name, nodes: movedNodes(name) });
    else groups.set(`convex/${destinations[name]}.ts`, { name, nodes: trees[name].statements.filter(n => !ts.isImportDeclaration(n) && !extraHelpers[name]?.has(declaredName(n))) });
  }
  let model = rewriteImports(imports('adminServices'), 'convex/adminServices.ts', 'convex/services/model.ts') + "\nimport type { RosterBreak } from '../lib/serviceSlots';";
  // The model contains implementations, never imports itself or re-exports endpoints.
  model = model.replace(/^import .* from ['"]\.\/model['"];?\n?/gm, '');
  model += '\n\n' + lifted.map(node => {
    const text = node.getFullText().trim();
    return node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? text : node.getFullText().slice(0, node.getStart() - node.getFullStart()).trimStart() + 'export ' + node.getText();
  }).join('\n\n') + '\n';
  write('convex/services/model.ts', organize('model.ts', rewriteRefs(model)));
  for (const [dest, { name, nodes }] of groups) {
    const origin = `convex/${name}.ts`;
    const helperImport = `import { ${helperNames.filter(helper => !nodes.some(node => declaredName(node) === helper)).join(', ')} } from '${relative(dest, 'convex/services/model.ts')}';`;
    const body = nodes.map(n => n.getFullText().trim()).join('\n\n');
    const source = rewriteImports(imports(name), origin, dest) + '\n' + helperImport + '\n\n' + rewriteImports(body, origin, dest) + '\n';
    write(dest, organize(dest, rewriteRefs(source)));
    generated.add(dest);
  }
  for (const name of modules.filter(name => name !== 'crons')) if (existsSync(path.join(root, `convex/${name}.ts`))) unlinkSync(path.join(root, `convex/${name}.ts`));
  const changed = [];
  for (const file of process.argv.includes('--rebuild-modules') ? [] : tracked()) {
    if (!/\.(ts|tsx|mjs|js|md|html|json|jsonc)$/.test(file) || generated.has(file) || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    const before = read(file);
    let source = rewriteRefs(before);
    if (file === 'docs/architecture/phase3a-access-inventory.md') for (const [old, next] of mapping) source = source.replaceAll('`' + old.replace(':', '.') + '`', '`' + next.replace(':', '.') + '`');
    if (/\.(ts|tsx|mjs|js)$/.test(file)) source = rewriteImports(source, file, file);
    if (file === 'convex/staffAvatars.test.ts') source = source.replace("from './crons'", "from './services/model'")
      .replace("'./services/model.ts': async", "'./services/commands/registerStaffAvatarUpload.ts': async")
      .replace("await import('./services/model')", "await import('./services/commands/registerStaffAvatarUpload')");
    if (file === 'convex/crons.ts') {
      const tree = ast(file, source);
      for (const node of [...tree.statements].reverse()) if (['cleanStaffAvatarUploads', 'STAFF_AVATAR_UPLOAD_TTL_MS'].includes(declaredName(node))) source = source.slice(0, node.getFullStart()) + source.slice(node.end);
    }
    if (source !== before) { write(file, source); changed.push(file); }
  }
  process.stdout.write(`Moved ${mapping.size} registrations; rewrote ${changed.length} caller/import/inventory files.\n`);
}

const failures = [];
for (const name of modules.filter(name => name !== 'crons')) if (existsSync(path.join(root, `convex/${name}.ts`))) failures.push(`Old endpoint ${name}`);
const oldRefs = new RegExp(`\\b(?:api|internal)(?:\\.(?:${modules.filter(name => name !== 'crons').join('|')})|\\[['"](?:${modules.filter(name => name !== 'crons').join('|')})['"]\\])(?:\\.[A-Za-z_$][\\w$]*(?![\\w$]|\\s*\\.)|\\[['"][A-Za-z_$][\\w$]*['"]\\])|['"\x60](?:${modules.filter(name => name !== 'crons').join('|')}):[A-Za-z_$]`, 'g');
for (const file of tracked()) {
  if (file.startsWith('docs/') || !/\.(ts|tsx|mjs|js|json|jsonc)$/.test(file) || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
  for (const match of read(file).matchAll(oldRefs)) failures.push(`${file}: ${match[0]}`);
  if (/\b(?:api|internal)\.crons\.cleanStaffAvatarUploads\b|['"`]crons:cleanStaffAvatarUploads\b/.test(read(file))) failures.push(`${file}: old photo cleanup RPC`);
}
for (const file of tracked().filter(file => /\.(ts|tsx|mjs|js)$/.test(file) && !file.startsWith('scripts/move-') && !file.startsWith('convex/_generated/'))) {
  for (const node of ast(file, read(file)).statements.filter(ts.isImportDeclaration)) {
    const specifier = node.moduleSpecifier.text;
    const resolved = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.replace(/\.(js|ts)$/, ''))) : specifier;
    if (modules.filter(name => name !== 'crons').some(name => resolved === `convex/${name}`)) failures.push(`${file}: old import ${specifier}`);
  }
}
assert.deepEqual(failures, [], 'Old RPC references or endpoint files remain');
// Compare AST printing: normalize only the documented reference-path codemod and export modifier.
const printer = ts.createPrinter({ removeComments: true });
const normalized = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/^export /, '');
function builderBinding(file, tree, declaration) {
  const builder = declaration.declarationList.declarations[0].initializer.expression.getText();
  for (const node of tree.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const binding = bindings.elements.find(element => element.name.text === builder);
    if (binding) {
      const builderModule = node.moduleSpecifier.text;
      const resolved = builderModule.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), builderModule)).replace(/\.(ts|js)$/, '') : builderModule;
      return `${resolved}:${binding.propertyName?.text ?? binding.name.text}`;
    }
  }
  throw new Error(`Unresolved registration builder: ${file}:${builder}`);
}
let count = 0;
for (const name of modules) for (const before of movedNodes(name)) {
  const fn = declaredName(before);
  const destination = mapping.get(`${name}:${fn}`).split(':')[0];
  const expected = ast('expected.ts', rewriteRefs(before.getText())).statements[0];
  const current = ast(destination, read(`convex/${destination}.ts`)).statements.find(node => declaredName(node) === fn);
  assert.ok(current && registration(current), `Missing exported registration ${destination}:${fn}`);
  assert.equal(builderBinding(`convex/${destination}.ts`, current.getSourceFile(), current), builderBinding(`convex/${name}.ts`, trees[name], before), `Builder import changed: ${name}:${fn}`);
  assert.equal(normalized(current), normalized(expected), `Registration changed: ${name}:${fn}`);
  count++;
}
const modelTree = ast('model.ts', read('convex/services/model.ts'));
for (const before of lifted) {
  const name = declaredName(before);
  const current = modelTree.statements.find(node => declaredName(node) === name);
  assert.ok(current, `Missing lifted declaration: ${name}`);
  assert.equal(normalized(current), normalized(ast('expected.ts', rewriteRefs(before.getText())).statements[0]), `Lifted logic changed: ${name}`);
}
// Private helper bodies/constants/types in every intact module must also remain unchanged.
for (const name of ['publicServices', 'serviceBookings', 'roster']) {
  const current = ast(name, read(`convex/${destinations[name]}.ts`));
  for (const before of trees[name].statements.filter(n => !ts.isImportDeclaration(n) && !registration(n) && !extraHelpers[name]?.has(declaredName(n)))) {
    const after = current.statements.find(n => declaredName(n) === declaredName(before));
    assert.ok(after, `Missing private declaration: ${name}.${declaredName(before)}`);
    // Only relocated relative imports and mapped RPC paths may change.
    const expected = ast('expected.ts', rewriteRefs(rewriteImports(before.getText(), `convex/${name}.ts`, `convex/${destinations[name]}.ts`))).statements[0];
    assert.equal(normalized(after), normalized(expected), `Private logic changed: ${name}.${declaredName(before)}`);
  }
}
// Every other production declaration (including remaining crons) must also be
// AST-identical after the same path-only substitutions. This audits other owners
// without moving their implementations or silently widening the services scope.
const productionFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'convex'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  .filter(file => file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file) && !modules.filter(name => name !== 'crons').some(name => file === `convex/${name}.ts`));
let unchangedDeclarations = 0;
for (const file of productionFiles) {
  const before = ast(file, historical(file)).statements.filter(node => !ts.isImportDeclaration(node) && !(file === 'convex/crons.ts' && ['cleanStaffAvatarUploads', 'STAFF_AVATAR_UPLOAD_TTL_MS'].includes(declaredName(node))));
  const after = ast(file, read(file)).statements.filter(node => !ts.isImportDeclaration(node));
  assert.equal(after.length, before.length, `Declaration count changed: ${file}`);
  for (let i = 0; i < before.length; i++) {
    const expected = ast('expected.ts', rewriteRefs(rewriteImports(before[i].getText(), file, file))).statements[0];
    assert.equal(normalized(after[i]), normalized(expected), `Other production logic changed: ${file}:${declaredName(before[i]) ?? i}`);
    unchangedDeclarations++;
  }
}
assert.equal(modelTree.statements.filter(registration).length, 0);
assert.equal(count, 58);
const endpointFiles = [...new Set([...mapping.values()].map(value => `convex/${value.split(':')[0]}.ts`))];
assert.equal(endpointFiles.reduce((sum, file) => sum + ast(file, read(file)).statements.filter(registration).length, 0), 58, 'Unexpected extra registrations');
for (const file of endpointFiles) if (file.includes('/commands/')) assert.equal(ast(file, read(file)).statements.filter(registration).length, 1, `Command file must own exactly one registration: ${file}`);
process.stdout.write(`No old RPC paths/files. All ${count} registrations, ${lifted.length} lifted declarations and private module logic match ${base}; ${unchangedDeclarations} other production declarations unchanged.\n`);
if (process.argv.includes('--mapping')) for (const [old, next] of mapping) console.log(`| \`${old}\` | \`${next}\` |`);
