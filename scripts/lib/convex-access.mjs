// Recognize builders by imported identity, never by a bare spelling or a fixed endpoint quota.
import ts from 'typescript';
import { domainOf, importTarget, isTestSource, modulePath, sourceImports } from './architecture.mjs';
export const ACCESS_BUILDERS = new Set([
  'publicQuery', 'publicMutation', 'publicAction',
  'guestQuery', 'guestMutation', 'deviceQuery', 'deviceMutation',
  'authenticatedQuery', 'authenticatedMutation', 'authenticatedAction',
  'staffQuery', 'staffMutation', 'staffAction', 'adminQuery', 'adminMutation', 'adminAction',
  'marketingQuery', 'marketingMutation',
]);
const RAW = new Set(['query', 'mutation', 'action', 'httpAction', 'queryGeneric', 'mutationGeneric', 'actionGeneric', 'httpActionGeneric']);
const INTERNAL = new Set(['internalQuery', 'internalMutation', 'internalAction', 'internalQueryGeneric', 'internalMutationGeneric', 'internalActionGeneric']);
const builders = new Set([...RAW, ...INTERNAL, ...ACCESS_BUILDERS]);
/** @param {string} path @param {string} source */
export function inspectConvexAccess(path, source) {
  path = path.replaceAll('\\', '/');
  /** @type {string[]} */
  const violations = [];
  /** @type {{name: string, builder: string, policy: Record<string, string | undefined>, location: string}[]} */
  const registrations = [];
  /** @type {string[]} */
  const endpoints = [];
  if (isTestSource(path) || path.includes('/_generated/') || path.endsWith('.d.ts')) return { violations, registrations, endpoints };
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  /** @type {Map<string, string>} */
  const bindings = new Map();
  /** @type {Set<import('typescript').Node>} */
  const importNames = new Set();
  const authModel = path === 'convex/auth/model.ts';
  /** @param {import('typescript').Node} node */
  const location = node => `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  /** @param {import('typescript').Node} node @param {string} message */
  const fail = (node, message) => violations.push(`${location(node)} ${message}`);
  if (!('parseDiagnostics' in file) || !Array.isArray(file.parseDiagnostics) || file.parseDiagnostics.length) fail(file, 'cannot inspect invalid registration syntax');
  for (const { node, specifier, typeOnly, form } of sourceImports(file)) {
    if (!specifier || typeOnly) continue;
    const target = importTarget(path, specifier);
    if (!['convex/_generated/server', 'convex/server', 'convex/auth/model'].includes(target)) continue;
    if (form !== 'import' && form !== 'export') {
      fail(node, 'use named static imports for builder modules; dynamic/require builder bindings cannot be verified');
      continue;
    }
    const rawModule = target !== 'convex/auth/model';
    const names = ts.isImportDeclaration(node) ? node.importClause?.namedBindings : ts.isExportDeclaration(node) ? node.exportClause : undefined;
    if (!names || ts.isNamespaceImport(names) || ts.isNamespaceExport(names)) {
      fail(node, 'use explicit named imports/reexports for builder modules; namespace/star bindings are ambiguous');
      continue;
    }
    if (ts.isImportDeclaration(node) && node.importClause?.name) fail(node, 'default builder module imports cannot be verified');
    for (const spec of names.elements) {
      if (spec.isTypeOnly) continue;
      const original = (spec.propertyName ?? spec.name).text;
      if (!builders.has(original)) continue;
      if (rawModule && RAW.has(original) && !authModel) fail(spec, `imports/reexports raw ${original}; only convex/auth/model.ts owns raw public builders`);
      if (ts.isExportDeclaration(node)) {
        if (!(authModel && INTERNAL.has(original))) fail(spec, 'do not reexport registration builders; import from auth/model at the registration');
      } else {
        bindings.set(spec.name.text, original);
        importNames.add(spec.name);
        const owner = domainOf(path) || path.startsWith('convex/maintenance/');
        if (!authModel && (!owner || /\/(?:model|tables)\.[^.]+$|\/private\//.test(path)) && !(modulePath(path) === 'convex/http' && original === 'httpAction')) fail(spec, 'registration builders belong in domain endpoint files, not root, lib, model or private implementations');
      }
    }
  }
  /** @param {import('typescript').Node} node */
  function visit(node) {
    if (ts.isIdentifier(node) && bindings.has(node.text) && !importNames.has(node)) {
      const builder = bindings.get(node.text) ?? "";
      // auth/model composes wrappers and deliberately preserves internal builders.
      if (!authModel) {
        if (!ts.isCallExpression(node.parent) || node.parent.expression !== node) fail(node, 'builder aliases, forwarding and indirect registration are unsupported; call the imported builder directly');
        else if (builder !== 'httpAction') {
          const call = node.parent, declaration = call.parent;
          const statement = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : undefined;
          if (!ts.isVariableDeclaration(declaration) || !statement || !ts.isVariableStatement(statement) || !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) || !ts.isIdentifier(declaration.name) || !call.arguments[0] || !ts.isObjectLiteralExpression(call.arguments[0])) fail(call, 'use export const name = builder({ ... }) so access policy and registration ownership can be verified');
          else {
            endpoints.push(declaration.name.text);
            if (ACCESS_BUILDERS.has(builder)) {
              const options = call.arguments[0];
              const policy = Object.fromEntries(options.properties.filter(ts.isPropertyAssignment).filter(p => ['reason', 'capability', 'permission'].includes(p.name.getText(file).replaceAll(/["']/g, ''))).map(p => [p.name.getText(file).replaceAll(/["']/g, ''), ts.isStringLiteral(p.initializer) ? p.initializer.text : undefined]));
              registrations.push({ name: declaration.name.text, builder, policy, location: location(declaration) });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { violations, registrations, endpoints };
}
