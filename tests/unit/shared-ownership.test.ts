import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const base = '4748b630c3a4fc52cd6be3fb2c6b3b7802f5e19c';
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
const sourceFiles = () => [...walk('convex'), ...walk('src')].filter(file => /\.tsx?$/.test(file) && !/\.test\.ts$|\/_generated\//.test(file));
const tree = (file: string, source = readFileSync(file, 'utf8')) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const resolve = (file: string, spec: string) => (spec.startsWith('.') ? normalize(join(dirname(file), spec)) : spec) + '.ts';

it('retires every pure lib implementation and forbids browser/backend and shared/lib imports', () => {
  const old = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'convex/lib'], { encoding: 'utf8' }).trim().split('\n');
  const exceptions = ['adminEmails', 'maintenance', 'readBudget'].map(name => `convex/lib/${name}.ts`);
  for (const file of old.filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts') && !exceptions.includes(file))) expect(existsSync(file), `Retired ${file}`).toBe(false);
  for (const file of ['src/lib/booking/quote.ts', 'src/lib/booking/phone.ts', 'src/lib/booking/blocked-months.ts', 'convex/shared/resortLocalParts.ts']) expect(existsSync(file)).toBe(false);
  expect(walk('convex/lib').sort()).toEqual(exceptions.sort());
  for (const file of sourceFiles()) {
    for (const node of tree(file).statements) {
      if ((!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const target = resolve(file, node.moduleSpecifier.text);
      if (file.startsWith('src/') && target.startsWith('convex/') && !['convex/values.ts', 'convex/server.ts', 'convex/browser.ts', 'convex/react.ts', 'convex/react-clerk.ts'].includes(target)) expect(target).toMatch(/^convex\/(?:shared|_generated)\//);
      if (file.startsWith('convex/')) expect(target).not.toMatch(/^src\/|^@\//);
      if (file.startsWith('convex/shared/') && target.startsWith('convex/')) {
        expect(target).toMatch(/^convex\/(?:shared\/|_generated\/dataModel\.ts$|values\.ts$)/);
        if (target.includes('/_generated/')) expect(ts.isImportDeclaration(node) && node.importClause?.isTypeOnly).toBe(true);
      }
    }
    if (file === 'convex/shared/time.ts') expect(readFileSync(file, 'utf8')).not.toMatch(/Intl\.|@date-fns/);
    if (file.startsWith('convex/shared/')) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/\bprocess\.env\b|\bfetch\s*\(|\bctx\s*[:.]|_generated\/server|@date-fns\/tz/);
    }
  }
});

it('keeps the domain model interfaces, twelve consumed POS helpers and an acyclic runtime graph', () => {
  function exportsOf(file: string, source: string) {
    return tree(file, source).statements.flatMap(node => {
      if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) return node.exportClause.elements.map(entry => entry.name.text);
      if ('modifiers' in node && (node.modifiers as ts.NodeArray<ts.Modifier> | undefined)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isVariableStatement(node)) return node.declarationList.declarations.map(d => d.name.getText());
        if ('name' in node) return [(node.name as ts.Identifier).text];
      }
      return [];
    }).sort();
  }
  for (const domain of ['auth', 'bookings', 'catalog', 'concierge', 'marketing', 'messaging', 'pos', 'services', 'settings']) {
    const file = `convex/${domain}/model.ts`;
    expect(exportsOf(file, readFileSync(file, 'utf8'))).toEqual(exportsOf(file, execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' })));
    if (domain === 'pos') expect(exportsOf(file, readFileSync(file, 'utf8'))).toHaveLength(12);
  }
  const graph = new Map<string, string[]>();
  for (const file of sourceFiles().filter(file => file.startsWith('convex/'))) {
    const emitted = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
    graph.set(file, tree(file, emitted).statements.flatMap(node =>
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? [resolve(file, node.moduleSpecifier.text)].filter(target => target.startsWith('convex/') && !target.includes('/_generated/')) : []));
  }
  const complete = new Set<string>();
  function visit(file: string, stack: string[]) {
    expect(stack, `Runtime cycle: ${[...stack, file].join(' → ')}`).not.toContain(file);
    if (complete.has(file)) return;
    for (const target of graph.get(file) ?? []) visit(target, [...stack, file]);
    complete.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
}, 30_000);

it('preserves the actual relocated pure implementations against the exact parent', () => {
  const unchanged = ['affiliateTypes', 'bookingMoney', 'chatCouponCopy', 'chatPresence', 'chatReuse', 'chatSuggestions', 'chatWriteGuard', 'codes', 'displayLease', 'displayTokens', 'financeValidators', 'guestCouponCode', 'ical', 'imageUploads', 'inboxTypes', 'marketingPolicy', 'marketingPrivacy', 'marketingSlugs', 'offers', 'orderMath', 'appointmentWindow', 'posCoupons', 'replyCards', 'serviceSchedule', 'siteSettings', 'slug', 'staffTypes', 'stayMoney', 'validation'];
  function declarations(file: string, source: string) {
    return tree(file, source).statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node));
  }
  function tokens(source: string) {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
    const result: Array<[number, string]> = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, scanner.getTokenText()]);
    return result;
  }
  const moves = [
    ...unchanged.map(name => [`convex/lib/${name}.ts`, `convex/shared/${name}.ts`]),
    ['src/lib/booking/phone.ts', 'convex/shared/phone.ts'],
    ['convex/concierge/copy.ts', 'convex/shared/conciergeCopy.ts'],
  ];
  for (const [before, after] of moves) {
    const old = declarations(before, execFileSync('git', ['show', `${base}:${before}`], { encoding: 'utf8' }));
    const current = declarations(after, readFileSync(after, 'utf8'));
    // validation deliberately combines two pre-existing shared leaves; all old declarations survive.
    expect(tokens(current.slice(0, old.length).map(n => n.getText()).join('\n')), after).toEqual(tokens(old.map(n => n.getText()).join('\n')));
  }
});
