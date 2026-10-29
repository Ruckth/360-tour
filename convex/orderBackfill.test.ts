// @vitest-environment edge-runtime

import migrationsTest from '@convex-dev/migrations/test';
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const page = { numItems: 50, cursor: null };

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

/** Bills as the walk-in checkout wrote them: no order number, walk-in numbers, copied guest names. */
async function legacyData() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	migrationsTest.register(t);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const ids = await t.run(async (ctx) => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 4,
			bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		});
		const stay = (guestName: string, extra: Partial<Doc<'bookings'>> = {}) => ctx.db.insert('bookings', {
			propertyId, guestName, guestPhone: '0800000000', checkIn: '2026-10-01', checkOut: '2026-10-02', guests: 1, nights: 1,
			subtotal: 10000, discountAmount: 0, total: 10000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: 1, ...extra
		});
		const annaStay = await stay('Anna', { amountPaid: 4000 });
		const bobStay = await stay('Bob');
		const carlStay = await stay('Carl', { paymentStatus: 'paid', amountPaid: 10000 });
		const base = { currency: 'THB', createdBy: 'admin@example.com', revision: 3 };
		const bill = (n: number, fields: Partial<Doc<'bills'>>) =>
			ctx.db.insert('bills', { ...base, status: 'draft', walkInNumber: n, itemCount: 0, total: 0, hasItems: false, createdAt: n, updatedAt: n, ...fields });
		const line = (billId: Id<'bills'>, fields: Partial<Doc<'billLines'>>) =>
			ctx.db.insert('billLines', { billId, kind: 'extra', name: 'Water', unitPrice: 100, currency: 'THB', qty: 1, createdAt: 1, ...fields });

		// Held with a guest name and a stay with a deposit.
		const held = await bill(1, { status: 'held', guestName: 'Anna', guestPhone: '0800000000', itemCount: 2, total: 10100, hasItems: true });
		await line(held, { kind: 'booking', bookingId: annaStay, name: 'Stay · Pool Villa', unitPrice: 10000, deposit: 4000 });
		await line(held, {});
		// A draft without a guest.
		const draft = await bill(2, { itemCount: 1, total: 100, hasItems: true });
		await line(draft, {});
		// Paid with a guest, payments and audit history.
		const paid = await bill(3, { status: 'paid', guestName: 'Carl', itemCount: 1, total: 10000, hasItems: true, receiptNumber: 1, settleKey: 'k-1', paidAt: 3 });
		await line(paid, { kind: 'booking', bookingId: carlStay, name: 'Stay · Pool Villa', unitPrice: 10000 });
		await ctx.db.insert('billPayments', { billId: paid, method: 'cash', amount: 10000, idempotencyKey: 'k-1', createdBy: 'admin@example.com', createdAt: 3 });
		await ctx.db.insert('billAudit', { billId: paid, at: 3, actor: 'admin@example.com', kind: 'paid', toPrice: 10000 });
		// Voided, no guest.
		const voided = await bill(4, { status: 'void', itemCount: 1, total: 100, hasItems: true, receiptNumber: 2, voidReason: 'QA', voidedAt: 5 });
		await line(voided, {});
		await ctx.db.insert('billPayments', { billId: voided, method: 'card', amount: 100, idempotencyKey: 'k-2', createdBy: 'admin@example.com', createdAt: 4 });
		await ctx.db.insert('billAudit', { billId: voided, at: 5, actor: 'admin@example.com', kind: 'void', note: 'QA' });
		// One draft charging two different guests' stays: ambiguous.
		const multi = await bill(5, { guestName: 'Anna', itemCount: 2, total: 20000, hasItems: true });
		await line(multi, { kind: 'booking', bookingId: bobStay, name: 'Stay · Pool Villa', unitPrice: 10000 });
		await line(multi, { kind: 'booking', bookingId: carlStay, name: 'Stay · Pool Villa', unitPrice: 10000 });
		await ctx.db.insert('billCounters', { key: 'receipt', value: 2 });
		await ctx.db.insert('billCounters', { key: 'walkin:2026-10-01', value: 5 });
		return { held, draft, paid, voided, multi, annaStay, bobStay, carlStay };
	});
	const snapshot = () => t.run(async (ctx) => ({
		lines: await ctx.db.query('billLines').collect(),
		payments: await ctx.db.query('billPayments').collect(),
		audit: await ctx.db.query('billAudit').collect(),
		customers: await ctx.db.query('customers').collect(),
		bookings: await ctx.db.query('bookings').collect()
	}));
	const bills = () => t.run((ctx) => ctx.db.query('bills').collect());
	return { t, admin, ids, snapshot, bills };
}

