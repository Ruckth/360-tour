#!/usr/bin/env node
// POS ownership closure fixed-base proof (read-only by default). --apply explicitly runs the one-shot codemod.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = 'a34eb197cc23ac53522440d48784a162256970ab';
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const oldCache = new Map();
const old = file => { if (!oldCache.has(file)) oldCache.set(file, execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })); return oldCache.get(file); };
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const nameOf = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|guest|staff|authenticated|device|admin|marketing|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const whole = Object.fromEntries(['orderLines', 'orderRefunds', 'lineLinks', 'orderLinks', 'displayView', 'orderLifecycle', 'staffApprovalState'].map(name => [`convex/lib/${name}.ts`, `convex/pos/private/${name}.ts`]));
whole['convex/pos/private/displayModel.ts'] = 'convex/pos/private/displayModel.ts';
const origins = Object.keys(whole);
const trees = new Map(origins.map(file => [file, ast(file, old(file))]));
const groups = new Map();
const locations = new Map();
function add(from, node, to, exported = false) {
  if (!groups.has(to)) groups.set(to, []);
  groups.get(to).push({ from, node, exported });
  if (nameOf(node)) locations.set(`${from}:${nameOf(node)}`, to);
}
for (const from of origins) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) {
  let to = whole[from];
  if (from === 'convex/lib/displayView.ts' && ['DisplayLine', 'DisplayCoupon', 'Shared', 'DisplayOrderState'].includes(nameOf(node))) to = 'convex/shared/displayTypes.ts';
  if (from === 'convex/pos/private/displayModel.ts' && ['DisplayState', 'DisplayDriver'].includes(nameOf(node))) to = 'convex/shared/displayTypes.ts';
  add(from, node, to, nameOf(node) === 'Shared');
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
  if (from === 'convex/pos/model.ts' && ['assertCustomerCanLink', 'assertCustomerReviewed', 'mergeCustomerRecords'].includes(name)) return 'convex/pos/private/customerModel.ts';
  if (from === 'convex/pos/model.ts' && name === 'PAIRING_TTL_MS') return 'convex/pos/private/displayModel.ts';
  if (from === 'convex/pos/model.ts' && ['DisplayState', 'DisplayDriver'].includes(name)) return 'convex/shared/displayTypes.ts';
  if (consumer === 'convex/schema.ts' && from === 'convex/pos/tables.ts') return from;
  if (from === 'convex/pos/model.ts' && !consumer.startsWith('convex/pos/')) return from;
  let target = locations.get(`${from}:${name}`) ?? whole[from] ?? from;
  if (target.startsWith('convex/pos/') && consumer.startsWith('convex/') && !consumer.startsWith('convex/pos/') && !consumer.endsWith('.test.ts')) target = 'convex/pos/model.ts';
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
      const dest = target === 'convex/pos/model.ts' && !to.startsWith('convex/pos/') ? target : whole[target] ?? target;
      if (from !== to || dest !== target) changes.push({ start: node.moduleSpecifier.getStart(), end: node.moduleSpecifier.end, replacement: JSON.stringify(dest.startsWith('src/') ? relative(to, dest) : spec.startsWith('convex/') ? dest.replace(/\.ts$/, '') : relative(to, dest)) });
    }
  }
  for (const c of changes.reverse()) source = source.slice(0, c.start) + c.replacement + source.slice(c.end);
  // Explicit test module-map keys and string-based module imports.
  source = source.replace(/(['"])(\.\.?\/[^'"\n]+)\1/g, (match, quote, spec) => {
    const target = resolve(from, spec), mapped = target === 'convex/pos/model.ts' ? undefined : whole[target];
    if (!mapped) return match;
    const extension = /\.ts$/.test(spec) ? '.ts' : /\.js$/.test(spec) ? '.js' : '';
    return quote + relative(to, mapped) + extension + quote;
  });
  return source;
}
// Merge only imports of the POS seam; retain aliases and type-only specifiers.
function mergeModelImports(source, file) {
  const grouped = new Map();
  for (const node of ast(file, source).statements.filter(ts.isImportDeclaration)) {
    if (!node.moduleSpecifier.text.endsWith('/pos/model')) continue;
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
  return changes.length ? source.replace(/\n\n(?=import )/g, '\n') : source;
}
function correctComments(source) {
  return source.replace(/(?:convex\/)?lib\/(orderLinks|lineLinks|displayView|orderRefunds)\.ts/g, 'convex/pos/private/$1.ts')
    .replace('pos.ts refuses more', 'convex/pos/private/orderModel.ts refuses more')
    .replace('pos.linkPaidLine, schema', 'convex/pos/commands/linkPaidLine.ts, schema')
    .replace('normalized like pos.getOrder:', 'normalized like convex/pos/orders.ts:getOrder:')
    .replace('and customers.ts for the optional customer link.', 'and convex/pos/customers.ts for the optional customer link.');
}
function organize(file, source) {
  const host = { getScriptFileNames: () => [file], getScriptVersion: () => '0', getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined, getCurrentDirectory: () => root, getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }), getDefaultLibFileName: () => 'lib.d.ts', fileExists: () => false, readFile: () => undefined };
  const service = ts.createLanguageService(host);
  for (const change of service.organizeImports({ type: 'file', fileName: file }, { indentSize: 2, insertSpaceAfterCommaDelimiter: true }, {}).flatMap(c => c.textChanges).sort((a, b) => b.span.start - a.span.start)) source = source.slice(0, change.span.start) + change.newText + source.slice(change.span.start + change.span.length);
  service.dispose();
  for (const node of [...ast(file, source).statements].filter(ts.isImportDeclaration).reverse()) source = source.slice(0, node.getStart()) + node.getText().replace(/\s+/g, ' ') + source.slice(node.end);
  return source.trimEnd() + '\n';
}
// Expose only helpers actually consumed outside POS. Tests use private declarations directly.
// nextCounter remains needed by the existing cross-domain fixture factory for order numbers.
const modelHelpers = new Set(['orderLineLinks', 'sourceLineLinks', 'activeSourceLink', 'isOpenOrder', 'isSettledOrder', 'nextCounter', 'insertOrder', 'ensureLinkedOrder', 'orderDeleteBlocker', 'deletePlaceholderOrders', 'assertNotOnOpenOrder', 'orderPaymentRecord']);
const helperExports = [...groups].flatMap(([to, entries]) => {
  const names = entries.filter(({node}) => modelHelpers.has(nameOf(node))).map(({node}) => nameOf(node));
  return names.length ? [`export { ${names.join(', ')} } from '${relative('convex/pos/model.ts', to)}';`] : [];
}).join('\n');
// Retire all prior unused command/customer/display/type exports; implementations remain private.
const modelPrefix = '// POS model interface. Implementations stay private; endpoints are never re-exported.\n';
if (process.argv.includes('--apply')) {
  assert.ok(!process.argv.includes('--check'), 'Choose --apply or read-only --check');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), base, 'Apply only on the exact base');
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
    for (const node of [...ast(to, source).statements].filter(ts.isImportDeclaration).reverse()) {
      if (resolve(to, node.moduleSpecifier.text) === to) source = source.slice(0, node.getStart()) + source.slice(node.end);
    }
    write(to, correctComments(organize(to, source)));
  }
  for (const from of Object.keys(whole)) if (!groups.has(from) && existsSync(path.join(root, from))) unlinkSync(path.join(root, from));
  write('convex/pos/model.ts', modelPrefix + helperExports + '\n');
  for (const file of tracked()) {
    if (!/\.(ts|tsx|js|mjs|md|html|json|jsonc)$/.test(file) || groups.has(file) || file === 'convex/pos/model.ts' || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    let original;
    try { original = old(file); } catch { continue; }
    let source = original;
    if (/\.(ts|tsx|js|mjs)$/.test(file)) source = imports(source, file, file);
    source = mergeModelImports(source, file);
    source = correctComments(source);
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
let helpers = 0, other = 0;
const unchangedRegistrations = [];
for (const [to, entries] of groups) {
  const current = ast(to, read(to));
  for (const { from, node } of entries) {
    const actual = nameOf(node) ? current.statements.find(n => nameOf(n) === nameOf(node)) : current.statements.filter(n => !ts.isImportDeclaration(n) && !nameOf(n))[entries.filter(e => !nameOf(e.node)).findIndex(e => e.node === node)];
    assert.ok(actual, `Missing ${from}:${nameOf(node)} in ${to}`);
    assert.equal(normalized(actual), normalized(ast('expected.ts', node.getText()).statements[0]), `Changed implementation ${from}:${nameOf(node)}`);
    assert.ok(!registration(node), `Helper source contains registration ${from}`);
    helpers++;
  }
  const expectedNames = new Set(entries.map(({ node }) => nameOf(node)));
  assert.ok(current.statements.filter(n => !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)).every(n => expectedNames.has(nameOf(n))), `Extra logic in ${to}`);
  assert.ok(read(to).split('\n').length < 1000, `Oversized ${to}`);
}
for (const from of Object.keys(whole).filter(f => !groups.has(f))) assert.ok(!existsSync(path.join(root, from)), `Legacy file ${from}`);
const production = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'convex'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file) && !origins.includes(file) && file !== 'convex/pos/model.ts');
const currentProduction = tracked().filter(file => file.startsWith('convex/') && file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file));
assert.deepEqual(currentProduction.sort(), [...new Set([...production, ...[...groups.keys()], 'convex/pos/model.ts'])].sort(), 'Unmapped production source or duplicate implementation');
for (const file of production) {
  const before = ast(file, old(file)).statements.filter(n => !ts.isImportDeclaration(n));
  const after = ast(file, read(file)).statements.filter(n => !ts.isImportDeclaration(n));
  assert.equal(after.length, before.length, `Declaration count changed ${file}`);
  for (let i = 0; i < before.length; i++) {
    assert.equal(normalized(after[i]), normalized(ast('expected.ts', imports(before[i].getText(), file, file)).statements[0]), `Other logic changed ${file}:${nameOf(before[i]) ?? i}`);
    if (registration(before[i])) unchangedRegistrations.push(`${file.slice(7, -3)}:${nameOf(before[i])}`);
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
  for (const node of ast(file, read(file)).statements.filter(ts.isImportDeclaration)) {
    const target = resolve(file, node.moduleSpecifier.text);
    assert.ok(!Object.keys(whole).filter(f => !groups.has(f)).includes(target), `Legacy import ${file}:${target}`);
    if (file.startsWith('convex/') && !file.startsWith('convex/pos/') && !file.endsWith('.test.ts') && file !== 'convex/schema.ts' && file !== 'convex/http.ts' && target.startsWith('convex/pos/')) assert.equal(target, 'convex/pos/model.ts', `Bypass ${file}:${target}`);
    if (file.startsWith('src/')) assert.ok(!target.startsWith('convex/pos/'), `Browser pos model/private import ${file}`);
  }
}
for (const node of ast('model.ts', read('convex/pos/model.ts')).statements) {
  assert.ok(ts.isExportDeclaration(node) && node.moduleSpecifier, 'Only named helper exports in model');
  assert.ok(node.exportClause && ts.isNamedExports(node.exportClause), 'Only explicit helper exports');
  const target = resolve('convex/pos/model.ts', node.moduleSpecifier.text);
  for (const entry of node.exportClause.elements) {
    const implementation = treeFor(target, false).statements.find(n => nameOf(n) === (entry.propertyName?.text ?? entry.name.text));
    assert.ok(implementation && implementation.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && !registration(implementation), `Endpoint or missing implementation exported as ${entry.name.text}`);
  }
}
assert.equal(read('convex/pos/model.ts'), modelPrefix + helperExports + '\n', 'Unexpected model surface');
assert.ok(treeFor('convex/shared/displayTypes.ts', false).statements.every(ts.isTypeAliasDeclaration), 'Display types must remain browser-safe type aliases');
let callerDeclarations = 0;
for (const file of tracked()) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file) || file.startsWith('convex/') || file.startsWith('scripts/move-')) continue;
  let original;
  try { original = old(file); } catch { continue; }
  const before = ast(file, original).statements.filter(n => !ts.isImportDeclaration(n));
  const after = ast(file, read(file)).statements.filter(n => !ts.isImportDeclaration(n));
  assert.equal(after.length, before.length, `Caller declaration count changed ${file}`);
  for (let i = 0; i < before.length; i++) {
    assert.equal(normalized(after[i]), normalized(before[i]), `Caller logic changed ${file}:${nameOf(before[i]) ?? i}`);
    callerDeclarations++;
  }
}
// Follow value imports/re-exports (erasing TS-only bindings) from the public helper seam.
// No endpoint registration or runtime cycle may be reachable from the POS seam.
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
runtimeClosure('convex/pos/model.ts');
runtimeClosure('convex/auth/model.ts');
runtimeClosure('convex/marketing/model.ts');
runtimeClosure('convex/services/model.ts');
runtimeClosure('convex/bookings/model.ts');
for (const file of currentProduction.filter(file => file.startsWith('convex/pos/private/'))) runtimeClosure(file);
const schedulerInventory = [];
for (const file of currentProduction) {
  function visit(node) {
    if (ts.isCallExpression(node) && /^(?:ctx\.scheduler\.(?:runAfter|runAt)|crons\.(?:interval|cron))$/.test(node.expression.getText())) {
      schedulerInventory.push({ file, call: node.getText() });
    }
    ts.forEachChild(node, visit);
  }
  visit(treeFor(file, false));
}
// Optional metadata obtained only by the real CLI against an isolated local backend.
// This audit reads a file; it never selects, contacts or deploys a backend.
const specFlag = process.argv.indexOf('--local-spec');
if (specFlag >= 0) {
  const spec = JSON.parse(read(process.argv[specFlag + 1]));
  assert.match(spec.url, /^http:\/\/127\.0\.0\.1:\d+$/, 'Only isolated localhost metadata');
  const names = spec.functions.filter(fn => fn.visibility).map(fn => fn.identifier.replace('.js:', ':'));
  assert.deepEqual(names.sort(), [...unchangedRegistrations].sort(), 'Actual public/internal registration paths differ from base');
}
const access = tracked().filter(file => file.startsWith('convex/') && file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file)).map(file => inspectConvexAccess(file, read(file)));
const publicInventory = access.reduce((sum, entry) => sum + entry.registrations.length, 0), rawPublic = access.reduce((sum, entry) => sum + entry.violations.length, 0);
assert.equal(publicInventory, 295);
assert.equal(rawPublic, 0);
console.log(JSON.stringify({ base, movedRegistrations: 0, unchangedRegistrations, helpers, dependencyBindings, otherProductionDeclarations: other, callerDeclarations, runtimeModelModules: [...runtimeModules], schedulerInventory, publicInventory, rawPublic, declarations: Object.fromEntries(locations) }, null, 2));
