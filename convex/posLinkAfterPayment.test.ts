import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

/**
 * Optional service date and time at checkout, and linking a paid service or room row to its
 * appointment or stay after payment (pos.linkPaidLine / unlinkPaidLine), against the real
 * transactions: payment records on the targets, corrections, voids and refunds.
 */

const modules = import.meta.glob('./**/*.ts');
const weekdays = [0, 1, 2, 3, 4, 5, 6];

beforeEach(() => vi.stubEnv('ADMIN_EMAILS', 'desk@example.com'));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'desk@example.com', tokenIdentifier: 'desk' });
	const hours = { workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] };
	const nok = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', ...hours });
	const service = (slug: string, name: string, price: number) => admin.mutation(api.services.commands.createService.createService, {
		slug, name, description: '', category: 'Massage', durationMin: 60, bufferMin: 15, price, currency: 'THB', staffIds: [nok]
	});
	const massage = await service('thai-massage', 'Thai massage', 120000);
	const scrub = await service('scrub', 'Body scrub', 90000);
	const { villa, otherVilla } = await t.run(async (ctx) => {
		const property = (slug: string, name: string) => ctx.db.insert('properties', {
			slug, name, tagline: '', description: '', pricePerNight: 1000000, currency: 'THB', maxGuests: 4,
			bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		});
		return { villa: await property('villa', 'Pool Villa'), otherVilla: await property('garden', 'Garden Villa') };
	});
	const stay = (overrides: Record<string, unknown> = {}) => t.run((ctx) => insertFixture(ctx, 'bookings', {
		propertyId: villa, guestName: 'Anna', guestPhone: '+66 81 234 5678', guestPhoneDigits: '66812345678', checkIn: '2026-12-01', checkOut: '2026-12-04',
		guests: 2, nights: 3, subtotal: 3000000, discountAmount: 0, total: 3000000, currency: 'THB', amountPaid: 1000000,
		paymentStatus: 'pending', status: 'confirmed', confirmationCode: 'CONF-ANNA', guestEmailsOff: true, createdAt: Date.now(), ...overrides
	}));
	const appointment = (overrides: Record<string, unknown> = {}) => {
		const start = Date.now() + 2 * 86_400_000;
		return t.run((ctx) => insertFixture(ctx, 'appointments', {
			serviceId: massage, staffId: nok, start, end: start + 3_600_000, blockedUntil: start + 4_500_000, guestName: 'Eve', guestPhone: '+66 82 000 1111',
			source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 130000, currency: 'THB', confirmationCode: 'SVC-EVE', accessToken: 'tok', createdAt: Date.now(),
			...overrides
		}));
	};
	const order = (orderId: Id<'orders'>) => admin.query(api.pos.getOrder, { orderId }).then((view) => view!);
	const pay = async (orderId: Id<'orders'>) => {
		const view = await order(orderId);
		return admin.mutation(api.pos.settleOrder, {
			orderId, idempotencyKey: `pay-${orderId}`, expectedDue: view.totals.due, expectedRevision: view.order.revision,
			tenders: [{ method: 'cash', amount: view.totals.due }]
		});
	};
	/** A paid order with one service (or room) row, its schedule left blank. */
	const paidRow = async (item: { kind: 'service'; serviceId: Id<'services'> } | { kind: 'room'; propertyId: Id<'properties'> }, nights = 1) => {
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item });
		for (let n = 1; n < nights; n++) await admin.mutation(api.pos.addItem, { orderId, item });
		await pay(orderId);
		return { orderId, lineId };
	};
	const getAppointment = (id: Id<'appointments'>) => t.run((ctx) => ctx.db.get(id)).then((row) => row!);
	const getBooking = (id: Id<'bookings'>) => t.run((ctx) => ctx.db.get(id)).then((row) => row!);
	let attempt = 0;
	const link = async (orderId: Id<'orders'>, lineId: Id<'orderLines'>, target: { appointmentId: Id<'appointments'> } | { bookingId: Id<'bookings'> }, extra: Partial<{ key: string; correction: number; revision: number }> = {}) => {
		const view = await order(orderId);
		const revision = extra.revision ?? ('appointmentId' in target ? (await getAppointment(target.appointmentId)).revision ?? 0 : (await getBooking(target.bookingId)).revision ?? 0);
		return admin.mutation(api.pos.linkPaidLine, {
			orderId, lineId, ...target, expectedTargetRevision: revision, expectedCorrectionRevision: extra.correction ?? view.paymentRecord.correctionRevision,
			idempotencyKey: extra.key ?? `link-attempt-${++attempt}`, reason: 'Booked the prepaid service'
		});
	};
	const unlink = async (orderId: Id<'orders'>, linkId: Id<'orderLineLinks'>, key = `unlink-attempt-${++attempt}`) => {
		const view = await order(orderId);
		return admin.mutation(api.pos.unlinkPaidLine, { orderId, linkId, expectedCorrectionRevision: view.paymentRecord.correctionRevision, idempotencyKey: key, reason: 'Linked the wrong one' });
	};
	/** What the receipt shows; linking must never change any of it. */
	const receipt = async (orderId: Id<'orders'>) => {
		const view = await order(orderId);
		return {
			receiptNumber: view.order.receiptNumber, paidAt: view.order.paidAt, total: view.order.total, totals: view.totals,
			payments: view.payments.map(({ method, amount, received, effectiveAt }) => ({ method, amount, received, effectiveAt })),
			lines: view.lines.map(({ name, unitPrice, qty, net, schedule, startAt, bookingId, appointmentId }) => ({ name, unitPrice, qty, net, schedule, startAt, bookingId, appointmentId })),
			sources: view.sources
		};
	};
	return { t, admin, nok, massage, scrub, villa, otherVilla, stay, appointment, order, pay, paidRow, getAppointment, getBooking, link, unlink, receipt };
}

