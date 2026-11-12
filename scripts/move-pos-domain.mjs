#!/usr/bin/env node
// Explicit POS-only path codemod and fixed dependent-base AST audit.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root = fileURLToPath(new URL('../', import.meta.url));
const base = '77c06d6cb7440899ddb9d0f373994531762ce165';
const modules = ['pos', 'customers', 'displays', 'staffApprovals', 'orderHistoryPages'];
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const historical = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const declaredName = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|staff|authenticated|device|admin|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const sources = Object.fromEntries(modules.map(name => [name, historical(`convex/${name}.ts`)]));
const trees = Object.fromEntries(modules.map(name => [name, ast(name, sources[name])]));
const mapping = new Map();
for (const sourceModule of modules) for (const node of trees[sourceModule].statements.filter(registration)) {
  const fn = declaredName(node);
  let dest = `pos/${sourceModule}`;
  if (sourceModule === 'pos') {
    if (/Query$/.test(node.declarationList.declarations[0].initializer.expression.getText())) {
      dest = ['stableCatalog','recentCatalogRanking','catalog'].includes(fn) ? 'pos/catalog' : ['attachLookupStatus','listAttachable','linkCandidates'].includes(fn) ? 'pos/sourceReads' : 'pos/orders';
    } else dest = `pos/commands/${fn}`;
  }
  mapping.set(`${sourceModule}:${fn}`, `${dest}:${fn}`);
}
function target(sourceModule, fn) { return mapping.get(`${sourceModule}:${fn}`) ?? `pos/${sourceModule === 'pos' ? 'orders' : sourceModule}:${fn}`; }
function rewriteRefs(source) {
  const names = modules.join('|');
  source = source
    .replace(new RegExp(`\\b(api|internal)\\.(${names})\\.([A-Za-z_$][\\w$]*)`, 'g'), (_, access, sourceModule, fn) => `${access}.${target(sourceModule, fn).replaceAll('/', '.').replace(':', '.')}`)
    .replace(new RegExp(`\\b(api|internal)\\[(['"])(${names})\\2\\]\\.([A-Za-z_$][\\w$]*)`, 'g'), (_, access, _q, sourceModule, fn) => `${access}.${target(sourceModule, fn).replaceAll('/', '.').replace(':', '.')}`)
    .replace(new RegExp(`([ '"\x60])(${names}):([A-Za-z_$][\\w$]*)`, 'g'), (_, prefix, sourceModule, fn) => prefix + target(sourceModule, fn));
  for (const name of modules.filter(name => name !== 'pos')) source = source.replace(new RegExp(`\\b(api|internal)\\.${name}\\b`, 'g'), `$1.pos.${name}`);
  return source;
}
function relative(from, to, extension = '') {
  let result = path.posix.relative(path.posix.dirname(from), to.replace(/\.ts$/, ''));
  if (!result.startsWith('.')) result = './' + result;
  return result + extension;
}
function rewriteImports(source, from, destination) {
  return source.replace(/(['"])(\.\.?\/[^'"\n]+)\1/g, (match, quote, specifier) => {
    const extension = /\.(js|ts)$/.exec(specifier)?.[0] ?? '';
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier.replace(/\.(js|ts)$/, ''))) + '.ts';
    const sourceModule = modules.find(name => resolved === `convex/${name}.ts`);
    const to = sourceModule ? 'convex/pos/model.ts' : resolved;
    if (!sourceModule && from === destination) return match;
    return quote + relative(destination, to, extension) + quote;
  }).replaceAll('"convex/displays"', '"convex/pos/model"');
}
// TypeScript's organizeImports removes unused bindings and merges duplicate imports.
function organize(file, source) {
  const host = {
    getScriptFileNames: () => [file], getScriptVersion: () => '0',
    getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined,
    getCurrentDirectory: () => root, getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }),
    getDefaultLibFileName: () => 'lib.d.ts', fileExists: () => false, readFile: () => undefined,
  };
  const service = ts.createLanguageService(host);
  const changes = service.organizeImports({ type: 'file', fileName: file }, { insertSpaceAfterCommaDelimiter: true, indentSize: 2 }, {});
  for (const change of changes.flatMap(c => c.textChanges).sort((a, b) => b.span.start - a.span.start)) source = source.slice(0, change.span.start) + change.newText + source.slice(change.span.start + change.span.length);
  service.dispose();
  for (const node of [...ast(file, source).statements].filter(ts.isImportDeclaration).reverse()) source = source.slice(0, node.getStart()) + node.getText().replace(/\s+/g, ' ') + source.slice(node.end);
  return source;
}

