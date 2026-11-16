import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import ts from 'typescript';
import { inspectArchitecture, SOURCE_EXTENSION, isConvexEntryFile, isTestSource, modulePath, importTarget } from '../../scripts/lib/architecture.mjs';
import { inspectRuntimeGraph } from '../../scripts/lib/architecture-graph.mjs';
import { inspectConvexAccess } from '../../scripts/lib/convex-access.mjs';

const issues = (path: string, source: string) => [
  ...inspectArchitecture(path, source).map(issue => issue.message),
  ...(path.startsWith('convex/') ? inspectConvexAccess(path, source).violations : []),
];

it.each([
  ['convex/pos/leak.ts', "import { query } from '../_generated/server'; export const leak = query({args:{},handler:()=>null});"],
  ['convex/pos/model.ts', "import { adminQuery } from '../auth/model'; export const leak = adminQuery({args:{},handler:()=>null});"],
  ['convex/shared/leak.ts', 'export const leak = process.env.SECRET;'],
  ['convex/catalog/leak.ts', "import { helper } from '../pos/private/orderLinks';"],
])('preserves independent guard findings with a shared parse and refuses stale source: %s', (path, source) => {
  const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  expect(inspectArchitecture(path, source, parsed)).toEqual(inspectArchitecture(path, source));
  expect(inspectConvexAccess(path, source, parsed)).toEqual(inspectConvexAccess(path, source));
  expect(issues(path, source)).not.toEqual([]);
  for (const inspect of [inspectArchitecture, inspectConvexAccess]) {
    expect(() => inspect(path, source + ' ', parsed)).toThrow('does not match');
    expect(() => inspect(path.replace('.ts', '-other.ts'), source, parsed)).toThrow('does not match');
  }
});

it.each(['ts', 'tsx', 'js', 'mjs'])('inspects deployed .%s sources including aliased and namespace raw builders', ext => {
  for (const source of [
    "import { query as renamed } from '../_generated/server.js'; export const leak = renamed({args:{},handler:()=>null});",
    "import * as server from '../_generated/server.mjs'; export const leak = server['query']({});",
    "export { mutationGeneric as innocent } from 'convex/server';",
    "export * from '../_generated/server.ts';",
    "export * as server from 'convex/server';",
    "const load = require; const server = load('../_generated/server');",
    "const { query: renamed } = require('../_generated/server');",
    "const server = await import('../_generated/server');",
  ]) expect(issues(`convex/catalog/leak.${ext}`, source), source).not.toEqual([]);
});

it.each(['convex/testing/leak.ts', 'convex/pos/tests/leak.js', 'convex/tests/leak.mjs'])('does not exempt deployed test-directory registrations: %s', path => {
  const raw = "import { query } from 'convex/server'; export const leak = query({args:{},handler:()=>null});";
  expect(isConvexEntryFile(path)).toBe(true);
  expect(inspectConvexAccess(path, raw).violations).not.toEqual([]);
  expect(issues(path, raw)).not.toEqual([]);
  expect(inspectConvexAccess(path, "import { adminQuery } from 'convex/auth/model'; export const leak = adminQuery({args:{},handler:()=>null});").violations).not.toEqual([]);
});

it.each(['cjs', 'mts', 'cts', 'jsx'])('scans and rejects unsupported Convex .%s entry points instead of skipping them', extension => {
  const path = `convex/pos/leak.${extension}`;
  expect(SOURCE_EXTENSION.test(path)).toBe(true);
  expect(isConvexEntryFile(path)).toBe(true);
  expect(inspectArchitecture(path, 'export const value = 1;')).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'extension' })]));
  expect(inspectConvexAccess(path, '').violations).not.toEqual([]);
});

it.each(['ownerQuery', 'marketingAction', 'guestAction'])('fails explicitly on an unregistered access builder: %s', builder => {
  expect(inspectConvexAccess('convex/pos/model.ts', `import { ${builder} } from '../auth/model'; export const leak = ${builder}({args:{},handler:()=>null});`).violations).toEqual(expect.arrayContaining([expect.stringContaining('unknown access builder')]));
});

it('limits raw public builders to the exact auth model and preserves internal builder reexports', () => {
  const raw = "import { query as rawQuery } from '../_generated/server';";
  expect(issues('convex/auth/model.ts', raw)).toEqual([]);
  expect(issues('convex/auth/model.js', raw)).not.toEqual([]);
  expect(issues('convex/auth/users.ts', raw)).not.toEqual([]);
  expect(issues('convex/auth/private/access.ts', raw.replace('../_generated', '../../_generated'))).not.toEqual([]);
  expect(issues('convex/auth/model.ts', "export { internalQuery, internalMutation, internalAction } from '../_generated/server';")).toEqual([]);
  expect(issues('convex/auth/model.ts', "export { query } from '../_generated/server';")).not.toEqual([]);
});