describe('optional service date and time', () => {
	it('starts new service rows unscheduled, sets and clears date and time independently, and pays with both blank', async () => {
		const { admin, massage, order, pay } = await setup();
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: massage } });
		const row = async () => (await order(orderId)).lines[0];
		expect((await row()).schedule).toEqual({});
		expect((await row()).startAt).toBeUndefined();

		await admin.mutation(api.pos.updateLine, { lineId, serviceDate: '2026-12-03' });
		expect((await row()).schedule).toEqual({ date: '2026-12-03' });
		await admin.mutation(api.pos.updateLine, { lineId, serviceTime: '14:30' });
		expect((await row()).schedule).toEqual({ date: '2026-12-03', time: '14:30' });
		await admin.mutation(api.pos.updateLine, { lineId, serviceDate: null });
		expect((await row()).schedule).toEqual({ time: '14:30' });
		await admin.mutation(api.pos.updateLine, { lineId, serviceTime: '' });
		expect((await row()).schedule).toEqual({});

		await expect(admin.mutation(api.pos.updateLine, { lineId, serviceDate: '2026-02-30' })).rejects.toThrow(/YYYY-MM-DD/);
		await expect(admin.mutation(api.pos.updateLine, { lineId, serviceTime: '24:00' })).rejects.toThrow(/HH:MM/);
		expect((await row()).schedule).toEqual({});

		// A known day with no time is a complete answer: payment needs neither part.
		await admin.mutation(api.pos.updateLine, { lineId, serviceDate: '2026-12-03' });
		const { receiptNumber } = await pay(orderId);
		const paid = await order(orderId);
		expect(paid.order.status).toBe('paid');
		expect(receiptNumber).toBeGreaterThan(0);
		expect(paid.lines[0].schedule).toEqual({ date: '2026-12-03' });
		expect(paid.lines[0].startAt).toBeUndefined();
		await expect(admin.mutation(api.pos.updateLine, { lineId, serviceTime: '10:00' })).rejects.toThrow(/already paid/);
	});
});

