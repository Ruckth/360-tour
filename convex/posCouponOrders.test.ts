// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { FunctionArgs } from 'convex/server';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const weekdays = [0, 1, 2, 3, 4, 5, 6];
/** The linked customer's profile revision as the cashier reviewed it (customers.ts assertCustomerReviewed). */
const reviewedCustomer = (view: { customer: object | null }) =>
	view.customer && 'revision' in view.customer && typeof view.customer.revision === 'number' ? { expectedCustomerRevision: view.customer.revision } : {};

async function setup(limits: { usageLimit?: number; discountBudget?: number; amount?: number; min?: number } = {}) {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const hours = { workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] };
	const nok = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', ...hours });
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
	/** settleOrder with the order and customer revisions the cashier is looking at now. */
	const settle = async (args: Omit<FunctionArgs<typeof api.pos.settleOrder>, 'expectedRevision'>) => {
		const view = await order(args.orderId);
		return admin.mutation(api.pos.settleOrder, { ...reviewedCustomer(view), ...args, expectedRevision: view.order.revision });
	};
	const appointment = (overrides: Record<string, unknown> = {}) => {
		const start = Date.now() + 3_600_000;
		return t.run((ctx) => ctx.db.insert('serviceAppointments', {
			serviceId, staffId: nok, start, end: start + 3_600_000, blockedUntil: start + 4_500_000, guestName: 'Eve', guestPhone: '+66 82 000 1111',
			source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: 'SVC-1', accessToken: 'tok', createdAt: Date.now(),
			...overrides
		}));
	};
	const extra = (orderId?: Id<'bills'>, price = 100) => admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Water', price } });
	const rules = { code: 'SPA-500', benefit: { kind: 'fixed' as const, amount: limits.amount ?? 500 }, scope: 'services' as const,
		minEligibleSubtotal: limits.min ?? 1500, usageLimit: limits.usageLimit, discountBudget: limits.discountBudget, terms: 'Spa services only.' };
	const { couponId } = await admin.mutation(api.marketing.saveCoupon, rules);
	await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
	const addService = (orderId?: Id<'bills'>) => admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId } });
	const sale = async () => {
		const { orderId } = await addService();
		const { lineId } = await addService(orderId);
		await admin.mutation(api.pos.overrideLinePrice, { lineId, price: 600, note: 'Foot spa' });
		return orderId;
	};
	const apply = (orderId: Id<'bills'>) => admin.mutation(api.pos.applyOrderCoupon, { orderId, code: ' spa-500 ' });
	const pay = async (orderId: Id<'bills'>, idempotencyKey = `coupon-pay-${orderId}`, effectiveAt?: number) => {
		const view = await order(orderId);
		return settle({ orderId, idempotencyKey, expectedDue: view.totals.due, tenders: view.totals.due ? [{ method: 'cash', amount: view.totals.due }] : [], effectiveAt });
	};
	const coupon = async () => (await t.run(ctx => ctx.db.get(couponId)))!;
	const ledger = () => t.run(ctx => ctx.db.query('couponRedemptions').withIndex('by_couponId_and_createdAt', q => q.eq('couponId', couponId)).take(50));
	return { t, admin, nok, serviceId, propertyId, bookingId, order, appointment, extra, rules, couponId, coupon, ledger, addService, sale, apply, pay };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-02T03:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

const unavailable = (code: string) => ({ data: expect.objectContaining({ code: 'coupon_unavailable', problem: expect.objectContaining({ code }) }) });

