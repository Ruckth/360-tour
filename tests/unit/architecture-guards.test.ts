import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { inspectArchitecture, SOURCE_EXTENSION } from '../../scripts/lib/architecture.mjs';
import { inspectRuntimeGraph } from '../../scripts/lib/architecture-graph.mjs';
import { inspectConvexAccess } from '../../scripts/lib/convex-access.mjs';

const issues = (path: string, source: string) => [
  ...inspectArchitecture(path, source).map(issue => issue.message),
  ...(path.startsWith('convex/') ? inspectConvexAccess(path, source).violations : []),
];

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
  expect(issues('convex/pos/orders.ts', "import { createAppointmentRecord } from '../services/model.js'; import { internalMutation as command } from '../auth/model'; export const write = command({ args: {}, handler: () => null });")).toEqual([]);
  expect(issues('convex/pos/private/orderLinks.test.ts', "import { privateHelper } from '../../services/private/photos';")).toEqual([]);
  expect(issues('tests/unit/example.test.ts', "import { privateHelper } from '../../convex/pos/private/orderLinks';")).toEqual([]);
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