describe('linking a paid service row to an appointment', () => {
	it('records the appointment as paid by the order without touching the receipt, and lists the order on the appointment', async () => {
		const { admin, massage, appointment, paidRow, getAppointment, link, order, receipt } = await setup();
		const { orderId, lineId } = await paidRow({ kind: 'service', serviceId: massage });
		const appointmentId = await appointment();
		const before = await receipt(orderId);
		const paidOrder = await order(orderId);

		const result = await link(orderId, lineId, { appointmentId });
		expect(result).toMatchObject({ sequence: 1, replayed: false });
		const linked = await getAppointment(appointmentId);
		expect(linked).toMatchObject({ paymentStatus: 'paid', price: 120000, amountPaid: 120000, amountRefunded: 0, paidAt: paidOrder.order.paymentEffectiveAt });
		expect(await receipt(orderId)).toEqual(before);

		const view = await order(orderId);
		expect(view.paymentRecord.correctionRevision).toBe(1);
		expect(view.corrections[0]).toMatchObject({ kind: 'linked', sequence: 1, lineId, appointmentId, amount: 120000 });
		expect(view.links).toEqual([expect.objectContaining({ lineId, kind: 'appointment', status: 'active', amount: 120000, target: expect.objectContaining({ reference: 'SVC-EVE' }) })]);

		const sheet = await admin.query(api.pos.ordersForBooking, { appointmentId });
		expect(sheet?.orders.map((row) => row._id)).toContain(orderId);
		expect(sheet?.balance.owed).toBe(0);
		// The receipt owns the money: it is refundable from that receipt, and not payable again.
		const financials = await admin.query(api.services.admin.getAppointmentFinancials, { appointmentId });
		expect(financials.orders).toEqual([expect.objectContaining({ orderId: orderId, charged: 120000, refundable: 120000 })]);
		await expect(admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId })).rejects.toThrow(/unpaid/);
		await expect(admin.mutation(api.pos.attach, { appointmentId })).rejects.toThrow(/nothing left to pay/);
	});

	it('refuses other services, open orders, already-linked targets, wrong row kinds, stale revisions and reused keys, writing nothing', async () => {
		const { admin, massage, scrub, appointment, paidRow, link, order, getAppointment, stay } = await setup();
		const { orderId, lineId } = await paidRow({ kind: 'service', serviceId: massage });
		const otherService = await appointment({ serviceId: scrub, confirmationCode: 'SVC-SCRUB' });
		await expect(link(orderId, lineId, { appointmentId: otherService })).rejects.toThrow(/different service/);

		const onOpenOrder = await appointment({ confirmationCode: 'SVC-OPEN' });
		const open = await admin.mutation(api.pos.attach, { appointmentId: onOpenOrder });
		await expect(link(orderId, lineId, { appointmentId: onOpenOrder })).rejects.toThrow(new RegExp(`${(await order(open.orderId)).order.title}.*still open`));

		await expect(link(orderId, lineId, { bookingId: await stay() })).rejects.toThrow(/appointment, not a stay/);

		const target = await appointment();
		await expect(link(orderId, lineId, { appointmentId: target }, { correction: 5 })).rejects.toThrow(/corrected since/);
		await expect(link(orderId, lineId, { appointmentId: target }, { revision: 7 })).rejects.toThrow(/changed since you opened it/);
		expect((await order(orderId)).paymentRecord.correctionRevision).toBe(0);
		expect((await getAppointment(target)).paymentStatus).toBe('unpaid');

		// One try, retried: the second call returns the first result instead of linking twice.
		const first = await link(orderId, lineId, { appointmentId: target }, { key: 'link-once-0001' });
		const again = await link(orderId, lineId, { appointmentId: target }, { key: 'link-once-0001', correction: 0 });
		expect(again).toEqual({ ...first, replayed: true });
		expect((await order(orderId)).corrections.filter((row) => row.kind === 'linked')).toHaveLength(1);
		await expect(link(orderId, lineId, { appointmentId: otherService }, { key: 'link-once-0001' })).rejects.toThrow(/already used for something else/);

		// The row and the appointment each take one link.
		await expect(link(orderId, lineId, { appointmentId: await appointment({ confirmationCode: 'SVC-2' }) })).rejects.toThrow(/already linked/);
		const second = await paidRow({ kind: 'service', serviceId: massage });
		await expect(link(second.orderId, second.lineId, { appointmentId: target })).rejects.toThrow(/already paid/);

		// Only paid orders.
		const unpaid = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: massage } });
		await expect(link(unpaid.orderId, unpaid.lineId, { appointmentId: await appointment({ confirmationCode: 'SVC-3' }) })).rejects.toThrow(/Only a paid order/);
	});

	it('suggests candidates with the reason each one cannot take the row', async () => {
		const { admin, massage, scrub, appointment, paidRow } = await setup();
		const { orderId, lineId } = await paidRow({ kind: 'service', serviceId: massage });
		const good = await appointment({ guestName: 'Eve Candidate' });
		const other = await appointment({ guestName: 'Eve Candidate', serviceId: scrub, confirmationCode: 'SVC-SCRUB' });
		const rows = await admin.query(api.pos.linkCandidates, { orderId, lineId, query: 'Eve Candidate' });
		expect(rows?.[0]).toMatchObject({ id: good, problem: null, kind: 'appointment' });
		expect(rows?.find((row) => row.id === other)?.problem).toMatch(/different service/);
	});

	it('unlinks exactly what it applied, can link again, and refuses once the money was refunded', async () => {
		const { admin, massage, appointment, paidRow, getAppointment, link, unlink, order, receipt } = await setup();
		const { orderId, lineId } = await paidRow({ kind: 'service', serviceId: massage });
		const appointmentId = await appointment();
		const before = await receipt(orderId);
		const { linkId } = await link(orderId, lineId, { appointmentId });

		await unlink(orderId, linkId, 'unlink-once-0001');
		expect(await getAppointment(appointmentId)).toMatchObject({ paymentStatus: 'unpaid', price: 130000, amountPaid: 0 });
		expect((await getAppointment(appointmentId)).paidAt).toBeUndefined();
		expect(await unlink(orderId, linkId, 'unlink-once-0001')).toMatchObject({ replayed: true });
		await expect(unlink(orderId, linkId)).rejects.toThrow(/already undone/);
		const view = await order(orderId);
		expect(view.links[0]).toMatchObject({ status: 'unlinked', unlinkReason: 'Linked the wrong one' });
		expect(view.corrections.map((row) => row.kind)).toEqual(['unlinked', 'linked']);
		expect(await receipt(orderId)).toEqual(before);
		expect((await admin.query(api.services.admin.getAppointmentFinancials, { appointmentId })).orders).toEqual([]);

		const relinked = await link(orderId, lineId, { appointmentId });
		const appt = await getAppointment(appointmentId);
		await admin.mutation(api.services.commands.refundAppointment.refundAppointment, {
			appointmentId, expectedRevision: appt.revision ?? 0, amount: 20000, currency: 'THB', method: 'cash', reason: 'Shorter session', idempotencyKey: 'refund-0001', orderId: orderId
		});
		await expect(unlink(orderId, relinked.linkId)).rejects.toThrow(/refunded/);
		await expect(admin.mutation(api.pos.voidUnreceivedOrder, {
			orderId, expectedCorrectionRevision: (await order(orderId)).paymentRecord.correctionRevision, idempotencyKey: 'void-unreceived-1', reason: 'Mistake'
		})).rejects.toThrow(/refunded/);
		expect((await getAppointment(appointmentId)).paymentStatus).toBe('paid');
	});
});