const imports = sourceModule => trees[sourceModule].statements.filter(ts.isImportDeclaration).map(n => n.getText()).join('\n');
const groups = new Map();
const locations = new Map();
function add(dest, sourceModule, node, exported = false) {
  if (!groups.has(dest)) groups.set(dest, { sourceModule, nodes: [], exported });
  groups.get(dest).nodes.push(node);
  locations.set(`${sourceModule}:${declaredName(node)}`, dest);
}
for (const sourceModule of modules) for (const node of trees[sourceModule].statements.filter(n => !ts.isImportDeclaration(n) && n.kind !== ts.SyntaxKind.EndOfFileToken)) {
  if (registration(node)) add(`convex/${mapping.get(`${sourceModule}:${declaredName(node)}`).split(':')[0]}.ts`, sourceModule, node);
  else if (sourceModule === 'pos') {
    const name = declaredName(node);
    const line = trees.pos.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    let group = 'orderModel';
    if (name.startsWith('execute') && name !== 'executeStaffApproval') {
      group = ['executeAmendOrderPayment','executeVoidUnreceivedOrder'].includes(name) ? 'paymentCorrections' : ['executeLinkPaidLine','executeUnlinkPaidLine'].includes(name) ? 'paidLinks' : 'lineCommands';
    } else if (['previewStaffApproval','executeStaffApproval','requireBooking','requireAppointment'].includes(name)) group = 'approvalModel';
    else if (['attachContacts','payableBookingMatches','contactBookings','findSources','openSourceOrder'].includes(name)) group = 'sourceModel';
    else if (['RestoreConflict','restoreConflicts','discardedInfo'].includes(name)) group = 'lifecycleModel';
    else if (['linkableRow','appointmentLinkProblem','bookingLinkProblem','linkReversal'].includes(name)) group = 'paidLinkModel';
    add(`convex/pos/private/${group}.ts`, sourceModule, node, true);
    if (process.argv.includes('--layout')) console.log(group, line, name);
  } else if (sourceModule === 'customers') add('convex/pos/private/customerModel.ts', sourceModule, node, true);
  else if (sourceModule === 'displays') add('convex/pos/private/displayModel.ts', sourceModule, node, true);
  else add(`convex/pos/${sourceModule}.ts`, sourceModule, node);
}
const exportedNames = [...locations].filter(([, dest]) => dest.includes('/private/')).map(([key, dest]) => ({ sourceModule: key.split(':')[0], name: key.split(':')[1], dest }));
const generated = new Set(groups.keys());
if (!process.argv.includes('--check')) {
  if (!process.argv.includes('--rebuild-modules')) for (const sourceModule of modules) assert.equal(read(`convex/${sourceModule}.ts`), sources[sourceModule]);
  for (const [dest, { sourceModule, nodes, exported }] of groups) {
    const origin = `convex/${sourceModule}.ts`;
    const owned = new Set(nodes.map(declaredName));
    let source = rewriteImports(imports(sourceModule), origin, dest);
    // Replace source-sourceModule imports with their actual private implementations inside POS.
    source = source.replace(/import \{([^}]+)\} from ['"][^'"]*model['"];?/g, (match, bindings) => {
      const names = bindings.split(',').map(n => n.trim());
      if (!names.every(n => exportedNames.some(e => e.name === n.replace(/^type /, '')))) return match;
      return names.map(n => { const entry = exportedNames.find(e => e.name === n.replace(/^type /, '')); return `import { ${n} } from '${relative(dest, entry.dest)}';`; }).join('\n');
    });
    for (const entry of exportedNames.filter(entry => entry.sourceModule === sourceModule && entry.dest !== dest && !owned.has(entry.name))) source += `\nimport { ${entry.name} } from '${relative(dest, entry.dest)}';`;
    source += '\n\n' + nodes.map(node => {
      const full = node.getFullText().trim();
      return exported && !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? node.getFullText().slice(0, node.getStart() - node.getFullStart()).trimStart() + 'export ' + node.getText() : full;
    }).join('\n\n') + '\n';
    write(dest, organize(dest, rewriteRefs(source)));
  }
  // One cross-domain seam, composed from real private implementations; no endpoint re-exports.
  const publicHelpers = exportedNames.filter(entry => trees[entry.sourceModule].statements.some(node => declaredName(node) === entry.name && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)));
  const typeNames = new Set(publicHelpers.filter(entry => trees[entry.sourceModule].statements.some(node => declaredName(node) === entry.name && (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)))).map(entry => entry.name));
  const byModule = new Map();
  for (const entry of publicHelpers) { if (!byModule.has(entry.dest)) byModule.set(entry.dest, []); byModule.get(entry.dest).push(entry.name); }
  write('convex/pos/model.ts', '// POS model interface. Implementations stay private; endpoints are never re-exported.\n' + [...byModule].map(([dest, names]) => `export { ${names.map(name => typeNames.has(name) ? 'type ' + name : name).join(', ')} } from '${relative('convex/pos/model.ts', dest)}';`).join('\n') + '\n');
  for (const sourceModule of modules) if (existsSync(path.join(root, `convex/${sourceModule}.ts`))) unlinkSync(path.join(root, `convex/${sourceModule}.ts`));
  let changed = 0;
  for (const file of process.argv.includes('--rebuild-modules') ? [] : tracked()) {
    if (!/\.(ts|tsx|mjs|js|md|html|json|jsonc)$/.test(file) || generated.has(file) || file === 'convex/pos/model.ts' || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    const before = read(file);
    let source = rewriteRefs(before);
    if (file === 'docs/architecture/phase3a-access-inventory.md') for (const [old, next] of mapping) source = source.replaceAll('`' + old.replace(':', '.') + '`', '`' + next.replace(':', '.') + '`');
    if (/\.(ts|tsx|mjs|js)$/.test(file)) source = rewriteImports(source, file, file);
    if (file === 'src/components/checkout/backend.tsx') source = source.replace('type Pos = typeof api.pos;', 'type PosCommands = typeof api.pos.commands;\n' + 'type Pos = typeof api.pos.orders & typeof api.pos.catalog & typeof api.pos.sourceReads & { [K in keyof PosCommands]: PosCommands[K][K & keyof PosCommands[K]] };');
    if (file === 'convex/staffRoles.test.ts') source = source.replaceAll('api.pos[endpoint]', "({ openOrderFor: api.pos.commands.openOrderFor.openOrderFor, openOrderForLink: api.pos.commands.openOrderForLink.openOrderForLink })[endpoint]");
    if (file === 'convex/posReadReuse.test.ts') source = source.replace("from './pos/model'", "from './pos/orders'").replace("import { getOrder, stableCatalog, recentCatalogRanking, catalog } from './pos/orders';", "import { getOrder } from './pos/orders';\nimport { stableCatalog, recentCatalogRanking, catalog } from './pos/catalog';");
    if (source !== before) { write(file, source); changed++; }
  }
  console.log(`Moved ${mapping.size} registrations; rewrote ${changed} callers/imports/inventory files.`);
}
const printer = ts.createPrinter({ removeComments: true });
const normalized = node => printer.printNode(ts.EmitHint.Unspecified, node, node.getSourceFile()).replace(/^export /, '');
function builderBinding(file, tree, declaration) {
  const builder = declaration.declarationList.declarations[0].initializer.expression.getText();
  for (const node of tree.statements.filter(ts.isImportDeclaration)) {
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const binding = bindings.elements.find(element => element.name.text === builder);
    if (binding) {
      const builderModule = node.moduleSpecifier.text;
      const resolved = builderModule.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), builderModule)).replace(/\.(ts|js)$/, '') : builderModule;
      return `${resolved}:${binding.propertyName?.text ?? binding.name.text}`;
    }
  }
  throw new Error(`Unresolved registration builder: ${file}:${builder}`);
}

