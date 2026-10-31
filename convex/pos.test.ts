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
			paymentStatus: 'pending', status: 'confirmed', confirmationCode: 'CONF-ANNA', createdAt: Date.now()
		});
		return { propertyId, bookingId };
	});
	const order = (orderId: Id<'bills'>) => admin.query(api.pos.getOrder, { orderId }).then((view) => view!);
	/** settleOrder with the revision the cashier is looking at now. */
	const settle = async (args: Omit<FunctionArgs<typeof api.pos.settleOrder>, 'expectedRevision'>) =>
		admin.mutation(api.pos.settleOrder, { ...args, expectedRevision: (await order(args.orderId)).order.revision });
	const appointment = (overrides: Record<string, unknown> = {}) => {
		const start = Date.now() + 3_600_000;
		return t.run((ctx) => ctx.db.insert('serviceAppointments', {
			serviceId, staffId: nok, start, end: start + 3_600_000, blockedUntil: start + 4_500_000, guestName: 'Eve', guestPhone: '+66 82 000 1111',
			source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: 'SVC-1', accessToken: 'tok', createdAt: Date.now(),
			...overrides
		}));
	};
	const extra = (orderId?: Id<'bills'>, price = 100) => admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Water', price } });
	return { t, admin, nok, ploy, serviceId, propertyId, bookingId, order, settle, appointment, extra };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-02T03:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('order identity', () => {
	it('sells a standalone order with no booking or customer, numbered permanently', async () => {
		const { admin, order, settle, extra } = await setup();
		const { orderId } = await extra();
		const view = await order(orderId);
		expect(view.order).toMatchObject({ orderNumber: 1, title: 'Order #1', state: 'unpaid', due: 100 });
		expect(view.order.walkInNumber).toBeUndefined();
		expect(view.order.bookingId).toBeUndefined();
		expect(view.customer).toBeNull();
		expect(view.source).toBeNull();
		await settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 100, tenders: [{ method: 'cash', amount: 100 }] });
		expect((await order(orderId)).order).toMatchObject({ orderNumber: 1, receiptNumber: 1, state: 'paid', due: 0 });
		expect(view.receiptCustomer).toBeNull();
		await expect(admin.query(api.pos.findOrderByNumber, { orderNumber: 1 })).resolves.toBe(orderId);
		await expect(admin.query(api.pos.findOrderByNumber, { orderNumber: 99 })).resolves.toBeNull();
	});

	it('gives orders created at the same time different numbers, kept across days, saves, customers and payment', async () => {
		const { admin, order, settle, extra } = await setup();
		const [a, b] = await Promise.all([extra(), extra()]);
		expect(a.orderId).not.toBe(b.orderId);
		const numbers = [(await order(a.orderId)).order.orderNumber, (await order(b.orderId)).order.orderNumber];
		expect(new Set(numbers).size).toBe(2);

		const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Bob' });
		await admin.mutation(api.pos.saveOrder, { orderId: a.orderId });
		vi.advanceTimersByTime(3 * 86_400_000); // other resort days: numbers don't restart
		await admin.mutation(api.pos.linkCustomer, { orderId: a.orderId, customerId });
		await admin.mutation(api.pos.unlinkCustomer, { orderId: a.orderId });
		await admin.mutation(api.pos.linkCustomer, { orderId: a.orderId, customerId });
		const { orderId: c } = await extra();
		expect((await order(c)).order.orderNumber).toBe(3);
		await settle({ orderId: a.orderId, idempotencyKey: 'attempt-0001', expectedDue: 100, tenders: [{ method: 'card', amount: 100 }] });
		expect((await order(a.orderId)).order.orderNumber).toBe(numbers[0]);
	});

	it('exposes no walk-in counter, preview or hold any more', async () => {
		const pos = await import('./pos');
		for (const gone of ['nextWalkInNumber', 'holdBill', 'listOpenBills', 'setCustomer', 'searchAppointmentGuests']) expect(pos).not.toHaveProperty(gone);
		const { t, extra } = await setup();
		await extra();
		expect((await t.run((ctx) => ctx.db.query('billCounters').collect())).map((row) => row.key)).toEqual(['order']);
	});
});

