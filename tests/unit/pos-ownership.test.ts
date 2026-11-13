import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const tree = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const resolve = (file: string, spec: string) => normalize(join(dirname(file), spec)) + '.ts';
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? entry.name === '_generated' ? [] : walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const owned = ['orderLines', 'orderRefunds', 'lineLinks', 'orderLinks', 'displayView', 'orderLifecycle', 'staffApprovalState'];

it('owns actual implementations behind named model exports, with no endpoint or cycle in the runtime closure', () => {
  const model = tree('convex/pos/model.ts');
  const declarations = new Map<string, string>();
  for (const node of model.statements) {
    expect(ts.isExportDeclaration(node)).toBe(true);
    if (!ts.isExportDeclaration(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) throw new Error('Expected named helper exports');
    if (!node.exportClause || !ts.isNamedExports(node.exportClause)) throw new Error('No star or namespace exports');
    const target = resolve(model.fileName, node.moduleSpecifier.text);
    for (const entry of node.exportClause.elements) {
      const name = entry.propertyName?.text ?? entry.name.text;
      expect(declarations.has(entry.name.text)).toBe(false);
      const implementation = tree(target).statements.find(statement =>
        ts.isVariableStatement(statement) ? statement.declarationList.declarations.some(d => d.name.getText() === name)
          : 'name' in statement && (statement.name as ts.Identifier | undefined)?.text === name);
      expect(implementation, `${target}:${name} must be an actual declaration`).toBeDefined();
      declarations.set(entry.name.text, target);
    }
  }
  for (const [name, module] of Object.entries({ orderLines: 'orderLines', executeOrderRefund: 'orderRefunds',
    activeSourceLink: 'lineLinks', ensureLinkedOrder: 'orderLinks', displayOrderState: 'displayView',
    liveFees: 'orderLifecycle', assertNoPendingApprovals: 'staffApprovalState' })) expect(declarations.get(name)).toBe(`convex/pos/private/${module}.ts`);
  for (const name of ['executeAttach', 'executeVoidOrder', 'executeLinkPaidLine', 'executeAmendOrderPayment', 'executeStaffApproval']) expect(declarations.has(name)).toBe(false);


  const visited = new Set<string>();
  function closure(file: string, stack: string[] = []) {
    expect(stack, `Runtime cycle through ${file}`).not.toContain(file);
    if (visited.has(file) || file.includes('/_generated/')) return;
    visited.add(file);
    // Transpile erases type-only imports, matching the actual runtime graph.
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
    expect(source, `Registration reachable from model: ${file}`).not.toMatch(/=\s*(?:public|guest|staff|authenticated|device|admin|marketing|internal)(?:Query|Mutation|Action)\s*\(/);
    const runtime = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of runtime.statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      if (node.moduleSpecifier.text.startsWith('.')) closure(resolve(file, node.moduleSpecifier.text), [...stack, file]);
    }
  }
  closure(model.fileName);
  for (const name of owned) expect(visited.has(`convex/pos/private/${name}.ts`)).toBe(true);
});

it('removes old ctx modules, enforces model consumers and keeps browser display types free of backend code', () => {
  for (const name of owned) expect(existsSync(`convex/lib/${name}.ts`)).toBe(false);
  for (const file of [...walk('convex'), ...walk('src')].filter(file => /\.tsx?$/.test(file) && !file.endsWith('.test.ts'))) {
    for (const node of tree(file).statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const spec = node.moduleSpecifier.text;
      const target = spec.startsWith('.') ? resolve(file, spec) : `${spec}.ts`;
      expect(owned.map(name => `convex/lib/${name}.ts`)).not.toContain(target);
      if (file.startsWith('src/')) expect(target).not.toMatch(/^convex\/pos\/(?:model|private\/)/);
      else if (!file.startsWith('convex/pos/') && target.startsWith('convex/pos/') && file !== 'convex/schema.ts') expect(target).toBe('convex/pos/model.ts');
    }
  }
  const shared = tree('convex/shared/displayTypes.ts');
  expect(shared.statements.every(ts.isTypeAliasDeclaration)).toBe(true);
  for (const file of ['src/components/display/DisplayScreens.tsx', 'src/components/admin/CustomerDisplayDialog.tsx']) expect(readFileSync(file, 'utf8')).toContain('convex/shared/displayTypes');
});
