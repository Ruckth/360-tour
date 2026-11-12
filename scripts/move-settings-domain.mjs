#!/usr/bin/env node
// Settings-only fixed-base codemod. --check is read-only and repeatable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '6d2c4ec82f285b891891d973ebd6ff09b8e21a99';
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const old = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const nameOf = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|staff|authenticated|device|admin|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const whole = {
  'convex/settings.ts': 'convex/settings/settings.ts',
  'convex/configurationHistory.ts': 'convex/settings/configurationHistory.ts',
  'convex/recordHistory.ts': 'convex/settings/recordHistory.ts',
  'convex/lib/configurationHistory.ts': 'convex/settings/configurationWriter.ts',
  'convex/lib/recordHistory.ts': 'convex/settings/recordWriter.ts',
};
const split = ['convex/lib/siteSettings.ts', 'convex/lib/staffAccess.ts', 'convex/staffAccess.ts', 'convex/emails.ts'];
const origins = [...Object.keys(whole), ...split];
const trees = new Map(origins.map(file => [file, ast(file, old(file))]));
const groups = new Map();
const locations = new Map();
function add(from, node, to, exported = false) {
  if (!groups.has(to)) groups.set(to, []);
  groups.get(to).push({ from, node, exported });
  if (nameOf(node)) locations.set(`${from}:${nameOf(node)}`, to);
}
for (const [from, to] of Object.entries(whole)) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) add(from, node, to);
const emailHelpers = new Set(['escapeHtml', 'loadSettings', 'fromHeader', 'ownerNotificationEmail', 'footerHtml']);
for (const from of split) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) {
  const name = nameOf(node);
  let to = from, exported = false;
  if (from === 'convex/lib/siteSettings.ts' && ['getSiteSettingsRow', 'getEffectiveSettings'].includes(name)) to = 'convex/settings/model.ts';
  if (from === 'convex/lib/staffAccess.ts' && name === 'cashierRules') to = 'convex/settings/cashierPolicy.ts';
  if (from === 'convex/staffAccess.ts' && ['getCashierRules', 'updateCashierRules'].includes(name)) to = 'convex/settings/cashierRules.ts';
  if (from === 'convex/emails.ts') {
    if (name === 'sendTestEmail') to = 'convex/settings/emails.ts';
    if (emailHelpers.has(name)) { to = 'convex/settings/emailTransport.ts'; exported = true; }
  }
  add(from, node, to, exported);
}
const rpc = new Map();
for (const [to, entries] of groups) for (const { from, node } of entries.filter(e => registration(e.node))) rpc.set(`${from.slice(7, -3)}:${nameOf(node)}`, `${to.slice(7, -3)}:${nameOf(node)}`);
function refs(source) {
  for (const [before, after] of rpc) {
    if (before === after) continue;
    const [mod, fn] = before.split(':');
    const [next, nextFn] = after.split(':');
    for (const prefix of ['api', 'internal']) {
      source = source.replaceAll(`${prefix}.${mod}.${fn}`, `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
      for (const quote of ["'", '"']) source = source.replaceAll(`${prefix}[${quote}${mod}${quote}].${fn}`, `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
    }
    source = source.replaceAll(before, after).replaceAll('`' + before.replace(':', '.') + '`', '`' + after.replace(':', '.') + '`');
  }
  return source;
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
  let target = locations.get(`${from}:${name}`) ?? whole[from] ?? from;
  if (target.startsWith('convex/settings/') && consumer.startsWith('convex/') && !consumer.startsWith('convex/settings/') && !consumer.endsWith('.test.ts') && consumer !== 'convex/schema.ts') target = 'convex/settings/model.ts';
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
      const replacement = [...byTarget].map(([dest, bindings]) => `import ${node.importClause.isTypeOnly ? 'type ' : ''}{ ${bindings.join(', ')} } from '${spec.startsWith('convex/') ? dest.replace(/\.ts$/, '') : relative(to, dest)}';`).join('\n');
      changes.push({ start: node.getStart(), end: node.end, replacement });
    } else {
      const dest = whole[target] ?? target;
      if (from !== to || dest !== target) changes.push({ start: node.moduleSpecifier.getStart(), end: node.moduleSpecifier.end, replacement: JSON.stringify(spec.startsWith('convex/') ? dest.replace(/\.ts$/, '') : relative(to, dest)) });
    }
  }
  for (const c of changes.reverse()) source = source.slice(0, c.start) + c.replacement + source.slice(c.end);
  // Explicit test module-map keys and string-based module mocking/imports.
  source = source.replace(/(['"])(\.\.?\/[^'"\n]+)\1/g, (match, quote, spec) => {
    const target = resolve(from, spec), mapped = whole[target];
    if (!mapped) return match;
    const extension = /\.ts$/.test(spec) ? '.ts' : /\.js$/.test(spec) ? '.js' : '';
    return quote + relative(to, mapped) + extension + quote;
  });
  return source;
}
function organize(file, source) {
  const host = { getScriptFileNames: () => [file], getScriptVersion: () => '0', getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined, getCurrentDirectory: () => root, getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }), getDefaultLibFileName: () => 'lib.d.ts', fileExists: () => false, readFile: () => undefined };
  const service = ts.createLanguageService(host);
  for (const change of service.organizeImports({ type: 'file', fileName: file }, { indentSize: 2, insertSpaceAfterCommaDelimiter: true }, {}).flatMap(c => c.textChanges).sort((a, b) => b.span.start - a.span.start)) source = source.slice(0, change.span.start) + change.newText + source.slice(change.span.start + change.span.length);
  service.dispose();
  for (const node of [...ast(file, source).statements].filter(ts.isImportDeclaration).reverse()) source = source.slice(0, node.getStart()) + node.getText().replace(/\s+/g, ' ') + source.slice(node.end);
  return source;
}
const modelExports = `
// Backend settings interface: named plain implementations, never endpoint aliases.
export { appendRecordHistory } from './recordWriter';
export { settingsSnapshot, propertySnapshot, roomSnapshot, logConfiguration, configurationWriter, logOtaRate } from './configurationWriter';
export { cashierRules } from './cashierPolicy';
export { escapeHtml, loadSettings, fromHeader, ownerNotificationEmail, footerHtml } from './emailTransport';
`;
if (!process.argv.includes('--check')) {
  for (const from of origins) assert.equal(read(from), old(from), `Codemod requires unchanged base source ${from}`);
  for (const [to, entries] of groups) {
    const sources = [...new Set(entries.map(e => e.from))];
    let source = sources.map(from => imports(trees.get(from).statements.filter(ts.isImportDeclaration).map(n => n.getText()).join('\n'), from, to)).join('\n');
    // Declarations split out of a module still bind to that module's original declarations.
    for (const from of sources) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) {
      const name = nameOf(node), dest = locations.get(`${from}:${name}`);
      if (name && dest !== to) source += `\nimport { ${name} } from '${relative(to, destination(from, name, to))}';`;
    }
    source += '\n\n' + entries.map(({ node, exported }) => exported && !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' + node.getText() : node.getFullText().trim()).join('\n\n') + '\n';
    if (to === 'convex/settings/model.ts') source += modelExports;
    write(to, organize(to, refs(source)));
  }
  for (const from of Object.keys(whole)) unlinkSync(path.join(root, from));
  for (const file of tracked()) {
    if (!/\.(ts|tsx|js|mjs|md|html|json|jsonc)$/.test(file) || groups.has(file) || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    let source = refs(read(file));
    if (/\.(ts|tsx|js|mjs)$/.test(file)) source = imports(source, file, file);
    if (file === 'convex/settings.test.ts') source = source
      .replace('afterEach(() => {', 'afterEach(() => {\n\tvi.useRealTimers();')
      .replace("it('uses saved business name, policy, times, tone and word limit, and per-villa discounts', async () => {", "it('uses saved business name, policy, times, tone and word limit, and per-villa discounts', async () => {\n\t\tvi.useFakeTimers();")
      .replace("expect(prompt).toContain('Always mention the sunset bar.');", "expect(prompt).toContain('Always mention the sunset bar.');\n\t\t// Finish the worker/alert jobs before the next test replaces the email fetch mock.\n\t\tawait t.finishAllScheduledFunctions(() => vi.runAllTimers());");
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
    const actual = current.statements.find(n => nameOf(n) && nameOf(n) === nameOf(node));
    assert.ok(actual, `Missing ${from}:${nameOf(node)}`);
    assert.equal(normalized(actual), normalized(ast('expected.ts', refs(node.getText())).statements[0]), `Changed implementation ${from}:${nameOf(node)}`);
    if (registration(node)) { if (to === from) retained++; else registrations++; } else helpers++;
  }
  const expectedNames = new Set(entries.map(({ node }) => nameOf(node)));
  assert.ok(current.statements.filter(n => !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)).every(n => expectedNames.has(nameOf(n))), `Extra logic in ${to}`);
  if (to.startsWith('convex/settings/')) assert.ok(read(to).split('\n').length < 1000, `Oversized ${to}`);
}
for (const from of Object.keys(whole)) assert.ok(!existsSync(path.join(root, from)), `Legacy file ${from}`);
const production = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'convex'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file) && !origins.includes(file));
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
    assert.ok(!Object.keys(whole).includes(target), `Legacy import ${file}:${target}`);
    if (file.startsWith('convex/') && !file.startsWith('convex/settings/') && !file.endsWith('.test.ts') && file !== 'convex/schema.ts' && target.startsWith('convex/settings/')) assert.equal(target, 'convex/settings/model.ts', `Bypass ${file}:${target}`);
    if (file.startsWith('src/')) assert.ok(!target.startsWith('convex/settings/'), `Browser settings model/private import ${file}`);
  }
}
for (const node of ast('model.ts', read('convex/settings/model.ts')).statements) {
  assert.ok(!registration(node), 'No model registrations');
  if (!ts.isExportDeclaration(node)) continue;
  assert.ok(node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause), 'Only explicit model exports');
  const target = resolve('convex/settings/model.ts', node.moduleSpecifier.text);
  for (const entry of node.exportClause.elements) {
    const implementation = treeFor(target, false).statements.find(n => nameOf(n) === (entry.propertyName?.text ?? entry.name.text));
    assert.ok(implementation && !registration(implementation), `Endpoint or missing implementation exported as ${entry.name.text}`);
  }
}
// Pure frontend-shared metadata stays in lib until 3c. No ctx or backend model imports.
for (const file of ['convex/lib/siteSettings.ts', 'convex/lib/staffTypes.ts']) {
  assert.ok(!/\bctx\b|_generated\/server|settings\/model/.test(read(file)), `Impure frontend rules ${file}`);
}
const access = tracked().filter(file => file.startsWith('convex/') && file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file)).map(file => inspectConvexAccess(file, read(file)));
const publicInventory = access.reduce((sum, entry) => sum + entry.registrations.length, 0), rawPublic = access.reduce((sum, entry) => sum + entry.violations.length, 0);
assert.equal(publicInventory, 295);
assert.equal(rawPublic, 0);
console.log(JSON.stringify({ base, registrations, retained, helpers, dependencyBindings, otherProductionDeclarations: other, publicInventory, rawPublic, rpc: Object.fromEntries(rpc), declarations: Object.fromEntries(locations) }, null, 2));