describe('booking relationship', () => {
	it('reuses one open order for repeated and simultaneous opens of a stay, charging it once', async () => {
		const { t, admin, bookingId, order } = await setup();
		const [first, second] = await Promise.all([admin.mutation(api.pos.openOrderFor, { bookingId }), admin.mutation(api.pos.openOrderFor, { bookingId })]);
		expect(second).toEqual(first);
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId })).toEqual(first);
		const view = await order(first.orderId);
		expect(view.order.bookingId).toBe(bookingId);
		expect(view.source).toMatchObject({ kind: 'booking', reference: 'CONF-ANNA', guestName: 'Anna' });
		expect(view.lines.filter((line) => line.bookingId === bookingId)).toHaveLength(1);
		expect(await t.run((ctx) => ctx.db.query('bills').collect())).toHaveLength(1);
		expect(await admin.query(api.pos.ordersForBooking, { bookingId })).toMatchObject({
			balance: { total: 30000, paid: 10000, owed: 20000 },
			activeOrder: { _id: first.orderId, title: 'Order #1', due: 20000 }
		});
	});

	it('puts a stay, its appointment and an extra on the stay order, one charge per source', async () => {
		const { admin, bookingId, appointment, order, extra, settle } = await setup();
		const related = await appointment({ bookingId });
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		expect(await admin.mutation(api.pos.openOrderFor, { appointmentId: related })).toEqual({ orderId });
		expect(await admin.mutation(api.pos.openOrderFor, { appointmentId: related })).toEqual({ orderId });
		await extra(orderId, 300);
		const view = await order(orderId);
		expect(view.lines.map((line) => line.kind)).toEqual(['booking', 'appointment', 'extra']);
		expect(view.totals).toMatchObject({ total: 31500, deposit: 10000, due: 21500 });
		// Another order can't charge the same stay or appointment while this one is open.
		const { orderId: other } = await extra();
		await expect(admin.mutation(api.pos.attach, { orderId: other, bookingId })).rejects.toThrow('already on Order #1');
		await expect(admin.mutation(api.pos.attach, { orderId: other, appointmentId: related })).rejects.toThrow('already on Order #1');
		expect(await admin.query(api.pos.ordersForBooking, { appointmentId: related })).toMatchObject({ activeOrder: { _id: orderId } });
		await settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 21500, tenders: [{ method: 'card', amount: 21500 }] });
		expect(await admin.query(api.pos.ordersForBooking, { bookingId })).toMatchObject({ activeOrder: null, balance: { owed: 0 }, orders: [{ _id: orderId, state: 'paid' }] });
	});

	it('gives a standalone appointment its own order, and links a standalone sale to the first stay added', async () => {
		const { admin, bookingId, appointment, order, extra } = await setup();
		const alone = await appointment();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId: alone });
		expect((await order(orderId)).order).toMatchObject({ appointmentId: alone });
		expect((await order(orderId)).source).toMatchObject({ kind: 'appointment', reference: 'SVC-1', guestName: 'Eve' });

		const { orderId: sale } = await extra();
		await admin.mutation(api.pos.attach, { orderId: sale, bookingId });
		expect((await order(sale)).order.bookingId).toBe(bookingId);
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId })).toEqual({ orderId: sale });
	});

	it('shows a stay added to a standalone sale even though the stay already has its own empty order, which stays the stay\'s', async () => {
		const { t, admin, serviceId, order, settle, extra } = await setup();
		// Created like any admin booking: it gets its own empty order straight away.
		const stay = await admin.mutation(api.adminBookings.createBooking, {
			propertySlug: 'villa', guestName: 'Mara', guestPhone: '+66 89 111 2222', checkIn: '2026-10-10', checkOut: '2026-10-12', guests: 2
		});
		const { confirmationCode } = (await t.run((ctx) => ctx.db.get(stay)))!;
		const own = (await admin.query(api.pos.ordersForBooking, { bookingId: stay }))!.activeOrder!;
		const ownBefore = await t.run((ctx) => ctx.db.get(own._id));

		// A standalone sale with service rows and a separate payer, then Add booking → the stay.
		const { orderId: sale } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		for (let i = 0; i < 11; i++) await admin.mutation(api.pos.addItem, { orderId: sale, item: { kind: 'service', serviceId } });
		const payer = await admin.mutation(api.customers.createCustomer, { name: 'Payer Pat' });
		await admin.mutation(api.pos.linkCustomer, { orderId: sale, customerId: payer });
		const number = (await order(sale)).order.orderNumber;
		await admin.mutation(api.pos.attach, { orderId: sale, bookingId: stay });

		const shown = await order(sale);
		expect(shown.order).toMatchObject({ orderNumber: number, customerId: payer });
		// Not made the stay's own order: that one already exists and is left alone.
		expect(shown.order.bookingId).toBeUndefined();
		expect(shown.source).toMatchObject({ kind: 'booking', id: stay, reference: confirmationCode, guestName: 'Mara', linked: false });
		expect(shown.sources).toHaveLength(1);
		expect(shown.customer).toMatchObject({ _id: payer, name: 'Payer Pat' });
		expect(await t.run((ctx) => ctx.db.get(own._id))).toEqual(ownBefore);

		const unpaid = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 10, cursor: null } });
		expect(unpaid.page).toMatchObject([{ _id: sale, customerName: 'Payer Pat', bookingReference: confirmationCode, otherBookings: 0, itemCount: 13 }]);
		// The booking continues on the sale while it charges the stay; its empty order isn't listed as history.
		expect(await admin.query(api.pos.ordersForBooking, { bookingId: stay })).toMatchObject({ activeOrder: { _id: sale }, orders: [{ _id: sale }] });

		// Reopening (by booking, twice, and after Save & close) lands on the same order with one charge.
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId: stay })).toEqual({ orderId: sale });
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId: stay })).toEqual({ orderId: sale });
		await admin.mutation(api.pos.saveOrder, { orderId: sale });
		expect((await order(sale)).source).toEqual(shown.source);
		expect(await t.run((ctx) => ctx.db.query('billLines').withIndex('by_bookingId', (q) => q.eq('bookingId', stay)).collect())).toHaveLength(1);
		const [row] = await admin.query(api.pos.listAttachable, { orderId: sale, query: confirmationCode! });
		expect(row.onOrder?._id).toBe(sale);

		const { due } = (await order(sale)).totals;
		await settle({ orderId: sale, idempotencyKey: 'attempt-0001', expectedDue: due, tenders: [{ method: 'card', amount: due }] });
		const receipt = await order(sale);
		expect(receipt.order).toMatchObject({ state: 'paid', orderNumber: number, customerSnapshot: { name: 'Payer Pat' } });
		expect(receipt.sources).toEqual(shown.sources);
		expect(await t.run((ctx) => ctx.db.get(stay))).toMatchObject({ paymentStatus: 'paid' });

		// Extras after payment go on the stay's own order, which still shows the stay; the receipt is untouched.
		const later = await admin.mutation(api.pos.openOrderFor, { bookingId: stay });
		expect(later).toEqual({ orderId: own._id });
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId: stay })).toEqual(later);
		await extra(own._id, 250);
		const extras = await order(own._id);
		expect(extras.order).toMatchObject({ bookingId: stay, orderNumber: ownBefore!.orderNumber });
		expect(extras.source).toMatchObject({ kind: 'booking', id: stay, reference: confirmationCode, linked: true });
		expect(extras.lines.map((line) => line.kind)).toEqual(['extra']);
		const after = await order(sale);
		expect(after.order).toEqual(receipt.order);
		expect(after.lines).toEqual(receipt.lines);
		expect(after.payments).toEqual(receipt.payments);
		expect(await t.run((ctx) => ctx.db.query('bills').collect())).toHaveLength(2);
		expect(await t.run((ctx) => ctx.db.query('billLines').withIndex('by_bookingId', (q) => q.eq('bookingId', stay)).collect())).toHaveLength(1);
		const paidList = await admin.query(api.pos.listOrders, { filter: 'paid', paginationOpts: { numItems: 10, cursor: null } });
		expect(paidList.page).toMatchObject([{ _id: sale, bookingReference: confirmationCode, customerName: 'Payer Pat' }]);
		const summary = (await admin.query(api.pos.ordersForBooking, { bookingId: stay }))!;
		expect(summary.activeOrder?._id).toBe(own._id);
		expect(summary.orders.map((o) => o._id).sort()).toEqual([own._id, sale].sort());
	});

	it('lists every booking an order charges, its own first, without listing a stay\'s appointment twice', async () => {
		const { admin, bookingId, appointment, order, extra } = await setup();
		const stay = await admin.mutation(api.adminBookings.createBooking, {
			propertySlug: 'villa', guestName: 'Mara', guestPhone: '+66 89 111 2222', checkIn: '2026-10-10', checkOut: '2026-10-12', guests: 2
		});
		const maraTreatment = await appointment({ bookingId: stay, confirmationCode: 'SVC-MARA' });
		const annaTreatment = await appointment({ bookingId, confirmationCode: 'SVC-ANNA' });
		const walkUp = await appointment({ confirmationCode: 'SVC-EVE' });

		// Only an appointment of a stay is charged: the appointment is shown, not its (uncharged) stay.
		const { orderId: sale } = await extra();
		await admin.mutation(api.pos.attach, { orderId: sale, appointmentId: maraTreatment });
		expect((await order(sale)).order.bookingId).toBeUndefined();
		expect((await order(sale)).sources).toMatchObject([{ kind: 'appointment', reference: 'SVC-MARA', linked: false }]);

		// Anna's stay has no order of its own yet, so this sale becomes it and is listed first.
		await admin.mutation(api.pos.attach, { orderId: sale, bookingId });
		await admin.mutation(api.pos.attach, { orderId: sale, appointmentId: annaTreatment });
		await admin.mutation(api.pos.attach, { orderId: sale, appointmentId: walkUp });
		const view = await order(sale);
		expect(view.order.bookingId).toBe(bookingId);
		expect(view.sources.map((s) => [s.reference, s.linked])).toEqual([['CONF-ANNA', true], ['SVC-MARA', false], ['SVC-EVE', false]]);
		expect(view.source).toEqual(view.sources[0]);
		const list = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 10, cursor: null } });
		expect(list.page).toMatchObject([{ _id: sale, bookingReference: 'CONF-ANNA', otherBookings: 2 }]);

		// Mara's stay itself, added later, absorbs her appointment's reference.
		await admin.mutation(api.pos.attach, { orderId: sale, bookingId: stay });
		expect((await order(sale)).sources.map((s) => s.kind + ':' + s.linked)).toEqual(['booking:true', 'booking:false', 'appointment:false']);
	});

	it('charges a later balance on a new order that follows the paid one, leaving the receipt as it was', async () => {
		const { t, admin, bookingId, order, settle } = await setup();
		const { orderId: first } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await settle({ orderId: first, idempotencyKey: 'attempt-0001', expectedDue: 20000, tenders: [{ method: 'transfer', amount: 20000 }] });
		const paid = await order(first);
		// The stay is extended by a night after it was paid.
		await t.run((ctx) => ctx.db.patch(bookingId, { total: 40000, nights: 4, checkOut: '2026-10-05' }));
		const { orderId: later } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		expect(later).not.toBe(first);
		const view = await order(later);
		expect(view.order).toMatchObject({ bookingId, parentOrderId: first, orderNumber: 2 });
		expect(view.parentOrder).toEqual({ _id: first, title: 'Order #1' });
		expect(view.totals).toMatchObject({ total: 40000, deposit: 30000, due: 10000 });
		const again = await order(first);
		expect(again.lines).toEqual(paid.lines);
		expect(again.order).toMatchObject({ status: 'paid', receiptNumber: 1, total: 30000 });
		await expect(admin.mutation(api.pos.addItem, { orderId: first, item: { kind: 'extra', name: 'Late', price: 1 } })).rejects.toThrow('already paid');
	});

	it('starts an additional order for a fully paid stay with nothing charged yet', async () => {
		const { t, admin, bookingId, order } = await setup();
		await t.run((ctx) => ctx.db.patch(bookingId, { paymentStatus: 'paid', amountPaid: 30000 }));
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		expect((await order(orderId)).lines).toHaveLength(0);
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId })).toEqual({ orderId });
		await t.run((ctx) => ctx.db.patch(bookingId, { status: 'cancelled', paymentStatus: 'refunded' }));
		await expect(admin.mutation(api.pos.openOrderFor, { bookingId })).rejects.toThrow('cancelled');
	});

	it('refuses to open a cancelled booking or appointment', async () => {
		const { t, admin, bookingId, appointment } = await setup();
		await t.run((ctx) => ctx.db.patch(bookingId, { status: 'cancelled' }));
		await expect(admin.mutation(api.pos.openOrderFor, { bookingId })).rejects.toThrow('cancelled');
		const cancelled = await appointment({ status: 'cancelled' });
		await expect(admin.mutation(api.pos.openOrderFor, { appointmentId: cancelled })).rejects.toThrow('nothing left to pay');
		expect(await t.run((ctx) => ctx.db.query('bills').collect())).toHaveLength(0);
	});

	it('finds the open order for a source even after many paid orders carried it', async () => {
		const { t, admin, bookingId } = await setup();
		// 25 earlier settlements of the same stay (e.g. extended night by night).
		await t.run(async (ctx) => {
			for (let i = 0; i < 25; i++) {
				const now = Date.now() - (25 - i) * 60_000;
				const orderId = await ctx.db.insert('bills', {
					status: 'paid', orderNumber: 100 + i, currency: 'THB', itemCount: 1, total: 100, due: 0, hasItems: true, revision: 1,
					receiptNumber: i + 1, createdBy: 'admin@example.com', createdAt: now, updatedAt: now
				});
				await ctx.db.insert('billLines', { billId: orderId, kind: 'booking', bookingId, name: 'Pool Villa', unitPrice: 100, currency: 'THB', qty: 1, createdAt: now });
			}
		});
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId })).toEqual({ orderId });
		const [attachable] = await admin.query(api.pos.listAttachable, { query: '+66 81 234 5678' });
		expect(attachable.onOrder?._id).toBe(orderId);
	});

	it('blocks an active online checkout before the cashier can charge its stay', async () => {
		const { t, admin, bookingId, order, extra } = await setup();
		await t.run((ctx) => ctx.db.patch(bookingId, { stripeCheckoutExpiresAt: Date.now() + 30 * 60_000 }));
		const [row] = await admin.query(api.pos.listAttachable, { query: 'CONF-ANNA' });
		expect(row.unavailableReason).toContain('Online checkout is in progress');
		await expect(admin.mutation(api.pos.openOrderFor, { bookingId })).rejects.toThrow('Online checkout is in progress');
		const { orderId } = await extra();
		await expect(admin.mutation(api.pos.attach, { orderId, bookingId })).rejects.toThrow('Online checkout is in progress');
		expect((await order(orderId)).lines).toHaveLength(1);
		await t.run((ctx) => ctx.db.patch(bookingId, { stripeCheckoutExpiresAt: Date.now() - 1 }));
		expect((await admin.query(api.pos.listAttachable, { query: 'CONF-ANNA' }))[0].unavailableReason).toBeNull();
		await admin.mutation(api.pos.attach, { orderId, bookingId });
		expect((await order(orderId)).lines).toHaveLength(2);
	});
});

