#!/usr/bin/env node
// Messaging ownership fixed-base codemod. --check is read-only and repeatable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '8be1dd4e73af8e2dcaa2666c80497aaf94da8b7a';
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const old = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const nameOf = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|guest|staff|authenticated|device|admin|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const whole = {
  'convex/chat.ts': 'convex/messaging/chat.ts',
  'convex/adminChat.ts': 'convex/messaging/adminChat.ts',
  'convex/adminReply.ts': 'convex/messaging/adminReply.ts',
  'convex/chatSuggestions.ts': 'convex/messaging/chatSuggestions.ts',
  'convex/inboxLifecycle.ts': 'convex/messaging/inboxLifecycle.ts',
  'convex/leads.ts': 'convex/messaging/leads.ts',
  'convex/chatAi.ts': 'convex/messaging/admission.ts',
  'convex/chatKnowledge.ts': 'convex/messaging/staffHandoff.ts',
  'convex/lib/guestToken.ts': 'convex/messaging/guestToken.ts',
  'convex/lib/chatAdmission.ts': 'convex/messaging/chatAdmission.ts',
  'convex/lib/adminChatMetadata.ts': 'convex/messaging/adminChatMetadata.ts',
  'convex/lib/inboxLifecycle.ts': 'convex/messaging/inboxState.ts',
  'convex/lib/channelReplyWindow.ts': 'convex/messaging/channelReplyWindow.ts',
  'convex/lib/rateLimit.ts': 'convex/messaging/rateLimit.ts',
};
const split = ['convex/emails.ts', 'convex/crons.ts', 'convex/messaging/model.ts', 'convex/lib/chatWriteGuard.ts', 'convex/auth/model.ts'];
const origins = [...Object.keys(whole), ...split];
const trees = new Map(origins.map(file => [file, ast(file, old(file))]));
const groups = new Map();
const locations = new Map();
function add(from, node, to, exported = false) {
  if (!groups.has(to)) groups.set(to, []);
  groups.get(to).push({ from, node, exported });
  if (nameOf(node)) locations.set(`${from}:${nameOf(node)}`, to);
}
for (const [from, to] of Object.entries(whole)) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) {
  const name = nameOf(node);
  let target = to, exported = false;
  if (from === 'convex/chatKnowledge.ts' && !registration(node)) { target = 'convex/messaging/staffRequests.ts'; }
  if (from === 'convex/leads.ts' && name === 'recordLead') target = 'convex/messaging/leadWriter.ts';
  add(from, node, target, exported);
}
for (const from of split) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) {
  const name = nameOf(node);
  let to = from;
  if (from === 'convex/emails.ts' && name === 'sendStaffAlert') to = 'convex/messaging/alerts.ts';
  if (from === 'convex/crons.ts' && name === 'cleanRateLimits') to = 'convex/messaging/maintenance.ts';
  if (from === 'convex/messaging/model.ts') {
    if (ts.isExportDeclaration(node)) continue;
    to = 'convex/messaging/pipeline.ts';
  }
  if (from === 'convex/auth/model.ts' && name === 'maintenancePaused') to = 'convex/lib/maintenance.ts';
  if (from === 'convex/lib/chatWriteGuard.ts' && name === 'assertChatWriteAllowed') to = 'convex/messaging/writeGuard.ts';
  add(from, node, to);
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
      for (const quote of ["'", '"']) source = source.replace(new RegExp(`\\b${prefix}\\[${quote}${mod}${quote}\\]\\.${fn}\\b`, 'g'), `${prefix}.${next.replaceAll('/', '.')}.${nextFn}`);
    }
    source = source.replace(new RegExp(`(?<![\\w/])${before}\\b`, 'g'), after).replaceAll('`' + before.replace(':', '.') + '`', '`' + after.replace(':', '.') + '`');
  }
  return source;
}
// A repeated read-only audit must not add path prefixes or rewrite similarly named retired RPCs.
for (const [before, after] of rpc) {
  assert.equal(refs(`'${before}'`), `'${after}'`);
  assert.equal(refs(refs(`'${before}'`)), `'${after}'`);
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
  let target = locations.get(`${from}:${name}`) ?? whole[from] ?? from;
  if (consumer === 'convex/http.ts' && from === 'convex/messaging/ingress.ts') return from;
  if (target.startsWith('convex/messaging/') && consumer.startsWith('convex/') && !consumer.startsWith('convex/messaging/') && !consumer.endsWith('.test.ts') && consumer !== 'convex/schema.ts') target = 'convex/messaging/model.ts';
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
  source = source.replace(/(const\s+\{\s*asksForStaff\s*\}\s*=\s*await import\()(['"])([^'"]+)\2(\))/g, (match, prefix, quote, spec, suffix) => {
    const dest = locations.get(`${resolve(from, spec)}:asksForStaff`);
    return dest ? prefix + quote + relative(to, dest) + quote + suffix : match;
  });
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
  return source.trimEnd() + '\n';
}
const modelExports = `// Backend messaging interface: plain implementations only. Never import registrations here.
export { createGuestToken, hashGuestToken, requireGuestToken } from './guestToken';
export { LEASE_MS, MAX_ATTEMPTS, recordGuest, nextEvent, scheduleNext, reconcile } from './pipeline';
export { startDurablePreparation, currentClaim, withDurableTool, durableToolValidator, durableTurnValidator, type DurableTool } from './claims';
export { asksForStaff, queueStaffAlert } from './staffRequests';
export { recordLead } from './leadWriter';
export { enforceRateLimit, rateLimitReached } from './rateLimit';
export { assertChatWriteAllowed } from './writeGuard';
export { type ReplyOutcome } from './inboxState';
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
    // Retained mixed registries keep their original layout and runtime comments.
    if (['convex/auth/model.ts', 'convex/crons.ts', 'convex/emails.ts'].includes(to)) {
      source = old(to);
      for (const node of [...trees.get(to).statements].reverse()) {
        if (ts.isImportDeclaration(node) || !nameOf(node) || locations.get(`${to}:${nameOf(node)}`) === to) continue;
        source = source.slice(0, node.getFullStart()) + source.slice(node.end);
      }
      source = imports(source, to, to);
      if (to === 'convex/auth/model.ts') source = source.replace("import { customAction", "import { maintenancePaused } from '../lib/maintenance';\nimport { customAction") + `\nexport { maintenancePaused } from '../lib/maintenance';\n`;
    }
    if (to === 'convex/messaging/alerts.ts') source = "// HTML emails use Resend's fetch API and can run in the default Convex runtime.\n" + source;
    if (to === 'convex/lib/maintenance.ts') source = '// One backend flag predicate shared by access builders and durable helpers, without a runtime cycle.\n' + source;
    write(to, organize(to, refs(source)));
  }
  write('convex/messaging/model.ts', modelExports);
  for (const from of Object.keys(whole)) if (existsSync(path.join(root, from))) unlinkSync(path.join(root, from));
  for (const file of tracked()) {
    if (!/\.(ts|tsx|js|mjs|md|html|json|jsonc)$/.test(file) || groups.has(file) || file === 'convex/messaging/model.ts' || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    let source = refs(read(file));
    if (/\.(ts|tsx|js|mjs)$/.test(file)) source = imports(source, file, file);
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
    assert.ok(actual, `Missing ${from}:${nameOf(node)}`);
    assert.equal(normalized(actual), normalized(ast('expected.ts', ts.isExportDeclaration(node) ? organize(to, refs(node.getText())) : refs(node.getText())).statements[0]), `Changed implementation ${from}:${nameOf(node)}`);
    if (registration(node)) { if (to === from) retained++; else registrations++; } else helpers++;
  }
  const expectedNames = new Set(entries.map(({ node }) => nameOf(node)));
  assert.ok(current.statements.filter(n => !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)).every(n => expectedNames.has(nameOf(n))), `Extra logic in ${to}`);
  if (to.startsWith('convex/messaging/')) assert.ok(read(to).split('\n').length < 1000, `Oversized ${to}`);
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
    if (file.startsWith('convex/') && !file.startsWith('convex/messaging/') && !file.endsWith('.test.ts') && file !== 'convex/schema.ts' && file !== 'convex/http.ts' && target.startsWith('convex/messaging/')) assert.equal(target, 'convex/messaging/model.ts', `Bypass ${file}:${target}`);
    if (file.startsWith('src/')) assert.ok(!target.startsWith('convex/messaging/'), `Browser settings model/private import ${file}`);
  }
}
for (const node of ast('model.ts', read('convex/messaging/model.ts')).statements) {
  assert.ok(!registration(node), 'No model registrations');
  if (!ts.isExportDeclaration(node)) continue;
  assert.ok(node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause), 'Only explicit model exports');
  const target = resolve('convex/messaging/model.ts', node.moduleSpecifier.text);
  for (const entry of node.exportClause.elements) {
    const implementation = treeFor(target, false).statements.find(n => nameOf(n) === (entry.propertyName?.text ?? entry.name.text));
    assert.ok(implementation && !registration(implementation), `Endpoint or missing implementation exported as ${entry.name.text}`);
  }
}
// Follow value imports/re-exports (erasing TS-only bindings) from the public helper seam.
// No endpoint registration or runtime cycle may be reachable by auth's guest builder.
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
runtimeClosure('convex/messaging/model.ts');
// Actual frontend-shared presence/suggestion/inbox display rules remain pure for 3c.
for (const file of ['convex/lib/chatPresence.ts', 'convex/lib/chatSuggestions.ts', 'convex/lib/inboxTypes.ts']) {
  assert.equal(read(file), old(file), `Shared rules changed ${file}`);
  assert.ok(!/\bctx\b|_generated\/server|messaging\/model/.test(read(file)), `Impure frontend rules ${file}`);
}
const access = tracked().filter(file => file.startsWith('convex/') && file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file)).map(file => inspectConvexAccess(file, read(file)));
const publicInventory = access.reduce((sum, entry) => sum + entry.registrations.length, 0), rawPublic = access.reduce((sum, entry) => sum + entry.violations.length, 0);
assert.equal(publicInventory, 295);
assert.equal(rawPublic, 0);
console.log(JSON.stringify({ base, registrations, retained, helpers, dependencyBindings, otherProductionDeclarations: other, runtimeModelModules: [...runtimeModules], publicInventory, rawPublic, rpc: Object.fromEntries(rpc), declarations: Object.fromEntries(locations) }, null, 2));
