// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

/**
 * Booking corrections and financial records: refunds, payment entries and their corrections,
 * custom prices, reopening, history, notifications, deletion snapshots, POS settlement dates and
 * receipt amendments. Every test calls the real Convex functions.
 */

const modules = import.meta.glob('./**/*.ts');
const adminEmail = 'admin@example.com';
const DAY = 86_400_000;
const isoInDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const page = { numItems: 50, cursor: null };
let keySeq = 0;
const key = (label = 'attempt') => `${label}-${String(++keySeq).padStart(6, '0')}`;

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', adminEmail);
	const t = convexTest(schema, modules);
	const propertyId = await t.run((ctx) => ctx.db.insert('properties', {
		slug: 'pool-villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 4,
		bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 15, status: 'active'
	}));
	const admin = t.withIdentity({ email: adminEmail, tokenIdentifier: 'admin' });
	const stranger = t.withIdentity({ email: 'stranger@example.com', tokenIdentifier: 'stranger' });
	const get = (bookingId: Id<'bookings'>) => t.run((ctx) => ctx.db.get(bookingId)).then((b) => b!);
	const rev = async (bookingId: Id<'bookings'>) => (await get(bookingId)).revision ?? 0;
	const create = (from: number, to: number, extra: Record<string, unknown> = {}) => admin.mutation(api.adminBookings.createBooking, {
		propertySlug: 'pool-villa', guestName: 'Mia', guestPhone: '+66 81 111 2222', guestEmail: 'mia@example.com',
		checkIn: isoInDays(from), checkOut: isoInDays(to), guests: 2, ...extra
	});
	const financials = (bookingId: Id<'bookings'>) => admin.query(api.adminBookings.bookingFinancials, { bookingId }).then((f) => f!);
	const history = (bookingId: Id<'bookings'>) => admin.query(api.adminBookings.bookingHistory, { bookingId, paginationOpts: page }).then((p) => p.page);
	const pay = async (bookingId: Id<'bookings'>, extra: Record<string, unknown> = {}) => {
		const money = (await financials(bookingId)).money;
		return admin.mutation(api.adminBookings.recordPayment, {
			bookingId, expectedRevision: await rev(bookingId), expectedAmount: money.owed, method: 'cash', idempotencyKey: key('pay'), ...extra
		});
	};
	const refund = async (bookingId: Id<'bookings'>, amount: number, extra: Record<string, unknown> = {}) =>
		admin.mutation(api.adminBookings.recordRefund, {
			bookingId, expectedRevision: await rev(bookingId), amount, currency: 'THB', method: 'transfer', reason: 'Left early', idempotencyKey: key('refund'), ...extra
		});
	const edit = async (bookingId: Id<'bookings'>, changes: Record<string, unknown> = {}) => {
		const b = await get(bookingId);
		return admin.mutation(api.adminBookings.editBooking, {
			bookingId, propertyId: b.propertyId, checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests, guestName: b.guestName,
			guestPhone: b.guestPhone, guestEmail: b.guestEmail, expectedRevision: b.revision ?? 0, ...changes
		});
	};
	const order = (orderId: Id<'bills'>) => admin.query(api.pos.getOrder, { orderId }).then((view) => view!);
	const settle = async (orderId: Id<'bills'>, tenders: Array<{ method: 'cash' | 'card' | 'promptpay' | 'transfer'; amount: number }>, extra: Record<string, unknown> = {}) => {
		const view = await order(orderId);
		return admin.mutation(api.pos.settleOrder, {
			orderId, idempotencyKey: key('settle'), expectedDue: view.totals.due, expectedRevision: view.order.revision, tenders, ...extra
		});
	};
	const scheduled = () => t.run(async (ctx) => (await ctx.db.system.query('_scheduled_functions').collect()).map((job) => job.name));
	return { t, admin, stranger, propertyId, get, rev, create, financials, history, pay, refund, edit, order, settle, scheduled };
}

afterEach(() => vi.unstubAllEnvs());