describe('customers', () => {
	it('creates, finds, links and unlinks a customer without touching the booking guest', async () => {
		const { t, admin, bookingId, order } = await setup();
		const bob = await admin.mutation(api.customers.createCustomer, { name: ' Bob Payer ', phone: '+66 89 111 2222', email: 'Bob@Example.com' });
		expect(await admin.query(api.customers.searchCustomers, { query: '0891112222' })).toEqual([]);
		expect(await admin.query(api.customers.searchCustomers, { query: '66891112222' })).toMatchObject([{ _id: bob, name: 'Bob Payer' }]);
		expect(await admin.query(api.customers.searchCustomers, { query: 'bob@example.com' })).toMatchObject([{ _id: bob }]);
		expect(await admin.query(api.customers.searchCustomers, { query: 'Bob' })).toMatchObject([{ _id: bob }]);

		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		const before = (await order(orderId)).order.revision;
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: bob });
		const view = await order(orderId);
		expect(view.customer).toMatchObject({ _id: bob, name: 'Bob Payer' });
		expect(view.source?.guestName).toBe('Anna');
		expect(view.order.revision).toBe(before + 1);
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ guestName: 'Anna', guestPhone: '+66 81 234 5678' });
		expect(view.audit[0]).toMatchObject({ kind: 'customer_linked', customerId: bob, note: 'Bob Payer' });

		await admin.mutation(api.pos.unlinkCustomer, { orderId });
		expect((await order(orderId)).customer).toBeNull();
		expect((await order(orderId)).order.orderNumber).toBe(1);
		expect(await t.run((ctx) => ctx.db.query('customers').collect())).toHaveLength(1);
	});

	it('keeps one customer on many orders and namesakes apart', async () => {
		const { admin, extra } = await setup();
		const ann1 = await admin.mutation(api.customers.createCustomer, { name: 'Ann Lee', phone: '0811111111' });
		const ann2 = await admin.mutation(api.customers.createCustomer, { name: 'Ann Lee', phone: '0822222222' });
		expect(ann1).not.toBe(ann2);
		expect((await admin.query(api.customers.searchCustomers, { query: 'Ann Lee' })).map((c) => c._id).sort()).toEqual([ann1, ann2].sort());
		const { orderId: a } = await extra();
		const { orderId: b } = await extra();
		const linkedA = await admin.mutation(api.pos.linkCustomer, { orderId: a, customerId: ann1 });
		await admin.mutation(api.pos.linkCustomer, { orderId: b, customerId: ann1 });
		expect(linkedA).toEqual({ orderId: a });
		const profile = await admin.query(api.customers.getCustomer, { customerId: ann1 });
		expect(profile?.orders.map((o) => o._id).sort()).toEqual([a, b].sort());
		expect((await admin.query(api.customers.getCustomer, { customerId: ann2 }))?.orders).toEqual([]);
		// Linking a customer first starts an order for them.
		const { orderId: c } = await admin.mutation(api.pos.linkCustomer, { customerId: ann2 });
		expect(c).not.toBe(a);
	});

	it('rejects a missing customer and bad details', async () => {
		const { t, admin, extra } = await setup();
		const gone = await t.run(async (ctx) => {
			const id = await ctx.db.insert('customers', { name: 'Temp', createdBy: 'x', createdAt: 0, updatedAt: 0 });
			await ctx.db.delete(id);
			return id;
		});
		const { orderId } = await extra();
		await expect(admin.mutation(api.pos.linkCustomer, { orderId, customerId: gone })).rejects.toThrow('Customer not found');
		await expect(admin.mutation(api.customers.createCustomer, { name: '  ' })).rejects.toThrow('Enter the customer name');
		await expect(admin.mutation(api.customers.createCustomer, { name: 'X', email: 'not-an-email' })).rejects.toThrow();
		await expect(admin.mutation(api.customers.updateCustomer, { customerId: gone, name: 'Y' })).rejects.toThrow('Customer not found');
	});

	it('marks open orders changed when their customer is edited, so a reviewed payment is checked again', async () => {
		const { admin, order, extra } = await setup();
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob' });
		const { orderId } = await extra();
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: bob });
		const reviewed = (await order(orderId)).order.revision;
		await admin.mutation(api.customers.updateCustomer, { customerId: bob, name: 'Bob', notes: 'Prefers card' });
		expect((await order(orderId)).order.revision).toBe(reviewed);
		await admin.mutation(api.customers.updateCustomer, { customerId: bob, name: 'Robert' });
		const args = { orderId, idempotencyKey: 'attempt-0001', expectedDue: 100, tenders: [{ method: 'card' as const, amount: 100 }] };
		await expect(admin.mutation(api.pos.settleOrder, { ...args, expectedRevision: reviewed })).rejects.toThrow('The order changed');
	});

	it('freezes the receipt customer at payment, whatever happens to the profile later', async () => {
		const { admin, order, settle, extra } = await setup();
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob', phone: '0811111111' });
		const { orderId } = await extra();
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: bob });
		await settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 100, tenders: [{ method: 'cash', amount: 100 }] });
		await admin.mutation(api.customers.updateCustomer, { customerId: bob, name: 'Robert', phone: '0899999999' });
		const view = await order(orderId);
		expect(view.receiptCustomer).toEqual({ name: 'Bob', phone: '0811111111' });
		expect(view.customer?.name).toBe('Robert');
		await expect(admin.mutation(api.pos.unlinkCustomer, { orderId })).rejects.toThrow('already paid');
		await expect(admin.mutation(api.pos.linkCustomer, { orderId, customerId: bob })).rejects.toThrow('already paid');
	});
});

