import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from 'convex/_generated/api';
import type { CheckoutBackend, OrderId, OrdersPage, OrderView } from '@/components/checkout/backend';
import { convexCheckoutBackend } from '@/components/checkout/convex-backend';
import { createFixtureBackend } from '../support/checkout-backend';

const { usePaginatedQuery } = vi.hoisted(() => ({ usePaginatedQuery: vi.fn() }));
vi.mock('convex/react', () => ({ usePaginatedQuery, useQuery: vi.fn(), useMutation: vi.fn() }));

let root: Root;
let page: OrdersPage;
let currentOrder: OrderView | null | undefined;
function Probe({ backend, orderId = null }: { backend: CheckoutBackend; orderId?: OrderId | null }) {
	page = backend.useOpenOrders();
	currentOrder = backend.useOrder(orderId);
	return null;
}
const render = (backend: CheckoutBackend, orderId?: OrderId) => act(async () => root.render(createElement(Probe, { backend, orderId })));

beforeEach(() => {
	vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
	root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
	await act(async () => root.unmount());
	document.body.innerHTML = '';
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it('subscribes to the checkout query with an initial page of 20', async () => {
	const result: OrdersPage = { results: [], status: 'LoadingFirstPage', loadMore: vi.fn() };
	usePaginatedQuery.mockReturnValue(result);
	await render(convexCheckoutBackend);
	expect(usePaginatedQuery).toHaveBeenCalledWith(api.pos.orders.listOpenOrders, {}, { initialNumItems: 20 });
	expect(page).toBe(result);
});

it('pages fixture open orders, preserves cross-staff recall and reacts to discarded orders', async () => {
	const backend = await createFixtureBackend();
	const actions = backend.useActions();
	const created = await Promise.all(Array.from({ length: 72 }, (_, i) => actions.addItem({ item: { kind: 'extra', name: `Sale ${i}`, price: 10000 } })));
	backend.setStaff({ role: 'cashier', email: 'another-cashier@example.com' });
	await render(backend);
	expect(page.results).toHaveLength(20);
	expect(page.status).toBe('CanLoadMore');
	expect(page.results.every(row => row.state === 'unpaid' && row.itemCount > 0)).toBe(true);
	await act(async () => page.loadMore(1000));
	expect(page.results).toHaveLength(70);
	expect(page.status).toBe('CanLoadMore');
	await act(async () => page.loadMore(20));
	expect(page.status).toBe('Exhausted');
	for (const { orderId } of created) expect(page.results.some(row => row._id === orderId)).toBe(true);
	const before = page.results;
	await act(async () => backend.setStaff({ role: 'manager', email: 'manager@example.com' }));
	expect(page.results).toEqual(before);
	const orderId = created[0].orderId;
	await render(backend, orderId);
	await act(async () => { await actions.discardOrder({ orderId, expectedRevision: currentOrder!.order.revision, reason: 'Set aside', idempotencyKey: 'open-orders-discard' }); });
	expect(page.results.some(row => row._id === orderId)).toBe(false);
	expect(page.results).toHaveLength(before.length - 1);
});