describe('refund records', () => {
	it('atomically cancels and refunds only the selected older deposit beside an itemised payment', async () => {
		const { t, admin, create, pay, rev, financials, get } = await setup();
		const bookingId = await create(5, 6, { confirmed: true });
		await t.run(ctx => ctx.db.patch(bookingId, { amountPaid: 200 }));
		await pay(bookingId);
		const before = await get(bookingId);
		const args = { bookingId, expectedRevision: await rev(bookingId), notifyGuest: false, refund: { amount: 201, currency: 'THB', method: 'cash' as const, reason: 'Returned older deposit', unitemised: true, idempotencyKey: 'cancel-older-deposit' } };
		await expect(admin.mutation(api.adminBookings.cancelStay, args)).rejects.toThrow('At most 200');
		expect(await get(bookingId)).toEqual(before);
		await admin.mutation(api.adminBookings.cancelStay, { ...args, refund: { ...args.refund, amount: 200 } });
		const after = await financials(bookingId);
		expect((await get(bookingId)).status).toBe('cancelled');
		expect(after.unitemisedRefundable).toBe(0);
		expect(after.payments[0].refunded).toBe(0);
		expect(after.refunds).toMatchObject([{ amount: 200 }]);
		expect(after.refunds[0].paymentId).toBeUndefined();
	});
	it('cancels a multiple-payment stay with a selected linked refund and replays the exact atomic request', async () => {
		const { t, admin, create, pay, edit, rev, financials, get, history } = await setup();
		const bookingId = await create(5, 6, { confirmed: true });
		await pay(bookingId);
		await edit(bookingId, { checkOut: isoInDays(7) });
		await pay(bookingId);
		const before = await get(bookingId);
		await expect(admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'cancel', refundRecorded: true })).rejects.toThrow('Cancel keeping the payment');
		expect(await get(bookingId)).toEqual(before);
		const selected = (await financials(bookingId)).payments[1];
		const args = { bookingId, expectedRevision: await rev(bookingId), notifyGuest: false, reason: 'Guest cancelled', refund: { amount: 1000, currency: 'THB', method: 'cash' as const, reason: 'Money returned', paymentId: selected._id, effectiveAt: Date.now(), idempotencyKey: 'cancel-multi-source-1' } };
		await admin.mutation(api.adminBookings.cancelStay, args);
		const stored = await get(bookingId);
		const events = await history(bookingId);
		await expect(admin.mutation(api.adminBookings.cancelStay, args)).resolves.toEqual({ replayed: true });
		expect(await get(bookingId)).toEqual(stored);
		expect(await history(bookingId)).toEqual(events);
		expect(stored.status).toBe('cancelled');
		expect((await financials(bookingId)).refunds).toMatchObject([{ paymentId: selected._id, amount: 1000 }]);
		expect((await financials(bookingId)).payments.find(p => p._id === selected._id)?.refunded).toBe(1000);
		expect(await t.run(ctx => ctx.db.query('bookingRefunds').collect())).toHaveLength(1);
	});
	it('links an omitted sole POS refund source to its payment and receipt', async () => {
		const { admin, create, rev, financials, refund, order, settle } = await setup();
		const bookingId = await create(5, 6, { confirmed: true });
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await settle(orderId, [{ method: 'cash', amount: (await order(orderId)).totals.due }]);
		await admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId), notifyGuest: false });
		const before = await financials(bookingId);
		await refund(bookingId, 500);
		expect((await financials(bookingId)).payments[0].refunded).toBe(500);
		expect((await order(orderId)).refunds).toMatchObject([{ amount: 500, sourceType: 'booking' }]);
		expect((await financials(bookingId)).refunds[0]).toMatchObject({ paymentId: before.payments[0]._id, order: { _id: orderId } });
	});

	it('requires an explicit source for multiple payments and bounds older unitemised money separately', async () => {
		const { t, admin, create, pay, edit, rev, financials, refund, get } = await setup();
		const bookingId = await create(5, 6, { confirmed: true });
		await pay(bookingId);
		await edit(bookingId, { checkOut: isoInDays(7) });
		await pay(bookingId);
		await admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId), notifyGuest: false });
		await expect(refund(bookingId, 500)).rejects.toThrow('Select the payment or receipt');
		expect((await financials(bookingId)).refunds).toHaveLength(0);
		const b = await get(bookingId);
		await t.run(ctx => ctx.db.patch(bookingId, { amountPaid: b.amountPaid! + 200 }));
		expect((await financials(bookingId)).unitemisedRefundable).toBe(200);
		await expect(refund(bookingId, 201, { unitemised: true })).rejects.toThrow('At most 200');
		await refund(bookingId, 200, { unitemised: true });
		expect((await financials(bookingId)).payments.every(p => p.refunded === 0)).toBe(true);
		expect((await financials(bookingId)).unitemisedRefundable).toBe(0);
	});

	it('freezes every refund audit field and actor across a committed retry', async () => {
		const { t, admin, create, pay, rev, financials } = await setup();
		const bookingId = await create(5, 6, { confirmed: true });
		await pay(bookingId);
		await admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId), notifyGuest: false });
		const paymentId = (await financials(bookingId)).payments[0]._id;
		const args = { bookingId, expectedRevision: await rev(bookingId), amount: 100, currency: 'THB', method: 'cash' as const, reason: 'Returned cash', effectiveAt: Date.now() - DAY, idempotencyKey: 'refund-all-fields', paymentId };
		const result = await admin.mutation(api.adminBookings.recordRefund, args);
		await expect(admin.mutation(api.adminBookings.recordRefund, args)).resolves.toEqual({ ...result, replayed: true });
		for (const changes of [{ reason: 'Other reason' }, { effectiveAt: args.effectiveAt + 1 }, { paymentId: undefined }, { currency: 'USD' }, { unitemised: true }, { method: 'transfer' as const }]) {
			await expect(admin.mutation(api.adminBookings.recordRefund, { ...args, ...changes })).rejects.toThrow('different refund');
		}
		vi.stubEnv('ADMIN_EMAILS', `${adminEmail},desk@example.com`);
		await expect(t.withIdentity({ email: 'desk@example.com', tokenIdentifier: 'desk' }).mutation(api.adminBookings.recordRefund, args)).rejects.toThrow('different refund');
		expect((await financials(bookingId)).refunds).toHaveLength(1);
	});

	it('allows editing a live fully refunded stay without inventing cancellation', async () => {
		const { t, create, edit, get } = await setup();
		const bookingId = await create(5, 6, { confirmed: true });
		await t.run(ctx => ctx.db.patch(bookingId, { paymentStatus: 'refunded', amountPaid: 8500, amountRefunded: 8500, providerRefundWaived: 8500 }));
		await edit(bookingId, { guestName: 'Corrected guest' });
		expect(await get(bookingId)).toMatchObject({ status: 'confirmed', guestName: 'Corrected guest', amountRefunded: 8500 });
	});
	it('records a partial refund of the credit after a completed paid stay is shortened, without reopening a balance', async () => {
		const { admin, get, create, financials, history, pay, refund, edit, order, settle } = await setup();
		const bookingId = await create(-10, -7, { confirmed: true });
		await pay(bookingId, { method: 'card', effectiveAt: Date.now() - 10 * DAY });
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 25500, total: 25500 });

		// Nothing exceeds the price yet, so a live stay can't refund.
		await expect(refund(bookingId, 1000)).rejects.toThrow('correct its price or cancel it first');

		// The guest left after two nights: the stay costs 17,000, 8,500 is owed back.
		await edit(bookingId, { checkOut: isoInDays(-8) });
		expect((await financials(bookingId)).money).toMatchObject({ total: 17000, net: 25500, owed: 0, credit: 8500, refundable: 8500, refundContext: 'credit' });

		const paymentId = (await financials(bookingId)).payments[0]._id;
		await expect(refund(bookingId, 8500.01, { paymentId })).rejects.toThrow('Only the credit of 8500');
		const { refundId } = await refund(bookingId, 8500, { paymentId, method: 'card', effectiveAt: Date.now() - 7 * DAY });
		const after = await financials(bookingId);
		expect(after.money).toMatchObject({ total: 17000, gross: 25500, refunded: 8500, net: 17000, owed: 0, credit: 0, refundable: 0 });
		expect(after.refunds).toMatchObject([{ _id: refundId, amount: 8500, method: 'card', reason: 'Left early', context: 'credit', paymentId }]);
		expect(after.payments[0]).toMatchObject({ refunded: 8500, refundable: 17000 });
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 25500, amountRefunded: 8500 });

		// The stay is settled: no balance, nothing to charge at checkout, and the booking sheet shows the refund.
		const orders = await admin.query(api.pos.ordersForBooking, { bookingId });
		expect(orders).toMatchObject({ balance: { total: 17000, paid: 17000, owed: 0, refunded: 8500, credit: 0 }, refunds: [{ amount: 8500, method: 'card' }] });
		await expect(admin.mutation(api.pos.attach, { bookingId })).rejects.toThrow('nothing left to pay');
		expect((await admin.query(api.adminBookings.getForAdmin, { bookingId }))?.amountPaid).toBe(17000);
		expect((await history(bookingId)).map((row) => row.kind)).toEqual(['refund_recorded', 'edited', 'payment_recorded', 'confirmed', 'created']);

		// Re-extended after the refund: checkout charges only the new balance, against the net paid.
		await edit(bookingId, { checkOut: isoInDays(-7) });
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		expect((await order(orderId)).totals).toMatchObject({ total: 25500, deposit: 17000, due: 8500 });
		// The open order owns the balance: a desk payment on the booking would collect it twice.
		await expect(pay(bookingId)).rejects.toThrow('still open');
		await settle(orderId, [{ method: 'cash', amount: 8500 }]);
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 34000, amountRefunded: 8500, total: 25500 });
		expect((await financials(bookingId)).money).toMatchObject({ gross: 34000, refunded: 8500, net: 25500, owed: 0, credit: 0 });
	});

	it('separates cancellation from refunds, refuses duplicates, overrefunds and invalid amounts, and closes a fully refunded stay', async () => {
		const { t, admin, get, rev, create, financials, pay, refund } = await setup();
		const bookingId = await create(20, 23);
		await pay(bookingId);
		// Cancelling keeps the money.
		await admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId), reason: 'Guest cancelled', notifyGuest: false });
		expect(await get(bookingId)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid', amountPaid: 25500, cancelReason: 'Guest cancelled', cancelledBy: adminEmail });
		expect((await financials(bookingId)).money).toMatchObject({ net: 25500, refundable: 25500, refundContext: 'cancellation' });

		for (const [amount, message] of [[Number.NaN, 'more than zero'], [0, 'more than zero'], [-5, 'more than zero'], [Number.POSITIVE_INFINITY, 'more than zero'], [10.005, 'whole satang'], [25500.01, 'At most 25500']] as const) {
			await expect(refund(bookingId, amount)).rejects.toThrow(message);
		}
		await expect(refund(bookingId, 100, { currency: 'USD' })).rejects.toThrow('refund it in THB');
		await expect(refund(bookingId, 100, { reason: '  ' })).rejects.toThrow('Refund reason is required');
		await expect(refund(bookingId, 100, { effectiveAt: Date.now() + DAY })).rejects.toThrow('future');
		await expect(refund(bookingId, 100, { expectedRevision: 0 })).rejects.toThrow('changed since you opened it');

		// A payment of another booking can't be referenced.
		const other = await create(30, 31);
		await pay(other);
		const foreign = (await financials(other)).payments[0]._id;
		await expect(refund(bookingId, 100, { paymentId: foreign })).rejects.toThrow('another booking');

		// A retried refund (same key) is recorded once; reusing the key for a different refund is refused.
		const attempt = { idempotencyKey: 'refund-retry-0001' };
		const first = await refund(bookingId, 5000, attempt);
		const retry = await admin.mutation(api.adminBookings.recordRefund, { bookingId, expectedRevision: 0, amount: 5000, currency: 'THB', method: 'transfer', reason: 'Left early', ...attempt });
		expect(retry).toEqual({ refundId: first.refundId, replayed: true });
		await expect(refund(bookingId, 4000, attempt)).rejects.toThrow('already used for a different refund');
		expect(await t.run((ctx) => ctx.db.query('bookingRefunds').collect())).toHaveLength(1);

		await expect(refund(bookingId, 20500.01)).rejects.toThrow('At most 20500');
		await refund(bookingId, 20500);
		expect(await get(bookingId)).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded', amountRefunded: 25500 });
		expect((await financials(bookingId)).money).toMatchObject({ net: 0, refunded: 25500, refundable: 0 });
		await expect(refund(bookingId, 1)).rejects.toThrow('Nothing is left to refund');
		// Not payable again by any path.
		await expect(admin.mutation(api.pos.openOrderFor, { bookingId })).rejects.toThrow('cancelled');
		await expect(admin.mutation(api.pos.attach, { bookingId })).rejects.toThrow('nothing left to pay');
		await expect(pay(bookingId)).rejects.toThrow('cancelled');
		expect((await admin.query(api.pos.ordersForBooking, { bookingId }))?.balance).toMatchObject({ paid: 0, owed: 0, refunded: 25500 });
	});

	it('cancels and refunds part of a paid stay in one transaction, and rolls both back when the refund is invalid', async () => {
		const { admin, get, rev, create, financials, pay } = await setup();
		const bookingId = await create(20, 23);
		await pay(bookingId);
		const refundArgs = { amount: 99999, currency: 'THB', method: 'cash' as const, reason: 'Cancellation fee kept', idempotencyKey: key() };
		await expect(admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId), refund: refundArgs })).rejects.toThrow('At most');
		expect(await get(bookingId)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
		const cancelArgs = { bookingId, expectedRevision: await rev(bookingId), refund: { ...refundArgs, amount: 20000 } };
		await admin.mutation(api.adminBookings.cancelStay, cancelArgs);
		await expect(admin.mutation(api.adminBookings.cancelStay, cancelArgs)).resolves.toEqual({ replayed: true });
		await expect(admin.mutation(api.adminBookings.cancelStay, { ...cancelArgs, reason: 'Different cancellation' })).rejects.toThrow('different refund');
		expect(await get(bookingId)).toMatchObject({ status: 'cancelled', paymentStatus: 'paid', amountRefunded: 20000 });
		expect((await financials(bookingId)).money).toMatchObject({ net: 5500, refundable: 5500 });
	});
});

