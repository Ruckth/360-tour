#!/usr/bin/env node
// Explicit, one-shot Phase 3b BOOKINGS codemod; --check compares the preserved base.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'ee796bf2089fb2d13e29b3ece6e4bbc44d8c6d27';
const modules = ['bookings', 'adminBookings', 'availability', 'payments', 'ical'];
const destinations = { bookings: 'bookings/bookings', availability: 'bookings/calendar/availability', payments: 'bookings/payments/stripe', ical: 'bookings/calendar/ical' };
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const historical = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const declaredName = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|admin|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const sources = Object.fromEntries(modules.map(name => [name, historical(`convex/${name}.ts`)]));
const trees = Object.fromEntries(modules.map(name => [name, ast(name, sources[name])]));
const dateCommands = new Set(['addDateBlocks', 'addDateBlock', 'updateDateBlock', 'removeDateBlock']);
const mapping = new Map();
for (const name of modules) for (const node of trees[name].statements.filter(registration)) {
  const fn = declaredName(node);
  const dest = name === 'adminBookings' ? (/adminMutation\(/.test(node.getText()) ? `bookings/${dateCommands.has(fn) ? 'calendar' : 'commands'}/${fn}` : 'bookings/admin') : destinations[name];
  mapping.set(`${name}:${fn}`, `${dest}:${fn}`);
}
function target(module, fn) {
  // Negative security tests may name an endpoint that was deliberately never registered.
  return mapping.get(`${module}:${fn}`) ?? `${destinations[module] ?? 'bookings/admin'}:${fn}`;
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
    if (resolved === 'convex/messaging/claims.ts') to = 'convex/messaging/model.ts';
    if (sourceModule === 'bookings' || sourceModule === 'adminBookings') to = 'convex/bookings/model.ts';
    else if (sourceModule) to = `convex/${destinations[sourceModule]}.ts`;
    if (!sourceModule && from === destination) return match;
    return quote + relative(destination, to, extension) + quote;
  }).replaceAll('"convex/adminBookings"', '"convex/bookings/model"').replaceAll("'convex/adminBookings'", "'convex/bookings/model'");
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
const bookingHelpers = new Set(['assertNotCancelled', 'isDocumentedLiveRefund', 'StayPaymentInput', 'recordStayPayment', 'markBookingPaid', 'queueBookingEmails', 'queueCancellationEmail']);
const adminHelpers = trees.adminBookings.statements.filter(node => !ts.isImportDeclaration(node) && !registration(node));
const lifted = [...trees.bookings.statements.filter(node => bookingHelpers.has(declaredName(node))), ...adminHelpers];
const helperNames = lifted.map(declaredName);
const imports = name => trees[name].statements.filter(ts.isImportDeclaration).map(n => n.getText()).join('\n');
const generated = new Set(['convex/bookings/model.ts']);