describe('save, list and resume', () => {
	it('saves and closes an order without changing it, and lists it with its customer, booking and balance', async () => {
		const { admin, bookingId, order, extra } = await setup();
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob' });
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: bob });
		const { lineId } = await extra(orderId, 250);
		await admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'amount', value: 50 } });
		const before = await order(orderId);
		vi.advanceTimersByTime(60_000);
		await admin.mutation(api.pos.saveOrder, { orderId });
		const after = await order(orderId);
		expect(after.order.revision).toBe(before.order.revision);
		expect(after.lines).toEqual(before.lines);
		expect(after.order.updatedAt).toBeGreaterThan(before.order.updatedAt);

		const { orderId: empty } = await admin.mutation(api.pos.linkCustomer, { customerId: bob });
		await expect(admin.mutation(api.pos.saveOrder, { orderId: empty })).rejects.toThrow('Add an item');
		const list = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 10, cursor: null } });
		expect(list.page).toMatchObject([{ _id: orderId, title: 'Order #1', customerName: 'Bob', bookingReference: 'CONF-ANNA', total: 30200, due: 20200, itemCount: 2 }]);
	});

	it('filters Unpaid, Paid and Voided orders with what each still owes, in pages', async () => {
		const { admin, settle, extra } = await setup();
		const ids = [];
		for (let i = 0; i < 4; i++) {
			vi.advanceTimersByTime(1000);
			ids.push((await extra(undefined, 100 + i)).orderId);
		}
		await settle({ orderId: ids[0], idempotencyKey: 'attempt-0001', expectedDue: 100, tenders: [{ method: 'cash', amount: 100 }] });
		await settle({ orderId: ids[1], idempotencyKey: 'attempt-0002', expectedDue: 101, tenders: [{ method: 'cash', amount: 101 }] });
		await admin.mutation(api.pos.voidOrder, { orderId: ids[1], reason: 'Test' });
		const list = (filter: 'unpaid' | 'paid' | 'void', numItems = 10, cursor: string | null = null) =>
			admin.query(api.pos.listOrders, { filter, paginationOpts: { numItems, cursor } });
		expect((await list('unpaid')).page.map((o) => [o._id, o.due])).toEqual([[ids[3], 103], [ids[2], 102]]);
		expect((await list('paid')).page).toMatchObject([{ _id: ids[0], due: 0, receiptNumber: 1, state: 'paid' }]);
		expect((await list('void')).page).toMatchObject([{ _id: ids[1], due: 0, receiptNumber: 2, state: 'void' }]);
		const first = await list('unpaid', 1);
		expect(first.page.map((o) => o._id)).toEqual([ids[3]]);
		expect(first.isDone).toBe(false);
		expect((await list('unpaid', 1, first.continueCursor)).page.map((o) => o._id)).toEqual([ids[2]]);
		// Page size is bounded on the server.
		expect((await list('unpaid', 10_000)).page.length).toBeLessThanOrEqual(50);
	});

	it('still lists an unpaid order behind many newer empty drafts (C4-02)', async () => {
		const { admin, extra } = await setup();
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob' });
		const { orderId } = await extra();
		for (let i = 0; i < 21; i++) {
			vi.advanceTimersByTime(1000);
			const { orderId: empty } = await admin.mutation(api.pos.linkCustomer, { customerId: bob });
			if (i % 2) await admin.mutation(api.pos.clearOrder, { orderId: empty });
		}
		const list = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 20, cursor: null } });
		expect(list.page.map((o) => o._id)).toEqual([orderId]);
	});

	it('clears an order but keeps its number and links', async () => {
		const { admin, bookingId, order } = await setup();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await admin.mutation(api.pos.clearOrder, { orderId });
		const view = await order(orderId);
		expect(view.lines).toHaveLength(0);
		expect(view.order).toMatchObject({ orderNumber: 1, bookingId, hasItems: false, due: 0 });
		expect(view.audit[0].kind).toBe('cleared');
	});
});

