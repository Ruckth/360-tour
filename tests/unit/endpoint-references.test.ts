import { expect, it } from 'vitest';
import { inspectEndpointReferences } from '../../scripts/lib/endpoint-references';
const inspect = (body: string) => [...inspectEndpointReferences('src/example.ts', `import { api as endpoints } from '../convex/_generated/api'; import { query as unused } from '../convex/pos/orders'; ${body}`).references];
it('ignores unused strings, imports, declarations and type references', () => {
  expect(inspect("const note = 'pos/orders:orphan'; const ref = endpoints.pos.orders.list; type T = typeof endpoints.pos.orders.list;")).toEqual([]);
});
it('follows a local reference alias into a supported hook', () => {
  expect(inspect('const ref = endpoints.pos.orders.list; const alias = ref; useQuery(alias, {});')).toEqual(['pos/orders:list']);
});
it('requires makeFunctionReference to be consumed', () => {
  expect(inspect("const ref = makeFunctionReference('pos/orders:list');")).toEqual([]);
  expect(inspect("const ref = makeFunctionReference('pos/orders:list'); client.query(ref, {});")).toEqual(['pos/orders:list']);
});
it.each([
  'useMutation(ref)', 'useAction(ref)', 'usePaginatedQuery(ref, {})',
  'client.query(ref, {})', 'client.mutation(ref, {})', 'client.action(ref, {})',
  'ctx.runQuery(ref, {})', 'ctx.runMutation(ref, {})', 'ctx.runAction(ref, {})',
  'ctx.scheduler.runAfter(0, ref, {})', 'ctx.scheduler.runAt(new Date(), ref, {})',
  'crons.interval("work", {minutes: 1}, ref, {})',
])('recognizes supported consumption: %s', call => {
  expect(inspect(`const ref = endpoints.pos.orders.list; ${call};`)).toEqual(['pos/orders:list']);
});
it('resolves imported hook aliases', () => {
  expect(inspect('import { useQuery as read } from "convex/react"; read(endpoints.pos.orders.list, {});')).toEqual(['pos/orders:list']);
});
