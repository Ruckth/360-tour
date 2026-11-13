// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const now = Date.parse('2026-11-12T03:00:00Z');
const paginationOpts = { numItems: 20, cursor: null };

beforeEach(() => vi.stubEnv('ADMIN_EMAILS', 'owner@example.com'));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
	const t = convexTest(schema, modules);
	const owner = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner' });
	const manager = t.withIdentity({ email: 'manager@example.com', tokenIdentifier: 'issuer|manager' });
	const cashier = t.withIdentity({ email: 'cashier@example.com', tokenIdentifier: 'issuer|cashier' });
	for (const [email, role, tokenIdentifier] of [
		['manager@example.com', 'manager', 'issuer|manager'],
		['cashier@example.com', 'cashier', 'issuer|cashier']
	] as const) {
		await t.run(ctx => ctx.db.insert('staffGrants', { email, role, tokenIdentifier, createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com' }));
	}
	let number = 0;
	const order = (patch: Partial<Doc<'bills'>> = {}) => t.run(ctx => ctx.db.insert('bills', {
		status: 'draft', orderNumber: ++number, currency: 'THB', itemCount: 1, hasItems: true, total: 100,
		due: 75, revision: 1, createdBy: 'cashier@example.com', createdAt: now, updatedAt: now + number,
		...patch
	}));
	return { t, owner, manager, cashier, order };
}

describe('checkout open orders', () => {
	it('lets cashiers recall open orders from any creator, including legacy held orders', async () => {
		const { cashier, order } = await setup();
		const own = await order();
		const other = await order({ createdBy: 'another-cashier@example.com' });
		const legacy = await order({ status: 'held', createdBy: 'manager@example.com', updatedAt: now - 1000 });
		const page = await cashier.query(api.pos.listOpenOrders, { paginationOpts });
		expect(page.page.map(row => row._id)).toEqual([legacy, other, own]);
		for (const row of page.page) {
			expect(await cashier.query(api.pos.findOrderByNumber, { orderNumber: row.orderNumber! })).toBe(row._id);
			expect(await cashier.query(api.pos.getOrder, { orderId: row._id })).not.toBeNull();
		}
	});

	it('excludes empty, paid, void and discarded orders even when the cashier can read today’s receipts', async () => {
		const { cashier, order } = await setup();
		const open = await order();
		await order({ hasItems: false, itemCount: 0, total: 0, due: 0 });
		for (const status of ['paid', 'void', 'discarded'] as const) await order({ status, paidAt: Date.now(), due: 0 });
		expect((await cashier.query(api.pos.listOpenOrders, { paginationOpts })).page.map(row => row._id)).toEqual([open]);
	});

	it.each(['manager', 'owner'] as const)('gives the %s all open orders with exactly the manager browser row shape', async role => {
		const fixture = await setup();
		const { t, order } = fixture;
		const customerId = await t.run(ctx => ctx.db.insert('customers', {
			name: 'Checkout customer', createdBy: 'owner@example.com', createdAt: now, updatedAt: now
		}));
		const id = await order({ customerId });
		await order({ status: 'held', createdBy: 'other@example.com', guestName: 'Legacy guest' });
		await order({ status: 'paid' });
		await order({ status: 'discarded' });
		const client = fixture[role];
		const page = await client.query(api.pos.listOpenOrders, { paginationOpts });
		expect(page).toEqual(await client.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts }));
		expect(page.page).toHaveLength(2);
		expect(page.page.find(row => row._id === id)).toMatchObject({
			orderNumber: 1, title: 'Order #1', state: 'unpaid', itemCount: 1, total: 100,
			due: 75, refundedAmountSatang: 0, currency: 'THB', updatedAt: now + 1,
			customerName: 'Checkout customer', otherBookings: 0
		});
	});

	it('rejects unauthenticated users and authenticated users without checkout access', async () => {
		const { t } = await setup();
		await expect(t.query(api.pos.listOpenOrders, { paginationOpts })).rejects.toThrow('Not authenticated');
		const outsider = t.withIdentity({ email: 'outsider@example.com', tokenIdentifier: 'issuer|outsider' });
		await expect(outsider.query(api.pos.listOpenOrders, { paginationOpts })).rejects.toThrow('Not authorized');
	});

	it.each(['cashier', 'manager'] as const)('paginates for the %s across legacy and draft orders without repeats or closed rows', async role => {
		const fixture = await setup();
		const { order } = fixture;
		const draft1 = await order();
		const draft2 = await order({ createdBy: 'other@example.com' });
		const held1 = await order({ status: 'held' });
		const held2 = await order({ status: 'held' });
		await order({ status: 'paid' });
		await order({ hasItems: false });
		const client = fixture[role];
		const first = await client.query(api.pos.listOpenOrders, { paginationOpts: { numItems: 2, cursor: null } });
		expect(first.isDone).toBe(false);
		expect(first.page.map(row => row._id)).toEqual([held2, held1]);
		const second = await client.query(api.pos.listOpenOrders, { paginationOpts: { numItems: 2, cursor: first.continueCursor } });
		expect(second.page.map(row => row._id)).toEqual([draft2, draft1]);
		const last = second.isDone ? second : await client.query(api.pos.listOpenOrders, { paginationOpts: { numItems: 2, cursor: second.continueCursor } });
		expect(last.isDone).toBe(true);
		if (last !== second) expect(last.page).toEqual([]);
	});

	it('caps the indexed page at 50 even with a large requested page and many excluded orders', async () => {
		const { cashier, order } = await setup();
		const ids = [];
		for (let i = 0; i < 53; i++) {
			ids.push(await order());
			await order({ status: 'paid' });
			await order({ hasItems: false });
		}
		const first = await cashier.query(api.pos.listOpenOrders, { paginationOpts: { numItems: 1000, cursor: null } });
		expect(first.page.map(row => row._id)).toEqual([...ids].reverse().slice(0, 50));
		expect(first.isDone).toBe(false);
		const second = await cashier.query(api.pos.listOpenOrders, { paginationOpts: { numItems: 1000, cursor: first.continueCursor } });
		expect(second.page.map(row => row._id)).toEqual([...ids].reverse().slice(50));
		expect(second.isDone).toBe(true);
	});
});