it.each([
  ['convex/rogue.ts', "import { adminMutation } from './auth/model'; export const write = adminMutation({args:{},handler:()=>null});"],
  ['convex/lib/rogue.js', 'export async function load(context) { return context.db.query("orders"); }'],
  ['convex/lib/readBudget.ts', 'export function load(context) { return context.db.query("orders"); }'],
  ['convex/pos/model.ts', "import { internalQuery as own } from '../auth/model'; export const read = own({args:{},handler:()=>null});"],
  ['convex/pos/private/read.mjs', "import { adminQuery } from '../../auth/model'; export const read = adminQuery({args:{},handler:()=>null});"],
  ['convex/pos/orders.ts', "import { adminQuery as builder } from '../auth/model'; const alias = builder; export const read = alias({});"],
  ['convex/pos/orders.ts', "import * as access from '../auth/model'; export const read = access.adminQuery({});"],
  ['convex/pos/orders.ts', "import { adminQuery } from '../auth/model'; const read = adminQuery({}); export { read };"],
  ['convex/pos/orders.ts', "import { adminQuery } from '../auth/model'; export const read = adminQuery(options);"],
])('rejects misplaced or ambiguous registration/ctx forms in %s', (path, source) => {
  expect(issues(path, source)).not.toEqual([]);
});

it.each([
  "import { hidden } from '../services';",
  "export { hidden } from 'convex/services';",
  "import { hidden as alias } from '../services/private/photos.js';",
  "import type { Hidden } from '../services/appointments.tsx';",
  "export * from '../services/appointments.mjs';",
  "export * as helpers from '../services/private/photos';",
  "const helpers = await import('../services/private/photos');",
  "const helpers = require('../services/private/photos');",
  "type Hidden = import('../services/private/photos').Hidden;",
  "import helpers = require('../services/private/photos');",
  "await import('../' + domain + '/private/photos');",
])('requires cross-domain model imports for %s', source => {
  expect(issues('convex/pos/orders.ts', source)).not.toEqual([]);
});

it.each([
  "import type { Hidden } from 'convex/pos/model.js';",
  "export * from '../../convex/pos/private/orderLinks.mjs';",
  "export * as backend from 'convex/bookings/bookings';",
  "await import('convex/lib/readBudget');",
  "type Context = import('convex/_generated/server').QueryCtx;",
  "const backend = require('convex/services/model');",
])('keeps browser dependencies off backend implementations for %s', source => {
  expect(issues('src/components/leak.tsx', source)).not.toEqual([]);
});

it.each([
  "import type { QueryCtx as Context } from '../_generated/server';",
  "import { publicQuery as register } from '../auth/model';",
  "export * from '../lib/readBudget';",
  "import { helpers } from '../pos/model';",
  "export const url = process['env'].URL;",
  "const { env } = process;",
  "const send = globalThis.fetch;",
  "const send = globalThis['fetch'];",
  "const send = globalThis[name];",
  "const runtime = globalThis; export const send = runtime['fetch'];",
  "const { fetch: send } = globalThis;",
  "const socket = new WebSocket('wss://example.test');",
  "const environment = import.meta.env;",
  "import { readFile } from 'node:fs/promises';",
  'export function total(ctx) { return ctx.db.get("id"); }',
])('enforces shared purity for %s', source => {
  expect(issues('convex/shared/leak.ts', source)).not.toEqual([]);
});

it('preserves legitimate typed browser/shared imports, domain models and focused private tests', () => {
  expect(issues('src/components/good.tsx', "import type { Doc } from 'convex/_generated/dataModel'; import type { PriceQuote } from 'convex/shared/pricing.js'; import { api } from 'convex/_generated/api'; import { useQuery } from 'convex/react';")).toEqual([]);
  expect(issues('convex/shared/good.ts', "import { type Doc } from '../_generated/dataModel'; import { v } from 'convex/values'; import { percentageOf } from './money'; // process.env and fetch() are only a comment\n export const label = 'ctx.db.query';")).toEqual([]);
  expect(issues('convex/shared/data.ts', 'export const audit = { process: "booking", fetch: "caption" }; export type Details = { ctx: string }; export const label = audit.process;')).toEqual([]);
  expect(issues('convex/shared/crypto.ts', 'export const digest = globalThis.crypto.subtle;')).toEqual([]);
  expect(issues('convex/shared/parameters.ts', 'export function title(document: { title: string }) { return document.title; } const process = "booking"; export const label = process;')).toEqual([]);
  expect(issues('convex/shared/fields.ts', 'type Callback = Function; export function copy(data: { window: number, document: string }) { const { document: label } = data; return { window: data.window, label }; }')).toEqual([]);
  expect(issues('convex/pos/orders.ts', "import { createAppointmentRecord } from '../services/model.js'; import { internalMutation as command } from '../auth/model'; export const write = command({ args: {}, handler: () => null });")).toEqual([]);
  expect(issues('convex/pos/private/orderLinks.test.ts', "import { privateHelper } from '../../services/private/photos';")).toEqual([]);
  expect(issues('tests/unit/example.test.ts', "import { privateHelper } from '../../convex/pos/private/orderLinks';")).toEqual([]);
});

