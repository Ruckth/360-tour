#!/usr/bin/env node
// Read-only registration-owner audit, including helpers across model/lib imports.
// Typed ID operations supplement literal table names. Dynamic generic IDs are
// recorded as unresolved evidence; this is not a deployed data/queue audit.
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', 'convex'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file.endsWith('.ts') && !file.includes('_generated/') && !file.endsWith('.test.ts'));
const config = ts.readConfigFile(path.join(root, 'convex/tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.join(root, 'convex'));
const program = ts.createProgram(files.map(file => path.join(root, file)).filter(ts.sys.fileExists), parsed.options);
const checker = program.getTypeChecker();
const tables = ['orders','orderLines','orderPayments','orderCorrections','orderAudit','orderCounters','orderLineLinks','orderRefunds','customers','customerMergeJobs','tills','displays','displayDriverLeases','displayPresence','displayPairLinks','staffApprovalRequests'];
const tableSet = new Set(tables);
const declarations = new Map(), symbols = new Map();
const registration = node => ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && /^(?:public|guest|staff|authenticated|device|admin|internal|marketing)(?:Query|Mutation|Action)$/.test(node.initializer.expression.getText());
for (const file of files) {
  const tree = program.getSourceFile(path.join(root, file));
  if (!tree) continue;
  for (const statement of tree.statements) {
    const nodes = ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : ts.isFunctionDeclaration(statement) ? [statement] : [];
    for (const node of nodes) {
      if (!node.name || !ts.isIdentifier(node.name)) continue;
      const key = file.replace(/^convex\//, '').replace(/\.ts$/, '') + ':' + node.name.text;
      const entry = { key, node, tables: new Set(), edges: new Set(), unresolved: new Set(), registration: registration(node) };
      declarations.set(key, entry);
      const symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) symbols.set(symbol, entry);
    }
  }
}
function idTables(type, at) {
  if (type.isUnion()) return type.types.flatMap(t => idTables(t, at));
  const property = type.getProperty('__tableName');
  if (!property) return [];
  const value = checker.getTypeOfSymbolAtLocation(property, at);
  return value.isStringLiteral() ? [value.value] : [];
}
for (const entry of declarations.values()) {
  function visit(node) {
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const dependency = symbols.get(symbol);
      if (dependency && dependency !== entry) entry.edges.add(dependency.key);
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === 'db') {
      const method = node.expression.name.text, arg = node.arguments[0];
      if (arg && ['query','get','insert','patch','replace','delete','normalizeId'].includes(method)) {
        const names = ts.isStringLiteral(arg) ? [arg.text] : idTables(checker.getTypeAtLocation(arg), arg);
        for (const name of names) if (tableSet.has(name)) entry.tables.add(name);
        if (!names.length) entry.unresolved.add(`${method}(${arg.getText()})`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(entry.node);
}
function closure(key, seen = new Set()) {
  if (seen.has(key)) return { tables: new Set(), unresolved: new Set(), helpers: new Set() };
  seen.add(key);
  const entry = declarations.get(key);
  const result = { tables: new Set(entry.tables), unresolved: new Set([...entry.unresolved].map(value => `${key}: ${value}`)), helpers: new Set() };
  for (const edge of entry.edges) {
    const child = closure(edge, seen);
    for (const name of child.tables) result.tables.add(name);
    for (const value of child.unresolved) result.unresolved.add(value);
    result.helpers.add(edge);
    for (const helper of child.helpers) result.helpers.add(helper);
  }
  return result;
}
const owners = [...declarations.values()].filter(entry => entry.registration).map(entry => {
  const result = closure(entry.key);
  return { registration: entry.key, tables: [...result.tables].sort(), unresolved: [...result.unresolved].sort(), helpers: [...result.helpers].sort() };
}).filter(owner => owner.tables.length).sort((a, b) => a.registration.localeCompare(b.registration));
const evidence = { method: 'TypeScript symbol dependency closure and literal/typed-ID database operations. Generic ID operations are listed unresolved; manual ownership review is still required.', tables: Object.fromEntries(tables.map(table => [table, owners.filter(owner => owner.tables.includes(table)).map(owner => owner.registration)])), owners };
const out = path.join(root, 'output/phase3b-pos');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'registration-owner-audit.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(`${tables.length} POS tables; ${owners.length} registrations with statically resolved POS operations.`);
for (const table of tables) console.log(`${table}: ${evidence.tables[table].join(', ')}`);
console.log('Generic-ID operations and dependency trails are retained in registration-owner-audit.json for manual inspection.');

const snapshot = path.join(root, 'docs/architecture/phase3b-pos-registration-owners.json');
const matrix = JSON.stringify({ method: evidence.method, tables: evidence.tables }, null, 2) + '\n';
if (process.argv.includes('--snapshot')) writeFileSync(snapshot, matrix);
if (process.argv.includes('--check-snapshot') && readFileSync(snapshot, 'utf8') !== matrix) throw new Error('POS registration-owner snapshot differs; inspect the audit before updating it');