describe('linking a paid room row to a stay', () => {
	it('applies the room charge as a checkout payment on the stay, in full or in part, never more than it owes', async () => {
		const { admin, villa, otherVilla, stay, paidRow, getBooking, link, order, receipt } = await setup();
		// 20,000 still owed (30,000 less a 10,000 deposit); two nights at 10,000 pay it in full.
		const bookingId = await stay();
		const { orderId, lineId } = await paidRow({ kind: 'room', propertyId: villa }, 2);
		const before = await receipt(orderId);
		await link(orderId, lineId, { bookingId });
		expect(await getBooking(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 3000000 });
		const financials = await admin.query(api.bookings.admin.bookingFinancials, { bookingId });
		expect(financials?.payments[0]).toMatchObject({ origin: 'pos', amount: 2000000, status: 'recorded', order: expect.objectContaining({ _id: orderId }) });
		expect(await receipt(orderId)).toEqual(before);
		expect((await admin.query(api.pos.ordersForBooking, { bookingId }))?.orders.map((row) => row._id)).toContain(orderId);

		// One night paid on another order: part of a stay's balance; the stay stays pending.
		const partStay = await stay({ confirmationCode: 'CONF-PART', guestName: 'Part', checkIn: '2027-01-01', checkOut: '2027-01-04' });
		const part = await paidRow({ kind: 'room', propertyId: villa });
		await link(part.orderId, part.lineId, { bookingId: partStay });
		expect(await getBooking(partStay)).toMatchObject({ paymentStatus: 'pending', amountPaid: 2000000 });

		// More than the stay owes, or a different villa: refused.
		const smallStay = await stay({ confirmationCode: 'CONF-SMALL', total: 1500000, amountPaid: 1000000, checkIn: '2027-02-01', checkOut: '2027-02-04' });
		const big = await paidRow({ kind: 'room', propertyId: villa });
		await expect(link(big.orderId, big.lineId, { bookingId: smallStay })).rejects.toThrow(/less than this row/);
		const elsewhere = await stay({ confirmationCode: 'CONF-GARDEN', propertyId: otherVilla });
		await expect(link(big.orderId, big.lineId, { bookingId: elsewhere })).rejects.toThrow(/different villa/);
		expect((await getBooking(smallStay)).amountPaid).toBe(1000000);
		expect((await order(big.orderId)).paymentRecord.correctionRevision).toBe(0);
	});

	it('refunds linked stay money by its receipt, and then refuses to unlink it', async () => {
		const { admin, villa, stay, paidRow, getBooking, link, unlink } = await setup();
		const bookingId = await stay();
		const { orderId, lineId } = await paidRow({ kind: 'room', propertyId: villa }, 2);
		const { linkId } = await link(orderId, lineId, { bookingId });
		await admin.mutation(api.bookings.commands.cancelStay.cancelStay, { bookingId, expectedRevision: (await getBooking(bookingId)).revision ?? 0, reason: 'Guest cancelled', notifyGuest: false });
		await admin.mutation(api.bookings.commands.recordRefund.recordRefund, {
			bookingId, expectedRevision: (await getBooking(bookingId)).revision ?? 0, amount: 500000, currency: 'THB', method: 'cash', reason: 'Part refund', idempotencyKey: 'stay-refund-0001', orderId: orderId
		});
		const financials = await admin.query(api.bookings.admin.bookingFinancials, { bookingId });
		expect(financials?.payments.find((row) => row.origin === 'pos')).toMatchObject({ refunded: 500000, refundable: 1500000 });
		await expect(unlink(orderId, linkId)).rejects.toThrow(/refunded/);
	});

	it('refuses a stay that is on an open order or whose revision changed', async () => {
		const { admin, villa, stay, paidRow, link } = await setup();
		const bookingId = await stay();
		const { orderId, lineId } = await paidRow({ kind: 'room', propertyId: villa });
		await expect(link(orderId, lineId, { bookingId }, { revision: 9 })).rejects.toThrow(/changed since you opened it/);
		await admin.mutation(api.pos.attach, { bookingId });
		await expect(link(orderId, lineId, { bookingId })).rejects.toThrow(/still open/);
	});

	it('refunds the exact linked payment even when older cancelled payments fill the receipt history page', async () => {
		const { t, admin, villa, stay, paidRow, getBooking, link } = await setup();
		const bookingId = await stay();
		const { orderId, lineId } = await paidRow({ kind: 'room', propertyId: villa }, 2);
		await t.run(async (ctx) => {
			for (let n = 0; n < 101; n++) {
				await ctx.db.insert('bookingPayments', {
					bookingId, orderId: orderId, origin: 'pos', method: 'order', amount: 2000000, currency: 'THB',
					effectiveAt: n, recordedAt: n, recordedBy: 'desk@example.com', status: 'cancelled', refunded: 0
				});
			}
		});
		await link(orderId, lineId, { bookingId });
		await admin.mutation(api.bookings.commands.cancelStay.cancelStay, { bookingId, expectedRevision: (await getBooking(bookingId)).revision ?? 0, reason: 'Guest cancelled', notifyGuest: false });
		await admin.mutation(api.bookings.commands.recordRefund.recordRefund, {
			bookingId, expectedRevision: (await getBooking(bookingId)).revision ?? 0, amount: 500000, currency: 'THB', method: 'cash',
			reason: 'Return linked money', idempotencyKey: 'refund-relinked-stay', orderId: orderId
		});
		const payment = await t.run(async (ctx) => {
			const link = await ctx.db.query('orderLineLinks').withIndex('by_lineId_and_status', (q) => q.eq('lineId', lineId).eq('status', 'active')).unique();
			return ctx.db.get(link!.bookingPaymentId!);
		});
		expect(payment).toMatchObject({ status: 'recorded', refunded: 500000 });
	});

	it('unlinks by cancelling only the link’s payment and restoring the stay’s pending status', async () => {
		const { villa, stay, paidRow, getBooking, link, unlink, admin } = await setup();
		const bookingId = await stay();
		const { orderId, lineId } = await paidRow({ kind: 'room', propertyId: villa }, 2);
		const { linkId } = await link(orderId, lineId, { bookingId });
		await unlink(orderId, linkId);
		expect(await getBooking(bookingId)).toMatchObject({ paymentStatus: 'pending', amountPaid: 1000000 });
		const financials = await admin.query(api.bookings.admin.bookingFinancials, { bookingId });
		expect(financials?.payments[0]).toMatchObject({ origin: 'pos', status: 'cancelled' });
		expect(financials?.money.owed).toBe(2000000);
	});
});

