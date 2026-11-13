// Check actual emitted dependencies: type-only imports never create runtime cycles.
import ts from 'typescript';
import { importTarget, isTestSource, modulePath, sourceImports } from './architecture.mjs';
import { inspectConvexAccess } from './convex-access.mjs';

/** @param {Record<string, string>} sources */
export function inspectRuntimeGraph(sources) {
  /** @type {Map<string, {path: string, dependencies: string[], endpoints: string[], exports: {name: string, original: string, target: string}[]}>} */
  const modules = new Map();
  /** @type {Set<string>} */
  const issues = new Set();
  for (const [path, source] of Object.entries(sources)) {
    if (!path.startsWith('convex/') || path.includes('/_generated/') || path.endsWith('.d.ts') || isTestSource(path)) continue;
    const key = modulePath(path);
    if (modules.has(key)) issues.add(`Ambiguous deployed module: ${key}`);
    const emitted = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
    const tree = ts.createSourceFile(path, emitted, ts.ScriptTarget.Latest, true);
    const exports = [];
    const imported = new Map();
    for (const node of tree.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const target = importTarget(path, node.moduleSpecifier.text);
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const name of bindings.elements) imported.set(name.name.text, { target, original: (name.propertyName ?? name.name).text });
      if (bindings && ts.isNamespaceImport(bindings)) imported.set(bindings.name.text, { target, original: '*' });
    }
    for (const node of tree.statements) {
      if (!ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier) {
        if (node.exportClause && ts.isNamedExports(node.exportClause)) for (const name of node.exportClause.elements) {
          const binding = imported.get((name.propertyName ?? name.name).text);
          if (binding) exports.push({ name: name.name.text, ...binding });
        }
        continue;
      }
      if (!ts.isStringLiteral(node.moduleSpecifier)) continue;
      const target = importTarget(path, node.moduleSpecifier.text);
      if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) exports.push({ name: '*', original: '*', target });
      else for (const entry of node.exportClause.elements) exports.push({ name: entry.name.text, original: (entry.propertyName ?? entry.name).text, target });
    }
    modules.set(key, { path, exports, dependencies: sourceImports(tree).flatMap(({ specifier }) => specifier ? [importTarget(path, specifier)] : []), endpoints: inspectConvexAccess(path, source).endpoints });
  }
  /** @param {string} target */
  const resolve = target => modules.has(target) ? target : `${target}/index`;
  const done = new Set();
  /** @param {string} key @param {string[]} stack */
  function visit(key, stack) {
    if (stack.includes(key)) { issues.add(`Runtime cycle: ${[...stack, key].join(' → ')}`); return; }
    if (done.has(key)) return;
    for (const target of modules.get(key)?.dependencies ?? []) visit(resolve(target), [...stack, key]);
    done.add(key);
  }
  for (const key of modules.keys()) visit(key, []);
  // A helper can share a file with a registration (concierge/runTurn). Check the
  // exported symbol, not merely whether a registration exists in its dependency graph.
  /** @param {string} key @param {string} name @param {Set<string>} seen @returns {boolean} */
  function forwardsEndpoint(key, name, seen) {
    const token = `${key}:${name}`;
    if (seen.has(token)) return false;
    seen.add(token);
    const entry = modules.get(key);
    if (entry?.endpoints.some(endpoint => name === '*' || endpoint === name)) return true;
    return !!entry?.exports.some(edge => (name === '*' || edge.name === '*' || edge.name === name) && forwardsEndpoint(resolve(edge.target), edge.original === '*' ? name : edge.original, seen));
  }
  for (const [key, entry] of modules) {
    if (key.endsWith('/model') && forwardsEndpoint(key, '*', new Set())) issues.add(`${key} reexports endpoint registrations; export plain helpers through model instead (${entry.path})`);
  }
  return [...issues];
}
