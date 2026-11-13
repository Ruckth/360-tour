#!/usr/bin/env node
// Independent read-only registration check: no declaration relocation map or codemod normalization.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const base = 'a34eb197cc23ac53522440d48784a162256970ab';
const files = ref => execFileSync('git', ref ? ['ls-tree', '-r', '--name-only', ref, 'convex'] : ['ls-files', '--cached', '--others', '--exclude-standard', 'convex'], { encoding: 'utf8' }).trim().split('\n').filter(f => f.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(f));
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
        result.set(`${file.slice(7, -3)}:${declaration.name.getText()}`, { builder: binding, tokens: tokens(init.getText()) });
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
assert.deepEqual(after, before, 'Registered builder binding or full initializer tokens changed');
const http = after.filter(([, entry]) => entry.builder.endsWith(':httpAction'));
assert.equal(after.length - http.length, 381);
assert.equal(http.length, 0);
for (const file of ['convex/http.ts', 'convex/messaging/ingress.ts']) assert.deepEqual(tokens(read(file)), tokens(read(file, base)), `HTTP routing/handler source changed: ${file}`);
const schedulerCalls = schedules();
assert.deepEqual(schedulerCalls, schedules(base), 'Scheduler/cron source changed');
assert.equal(schedulerCalls.length, 55);
console.log(JSON.stringify({ base, schedulerCalls: schedulerCalls.length, publicAndInternal: 381, httpSourceFiles: ['convex/http.ts', 'convex/messaging/ingress.ts'], identical: true, paths: after.map(([key]) => key) }, null, 2));