describe('order corrections understand links', () => {
	it('keeps the current source receipt discoverable beyond a page of undone links', async () => {
		const { t, admin, massage, appointment, paidRow, link } = await setup();
		const appointmentId = await appointment();
		const previous = await paidRow({ kind: 'service', serviceId: massage });
		const current = await paidRow({ kind: 'service', serviceId: massage });
		await t.run(async (ctx) => {
			await ctx.db.patch(current.orderId, { updatedAt: 1 });
			for (let n = 0; n < 21; n++) {
				await ctx.db.insert('orderLineLinks', {
					orderId: previous.orderId, lineId: previous.lineId, kind: 'appointment', appointmentId, amount: 120000, currency: 'THB',
					status: 'unlinked', effectiveAt: 1, reason: 'Previous link', linkedAt: n, linkedBy: 'desk@example.com', sequence: n + 1,
					unlinkedAt: n + 1, unlinkedBy: 'desk@example.com', unlinkReason: 'Previous unlink'
				});
			}
		});
		await link(current.orderId, current.lineId, { appointmentId });
		const sheet = await admin.query(api.pos.ordersForBooking, { appointmentId });
		expect(sheet?.orders[0]._id).toBe(current.orderId);
		expect(sheet?.orders.map((row) => row._id)).toContain(previous.orderId);
	});

	it('keeps active links visible when the order has more than a page of undone links', async () => {
		const { t, massage, appointment, paidRow, link, unlink, order } = await setup();
		const appointmentId = await appointment();
		const { orderId, lineId } = await paidRow({ kind: 'service', serviceId: massage });
		// A history accumulated by repeated linking and unlinking must not hide today's active link.
		await t.run(async (ctx) => {
			for (let n = 0; n < 101; n++) {
				await ctx.db.insert('orderLineLinks', {
					orderId: orderId, lineId, kind: 'appointment', appointmentId, amount: 120000, currency: 'THB',
					status: 'unlinked', effectiveAt: 1, reason: 'Previous link', linkedAt: n, linkedBy: 'desk@example.com', sequence: n + 1,
					unlinkedAt: n + 1, unlinkedBy: 'desk@example.com', unlinkReason: 'Previous unlink'
				});
			}
		});
		const { linkId } = await link(orderId, lineId, { appointmentId });
		expect((await order(orderId)).links.find((row) => row._id === linkId)?.status).toBe('active');
		await unlink(orderId, linkId);
		expect((await order(orderId)).links[0]).toMatchObject({ _id: linkId, status: 'unlinked' });
	});

	it('voiding as unreceived reverses links; a plain void keeps the linked money', async () => {
		const { admin, massage, villa, stay, appointment, paidRow, getAppointment, getBooking, link, order } = await setup();
		const appointmentId = await appointment();
		const bookingId = await stay();
		const { orderId, lineId } = await paidRow({ kind: 'service', serviceId: massage });
		await link(orderId, lineId, { appointmentId });
		const { lineId: roomLine } = await admin.mutation(api.pos.addItem, { item: { kind: 'room', propertyId: villa } }).then(async ({ orderId: roomOrder, lineId }) => {
			await admin.mutation(api.pos.addItem, { orderId: roomOrder, item: { kind: 'room', propertyId: villa } });
			const view = await order(roomOrder);
			await admin.mutation(api.pos.settleOrder, { orderId: roomOrder, idempotencyKey: `pay-${roomOrder}`, expectedDue: view.totals.due, expectedRevision: view.order.revision, tenders: [{ method: 'cash', amount: view.totals.due }] });
			await link(roomOrder, lineId, { bookingId });
			await admin.mutation(api.pos.voidOrder, { orderId: roomOrder, reason: 'Wrong receipt printed' });
			return { lineId };
		});
		void roomLine;
		// Plain void: money was received, so the stay stays paid.
		expect((await getBooking(bookingId)).paymentStatus).toBe('paid');

		await admin.mutation(api.pos.voidUnreceivedOrder, {
			orderId, expectedCorrectionRevision: (await order(orderId)).paymentRecord.correctionRevision, idempotencyKey: 'void-unreceived-2', reason: 'Card declined after all'
		});
		expect(await getAppointment(appointmentId)).toMatchObject({ paymentStatus: 'unpaid', price: 130000, amountPaid: 0 });
		const view = await order(orderId);
		expect(view.order.status).toBe('void');
		expect(view.links[0]).toMatchObject({ status: 'unlinked' });
		// The appointment is free to be linked or charged again.
		await admin.mutation(api.pos.attach, { appointmentId });
	});

	it('moves the linked payments when the order’s received date is corrected', async () => {
		const { admin, massage, villa, stay, appointment, paidRow, getAppointment, link, order } = await setup();
		const appointmentId = await appointment();
		const bookingId = await stay();
		const { orderId, lineId } = await paidRow({ kind: 'service', serviceId: massage });
		await link(orderId, lineId, { appointmentId });
		const room = await paidRow({ kind: 'room', propertyId: villa }, 2);
		await link(room.orderId, room.lineId, { bookingId });

		const earlier = Date.now() - 3 * 86_400_000;
		for (const id of [orderId, room.orderId]) {
			await admin.mutation(api.pos.amendOrderPayment, {
				orderId: id, expectedCorrectionRevision: (await order(id)).paymentRecord.correctionRevision, idempotencyKey: `amend-${id}`, reason: 'Paid on Monday', effectiveAt: earlier
			});
		}
		expect((await getAppointment(appointmentId)).paidAt).toBe(earlier);
		const financials = await admin.query(api.bookings.admin.bookingFinancials, { bookingId });
		expect(financials?.payments[0]).toMatchObject({ effectiveAt: earlier });
		expect((await order(orderId)).links[0].effectiveAt).toBe(earlier);
	});
});
