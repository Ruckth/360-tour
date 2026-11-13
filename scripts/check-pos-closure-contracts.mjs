#!/usr/bin/env node
// Independent read-only registration check: no declaration relocation map or codemod normalization.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'a34eb197cc23ac53522440d48784a162256970ab';
const files = ref => execFileSync('git', ref ? ['ls-tree', '-r', '--name-only', ref, 'convex'] : ['ls-files', '--cached', '--others', '--exclude-standard', 'convex'], { encoding: 'utf8' }).trim().split('\n').filter(f => f.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(f));
// Phase 3c replaces only these four audit timestamp expressions with shared/time.
// This option is opt-in; historical default proofs retain their exact token comparison.
const canonicalTime = process.argv.includes('--canonical-time');
const auditFiles = new Set(['addDateBlock', 'addDateBlocks', 'updateDateBlock', 'removeDateBlock'].map(name => `convex/bookings/calendar/${name}.ts`));
let normalizedAuditCalls = 0;
function registrationSource(file, source, ref) {
  if (!canonicalTime || !ref || !auditFiles.has(file)) return source;
  return source.replace(/Date\.parse\(`\$\{([^}]+)\}T00:00:00\+07:00`\)/g, (_, value) => {
    normalizedAuditCalls++;
    return `resortMidnight(${value})`;
  });
}
const read = (file, ref) => ref ? execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8');
function tokens(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source), result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, scanner.getTokenText()]);
  return result;
}
function registrations(ref) {
  const result = new Map();
  for (const file of files(ref)) {
    let source;
    try { source = read(file, ref); } catch (error) { if (!ref && error.code === 'ENOENT') continue; throw error; }
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = new Map();
    for (const node of tree.statements) if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const binding of node.importClause.namedBindings.elements) imports.set(binding.name.text, `${node.moduleSpecifier.text}:${binding.propertyName?.text ?? binding.name.text}`);
    }
    for (const node of tree.statements) if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        const init = declaration.initializer;
        if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) continue;
        const binding = imports.get(init.expression.text);
        if (!binding || !/(?:auth\/model|_generated\/server):(?:[a-zA-Z]*(?:Query|Mutation|Action)|query|mutation|action|httpAction)$/.test(binding)) continue;
        result.set(`${file.slice(7, -3)}:${declaration.name.getText()}`, { builder: binding, tokens: tokens(registrationSource(file, init.getText(), ref)) });
      }
    }
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b));
}
function schedules(ref) {
  const calls = [];
  for (const file of files(ref)) {
    let source;
    try { source = read(file, ref); } catch (error) { if (!ref && error.code === 'ENOENT') continue; throw error; }
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node) {
      if (ts.isCallExpression(node) && /^(?:ctx\.scheduler\.(?:runAfter|runAt)|crons\.(?:cron|interval))$/.test(node.expression.getText())) calls.push({ file, tokens: tokens(node.getText()) });
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return calls.sort((a, b) => a.file.localeCompare(b.file) || JSON.stringify(a.tokens).localeCompare(JSON.stringify(b.tokens)));
}
const before = registrations(base), after = registrations();
if (canonicalTime) assert.equal(normalizedAuditCalls, 4, 'Only the four existing audit timestamp adapters normalize');
assert.deepEqual(after, before, 'Registered builder binding or full initializer tokens changed');
const http = after.filter(([, entry]) => entry.builder.endsWith(':httpAction'));
assert.equal(after.length - http.length, 381);
assert.equal(http.length, 0);
for (const file of ['convex/http.ts', 'convex/messaging/ingress.ts']) assert.deepEqual(tokens(read(file)), tokens(read(file, base)), `HTTP routing/handler source changed: ${file}`);
const schedulerCalls = schedules();
assert.deepEqual(schedulerCalls, schedules(base), 'Scheduler/cron source changed');
assert.equal(schedulerCalls.length, 55);
const specFlag = process.argv.indexOf('--local-spec');
if (specFlag !== -1) {
  const spec = JSON.parse(readFileSync(process.argv[specFlag + 1], 'utf8'));
  const rpc = spec.functions.filter(f => f.functionType !== 'HttpAction');
  assert.deepEqual(rpc.map(f => f.identifier.replace('.js:', ':')).sort(), after.map(([path]) => path).sort());
  for (const [path, entry] of after) {
    const actual = rpc.find(f => f.identifier === path.replace(':', '.js:'));
    assert.equal(actual.visibility.kind, entry.builder.includes(':internal') ? 'internal' : 'public');
    assert.equal(actual.functionType.toLowerCase(), entry.builder.match(/(query|mutation|action)$/i)[1].toLowerCase());
  }
  assert.equal(rpc.filter(f => f.visibility.kind === 'public').length, 295);
  assert.equal(spec.functions.filter(f => f.functionType === 'HttpAction').length, 10);
}
console.log(JSON.stringify({ base, normalizedAuditCalls, localSpec: specFlag !== -1, schedulerCalls: schedulerCalls.length, publicAndInternal: 381, httpSourceFiles: ['convex/http.ts', 'convex/messaging/ingress.ts'], identical: !canonicalTime, contractStable: true, unchangedInitializers: 381 - normalizedAuditCalls, paths: after.map(([key]) => key) }, null, 2));