describe('payment entries and their corrections', () => {
	it('records a desk payment with its business date, amends the method and date, and cancels it as a mistake', async () => {
		const { admin, get, rev, create, financials, history, pay } = await setup();
		const bookingId = await create(5, 7);
		const lastWeek = Date.now() - 7 * DAY;
		await expect(pay(bookingId, { expectedAmount: 100 })).rejects.toThrow('now owes 17000');
		await expect(pay(bookingId, { effectiveAt: Date.now() + DAY })).rejects.toThrow('future');
		const attempt = key('pay');
		const { paymentId } = await pay(bookingId, { idempotencyKey: attempt, effectiveAt: lastWeek, note: 'Front desk' });
		expect(await pay(bookingId, { idempotencyKey: attempt })).toEqual({ paymentId, replayed: true });
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', status: 'confirmed', paidAt: lastWeek, amountPaid: 17000, paymentMethod: 'admin' });
		expect((await financials(bookingId)).payments).toMatchObject([{ _id: paymentId, origin: 'manual', method: 'cash', amount: 17000, effectiveAt: lastWeek, note: 'Front desk', amendBlocker: null, cancelBlocker: null }]);

		// Wrong method and date: fixed in place, no cancellation, no money moved.
		const yesterday = Date.now() - DAY;
		await expect(admin.mutation(api.adminBookings.amendPayment, { bookingId, paymentId, expectedRevision: await rev(bookingId), method: 'transfer', reason: ' ' })).rejects.toThrow('required');
		await admin.mutation(api.adminBookings.amendPayment, { bookingId, paymentId, expectedRevision: await rev(bookingId), method: 'transfer', effectiveAt: yesterday, reason: 'Was a bank transfer' });
		expect((await financials(bookingId)).payments[0]).toMatchObject({ method: 'transfer', effectiveAt: yesterday, amendedBy: adminEmail, status: 'recorded' });
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', paidAt: yesterday, amountPaid: 17000 });

		// Recorded on the wrong booking: no money was received here, so the entry is cancelled and the stay is unpaid again.
		await admin.mutation(api.adminBookings.cancelPayment, { bookingId, paymentId, expectedRevision: await rev(bookingId), reason: 'Entered on the wrong booking' });
		const reverted = await get(bookingId);
		expect(reverted).toMatchObject({ paymentStatus: 'pending', status: 'confirmed' });
		expect(reverted.amountPaid).toBeUndefined();
		expect(reverted.paidAt).toBeUndefined();
		expect((await financials(bookingId)).payments[0]).toMatchObject({ status: 'cancelled', cancelReason: 'Entered on the wrong booking', refundable: 0 });
		expect((await financials(bookingId)).money).toMatchObject({ owed: 17000, net: 0 });
		expect((await history(bookingId)).slice(0, 3).map((row) => row.kind)).toEqual(['payment_cancelled', 'payment_amended', 'payment_recorded']);
		// The stay can be paid correctly again.
		await pay(bookingId, { method: 'card' });
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 17000 });
	});

	it('refuses to cancel a manual entry that was partly refunded', async () => {
		const { admin, rev, create, financials, pay, refund } = await setup();
		const bookingId = await create(5, 7);
		const { paymentId } = await pay(bookingId);
		await admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId) });
		await refund(bookingId, 1000, { paymentId });
		await expect(admin.mutation(api.adminBookings.cancelPayment, { bookingId, paymentId, expectedRevision: await rev(bookingId), reason: 'Mistake' })).rejects.toThrow('refunded, so it was real money');
		expect((await financials(bookingId)).payments[0].cancelBlocker).toContain('refunded');
	});

	it('keeps online (Stripe) money intact through an extension paid at checkout, a void and a mistaken-settlement reversal', async () => {
		const { t, admin, get, rev, financials, edit, order, settle, history } = await setup();
		const { bookingId, accessToken } = await t.mutation(api.bookings.create, {
			propertySlug: 'pool-villa', guestName: 'Ola', guestEmail: 'ola@example.com', guestPhone: '+66 82 222 3333', checkIn: isoInDays(20), checkOut: isoInDays(23), guests: 2
		});
		const { request } = await t.mutation(internal.payments.beginCheckout, { bookingId, accessToken, siteUrl: 'https://example.com' });
		await t.mutation(internal.payments.saveCheckoutSession, {
			bookingId, accessToken, sessionId: 'cs_1', url: 'https://checkout.stripe.com/x', expiresAt: Date.now() + 60_000,
			attempt: request!.attempt, total: request!.total, currency: request!.currency, checkIn: request!.checkIn, checkOut: request!.checkOut
		});
		await t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: 'cs_1', amountTotal: 2550000, currency: 'thb', paymentIntentId: 'pi_1' });
		await t.run((ctx) => ctx.db.patch(bookingId, { stripeCheckoutExpiresAt: Date.now() - 1 }));
		const online = (await financials(bookingId)).payments[0];
		expect(online).toMatchObject({ origin: 'online', method: 'stripe', amount: 25500, recordedBy: 'system:stripe' });

		// Online money can't be amended or undone as a "mistake".
		await expect(admin.mutation(api.adminBookings.cancelPayment, { bookingId, paymentId: online._id, expectedRevision: await rev(bookingId), reason: 'x' })).rejects.toThrow('provider');
		await expect(admin.mutation(api.adminBookings.amendPayment, { bookingId, paymentId: online._id, expectedRevision: await rev(bookingId), method: 'cash', reason: 'x' })).rejects.toThrow('provider');

		// Extend by a night and collect the balance at the desk, dated yesterday.
		await edit(bookingId, { checkOut: isoInDays(24), notifyGuest: false });
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		expect((await order(orderId)).totals).toMatchObject({ total: 34000, deposit: 25500, due: 8500 });
		const yesterday = Date.now() - DAY;
		await settle(orderId, [{ method: 'card', amount: 8500 }], { effectiveAt: yesterday });
		const paid = await order(orderId);
		expect(paid.order.paidAt).toBeGreaterThan(yesterday + DAY - 60_000);
		expect(paid.paymentRecord.effectiveAt).toBe(yesterday);
		expect(paid.payments[0].effectiveAt).toBe(yesterday);
		const pos = (await financials(bookingId)).payments.find((p) => p.origin === 'pos')!;
		expect(pos).toMatchObject({ amount: 8500, method: 'order', effectiveAt: yesterday, order: { _id: orderId } });
		expect(await get(bookingId)).toMatchObject({ amountPaid: 34000, paymentMethod: 'stripe', stripePaymentIntentId: 'pi_1' });
		await expect(admin.mutation(api.adminBookings.amendPayment, { bookingId, paymentId: pos._id, expectedRevision: await rev(bookingId), method: 'cash', reason: 'x' })).rejects.toThrow('receipt');

		// The card was never actually charged: reverse only what this order took; the Stripe deposit stays.
		await expect(admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 1, idempotencyKey: key(), reason: 'x' })).rejects.toThrow('corrected since');
		const voidKey = key('void');
		await admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: voidKey, reason: 'Card machine declined; nothing received' });
		expect(await admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: voidKey, reason: 'again' })).toEqual({ replayed: true });
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 25500, total: 34000 });
		const after = await financials(bookingId);
		expect(after.money).toMatchObject({ net: 25500, owed: 8500 });
		expect(after.payments.find((p) => p.origin === 'online')).toMatchObject({ status: 'recorded', amount: 25500 });
		expect(after.payments.find((p) => p.origin === 'pos')).toMatchObject({ status: 'cancelled' });
		const voided = await order(orderId);
		expect(voided.order).toMatchObject({ status: 'void', receiptNumber: 1, voidUnreceived: true });
		expect(voided.payments).toHaveLength(1);
		expect(voided.corrections).toMatchObject([{ kind: 'void_unreceived', sequence: 1 }]);
		// The balance can be charged again on a new order.
		const again = await admin.mutation(api.pos.openOrderFor, { bookingId });
		expect(again.orderId).not.toBe(orderId);
		expect((await order(again.orderId)).totals.due).toBe(8500);
		expect((await history(bookingId)).map((row) => row.kind)).toContain('payment_cancelled');
	});

	it('voiding a paid order alone keeps the stay paid and its payment record, and logs it on the booking', async () => {
		const { admin, get, create, financials, history, order, settle } = await setup();
		const bookingId = await create(20, 22);
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await settle(orderId, [{ method: 'card', amount: 17000 }]);
		await admin.mutation(api.pos.voidOrder, { orderId, reason: 'Wrong card' });
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 17000 });
		expect((await financials(bookingId)).payments).toMatchObject([{ origin: 'pos', status: 'recorded', amount: 17000 }]);
		expect((await order(orderId)).order).toMatchObject({ status: 'void', voidReason: 'Wrong card' });
		expect((await order(orderId)).order.voidUnreceived).toBeUndefined();
		expect((await history(bookingId))[0]).toMatchObject({ kind: 'order_voided', reason: 'Wrong card', after: { billId: orderId, paymentKept: true } });
	});

	it('amends a wrong tender, date and payer on a paid receipt while keeping the issued receipt and payments', async () => {
		const { t, admin, order, settle, financials, create } = await setup();
		const bookingId = await create(20, 22);
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		const ann = await admin.mutation(api.customers.createCustomer, { name: 'Ann' });
		const bob = await admin.mutation(api.customers.createCustomer, { name: 'Bob', phone: '0812345678' });
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId: ann });
		await settle(orderId, [{ method: 'card', amount: 17000 }], { expectedCustomerRevision: 0 });
		const issued = await order(orderId);
		const base = { orderId, reason: 'Guest paid cash' };

		await expect(admin.mutation(api.pos.amendOrderPayment, { ...base, expectedCorrectionRevision: 0, idempotencyKey: key(), tenders: [{ method: 'cash', amount: 16000 }] })).rejects.toThrow('add up to 16000');
		await expect(admin.mutation(api.pos.amendOrderPayment, { ...base, expectedCorrectionRevision: 0, idempotencyKey: key(), tenders: [{ method: 'card', amount: 17000 }] })).rejects.toThrow('Nothing changed');
		const attempt = key('amend');
		await admin.mutation(api.pos.amendOrderPayment, { ...base, expectedCorrectionRevision: 0, idempotencyKey: attempt, tenders: [{ method: 'cash', amount: 10000 }, { method: 'promptpay', amount: 7000 }] });
		expect(await admin.mutation(api.pos.amendOrderPayment, { ...base, expectedCorrectionRevision: 0, idempotencyKey: attempt, tenders: [{ method: 'cash', amount: 17000 }] })).toEqual({ sequence: 1, replayed: true });
		await expect(admin.mutation(api.pos.amendOrderPayment, { ...base, expectedCorrectionRevision: 0, idempotencyKey: key(), tenders: [{ method: 'cash', amount: 17000 }] })).rejects.toThrow('corrected since');

		const twoDaysAgo = Date.now() - 2 * DAY;
		await t.run((ctx) => ctx.db.patch(bob, { mergedInto: ann }));
		await expect(admin.mutation(api.pos.amendOrderPayment, { orderId, reason: 'Paid by Bob', expectedCorrectionRevision: 1, idempotencyKey: key(), customer: { customerId: bob, expectedCustomerRevision: 0 } })).rejects.toThrow('merged');
		await t.run((ctx) => ctx.db.patch(bob, { mergedInto: undefined }));
		await admin.mutation(api.pos.amendOrderPayment, { orderId, reason: 'Paid by Bob, two days ago', expectedCorrectionRevision: 1, idempotencyKey: key(), effectiveAt: twoDaysAgo, customer: { customerId: bob, expectedCustomerRevision: 0 } });

		const view = await order(orderId);
		expect(view.order).toMatchObject({ status: 'paid', receiptNumber: issued.order.receiptNumber, customerSnapshot: { name: 'Ann' }, customerId: bob, correctionRevision: 2 });
		expect(view.payments).toEqual(issued.payments);
		expect(view.paymentRecord).toMatchObject({
			tenders: [{ method: 'cash', amount: 10000 }, { method: 'promptpay', amount: 7000 }], tendersAmended: true,
			customer: { name: 'Bob', phone: '0812345678' }, customerAmended: true, effectiveAt: twoDaysAgo, correctionRevision: 2
		});
		expect(view.corrections.map((c) => c.sequence)).toEqual([2, 1]);
		expect(view.corrections[1]).toMatchObject({ tendersBefore: [{ method: 'card', amount: 17000 }], tendersAfter: [{ method: 'cash', amount: 10000 }, { method: 'promptpay', amount: 7000 }] });
		// The stay's payment record follows the corrected business date.
		expect((await financials(bookingId)).payments[0]).toMatchObject({ origin: 'pos', effectiveAt: twoDaysAgo });
		// Unpaid orders can't be amended.
		const { orderId: open } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 50 } });
		await expect(admin.mutation(api.pos.amendOrderPayment, { orderId: open, reason: 'x', expectedCorrectionRevision: 0, idempotencyKey: key(), effectiveAt: twoDaysAgo })).rejects.toThrow('Only a paid order');
	});

	it('refuses to reverse a legacy order paid before stay payments were itemised, but still allows a capped refund by reference', async () => {
		const { t, admin, get, rev, create, financials, order, settle, refund } = await setup();
		const bookingId = await create(20, 22);
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await settle(orderId, [{ method: 'cash', amount: 17000 }]);
		// Simulate an order paid before this release: no itemised stay payment.
		await t.run(async (ctx) => {
			for (const row of await ctx.db.query('bookingPayments').collect()) await ctx.db.delete(row._id);
		});
		expect((await financials(bookingId)).unitemised).toBe(17000);
		expect((await financials(bookingId)).legacyOrders).toMatchObject([{ _id: orderId, charged: 17000, refundable: 17000 }]);
		await expect(admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: key(), reason: 'No money' })).rejects.toThrow("can't prove");
		expect((await order(orderId)).order.status).toBe('paid');
		// Tenders can still be corrected.
		await admin.mutation(api.pos.amendOrderPayment, { orderId, reason: 'Was card', expectedCorrectionRevision: 0, idempotencyKey: key(), tenders: [{ method: 'card', amount: 17000 }] });
		// A refund referring to the order is capped by what that order took for the stay.
		await admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId) });
		await expect(refund(bookingId, 17000.5, { billId: orderId })).rejects.toThrow('At most');
		await refund(bookingId, 7000, { billId: orderId });
		await expect(refund(bookingId, 10000.01, { billId: orderId })).rejects.toThrow('At most');
		expect(await get(bookingId)).toMatchObject({ amountRefunded: 7000 });
		expect((await order(orderId)).refunds).toMatchObject([{ amount: 7000, bookingId }]);
	});

	it('itemises the legacy "Mark paid" API so it is corrected as an entry, not by the legacy path', async () => {
		const { admin, get, rev, create, financials } = await setup();
		const bookingId = await create(20, 22);
		await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'markPaid' });
		const fin = await financials(bookingId);
		expect(fin.payments).toMatchObject([{ origin: 'manual', method: 'unrecorded', amount: 17000, cancelBlocker: null }]);
		expect(fin.legacyManual).toMatchObject({ cancellable: false });
		await expect(admin.mutation(api.adminBookings.cancelPayment, { bookingId, legacy: true, expectedRevision: await rev(bookingId), reason: 'Mistake' })).rejects.toThrow('itemised');
		await expect(admin.mutation(api.adminBookings.cancelPayment, { bookingId, expectedRevision: await rev(bookingId), reason: 'Mistake' })).rejects.toThrow('Choose one');
		await admin.mutation(api.adminBookings.cancelPayment, { bookingId, paymentId: fin.payments[0]._id, expectedRevision: await rev(bookingId), reason: 'Mistake' });
		expect((await get(bookingId)).paymentStatus).toBe('pending');
	});
});

