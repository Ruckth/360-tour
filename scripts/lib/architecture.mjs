// Current-source ownership rules shared by ESLint, the scorecard and adversarial tests.
// No git baseline, endpoint quota or implementation snapshot belongs in these guards.
import ts from 'typescript';
import { posix } from 'node:path';
import { SCHEMA_DOMAINS } from './convex-schema.mjs';

export const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs)$/;
/** @param {string} path */
export const isTestSource = path => /(?:^|\/)(?:tests|testing)\/|\.(?:test|spec)\.[^.]+$/.test(path);
/** @param {string} path */
export const modulePath = path => path.replace(/\.(?:ts|tsx|js|mjs)$/, '');
const sdk = new Set(['convex/server', 'convex/values', 'convex/browser', 'convex/react', 'convex/react-clerk', 'convex/nextjs']);
const roots = new Set(['schema', 'http', 'crons', 'auth.config', 'convex.config'].map(p => `convex/${p}`));
// Invocation accounting and backend configuration, not homes for business ctx implementations.
const forbiddenGlobals = new Set(['ctx', 'process', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Deno', 'Bun', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'eval', 'Function']);
const infrastructure = new Set(['adminEmails', 'maintenance', 'readBudget'].map(p => `convex/lib/${p}`));
/** @param {string} path */
export const domainOf = path => SCHEMA_DOMAINS.find(d => path.startsWith(`convex/${d}/`));
/** @param {string} path @param {string} specifier */
export function importTarget(path, specifier) {
  if (specifier.startsWith('.')) return modulePath(posix.normalize(posix.join(posix.dirname(path), specifier)));
  if (specifier.startsWith('@/')) return modulePath(`src/${specifier.slice(2)}`);
  return modulePath(specifier);
}

/** All import forms that can cross a seam, including type-only dependencies.
 * @param {import('typescript').SourceFile} file
 */
export function sourceImports(file) {
  /** @type {{node: import('typescript').Node, specifier: string | null, typeOnly: boolean, form: string}[]} */
  const imports = [];
  /** @param {import('typescript').Node} node @param {import('typescript').Node | undefined} argument @param {boolean} typeOnly @param {string} form */
  function add(node, argument, typeOnly, form) {
    imports.push({ node, specifier: argument && ts.isStringLiteralLike(argument) ? argument.text : null, typeOnly, form });
  }
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
      add(node, node.moduleSpecifier, !!clause?.isTypeOnly || !!(names && ts.isNamedImports(names) && names.elements.length && names.elements.every(e => e.isTypeOnly) && !clause?.name), 'import');
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add(node, node.moduleSpecifier, node.isTypeOnly || !!(node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length && node.exportClause.elements.every(e => e.isTypeOnly)), 'export');
    } else if (ts.isImportTypeNode(node)) {
      add(node, ts.isLiteralTypeNode(node.argument) ? node.argument.literal : undefined, true, 'type import');
    } else if (ts.isImportEqualsDeclaration(node)) {
      add(node, ts.isExternalModuleReference(node.moduleReference) ? node.moduleReference.expression : undefined, node.isTypeOnly, 'import equals');
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      add(node, node.arguments[0], false, 'dynamic import/require');
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}

/** @param {string} path @param {string} source */
export function inspectArchitecture(path, source) {
  path = path.replaceAll('\\', '/');
  if (isTestSource(path) || path.includes('/_generated/') || path.endsWith('.d.ts')) return [];
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  /** @type {{rule: string, line: number, message: string}[]} */
  const issues = [];
  /** @param {string} rule @param {import('typescript').Node} node @param {string} message */
  const report = (rule, node, message) => issues.push({ rule, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, message });
  const own = domainOf(path), moduleId = modulePath(path), shared = path.startsWith('convex/shared/');
  if (path.startsWith('convex/') && !own && !path.startsWith('convex/maintenance/') && !shared && !roots.has(moduleId) && !infrastructure.has(moduleId)) report('owner', file, 'Backend implementations belong to a domain; root only assembles schema, HTTP, crons and configuration.');
  // Syntax errors must not make a source scan appear to have zero dependencies.
  if (!('parseDiagnostics' in file) || !Array.isArray(file.parseDiagnostics) || file.parseDiagnostics.length) report('syntax', file, 'Cannot inspect invalid source syntax.');
  for (const dependency of sourceImports(file)) {
    const { node, specifier, typeOnly, form } = dependency;
    if (specifier === null) {
      // The locale JSON loader has a fixed path and extension outside the backend graph.
      const argument = ts.isCallExpression(node) ? node.arguments[0] : undefined;
      if (path === 'src/i18n/request.ts' && argument && ts.isTemplateExpression(argument) && argument.head.text === '../../messages/' && argument.templateSpans.length === 1 && argument.templateSpans[0].literal.text === '.json') continue;
      report('imports', node, `Use a literal module path for ${form}; computed module ownership cannot be verified.`);
      continue;
    }
    const target = importTarget(path, specifier);
    if (path.startsWith('src/') && target.startsWith('convex/') && !sdk.has(target) && !target.startsWith('convex/shared/') && !['convex/_generated/api', 'convex/_generated/dataModel'].includes(target)) report('browser', node, `Browser code may import shared rules and generated API/data types, not ${target}.`);
    if (path.startsWith('convex/') && target.startsWith('src/')) report('backend', node, 'Backend code cannot import browser implementations.');
    const other = domainOf(target);
    // Root assembly has just two deliberate private imports: schema tables and HTTP ingress.
    const assembly = moduleId === 'convex/schema' && other && target === `convex/${other}/tables`
      || moduleId === 'convex/http' && target === 'convex/messaging/ingress';
    if (path.startsWith('convex/') && other && other !== own && !assembly && target !== `convex/${other}/model`) report('cross-domain', node, `Use convex/${other}/model across domains, including type imports and reexports.`);
    if (shared && !((target.startsWith('convex/shared/')) || target === 'convex/values' || target === 'libphonenumber-js/min' || typeOnly && target === 'convex/_generated/dataModel')) report('shared', node, `Shared rules are pure; ${target} is not a shared rule, validator or generated data type.`);
    if (infrastructure.has(moduleId) && other) report('infrastructure', node, 'Backend lib infrastructure must not depend on business domains.');
    if (path.startsWith('convex/') && (target.startsWith('convex/testing/') || isTestSource(target))) report('testing', node, 'Production cannot depend on test harnesses or fixtures.');
  }
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === 'require' && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) report('imports', node, 'Do not alias require; use a literal direct module import so ownership can be verified.');
    if (shared) {
      // Identifier checks also catch renamed/destructured access, without counting comments/strings.
      if (ts.isIdentifier(node) && forbiddenGlobals.has(node.text)) report('shared', node, `Shared rules cannot access ${node.text}; pass pure data instead.`);
      if (ts.isElementAccessExpression(node) && ['globalThis', 'self', 'global'].includes(node.expression.getText(file)) && (!ts.isStringLiteralLike(node.argumentExpression) || forbiddenGlobals.has(node.argumentExpression.text))) report('shared', node, 'Shared rules cannot access runtime globals indirectly.');
      if (ts.isIdentifier(node) && /^(?:QueryCtx|MutationCtx|ActionCtx|GenericQueryCtx|GenericMutationCtx|GenericActionCtx)$/.test(node.text)) report('shared', node, 'Shared rules cannot accept a backend context.');
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) report('shared', node, 'Shared rules cannot read runtime environment metadata.');
    }
    const member = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined;
    const rootContext = roots.has(moduleId) && moduleId !== 'convex/http';
    if ((infrastructure.has(moduleId) || rootContext) && ts.isIdentifier(node) && /^(?:QueryCtx|MutationCtx|ActionCtx|GenericQueryCtx|GenericMutationCtx|GenericActionCtx)$/.test(node.text)) report('infrastructure', node, 'Backend contexts belong to domains; root assembles configuration and lib accounts for invocations.');
    if ((infrastructure.has(moduleId) || rootContext) && member && ['db', 'auth', 'storage', 'scheduler', 'runQuery', 'runMutation', 'runAction'].includes(member)) report('infrastructure', node, 'Business ctx reads/writes belong to their owning domain, not backend lib.');
    ts.forEachChild(node, visit);
  }
  visit(file);
  return issues;
}
