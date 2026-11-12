import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-01T06:00:00Z'));
	vi.stubEnv('ADMIN_EMAILS', 'audit@example.com');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'audit@example.com', tokenIdentifier: 'audit' });
	const propertyId = await admin.mutation(api.catalog.adminProperties.create, { name: 'Audit Villa', slug: 'audit-villa' });
	await admin.mutation(api.catalog.properties.update, { propertyId, pricePerNight: 100000, status: 'active' });
	const view = (orderId: Id<'orders'>) => admin.query(api.pos.getOrder, { orderId }).then((order) => order!);
	const booking = () => admin.mutation(api.adminBookings.createBooking, {
		propertySlug: 'audit-villa', guestName: 'Guest X', guestPhone: '+66 81 234 5678', guestEmail: 'regular@example.com',
		checkIn: '2026-12-01', checkOut: '2026-12-02', guests: 1, confirmed: true, notifyGuest: false,
	});
	const extra = () => admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 5000 } });
	const discard = async (orderId: Id<'orders'>) => admin.mutation(api.pos.discardOrder, {
		orderId, expectedRevision: (await view(orderId)).order.revision, idempotencyKey: `discard-${orderId}`,
	});
	const settle = async (orderId: Id<'orders'>) => {
		const order = await view(orderId);
		return admin.mutation(api.pos.settleOrder, {
			orderId, expectedRevision: order.order.revision, expectedDue: order.totals.due,
			...(order.customer && 'revision' in order.customer ? { expectedCustomerRevision: order.customer.revision } : {}),
			idempotencyKey: `payment-${orderId}`, tenders: [{ method: 'cash', amount: order.totals.due }],
		});
	};
	return { t, admin, propertyId, view, booking, extra, discard, settle };
}