describe('legacy documents', () => {
	it('counts a legacy refunded stay as fully refunded without inventing records, and reopens it unpaid', async () => {
		const { t, admin, get, rev, financials, pay, history } = await setup();
		const propertyId = (await t.run((ctx) => ctx.db.query('properties').first()))!._id;
		const bookingId = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Old', guestPhone: '0811111111', checkIn: isoInDays(20), checkOut: isoInDays(22), guests: 2, nights: 2,
			subtotal: 20000, discountAmount: 3000, total: 17000, currency: 'THB', amountPaid: 17000, paymentStatus: 'refunded', status: 'cancelled',
			paymentMethod: 'admin', refundedAt: Date.now() - DAY, source: 'admin', createdAt: Date.now() - 30 * DAY
		}));
		const before = await financials(bookingId);
		expect(before).toMatchObject({ revision: 0, payments: [], refunds: [], unitemised: 17000, money: { gross: 17000, refunded: 17000, net: 0, refundable: 0, legacyRefund: true } });
		expect((await admin.query(api.pos.ordersForBooking, { bookingId }))?.balance).toMatchObject({ paid: 0, refunded: 17000, owed: 0 });
		await expect(admin.mutation(api.adminBookings.recordRefund, { bookingId, expectedRevision: 0, amount: 1, currency: 'THB', method: 'cash', reason: 'x', idempotencyKey: key() })).rejects.toThrow('before refund amounts were recorded');
		expect(await t.run((ctx) => ctx.db.query('bookingRefunds').collect())).toHaveLength(0);

		await expect(admin.mutation(api.adminBookings.reopenBooking, { bookingId, expectedRevision: 0, confirmed: false, reason: ' ' })).rejects.toThrow('Reason is required');
		await admin.mutation(api.adminBookings.reopenBooking, { bookingId, expectedRevision: 0, confirmed: false, reason: 'Guest is coming after all' });
		expect(await get(bookingId)).toMatchObject({ status: 'pending', paymentStatus: 'pending', amountPaid: 17000, amountRefunded: 17000, revision: 1 });
		expect((await financials(bookingId)).money).toMatchObject({ gross: 17000, refunded: 17000, net: 0, owed: 17000 });
		await pay(bookingId);
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 34000, amountRefunded: 17000 });
		expect((await financials(bookingId)).money).toMatchObject({ net: 17000, owed: 0 });
		expect((await history(bookingId)).map((row) => row.kind)).toEqual(['payment_recorded', 'reopened']);
		expect(await rev(bookingId)).toBe(2);
	});

	it('reads bookings without revision, history or payment entries', async () => {
		const { t, admin } = await setup();
		const propertyId = (await t.run((ctx) => ctx.db.query('properties').first()))!._id;
		const bookingId = await t.run((ctx) => ctx.db.insert('bookings', {
			propertyId, guestName: 'Legacy', guestPhone: '0811111111', checkIn: isoInDays(20), checkOut: isoInDays(22), guests: 2, nights: 2,
			subtotal: 20000, discountAmount: 3000, total: 17000, currency: 'THB', paymentStatus: 'paid', status: 'confirmed', paymentMethod: 'admin', createdAt: 1
		}));
		const detail = await admin.query(api.adminBookings.getForAdmin, { bookingId });
		expect(detail).toMatchObject({ revision: 0, amountPaid: 17000, priceOverride: null, money: { gross: 17000, net: 17000, owed: 0 } });
		const fin = await admin.query(api.adminBookings.bookingFinancials, { bookingId });
		expect(fin).toMatchObject({ unitemised: 17000, legacyManual: { cancellable: true, amount: 17000 } });
		expect((await admin.query(api.adminBookings.bookingHistory, { bookingId, paginationOpts: page })).page).toEqual([]);
		await admin.mutation(api.adminBookings.cancelPayment, { bookingId, legacy: true, expectedRevision: 0, reason: 'Marked paid by mistake' });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'pending', revision: 1 });
		const [row] = (await admin.query(api.adminBookings.bookingHistory, { bookingId, paginationOpts: page })).page;
		expect(row).toMatchObject({ kind: 'payment_cancelled', reason: 'Marked paid by mistake', before: { paymentStatus: 'paid' }, after: { paymentStatus: 'pending', legacy: true, amount: 17000 } });
	});
});