describe('POS order coupons', () => {
	it('splits SPA-500 333/167, consumes at 1300 and replays once even after the coupon is paused', async () => {
		const s = await setup();
		const orderId = await s.sale();
		const before = await s.order(orderId);
		expect(await s.apply(orderId)).toEqual({ code: 'SPA-500', discount: 500, revision: before.order.revision + 1 });
		const view = await s.order(orderId);
		expect(view.lines.map(line => line.couponDiscount)).toEqual([333, 167]);
		expect(view.promotion).toEqual({ code: 'SPA-500', couponVersion: 1, discount: 500, problem: null, terms: 'Spa services only.' });
		expect(view.totals).toMatchObject({ total: 1300, coupon: 500, due: 1300 });
		expect(await s.coupon()).toMatchObject({ used: 0, discountGranted: 0 });
		expect(await s.ledger()).toEqual([]);
		expect(await s.pay(orderId)).toMatchObject({ replayed: false });
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'paused' });
		expect(await s.pay(orderId)).toMatchObject({ replayed: true });
		expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 500 });
		expect(await s.ledger()).toMatchObject([{ billId: orderId, state: 'consumed', discount: 500, couponVersion: 1 }]);
		expect((await s.order(orderId)).order.promotion?.redemptionId).toBe((await s.ledger())[0]._id);
	});

	it('never discounts stays, rooms, extras or appointment fee rows', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.admin.mutation(api.pos.attach, { orderId, bookingId: s.bookingId });
		await s.admin.mutation(api.pos.addItem, { orderId, item: { kind: 'room', propertyId: s.propertyId } });
		await s.extra(orderId, 450);
		const appointmentId = await s.appointment({ status: 'no_show' });
		await s.admin.mutation(api.pos.addAppointmentFee, { orderId, appointmentId, kind: 'no_show', amount: 100 });
		await s.apply(orderId);
		const view = await s.order(orderId);
		expect(view.lines.filter(line => line.kind === 'service').map(line => line.couponDiscount)).toEqual([333, 167]);
		expect(view.lines.filter(line => line.kind !== 'service').every(line => line.couponDiscount === undefined)).toBe(true);
		expect(view.totals.coupon).toBe(500);
	});

	it('refuses a coupon already on an attached stay and shows its booking promotion unless overridden', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.t.run(async ctx => {
			const redemptionId = await ctx.db.insert('couponRedemptions', { couponId: s.couponId, couponVersion: 1, code: 'SPA-500', bookingId: s.bookingId, discount: 500, state: 'held', createdAt: Date.now(), updatedAt: Date.now() });
			await ctx.db.patch(s.bookingId, { promotion: { couponId: s.couponId, couponVersion: 1, code: 'SPA-500', discount: 500, redemptionId } });
		});
		await s.admin.mutation(api.pos.attach, { orderId, bookingId: s.bookingId });
		const before = await s.order(orderId);
		await expect(s.apply(orderId)).rejects.toMatchObject(unavailable('already_on_stay'));
		expect(await s.order(orderId)).toEqual(before);
		expect(before.lines.find(line => line.bookingId)?.stayCoupon).toEqual({ code: 'SPA-500', discount: 500 });
		await s.t.run(ctx => ctx.db.patch(s.bookingId, { priceOverride: { total: 30000, quotedTotal: 30000, reason: 'Custom stay', by: 'admin@example.com', at: Date.now() } }));
		expect((await s.order(orderId)).lines.find(line => line.bookingId)?.stayCoupon).toBeNull();
	});

	it('stores a minimum-spend problem on removal, blocks payment, and clears it when items return', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.admin.mutation(api.pos.removeLine, { lineId: (await s.order(orderId)).lines[1]._id });
		const view = await s.order(orderId);
		expect(view.promotion).toMatchObject({ code: 'SPA-500', discount: 0, problem: { code: 'min_subtotal', eligibleSubtotal: 1200 } });
		expect(view.totals).toMatchObject({ coupon: 0, due: 1200 });
		expect(view.lines[0].couponDiscount).toBeUndefined();
		await expect(s.pay(orderId)).rejects.toMatchObject(unavailable('min_subtotal'));
		await s.addService(orderId);
		expect((await s.order(orderId)).promotion).toMatchObject({ discount: 500, problem: null });
		await s.pay(orderId);
	});

	it('refuses a paused coupon at payment and writes no money or redemption', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'paused' });
		await expect(s.pay(orderId)).rejects.toMatchObject(unavailable('not_active'));
		expect((await s.order(orderId)).payments).toEqual([]);
		expect(await s.ledger()).toEqual([]);
	});

	it('requires review when another sale reduces the live budget and hence the saving', async () => {
		const s = await setup({ discountBudget: 800 });
		const first = await s.sale();
		const second = await s.sale();
		await s.apply(first);
		await s.apply(second);
		await s.pay(first);
		await expect(s.pay(second)).rejects.toMatchObject({ data: { code: 'coupon_changed', message: 'The coupon now saves ฿300. Check the coupon again before taking payment.', discount: 300 } });
		expect((await s.order(second)).payments).toEqual([]);
		expect(await s.ledger()).toHaveLength(1);
		await s.apply(second);
		expect((await s.order(second)).lines.map(line => line.couponDiscount)).toEqual([200, 100]);
		await s.pay(second);
		expect(await s.coupon()).toMatchObject({ used: 2, discountGranted: 800 });
	});

	it('lets only one competing order consume the last use and leaves the loser unpaid', async () => {
		const s = await setup({ usageLimit: 1 });
		const a = await s.sale();
		const b = await s.sale();
		await s.apply(a);
		await s.apply(b);
		const results = await Promise.allSettled([s.pay(a), s.pay(b)]);
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		const failure = results.find(result => result.status === 'rejected');
		expect(failure?.status === 'rejected' && failure.reason).toMatchObject(unavailable('sold_out'));
		const loser = results[0].status === 'rejected' ? a : b;
		expect((await s.order(loser)).payments).toEqual([]);
		expect((await s.order(loser)).order.status).toBe('draft');
		expect(await s.ledger()).toHaveLength(1);
		expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 500 });
	});

	it('settles a fully covered order without tenders', async () => {
		const s = await setup({ amount: 1800 });
		const orderId = await s.sale();
		await s.apply(orderId);
		expect((await s.order(orderId)).totals.due).toBe(0);
		await s.pay(orderId);
		expect((await s.order(orderId)).order.status).toBe('paid');
		expect((await s.order(orderId)).payments).toEqual([]);
		expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 1800 });
	});

	it('a plain void keeps the use counted', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.pay(orderId);
		await s.admin.mutation(api.pos.voidOrder, { orderId, reason: 'Void receipt' });
		expect((await s.ledger())[0].state).toBe('reversed');
		expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 500 });
	});

	it('releases an unreceived payment exactly once', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.pay(orderId);
		const args = { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-unreceived-001', reason: 'No money received' };
		await s.admin.mutation(api.pos.voidUnreceivedOrder, args);
		await s.admin.mutation(api.pos.voidUnreceivedOrder, args);
		expect((await s.ledger())[0].state).toBe('released');
		expect(await s.coupon()).toMatchObject({ used: 0, discountGranted: 0 });
	});

	it('freezes rules during edits and payment, adopts current rules on reapply and preserves paid shares forever', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, benefit: { kind: 'fixed', amount: 900 }, terms: 'New terms' });
		await s.admin.mutation(api.pos.updateLine, { lineId: (await s.order(orderId)).lines[0]._id, staffId: s.nok });
		expect((await s.order(orderId)).promotion).toMatchObject({ couponVersion: 1, discount: 500, terms: 'Spa services only.' });
		await s.pay(orderId);
		await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, benefit: { kind: 'fixed', amount: 1000 } });
		expect((await s.order(orderId)).lines.map(line => line.couponDiscount)).toEqual([333, 167]);
		await expect(s.apply(orderId)).rejects.toThrow('already paid');
		const next = await s.sale();
		await s.apply(next);
		expect((await s.order(next)).promotion).toMatchObject({ couponVersion: 3, discount: 1000 });
		await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId });
		await s.apply(next);
		expect((await s.order(next)).promotion).toMatchObject({ couponVersion: 4, discount: 500 });
	});

	it('removes shares and promotion, logs removal and replacement, and clearing removes the promotion', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.apply(orderId);
		const revision = (await s.order(orderId)).order.revision;
		expect(await s.admin.mutation(api.pos.removeOrderCoupon, { orderId })).toEqual({ revision: revision + 1 });
		const removed = await s.order(orderId);
		expect(removed.promotion).toBeNull();
		expect(removed.lines.every(line => line.couponDiscount === undefined)).toBe(true);
		expect(removed.totals.due).toBe(1800);
		expect(await s.admin.mutation(api.pos.removeOrderCoupon, { orderId })).toEqual({ revision: revision + 1 });
		await s.apply(orderId);
		await s.admin.mutation(api.pos.clearOrder, { orderId });
		expect((await s.order(orderId)).promotion).toBeNull();
		const history = await s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'order').eq('entityId', orderId)).take(50));
		expect(history.find(row => row.kind === 'coupon_removed')).toMatchObject({ before: { code: 'SPA-500', discount: 500 } });
		expect(history.filter(row => row.kind === 'coupon_applied')[1]).toMatchObject({ before: { code: 'SPA-500' }, after: { code: 'SPA-500', couponVersion: 1, discount: 500 } });
	});

	it('uses real Bangkok today at payment even when effectiveAt is backdated', async () => {
		const s = await setup();
		await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, bookTo: '2026-10-02' });
		const orderId = await s.sale();
		await s.apply(orderId);
		vi.setSystemTime(new Date('2026-10-02T18:00:00Z'));
		await expect(s.pay(orderId, 'backdated-payment', Date.parse('2026-10-02T03:00:00Z'))).rejects.toMatchObject(unavailable('expired'));
		expect((await s.order(orderId)).payments).toEqual([]);
	});

	it('keeps discard and payment amendments out of the ledger and revalidates on restore', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.admin.mutation(api.pos.discardOrder, { orderId, expectedRevision: (await s.order(orderId)).order.revision, idempotencyKey: 'discard-coupon-001' });
		expect(await s.ledger()).toEqual([]);
		await expect(s.apply(orderId)).rejects.toThrow('discarded');
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'paused' });
		await s.admin.mutation(api.pos.restoreOrder, { orderId, expectedRevision: (await s.order(orderId)).order.revision, idempotencyKey: 'restore-coupon-001' });
		expect((await s.order(orderId)).promotion?.problem).toEqual({ code: 'not_active' });
		expect(await s.ledger()).toEqual([]);
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'active' });
		await s.apply(orderId);
		await s.pay(orderId);
		await s.admin.mutation(api.pos.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'amend-coupon-001', reason: 'Card instead', tenders: [{ method: 'card', amount: 1300 }] });
		expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 500 });
		expect((await s.ledger())[0].state).toBe('consumed');
	});

	it('resolves only active coupon links, requires exactly one input and leaves a failed replacement untouched', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		const before = await s.order(orderId);
		for (const args of [{}, { code: 'SPA-500', slug: 'spa' }]) {
			await expect(s.admin.mutation(api.pos.applyOrderCoupon, { orderId, ...args })).rejects.toThrow('Choose one');
		}
		await expect(s.admin.mutation(api.pos.applyOrderCoupon, { orderId, code: 'missing' })).rejects.toMatchObject(unavailable('not_found'));
		await expect(s.admin.mutation(api.pos.applyOrderCoupon, { orderId, slug: 'missing' })).rejects.toMatchObject(unavailable('link_without_offer'));
		const campaignId = await s.admin.mutation(api.marketing.saveCampaign, { name: 'Spa', source: 'desk', medium: 'qr' });
		const linkId = await s.admin.mutation(api.marketing.saveLink, { campaignId, slug: 'spa', name: 'Spa', destination: { kind: 'experiences' }, entry: 'qr', couponId: s.couponId });
		await expect(s.admin.mutation(api.pos.applyOrderCoupon, { orderId, slug: 'spa' })).rejects.toMatchObject(unavailable('link_without_offer'));
		expect(await s.order(orderId)).toEqual(before);
		await s.admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
		expect(await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, slug: 'spa' })).toMatchObject({ code: 'SPA-500', discount: 500 });
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'paused' });
		await expect(s.admin.mutation(api.pos.applyOrderCoupon, { orderId, slug: 'spa' })).rejects.toMatchObject(unavailable('link_without_offer'));
	});

	it('stores not_found if a coupon disappears and refuses payment', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.t.run(ctx => ctx.db.delete(s.couponId));
		await s.addService(orderId);
		expect((await s.order(orderId)).promotion).toMatchObject({ discount: 0, problem: { code: 'not_found' } });
		await expect(s.pay(orderId)).rejects.toMatchObject(unavailable('not_found'));
	});

	it('caps appointment refunds at the coupon-adjusted amount on the receipt', async () => {
		const s = await setup({ min: 1 });
		const appointmentId = await s.appointment();
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId });
		await s.apply(orderId);
		await s.pay(orderId);
		const appointment = (await s.t.run(ctx => ctx.db.get(appointmentId)))!;
		expect(appointment).toMatchObject({ price: 700, amountPaid: 700 });
		const refund = { appointmentId, billId: orderId, expectedRevision: appointment.revision ?? 0, currency: 'THB', method: 'cash' as const, reason: 'Guest refund', idempotencyKey: 'refund-coupon-001' };
		await expect(s.admin.mutation(api.adminServices.refundAppointment, { ...refund, amount: 701 })).rejects.toThrow('At most 700');
		// Even if other money was received for the appointment, this receipt only took 700.
		await s.t.run(ctx => ctx.db.patch(appointmentId, { amountPaid: 1200 }));
		await expect(s.admin.mutation(api.adminServices.refundAppointment, { ...refund, amount: 701 })).rejects.toThrow('Refund exceeds the actual money remaining on this receipt');
		await s.admin.mutation(api.adminServices.refundAppointment, { ...refund, amount: 700 });
		expect((await s.order(orderId)).lines[0].net).toBe(700);
		expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 500 });
	});

	it('requires admin for applying and removing coupons', async () => {
		const s = await setup();
		const orderId = await s.sale();
		for (const client of [s.t, s.t.withIdentity({ email: 'guest@example.com' })]) {
			await expect(client.mutation(api.pos.applyOrderCoupon, { orderId, code: 'SPA-500' })).rejects.toThrow();
			await expect(client.mutation(api.pos.removeOrderCoupon, { orderId })).rejects.toThrow();
		}
		expect((await s.order(orderId)).promotion).toBeNull();
	});
});

