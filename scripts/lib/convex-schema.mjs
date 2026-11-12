// Offline schema assembly inspection. Follow bindings from defineSchema, never scan
// every defineTable in the repository (which would include unreachable/component tables).
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

export const SCHEMA_DOMAINS = ['auth', 'catalog', 'bookings', 'services', 'pos', 'marketing', 'messaging', 'concierge', 'settings'];

/** A reader works on a checkout, a historical git tree, or an in-memory test repository.
 * @param {string} root @param {string} [ref]
 * @returns {(path: string) => string | undefined}
 */
export function schemaSourceReader(root, ref) {
  /** @type {Map<string, string | undefined>} */
  const cache = new Map();
  return path => {
    if (cache.has(path)) return cache.get(path);
    let source;
    if (ref) {
      try { source = execFileSync('git', ['show', `${ref}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
      catch { source = undefined; }
    } else {
      const absolute = resolve(root, path);
      source = existsSync(absolute) ? readFileSync(absolute, 'utf8') : undefined;
    }
    cache.set(path, source);
    return source;
  };
}

/** @param {(path: string) => string | undefined} readSource */
export function inspectSchema(readSource) {
  /** @type {Map<string, {file: import('typescript').SourceFile, source: string}>} */
  const modules = new Map();
  /** @param {string} path */
  function load(path) {
    let loaded = modules.get(path);
    if (!loaded) {
      const source = readSource(path);
      if (source === undefined) throw new Error(`Missing schema source: ${path}`);
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      if (ts.transpileModule(source, { reportDiagnostics: true }).diagnostics?.length) throw new Error(`Invalid schema syntax: ${path}`);
      loaded = { file, source };
      modules.set(path, loaded);
    }
    return loaded;
  }
  /** @param {string} path @param {string} specifier */
  function localPath(path, specifier) {
    if (!specifier.startsWith('.')) throw new Error(`Schema assembly must use repository imports: ${specifier}`);
    const base = posix.normalize(posix.join(posix.dirname(path), specifier));
    if (!base.startsWith('convex/') || base.split('/').includes('node_modules')) throw new Error(`Schema import outside convex/: ${base}`);
    const candidates = /\.[cm]?[jt]s$/.test(base) ? [base.replace(/\.js$/, '.ts'), base] : [base + '.ts', base + '.js', base + '/index.ts'];
    const found = candidates.find(candidate => readSource(candidate) !== undefined);
    if (!found) throw new Error(`Unresolved schema import: ${path} → ${specifier}`);
    return found;
  }
  /** @param {string} path @param {string} name */
  function binding(path, name) {
    const { file } = load(path);
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && !statement.importClause?.isTypeOnly) {
        const clause = statement.importClause;
        if (clause?.name?.text === name) return { path: localPath(path, statement.moduleSpecifier.text), name: 'default' };
        const names = clause?.namedBindings;
        if (names && ts.isNamedImports(names)) for (const spec of names.elements) {
          if (spec.name.text !== name || spec.isTypeOnly) continue;
          return { specifier: statement.moduleSpecifier.text, name: (spec.propertyName ?? spec.name).text, path };
        }
      }
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return { path, node: declaration.initializer };
      }
      if (name === 'default' && ts.isExportAssignment(statement) && !statement.isExportEquals) return { path, node: statement.expression };
    }
    throw new Error(`Unsupported/missing schema binding: ${path}:${name}`);
  }
  /** @type {Set<string>} */
  const resolving = new Set();
  /** @param {string} path @param {string} name @param {(path: string, node: import('typescript').Expression) => TableSource[]} consume
   * @returns {TableSource[]}
   */
  function follow(path, name, consume) {
    const key = `${path}:${name}`;
    if (resolving.has(key)) throw new Error(`Circular schema assembly: ${key}`);
    resolving.add(key);
    try {
      const value = binding(path, name);
      if (value.node) return consume(path, value.node);
      const target = value.specifier ? localPath(path, value.specifier) : value.path;
      return follow(target, value.name, consume);
    } finally { resolving.delete(key); }
  }
  /** @param {string} path @param {import('typescript').Expression} expression @param {string} name */
  function convexBuilder(path, expression, name) {
    if (!ts.isIdentifier(expression)) return false;
    const value = binding(path, expression.text);
    return value.specifier === 'convex/server' && value.name === name;
  }
  /** @typedef {{name: string, source: string}} TableSource */
  /** @param {string} path @param {import('typescript').Expression} expression */
  function table(path, expression) {
    // Only unwrap index declarations; do not accept arbitrary wrapper calls.
    while (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      && ['index', 'searchIndex', 'vectorIndex'].includes(expression.expression.name.text)) expression = expression.expression.expression;
    if (!ts.isCallExpression(expression) || !convexBuilder(path, expression.expression, 'defineTable')) {
      throw new Error(`Unsupported table definition in ${path}: ${expression.getText(load(path).file)}`);
    }
  }
  /** @param {string} path @param {import('typescript').Expression} expression @returns {TableSource[]} */
  function object(path, expression) {
    while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;
    if (ts.isIdentifier(expression)) return follow(path, expression.text, object);
    if (!ts.isObjectLiteralExpression(expression)) throw new Error(`Unsupported schema assembly in ${path}`);
    return expression.properties.flatMap(property => {
      if (ts.isSpreadAssignment(property)) return object(path, property.expression);
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) throw new Error(`Unsupported table key in ${path}`);
      table(path, property.initializer);
      return [{ name: property.name.text, source: path }];
    });
  }
  const tables = follow('convex/schema.ts', 'default', (path, expression) => {
    if (!ts.isCallExpression(expression) || !convexBuilder(path, expression.expression, 'defineSchema') || !expression.arguments[0]) throw new Error('Expected default defineSchema assembly');
    return object(path, expression.arguments[0]);
  });
  /** @type {Set<string>} */
  const names = new Set();
  for (const table of tables) {
    if (names.has(table.name)) throw new Error(`Duplicate schema table: ${table.name}`);
    names.add(table.name);
  }
  const assemblySources = [...modules.keys()];
  // Preserve/verify runtime validator dependencies too: checking schema.ts alone
  // would miss a changed domain table or imported leaf validator during rollback.
  for (const [path, { file }] of modules) for (const statement of file.statements) {
    if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier) || (ts.isExportDeclaration(statement) && statement.isTypeOnly)) continue;
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const names = clause?.namedBindings;
      if (!clause?.name && names && ts.isNamedImports(names) && names.elements.every(spec => spec.isTypeOnly)) continue;
    }
    if (statement.moduleSpecifier.text.startsWith('.')) load(localPath(path, statement.moduleSpecifier.text));
  }
  return { tables, assemblySources, sources: Object.fromEntries([...modules].map(([path, loaded]) => [path, loaded.source])) };
}