describe('custom stay price', () => {
	it('sets a reasoned price with revision checks, flags the open checkout row and settles the new price', async () => {
		const { admin, get, rev, create, edit, order, settle, history } = await setup();
		const bookingId = await create(20, 23);
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		const stale = await order(orderId);
		expect(stale.totals.due).toBe(25500);

		await expect(edit(bookingId, { priceOverride: { total: 20000, reason: ' ' } })).rejects.toThrow('Reason for the custom price is required');
		await expect(edit(bookingId, { priceOverride: { total: 20000.001, reason: 'Negotiated' } })).rejects.toThrow('whole satang');
		await expect(edit(bookingId, { priceOverride: { total: 20000, reason: 'Negotiated' }, expectedRevision: undefined })).rejects.toThrow('missing revision');
		await expect(edit(bookingId, { priceOverride: { total: 20000, reason: 'Negotiated' }, expectedRevision: 99 })).rejects.toThrow('changed since you opened it');
		await edit(bookingId, { priceOverride: { total: 20000, reason: 'Negotiated rate' } });
		expect(await get(bookingId)).toMatchObject({ total: 20000, subtotal: 30000, priceOverride: { total: 20000, quotedTotal: 25500, reason: 'Negotiated rate', by: adminEmail } });

		// The open row is stale until refreshed, then charges the custom price.
		const lineId = (await order(orderId)).lines[0]._id;
		expect((await order(orderId)).lines[0].sourceIssue?.kind).toBe('changed');
		await expect(admin.mutation(api.pos.settleOrder, { orderId, idempotencyKey: key(), expectedDue: 25500, expectedRevision: stale.order.revision, tenders: [{ method: 'cash', amount: 25500 }] })).rejects.toThrow();
		await admin.mutation(api.pos.updateSourceLine, { lineId });
		expect((await order(orderId)).totals.due).toBe(20000);
		await settle(orderId, [{ method: 'cash', amount: 20000 }]);
		expect(await get(bookingId)).toMatchObject({ paymentStatus: 'paid', amountPaid: 20000, total: 20000 });

		// A stay change must say what happens to the custom price.
		await expect(edit(bookingId, { checkOut: isoInDays(24) })).rejects.toThrow('custom price');
		await edit(bookingId, { checkOut: isoInDays(24), priceOverride: { total: 26000, reason: 'Extra night at the same rate' } });
		expect((await admin.query(api.pos.ordersForBooking, { bookingId }))?.balance).toMatchObject({ total: 26000, paid: 20000, owed: 6000 });
		await edit(bookingId, { priceOverride: null });
		expect(await get(bookingId)).toMatchObject({ total: 34000 });
		expect((await get(bookingId)).priceOverride).toBeUndefined();
		expect((await history(bookingId)).filter((row) => row.kind === 'edited').map((row) => row.reason)).toEqual(['Back to the villa rate', 'Extra night at the same rate', 'Negotiated rate']);
		expect(await rev(bookingId)).toBeGreaterThan(3);
	});
});

