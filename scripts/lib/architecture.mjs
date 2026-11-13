// Current-source ownership rules shared by ESLint, the scorecard and adversarial tests.
// No git baseline, endpoint quota or implementation snapshot belongs in these guards.
import ts from 'typescript';
import { posix } from 'node:path';
import { SCHEMA_DOMAINS } from './convex-schema.mjs';

// Installed Convex's complete entry-point extension list. Additional forms fail closed below.
export const SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs|cjs|mts|cts|jsx)$/;
export const INSPECTED_SOURCE_EXTENSION = /\.(?:ts|tsx|js|mjs)$/;
/** Match Convex's entry-point exclusions, not a directory's descriptive name.
 * @param {string} path */
export const isConvexEntryFile = path => path.startsWith('convex/') && SOURCE_EXTENSION.test(path)
  && !path.includes('/_generated/') && !/^[.#]/.test(posix.basename(path))
  && (posix.basename(path).match(/\./g) ?? []).length === 1 && !path.includes(' ')
  && !['convex/schema.ts', 'convex/schema.js'].includes(path);
/** @param {string} path */
export const isTestSource = path => /(?:^|\/)(?:tests|testing)(?:\/|$)|\.(?:test|spec)(?:\.[^.]+)?$/.test(path);
/** @param {string} path */
export const modulePath = path => path.replace(SOURCE_EXTENSION, '');
const sdk = new Set(['convex/server', 'convex/values', 'convex/browser', 'convex/react', 'convex/react-clerk', 'convex/nextjs']);
const roots = new Set(['schema', 'http', 'crons', 'auth.config', 'convex.config'].map(p => `convex/${p}`));
// Invocation accounting and backend configuration, not homes for business ctx implementations.
const forbiddenGlobals = new Set(['ctx', 'process', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Deno', 'Bun', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'eval', 'Function']);
const infrastructure = new Set(['adminEmails', 'maintenance', 'readBudget'].map(p => `convex/lib/${p}`));
/** @param {string} path */
export const domainOf = path => SCHEMA_DOMAINS.find(d => path === `convex/${d}` || path.startsWith(`convex/${d}/`));
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

/** @param {string} path @param {string} source @param {import('typescript').SourceFile} [parsed] */
export function inspectArchitecture(path, source, parsed) {
  path = path.replaceAll('\\', '/');
  if (isTestSource(path) && !isConvexEntryFile(path) || path.includes('/_generated/') || path.endsWith('.d.ts')) return [];
  const file = parsed ?? ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  if (file.fileName !== path || file.text !== source) throw new Error('Parsed architecture source does not match its path/content');
  /** @type {{rule: string, line: number, message: string}[]} */
  const issues = [];
  /** @param {string} rule @param {import('typescript').Node} node @param {string} message */
  const report = (rule, node, message) => issues.push({ rule, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, message });
  const own = domainOf(path), moduleId = modulePath(path), shared = path.startsWith('convex/shared/'), testInfrastructure = isTestSource(path);
  if (isConvexEntryFile(path) && !INSPECTED_SOURCE_EXTENSION.test(path)) report('extension', file, 'This Convex-deployable extension is not inspected; use .ts, .tsx, .js or .mjs.');
  if (path.startsWith('convex/') && !testInfrastructure && !own && !path.startsWith('convex/maintenance/') && !shared && !roots.has(moduleId) && !infrastructure.has(moduleId)) report('owner', file, 'Backend implementations belong to a domain; root only assembles schema, HTTP, crons and configuration.');
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
    if (path.startsWith('convex/') && !testInfrastructure && other && other !== own && !assembly && target !== `convex/${other}/model`) report('cross-domain', node, `Use convex/${other}/model across domains, including type imports and reexports.`);
    if (shared && !((target.startsWith('convex/shared/')) || target === 'convex/values' || target === 'libphonenumber-js/min' || typeOnly && target === 'convex/_generated/dataModel')) report('shared', node, `Shared rules are pure; ${target} is not a shared rule, validator or generated data type.`);
    if (infrastructure.has(moduleId) && other) report('infrastructure', node, 'Backend lib infrastructure must not depend on business domains.');
    if (!testInfrastructure && (path.startsWith('convex/') || path.startsWith('src/')) && isTestSource(target)) report('testing', node, 'Production cannot depend on test harnesses or fixtures.');
  }
  /** @param {import('typescript').BindingName} name @param {string} text @returns {boolean} */
  function binds(name, text) {
    return ts.isIdentifier(name) ? name.text === text : name.elements.some(element => !ts.isOmittedExpression(element) && binds(element.name, text));
  }
  /** Global names used as pure local data are not references to the ambient runtime.
   * @param {import('typescript').Identifier} identifier */
  function locallyBound(identifier) {
    for (let scope = identifier.parent; scope; scope = scope.parent) {
      if (ts.isFunctionLike(scope) && scope.parameters.some(parameter => binds(parameter.name, identifier.text))) return true;
      if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name, identifier.text)) return true;
      if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
      for (const statement of scope.statements) {
        if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => binds(declaration.name, identifier.text))) return true;
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === identifier.text) return true;
        if (ts.isImportDeclaration(statement)) {
          const clause = statement.importClause, names = clause?.namedBindings;
          if (clause?.name?.text === identifier.text || names && (ts.isNamespaceImport(names) ? names.name.text === identifier.text : names.elements.some(name => name.name.text === identifier.text))) return true;
        }
      }
    }
    return false;
  }
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isIdentifier(node) && node.text === 'require' && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) report('imports', node, 'Do not alias require; use a literal direct module import so ownership can be verified.');
    if (shared) {
      // Identifier checks also catch renamed/destructured access, without counting comments/strings.
      const propertyName = ts.isIdentifier(node) && (
        ts.isPropertyAccessExpression(node.parent) && node.parent.name === node
        || ts.isBindingElement(node.parent) && node.parent.propertyName === node
        || ts.isTypeReferenceNode(node.parent)
        || (ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent)
          || ts.isPropertyDeclaration(node.parent) || ts.isMethodDeclaration(node.parent)
          || ts.isMethodSignature(node.parent) || ts.isGetAccessorDeclaration(node.parent)
          || ts.isSetAccessorDeclaration(node.parent)) && node.parent.name === node
      );
      if (ts.isIdentifier(node) && !propertyName && forbiddenGlobals.has(node.text) && (node.text === 'ctx' || !locallyBound(node))) report('shared', node, `Shared rules cannot access ${node.text}; pass pure data instead.`);
      if (ts.isIdentifier(node) && !propertyName && ['globalThis', 'self', 'global'].includes(node.text) && !locallyBound(node)) {
        const parent = node.parent;
        const member = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text
          : ts.isElementAccessExpression(parent) && parent.expression === node && ts.isStringLiteralLike(parent.argumentExpression) ? parent.argumentExpression.text : undefined;
        if (!member || forbiddenGlobals.has(member)) report('shared', node, 'Shared rules cannot alias runtime globals or access side effects through them.');
      }
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
