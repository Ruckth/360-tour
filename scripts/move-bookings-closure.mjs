#!/usr/bin/env node
// Bookings ownership closure fixed-base codemod. --check is read-only and repeatable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'd4359d41203937982f53705ad11b24060d893bcf';
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const oldCache = new Map();
const old = file => { if (!oldCache.has(file)) oldCache.set(file, execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })); return oldCache.get(file); };
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const nameOf = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|guest|staff|authenticated|device|admin|marketing|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const whole = Object.fromEntries(['bookingWrites', 'stayCorrections', 'bookingPhone', 'stayOverlap', 'availabilityWrites', 'chatCoupon'].map(name => [`convex/lib/${name}.ts`, `convex/bookings/private/${name}.ts`]));
whole['convex/bookings/model.ts'] = 'convex/bookings/private/stays.ts';
const split = ['convex/lib/bookingMoney.ts', 'convex/emails.ts', 'convex/crons.ts'];
const origins = [...Object.keys(whole), ...split];
const trees = new Map(origins.map(file => [file, ast(file, old(file))]));
const groups = new Map();
const locations = new Map();
function add(from, node, to, exported = false) {
  if (!groups.has(to)) groups.set(to, []);
  groups.get(to).push({ from, node, exported });
  if (nameOf(node)) locations.set(`${from}:${nameOf(node)}`, to);
}
for (const from of origins) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) {
  let to = whole[from] ?? from;
  if (from === 'convex/lib/bookingMoney.ts' && ['HISTORY_FIELDS', 'HistoryField', 'bookingSnapshot', 'same', 'appendBookingHistory', 'writeBooking'].includes(nameOf(node))) to = 'convex/bookings/private/money.ts';
  if (from === 'convex/emails.ts') to = registration(node) ? 'convex/bookings/emails.ts' : 'convex/bookings/private/emails.ts';
  if (from === 'convex/crons.ts' && !['crons', undefined].includes(nameOf(node))) to = registration(node) ? 'convex/bookings/maintenance.ts' : 'convex/bookings/private/maintenance.ts';
  add(from, node, to, ['escapedFields', 'sendLifecycleEmail', 'expireHold'].includes(nameOf(node)));
}
const rpc = new Map();
for (const [to, entries] of groups) for (const { from, node } of entries.filter(e => registration(e.node))) rpc.set(`${from.slice(7, -3)}:${nameOf(node)}`, `${to.slice(7, -3)}:${nameOf(node)}`);
function refs(source) {
  for (const [before, after] of rpc) {
    if (before === after) continue;
    const [mod, fn] = before.split(':');
    const [next, nextFn] = after.split(':');
    for (const prefix of ['api', 'internal']) {
      source = source.replace(new RegExp(`\\b${prefix}\\.${mod}\\.${fn}\\b`, 'g'), `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
      for (const quote of ["'", '"']) {
        source = source.replace(new RegExp(`\\b${prefix}\\[${quote}${mod}${quote}\\]\\.${fn}\\b`, 'g'), `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
        source = source.replace(new RegExp(`\\b${prefix}\\.${mod}\\[${quote}${fn}${quote}\\]`, 'g'), `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
        for (const moduleQuote of ["'", '"']) source = source.replace(new RegExp(`\\b${prefix}\\[${moduleQuote}${mod}${moduleQuote}\\]\\[${quote}${fn}${quote}\\]`, 'g'), `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
      }
    }
    source = source.replace(new RegExp(`(?<![\\w/])${mod}\\.js:${fn}\\b`, 'g'), `${next}.js:${nextFn}`);
    source = source.replace(new RegExp(`(?<![\\w/.])${mod}\\.${fn}\\b`, 'g'), `${next}.${nextFn}`);
    source = source.replace(new RegExp(`(?<![\\w/])${before}\\b`, 'g'), after).replaceAll('`' + before.replace(':', '.') + '`', '`' + after.replace(':', '.') + '`');
  }
  for (const [from, to] of Object.entries(whole)) if (from !== 'convex/bookings/model.ts') source = source.replaceAll(from, to);
  return source;
}
// A repeated read-only audit must not add path prefixes or rewrite similarly named retired RPCs.
for (const [before, after] of rpc) {
  assert.equal(refs(`'${before}'`), `'${after}'`);
  assert.equal(refs(refs(`'${before}'`)), `'${after}'`);
  const [mod, fn] = before.split(':'), [next, nextFn] = after.split(':');
  assert.equal(refs(`'${mod}.js:${fn}'`), `'${next}.js:${nextFn}'`);
  if (before !== after) for (const prefix of ['api', 'internal']) for (const variant of [`${prefix}.${mod}.${fn}`, `${prefix}["${mod}"].${fn}`, `${prefix}.${mod}['${fn}']`, `${prefix}['${mod}']["${fn}"]`]) assert.equal(refs(variant), `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
  assert.equal(refs(`'${before}Retired'`), `'${before}Retired'`);
}
function relative(from, to) {
    const spec = path.posix.relative(path.posix.dirname(from), to.replace(/\.ts$/, ''));
  return spec.startsWith('.') ? spec : './' + spec;
}
function resolve(from, spec) {
  const target = spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)).replace(/\.(ts|js)$/, '') : spec;
  if (!spec.startsWith('.') && !spec.startsWith('convex/')) return spec;
  return existsSync(path.join(root, target, 'index.ts')) ? `${target}/index.ts` : target + '.ts';
}
function destination(from, name, consumer) {
  if (consumer.startsWith('src/') && from === 'convex/bookings/model.ts' && name === 'AdminBooking') return 'src/lib/admin/booking-types.ts';
  if (consumer === 'convex/schema.ts' && from === 'convex/bookings/tables.ts') return from;
  if (from === 'convex/bookings/model.ts' && !consumer.startsWith('convex/bookings/')) return from;
  let target = locations.get(`${from}:${name}`) ?? whole[from] ?? from;
  if (target.startsWith('convex/bookings/') && consumer.startsWith('convex/') && !consumer.startsWith('convex/bookings/') && !consumer.endsWith('.test.ts') && !['convex/crons.ts', 'convex/emails.ts'].includes(consumer)) target = 'convex/bookings/model.ts';
  return target;
}
function imports(source, from, to) {
  const tree = ast(from, source);
  const changes = [];
  for (const node of tree.statements.filter(n => ts.isImportDeclaration(n) || ts.isExportDeclaration(n))) {
    if (!node.moduleSpecifier) continue;
    const spec = node.moduleSpecifier.text;
    if (!spec.startsWith('.') && !spec.startsWith('convex/')) continue;
    const target = resolve(from, spec);
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      // Preserve local aliases and type-only bindings, and split mixed ownership imports.
      const byTarget = new Map();
      for (const entry of node.importClause.namedBindings.elements) {
        const dest = destination(target, entry.propertyName?.text ?? entry.name.text, to);
        if (!byTarget.has(dest)) byTarget.set(dest, []);
        byTarget.get(dest).push(entry.getText());
      }
      if (node.importClause.name) throw new Error(`Unexpected mixed default import ${from}`);
      if (from === to && byTarget.size === 1 && byTarget.has(target)) continue;
      const replacement = [...byTarget].map(([dest, bindings]) => `import ${node.importClause.isTypeOnly ? 'type ' : ''}{ ${bindings.join(', ')} } from '${dest.startsWith('src/') ? relative(to, dest) : spec.startsWith('convex/') ? dest.replace(/\.ts$/, '') : relative(to, dest)}';`).join('\n');
      changes.push({ start: node.getStart(), end: node.end, replacement });
    } else {
      const dest = target === 'convex/bookings/model.ts' && !to.startsWith('convex/bookings/') ? target : whole[target] ?? target;
      if (from !== to || dest !== target) changes.push({ start: node.moduleSpecifier.getStart(), end: node.moduleSpecifier.end, replacement: JSON.stringify(dest.startsWith('src/') ? relative(to, dest) : spec.startsWith('convex/') ? dest.replace(/\.ts$/, '') : relative(to, dest)) });
    }
  }
  for (const c of changes.reverse()) source = source.slice(0, c.start) + c.replacement + source.slice(c.end);
  // Explicit test module-map keys and string-based module imports.
  source = source.replace(/(['"])(\.\.?\/[^'"\n]+)\1/g, (match, quote, spec) => {
    const target = resolve(from, spec), mapped = target === 'convex/bookings/model.ts' ? undefined : whole[target];
    if (!mapped) return match;
    const extension = /\.ts$/.test(spec) ? '.ts' : /\.js$/.test(spec) ? '.js' : '';
    return quote + relative(to, mapped) + extension + quote;
  });
  return source;
}
// Merge only imports of the Bookings seam; retain aliases and type-only specifiers.
function mergeModelImports(source, file) {
  const grouped = new Map();
  for (const node of ast(file, source).statements.filter(ts.isImportDeclaration)) {
    if (!node.moduleSpecifier.text.endsWith('/bookings/model')) continue;
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const key = node.moduleSpecifier.text;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(node);
  }
  const changes = [];
  for (const [spec, nodes] of grouped) {
    if (nodes.length < 2) continue;
    const bindings = nodes.flatMap(node => node.importClause.namedBindings.elements.map(entry => `${node.importClause.isTypeOnly && !entry.isTypeOnly ? 'type ' : ''}${entry.getText()}`));
    changes.push({ start: nodes[0].getStart(), end: nodes[0].end, replacement: `import { ${[...new Set(bindings)].join(', ')} } from '${spec}';` });
    for (const node of nodes.slice(1)) changes.push({ start: node.getStart(), end: node.end, replacement: '' });
  }
  for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.replacement + source.slice(change.end);
  return source;
}
function organize(file, source) {
  const host = { getScriptFileNames: () => [file], getScriptVersion: () => '0', getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined, getCurrentDirectory: () => root, getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }), getDefaultLibFileName: () => 'lib.d.ts', fileExists: () => false, readFile: () => undefined };
  const service = ts.createLanguageService(host);
  for (const change of service.organizeImports({ type: 'file', fileName: file }, { indentSize: 2, insertSpaceAfterCommaDelimiter: true }, {}).flatMap(c => c.textChanges).sort((a, b) => b.span.start - a.span.start)) source = source.slice(0, change.span.start) + change.newText + source.slice(change.span.start + change.span.length);
  service.dispose();
  for (const node of [...ast(file, source).statements].filter(ts.isImportDeclaration).reverse()) source = source.slice(0, node.getStart()) + node.getText().replace(/\s+/g, ' ') + source.slice(node.end);
  return source.trimEnd() + '\n';
}
const helperExports = [...groups].filter(([to]) => to.startsWith('convex/bookings/private/') && !to.endsWith('/emails.ts') && !to.endsWith('/maintenance.ts')).map(([to, entries]) => {
  const names = entries.filter(({node, exported}) => exported || node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)).map(({node}) => `${ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ? 'type ' : ''}${nameOf(node)}`);
  return `export { ${names.join(', ')} } from '${relative('convex/bookings/model.ts', to)}';`;
}).join('\n');
if (!process.argv.includes('--check')) {
  execFileSync('git', ['merge-base', '--is-ancestor', base, 'HEAD'], { cwd: root });
  for (const [to, entries] of groups) {
    const sources = [...new Set(entries.map(e => e.from))];
    let source = sources.map(from => imports(trees.get(from).statements.filter(ts.isImportDeclaration).map(n => n.getText()).join('\n'), from, to)).join('\n');
    // Declarations split out of a module still bind to that module's original declarations.
    for (const from of sources) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) {
      const name = nameOf(node), dest = locations.get(`${from}:${name}`);
      if (name && dest !== to) source += `\nimport ${ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) ? 'type ' : ''}{ ${name} } from '${relative(to, destination(from, name, to))}';`;
    }
    source += '\n\n' + entries.map(({ node, exported }) => exported && !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' + node.getText() : node.getFullText().trim()).join('\n\n') + '\n';
    // Retained mixed files keep their layout; add imports for lifted local dependencies.
    if (split.includes(to)) {
      const liftedImports = source.slice(0, source.indexOf('\n\n'));
      source = old(to);
      for (const node of [...trees.get(to).statements].reverse()) {
        if (ts.isImportDeclaration(node) || entries.some(entry => entry.node === node)) continue;
        source = source.slice(0, node.getFullStart()) + source.slice(node.end);
      }
      // Reuse the generated imports, including formerly local symbols.
      const body = ast(to, source).statements.filter(n => !ts.isImportDeclaration(n)).map(n => n.getFullText()).join('');
      source = liftedImports + '\n' + body;
    }
    if (to === 'convex/lib/bookingMoney.ts') source = '// Pure booking correction rules/types; ctx/history implementations belong to bookings/model.\n' + source.replace(/\n{4}/g, '\n\n');
    write(to, organize(to, refs(source)));
  }
  for (const from of [...Object.keys(whole), 'convex/emails.ts']) if (existsSync(path.join(root, from))) unlinkSync(path.join(root, from));
  write('src/lib/admin/booking-types.ts', `import type { FunctionReturnType } from 'convex/server';
import type { api } from 'convex/_generated/api';

export type AdminBooking = FunctionReturnType<typeof api.bookings.admin.listForAdmin>['bookings'][number];
`);
  write('convex/bookings/model.ts', '/** Bookings-owned plain helpers; no RPC registrations. */\n' + helperExports + '\n');
  for (const file of tracked()) {
    if (!/\.(ts|tsx|js|mjs|md|html|json|jsonc)$/.test(file) || groups.has(file) || file === 'convex/bookings/model.ts' || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    let original;
    try { original = old(file); } catch { continue; }
    let source = refs(original);
    if (/\.(ts|tsx|js|mjs)$/.test(file)) source = imports(source, file, file);
    if (file === 'convex/phase0Security.test.ts') source = source.replace("('emails:sendStaffAlert'), {})).rejects.toThrow('there is no such export')", "('emails:sendStaffAlert'), {})).rejects.toThrow('Could not find module for:')");
    source = mergeModelImports(source, file);
    if (source !== read(file)) write(file, source);
  }
}

// Compare syntax kinds and exact leaf text, including literal/template/regex contents.
// Only trivia and a lifted top-level export modifier may differ.
const normalized = node => {
  const visit = child => {
    const children = child.getChildren(child.getSourceFile()).filter(n => n.kind < ts.SyntaxKind.FirstJSDocNode || n.kind > ts.SyntaxKind.LastJSDocNode);
    return children.length ? [child.kind, children.map(n => visit(n))] : [child.kind, child.getText()];
  };
  return JSON.stringify(visit(ast('normalized.ts', node.getText().replace(/^export\s+/, '')).statements[0]));
};
const reverse = new Map([...locations].map(([key, to]) => [`${to}:${key.slice(key.lastIndexOf(':') + 1)}`, key]));
const cache = new Map();
function treeFor(file, before) {
  const key = `${before}:${file}`;
  if (!cache.has(key)) cache.set(key, ast(file, before ? old(file) : read(file)));
  return cache.get(key);
}
function symbol(file, name, before, seen = new Set()) {
  const key = `${file}:${name}`;
  if (file.startsWith('convex/_generated/')) return key;
  if (seen.has(key)) throw new Error(`Cyclic symbol resolution ${key}`);
  seen.add(key);
  const tree = treeFor(file, before);
  if (tree.statements.some(n => nameOf(n) === name)) return before ? key : reverse.get(key) ?? key;
  for (const node of tree.statements) {
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const entry = bindings.elements.find(e => e.name.text === name);
        if (entry) {
          const target = resolve(file, node.moduleSpecifier.text);
          const imported = entry.propertyName?.text ?? entry.name.text;
          if (!node.moduleSpecifier.text.startsWith('.') || target.startsWith('convex/_generated/')) return `${target}:${imported}`;
          return symbol(target, imported, before, seen);
        }
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
      const entry = node.exportClause.elements.find(e => e.name.text === name);
      if (entry) {
        const target = resolve(file, node.moduleSpecifier.text), exported = entry.propertyName?.text ?? entry.name.text;
        return node.moduleSpecifier.text.startsWith('.') ? symbol(target, exported, before, seen) : `${target}:${exported}`;
      }
    }
  }
  // Non-local declarations such as external library default imports.
  return key;
}
function bindings(file, before) {
  const result = new Map();
  for (const node of treeFor(file, before).statements) {
    const name = nameOf(node);
    if (name) result.set(name, symbol(file, name, before));
    if (!ts.isImportDeclaration(node)) continue;
    const entries = node.importClause?.namedBindings;
    if (entries && ts.isNamedImports(entries)) for (const entry of entries.elements) result.set(entry.name.text, symbol(file, entry.name.text, before));
  }
  return result;
}
let dependencyBindings = 0;
for (const [to, entries] of groups) {
  const after = bindings(to, false);
  for (const from of new Set(entries.map(e => e.from))) {
    const before = bindings(from, true);
    for (const [name, target] of after) if (before.has(name)) {
      assert.equal(target, before.get(name), `Changed dependency ${to}:${name}`);
      dependencyBindings++;
    }
  }
}
let registrations = 0, helpers = 0, retained = 0, other = 0;
for (const [to, entries] of groups) {
  const current = ast(to, read(to));
  for (const { from, node } of entries) {
    const actual = nameOf(node) ? current.statements.find(n => nameOf(n) === nameOf(node)) : current.statements.filter(n => !ts.isImportDeclaration(n) && !nameOf(n))[entries.filter(e => !nameOf(e.node)).findIndex(e => e.node === node)];
    assert.ok(actual, `Missing ${from}:${nameOf(node)} in ${to}`);
    assert.equal(normalized(actual), normalized(ast('expected.ts', ts.isExportDeclaration(node) ? organize(to, refs(node.getText())) : refs(node.getText())).statements[0]), `Changed implementation ${from}:${nameOf(node)}`);
    if (registration(node)) { if (to === from) retained++; else registrations++; } else helpers++;
  }
  const expectedNames = new Set(entries.map(({ node }) => nameOf(node)));
  assert.ok(current.statements.filter(n => !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)).every(n => expectedNames.has(nameOf(n))), `Extra logic in ${to}`);
  if (to.includes('/commands/')) assert.equal(current.statements.filter(registration).length, 1, `One command per file: ${to}`);
  if (to.startsWith('convex/bookings/')) assert.ok(read(to).split('\n').length < 1000, `Oversized ${to}`);
}
for (const from of [...Object.keys(whole), 'convex/emails.ts'].filter(f => f !== 'convex/bookings/model.ts')) assert.ok(!existsSync(path.join(root, from)), `Legacy file ${from}`);
const production = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'convex'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file) && !origins.includes(file));
const currentProduction = tracked().filter(file => file.startsWith('convex/') && file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file));
assert.deepEqual(currentProduction.sort(), [...new Set([...production, ...[...groups.keys()].filter(f => f !== 'convex/emails.ts'), 'convex/bookings/model.ts'])].sort(), 'Unmapped production source or duplicate implementation');
for (const file of production) {
  const before = ast(file, old(file)).statements.filter(n => !ts.isImportDeclaration(n));
  const after = ast(file, read(file)).statements.filter(n => !ts.isImportDeclaration(n));
  assert.equal(after.length, before.length, `Declaration count changed ${file}`);
  for (let i = 0; i < before.length; i++) {
    assert.equal(normalized(after[i]), normalized(ast('expected.ts', imports(refs(before[i].getText()), file, file)).statements[0]), `Other logic changed ${file}:${nameOf(before[i]) ?? i}`);
    other++;
  }
  const beforeBindings = bindings(file, true), afterBindings = bindings(file, false);
  for (const [name, target] of afterBindings) if (beforeBindings.has(name)) {
    assert.equal(target, beforeBindings.get(name), `Other dependency changed ${file}:${name}`);
    dependencyBindings++;
  }
}
for (const file of tracked()) {
  if (!/\.(ts|tsx|js|mjs|json|jsonc)$/.test(file) || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-') || file.startsWith('docs/')) continue;
  for (const [before, after] of rpc) if (before !== after) {
    assert.ok(!new RegExp(`(^|[^\\w/])${before}\\b`).test(read(file)), `Legacy RPC ${before} in ${file}`);
    assert.ok(!new RegExp(`\\b(?:api|internal)\\.${before.replace(':', '\\.')}\\b`).test(read(file)), `Legacy API ${before} in ${file}`);
  }
  for (const node of ast(file, read(file)).statements.filter(ts.isImportDeclaration)) {
    const target = resolve(file, node.moduleSpecifier.text);
    assert.ok(!Object.keys(whole).filter(f => f !== 'convex/bookings/model.ts').includes(target), `Legacy import ${file}:${target}`);
    if (file.startsWith('convex/') && !file.startsWith('convex/bookings/') && !file.endsWith('.test.ts') && file !== 'convex/schema.ts' && file !== 'convex/http.ts' && target.startsWith('convex/bookings/')) assert.equal(target, 'convex/bookings/model.ts', `Bypass ${file}:${target}`);
    if (file.startsWith('src/')) assert.ok(!target.startsWith('convex/bookings/'), `Browser bookings model/private import ${file}`);
  }
}
for (const node of ast('model.ts', read('convex/bookings/model.ts')).statements) {
  assert.ok(!registration(node), 'No model registrations');
  if (!ts.isExportDeclaration(node) || !node.moduleSpecifier?.text.startsWith('./private/')) continue;
  assert.ok(node.exportClause && ts.isNamedExports(node.exportClause), 'Only explicit helper exports');
  const target = resolve('convex/bookings/model.ts', node.moduleSpecifier.text);
  for (const entry of node.exportClause.elements) {
    const implementation = treeFor(target, false).statements.find(n => nameOf(n) === (entry.propertyName?.text ?? entry.name.text));
    assert.ok(implementation && implementation.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && !registration(implementation), `Endpoint or missing implementation exported as ${entry.name.text}`);
  }
}
// Follow value imports/re-exports (erasing TS-only bindings) from the public helper seam.
// No endpoint registration or runtime cycle may be reachable from the Bookings seam.
const runtimeModules = new Set();
function runtimeClosure(file, stack = []) {
  assert.ok(!stack.includes(file), `Runtime import cycle: ${[...stack, file].join(' -> ')}`);
  if (runtimeModules.has(file) || file.startsWith('convex/_generated/')) return;
  runtimeModules.add(file);
  const tree = treeFor(file, false);
  assert.ok(!tree.statements.some(registration), `Registration module reachable from model: ${file}`);
  for (const node of tree.statements) {
    if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier) continue;
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly || (clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.name && clause.namedBindings.elements.every(e => e.isTypeOnly))) continue;
    } else if (node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(e => e.isTypeOnly))) continue;
    if (node.moduleSpecifier.text.startsWith('.')) runtimeClosure(resolve(file, node.moduleSpecifier.text), [...stack, file]);
  }
}
runtimeClosure('convex/marketing/model.ts');
runtimeClosure('convex/bookings/model.ts');
const access = tracked().filter(file => file.startsWith('convex/') && file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file)).map(file => inspectConvexAccess(file, read(file)));
const publicInventory = access.reduce((sum, entry) => sum + entry.registrations.length, 0), rawPublic = access.reduce((sum, entry) => sum + entry.violations.length, 0);
assert.equal(registrations, 9);
assert.equal(publicInventory, 295);
assert.equal(rawPublic, 0);
console.log(JSON.stringify({ base, registrations, retained, helpers, dependencyBindings, otherProductionDeclarations: other, runtimeModelModules: [...runtimeModules], publicInventory, rawPublic, rpc: Object.fromEntries(rpc), declarations: Object.fromEntries(locations) }, null, 2));
