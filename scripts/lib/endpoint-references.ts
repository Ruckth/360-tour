import ts from 'typescript';
import { importTarget, isConvexEntryFile, modulePath } from './architecture.mjs';

export function inspectEndpointReferences(path: string, source: string) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const references = new Set<string>();
  const functions = new Set<string>();
  const callAliases = new Map<string, string>();
  const apiBindings = new Set<string>();
  const httpBuilders = new Set<string>();
  const directBindings = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = importTarget(path, statement.moduleSpecifier.text);
    const clause = statement.importClause;
    if (clause?.isTypeOnly || !clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const binding of clause.namedBindings.elements) {
      if (binding.isTypeOnly) continue;
      const original = (binding.propertyName ?? binding.name).text;
      if (['convex/react', 'convex/server'].includes(statement.moduleSpecifier.text)) callAliases.set(binding.name.text, original);
      if (target === 'convex/_generated/api' && ['api', 'internal'].includes(original)) apiBindings.add(binding.name.text);
      if (['convex/auth/model', 'convex/_generated/server'].includes(target) && original === 'httpAction') httpBuilders.add(binding.name.text);
      if (target.startsWith('convex/') && target !== 'convex/_generated/api') directBindings.set(binding.name.text, `${target.slice(7)}:${original}`);
    }
  }
  // Resolve dot and literal bracket paths, including renamed api/internal imports.
  function apiPath(node: ts.Node): string[] | undefined {
    if (ts.isIdentifier(node) && apiBindings.has(node.text)) return [];
    if (ts.isPropertyAccessExpression(node)) {
      const parent = apiPath(node.expression);
      return parent && [...parent, node.name.text];
    }
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      const parent = apiPath(node.expression);
      return parent && [...parent, node.argumentExpression.text];
    }
  }
  // Follow local reference aliases only when consumed by supported wiring.
  const aliases = new Map<string, ts.Expression>();
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) aliases.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  }
  collect(file);
  function reference(node: ts.Expression, seen = new Set<string>()): string | undefined {
    const parts = apiPath(node);
    if (parts && parts.length >= 2) return `${parts.slice(0, -1).join('/')}:${parts.at(-1)}`;
    if (ts.isIdentifier(node)) {
      if (directBindings.has(node.text)) return directBindings.get(node.text);
      if (!seen.has(node.text) && aliases.has(node.text)) {
        seen.add(node.text);
        return reference(aliases.get(node.text)!, seen);
      }
    }
    if (ts.isConditionalExpression(node)) {
      for (const branch of [node.whenTrue, node.whenFalse]) { const target = reference(branch, new Set(seen)); if (target) references.add(target); }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (callAliases.get(node.expression.text) ?? node.expression.text) === 'makeFunctionReference') {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg) && /^[\w/-]+:\w+$/.test(arg.text)) return arg.text;
    }
  }
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? (callAliases.get(callee.text) ?? callee.text) : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const index = ['runAfter', 'runAt'].includes(name) ? 1 : ['interval', 'daily', 'weekly', 'monthly', 'cron'].includes(name) ? 2 : 0;
      if (['watchQuery', 'usePaginatedQuery', 'useQuery', 'useMutation', 'useAction', 'query', 'consistentQuery', 'mutation', 'action', 'runQuery', 'runMutation', 'runAction', 'runAfter', 'runAt', 'interval', 'daily', 'weekly', 'monthly', 'cron'].includes(name)) {
        const arg = node.arguments[index];
        const target = arg && reference(arg);
        if (target) references.add(target);
      }
      // These operator helpers execute the Convex CLI, rather than accepting arbitrary notes.
      if ((path === 'scripts/ai-accuracy-eval.mjs' && name === 'run') || (path === 'scripts/ai-booking-eval.ts' && name === 'convex')) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg) && /^[\w/-]+:\w+$/.test(arg.text)) references.add(arg.text);
      }
      if (name === 'useQueries') {
        const seen = new Set<string>();
        const inspectRequest = (part: ts.Node) => {
          if (ts.isIdentifier(part) && aliases.has(part.text) && !seen.has(part.text)) {
            seen.add(part.text); inspectRequest(aliases.get(part.text)!);
          }
          if (ts.isPropertyAssignment(part) && part.name.getText(file) === 'query') {
            const target = reference(part.initializer); if (target) references.add(target);
          }
          ts.forEachChild(part, inspectRequest);
        };
        for (const arg of node.arguments) inspectRequest(arg);
      }
      if (name === 'route') for (const arg of node.arguments) {
        if (ts.isObjectLiteralExpression(arg)) for (const property of arg.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText(file) === 'handler') {
            const target = reference(property.initializer);
            if (target) references.add(target);
          }
        }
      }
    }

    // The access inspector handles query/mutation/action builders; HTTP handlers use function arguments.
    if (isConvexEntryFile(path) && ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        const call = declaration.initializer;
        if (ts.isIdentifier(declaration.name) && call && ts.isCallExpression(call) && ts.isIdentifier(call.expression) && httpBuilders.has(call.expression.text)) {
          functions.add(`${modulePath(path).slice(7)}:${declaration.name.text}`);
          directBindings.set(declaration.name.text, `${modulePath(path).slice(7)}:${declaration.name.text}`);
        }
      }
    }
    if (isConvexEntryFile(path) && ts.isExportAssignment(node) && ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression) && httpBuilders.has(node.expression.expression.text)) {
      functions.add(`${modulePath(path).slice(7)}:default`);
    }
    // Don't count a local HTTP handler's declaration as a caller.
    if (ts.isIdentifier(node) && ts.isVariableDeclaration(node.parent) && node.parent.name === node) return;
    ts.forEachChild(node, visit);
  }
  visit(file);
  return { references, functions };
}