describe('verified POS bug hunt regressions', () => {
	it('H1-01 refuses a stale fee above a corrected appointment price', async () => {
		const { t, admin, view, settle } = await setup();
		const staffId = await admin.mutation(api.adminServices.createStaff, {
			name: 'Nok', role: 'Therapist', color: '#abc', breaks: [],
			workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
		});
		const service = (price: number) => admin.mutation(api.adminServices.createService, {
			slug: `massage-${price}`, name: `Massage ${price}`, description: '', category: 'Massage',
			durationMin: 60, bufferMin: 0, price, currency: 'THB', staffIds: [staffId],
		});
		const serviceId = await service(120000);
		const cheaperServiceId = await service(50000);
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, {
			serviceId, staffId, start: Date.parse('2026-10-31T03:00:00Z'),
			guestName: 'Anna', guestPhone: '0812345678', historicalReason: 'Record yesterday’s appointment',
		});
		const appointment = () => t.run((ctx) => ctx.db.get(appointmentId)).then((row) => row!);
		const correct = async (status: 'booked' | 'no_show') => admin.mutation(api.adminServices.correctAppointmentStatus, {
			appointmentId, expectedRevision: (await appointment()).revision ?? 0, status,
			reason: 'Correct recorded status', effectiveAt: Date.now(),
		});
		await correct('no_show');
		const { orderId } = await admin.mutation(api.pos.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 80000 });
		await correct('booked');
		await admin.mutation(api.adminServices.updateAppointmentDetails, {
			appointmentId, expectedRevision: (await appointment()).revision ?? 0,
			serviceId: cheaperServiceId, guestName: 'Anna', guestPhone: '0812345678',
		});
		await correct('no_show');
		expect((await view(orderId)).lines[0].sourceIssue?.message).toContain('price');
		await expect(settle(orderId)).rejects.toThrow('price');
		expect((await view(orderId)).order.state).toBe('unpaid');
		await admin.mutation(api.pos.removeLine, { lineId: (await view(orderId)).lines[0]._id });
		await admin.mutation(api.pos.addAppointmentFee, { orderId, appointmentId, kind: 'no_show', amount: 50000 });
		await expect(settle(orderId)).resolves.toBeDefined();
	});

	it.each(['remove', 'clear', 'prune', 'restore'] as const)('H1-02 releases an attached stay link after %s removes its last row', async (action) => {
		const { admin, view, booking, extra, discard, settle } = await setup();
		const bookingId = await booking();
		const original = await admin.mutation(api.pos.openOrderForLink, { bookingId });
		await discard(original.orderId);
		const { orderId } = await extra();
		await admin.mutation(api.pos.attach, { orderId, bookingId });
		const lineId = (await view(orderId)).lines.find((line) => line.bookingId === bookingId)!._id;
		if (action === 'remove') await admin.mutation(api.pos.removeLine, { lineId });
		if (action === 'clear') await admin.mutation(api.pos.clearOrder, { orderId });
		if (action === 'prune') {

			await discard(orderId);
			const replacement = await admin.mutation(api.pos.openOrderForLink, { bookingId });
			await settle(replacement.orderId);
			await admin.mutation(api.pos.restoreOrder, {
				orderId, expectedRevision: (await view(orderId)).order.revision, idempotencyKey: 'restore-for-prune',
			});
			expect((await view(orderId)).lines.find((line) => line._id === lineId)?.sourceIssue?.kind).toBe('settled');
			await expect(admin.mutation(api.pos.updateSourceLine, { lineId })).resolves.toEqual({ result: 'removed' });
		}
		if (action === 'restore') {
			await discard(orderId);
			await admin.mutation(api.pos.openOrderForLink, { bookingId });
			await admin.mutation(api.pos.restoreOrder, {
				orderId, expectedRevision: (await view(orderId)).order.revision,
				idempotencyKey: 'restore-without-stay', removeConflictingRows: true,
			});
		}
		const removed = await view(orderId);
		expect(removed.order.bookingId).toBeUndefined();
		expect(removed.source).toBeNull();
		expect(removed.sources).toEqual([]);
		if (action === 'remove' || action === 'clear') {
			const reopened = await admin.mutation(api.pos.openOrderForLink, { bookingId });
			expect(reopened.orderId).not.toBe(orderId);
		}
	});

	it('H1-02 preserves an explicitly booking-owned order when it is cleared', async () => {
		const { admin, view, booking } = await setup();
		const bookingId = await booking();
		const { orderId } = await admin.mutation(api.pos.openOrderForLink, { bookingId });
		await admin.mutation(api.pos.clearOrder, { orderId });
		expect((await view(orderId)).order.bookingId).toBe(bookingId);
		expect(await admin.mutation(api.pos.openOrderForLink, { bookingId })).toEqual({ orderId });
	});

	it.each([false, true])('H1-02 releases the last attached appointment link (part of stay: %s)', async (partOfStay) => {
		const { admin, view, booking, extra, discard } = await setup();
		const bookingId = partOfStay ? await booking() : undefined;
		const staffId = await admin.mutation(api.adminServices.createStaff, {
			name: 'Ploy', role: 'Therapist', color: '#def', breaks: [],
			workingHours: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
		});
		const serviceId = await admin.mutation(api.adminServices.createService, {
			slug: 'attachment-massage', name: 'Massage', description: '', category: 'Massage', durationMin: 60, bufferMin: 0,
			price: 50000, currency: 'THB', staffIds: [staffId],
		});
		const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, {
			serviceId, staffId, bookingId, start: Date.parse('2026-12-01T03:00:00Z'), guestName: 'Anna', guestPhone: '0812345678',
		});
		const original = await admin.mutation(api.pos.openOrderForLink, { appointmentId });
		await discard(original.orderId);
		const { orderId } = await extra();
		await admin.mutation(api.pos.attach, { orderId, appointmentId });
		if (partOfStay) {
			await admin.mutation(api.pos.attach, { orderId, bookingId });
			const stay = (await view(orderId)).lines.find((row) => row.bookingId === bookingId)!;
			await admin.mutation(api.pos.removeLine, { lineId: stay._id });
			// The stay's appointment is still a row for that source, so keep the link until it goes.
			expect((await view(orderId)).order.bookingId).toBe(bookingId);
		}
		const line = (await view(orderId)).lines.find((row) => row.appointmentId === appointmentId)!;
		await admin.mutation(api.pos.removeLine, { lineId: line._id });
		const cleared = await view(orderId);
		expect(cleared.order.bookingId).toBeUndefined();
		expect(cleared.order.appointmentId).toBeUndefined();
		expect(cleared.source).toBeNull();
		expect((await admin.mutation(api.pos.openOrderForLink, { appointmentId })).orderId).not.toBe(orderId);
	});

	it('H1-04 sends stale-payment, validation and customer refusals as application errors', async () => {
		const { admin, view, extra } = await setup();
		const { orderId } = await extra();
		const staleRevision = (await view(orderId)).order.revision;
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Coffee', price: 10000 } });
		await expect(admin.mutation(api.pos.settleOrder, {
			orderId, expectedRevision: staleRevision, expectedDue: 5000, idempotencyKey: 'stale-payment', tenders: [{ method: 'cash', amount: 5000 }],
		})).rejects.toMatchObject({ data: 'The order changed. Check the total and pay again.' });
		await expect(admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Bad price', price: -100 } })).rejects.toBeInstanceOf(ConvexError);
		await expect(admin.mutation(api.customers.createCustomer, { name: '' })).rejects.toMatchObject({ data: 'Enter the customer name' });
		await expect(admin.mutation(api.customers.createCustomer, { name: 'Anna', email: 'invalid' })).rejects.toMatchObject({ data: 'Please enter a valid email address' });
	});

	it('H1-05 finds older payable stays behind paid history in contact search and payer suggestions', async () => {
		const { t, admin, propertyId } = await setup();
		let unpaid!: Id<'bookings'>;
		let extended!: Id<'bookings'>;
		let legacy!: Id<'bookings'>;
		await t.run(async (ctx) => {
			for (let i = 0; i < 24; i++) {
				const id = await insertFixture(ctx, 'bookings', {
					propertyId, guestName: `Regular ${i}`, guestPhone: '+66 81 234 5678',
					...(i === 2 ? {} : { guestPhoneDigits: '66812345678', guestEmailNormalized: 'regular@example.com' }),
					guestEmail: 'regular@example.com', checkIn: '2026-12-01', checkOut: '2026-12-02', guests: 1, nights: 1,
					subtotal: 100000, discountAmount: 0, total: 100000, currency: 'THB', status: 'confirmed',
					paymentStatus: i === 0 || i === 2 ? 'pending' : 'paid', amountPaid: i === 0 || i === 2 ? 0 : i === 1 ? 50000 : 100000,
					confirmationCode: `REGULAR-${i}`, createdAt: Date.now(),
				});
				if (i === 0) unpaid = id;
				if (i === 1) extended = id;
				if (i === 2) legacy = id;
			}
		});
		const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Regular Payer', phone: '+66 81 234 5678', email: 'regular@example.com' });
		const { orderId } = await admin.mutation(api.pos.linkCustomer, { customerId });
		for (const args of [{ query: '66812345678' }, { query: 'regular@example.com' }, { orderId }, { query: '+66 81 234 5678' }]) {
			const matches = await admin.query(api.pos.listAttachable, args);
			expect(matches.map((row) => row.id)).toEqual(expect.arrayContaining([unpaid, extended]));
		}
		const raw = await admin.query(api.pos.listAttachable, { query: '+66 81 234 5678' });
		expect(raw.map((row) => row.id)).toContain(legacy);
	});

	it('H1-05 reports a capped history lookup instead of claiming the search is complete', async () => {
		const { t, admin, booking } = await setup();
		const target = await booking();
		const original = (await t.run((ctx) => ctx.db.get(target)))!;
		const { _id: ignoredId, _creationTime: ignoredCreation, ...fields } = original;
		void ignoredId; void ignoredCreation;
		await t.run(async (ctx) => {
			for (let i = 0; i < 501; i++) await insertFixture(ctx, 'bookings', { ...fields, paymentStatus: 'paid', amountPaid: 100000, confirmationCode: `PAID-${i}` });
		});
		const query = 'regular@example.com';
		expect(await admin.query(api.pos.listAttachable, { query })).toEqual([]);
		expect(await admin.query(api.pos.attachLookupStatus, { query })).toMatchObject({ complete: false, bookingsIncomplete: true });
		expect((await admin.query(api.pos.listAttachable, { query: original.confirmationCode })).map((row) => row.id)).toContain(target);
		expect(await admin.query(api.pos.attachLookupStatus, { query: original.confirmationCode })).toEqual({ complete: true });
	});

	it('H1-09 lists the corrected payer and respects clearing the payer', async () => {
		const { admin, view, extra, settle } = await setup();
		const alice = await admin.mutation(api.customers.createCustomer, { name: 'Alice' });
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob' });
		const { orderId } = await extra();
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: alice });
		await settle(orderId);
		const amend = (customerId: Id<'customers'> | null, revision: number) => admin.mutation(api.pos.amendOrderPayment, {
			orderId, expectedCorrectionRevision: revision, idempotencyKey: `amend-payer-${revision}`, reason: 'Correct the receipt payer',
			customer: { customerId, ...(customerId ? { expectedCustomerRevision: 0 } : {}) },
		});
		await amend(bob, 0);
		const list = () => admin.query(api.pos.listOrders, { filter: 'paid', paginationOpts: { numItems: 10, cursor: null } });
		expect((await list()).page[0].customerName).toBe('Bob');
		expect((await view(orderId)).receiptCustomer?.name).toBe('Alice');
		await amend(null, 1);
		expect((await list()).page[0].customerName).toBeUndefined();
	});
});