describe('source changes', () => {
	it('refuses to settle a stay that moved dates, then charges it after the row is updated (K5-01)', async () => {
		const { t, admin, bookingId, order, settle } = await setup();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await t.run((ctx) => ctx.db.patch(bookingId, { checkIn: '2026-10-05', checkOut: '2026-10-08' }));
		const [line] = (await order(orderId)).lines;
		expect(line.sourceIssue).toMatchObject({ kind: 'changed' });
		await expect(settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 20000, tenders: [{ method: 'card', amount: 20000 }] })).rejects.toThrow('changed since it was added');
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'pending' });

		const reviewed = (await order(orderId)).order.revision;
		await expect(admin.mutation(api.pos.updateSourceLine, { lineId: line._id })).resolves.toEqual({ result: 'updated' });
		const view = await order(orderId);
		expect(view.lines[0]).toMatchObject({ detail: expect.stringContaining('2026-10-05'), sourceIssue: null });
		expect(view.order.revision).toBeGreaterThan(reviewed);
		expect(view.audit[0]).toMatchObject({ kind: 'source_updated' });
		await expect(admin.mutation(api.pos.updateSourceLine, { lineId: line._id })).resolves.toEqual({ result: 'current' });
		await settle({ orderId, idempotencyKey: 'attempt-0002', expectedDue: 20000, tenders: [{ method: 'card', amount: 20000 }] });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
	});

	it('counts a deposit paid after the stay was added only once', async () => {
		const { t, admin, bookingId, order, settle } = await setup();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await t.run((ctx) => ctx.db.patch(bookingId, { amountPaid: 15000 }));
		const [line] = (await order(orderId)).lines;
		expect(line.sourceIssue?.kind).toBe('changed');
		await admin.mutation(api.pos.updateSourceLine, { lineId: line._id });
		expect((await order(orderId)).totals).toMatchObject({ deposit: 15000, due: 15000 });
		await settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 15000, tenders: [{ method: 'cash', amount: 15000 }] });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ amountPaid: 30000, paymentStatus: 'paid' });
	});

	it('refuses a stay paid online or cancelled meanwhile, and drops it on update', async () => {
		const { t, admin, bookingId, order, settle, extra } = await setup();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await extra(orderId, 500);
		// The guest completes an online payment for the balance on another device.
		await t.run((ctx) => ctx.db.patch(bookingId, { paymentStatus: 'paid', amountPaid: 30000 }));
		const view = await order(orderId);
		expect(view.lines[0].sourceIssue).toMatchObject({ kind: 'settled' });
		await expect(settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 20500, tenders: [{ method: 'card', amount: 20500 }] })).rejects.toThrow('paid since it was added');
		await expect(admin.mutation(api.pos.updateSourceLine, { lineId: view.lines[0]._id })).resolves.toEqual({ result: 'removed' });
		expect((await order(orderId)).lines.map((line) => line.kind)).toEqual(['extra']);
		expect((await order(orderId)).audit[0]).toMatchObject({ kind: 'source_removed' });
		await settle({ orderId, idempotencyKey: 'attempt-0002', expectedDue: 500, tenders: [{ method: 'card', amount: 500 }] });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ amountPaid: 30000 });
	});

	it('flags a cancelled appointment and refuses its payment', async () => {
		const { t, admin, appointment, order, settle } = await setup();
		const id = await appointment();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId: id });
		await t.run((ctx) => ctx.db.patch(id, { status: 'cancelled' }));
		expect((await order(orderId)).lines[0].sourceIssue?.kind).toBe('settled');
		await expect(settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 1200, tenders: [{ method: 'cash', amount: 1200 }] })).rejects.toThrow('paid or cancelled');
	});

	it('refuses to record a payment elsewhere while an open order charges the source', async () => {
		const { admin, bookingId, appointment } = await setup();
		const id = await appointment();
		await admin.mutation(api.pos.openOrderFor, { bookingId });
		await admin.mutation(api.pos.openOrderFor, { appointmentId: id });
		await expect(admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'markPaid' })).rejects.toThrow('on Order #1, which is still open');
		await expect(admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId: id })).rejects.toThrow('on Order #2, which is still open');
	});

	it('keeps a booking with an order from being deleted', async () => {
		const { t, admin, propertyId } = await setup();
		const pending = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Zed', guestPhone: '0800000000', checkIn: '2026-11-01', checkOut: '2026-11-02', guests: 1, nights: 1,
			subtotal: 100, discountAmount: 0, total: 100, currency: 'THB', paymentStatus: 'pending', status: 'pending', source: 'admin', createdAt: Date.now()
		}));
		await admin.mutation(api.pos.openOrderFor, { bookingId: pending });
		await expect(admin.mutation(api.adminBookings.deleteBooking, { bookingId: pending })).rejects.toThrow('has an order');
		expect(await admin.mutation(api.adminBookings.deleteBookings, { bookingIds: [pending] })).toMatchObject({ deleted: 0, skipped: [{ reason: expect.stringContaining('has an order') }] });
	});

	it('creates every new stay and appointment with its order, which a test booking can still be deleted with', async () => {
		const { t, admin, serviceId, order } = await setup();
		const bookingId = await admin.mutation(api.adminBookings.createBooking, {
			propertySlug: 'villa', guestName: 'Mia', guestPhone: '0811111111', checkIn: '2026-12-01', checkOut: '2026-12-03', guests: 2
		});
		const created = await admin.query(api.pos.ordersForBooking, { bookingId });
		expect(created?.activeOrder).toMatchObject({ title: 'Order #1', due: 0 });
		const orderId = created!.activeOrder!._id;
		expect((await order(orderId)).order).toMatchObject({ bookingId, hasItems: false, createdBy: 'admin@example.com' });
		// Empty orders stay out of the Unpaid list until something is charged.
		expect((await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
		// The stay's appointment goes on the stay's order; a standalone one gets its own.
		const start = new Date('2026-12-02T03:00:00.000Z').getTime();
		const { appointmentId: related } = await admin.mutation(api.adminServices.createAppointment, { serviceId, start, guestName: 'Mia', guestPhone: '0811111111', bookingId });
		const { appointmentId: alone } = await admin.mutation(api.adminServices.createAppointment, { serviceId, start: start + 7_200_000, guestName: 'Leo', guestPhone: '0822222222' });
		expect((await admin.query(api.pos.ordersForBooking, { appointmentId: related }))?.activeOrder?._id).toBe(orderId);
		expect((await admin.query(api.pos.ordersForBooking, { appointmentId: alone }))?.activeOrder?.title).toBe('Order #2');
		// Opening it at checkout charges the stay on that same order.
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId })).toEqual({ orderId });
		expect((await order(orderId)).lines.map((line) => line.kind)).toEqual(['booking']);

		const test = await admin.mutation(api.adminBookings.createBooking, {
			propertySlug: 'villa', guestName: 'Test', guestPhone: '0800000000', checkIn: '2026-12-10', checkOut: '2026-12-11', guests: 1
		});
		await admin.mutation(api.adminBookings.deleteBooking, { bookingId: test });
		expect(await t.run((ctx) => ctx.db.query('bills').collect())).toHaveLength(2);
	});

	it('re-charges a stay removed from its order when the booking is opened again', async () => {
		const { admin, bookingId, order } = await setup();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await admin.mutation(api.pos.removeLine, { lineId: (await order(orderId)).lines[0]._id });
		expect(await admin.mutation(api.pos.openOrderFor, { bookingId })).toEqual({ orderId });
		expect((await order(orderId)).lines.filter((line) => line.bookingId === bookingId)).toHaveLength(1);
	});

	it('records the full total when a deposited stay is marked paid outside checkout', async () => {
		const { t, admin, bookingId } = await setup();
		await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'markPaid' });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
		expect((await admin.query(api.pos.ordersForBooking, { bookingId }))?.balance.owed).toBe(0);
	});

	it('refuses to settle an appointment whose price changed, and records a discounted price (C4-04)', async () => {
		const { t, admin, appointment, order, settle } = await setup();
		const id = await appointment();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId: id });
		await t.run((ctx) => ctx.db.patch(id, { price: 2000 }));
		await expect(settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 1200, tenders: [{ method: 'cash', amount: 1200 }] })).rejects.toThrow('changed since it was added');
		expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ paymentStatus: 'unpaid' });

		await t.run((ctx) => ctx.db.patch(id, { price: 1200 }));
		const { lines } = await order(orderId);
		await admin.mutation(api.pos.updateLine, { lineId: lines[0]._id, discount: { type: 'percent', value: 10 } });
		await settle({ orderId, idempotencyKey: 'attempt-0002', expectedDue: 1080, tenders: [{ method: 'cash', amount: 1080 }] });
		expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ paymentStatus: 'paid', price: 1080 });
	});

	it('refuses an appointment that moved to another therapist or time until its row is updated (C4-04)', async () => {
		const { t, admin, nok, ploy, appointment, order, settle } = await setup();
		const id = await appointment();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId: id });
		const pay = (key: string) => settle({ orderId, idempotencyKey: key, expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] });
		await t.run((ctx) => ctx.db.patch(id, { staffId: ploy }));
		await expect(pay('attempt-0001')).rejects.toThrow('changed since it was added');
		await t.run((ctx) => ctx.db.patch(id, { staffId: nok, start: Date.now() + 86_400_000 }));
		await expect(pay('attempt-0002')).rejects.toThrow('changed since it was added');
		expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ paymentStatus: 'unpaid' });
		await admin.mutation(api.pos.updateSourceLine, { lineId: (await order(orderId)).lines[0]._id });
		await pay('attempt-0003');
		expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ paymentStatus: 'paid' });
	});
});