describe('order backfill', () => {
	it('previews and dry-runs without writing', async () => {
		vi.useFakeTimers();
		const { t, ids, bills } = await legacyData();
		const before = await bills();
		const preview = await t.query(internal.migrations.previewOrderBackfill, { paginationOpts: page });
		expect(preview.proposed).toHaveLength(5);
		expect(preview.proposed.find((row) => row.orderId === ids.held)).toMatchObject({ orderNumber: 'next', patch: { status: 'draft', due: 6100, bookingId: ids.annaStay } });
		expect(preview.proposed.find((row) => row.orderId === ids.multi)?.notes[0]).toContain('left unlinked');
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillOrders', dryRun: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await bills()).toEqual(before);
	});

	it('numbers orders in creation order and keeps receipts, payments, rows and audit untouched, idempotently', async () => {
		vi.useFakeTimers();
		const { t, admin, ids, snapshot, bills } = await legacyData();
		const before = await snapshot();
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillOrders' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const [status] = await t.query(components.migrations.lib.getStatus, { names: ['migrations:backfillOrders'] });
		expect(status).toMatchObject({ state: 'success', processed: 5 });

		const byId = new Map((await bills()).map((bill) => [bill._id, bill]));
		expect(byId.get(ids.held)).toMatchObject({ orderNumber: 1, status: 'draft', due: 6100, bookingId: ids.annaStay, guestName: 'Anna', revision: 3 });
		expect(byId.get(ids.draft)).toMatchObject({ orderNumber: 2, status: 'draft', due: 100 });
		expect(byId.get(ids.draft)?.bookingId).toBeUndefined();
		expect(byId.get(ids.paid)).toMatchObject({ orderNumber: 3, status: 'paid', receiptNumber: 1, due: 0, bookingId: ids.carlStay, customerSnapshot: { name: 'Carl' } });
		expect(byId.get(ids.voided)).toMatchObject({ orderNumber: 4, status: 'void', receiptNumber: 2, due: 0, voidReason: 'QA' });
		expect(byId.get(ids.voided)?.customerSnapshot).toBeUndefined();
		// Two guests' stays on one bill: no order-level booking is guessed; each row keeps its stay.
		expect(byId.get(ids.multi)).toMatchObject({ orderNumber: 5, status: 'draft' });
		expect(byId.get(ids.multi)?.bookingId).toBeUndefined();

		// No customer is invented from a copied name, and nothing else changed.
		expect(await snapshot()).toEqual(before);
		expect(await t.query(internal.migrations.verifyOrderBackfill, { paginationOpts: page })).toMatchObject({ checked: 5, counter: 5, problems: [], unlinkedWithSources: 1, isDone: true });

		// Rerunning from the start changes nothing.
		const after = await bills();
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillOrders', reset: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await bills()).toEqual(after);

		// New orders continue the numbering; checkout reuses the migrated orders.
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Tea', price: 50 } });
		expect((await admin.query(api.pos.getOrder, { orderId }))?.order.orderNumber).toBe(6);
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId: ids.annaStay })).toEqual({ orderId: ids.held });
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId: ids.bobStay })).toEqual({ orderId: ids.multi });
		const legacy = await admin.query(api.pos.getOrder, { orderId: ids.held });
		expect(legacy).toMatchObject({ customer: null, legacyGuest: { name: 'Anna' }, order: { title: 'Order #1', state: 'unpaid' } });
		const paidView = await admin.query(api.pos.getOrder, { orderId: ids.paid });
		expect(paidView).toMatchObject({ receiptCustomer: { name: 'Carl' }, legacyGuest: { name: 'Carl' } });
		const unpaid = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: page });
		expect(unpaid.page.map((row) => row._id)).toEqual(expect.arrayContaining([ids.held, ids.draft, ids.multi]));
	});

	it('lists every legacy held order before the backfill reaches it, page by page', async () => {
		const { t, admin } = await legacyData();
		const held = await t.run(async (ctx) => {
			const ids: Id<'bills'>[] = [];
			for (let i = 0; i < 55; i++) {
				ids.push(await ctx.db.insert('bills', { status: 'held', currency: 'THB', createdBy: 'legacy', itemCount: 1, total: 10, hasItems: true, revision: 1, createdAt: 100 + i, updatedAt: 100 + i }));
			}
			return ids;
		});
		const seen: Id<'bills'>[] = [];
		let cursor: string | null = null;
		for (let i = 0; i < 10; i++) {
			const result: { page: Array<{ _id: Id<'bills'> }>; isDone: boolean; continueCursor: string } =
				await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 20, cursor } });
			seen.push(...result.page.map((row) => row._id));
			if (result.isDone) break;
			cursor = result.continueCursor;
		}
		expect(new Set(seen).size).toBe(seen.length);
		expect(seen).toEqual(expect.arrayContaining(held));
		expect(seen).toHaveLength(55 + 3); // plus the held, draft and multi-stay rows from legacyData
	});

	it('leaves a row unlinked when a charged appointment is gone, instead of inferring its stay', async () => {
		const { t, ids } = await legacyData();
		await t.run(async (ctx) => {
			const serviceId = await ctx.db.insert('services', { slug: 's', name: 'S', description: '', category: 'C', durationMin: 60, bufferMin: 0, price: 1, currency: 'THB', staffIds: [], status: 'active', createdAt: 1, updatedAt: 1 });
			const staffId = await ctx.db.insert('staff', { name: 'N', role: 'T', color: '#000', status: 'active', workingHours: [], breaks: [], createdAt: 1, updatedAt: 1 });
			const gone = await ctx.db.insert('serviceAppointments', {
				serviceId, staffId, bookingId: ids.annaStay, start: 1, end: 2, blockedUntil: 3, guestName: 'Anna', guestPhone: '', source: 'admin',
				status: 'booked', paymentStatus: 'paid', price: 1, currency: 'THB', confirmationCode: 'SVC-GONE', accessToken: 'x', createdAt: 1
			});
			const bill = await ctx.db.insert('bills', { status: 'paid', receiptNumber: 9, currency: 'THB', createdBy: 'legacy', itemCount: 2, total: 2, hasItems: true, revision: 1, createdAt: 9, updatedAt: 9 });
			await ctx.db.insert('billLines', { billId: bill, kind: 'booking', bookingId: ids.bobStay, name: 'Stay', unitPrice: 1, currency: 'THB', qty: 1, createdAt: 9 });
			await ctx.db.insert('billLines', { billId: bill, kind: 'appointment', appointmentId: gone, name: 'Massage', unitPrice: 1, currency: 'THB', qty: 1, createdAt: 9 });
			await ctx.db.delete(gone);
			const { orderBackfillPlan } = await import('./lib/orderBackfill');
			const plan = await orderBackfillPlan(ctx, (await ctx.db.get(bill))!);
			expect(plan.patch.bookingId).toBeUndefined();
			expect(plan.notes[0]).toContain('no longer exists');
		});
	});

	it('numbers a legacy order after orders created since the deploy, without reusing a number', async () => {
		vi.useFakeTimers();
		const { t, admin, bills } = await legacyData();
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Tea', price: 50 } });
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillOrders' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const numbers = (await bills()).map((bill) => bill.orderNumber);
		expect(new Set(numbers).size).toBe(6);
		expect((await bills()).find((bill) => bill._id === orderId)?.orderNumber).toBe(1);
		expect((await t.query(internal.migrations.verifyOrderBackfill, { paginationOpts: page })).problems).toEqual([]);
	});
});
