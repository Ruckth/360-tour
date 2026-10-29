// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { FunctionArgs } from 'convex/server';
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
	/** settleBill with the revision the cashier is looking at now. */
	const settle = async (args: Omit<FunctionArgs<typeof api.pos.settleBill>, 'expectedRevision'>) =>
		admin.mutation(api.pos.settleBill, { ...args, expectedRevision: (await bill(args.billId)).bill.revision ?? 0 });
	return { t, admin, nok, ploy, serviceId, propertyId, bookingId, bill, settle };
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
		const { t, admin, bookingId, serviceId, bill, settle } = await setup();
		const attachable = await admin.query(api.pos.listAttachable, { guestPhone: '+66 81 234 5678' });
		expect(attachable).toMatchObject([{ kind: 'booking', id: bookingId, price: 30000, deposit: 10000, onBill: null }]);
		const { billId } = await admin.mutation(api.pos.openFor, { bookingId });
		expect(await admin.mutation(api.pos.openFor, { bookingId })).toEqual({ billId });
		const { lineId } = await admin.mutation(api.pos.addItem, { billId, item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'percent', value: 10 } });
		const view = await bill(billId);
		expect(view.bill.label).toBe('Anna');
		expect(view.totals).toEqual({ subtotal: 31200, discount: 120, total: 31080, vat: 2033.27, deposit: 10000, due: 21080 });

		await settle({ billId, idempotencyKey: 'attempt-0001', expectedDue: 21080, tenders: [{ method: 'card', amount: 21080 }] });
		const booking = await t.run((ctx) => ctx.db.get(bookingId));
		expect(booking).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
	});

	it('settles once when the same payment attempt is retried', async () => {
		const { t, admin, serviceId, bill, settle } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const args = { billId, idempotencyKey: 'attempt-0001', expectedDue: 1200, tenders: [{ method: 'cash' as const, amount: 1200, received: 1500 }] };
		const first = await settle(args);
		const retry = await settle(args);
		expect(first).toEqual({ receiptNumber: 1, replayed: false });
		expect(retry).toEqual({ receiptNumber: 1, replayed: true });
		expect(await t.run((ctx) => ctx.db.query('billPayments').collect())).toHaveLength(1);
		await expect(settle({ ...args, idempotencyKey: 'attempt-0002' })).rejects.toThrow('already paid');
		expect((await bill(billId)).bill.status).toBe('paid');
	});

	it('refuses split payments that do not add up, more than three, or a stale total', async () => {
		const { admin, serviceId, settle: settleWith } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const settle = (tenders: Array<{ method: 'cash' | 'promptpay' | 'card' | 'transfer'; amount: number }>, expectedDue = 1200) =>
			settleWith({ billId, idempotencyKey: `attempt-${Math.random()}`, expectedDue, tenders });
		await expect(settle([{ method: 'cash', amount: 500 }, { method: 'promptpay', amount: 600 }])).rejects.toThrow('Payments add up to 1100');
		await expect(settle([300, 300, 300, 300].map((amount) => ({ method: 'card' as const, amount })))).rejects.toThrow('at most 3');
		await expect(settle([{ method: 'card', amount: 1000 }], 1000)).rejects.toThrow('The bill changed');
		await expect(settle([{ method: 'cash', amount: 500 }, { method: 'promptpay', amount: 700 }])).resolves.toMatchObject({ receiptNumber: 1 });
	});

	it('numbers receipts in sequence and keeps the number after a void', async () => {
		const { admin, serviceId, bill, settle } = await setup();
		const paidBill = async (key: string) => {
			const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
			await settle({ billId, idempotencyKey: key, expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] });
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

	it('only sells and attaches THB prices (C4-01)', async () => {
		const { t, admin, nok, propertyId, bill } = await setup();
		const usd = await admin.mutation(api.adminServices.createService, {
			slug: 'usd-massage', name: 'USD massage', description: '', category: 'Massage',
			durationMin: 60, bufferMin: 0, price: 100, currency: 'USD', staffIds: [nok]
		});
		expect((await admin.query(api.pos.catalog, {})).services.map((s) => s._id)).not.toContain(usd);
		await expect(admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: usd } })).rejects.toThrow('USD');
		const usdBooking = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Bob', guestPhone: '+1 555 0100', guestPhoneDigits: '15550100', checkIn: '2026-11-01', checkOut: '2026-11-02',
			guests: 1, nights: 1, subtotal: 300, discountAmount: 0, total: 300, currency: 'USD', paymentStatus: 'pending', status: 'confirmed', createdAt: Date.now()
		}));
		await expect(admin.mutation(api.pos.openFor, { bookingId: usdBooking })).rejects.toThrow('USD');
		expect(await admin.query(api.pos.listAttachable, { guestPhone: '+1 555 0100' })).toMatchObject([{ currency: 'USD' }]);
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'room', propertyId } });
		expect((await bill(billId)).bill.currency).toBe('THB');
	});

	it('still lists an unpaid bill behind many newer empty drafts (C4-02)', async () => {
		const { admin, serviceId } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		for (let i = 0; i < 21; i++) {
			vi.advanceTimersByTime(1000);
			const { billId: empty } = await admin.mutation(api.pos.setCustomer, { guest: { name: `Guest ${i}` } });
			if (i % 2) await admin.mutation(api.pos.clearBill, { billId: empty });
		}
		expect((await admin.query(api.pos.listOpenBills, {})).map((b) => b._id)).toEqual([billId]);
	});

	it('finds stays saved before the phone and email lookup fields (C4-03)', async () => {
		const { t, admin, propertyId } = await setup();
		const legacy = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Carla', guestPhone: '081-999-0000', checkIn: '2026-11-01', checkOut: '2026-11-03',
			guests: 1, nights: 2, subtotal: 20000, discountAmount: 0, total: 20000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: Date.now()
		}));
		const emailOnly = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Dana', guestPhone: '', guestEmail: 'Dana@Example.com', checkIn: '2026-11-05', checkOut: '2026-11-06',
			guests: 1, nights: 1, subtotal: 10000, discountAmount: 0, total: 10000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: Date.now()
		}));
		expect(await admin.query(api.pos.listAttachable, { guestName: 'Carla', guestPhone: '081-999-0000' })).toMatchObject([{ id: legacy }]);
		expect(await admin.query(api.pos.listAttachable, { guestName: 'Dana', guestEmail: 'Dana@Example.com' })).toMatchObject([{ id: emailOnly }]);
		// A namesake with other contact details is not this guest.
		expect(await admin.query(api.pos.listAttachable, { guestName: 'Carla', guestPhone: '+66 80 000 0000' })).toEqual([]);
	});

	it('refuses to settle an appointment whose price or service changed, and records a discounted price (C4-04)', async () => {
		const { t, admin, nok, serviceId } = await setup();
		const start = Date.now() + 3_600_000;
		const appointmentId = await t.run((ctx) => ctx.db.insert('serviceAppointments', {
			serviceId, staffId: nok, start, end: start + 3_600_000, blockedUntil: start + 4_500_000, guestName: 'Eve', guestPhone: '+66 82 000 1111',
			source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: 'SVC-1', accessToken: 'tok', createdAt: Date.now()
		}));
		const { billId } = await admin.mutation(api.pos.openFor, { appointmentId });
		await t.run((ctx) => ctx.db.patch(appointmentId, { price: 2000 }));
		const settle = (due: number, key: string) => admin.query(api.pos.getBill, { billId }).then((view) =>
			admin.mutation(api.pos.settleBill, { billId, idempotencyKey: key, expectedDue: due, expectedRevision: view!.bill.revision ?? 0, tenders: [{ method: 'cash', amount: due }] }));
		await expect(settle(1200, 'attempt-0001')).rejects.toThrow('changed since it was added');
		expect(await t.run((ctx) => ctx.db.get(appointmentId))).toMatchObject({ paymentStatus: 'unpaid' });

		await t.run((ctx) => ctx.db.patch(appointmentId, { price: 1200 }));
		const { lines } = (await admin.query(api.pos.getBill, { billId }))!;
		await admin.mutation(api.pos.updateLine, { lineId: lines[0]._id, discount: { type: 'percent', value: 10 } });
		await settle(1080, 'attempt-0002');
		expect(await t.run((ctx) => ctx.db.get(appointmentId))).toMatchObject({ paymentStatus: 'paid', price: 1080 });
	});

	it('keeps attached stays at their booked price, so the booking records what was paid (C4-05)', async () => {
		const { admin, bookingId, bill } = await setup();
		const { billId } = await admin.mutation(api.pos.openFor, { bookingId });
		const lineId = (await bill(billId)).lines[0]._id;
		await expect(admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'percent', value: 10 } })).rejects.toThrow('on the booking');
		await expect(admin.mutation(api.pos.overrideLinePrice, { lineId, price: 27000, note: 'Loyal guest' })).rejects.toThrow('on the booking');
		expect((await bill(billId)).totals.due).toBe(20000);
	});

	it('refuses a payment for a bill that changed at the same total (C4-06)', async () => {
		const { admin, serviceId, nok, bill } = await setup();
		const other = await admin.mutation(api.adminServices.createService, {
			slug: 'aroma', name: 'Aroma oil', description: '', category: 'Massage', durationMin: 60, bufferMin: 0, price: 1200, currency: 'THB', staffIds: [nok]
		});
		const { billId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const reviewed = (await bill(billId)).bill.revision ?? 0;
		await admin.mutation(api.pos.removeLine, { lineId });
		await admin.mutation(api.pos.addItem, { billId, item: { kind: 'service', serviceId: other } });
		const args = { billId, expectedDue: 1200, tenders: [{ method: 'card' as const, amount: 1200 }] };
		await expect(admin.mutation(api.pos.settleBill, { ...args, idempotencyKey: 'attempt-0001', expectedRevision: reviewed })).rejects.toThrow('The bill changed');
		const current = (await bill(billId)).bill.revision ?? 0;
		expect(current).toBeGreaterThan(reviewed);
		await admin.mutation(api.pos.settleBill, { ...args, idempotencyKey: 'attempt-0002', expectedRevision: current });
		// A retry of the successful attempt still replays, whatever revision it carries.
		expect(await admin.mutation(api.pos.settleBill, { ...args, idempotencyKey: 'attempt-0002', expectedRevision: current })).toMatchObject({ replayed: true });
	});

	it('steps quantities on the server so quick taps add up (C4-07)', async () => {
		const { admin, propertyId, bill } = await setup();
		const { billId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'room', propertyId } });
		await Promise.all([admin.mutation(api.pos.updateLine, { lineId, qtyChange: 1 }), admin.mutation(api.pos.updateLine, { lineId, qtyChange: 1 })]);
		expect((await bill(billId)).lines[0].qty).toBe(3);
		for (let i = 0; i < 4; i++) await admin.mutation(api.pos.updateLine, { lineId, qtyChange: -1 });
		expect((await bill(billId)).lines[0].qty).toBe(1);
	});

	it('refuses payment amounts finer than a satang (K4-01)', async () => {
		const { admin, serviceId, bill } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const expectedRevision = (await bill(billId)).bill.revision ?? 0;
		await expect(admin.mutation(api.pos.settleBill, {
			billId, idempotencyKey: 'attempt-0001', expectedDue: 1200, expectedRevision,
			tenders: [{ method: 'cash', amount: 600.004 }, { method: 'card', amount: 599.996 }]
		})).rejects.toThrow('satang');
	});

	it('refuses to settle a line saved before the THB check from a foreign-currency price (C4-01)', async () => {
		const { t, admin, nok, serviceId, settle } = await setup();
		const usd = await admin.mutation(api.adminServices.createService, {
			slug: 'usd-massage', name: 'USD massage', description: '', category: 'Massage',
			durationMin: 60, bufferMin: 0, price: 100, currency: 'USD', staffIds: [nok]
		});
		// An old-format draft: no currency on the line, priced from a USD service.
		const legacy = await t.run(async (ctx) => {
			const billId = await ctx.db.insert('bills', { status: 'draft', walkInNumber: 1, currency: 'THB', itemCount: 1, total: 100, createdBy: 'x', createdAt: Date.now(), updatedAt: Date.now() });
			await ctx.db.insert('billLines', { billId, kind: 'service', serviceId: usd, name: 'USD massage', unitPrice: 100, qty: 1, createdAt: Date.now() });
			return billId;
		});
		await expect(settle({ billId: legacy, idempotencyKey: 'attempt-0001', expectedDue: 100, tenders: [{ method: 'card', amount: 100 }] })).rejects.toThrow('USD');
		// A line added at a baht price keeps that price even if the service later moves to another currency.
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await t.run((ctx) => ctx.db.patch(serviceId, { currency: 'USD' }));
		await expect(settle({ billId, idempotencyKey: 'attempt-0002', expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] })).resolves.toMatchObject({ replayed: false });
	});

	it('lists an older unpaid bill behind more than 20 old-format empty drafts (C4-02)', async () => {
		const { t, admin } = await setup();
		const legacy = (itemCount: number) => t.run((ctx) => ctx.db.insert('bills', {
			status: 'draft', walkInNumber: 1, currency: 'THB', itemCount, total: itemCount * 100, createdBy: 'x', createdAt: Date.now(), updatedAt: Date.now()
		}));
		const unpaid = await legacy(1);
		for (let i = 0; i < 25; i++) {
			vi.advanceTimersByTime(1000);
			await legacy(0);
		}
		expect((await admin.query(api.pos.listOpenBills, {})).map((b) => b._id)).toEqual([unpaid]);
	});

	it('refuses to settle an appointment that moved to another therapist or time (C4-04)', async () => {
		const { t, admin, nok, ploy, serviceId, settle } = await setup();
		const start = Date.now() + 3_600_000;
		const appointmentId = await t.run((ctx) => ctx.db.insert('serviceAppointments', {
			serviceId, staffId: nok, start, end: start + 3_600_000, blockedUntil: start + 4_500_000, guestName: 'Eve', guestPhone: '+66 82 000 1111',
			source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: 'SVC-1', accessToken: 'tok', createdAt: Date.now()
		}));
		const { billId } = await admin.mutation(api.pos.openFor, { appointmentId });
		const pay = (key: string) => settle({ billId, idempotencyKey: key, expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] });
		await t.run((ctx) => ctx.db.patch(appointmentId, { staffId: ploy }));
		await expect(pay('attempt-0001')).rejects.toThrow('changed since it was added');
		await t.run((ctx) => ctx.db.patch(appointmentId, { staffId: nok, start: start + 86_400_000 }));
		await expect(pay('attempt-0002')).rejects.toThrow('changed since it was added');
		expect(await t.run((ctx) => ctx.db.get(appointmentId))).toMatchObject({ paymentStatus: 'unpaid' });
	});

	it('refuses to settle a stay that moved to other dates at the same price (K5-01)', async () => {
		const { t, admin, bookingId, settle } = await setup();
		const { billId } = await admin.mutation(api.pos.openFor, { bookingId });
		await t.run((ctx) => ctx.db.patch(bookingId, { checkIn: '2026-10-05', checkOut: '2026-10-08' }));
		await expect(settle({ billId, idempotencyKey: 'attempt-0001', expectedDue: 20000, tenders: [{ method: 'card', amount: 20000 }] })).rejects.toThrow('changed since it was added');
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'pending' });
	});

	it('refuses cash received that is not a finite amount (C5-02)', async () => {
		const { admin, settle } = await setup();
		const { billId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 90 } });
		for (const received of [Infinity, NaN, 1e12]) {
			await expect(settle({ billId, idempotencyKey: `attempt-${received}`, expectedDue: 90, tenders: [{ method: 'cash', amount: 90, received }] })).rejects.toThrow();
		}
		await expect(admin.mutation(api.pos.addItem, { billId, item: { kind: 'extra', name: 'Huge', price: 1e12 } })).rejects.toThrow('at most');
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
