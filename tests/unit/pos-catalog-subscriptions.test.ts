// @vitest-environment happy-dom
import { getFunctionName, type FunctionReference } from 'convex/server';
import { act, createElement, Component, type ReactNode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convexCheckoutBackend } from '@/components/checkout/convex-backend';
import type { Catalog } from '@/components/checkout/backend';
const state = vi.hoisted(() => ({ values: {} as Record<string, unknown>, calls: vi.fn() }));
vi.mock('convex/react', () => ({ useQuery: (ref: FunctionReference<'query'>) => {
  const name = getFunctionName(ref); state.calls(name);
  const value = state.values[name]; if (value instanceof Error) throw value; return value;
} }));
let root: Root, current: Catalog | undefined;
const items = { services: [], rooms: [], extras: [], staff: [] };
function Probe() { current = convexCheckoutBackend.useCatalog(); return createElement('p', null, current ? current.frequent.join(',') : 'Loading'); }
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? 'Catalog error' : this.props.children; }
}
const render = () => act(async () => root.render(createElement(Boundary, {} as ComponentProps<typeof Boundary>, createElement(Probe))));
beforeEach(() => { state.values = {}; state.calls.mockClear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); root = createRoot(document.body.appendChild(document.createElement('div'))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('waits for both reactive queries and composes live ranking and catalog edits without defaulting unresolved ranking', async () => {
  await render(); expect(current).toBeUndefined();
  state.values['pos:stableCatalog'] = items;
  await render(); expect(current).toBeUndefined();
  state.values['pos:recentCatalogRanking'] = [];
  await render(); expect(current).toEqual({ ...items, frequent: [] });
  const loaded = current;
  await render(); expect(current).toBe(loaded);
  state.values['pos:recentCatalogRanking'] = ['extra:Tea'];
  await render(); expect(current?.frequent).toEqual(['extra:Tea']);
  expect(current?.services).toBe(items.services);
  const services = [{ _id: 's', name: 'Edited', price: 200, imageUrl: '/new.jpg' }];
  state.values['pos:stableCatalog'] = { ...items, services };
  await render(); expect(current?.services).toBe(services);
  expect(current?.frequent).toEqual(['extra:Tea']);
  expect(new Set(state.calls.mock.calls.map(c => c[0]))).toEqual(new Set(['pos:stableCatalog', 'pos:recentCatalogRanking']));
});
it('also waits when ranking resolves before catalog', async () => {
  state.values['pos:recentCatalogRanking'] = ['extra:Tea'];
  await render(); expect(current).toBeUndefined();
  state.values['pos:stableCatalog'] = items;
  await render(); expect(current?.frequent).toEqual(['extra:Tea']);
});
it.each(['pos:stableCatalog', 'pos:recentCatalogRanking'])('propagates errors from %s to checkout error handling', async name => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  state.values = { 'pos:stableCatalog': items, 'pos:recentCatalogRanking': [], [name]: new Error('Offline') };
  await render(); expect(document.body.textContent).toContain('Catalog error');
});