it.each([
  "import { fixture } from '../../../tests/support/checkout-backend';",
  "import { fixture } from './fixture.test';",
  "export * from '../../../tests';",
])('keeps browser production code off test infrastructure: %s', source => {
  expect(issues('src/components/admin/feature.tsx', source)).not.toEqual([]);
});

it('refuses invalid syntax and runtime cycles or registrations behind model interfaces', () => {
  expect(issues('convex/pos/orders.ts', 'import {')).not.toEqual([]);
  expect(inspectRuntimeGraph({
    'convex/pos/model.ts': "export { read } from './orders.js';",
    'convex/pos/orders.ts': "import { internalQuery } from '../auth/model'; export const read = internalQuery({args:{},handler:()=>null});",
  })).toEqual(expect.arrayContaining([expect.stringContaining('reexports endpoint registrations')]));
  expect(inspectRuntimeGraph({
    'convex/pos/model.ts': "import { read as hidden } from './orders'; export { hidden as safe };",
    'convex/pos/orders.ts': "import { internalQuery } from '../auth/model'; export const read = internalQuery({args:{},handler:()=>null});",
  })).toEqual(expect.arrayContaining([expect.stringContaining('reexports endpoint registrations')]));
  expect(inspectRuntimeGraph({
    'convex/pos/model.ts': "export { b } from './private/b';",
    'convex/pos/private/b.mjs': "export { a } from '../model';",
  })).toEqual(expect.arrayContaining([expect.stringContaining('Runtime cycle')]));
  expect(inspectRuntimeGraph({ 'convex/pos/same.ts': '', 'convex/pos/same.js': '' })).toEqual(['Ambiguous deployed module: convex/pos/same']);
  expect(inspectRuntimeGraph({
    'convex/pos/model.ts': "import type { B } from './private/b'; export type A = B;",
    'convex/pos/private/b.ts': "import type { A } from '../model'; export type B = A[];",
  })).toEqual([]);
});

it('checks every current deployed source and actual emitted backend graph without historical snapshots', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.name === '_generated' ? [] : entry.isDirectory() ? walk(join(dir, entry.name)) : SOURCE_EXTENSION.test(entry.name) ? [join(dir, entry.name)] : []);
  }
  const sources = Object.fromEntries([...walk('src'), ...walk('convex')].map(path => [path, readFileSync(path, 'utf8')]));
  for (const [path, source] of Object.entries(sources)) expect(issues(path, source), path).toEqual([]);
  expect(inspectRuntimeGraph(sources)).toEqual([]);
}, 30_000);

it.each([
  "import { read as registeredRead } from './orders'; export const forwarded = registeredRead;",
  "import { read } from './orders'; const renamed = read; export { renamed as forwarded };",
  "import * as endpoints from './orders'; export const forwarded = endpoints.read;",
  "import * as endpoints from './orders'; const renamed = endpoints; export const forwarded = renamed['read'];",
])('rejects endpoint aliases forwarded through a model: %s', model => {
  expect(inspectRuntimeGraph({
    'convex/pos/model.ts': model,
    'convex/pos/orders.ts': "import { internalQuery } from '../auth/model'; export const read = internalQuery({args:{},handler:()=>null});",
  })).toEqual(expect.arrayContaining([expect.stringContaining('reexports endpoint registrations')]));
});

