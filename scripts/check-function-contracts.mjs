#!/usr/bin/env node
// Independent read-only registration check: no declaration relocation map or codemod normalization.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isConvexEntryFile, importTarget } from './lib/architecture.mjs';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const baseFlag = process.argv.indexOf('--base');
if (baseFlag < 0 || !process.argv[baseFlag + 1] || process.argv[baseFlag + 1].startsWith('--')) throw new Error('Supply --base <reviewed commit>; this compares a specific refactor, not a permanent business snapshot.');
const base = process.argv[baseFlag + 1];
const files = ref => execFileSync('git', ref ? ['ls-tree', '-r', '--name-only', ref, 'convex'] : ['ls-files', '--cached', '--others', '--exclude-standard', 'convex'], { encoding: 'utf8' }).trim().split('\n').filter(isConvexEntryFile);
const sourceCache = new Map();
function read(file, ref) {
  const key = `${ref ?? 'working'}:${file}`;
  if (!sourceCache.has(key)) sourceCache.set(key, ref ? execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }) : readFileSync(file, 'utf8'));
  return sourceCache.get(key);
}
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
    const access = inspectConvexAccess(file, source);
    assert.deepEqual(access.violations, [], `Uninspectable registration: ${file}`);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const imports = new Map();
    for (const node of tree.statements) if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const binding of node.importClause.namedBindings.elements) imports.set(binding.name.text, `${importTarget(file, node.moduleSpecifier.text)}:${binding.propertyName?.text ?? binding.name.text}`);
    }
    const previousSize = result.size;
    let httpInitializers = 0;
    for (const node of tree.statements) if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        const init = declaration.initializer;
        if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression)) continue;
        const binding = imports.get(init.expression.text);
        if (!binding || !/(?:auth\/model|_generated\/server):(?:[a-zA-Z]*(?:Query|Mutation|Action)|query|mutation|action|httpAction)(?:Generic)?$/.test(binding)) continue;
        if (binding.endsWith(':httpAction')) httpInitializers++;
        result.set(`${file.slice(7).replace(/\.(ts|tsx|js|mjs)$/, '')}:${declaration.name.getText()}`, { builder: binding, tokens: tokens(init.getText()) });
      }
    }
    assert.equal(result.size - previousSize, access.endpoints.length + httpInitializers, `Unsupported registration form in ${file}`);
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b));
}
function schedules(ref) {
  const calls = [];
  for (const file of files(ref)) {
    let source;
    try { source = read(file, ref); } catch (error) { if (!ref && error.code === 'ENOENT') continue; throw error; }
    const access = inspectConvexAccess(file, source);
    assert.deepEqual(access.violations, [], `Uninspectable registration: ${file}`);
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
assert.deepEqual(after, before, 'Registered builder binding or full initializer tokens changed');
const http = after.filter(([, entry]) => entry.builder.endsWith(':httpAction'));
assert.ok(after.length > 0, 'No registrations inspected');

for (const file of ['convex/http.ts', 'convex/messaging/ingress.ts']) assert.deepEqual(tokens(read(file)), tokens(read(file, base)), `HTTP routing/handler source changed: ${file}`);
const schedulerCalls = schedules();
assert.deepEqual(schedulerCalls, schedules(base), 'Scheduler/cron source changed');

const specFlag = process.argv.indexOf('--local-spec');
if (specFlag !== -1) {
  const spec = JSON.parse(readFileSync(process.argv[specFlag + 1], 'utf8'));
  const rpc = spec.functions.filter(f => f.functionType !== 'HttpAction');
  const rpcInitializers = after.filter(([, entry]) => !entry.builder.endsWith(':httpAction')); 
  assert.deepEqual(rpc.map(f => f.identifier.replace('.js:', ':')).sort(), rpcInitializers.map(([path]) => path).sort());
  for (const [path, entry] of rpcInitializers) {
    const actual = rpc.find(f => f.identifier === path.replace(':', '.js:'));
    assert.equal(actual.visibility.kind, entry.builder.includes(':internal') ? 'internal' : 'public');
    assert.equal(actual.functionType.toLowerCase(), entry.builder.match(/(query|mutation|action)(?:Generic)?$/i)[1].toLowerCase());
  }
  assert.ok(spec.functions.some(f => f.functionType === 'HttpAction'), 'Local spec must include HTTP actions');
}
console.log(JSON.stringify({ base, localSpec: specFlag !== -1, schedulerCalls: schedulerCalls.length, publicAndInternal: after.length - http.length, httpSourceFiles: ['convex/http.ts', 'convex/messaging/ingress.ts'], identical: true, contractStable: true, unchangedInitializers: after.length, paths: after.map(([key]) => key) }, null, 2));