describe('guest notifications', () => {
	it('stays silent for historical corrections unless asked, and keeps public booking emails', async () => {
		const { t, admin, get, rev, create, edit, scheduled } = await setup();
		const past = await create(-10, -7, { confirmed: true });
		expect((await get(past)).confirmationEmailsQueuedAt).toBeUndefined();
		await edit(past, { checkOut: isoInDays(-8) });
		await admin.mutation(api.adminBookings.cancelStay, { bookingId: past, expectedRevision: await rev(past) });
		expect((await get(past)).cancellationEmailQueuedAt).toBeUndefined();
		expect(await scheduled()).toEqual([]);
		// Lifecycle emails skip it too.
		await t.run((ctx) => ctx.db.patch(past, { status: 'confirmed', reviewEmailQueuedAt: Date.now() }));
		expect(await t.query(internal.bookings.getLifecycleEmailDetails, { bookingId: past, kind: 'review' })).toBeNull();

		// Explicitly notifying a historical correction does email.
		const past2 = await create(-20, -17, { confirmed: true, notifyGuest: true });
		expect((await get(past2)).confirmationEmailsQueuedAt).toEqual(expect.any(Number));
		await edit(past2, { checkOut: isoInDays(-18), notifyGuest: true });
		expect((await scheduled()).filter((name) => name.includes('sendBookingUpdated'))).toHaveLength(1);

		// Future stays notify by default; a toggle turns it off.
		const future = await create(20, 22, { confirmed: true });
		expect((await get(future)).confirmationEmailsQueuedAt).toEqual(expect.any(Number));
		await admin.mutation(api.adminBookings.cancelStay, { bookingId: future, expectedRevision: await rev(future), notifyGuest: false });
		expect((await get(future)).cancellationEmailQueuedAt).toBeUndefined();

		// Public bookings: unchanged confirmation on online payment.
		const { bookingId } = await t.mutation(api.bookings.create, {
			propertySlug: 'pool-villa', guestName: 'Web', guestEmail: 'web@example.com', guestPhone: '+66 83 333 4444', checkIn: isoInDays(40), checkOut: isoInDays(42), guests: 2
		});
		await t.run((ctx) => ctx.db.patch(bookingId, { stripeCheckoutSessionId: 'cs_web' }));
		await t.mutation(internal.payments.completeCheckout, { bookingId, sessionId: 'cs_web', amountTotal: 1700000, currency: 'thb', paymentIntentId: 'pi_web' });
		expect((await get(bookingId)).confirmationEmailsQueuedAt).toEqual(expect.any(Number));
		expect((await scheduled()).filter((name) => name.includes('sendBookingConfirmation')).length).toBeGreaterThanOrEqual(3);
	});
});