// Unit tests and generated declarations must never keep a deployed endpoint alive.
// Existing contract exceptions are explicit; new test-only endpoints must not join implicitly.
const functionReferenceAllowlist: Record<string, string> = {
  "auth/users:current": "Tested token-scoped user lookup; external sign-in clients have not been ruled out.",
  "auth/users:store": "Tested idempotent Clerk identity sync; external sign-in clients have not been ruled out.",
  "bookings/bookings:listByProperty": "Retained paged admin booking contract covered by listPagination and adminBookings tests.",
  "bookings/bookings:markPaidFromTrustedWebhook": "Retained trusted-payment integration contract; external operator usage is unverified.",
  "bookings/bookings:quoteStay": "Existing tested public quote contract; removal is outside this cleanup.",
  "bookings/calendar/addDateBlock:addDateBlock": "Existing tested single-block admin contract alongside the batch writer.",
  "bookings/calendar/availability:getForProperty": "Existing tested public availability projection; removal is outside this cleanup.",
  "catalog/properties:adminGet": "Tested admin property lookup contract; no production caller confirmed.",
  "catalog/properties:getById": "Tested public property projection; external client usage is unverified.",
  "catalog/properties:getBySlug": "Tested public slug lookup; external client usage is unverified.",
  "catalog/properties:getReviews": "Tested active-property review projection; external client usage is unverified.",
  "catalog/properties:getRooms": "Tested active-property room projection; external client usage is unverified.",
  "catalog/properties:getSocialProof": "Tested active-property social proof projection; external client usage is unverified.",
  "catalog/properties:getTourSnippets": "Tested public tour projection; external client usage is unverified.",
  "catalog/reviewMaintenance:initialize": "Operator CLI entry point documented in the Phase 4 initialization runbook.",
  "concierge/businessFacts:adminPropertyOptions": "Tested admin authoring property-options contract; no production caller confirmed.",
  "concierge/runTurn:runTurn": "Durable-turn RPC retained for queued jobs and the turn test harness; worker now calls its helper.",
  "maintenance/aiEval:cancelTestBookings": "Operator CLI entry point documented in maintenance/aiEval.ts.",
  "maintenance/aiEval:cleanup": "Operator CLI entry point documented in maintenance/aiEval.ts.",
  "maintenance/aiEval:seed": "Operator CLI entry point documented in maintenance/aiEval.ts.",
  "marketing/access:listGrants": "Existing tested marketing access-management contract; removal is outside this cleanup.",
  "messaging/adminChat:getTranscript": "Explicit compatibility transcript contract retains ten-event lists.",
  "messaging/chat:acceptGuestMessage": "Existing tested message-ingress RPC contract; removal is outside this cleanup.",
  "messaging/chat:addAssistantMessageWithSuggestions": "Existing tested assistant-write RPC contract; removal is outside this cleanup.",
  "messaging/chat:isAiPaused": "Tested guest-token pause lookup contract; external client usage is unverified.",
  "messaging/projectionMaintenance:initializeInbox": "Operator CLI entry point documented in the Phase 4 initialization runbook.",
  "pos/catalog:catalog": "Explicit compatibility endpoint for combined catalog and ranking subscriptions.",
  "pos/commands/openOrderFor:openOrderFor": "Existing tested source-order contract alongside the linked-source writer.",
  "pos/customers:checkoutCustomer": "Tested permission-limited customer projection; no production caller confirmed.",
  "services/serviceBookings:listActiveServices": "Existing tested internal service-list contract; removal is outside this cleanup.",
  "settings/settings:admins": "Tested privileged admin-email lookup contract; no production caller confirmed.",
};

it('gives every exported Convex function a non-test caller or a documented exception', () => {
  const sources = new Map<string, ts.SourceFile>();
  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '_generated') walk(path);
      } else if (SOURCE_EXTENSION.test(path) && !isTestSource(path) && !path.endsWith('.d.ts')) {
        sources.set(path, ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true));
      }
    }
  }
  for (const dir of ['convex', 'src', 'scripts']) walk(dir);
  const functions = new Set<string>();
  const references = new Set<string>();
  for (const [path, file] of sources) {
    if (isConvexEntryFile(path)) {
      const inspected = inspectConvexAccess(path, file.text, file);
      expect(inspected.violations, path).toEqual([]);
      for (const name of inspected.endpoints) functions.add(`${modulePath(path).slice(7)}:${name}`);
    }
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
    function visit(node: ts.Node) {
      const parts = apiPath(node);
      if (parts && parts.length >= 2) references.add(`${parts.slice(0, -1).join('/')}:${parts.at(-1)}`);
      // Includes makeFunctionReference, CLI function paths, cron and scheduler calls.
      if (ts.isStringLiteralLike(node) && /^[\w/-]+:\w+$/.test(node.text)) references.add(node.text);
      if (ts.isIdentifier(node) && directBindings.has(node.text) && !ts.isImportSpecifier(node.parent) && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) references.add(directBindings.get(node.text)!);
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
  }
  expect(functions.size).toBeGreaterThan(0);
  for (const [path, reason] of Object.entries(functionReferenceAllowlist)) {
    expect(functions.has(path), `Stale function allowlist entry: ${path}`).toBe(true);
    expect(reason.trim(), path).not.toBe('');
  }
  expect([...functions].filter(path => !references.has(path) && !functionReferenceAllowlist[path]).sort(),
    'Convex exports need a production reference or a one-line allowlist reason').toEqual([]);
});
