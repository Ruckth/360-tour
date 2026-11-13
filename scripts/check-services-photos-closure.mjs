#!/usr/bin/env node
// Read-only exact-parent proof. Only the helper move and four caller import-path substitutions are allowed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const base = '39204f7a66e4ed91a076f4c6604ea0ccafc3fd63';
const old = 'convex/lib/adminPhotos.ts', moved = 'convex/services/private/photos.ts';
const callers = new Map([
  ['convex/services/commands/updateStaff.ts', '../private/photos'],
  ['convex/services/commands/updateService.ts', '../private/photos'],
  ['convex/services/commands/discardStaffAvatarUpload.ts', '../private/photos'],
  ['convex/services/private/administration.ts', './photos'],
]);
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const readBase = file => execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' });
const production = file => /^(convex|src)\//.test(file) && /\.[cm]?[jt]sx?$/.test(file) && !/\.test\.ts$|\/_generated\//.test(file);
const before = git(['ls-tree', '-r', '--name-only', base]).split('\n').filter(production).sort();
const after = git(['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(production).filter(existsSync).sort();
assert.deepEqual(after, before.map(file => file === old ? moved : file).sort());
assert.equal(existsSync(old), false, 'No forwarding stub');
let publicFunctions = 0, registrations = 0, schedules = 0;
const identifiers = [];
for (const file of before) {
  const target = file === old ? moved : file;
  let source = readFileSync(target, 'utf8');
  // Compare whole source (including comments/types), not just function bodies.
  if (file === old) source = source.replaceAll("'../../_generated/", "'../_generated/");
  if (callers.has(file)) source = source.replace(`'${callers.get(file)}'`, "'../../lib/adminPhotos'");
  assert.equal(source, readBase(file), `Source or dependency binding changed: ${file}`);
  if (!file.startsWith('convex/')) continue;
  const access = inspectConvexAccess(file, source);
  assert.deepEqual(access.violations, []);
  publicFunctions += access.registrations.length;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(tree);
      if (/^(?:public|guest|staff|authenticated|device|admin|marketing|internal)(?:Query|Mutation|Action)$/.test(name)) {
        registrations++;
        assert(ts.isVariableDeclaration(node.parent));
        identifiers.push(`${file.slice(7, -3)}.js:${node.parent.name.getText(tree)}`);
      }
      if (/^(?:ctx\.scheduler\.(?:runAfter|runAt)|crons\.(?:cron|interval))$/.test(name)) schedules++;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
for (const file of ['package.json', 'pnpm-lock.yaml', '.arch-phase', 'convex/_generated/server.d.ts', 'convex/_generated/dataModel.d.ts']) assert.equal(readFileSync(file, 'utf8'), readBase(file), file);
assert.equal(publicFunctions, 295);
assert.equal(registrations, 381);
assert.equal(schedules, 55);
const helperNames = ['pendingAvatarUpload', 'deleteStoredFile', 'attachPhotoUpload', 'deleteUnreferencedPhoto'];
const helper = ts.createSourceFile(moved, readFileSync(moved, 'utf8'), ts.ScriptTarget.Latest, true);
assert.deepEqual(helper.statements.filter(node => !ts.isImportDeclaration(node)).map(node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText(helper) : node.name.text), helperNames);
assert(!helperNames.some(name => new RegExp(`\\b${name}\\b`).test(readFileSync('convex/services/model.ts', 'utf8'))), 'No unused model exports');
let localMetadata;
if (process.argv[2]) {
  const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  assert.equal(spec.url, 'http://127.0.0.1:3530', 'Only the checkout-local anonymous backend');
  const rpc = spec.functions.filter(f => f.functionType !== 'HttpAction');
  assert.deepEqual(rpc.map(f => f.identifier).sort(), identifiers.sort());
  assert.equal(rpc.filter(f => f.visibility.kind === 'public').length, 295);
  assert.equal(spec.functions.filter(f => f.functionType === 'HttpAction').length, 10);
  localMetadata = { rpc: rpc.length, http: 10, public: 295 };
}
console.log(JSON.stringify({ base, exactSourceFiles: before.length, helpers: helperNames, callers: Object.fromEntries(callers), publicFunctions, raw: 0, registrations, schedules, localMetadata, http: 'Full routing and ingress sources identical; CLI metadata checked separately', identical: true }, null, 2));