describe('reopen', () => {
	it('reopens cancelled and expired stays, rechecking the nights and the online checkout', async () => {
		const { t, admin, get, rev, create, pay } = await setup();
		const kept = await create(20, 23);
		await pay(kept, { notifyGuest: false });
		await admin.mutation(api.adminBookings.cancelStay, { bookingId: kept, expectedRevision: await rev(kept), notifyGuest: false });
		const rival = await create(21, 22, { confirmed: true, notifyGuest: false });
		await expect(admin.mutation(api.adminBookings.reopenBooking, { bookingId: kept, expectedRevision: await rev(kept), confirmed: true, reason: 'Back' })).rejects.toThrow('no longer available');
		await admin.mutation(api.adminBookings.cancelStay, { bookingId: rival, expectedRevision: await rev(rival), notifyGuest: false });
		// Money kept means it comes back paid and confirmed, whatever was asked.
		await admin.mutation(api.adminBookings.reopenBooking, { bookingId: kept, expectedRevision: await rev(kept), confirmed: false, reason: 'Guest is coming after all', notifyGuest: false });
		expect(await get(kept)).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 25500 });
		expect((await get(kept)).cancelledAt).toBeUndefined();
		await expect(admin.mutation(api.adminBookings.reopenBooking, { bookingId: kept, expectedRevision: await rev(kept), confirmed: true, reason: 'Again' })).rejects.toThrow('Only cancelled');

		// An expired web booking: pending would expire again, so it reopens confirmed; a live checkout refuses.
		const { bookingId: web } = await t.mutation(api.bookings.create, {
			propertySlug: 'pool-villa', guestName: 'Web', guestEmail: 'web@example.com', guestPhone: '+66 83 333 4444', checkIn: isoInDays(40), checkOut: isoInDays(42), guests: 2
		});
		await t.run((ctx) => ctx.db.patch(web, { status: 'cancelled', paymentStatus: 'failed', stripeCheckoutSessionId: 'cs_old', stripeCheckoutExpiresAt: Date.now() + 60_000 }));
		await expect(admin.mutation(api.adminBookings.reopenBooking, { bookingId: web, expectedRevision: await rev(web), confirmed: true, reason: 'Paying at desk' })).rejects.toThrow('Stripe checkout open');
		await t.run((ctx) => ctx.db.patch(web, { stripeCheckoutExpiresAt: Date.now() - 1 }));
		await expect(admin.mutation(api.adminBookings.reopenBooking, { bookingId: web, expectedRevision: await rev(web), confirmed: false, reason: 'Paying at desk' })).rejects.toThrow('reopen as confirmed');
		await admin.mutation(api.adminBookings.reopenBooking, { bookingId: web, expectedRevision: await rev(web), confirmed: true, reason: 'Paying at desk', notifyGuest: false });
		const reopened = await get(web);
		expect(reopened).toMatchObject({ status: 'confirmed', paymentStatus: 'pending' });
		expect(reopened.stripeCheckoutSessionId).toBeUndefined();
	});

	it('records a past stay in an archived villa only with a logged reason', async () => {
		const { t, admin, propertyId, get, rev, create, history } = await setup();
		await t.run((ctx) => ctx.db.patch(propertyId, { status: 'archived' }));
		await expect(create(-10, -8)).rejects.toThrow('not available');
		await expect(create(5, 7, { archivedVillaReason: 'Old villa' })).rejects.toThrow('started in the past');
		const bookingId = await create(-10, -8, { archivedVillaReason: 'Villa archived after this stay' });
		expect((await history(bookingId))[0]).toMatchObject({ kind: 'created', reason: 'Villa archived after this stay', after: { villaStatus: 'archived' } });
		await admin.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: await rev(bookingId) });
		await expect(admin.mutation(api.adminBookings.reopenBooking, { bookingId, expectedRevision: await rev(bookingId), confirmed: true, reason: 'Mistake' })).rejects.toThrow('Give a reason');
		await admin.mutation(api.adminBookings.reopenBooking, { bookingId, expectedRevision: await rev(bookingId), confirmed: true, reason: 'Mistake', archivedVillaReason: 'Recording the real stay' });
		expect((await get(bookingId)).status).toBe('confirmed');
	});
});

