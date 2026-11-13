#!/usr/bin/env node
// Read-only exact-parent proof: whole declarations and dependency bindings, not a body hash.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import ts from 'typescript';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const base = '2f438327b881132503d1231fb65b6c83e3584ceb';
const modules = ['seed', 'aiEval', 'chatEval'];
const fixtures = ['aiEvalData', 'properties', 'reviews', 'rooms', 'staffServices', 'tourSnippets'];
const moves = new Map([
  ...modules.map(name => [`convex/${name}.ts`, `convex/maintenance/${name}.ts`]),
  ...fixtures.map(name => [`convex/seeds/${name}.ts`, `convex/maintenance/seeds/${name}.ts`]),
]);
const mapping = {
  'seed:seedAll': 'maintenance/seed:seedAll',
  'aiEval:seed': 'maintenance/aiEval:seed',
  'aiEval:cancelTestBookings': 'maintenance/aiEval:cancelTestBookings',
  'aiEval:cleanup': 'maintenance/aiEval:cleanup',
  'chatEval:createSession': 'maintenance/chatEval:createSession',
  'chatEval:writeMessage': 'maintenance/chatEval:writeMessage',
  'chatEval:comparisonTurn': 'maintenance/chatEval:comparisonTurn',
  'chatEval:messagingTurn': 'maintenance/chatEval:messagingTurn',
};
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const readBase = file => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
const production = file => /^(convex|src)\//.test(file) && /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.ts$|\/_generated\//.test(file);
const before = git(['ls-tree', '-r', '--name-only', base]).split('\n').filter(production).sort();
const after = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(production).filter(existsSync).sort();
assert.deepEqual(after, before.map(file => moves.get(file) ?? file).sort());
for (const old of moves.keys()) assert(!existsSync(old), `No retired module/forwarding stub: ${old}`);
const identifiers = [], moved = [];
let publicFunctions = 0, registrations = 0, schedules = 0;
for (const file of before) {
  const target = moves.get(file) ?? file;
  const original = readBase(file);
  let expected = original;
  if (moves.has(file) || file === 'convex/maintenance/scenarios.ts') {
    expected = expected.replace(/(from\s*['"])([^'"]+)(['"])/g, (whole, prefix, spec, suffix) => {
      if (!spec.startsWith('.')) return whole;
      const oldTarget = posix.normalize(posix.join(posix.dirname(file), spec)) + '.ts';
      let relocated = posix.relative(posix.dirname(target), (moves.get(oldTarget) ?? oldTarget).slice(0, -3));
      if (!relocated.startsWith('.')) relocated = './' + relocated;
      return prefix + relocated + suffix;
    });
    expected = expected.replaceAll('internal.chatEval.', 'internal.maintenance.chatEval.');
    for (const name of modules) expected = expected.replaceAll(`${name}:`, `maintenance/${name}:`);
  }
  assert.equal(readFileSync(target, 'utf8'), expected, `Source/dependency binding changed: ${file}`);
  if (!file.startsWith('convex/')) continue;
  const access = inspectConvexAccess(file, original);
  assert.deepEqual(access.violations, []);
  publicFunctions += access.registrations.length;
  const tree = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const builder = node.expression.getText(tree);
      if (/^(?:public|guest|staff|authenticated|device|admin|marketing|internal)(?:Query|Mutation|Action)$/.test(builder)) {
        registrations++;
        assert(ts.isVariableDeclaration(node.parent));
        const name = node.parent.name.getText(tree);
        const oldPath = `${file.slice(7, -3)}:${name}`;
        const newPath = `${target.slice(7, -3)}:${name}`;
        identifiers.push(newPath.replace(':', '.js:'));
        if (oldPath !== newPath) {
          assert.equal(mapping[oldPath], newPath);
          assert(builder.startsWith('internal'));
          const binding = tree.statements.find(statement => ts.isImportDeclaration(statement)
            && statement.moduleSpecifier.text === './_generated/server'
            && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
            && statement.importClause.namedBindings.elements.some(entry => entry.name.text === builder && !entry.propertyName));
          assert(binding, `Original builder binding: ${oldPath}`);
          moved.push(oldPath);
        }
      }
      if (/^(?:ctx\.scheduler\.(?:runAfter|runAt)|crons\.(?:cron|interval))$/.test(builder)) schedules++;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
assert.deepEqual(moved.sort(), Object.keys(mapping).sort());
assert.equal(registrations, 381); assert.equal(publicFunctions, 295); assert.equal(schedules, 55);
for (const file of ['pnpm-lock.yaml', '.arch-phase', 'convex/_generated/server.d.ts', 'convex/_generated/dataModel.d.ts']) assert.equal(readFileSync(file, 'utf8'), readBase(file), file);
assert.equal(readFileSync('.arch-phase', 'utf8').trim(), '2');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')), oldPkg = JSON.parse(readBase('package.json'));
oldPkg.scripts.seed = 'npx convex run maintenance/seed:seedAll';
assert.deepEqual(pkg, oldPkg);
// Current executable consumers retain model flags, traces and SATANG/BPS math exactly.
for (const file of ['scripts/ai-accuracy-eval.mjs', 'scripts/ai-booking-eval.ts', 'scripts/ai-demo/record-messaging.ts']) {
  assert.equal(readFileSync(file, 'utf8'), readBase(file).replaceAll('chatEval:', 'maintenance/chatEval:'));
}
// Existing test assertions and historical archive budgets may only change caller paths.
const callerTests = ['chatAdmission', 'concierge/prompt', 'maintenanceGate', 'messaging/reliability', 'messaging/toolRecovery', 'orderStableRecheck', 'phase0Security', 'phase1Architecture'];
for (const file of [...callerTests.map(name => `convex/${name}.test.ts`), 'tests/unit/convex-schema-tools.test.ts']) {
  let expected = readBase(file);
  for (const name of modules) expected = expected.replaceAll(`internal.${name}.`, `internal.maintenance.${name}.`);
  expected = expected.replaceAll("from './chatEval'", "from './maintenance/chatEval'").replaceAll("from './seeds/", "from './maintenance/seeds/");
  assert.equal(readFileSync(file, 'utf8'), expected, `Existing assertions/budgets changed: ${file}`);
}
// Codegen's module bindings must be exactly the old API with the nine real module moves.
function apiBindings(source) {
  const tree = ts.createSourceFile('api.d.ts', source, ts.ScriptTarget.Latest, true);
  return tree.statements.filter(ts.isImportDeclaration).map(node => {
    const spec = node.moduleSpecifier.text;
    const file = 'convex/' + spec.slice(3).replace(/\.js$/, '.ts');
    return moves.get(file) ?? file;
  }).sort();
}
assert.deepEqual(apiBindings(readFileSync('convex/_generated/api.d.ts', 'utf8')), apiBindings(readBase('convex/_generated/api.d.ts')));
let localMetadata;
if (process.argv[2]) {
  const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  assert.equal(spec.url, 'http://127.0.0.1:3540', 'Only the new checkout-local anonymous backend');
  const rpc = spec.functions.filter(f => f.functionType !== 'HttpAction');
  assert.deepEqual(rpc.map(f => f.identifier).sort(), identifiers.sort());
  for (const path of Object.values(mapping)) assert.equal(rpc.find(f => f.identifier === path.replace(':', '.js:'))?.visibility.kind, 'internal');
  assert.equal(rpc.filter(f => f.visibility.kind === 'public').length, 295);
  assert.equal(spec.functions.filter(f => f.functionType === 'HttpAction').length, 10);
  localMetadata = { rpc: rpc.length, internalMoved: 8, otherRpc: 373, public: 295, http: 10 };
}
console.log(JSON.stringify({ base, exactSourceFiles: before.length, mapping, registrations, otherRpc: 373, publicFunctions, raw: 0, schedules, localMetadata, identicalExceptPaths: true }, null, 2));
