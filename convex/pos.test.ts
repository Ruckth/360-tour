// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const weekdays = [0, 1, 2, 3, 4, 5, 6];

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const hours = { workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] };
	const nok = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', ...hours });
	const ploy = await admin.mutation(api.adminServices.createStaff, { name: 'Ploy', role: 'Therapist', color: '#def', ...hours });
	const serviceId = await admin.mutation(api.adminServices.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: '', category: 'Massage',
		durationMin: 60, bufferMin: 15, price: 1200, currency: 'THB', staffIds: [nok]
	});
	const { propertyId, bookingId } = await t.run(async (ctx) => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 4,
			bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		});
		// A pending stay with a 10,000 Stripe deposit already paid online.
		const bookingId = await ctx.db.insert('bookings', {
			propertyId, guestName: 'Anna', guestPhone: '+66 81 234 5678', guestPhoneDigits: '66812345678', checkIn: '2026-10-01', checkOut: '2026-10-04',
			guests: 2, nights: 3, subtotal: 30000, discountAmount: 0, total: 30000, currency: 'THB', amountPaid: 10000,
			paymentStatus: 'pending', status: 'confirmed', createdAt: Date.now()
		});
		return { propertyId, bookingId };
	});
	const bill = (billId: Id<'bills'>) => admin.query(api.pos.getBill, { billId }).then((view) => view!);
	return { t, admin, nok, ploy, serviceId, propertyId, bookingId, bill };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-02T03:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('pos checkout', () => {
	it('keeps each service its own row and stacks nights into a quantity', async () => {
		const { admin, serviceId, propertyId, bill } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.addItem, { billId, item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.addItem, { billId, item: { kind: 'room', propertyId } });
		await admin.mutation(api.pos.addItem, { billId, item: { kind: 'room', propertyId } });
		const view = await bill(billId);
		expect(view.lines.map((line) => [line.kind, line.qty])).toEqual([['service', 1], ['service', 1], ['room', 2]]);
		expect(view.bill).toMatchObject({ walkInNumber: 1, label: 'Walk-in #1', itemCount: 4, total: 22400 });
	});

	it('only lets eligible therapists take a service row', async () => {
		const { admin, serviceId, nok, ploy, bill } = await setup();
		const { billId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.updateLine, { lineId, staffId: nok });
		expect((await bill(billId)).lines[0].staffName).toBe('Nok');
		await expect(admin.mutation(api.pos.updateLine, { lineId, staffId: ploy })).rejects.toThrow("Ploy doesn't offer this service");
		await admin.mutation(api.pos.updateLine, { lineId, staffId: null });
		expect((await bill(billId)).lines[0].staffId).toBeUndefined();
	});

	it('requires a note to override a price and audits it', async () => {
		const { admin, serviceId, bill } = await setup();
		const { billId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await expect(admin.mutation(api.pos.overrideLinePrice, { lineId, price: 900, note: '  ' })).rejects.toThrow('Add a note');
		await admin.mutation(api.pos.overrideLinePrice, { lineId, price: 900, note: 'Regular guest' });
		const view = await bill(billId);
		expect(view.totals.total).toBe(900);
		expect(view.lines[0].priceOverride).toMatchObject({ price: 900, note: 'Regular guest', by: 'admin@example.com' });
		expect(view.audit[0]).toMatchObject({ kind: 'price_override', fromPrice: 1200, toPrice: 900, note: 'Regular guest', actor: 'admin@example.com' });
	});

	it('deducts the online deposit of an attached booking and marks it paid', async () => {
		const { t, admin, bookingId, serviceId, bill } = await setup();
		const attachable = await admin.query(api.pos.listAttachable, { guestPhone: '+66 81 234 5678' });
		expect(attachable).toMatchObject([{ kind: 'booking', id: bookingId, price: 30000, deposit: 10000, onBill: null }]);
		const { billId } = await admin.mutation(api.pos.openFor, { bookingId });
		expect(await admin.mutation(api.pos.openFor, { bookingId })).toEqual({ billId });
		const { lineId } = await admin.mutation(api.pos.addItem, { billId, item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'percent', value: 10 } });
		const view = await bill(billId);
		expect(view.bill.label).toBe('Anna');
		expect(view.totals).toEqual({ subtotal: 31200, discount: 120, total: 31080, vat: 2033.27, deposit: 10000, due: 21080 });

		await admin.mutation(api.pos.settleBill, { billId, idempotencyKey: 'attempt-0001', expectedDue: 21080, tenders: [{ method: 'card', amount: 21080 }] });
		const booking = await t.run((ctx) => ctx.db.get(bookingId));
		expect(booking).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
	});

	it('settles once when the same payment attempt is retried', async () => {
		const { t, admin, serviceId, bill } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const args = { billId, idempotencyKey: 'attempt-0001', expectedDue: 1200, tenders: [{ method: 'cash' as const, amount: 1200, received: 1500 }] };
		const first = await admin.mutation(api.pos.settleBill, args);
		const retry = await admin.mutation(api.pos.settleBill, args);
		expect(first).toEqual({ receiptNumber: 1, replayed: false });
		expect(retry).toEqual({ receiptNumber: 1, replayed: true });
		expect(await t.run((ctx) => ctx.db.query('billPayments').collect())).toHaveLength(1);
		await expect(admin.mutation(api.pos.settleBill, { ...args, idempotencyKey: 'attempt-0002' })).rejects.toThrow('already paid');
		expect((await bill(billId)).bill.status).toBe('paid');
	});

	it('refuses split payments that do not add up, more than three, or a stale total', async () => {
		const { admin, serviceId } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const settle = (tenders: Array<{ method: 'cash' | 'promptpay' | 'card' | 'transfer'; amount: number }>, expectedDue = 1200) =>
			admin.mutation(api.pos.settleBill, { billId, idempotencyKey: `attempt-${Math.random()}`, expectedDue, tenders });
		await expect(settle([{ method: 'cash', amount: 500 }, { method: 'promptpay', amount: 600 }])).rejects.toThrow('Payments add up to 1100');
		await expect(settle([300, 300, 300, 300].map((amount) => ({ method: 'card' as const, amount })))).rejects.toThrow('at most 3');
		await expect(settle([{ method: 'card', amount: 1000 }], 1000)).rejects.toThrow('The bill changed');
		await expect(settle([{ method: 'cash', amount: 500 }, { method: 'promptpay', amount: 700 }])).resolves.toMatchObject({ receiptNumber: 1 });
	});

	it('numbers receipts in sequence and keeps the number after a void', async () => {
		const { admin, serviceId, bill } = await setup();
		const paidBill = async (key: string) => {
			const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
			await admin.mutation(api.pos.settleBill, { billId, idempotencyKey: key, expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] });
			return billId;
		};
		const first = await paidBill('attempt-0001');
		await expect(admin.mutation(api.pos.voidBill, { billId: first, reason: ' ' })).rejects.toThrow('reason');
		await admin.mutation(api.pos.voidBill, { billId: first, reason: 'Wrong guest' });
		const second = await paidBill('attempt-0002');
		expect((await bill(first)).bill).toMatchObject({ status: 'void', receiptNumber: 1, voidReason: 'Wrong guest' });
		expect((await bill(second)).bill).toMatchObject({ status: 'paid', receiptNumber: 2, walkInNumber: 2 });
		await expect(admin.mutation(api.pos.addItem, { billId: first, item: { kind: 'service', serviceId } })).rejects.toThrow('already paid');
	});

	it('holds a bill, lists it for resuming, and clears it', async () => {
		const { admin, serviceId, bill } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.holdBill, { billId });
		expect(await admin.query(api.pos.listOpenBills, {})).toMatchObject([{ _id: billId, status: 'held', itemCount: 1, total: 1200 }]);
		await admin.mutation(api.pos.clearBill, { billId });
		expect((await bill(billId)).lines).toHaveLength(0);
		expect(await admin.query(api.pos.listOpenBills, {})).toEqual([]);
	});
});
