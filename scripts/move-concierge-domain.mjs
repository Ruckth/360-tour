#!/usr/bin/env node
// Concierge-only fixed-base codemod. --check is read-only and repeatable.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { inspectConvexAccess } from './lib/convex-access.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = '68c1d799545b89152fb144d8aa58d995baeed8c0';
const read = file => readFileSync(path.join(root, file), 'utf8');
const write = (file, source) => { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), source); };
const old = file => execFileSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8' });
const tracked = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
const ast = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const nameOf = node => ts.isVariableStatement(node) ? node.declarationList.declarations[0].name.getText() : node.name?.text;
const registration = node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.initializer && ts.isCallExpression(d.initializer) && /^(?:public|staff|authenticated|device|admin|internal)(?:Query|Mutation|Action)$/.test(d.initializer.expression.getText()));
const whole = {
  'convex/businessFacts.ts': 'convex/concierge/businessFacts.ts',
  'convex/lib/chatLlm.ts': 'convex/concierge/llm.ts',
  'convex/lib/chatToolPresentation.ts': 'convex/concierge/tools/presentation.ts',
  'convex/lib/conciergeTurn.ts': 'convex/concierge/turn.ts',
  'convex/lib/conciergeReplyOutcome.ts': 'convex/concierge/outcome.ts',
  'convex/lib/turnMetrics.ts': 'convex/concierge/metrics.ts',
  'convex/lib/knowledgeGrouping.ts': 'convex/concierge/knowledgeGrouping.ts',
};
const split = ['convex/chatAi.ts', 'convex/chatKnowledge.ts', 'convex/lib/chatTools.ts'];
const origins = [...Object.keys(whole), ...split];
const trees = new Map(origins.map(file => [file, ast(file, old(file))]));
const groups = new Map();
const locations = new Map();
function add(from, node, to, exported = false) {
  if (!groups.has(to)) groups.set(to, { from, entries: [] });
  groups.get(to).entries.push({ node, exported });
  if (nameOf(node)) locations.set(`${from}:${nameOf(node)}`, to);
}
for (const [from, to] of Object.entries(whole)) for (const node of trees.get(from).statements.filter(n => !ts.isImportDeclaration(n))) add(from, node, to);
for (const node of trees.get('convex/chatAi.ts').statements.filter(n => !ts.isImportDeclaration(n))) {
  if (ts.isExportDeclaration(node)) continue; // Plain copy/prompt exports are exposed through model.
  add('convex/chatAi.ts', node, nameOf(node) === 'consumeChatLimit' ? 'convex/chatAi.ts' : 'convex/concierge/generation.ts');
}
const handoff = new Set(['word', 'STAFF_VERBS', 'STAFF_PEOPLE', 'STAFF_ALONE', 'STAFF_REQUEST', 'asksForStaff', 'claimStaffAlertSlot', 'queueStaffAlert', 'alertStaffForHandoff']);
for (const node of trees.get('convex/chatKnowledge.ts').statements.filter(n => !ts.isImportDeclaration(n))) add('convex/chatKnowledge.ts', node, handoff.has(nameOf(node)) ? 'convex/chatKnowledge.ts' : 'convex/concierge/knowledge.ts');
const toolsTree = trees.get('convex/lib/chatTools.ts');
for (const node of toolsTree.statements.filter(n => !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n))) {
  const name = nameOf(node);
  if (name === 'executeValidatedTool') continue;
  const to = ['TOOLS', 'BOOKING_TOOLS'].includes(name) ? 'metadata' : ['ToolArgs', 'ToolContext'].includes(name) ? 'types' : ['toolDefinitions', 'validateToolArgs', 'toolError'].includes(name) ? 'validation' : ['findProperty', 'ownerOtaQuotes'].includes(name) ? 'property' : 'dispatcher';
  add('convex/lib/chatTools.ts', node, `convex/concierge/tools/${to}.ts`, name === 'ToolArgs');
}
const rpc = new Map();
for (const [to, { from, entries }] of groups) for (const { node } of entries.filter(e => registration(e.node))) rpc.set(`${from.slice(7, -3)}:${nameOf(node)}`, `${to.slice(7, -3)}:${nameOf(node)}`);
function refs(source) {
  for (const [before, after] of rpc) {
    if (before === after) continue;
    const [mod, fn] = before.split(':');
    const [next, nextFn] = after.split(':');
    source = source.replaceAll(`api.${mod}.${fn}`, `api.${next.replaceAll('/', '.')}.${nextFn}`).replaceAll(`internal.${mod}.${fn}`, `internal.${next.replaceAll('/', '.')}.${nextFn}`)
      .replaceAll(`api['${mod}'].${fn}`, `api.${next.replaceAll('/', '.')}.${nextFn}`).replaceAll(`internal['${mod}'].${fn}`, `internal.${next.replaceAll('/', '.')}.${nextFn}`)
      .replaceAll(`api["${mod}"].${fn}`, `api.${next.replaceAll('/', '.')}.${nextFn}`).replaceAll(`internal["${mod}"].${fn}`, `internal.${next.replaceAll('/', '.')}.${nextFn}`)
      .replaceAll(before, after).replaceAll('`' + before.replace(':', '.') + '`', '`' + after.replace(':', '.') + '`');
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
function imports(source, from, to) {
  return source.replace(/\b(import|export)(\s+(?:type\s+)?\{[^}]+\}\s+from\s+|\s*\(\s*)(['"])([^'"\n]+)\3/g, (match, keyword, middle, quote, spec) => {
    if (!spec.startsWith('.') && !spec.startsWith('convex/')) return match;
    let target = resolve(from, spec);
    const originalTarget = target;
    if (target === 'convex/lib/chatTools.ts' && to.startsWith('convex/concierge/') && keyword === 'import' && middle.trim().startsWith('{')) {
      return middle.slice(middle.indexOf('{') + 1, middle.indexOf('}')).split(',').map(binding => {
        const name = binding.trim().replace(/^type /, '');
        const destination = locations.get(`convex/lib/chatTools.ts:${name}`);
        assert.ok(destination, `Missing tool binding ${name}`);
        return `import { ${binding.trim()} } from '${relative(to, destination)}';`;
      }).join('\n');
    }
    const mapped = whole[target] ?? (target === 'convex/lib/chatTools.ts' ? 'convex/concierge/model.ts' : target === 'convex/lib/conciergePolicy.ts' ? 'convex/concierge/copy.ts' : undefined);
    if (target === 'convex/chatAi.ts' && !/\bconsumeChatLimit\b/.test(middle)) target = 'convex/concierge/model.ts';
    else if (target === 'convex/chatKnowledge.ts' && /\brecordUnknownQuestion\b/.test(middle)) target = 'convex/concierge/knowledge.ts';
    else target = mapped ?? target;
    // Existing private copy imports and new plain engine dependencies use the model seam
    // outside concierge; browser imports retain their pure copy implementation for 3c.
    if (to.startsWith('convex/') && to !== 'convex/schema.ts' && !to.startsWith('convex/concierge/') && !to.endsWith('.test.ts') && !to.startsWith('convex/lib/') && target.startsWith('convex/concierge/')) target = 'convex/concierge/model.ts';
    if (to.startsWith('convex/concierge/') && target === 'convex/messaging/claims.ts') target = 'convex/messaging/model.ts';
    if (from === to && target === originalTarget) return match;
    if (spec.startsWith('convex/')) return keyword + middle + quote + target.replace(/\.ts$/, '') + quote;
    return keyword + middle + quote + relative(to, target) + quote;
  });
}
function organize(file, source) {
  const host = { getScriptFileNames: () => [file], getScriptVersion: () => '0', getScriptSnapshot: name => name === file ? ts.ScriptSnapshot.fromString(source) : undefined, getCurrentDirectory: () => root, getCompilationSettings: () => ({ target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }), getDefaultLibFileName: () => 'lib.d.ts', fileExists: () => false, readFile: () => undefined };
  const service = ts.createLanguageService(host);
  for (const change of service.organizeImports({ type: 'file', fileName: file }, { indentSize: 2, insertSpaceAfterCommaDelimiter: true }, {}).flatMap(c => c.textChanges).sort((a, b) => b.span.start - a.span.start)) source = source.slice(0, change.span.start) + change.newText + source.slice(change.span.start + change.span.length);
  service.dispose();
  for (const node of [...ast(file, source).statements].filter(ts.isImportDeclaration).reverse()) source = source.slice(0, node.getStart()) + node.getText().replace(/\s+/g, ' ') + source.slice(node.end);
  return source;
}
const toolFunction = toolsTree.statements.find(n => nameOf(n) === 'executeValidatedTool');
const cases = toolFunction.body.statements.find(ts.isSwitchStatement).caseBlock.clauses.filter(ts.isCaseClause);
const toolLocations = new Map(cases.map(node => [node.expression.text, ['list_services', 'check_service_availability', 'prepare_service_booking', 'confirm_service_booking'].includes(node.expression.text) ? 'service' : ['check_availability', 'calculate_price', 'get_property_details', 'list_properties'].includes(node.expression.text) ? 'property' : 'booking']));
const methodName = name => name.replaceAll(/_([a-z])/g, (_, c) => c.toUpperCase());
const toolFiles = new Set(['convex/concierge/tools/facts.ts']);
for (const owner of toolLocations.values()) toolFiles.add(`convex/concierge/tools/${owner}.ts`);
const toolSignature = '(ctx: ActionCtx, fnName: string, fnArgs: ToolArgs, properties: Doc<\'properties\'>[], toolContext: ToolContext): Promise<string>';
const toolBodies = new Map();
for (const clause of cases) {
  const statements = clause.statements.length === 1 && ts.isBlock(clause.statements[0]) ? clause.statements[0].statements : clause.statements;
  toolBodies.set(clause.expression.text, statements.map(n => n.getFullText()).join('').trim());
}
toolBodies.set('search_business_facts', toolFunction.body.statements[0].thenStatement.statements.map(n => n.getFullText()).join('').trim());
const toolImports = to => imports(toolsTree.statements.filter(ts.isImportDeclaration).map(n => n.getText()).join('\n'), 'convex/lib/chatTools.ts', to) + `\nimport type { ToolArgs, ToolContext } from './types';\n`;
if (!process.argv.includes('--check')) {
  for (const from of origins) assert.equal(read(from), old(from), `Codemod requires unchanged base source ${from}`);
  for (const [to, { from, entries }] of groups) {
    let source = imports(trees.get(from).statements.filter(ts.isImportDeclaration).map(n => n.getText()).join('\n'), from, to);
    if (to === 'convex/concierge/knowledge.ts') source += "\nimport { queueStaffAlert } from '../messaging/model';";
    if (from === 'convex/lib/chatTools.ts') {
      for (const [key, destination] of locations) if (key.startsWith(from + ':') && destination !== to) source += `\nimport { ${key.slice(from.length + 1)} } from '${relative(to, destination)}';`;
    }
    source += '\n\n' + entries.map(({ node, exported }) => exported && !node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' + node.getText() : node.getFullText().trim()).join('\n\n') + '\n';
    if (to === 'convex/concierge/tools/dispatcher.ts') {
      for (const [name, owner] of toolLocations) source += `\nimport { ${methodName(name)} } from './${owner}';`;
      source += "\nimport { searchBusinessFacts } from './facts';\n";
      source += `\nasync function executeValidatedTool${toolSignature} {\n switch (fnName) {\n`;
      for (const name of ['search_business_facts', ...toolLocations.keys()]) source += ` case '${name}': return ${methodName(name)}(ctx, fnName, fnArgs, properties, toolContext);\n`;
      source += " default: return humanToolResult({ error: `Unknown function: ${fnName}` });\n }\n}\n";
    }
    if (toolFiles.has(to)) source += '\n' + [...toolBodies].filter(([name]) => (toolLocations.get(name) ?? 'facts') === path.basename(to, '.ts')).map(([name, body]) => `export async function ${methodName(name)}${toolSignature} {\n${body}\n}\n`).join('\n');
    write(to, organize(to, refs(source)));
  }
  // Tool implementations with no original top-level declarations.
  for (const to of toolFiles) if (!groups.has(to)) write(to, organize(to, refs(toolImports(to) + [...toolBodies].filter(([name]) => (toolLocations.get(name) ?? 'facts') === path.basename(to, '.ts')).map(([name, body]) => `export async function ${methodName(name)}${toolSignature} {\n${body}\n}\n`).join('\n'))));
  // Remove unused function parameters from each extracted implementation; invocation
  // arity is selected below and checked against the original case-body identifier use.
  for (const to of toolFiles) {
    let source = read(to);
    for (const [name, body] of toolBodies) {
      const used = ['ctx', 'fnName', 'fnArgs', 'properties', 'toolContext'].filter(param => new RegExp(`\\b${param}\\b`).test(body));
      const all = { ctx: 'ActionCtx', fnName: `'${name}'`, fnArgs: 'ToolArgs', properties: "Doc<'properties'>[]", toolContext: 'ToolContext' };
      source = source.replace(`function ${methodName(name)}${toolSignature}`, `function ${methodName(name)}(${used.map(param => `${param}: ${all[param]}`).join(', ')}): Promise<string>`);
      const dispatcher = 'convex/concierge/tools/dispatcher.ts';
      write(dispatcher, read(dispatcher).replace(`${methodName(name)}(ctx, fnName, fnArgs, properties, toolContext)`, `${methodName(name)}(${used.join(', ')})`));
    }
    write(to, organize(to, source));
  }
  write('convex/concierge/tools/dispatcher.ts', organize('convex/concierge/tools/dispatcher.ts', read('convex/concierge/tools/dispatcher.ts')));
  write('convex/concierge/model.ts', `// Backend concierge interface: plain implementations only, never endpoint registrations.\nexport { runTurnHandler } from './runTurn';\nexport { generateConciergeReply, withReplyOutcome, getGuardrailReply, type ConciergeReply, type GenerateConciergeReplyArgs } from './generation';\nexport { getResortRealityDisclosure, getUnknownFallbackResponse, buildLineQuickReplyItems, parseLineLocaleFromPostback, questionFromLinePostback, type LineQuickReplyItem } from './copy';\nexport { resortTodayLine } from './prompt';\nexport { executeTool } from './tools/dispatcher';\nexport { TOOLS, BOOKING_TOOLS } from './tools/metadata';\nexport { validateToolArgs, toolError } from './tools/validation';\nexport { humanToolResult } from './tools/presentation';\n`);
  write('convex/messaging/model.ts', read('convex/messaging/model.ts') + "\n// Staff alert implementation remains in the mixed messaging module until closure.\nexport { queueStaffAlert } from '../chatKnowledge';\n");
  for (const from of Object.keys(whole).concat('convex/lib/chatTools.ts', 'convex/lib/conciergePolicy.ts')) unlinkSync(path.join(root, from));
  for (const file of tracked()) {
    if (!/\.(ts|tsx|js|mjs|md|html|json|jsonc)$/.test(file) || groups.has(file) || toolFiles.has(file) || file === 'convex/concierge/model.ts' || file.startsWith('convex/_generated/') || file.startsWith('scripts/move-')) continue;
    if (file.startsWith('docs/') && file !== 'docs/architecture/phase3a-access-inventory.md') continue;
    let source = refs(read(file));
    if (/\.(ts|tsx|js|mjs)$/.test(file)) source = imports(source, file, file);
    if (file === 'convex/phase0Security.test.ts') source = source.replace("import * as chatAi from './chatAi';", "import * as concierge from './concierge/model';").replace('chatAi.getGuardrailReply', 'concierge.getGuardrailReply');
    if (file === 'convex/chatKnowledge.test.ts') source = source.replace('from chatAi.respond', 'from the concierge engine');
    if (file === 'src/components/admin/admin-knowledge-types.ts') source = source.replace('businessFacts.adminResolveUnknownGroups', 'concierge.businessFacts.adminResolveUnknownGroups');
    source = source.replaceAll('convex/businessFacts.ts', 'convex/concierge/businessFacts.ts');
    // Retired actions have no compatibility endpoint; eval uses the existing supported turn.
    if (file === 'scripts/ai-accuracy-eval.mjs') source = source.replace("scenario.channel === 'web'\n\t\t\t\t? await run('chatAi:respond', { sessionId, userMessage: scenario.prompt })\n\t\t\t\t: await run('chatAi:generateReply', { sessionId, userMessage: scenario.prompt })", "await run('chatEval:comparisonTurn', { sessionId, userMessage: scenario.prompt, model: 'openai/gpt-6-luna' })");
    if (source !== read(file)) write(file, source);
  }
  console.log(`Moved ${[...rpc].filter(([a,b]) => a !== b).length} registrations; retained admission and staff-handoff registrations.`);
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
reverse.set('convex/concierge/tools/dispatcher.ts:executeValidatedTool', 'convex/lib/chatTools.ts:executeValidatedTool');
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
for (const [to, { from }] of groups) {
  const before = bindings(from, true), after = bindings(to, false);
  for (const [name, target] of after) if (before.has(name)) {
    assert.equal(target, before.get(name), `Changed dependency ${to}:${name}`);
    dependencyBindings++;
  }
}
for (const to of toolFiles) {
  const before = bindings('convex/lib/chatTools.ts', true), after = bindings(to, false);
  for (const [name, target] of after) if (before.has(name)) {
    assert.equal(target, before.get(name), `Changed tool dependency ${to}:${name}`);
    dependencyBindings++;
  }
}
let registrations = 0, helpers = 0, retained = 0, other = 0;
for (const [to, { from, entries }] of groups) {
  const current = ast(to, read(to));
  for (const { node } of entries) {
    const actual = current.statements.find(n => nameOf(n) && nameOf(n) === nameOf(node));
    assert.ok(actual, `Missing ${from}:${nameOf(node)}`);
    assert.equal(normalized(actual), normalized(ast('expected.ts', refs(node.getText())).statements[0]), `Changed implementation ${from}:${nameOf(node)}`);
    if (registration(node)) { if (to === from) retained++; else registrations++; } else helpers++;
  }
  const expectedNames = new Set(entries.map(({ node }) => nameOf(node)));
  if (toolFiles.has(to)) for (const [name, owner] of toolLocations) if (owner === path.basename(to, '.ts')) expectedNames.add(methodName(name));
  if (to.endsWith('/dispatcher.ts')) expectedNames.add('executeValidatedTool');
  assert.ok(current.statements.filter(n => !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)).every(n => expectedNames.has(nameOf(n))), `Extra logic in ${to}`);
}
for (const [name, body] of toolBodies) {
  const to = `convex/concierge/tools/${toolLocations.get(name) ?? 'facts'}.ts`;
  const actual = ast(to, read(to)).statements.find(n => nameOf(n) === methodName(name));
  assert.ok(actual, `Missing tool ${name}`);
  assert.equal(normalized(actual.body), normalized(ast('expected.ts', `function f() { ${refs(body)} }`).statements[0].body), `Changed tool body ${name}`);
  const used = ['ctx', 'fnName', 'fnArgs', 'properties', 'toolContext'].filter(param => new RegExp(`\\b${param}\\b`).test(body));
  const all = { ctx: 'ActionCtx', fnName: `'${name}'`, fnArgs: 'ToolArgs', properties: "Doc<'properties'>[]", toolContext: 'ToolContext' };
  const expected = ast('expected.ts', `async function ${methodName(name)}(${used.map(param => `${param}: ${all[param]}`).join(', ')}): Promise<string> {}`).statements[0];
  assert.deepEqual(actual.parameters.map(normalized), expected.parameters.map(normalized), `Changed tool parameters ${name}`);
  assert.equal(normalized(actual.type), normalized(expected.type), `Changed tool return type ${name}`);
}
for (const to of toolFiles) if (!groups.has(to)) {
  const expected = [...toolBodies.keys()].filter(name => (toolLocations.get(name) ?? 'facts') === path.basename(to, '.ts')).map(methodName);
  assert.deepEqual(ast(to, read(to)).statements.filter(n => !ts.isImportDeclaration(n)).map(nameOf), expected, `Extra tool implementation ${to}`);
}
const dispatcher = ast('dispatcher.ts', read('convex/concierge/tools/dispatcher.ts')).statements.find(n => nameOf(n) === 'executeValidatedTool');
let expectedDispatcher = `async function executeValidatedTool${toolSignature} { switch (fnName) {`;
for (const name of ['search_business_facts', ...toolLocations.keys()]) {
  const params = ['ctx', 'fnName', 'fnArgs', 'properties', 'toolContext'].filter(param => new RegExp(`\\b${param}\\b`).test(toolBodies.get(name)));
  expectedDispatcher += `case '${name}': return ${methodName(name)}(${params.join(', ')});`;
}
expectedDispatcher += 'default: return humanToolResult({ error: `Unknown function: ${fnName}` }); } }';
assert.equal(normalized(dispatcher), normalized(ast('expected.ts', expectedDispatcher).statements[0]), 'Changed tool routing');
for (const file of new Set([...groups.keys(), ...toolFiles])) if (file.includes('/concierge/')) assert.ok(read(file).split('\n').length < 1000, `Oversized ${file}`);
for (const from of Object.keys(whole).concat('convex/lib/chatTools.ts', 'convex/lib/conciergePolicy.ts')) assert.ok(!existsSync(path.join(root, from)), `Legacy file ${from}`);
const production = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'convex'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(file => file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file) && !origins.includes(file) && file !== 'convex/lib/conciergePolicy.ts' && file !== 'convex/concierge/model.ts');
for (const file of production) {
  const before = ast(file, old(file)).statements.filter(n => !ts.isImportDeclaration(n));
  const after = ast(file, read(file)).statements.filter(n => !ts.isImportDeclaration(n));
  if (file === 'convex/messaging/model.ts') after.pop(); // Explicit new plain queueStaffAlert seam.
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
    assert.ok(!read(file).includes(before), `Legacy RPC ${before} in ${file}`);
    assert.ok(!new RegExp(`\\b(?:api|internal)\\.${before.replace(':', '\\.')}\\b`).test(read(file)), `Legacy API ${before} in ${file}`);
  }
  for (const node of ast(file, read(file)).statements.filter(ts.isImportDeclaration)) {
    const target = resolve(file, node.moduleSpecifier.text);
    assert.ok(!Object.keys(whole).concat('convex/lib/chatTools.ts', 'convex/lib/conciergePolicy.ts').includes(target), `Legacy import ${file}:${target}`);
    if (file.startsWith('convex/') && !file.startsWith('convex/concierge/') && !file.endsWith('.test.ts') && !file.startsWith('convex/lib/') && file !== 'convex/schema.ts' && target.startsWith('convex/concierge/')) assert.equal(target, 'convex/concierge/model.ts', `Bypass ${file}:${target}`);
    if (file.startsWith('src/')) assert.notEqual(target, 'convex/concierge/model.ts', `Browser model import ${file}`);
  }
}
assert.equal(ast('model.ts', read('convex/concierge/model.ts')).statements.filter(registration).length, 0);
for (const node of ast('model.ts', read('convex/concierge/model.ts')).statements) {
  assert.ok(ts.isExportDeclaration(node) && node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause), 'Model must expose named plain implementations');
  const target = resolve('convex/concierge/model.ts', node.moduleSpecifier.text);
  for (const entry of node.exportClause.elements) {
    const implementation = treeFor(target, false).statements.find(n => nameOf(n) === (entry.propertyName?.text ?? entry.name.text));
    assert.ok(implementation && !registration(implementation), `Endpoint or missing implementation exported as ${entry.name.text}`);
  }
}
const access = tracked().filter(file => file.startsWith('convex/') && file.endsWith('.ts') && !/\.test\.ts$|\/_generated\//.test(file)).map(file => inspectConvexAccess(file, read(file)));
const publicInventory = access.reduce((sum, entry) => sum + entry.registrations.length, 0), rawPublic = access.reduce((sum, entry) => sum + entry.violations.length, 0);
assert.equal(publicInventory, 295);
assert.equal(rawPublic, 0);
console.log(JSON.stringify({ base, registrations, retained, helpers, toolBodies: toolBodies.size, dependencyBindings, otherProductionDeclarations: other, publicInventory, rawPublic, rpc: Object.fromEntries(rpc), declarations: Object.fromEntries(locations) }, null, 2));