describe('settlement', () => {
	it('deducts the online deposit of a stay and marks it paid', async () => {
		const { t, admin, bookingId, serviceId, order, settle } = await setup();
		const attachable = await admin.query(api.pos.listAttachable, { query: '+66 81 234 5678' });
		expect(attachable).toMatchObject([{ kind: 'booking', id: bookingId, price: 30000, deposit: 10000, guestName: 'Anna', onOrder: null }]);
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		const { lineId } = await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'percent', value: 10 } });
		expect((await order(orderId)).totals).toEqual({ subtotal: 31200, discount: 120, total: 31080, vat: 2033.27, deposit: 10000, due: 21080 });
		await settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 21080, tenders: [{ method: 'card', amount: 21080 }] });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
	});

	it('closes an order with nothing due without a payment', async () => {
		const { t, admin, bookingId, order, settle } = await setup();
		await t.run((ctx) => ctx.db.patch(bookingId, { amountPaid: 30000 }));
		// amountPaid covers the total but the stay is still pending: nothing is owed, so it can't be charged.
		await expect(admin.mutation(api.pos.attach, { bookingId })).rejects.toThrow('nothing left to pay');
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Gift', price: 0 } });
		expect((await order(orderId)).totals.due).toBe(0);
		await expect(settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 0, tenders: [] })).resolves.toMatchObject({ receiptNumber: 1 });
		expect(await t.run((ctx) => ctx.db.query('billPayments').collect())).toHaveLength(0);
	});

	it('settles once when the same payment attempt is retried or double-clicked', async () => {
		const { t, admin, serviceId, order, settle } = await setup();
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const args = { orderId, idempotencyKey: 'attempt-0001', expectedDue: 1200, tenders: [{ method: 'cash' as const, amount: 1200, received: 1500 }] };
		const revision = (await order(orderId)).order.revision;
		const [first, retry] = await Promise.all([
			admin.mutation(api.pos.settleOrder, { ...args, expectedRevision: revision }),
			admin.mutation(api.pos.settleOrder, { ...args, expectedRevision: revision })
		]);
		expect([first, retry]).toEqual(expect.arrayContaining([{ receiptNumber: 1, replayed: false }, { receiptNumber: 1, replayed: true }]));
		expect(await t.run((ctx) => ctx.db.query('billPayments').collect())).toHaveLength(1);
		await expect(settle({ ...args, idempotencyKey: 'attempt-0002' })).rejects.toThrow('already paid');
		expect((await order(orderId)).order.status).toBe('paid');
	});

	it('refuses split payments that do not add up, more than three, or a stale total', async () => {
		const { admin, serviceId, settle: settleWith } = await setup();
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const settle = (tenders: Array<{ method: 'cash' | 'promptpay' | 'card' | 'transfer'; amount: number }>, expectedDue = 1200) =>
			settleWith({ orderId, idempotencyKey: `attempt-${Math.random()}`, expectedDue, tenders });
		await expect(settle([{ method: 'cash', amount: 500 }, { method: 'promptpay', amount: 600 }])).rejects.toThrow('Payments add up to 1100');
		await expect(settle([300, 300, 300, 300].map((amount) => ({ method: 'card' as const, amount })))).rejects.toThrow('at most 3');
		await expect(settle([{ method: 'card', amount: 1000 }], 1000)).rejects.toThrow('The order changed');
		await expect(settle([{ method: 'cash', amount: 500 }, { method: 'promptpay', amount: 700 }])).resolves.toMatchObject({ receiptNumber: 1 });
	});

	it('refuses a payment reviewed before the customer changed, even at the same total', async () => {
		const { admin, order, extra } = await setup();
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob' });
		const { orderId } = await extra();
		const reviewed = (await order(orderId)).order.revision;
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: bob });
		const args = { orderId, expectedDue: 100, tenders: [{ method: 'card' as const, amount: 100 }] };
		await expect(admin.mutation(api.pos.settleOrder, { ...args, idempotencyKey: 'attempt-0001', expectedRevision: reviewed })).rejects.toThrow('The order changed');
		await admin.mutation(api.pos.settleOrder, { ...args, idempotencyKey: 'attempt-0002', expectedRevision: (await order(orderId)).order.revision });
	});

	it('refuses a payment for an order that changed at the same total (C4-06)', async () => {
		const { admin, serviceId, nok, order } = await setup();
		const other = await admin.mutation(api.adminServices.createService, {
			slug: 'aroma', name: 'Aroma oil', description: '', category: 'Massage', durationMin: 60, bufferMin: 0, price: 1200, currency: 'THB', staffIds: [nok]
		});
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const reviewed = (await order(orderId)).order.revision;
		await admin.mutation(api.pos.removeLine, { lineId });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId: other } });
		const args = { orderId, expectedDue: 1200, tenders: [{ method: 'card' as const, amount: 1200 }] };
		await expect(admin.mutation(api.pos.settleOrder, { ...args, idempotencyKey: 'attempt-0001', expectedRevision: reviewed })).rejects.toThrow('The order changed');
		const current = (await order(orderId)).order.revision;
		await admin.mutation(api.pos.settleOrder, { ...args, idempotencyKey: 'attempt-0002', expectedRevision: current });
		// A retry of the successful attempt still replays, whatever revision it carries.
		expect(await admin.mutation(api.pos.settleOrder, { ...args, idempotencyKey: 'attempt-0002', expectedRevision: current })).toMatchObject({ replayed: true });
	});

	it('numbers receipts in sequence apart from order numbers, and keeps both after a void', async () => {
		const { admin, serviceId, order, settle, extra } = await setup();
		await extra(); // order #1 stays unpaid, so receipt and order numbers differ
		const paidOrder = async (key: string) => {
			const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
			await settle({ orderId, idempotencyKey: key, expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] });
			return orderId;
		};
		const first = await paidOrder('attempt-0001');
		await expect(admin.mutation(api.pos.voidOrder, { orderId: first, reason: ' ' })).rejects.toThrow('reason');
		await admin.mutation(api.pos.voidOrder, { orderId: first, reason: 'Wrong guest' });
		const second = await paidOrder('attempt-0002');
		const voided = await order(first);
		expect(voided.order).toMatchObject({ status: 'void', orderNumber: 2, receiptNumber: 1, voidReason: 'Wrong guest', state: 'void' });
		expect(voided.payments).toHaveLength(1);
		expect(voided.audit.map((a) => a.kind)).toEqual(['void', 'paid']);
		expect((await order(second)).order).toMatchObject({ status: 'paid', orderNumber: 3, receiptNumber: 2 });
		await expect(admin.mutation(api.pos.addItem, { orderId: first, item: { kind: 'service', serviceId } })).rejects.toThrow('voided');
		await expect(admin.mutation(api.pos.voidOrder, { orderId: first, reason: 'Again' })).rejects.toThrow('Only a paid order');
	});

	it('leaves a voided order’s stay paid; refunds are recorded on the booking', async () => {
		const { t, admin, bookingId, settle } = await setup();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 20000, tenders: [{ method: 'card', amount: 20000 }] });
		await admin.mutation(api.pos.voidOrder, { orderId, reason: 'Wrong card' });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
	});
});