describe('POS order coupons: review fixes', () => {
	it('lowering the usage limit stops an order frozen on the earlier version', async () => {
		const s = await setup({ usageLimit: 10 });
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.t.run(ctx => ctx.db.patch(s.couponId, { used: 3 }));
		await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, usageLimit: 3 });
		expect((await s.order(orderId)).promotion?.couponVersion).toBe(1);
		await expect(s.pay(orderId)).rejects.toMatchObject(unavailable('sold_out'));
		expect(await s.ledger()).toEqual([]);
	});

	it('rechecks a stored problem once the coupon is live again, and payment never trusts a stale one', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'paused' });
		await s.extra(orderId);
		expect((await s.order(orderId)).promotion).toMatchObject({ discount: 0, problem: { code: 'not_active' } });
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'active' });
		// Payment re-checks: the coupon fits again, so staff must review the new saving first.
		await expect(s.pay(orderId)).rejects.toMatchObject({ data: expect.objectContaining({ code: 'coupon_changed', discount: 500 }) });
		const before = (await s.order(orderId)).order.revision;
		expect(await s.admin.mutation(api.pos.recheckOrderCoupon, { orderId })).toEqual({ revision: before + 1, discount: 500, problem: null });
		expect((await s.order(orderId)).lines.map(line => line.couponDiscount ?? 0)).toEqual([333, 167, 0]);
		await s.pay(orderId);
		expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 500 });
	});

	it('a code renamed before its first use reaches the order, the ledger and the receipt', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await s.apply(orderId);
		await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, code: 'SPA-FIVE' });
		await s.pay(orderId);
		expect((await s.order(orderId)).promotion?.code).toBe('SPA-FIVE');
		expect(await s.ledger()).toMatchObject([{ code: 'SPA-FIVE', state: 'consumed' }]);
	});

	it('recheck needs a coupon and an unpaid order', async () => {
		const s = await setup();
		const orderId = await s.sale();
		await expect(s.admin.mutation(api.pos.recheckOrderCoupon, { orderId })).rejects.toThrow('This order has no coupon');
		await s.apply(orderId);
		await s.pay(orderId);
		await expect(s.admin.mutation(api.pos.recheckOrderCoupon, { orderId })).rejects.toThrow('This order is already paid');
	});
});