describe('history, deletion and concurrency', () => {
	it('logs create, notes, confirmation and edits with actors, and protects against stale writes', async () => {
		const { admin, rev, create, edit, history } = await setup();
		const bookingId = await create(20, 22);
		const first = await rev(bookingId);
		await admin.mutation(api.adminBookings.updateNotes, { bookingId, notes: 'Late arrival', expectedRevision: first });
		await expect(admin.mutation(api.adminBookings.updateNotes, { bookingId, notes: 'Other device', expectedRevision: first })).rejects.toThrow('changed since you opened it');
		await expect(admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'confirm', expectedRevision: first })).rejects.toThrow('changed since you opened it');
		await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'confirm', expectedRevision: await rev(bookingId), notifyGuest: false });
		await expect(edit(bookingId, { guests: 3, expectedRevision: first })).rejects.toThrow('changed since you opened it');
		await edit(bookingId, { guests: 3 });
		const rows = await history(bookingId);
		expect(rows.map((row) => [row.kind, row.actor])).toEqual([
			['edited', adminEmail], ['confirmed', adminEmail], ['notes', adminEmail], ['created', adminEmail]
		]);
		expect(rows[0]).toMatchObject({ before: { guests: 2 }, after: { guests: 3 } });
		expect(rows[2]).toMatchObject({ before: { adminNotes: null }, after: { adminNotes: 'Late arrival' } });
		expect(rows[3].after).toMatchObject({ guestName: 'Mia', status: 'pending', createdBy: adminEmail });
		expect(JSON.stringify(rows)).not.toContain('accessToken');
		await expect(admin.query(api.adminBookings.bookingHistory, { bookingId, paginationOpts: { numItems: 51, cursor: null } })).rejects.toThrow('Page size');
	});

	it('keeps a snapshot of a deleted booking and records the unlinked appointment, and refuses bookings with payment records', async () => {
		const { t, admin, rev, create, pay, financials } = await setup();
		const bookingId = await create(20, 22);
		const appointmentId = await t.run(async (ctx) => {
			const staffId = await ctx.db.insert('staff', { name: 'Nok', role: 'Spa', color: '#fff', status: 'active', workingHours: [], breaks: [], createdAt: 0, updatedAt: 0 });
			const serviceId = await ctx.db.insert('services', { slug: 'spa', name: 'Spa', description: '', category: 'spa', durationMin: 60, bufferMin: 0, price: 100, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: 0, updatedAt: 0 });
			return await ctx.db.insert('serviceAppointments', { serviceId, staffId, start: 1, end: 2, blockedUntil: 2, guestName: 'Mia', guestPhone: '1', bookingId, source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 100, currency: 'THB', confirmationCode: 'SPA1', accessToken: 'x', createdAt: 0 });
		});
		await expect(admin.mutation(api.adminBookings.deleteBooking, { bookingId, expectedRevision: 99 })).rejects.toThrow('changed since you opened it');
		await admin.mutation(api.adminBookings.deleteBooking, { bookingId, expectedRevision: await rev(bookingId) });
		expect(await t.run((ctx) => ctx.db.get(bookingId))).toBeNull();
		expect((await t.run((ctx) => ctx.db.get(appointmentId)))?.bookingId).toBeUndefined();
		const rows = (await admin.query(api.adminBookings.bookingHistory, { bookingId, paginationOpts: page })).page;
		expect(rows[0]).toMatchObject({ kind: 'deleted', actor: adminEmail, before: { guestName: 'Mia', checkIn: isoInDays(20), unlinkedAppointments: [appointmentId] } });
		const unlinked = await t.run((ctx) => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', (q) => q.eq('entityType', 'appointment').eq('entityId', appointmentId)).collect());
		expect(unlinked).toMatchObject([{ kind: 'booking_unlinked', before: { bookingId }, after: { bookingId: null } }]);

		// A payment recorded by mistake and cancelled still leaves a financial record: cancel, don't delete.
		const other = await create(30, 32);
		const { paymentId } = await pay(other);
		await admin.mutation(api.adminBookings.cancelPayment, { bookingId: other, paymentId, expectedRevision: await rev(other), reason: 'Mistake' });
		await admin.mutation(api.adminBookings.cancelStay, { bookingId: other, expectedRevision: await rev(other) });
		await expect(admin.mutation(api.adminBookings.deleteBooking, { bookingId: other })).rejects.toThrow('payment records');
		expect((await financials(other)).payments).toHaveLength(1);
	});

	it('denies every new booking and order correction to non-admins', async () => {
		const { t, stranger, create, admin, order, settle } = await setup();
		const bookingId = await create(20, 22);
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		await settle(orderId, [{ method: 'cash', amount: 17000 }]);
		const paymentId = (await t.run((ctx) => ctx.db.query('bookingPayments').first()))!._id;
		const anonymous = t;
		for (const caller of [stranger, anonymous]) {
			const calls: Array<Promise<unknown>> = [
				caller.query(api.adminBookings.bookingFinancials, { bookingId }),
				caller.query(api.adminBookings.bookingHistory, { bookingId, paginationOpts: page }),
				caller.query(api.pos.orderHistory, { orderId, paginationOpts: page }),
				caller.mutation(api.adminBookings.recordPayment, { bookingId, expectedRevision: 0, expectedAmount: 1, method: 'cash', idempotencyKey: key() }),
				caller.mutation(api.adminBookings.amendPayment, { bookingId, paymentId, expectedRevision: 0, method: 'cash', reason: 'x' }),
				caller.mutation(api.adminBookings.cancelPayment, { bookingId, paymentId, expectedRevision: 0, reason: 'x' }),
				caller.mutation(api.adminBookings.recordRefund, { bookingId, expectedRevision: 0, amount: 1, currency: 'THB', method: 'cash', reason: 'x', idempotencyKey: key() }),
				caller.mutation(api.adminBookings.cancelStay, { bookingId, expectedRevision: 0 }),
				caller.mutation(api.adminBookings.reopenBooking, { bookingId, expectedRevision: 0, confirmed: true, reason: 'x' }),
				caller.mutation(api.pos.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: key(), reason: 'x', effectiveAt: Date.now() - DAY }),
				caller.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: key(), reason: 'x' })
			];
			for (const call of calls) await expect(call).rejects.toThrow(/Not (authenticated|authorized)/);
		}
		expect((await order(orderId)).order.status).toBe('paid');
		expect(await t.run((ctx) => ctx.db.query('bookingRefunds').collect())).toHaveLength(0);
	});
});

describe('checkout records', () => {
	it('logs ordinary order edits with snapshots, including what a clear removed', async () => {
		const { admin, propertyId } = await setup();
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 50 } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'room', propertyId } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'room', propertyId } });
		await admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'amount', value: 10 } });
		await admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'amount', value: 10 } });
		await admin.mutation(api.pos.removeLine, { lineId });
		await admin.mutation(api.pos.clearOrder, { orderId });
		const rows = (await admin.query(api.pos.orderHistory, { orderId, paginationOpts: page })).page;
		expect(rows.map((row) => row.kind)).toEqual(['cleared', 'line_removed', 'line_updated', 'line_updated', 'line_added', 'line_added']);
		expect(rows[0]).toMatchObject({ actor: adminEmail, before: { lines: [{ kind: 'room', qty: 2, propertyId }] } });
		expect(rows[1]).toMatchObject({ before: { name: 'Water', discount: { type: 'amount', value: 10 } } });
		expect(rows[3]).toMatchObject({ before: { kind: 'room', qty: 1 }, after: { kind: 'room', qty: 2 } });
	});

	it('dates a settled appointment by its business date and refuses a future one, and checks the reviewed customer revision', async () => {
		const { t, admin, order, settle } = await setup();
		const appointmentId = await t.run(async (ctx) => {
			const staffId = await ctx.db.insert('staff', { name: 'Nok', role: 'Spa', color: '#fff', status: 'active', workingHours: [], breaks: [], createdAt: 0, updatedAt: 0 });
			const serviceId = await ctx.db.insert('services', { slug: 'spa', name: 'Spa', description: '', category: 'spa', durationMin: 60, bufferMin: 0, price: 1200, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: 0, updatedAt: 0 });
			return await ctx.db.insert('serviceAppointments', { serviceId, staffId, start: Date.now() - 2 * DAY, end: Date.now() - 2 * DAY + 3_600_000, blockedUntil: Date.now() - 2 * DAY + 3_600_000, guestName: 'Eve', guestPhone: '1', source: 'admin', status: 'completed', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: 'SPA2', accessToken: 'x', createdAt: 0 });
		});
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
		const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Eve' });
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
		await expect(settle(orderId, [{ method: 'cash', amount: 1200 }], { effectiveAt: Date.now() + DAY, expectedCustomerRevision: 0 })).rejects.toThrow('future');
		await expect(settle(orderId, [{ method: 'cash', amount: 1200 }], { expectedCustomerRevision: 4 })).rejects.toThrow('customer changed');
		const monday = Date.now() - 2 * DAY;
		await settle(orderId, [{ method: 'cash', amount: 1200 }], { effectiveAt: monday, expectedCustomerRevision: 0 });
		expect(await t.run((ctx) => ctx.db.get(appointmentId))).toMatchObject({ paymentStatus: 'paid', paidAt: monday, paidBy: adminEmail });
		const view = await order(orderId);
		expect(view.order).toMatchObject({ paymentEffectiveAt: monday, customerRevisionAtPayment: 0 });
		expect(view.order.paidAt! - monday).toBeGreaterThan(DAY);

		// Mistaken settlement: the appointment goes back to unpaid at its price before checkout.
		await admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: key(), reason: 'Settled the wrong order' });
		const appointment = (await t.run((ctx) => ctx.db.get(appointmentId))) as Doc<'serviceAppointments'>;
		expect(appointment).toMatchObject({ paymentStatus: 'unpaid', price: 1200 });
		expect(appointment.paidAt).toBeUndefined();
	});
});