describe('order rows', () => {
	it('keeps each service its own row and stacks nights into a quantity', async () => {
		const { admin, serviceId, propertyId, order } = await setup();
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'room', propertyId } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'room', propertyId } });
		const view = await order(orderId);
		expect(view.lines.map((line) => [line.kind, line.qty])).toEqual([['service', 1], ['service', 1], ['room', 2]]);
		expect(view.order).toMatchObject({ orderNumber: 1, title: 'Order #1', itemCount: 4, total: 22400 });
	});

	it('prints the therapist a paid row was issued with, even after a rename', async () => {
		const { admin, serviceId, nok, order, settle } = await setup();
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.updateLine, { lineId, staffId: nok });
		await settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] });
		await admin.mutation(api.adminServices.updateStaff, { staffId: nok, name: 'Nok R.' });
		expect((await order(orderId)).lines[0].staffName).toBe('Nok');
	});

	it('only lets eligible therapists take a service row', async () => {
		const { admin, serviceId, nok, ploy, order } = await setup();
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.updateLine, { lineId, staffId: nok });
		expect((await order(orderId)).lines[0].staffName).toBe('Nok');
		await expect(admin.mutation(api.pos.updateLine, { lineId, staffId: ploy })).rejects.toThrow("Ploy doesn't offer this service");
		await admin.mutation(api.pos.updateLine, { lineId, staffId: null });
		expect((await order(orderId)).lines[0].staffId).toBeUndefined();
	});

	it('requires a note to override a price and audits it', async () => {
		const { admin, serviceId, order } = await setup();
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		await expect(admin.mutation(api.pos.overrideLinePrice, { lineId, price: 900, note: '  ' })).rejects.toThrow('Add a note');
		await admin.mutation(api.pos.overrideLinePrice, { lineId, price: 900, note: 'Regular guest' });
		const view = await order(orderId);
		expect(view.totals.total).toBe(900);
		expect(view.lines[0].priceOverride).toMatchObject({ price: 900, note: 'Regular guest', by: 'admin@example.com' });
		expect(view.audit[0]).toMatchObject({ kind: 'price_override', fromPrice: 1200, toPrice: 900, note: 'Regular guest', actor: 'admin@example.com' });
	});

	it('keeps stays at their booked price, so the booking records what was paid (C4-05)', async () => {
		const { admin, bookingId, order } = await setup();
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		const lineId = (await order(orderId)).lines[0]._id;
		await expect(admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'percent', value: 10 } })).rejects.toThrow('on the booking');
		await expect(admin.mutation(api.pos.overrideLinePrice, { lineId, price: 27000, note: 'Loyal guest' })).rejects.toThrow('on the booking');
		expect((await order(orderId)).totals.due).toBe(20000);
	});

	it('steps quantities on the server so quick taps add up (C4-07)', async () => {
		const { admin, propertyId, order } = await setup();
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'room', propertyId } });
		await Promise.all([admin.mutation(api.pos.updateLine, { lineId, qtyChange: 1 }), admin.mutation(api.pos.updateLine, { lineId, qtyChange: 1 })]);
		expect((await order(orderId)).lines[0].qty).toBe(3);
		for (let i = 0; i < 4; i++) await admin.mutation(api.pos.updateLine, { lineId, qtyChange: -1 });
		expect((await order(orderId)).lines[0].qty).toBe(1);
	});

	it('shows catalog photos beside items without copying them onto the rows', async () => {
		const { t, admin, serviceId, propertyId, bookingId, order } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.patch(serviceId, { imageUrl: 'https://example.com/massage.jpg' });
			await ctx.db.patch(propertyId, { images: ['/pool-villa-pool.webp', '/pool-villa-living.webp'] });
		});
		const catalog = await admin.query(api.pos.catalog, {});
		expect(catalog.services[0].imageUrl).toBe('https://example.com/massage.jpg');
		expect(catalog.rooms[0].imageUrl).toBe('/pool-villa-pool.webp');

		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'room', propertyId } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Water', price: 50 } });
		const photos = (await order(orderId)).lines.map((line) => [line.kind, line.imageUrl]);
		expect(photos).toEqual([['booking', '/pool-villa-pool.webp'], ['service', 'https://example.com/massage.jpg'], ['room', '/pool-villa-pool.webp'], ['extra', undefined]]);
		// The rows themselves stay as added: the photo is looked up, never stored.
		const stored = await t.run((ctx) => ctx.db.query('billLines').collect());
		expect(stored.some((line) => 'imageUrl' in line)).toBe(false);

		// A removed photo just falls back; nothing about the order changes.
		await t.run((ctx) => ctx.db.patch(serviceId, { imageUrl: undefined }));
		expect((await order(orderId)).lines.find((line) => line.kind === 'service')?.imageUrl).toBeUndefined();
	});

	it('only sells and charges THB prices (C4-01)', async () => {
		const { t, admin, nok, propertyId, order } = await setup();
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
		await expect(admin.mutation(api.pos.openOrderFor, { bookingId: usdBooking })).rejects.toThrow('USD');
		expect(await admin.query(api.pos.listAttachable, { query: '+1 555 0100' })).toMatchObject([{ currency: 'USD' }]);
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'room', propertyId } });
		expect((await order(orderId)).order.currency).toBe('THB');
	});

	it('keeps a row at the baht price it was added at if the service later changes currency (C4-01)', async () => {
		const { t, admin, serviceId, order, settle } = await setup();
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		expect((await order(orderId)).lines[0].currency).toBe('THB');
		await t.run((ctx) => ctx.db.patch(serviceId, { currency: 'USD' }));
		await expect(settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 1200, tenders: [{ method: 'card', amount: 1200 }] })).resolves.toMatchObject({ replayed: false });
	});

	it('finds stays saved before the phone and email lookup fields, by what staff type (C4-03)', async () => {
		const { t, admin, propertyId } = await setup();
		const legacy = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Carla', guestPhone: '081-999-0000', checkIn: '2026-11-01', checkOut: '2026-11-03',
			guests: 1, nights: 2, subtotal: 20000, discountAmount: 0, total: 20000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: Date.now()
		}));
		const emailOnly = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Dana', guestPhone: '', guestEmail: 'Dana@Example.com', guestEmailNormalized: 'dana@example.com', checkIn: '2026-11-05', checkOut: '2026-11-06',
			guests: 1, nights: 1, subtotal: 10000, discountAmount: 0, total: 10000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: Date.now()
		}));
		expect(await admin.query(api.pos.listAttachable, { query: '081-999-0000' })).toMatchObject([{ id: legacy }]);
		expect(await admin.query(api.pos.listAttachable, { query: 'Dana@Example.com' })).toMatchObject([{ id: emailOnly }]);
		expect(await admin.query(api.pos.listAttachable, { query: 'x' })).toEqual([]);
	});

	it("suggests the order's own stay, its appointments and the customer's bookings (C6-02)", async () => {
		const { admin, bookingId, appointment, extra } = await setup();
		const related = await appointment({ bookingId });
		const alone = await appointment({ guestName: 'Standalone Guest', guestPhone: '0899990000', confirmationCode: 'SVC-9' });
		const { orderId } = await extra();
		expect(await admin.query(api.pos.listAttachable, { orderId })).toEqual([]);
		const anna = await admin.mutation(api.customers.createCustomer, { name: 'Anna (payer)', phone: '+66 81 234 5678' });
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: anna });
		expect((await admin.query(api.pos.listAttachable, { orderId })).map((row) => row.id).sort()).toEqual([bookingId, related].sort());
		expect(await admin.query(api.pos.listAttachable, { query: 'svc-9' })).toMatchObject([{ kind: 'appointment', id: alone, guestName: 'Standalone Guest' }]);
		expect(await admin.query(api.pos.listAttachable, { query: 'Standalone' })).toMatchObject([{ kind: 'appointment', id: alone }]);
		expect(await admin.query(api.pos.listAttachable, { query: '0899990000' })).toMatchObject([{ kind: 'appointment', id: alone }]);
	});

	it('refuses payment amounts finer than a satang and cash that is not an amount (K4-01, C5-02)', async () => {
		const { admin, settle, extra } = await setup();
		const { orderId } = await extra(undefined, 90);
		const revision = (await admin.query(api.pos.getOrder, { orderId }))!.order.revision;
		await expect(admin.mutation(api.pos.settleOrder, {
			orderId, idempotencyKey: 'attempt-0001', expectedDue: 90, expectedRevision: revision,
			tenders: [{ method: 'cash', amount: 45.004 }, { method: 'card', amount: 44.996 }]
		})).rejects.toThrow('satang');
		for (const received of [Infinity, NaN, 1e12]) {
			await expect(settle({ orderId, idempotencyKey: `attempt-${received}`, expectedDue: 90, tenders: [{ method: 'cash', amount: 90, received }] })).rejects.toThrow();
		}
		await expect(admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Huge', price: 1e12 } })).rejects.toThrow('at most');
	});

	it('caps prices at 1,000,000 and an order at 10,000,000, so the satang math stays exact (K5-02)', async () => {
		const { admin, order, settle } = await setup();
		await expect(admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Huge', price: 1_000_000.01 } })).rejects.toThrow('at most 1,000,000');
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Event', price: 1_000_000 } });
		await admin.mutation(api.pos.updateLine, { lineId, qtyChange: 9 });
		await expect(admin.mutation(api.pos.updateLine, { lineId, qtyChange: 1 })).rejects.toThrow('An order is at most 10,000,000');
		await expect(admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Water', price: 90 } })).rejects.toThrow('An order is at most');
		expect((await order(orderId)).totals.due).toBe(10_000_000);
		await expect(settle({ orderId, idempotencyKey: 'attempt-0001', expectedDue: 10_000_000, tenders: [{ method: 'cash', amount: 10_000_000, received: 10_000_100 }] })).rejects.toThrow('at most 10,000,000');
		await expect(settle({ orderId, idempotencyKey: 'attempt-0002', expectedDue: 10_000_000, tenders: [{ method: 'cash', amount: 10_000_000, received: 10_000_000 }] })).resolves.toMatchObject({ replayed: false });
	});
});

describe('access', () => {
	it('refuses every order and customer function to anonymous and non-admin callers', async () => {
		const { t, bookingId, extra, admin } = await setup();
		const { orderId, lineId } = await extra();
		const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Bob' });
		const page = { numItems: 5, cursor: null };
		const guest = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
		for (const caller of [t, guest]) {
			const calls: Array<() => Promise<unknown>> = [
				() => caller.query(api.pos.catalog, {}),
				() => caller.query(api.pos.getOrder, { orderId }),
				() => caller.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: page }),
				() => caller.query(api.pos.findOrderByNumber, { orderNumber: 1 }),
				() => caller.query(api.pos.ordersForBooking, { bookingId }),
				() => caller.query(api.pos.listAttachable, { query: 'Anna' }),
				() => caller.mutation(api.pos.openOrderFor, { bookingId }),
				() => caller.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'X', price: 1 } }),
				() => caller.mutation(api.pos.attach, { orderId, bookingId }),
				() => caller.mutation(api.pos.updateLine, { lineId, qtyChange: 1 }),
				() => caller.mutation(api.pos.overrideLinePrice, { lineId, price: 1, note: 'x' }),
				() => caller.mutation(api.pos.removeLine, { lineId }),
				() => caller.mutation(api.pos.updateSourceLine, { lineId }),
				() => caller.mutation(api.pos.linkCustomer, { orderId, customerId }),
				() => caller.mutation(api.pos.unlinkCustomer, { orderId }),
				() => caller.mutation(api.pos.saveOrder, { orderId }),
				() => caller.mutation(api.pos.clearOrder, { orderId }),
				() => caller.mutation(api.pos.settleOrder, { orderId, idempotencyKey: 'attempt-0001', expectedDue: 100, expectedRevision: 1, tenders: [{ method: 'cash', amount: 100 }] }),
				() => caller.mutation(api.pos.voidOrder, { orderId, reason: 'x' }),
				() => caller.query(api.customers.searchCustomers, { query: 'Bob' }),
				() => caller.query(api.customers.getCustomer, { customerId }),
				() => caller.mutation(api.customers.createCustomer, { name: 'Eve' }),
				() => caller.mutation(api.customers.updateCustomer, { customerId, name: 'Eve' })
			];
			for (const call of calls) await expect(call()).rejects.toThrow(/Not (authenticated|authorized)/);
		}
		expect(await t.run((ctx) => ctx.db.query('customers').collect())).toHaveLength(1);
	});

	it('keeps customer details out of public booking responses', async () => {
		const { t, admin, bookingId, order } = await setup();
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob Secret', phone: '0811110000' });
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: bob });
		expect((await order(orderId)).customer?.name).toBe('Bob Secret');
		await t.run((ctx) => ctx.db.patch(bookingId, { accessToken: 'guest-token-anna' }));
		const publicView = await t.query(api.bookings.getById, { id: bookingId, accessToken: 'guest-token-anna' });
		expect(publicView).toMatchObject({ confirmationCode: 'CONF-ANNA' });
		expect(JSON.stringify(publicView)).not.toMatch(/Bob Secret|0811110000|customer/i);
	});
});
