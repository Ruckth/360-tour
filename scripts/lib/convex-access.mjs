// Parse imports and registrations so renaming a raw builder cannot hide it from the scorecard.
import ts from 'typescript';
export const ACCESS_BUILDERS = new Set([
  'publicQuery', 'publicMutation', 'publicAction',
  'guestQuery', 'guestMutation', 'deviceQuery', 'deviceMutation',
  'authenticatedQuery', 'authenticatedMutation', 'authenticatedAction',
  'staffQuery', 'staffMutation', 'staffAction', 'adminQuery', 'adminMutation', 'adminAction',
  'marketingQuery', 'marketingMutation',
]);
const RAW = new Set(['query', 'mutation', 'action', 'httpAction', 'queryGeneric', 'mutationGeneric', 'actionGeneric', 'httpActionGeneric']);
/** @param {string} path @param {string} source */
export function inspectConvexAccess(path, source) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const bindings = new Map(), namespaces = new Set(), violations = [], registrations = [];
  const inAuth = path.replaceAll('\\', '/').includes('convex/auth/');
  /** @param {import("typescript").Node} node */
  const location = node => `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  for (const node of file.statements) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      const specifier = node.moduleSpecifier.text;
      const generated = /(?:_generated\/server|convex\/server)(?:\.js)?$/.test(specifier);
      const auth = /auth\/model(?:\.js)?$/.test(specifier);
      const names = node.importClause?.namedBindings;
      if (names && ts.isNamedImports(names)) for (const spec of names.elements) {
        const original = (spec.propertyName ?? spec.name).text;
        if (spec.isTypeOnly) continue;
        if (generated && RAW.has(original)) {
          bindings.set(spec.name.text, original);
          if (!inAuth) violations.push(`${location(spec)} imports raw ${original}`);
        } else if (auth && ACCESS_BUILDERS.has(original)) bindings.set(spec.name.text, original);
      }
      if (generated && names && ts.isNamespaceImport(names)) {
        namespaces.add(names.name.text);
        if (!inAuth) violations.push(`${location(node)} imports generated server namespace`);
      }
    }
    if (!inAuth && ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && /_generated\/server/.test(node.moduleSpecifier.text)) {
      if (!node.isTypeOnly && (!node.exportClause || (ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(e => RAW.has((e.propertyName ?? e.name).text))))) {
        violations.push(`${location(node)} re-exports raw builders`);
      }
    }
  }
  for (const node of file.statements) if (ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
    for (const decl of node.declarationList.declarations) {
      const call = decl.initializer;
      if (!call || !ts.isCallExpression(call)) continue;
      const expr = call.expression;
      const builder = ts.isIdentifier(expr) ? bindings.get(expr.text) ?? (RAW.has(expr.text) ? expr.text : undefined)
        : ts.isPropertyAccessExpression(expr) && namespaces.has(expr.expression.getText(file)) ? expr.name.text : undefined;
      if (!builder || builder === 'httpAction') continue;
      if (RAW.has(builder) && !inAuth) violations.push(`${location(decl)} registers raw ${builder}`);
      if (!ACCESS_BUILDERS.has(builder)) continue;
      const options = call.arguments[0];
      const policy = options && ts.isObjectLiteralExpression(options)
        ? Object.fromEntries(options.properties.filter(ts.isPropertyAssignment).filter(p => ['reason', 'capability', 'permission'].includes(p.name.getText(file))).map(p => [p.name.getText(file), ts.isStringLiteral(p.initializer) ? p.initializer.text : undefined])) : {};
      registrations.push({ name: decl.name.getText(file), builder, policy, location: location(decl) });
    }
  }
  return { violations, registrations };
}