// Resolve every retained import binding back to its original declaration, so
// equal helper text cannot mask an accidental dependency substitution.
const reverseLocations = new Map([...locations].map(([key, file]) => [`${file.replace(/\.ts$/, '')}:${key.split(':')[1]}`, `convex/${key}`]));
function bindings(file, tree) {
  const result = new Map();
  for (const node of tree.statements.filter(ts.isImportDeclaration)) {
    const specifier = node.moduleSpecifier.text;
    const resolved = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)).replace(/\.(ts|js)$/, '') : specifier;
    const names = node.importClause?.namedBindings;
    if (names && ts.isNamedImports(names)) for (const binding of names.elements) {
      const name = binding.propertyName?.text ?? binding.name.text;
      result.set(binding.name.text, reverseLocations.get(`${resolved}:${name}`) ?? `${resolved}:${name}`);
    }
    if (node.importClause?.name) result.set(node.importClause.name.text, `${resolved}:default`);
  }
  for (const node of tree.statements.filter(n => !ts.isImportDeclaration(n))) {
    const name = declaredName(node);
    if (name) result.set(name, reverseLocations.get(`${file.replace(/\.ts$/, '')}:${name}`) ?? `${file.replace(/\.ts$/, '')}:${name}`);
  }
  return result;
}
for (const [dest, { sourceModule }] of groups) {
  const before = bindings(`convex/${sourceModule}.ts`, trees[sourceModule]);
  const after = bindings(dest, ast(dest, read(dest)));
  for (const [name, dependency] of after) if (before.has(name)) assert.equal(dependency, before.get(name), `Dependency binding changed ${dest}:${name}`);
}
let count = 0, helpers = 0;
for (const [dest, { sourceModule, nodes }] of groups) {
  const tree = ast(dest, read(dest));
  assert.equal(tree.statements.filter(n => !ts.isImportDeclaration(n)).length, nodes.length, `Unexpected declarations ${dest}`);
  assert.ok(read(dest).split('\n').length < 1000, `Oversized moved file ${dest}`);
  for (const before of nodes) {
    const name = declaredName(before);
    const current = tree.statements.find(n => declaredName(n) === name);
    assert.ok(current, `Missing ${sourceModule}:${name}`);
    const expected = ast('expected.ts', rewriteRefs(rewriteImports(before.getText(), `convex/${sourceModule}.ts`, dest))).statements[0];
    assert.equal(normalized(current), normalized(expected), `Logic changed ${sourceModule}:${name}`);
    if (registration(before)) {
      assert.ok(registration(current));
      assert.equal(builderBinding(dest, tree, current), builderBinding(`convex/${sourceModule}.ts`, trees[sourceModule], before), `Builder changed ${sourceModule}:${name}`);
      count++;
    } else helpers++;
  }
  if (dest.includes('/commands/')) assert.equal(tree.statements.filter(registration).length, 1);
}
const production = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'convex'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file) && !modules.some(name => file === `convex/${name}.ts`));
let unchanged = 0;
for (const file of production) {
  const before = ast(file, historical(file)).statements.filter(n => !ts.isImportDeclaration(n));
  const after = ast(file, read(file)).statements.filter(n => !ts.isImportDeclaration(n));
  assert.equal(after.length, before.length, `Declaration count changed ${file}`);
  for (let i = 0; i < before.length; i++) {
    assert.equal(normalized(after[i]), normalized(ast('expected.ts', rewriteRefs(rewriteImports(before[i].getText(), file, file))).statements[0]), `Other logic changed ${file}:${declaredName(before[i]) ?? i}`);
    unchanged++;
  }
}
for (const sourceModule of modules) assert.ok(!existsSync(path.join(root, `convex/${sourceModule}.ts`)), `Old endpoint ${sourceModule}`);
// Reject old registered references (without confusing api.pos.orders with the old api.pos).
for (const file of tracked()) {
  if (file.startsWith('docs/') || file.startsWith('scripts/move-') || file.startsWith('convex/_generated/') || !/\.(ts|tsx|mjs|js|json|jsonc)$/.test(file)) continue;
  const source = read(file);
  for (const [old] of mapping) {
    const [sourceModule, fn] = old.split(':');
    // pos/catalog is now a namespace and shares the old catalog function's spelling.
    const isNewNamespace = [...mapping.values()].some(value => value.split(':')[0] === `${sourceModule}/${fn}`);
    if (!isNewNamespace) assert.ok(!new RegExp(`\\b(?:api|internal)\\.${sourceModule}\\.${fn}\\b(?!\\s*\\.)`).test(source), `Old API ${old} in ${file}`);
    assert.ok(!source.includes(`"${old}"`) && !source.includes(`'${old}'`), `Old RPC ${old} in ${file}`);
  }
  for (const node of ast(file, source).statements.filter(ts.isImportDeclaration)) {
    const specifier = node.moduleSpecifier.text;
    const resolved = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.replace(/\.(js|ts)$/, ''))) : specifier;
    assert.ok(!modules.some(name => resolved === `convex/${name}`), `Old import ${file}:${specifier}`);
    if (file.startsWith('convex/') && file !== 'convex/schema.ts' && !file.startsWith('convex/pos/') && !file.endsWith('.test.ts') && resolved.startsWith('convex/pos/')) assert.equal(resolved, 'convex/pos/model', `Private POS import ${file}:${specifier}`);
  }
}
assert.equal(ast('model.ts', read('convex/pos/model.ts')).statements.filter(registration).length, 0);
const actualRegistrations = tracked().filter(file => file.startsWith('convex/pos/') && file.endsWith('.ts') && !file.endsWith('.test.ts')).reduce((sum, file) => sum + ast(file, read(file)).statements.filter(registration).length, 0);
assert.equal(actualRegistrations, mapping.size, 'Unexpected POS registration outside the mapped modules');
for (const node of ast('model.ts', read('convex/pos/model.ts')).statements.filter(ts.isExportDeclaration)) assert.ok(node.moduleSpecifier?.text.startsWith('./private/'), 'Model may export only private implementations');
console.log(`All ${count} registrations and resolved builders, ${helpers} helper/private declarations match ${base}; ${unchanged} other production declarations unchanged.`);
if (process.argv.includes('--mapping')) for (const [old, next] of mapping) console.log(`| \`${old}\` | \`${next}\` |`);