if (!process.argv.includes('--check')) {
  if (!process.argv.includes('--rebuild-modules')) assert.equal(read('convex/bookings.ts'), sources.bookings, 'Run the move on the exact dependent base');
  const groups = new Map();
  for (const name of modules) {
    if (name === 'adminBookings') {
      for (const node of trees[name].statements.filter(registration)) {
        const dest = `convex/${mapping.get(`${name}:${declaredName(node)}`).split(':')[0]}.ts`;
        if (!groups.has(dest)) groups.set(dest, { name, nodes: [] });
        groups.get(dest).nodes.push(node);
      }
    } else groups.set(`convex/${destinations[name]}.ts`, { name, nodes: trees[name].statements.filter(n => !ts.isImportDeclaration(n) && !bookingHelpers.has(declaredName(n))) });
  }
  let model = rewriteImports(imports('bookings'), 'convex/bookings.ts', 'convex/bookings/model.ts') + '\n' + rewriteImports(imports('adminBookings'), 'convex/adminBookings.ts', 'convex/bookings/model.ts');
  // The model contains implementations, never imports itself or re-exports endpoints.
  model = model.replace(/^import .* from ['"]\.\/model['"];?\n?/gm, '');
  model += '\n\n' + lifted.map(node => {
    const text = node.getFullText().trim();
    return declaredName(node) === 'assertNotCancelled' || node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? text : node.getFullText().slice(0, node.getStart() - node.getFullStart()).trimStart() + 'export ' + node.getText();
  }).join('\n\n') + '\n';
  write('convex/bookings/model.ts', organize('model.ts', rewriteRefs(model)));
  for (const [dest, { name, nodes }] of groups) {
    const origin = `convex/${name}.ts`;
    const helperImport = `import { ${helperNames.filter(helper => !nodes.some(node => declaredName(node) === helper)).join(', ')} } from '${relative(dest, 'convex/bookings/model.ts')}';`;
    const body = nodes.map(n => n.getFullText().trim()).join('\n\n');
    const source = rewriteImports(imports(name), origin, dest) + '\n' + helperImport + '\n\n' + rewriteImports(body, origin, dest) + '\n';
    write(dest, organize(dest, rewriteRefs(source)));
    generated.add(dest);
  }
  for (const name of modules) if (existsSync(path.join(root, `convex/${name}.ts`))) unlinkSync(path.join(root, `convex/${name}.ts`));
  const changed = [];
  for (const file of process.argv.includes('--rebuild-modules') ? [] : tracked()) {
    if (!/\.(ts|tsx|mjs|js|md|html|json|jsonc)$/.test(file) || generated.has(file) || file.startsWith('convex/_generated/') || file === 'scripts/move-bookings-domain.mjs' || file === 'scripts/move-catalog-domain.mjs') continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    const before = read(file);
    let source = rewriteRefs(before);
    if (file === 'docs/architecture/phase3a-access-inventory.md') for (const [old, next] of mapping) source = source.replaceAll('`' + old.replace(':', '.') + '`', '`' + next.replace(':', '.') + '`');
    if (/\.(ts|tsx|mjs|js)$/.test(file)) source = rewriteImports(source, file, file);
    source = source.replaceAll('convex/availability.ts', 'convex/bookings/calendar/availability.ts');
    if (source !== before) { write(file, source); changed.push(file); }
  }
  process.stdout.write(`Moved ${mapping.size} registrations; rewrote ${changed.length} caller/import/inventory files.\n`);
}

const failures = [];
for (const name of modules) if (existsSync(path.join(root, `convex/${name}.ts`))) failures.push(`Old endpoint ${name}`);
const oldRefs = new RegExp(`\\b(?:api|internal)(?:\\.(?:${modules.join('|')})|\\[['"](?:${modules.join('|')})['"]\\])(?:\\.[A-Za-z_$][\\w$]*(?![\\w$]|\\s*\\.)|\\[['"][A-Za-z_$][\\w$]*['"]\\])|['"\x60](?:${modules.join('|')}):[A-Za-z_$]`, 'g');
for (const file of tracked()) {
  if (file.startsWith('docs/') || !/\.(ts|tsx|mjs|js|json|jsonc)$/.test(file) || file.startsWith('convex/_generated/') || /scripts\/move-(?:bookings|catalog)-domain.mjs/.test(file)) continue;
  for (const match of read(file).matchAll(oldRefs)) failures.push(`${file}: ${match[0]}`);
}
for (const file of tracked().filter(file => /\.(ts|tsx|mjs|js)$/.test(file) && !file.startsWith('scripts/move-'))) {
  for (const node of ast(file, read(file)).statements.filter(ts.isImportDeclaration)) {
    const specifier = node.moduleSpecifier.text;
    const resolved = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.replace(/\.(js|ts)$/, ''))) : specifier;
    if (modules.some(name => resolved === `convex/${name}`)) failures.push(`${file}: old import ${specifier}`);
  }
}
assert.deepEqual(failures, [], 'Old RPC references or endpoint files remain');
// Compare AST printing: normalize only the documented reference-path codemod and export modifier.
const printer = ts.createPrinter({ removeComments: true });
const normalized = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/^export /, '');
let count = 0;
for (const name of modules) for (const before of trees[name].statements.filter(registration)) {
  const fn = declaredName(before);
  const destination = mapping.get(`${name}:${fn}`).split(':')[0];
  const expected = ast('expected.ts', rewriteRefs(before.getText())).statements[0];
  const current = ast(destination, read(`convex/${destination}.ts`)).statements.find(node => declaredName(node) === fn);
  assert.ok(current && registration(current), `Missing exported registration ${destination}:${fn}`);
  assert.equal(normalized(current), normalized(expected), `Registration changed: ${name}:${fn}`);
  count++;
}
const modelTree = ast('model.ts', read('convex/bookings/model.ts'));
for (const before of lifted) {
  const name = declaredName(before);
  const current = modelTree.statements.find(node => declaredName(node) === name);
  assert.ok(current, `Missing lifted declaration: ${name}`);
  assert.equal(normalized(current), normalized(ast('expected.ts', rewriteRefs(before.getText())).statements[0]), `Lifted logic changed: ${name}`);
}
// Private helper bodies/constants/types in every intact module must also remain unchanged.
for (const name of ['bookings', 'availability', 'payments', 'ical']) {
  const current = ast(name, read(`convex/${destinations[name]}.ts`));
  for (const before of trees[name].statements.filter(n => !ts.isImportDeclaration(n) && !registration(n) && !bookingHelpers.has(declaredName(n)))) {
    const after = current.statements.find(n => declaredName(n) === declaredName(before));
    assert.ok(after, `Missing private declaration: ${name}.${declaredName(before)}`);
    // Relative type imports are the sole import-bearing declaration (payments' Booking type).
    const expected = ast('expected.ts', rewriteRefs(rewriteImports(before.getText(), `convex/${name}.ts`, `convex/${destinations[name]}.ts`))).statements[0];
    assert.equal(normalized(after), normalized(expected), `Private logic changed: ${name}.${declaredName(before)}`);
  }
}
assert.equal(modelTree.statements.filter(registration).length, 0);
assert.equal(count, 68);
const endpointFiles = [...new Set([...mapping.values()].map(value => `convex/${value.split(':')[0]}.ts`))];
assert.equal(endpointFiles.reduce((sum, file) => sum + ast(file, read(file)).statements.filter(registration).length, 0), 68, 'Unexpected extra registrations');
for (const file of endpointFiles) if (file.includes('/commands/') || dateCommands.has(path.basename(file, '.ts'))) assert.equal(ast(file, read(file)).statements.filter(registration).length, 1, `Command file must own exactly one registration: ${file}`);
process.stdout.write(`No old RPC paths/files. All ${count} registrations, ${lifted.length} lifted declarations and private module logic match ${base}.\n`);
if (process.argv.includes('--mapping')) for (const [old, next] of mapping) console.log(`| \`${old}\` | \`${next}\` |`);
