import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { stayMoney } from './lib/bookingMoney';
import { readMarketingReport } from './lib/marketingReportRead';
import { ReadBudget } from './lib/readBudget';

const modules = import.meta.glob('./**/*.ts');
const now = Date.parse('2026-11-09T10:00:00Z');
const day = 86_400_000;
const email = 'admin@example.com';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('ADMIN_EMAILS', email); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup(couponAmount = 10000) {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email, tokenIdentifier: 'admin' });
	const propertyId = await t.run(ctx => ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100000, currency: 'THB', maxGuests: 4, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
	const campaignId = await admin.mutation(api.marketing.saveCampaign, { name: 'November', source: 'print', medium: 'qr' });
	const { couponId } = await admin.mutation(api.marketing.saveCoupon, { campaignId, code: 'SPA100', benefit: { kind: 'fixed', amount: couponAmount }, scope: 'services' });
	await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
	const linkId = await admin.mutation(api.marketing.saveLink, { campaignId, couponId, slug: 'spa', name: 'Spa card', destination: { kind: 'home' }, entry: 'qr' });
	await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
	const booking = (patch: Partial<Doc<'bookings'>> = {}) => t.run(async ctx => { const id = await insertFixture(ctx, 'bookings', { propertyId, guestName: 'Guest', guestPhone: '+66811112222', checkIn: '2026-11-15', checkOut: '2026-11-16', guests: 2, nights: 1, subtotal: 100000, discountAmount: 0, total: 100000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: now, ...patch });
    if (patch.paymentStatus === 'paid' && patch.amountPaid === undefined) await ctx.db.insert('bookingPayments', { bookingId: id, origin: 'manual', method: 'cash', currency: patch.currency ?? 'THB', amount: patch.total ?? 100000, effectiveAt: patch.paidAt ?? now, recordedAt: now, recordedBy: email, status: 'recorded', refunded: 0 });
    return id; });
	const order = async (orderId: Id<'orders'>) => (await admin.query(api.pos.getOrder, { orderId }))!;
	const report = (basis: 'cohort' | 'cash' = 'cohort', from = '2026-11-09', to = from) => admin.query(api.marketingReport.getReport, { from, to, basis });
	const payOrder = async (orderId: Id<'orders'>, effectiveAt = now) => {
		const view = await order(orderId);
		const args = { orderId, expectedRevision: view.order.revision, expectedDue: view.totals.due, idempotencyKey: `settle-${orderId}`, tenders: view.totals.due ? [{ method: 'cash' as const, amount: view.totals.due }] : [], effectiveAt };
		await admin.mutation(api.pos.settleOrder, args);
		return () => admin.mutation(api.pos.settleOrder, args);
	};
	const payment = (bookingId: Id<'bookings'>, amount: number, effectiveAt = now, status: 'recorded' | 'cancelled' = 'recorded') => t.run(ctx => ctx.db.insert('bookingPayments', { bookingId, origin: 'manual', method: 'cash', currency: 'THB', amount, effectiveAt, recordedAt: now, recordedBy: email, status, refunded: 0 }));
	const staffId = await admin.mutation(api.adminServices.createStaff, { name: 'Mali', role: 'Therapist', color: '#abc', workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] });
	const serviceId = await admin.mutation(api.adminServices.createService, { slug: 'spa', name: 'Spa', description: '', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 50000, currency: 'THB', staffIds: [staffId] });
	const appointment = (start = now - day) => admin.mutation(api.adminServices.createAppointment, { serviceId, staffId, start, guestName: 'Desk guest', guestPhone: '' }).then(r => r.appointmentId);
	/** An order paid before stay payments were itemised: ฿1,000 for the stay and ฿50 of water, with no bookingPayments row. */
	const oldOrder = (bookingId: Id<'bookings'>) => t.run(async ctx => {
		const id = await insertFixture(ctx, 'orders', { status: 'paid', bookingId, currency: 'THB', itemCount: 2, total: 105000, due: 0, hasItems: true, revision: 1, paidAt: now, paymentEffectiveAt: now, createdBy: email, createdAt: now, updatedAt: now });
		await insertFixture(ctx, 'orderLines', { orderId: id, kind: 'booking', bookingId, name: 'Stay', unitPrice: 100000, currency: 'THB', qty: 1, createdAt: now });
		await insertFixture(ctx, 'orderLines', { orderId: id, kind: 'extra', name: 'Water', unitPrice: 5000, currency: 'THB', qty: 1, createdAt: now });
		await ctx.db.insert('orderPayments', { orderId: id, method: 'cash', amount: 105000, idempotencyKey: `old-order-${bookingId}`, createdBy: email, createdAt: now, effectiveAt: now });
		return id;
	});
	return { t, admin, propertyId, campaignId, couponId, linkId, booking, order, report, payOrder, payment, serviceId, staffId, appointment, oldOrder };
}

describe('report money', () => {
	it('counts online payments, an extension and POS stay balance once, with scanned spa coupon and replay-safe refunds', async () => {
		const s = await setup();
		const bookingId = await s.booking({ source: 'web', accessToken: 'token' });
		async function online(sessionId: string, paymentIntentId: string, amount: number) {
			const { request } = await s.t.mutation(internal.bookings.payments.stripe.beginCheckout, { bookingId, accessToken: 'token', siteUrl: 'https://example.com' });
			if (!request) throw new Error('Expected a new checkout');
			await s.t.mutation(internal.bookings.payments.stripe.saveCheckoutSession, { bookingId, accessToken: 'token', sessionId, url: 'https://checkout.stripe.com/test', expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
			const args = { bookingId, sessionId, paymentIntentId, amountTotal: amount, currency: 'thb' };
			await s.t.mutation(internal.bookings.payments.stripe.completeCheckout, args);
			return () => s.t.mutation(internal.bookings.payments.stripe.completeCheckout, args);
		}
		const replayFirst = await online('cs_first', 'pi_first', 100000);
		await s.t.run(ctx => ctx.db.patch(bookingId, { total: 200000, subtotal: 200000 }));
		const replaySecond = await online('cs_second', 'pi_second', 100000);
		await s.t.run(ctx => ctx.db.patch(bookingId, { total: 300000, subtotal: 300000 }));
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { bookingId });
		await s.admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId: s.serviceId } });
		await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, slug: 'spa' });
		const replaySettle = await s.payOrder(orderId);
		const cohort = await s.report();
		expect(cohort.events).toEqual([]);
		expect(cohort.sales).toHaveLength(2);
		expect(cohort.sales.find(r => r.id === bookingId)).toMatchObject({ kind: 'stay', collected: 300000, refunded: 0, discount: 0, bucket: 'unknown' });
		expect(cohort.sales.find(r => r.id === orderId)).toMatchObject({ kind: 'order', collected: 40000, discount: 10000, bucket: 'tracked', evidence: 'scanned', last: { linkId: s.linkId }, propertyId: s.propertyId });
		expect(stayMoney((await s.t.run(ctx => ctx.db.get(bookingId)))!).gross).toBe(300000);
		const cash = await s.report('cash');
		expect(cash.events.filter(e => e.kind === 'payment').reduce((sum, e) => sum + e.amount, 0)).toBe(340000);
		expect(cash.events.filter(e => e.saleId === bookingId)).toHaveLength(3);
		expect(cohort.sales.reduce((sum, r) => sum + r.discount, 0)).toBe((await s.t.run(ctx => ctx.db.get(s.couponId)))!.discountGranted);
		await replayFirst(); await replaySecond(); await replaySettle();
		expect(await s.report('cash')).toEqual(cash);
		// A real returned stay payment remains on the stay even though its source is an order.
		await s.t.run(ctx => ctx.db.patch(bookingId, { total: 280000 }));
		const current = (await s.t.run(ctx => ctx.db.get(bookingId)))!;
		const refund = { bookingId, expectedRevision: current.revision ?? 0, amount: 20000, currency: 'THB', method: 'cash' as const, orderId: orderId, reason: 'Shorter stay', idempotencyKey: 'stay-pos-refund', effectiveAt: now };
		await s.admin.mutation(api.bookings.commands.recordRefund.recordRefund, refund);
		const refunded = await s.report('cash');
		await s.admin.mutation(api.bookings.commands.recordRefund.recordRefund, refund);
		expect(await s.report('cash')).toEqual(refunded);
		expect(refunded.events.filter(e => e.kind === 'refund')).toEqual([{ saleId: bookingId, kind: 'refund', day: '2026-11-09', amount: 20000 }]);
		expect(refunded.sales.find(r => r.id === bookingId)?.refunded).toBe(20000);
		expect(refunded.sales.find(r => r.id === orderId)?.refunded).toBe(0);
	});

	it('counts a consumed stay coupon once, omits its unpaid hold and retains an archived referenced coupon', async () => {
		const s = await setup();
		const { couponId } = await s.admin.mutation(api.marketing.saveCoupon, { campaignId: s.campaignId, code: 'VILLA100', benefit: { kind: 'fixed', amount: 10000 }, scope: 'accommodation' });
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
		const { bookingId } = await s.t.mutation(api.bookings.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66811112222', checkIn: '2026-11-15', checkOut: '2026-11-16', guests: 2, couponCode: 'VILLA100' });
		expect((await s.report()).sales).toEqual([]);
		await s.t.mutation(internal.bookings.bookings.markPaidFromTrustedWebhook, { bookingId });
		await s.t.mutation(internal.bookings.bookings.markPaidFromTrustedWebhook, { bookingId });
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'archived' });
		const report = await s.report();
		expect(report.sales).toMatchObject([{ id: bookingId, collected: 90000, discount: 10000, coupon: { couponId, code: 'VILLA100', campaignId: s.campaignId } }]);
		expect(report.sales.reduce((sum, r) => sum + r.discount, 0)).toBe((await s.t.run(ctx => ctx.db.get(couponId)))!.discountGranted);
		expect(report.coupons.find(c => c.id === couponId)?.status).toBe('archived');
	});

	it('moves the POS stay payment and own order cash to the corrected day, retaining stay cohort membership', async () => {
		const s = await setup();
		const bookingId = await s.booking({ source: 'admin' });
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { bookingId });
		await s.admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Water', price: 5000 } });
		await s.payOrder(orderId);
		await s.admin.mutation(api.pos.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'correct-date-001', reason: 'Yesterday', effectiveAt: now - day, tenders: [{ method: 'transfer', amount: 105000 }] });
		expect((await s.report('cash')).events).toEqual([]);
		const moved = await s.report('cash', '2026-11-08');
		expect(moved.events.map(e => e.amount).sort((a, b) => a - b)).toEqual([5000, 100000]);
		expect(moved.events.every(e => e.day === '2026-11-08')).toBe(true);
		expect((await s.report()).sales.find(r => r.id === bookingId)).toMatchObject({ createdDay: '2026-11-09', collected: 100000, bucket: 'staff' });
		const row = await s.t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique());
		expect(row).toMatchObject({ effectiveAt: now - day, amendedAt: now, amendedBy: email });
	});

	it.each([true, false])('voidUnreceived=%s removes only unreceived money and coupon discount', async unreceived => {
		const s = await setup();
		const { orderId } = await s.admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: s.serviceId } });
		await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, code: 'SPA100' });
		await s.payOrder(orderId);
		if (unreceived) await s.admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-unreceived-001', reason: 'No money' });
		else await s.admin.mutation(api.pos.voidOrder, { orderId, reason: 'Keep money' });
		for (const basis of ['cash', 'cohort'] as const) expect((await s.report(basis)).sales).toHaveLength(unreceived ? 0 : 1);
		expect((await s.report()).sales.reduce((sum, r) => sum + r.discount, 0)).toBe((await s.t.run(ctx => ctx.db.get(s.couponId)))!.discountGranted);
	});

	it('skips pure stay checkouts, cancelled payment entries and unpaid stays', async () => {
		const s = await setup();
		const bookingId = await s.booking();
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { bookingId });
		await s.payOrder(orderId);
		await s.booking();
		const cancelled = await s.booking();
		await s.payment(cancelled, 100000, now, 'cancelled');
		expect((await s.report()).sales.map(r => r.id)).toEqual([bookingId]);
		expect((await s.report('cash')).events).toEqual([{ saleId: bookingId, kind: 'payment', day: '2026-11-09', amount: 100000 }]);
	});

	it('uses Bangkok boundaries for payments and includes cash sales created outside the cohort', async () => {
		const s = await setup();
		const bookingId = await s.booking({ createdAt: now - 10 * day, amountPaid: 100000 });
		await s.payment(bookingId, 40000, Date.parse('2026-11-08T16:59:59Z'));
		await s.payment(bookingId, 60000, Date.parse('2026-11-08T17:00:00Z'));
		expect((await s.report()).sales).toEqual([]);
		expect((await s.report('cash', '2026-11-08')).events.map(e => e.amount)).toEqual([40000]);
		expect((await s.report('cash')).events.map(e => e.amount)).toEqual([60000]);
	});

	it('counts desk appointment payments/refunds and routes receipt refunds exclusively to the order', async () => {
		const s = await setup();
		const appointmentId = await s.appointment();
		const paid = await s.admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId, expectedRevision: 0, method: 'cash', idempotencyKey: 'desk-payment-001' });
		await s.admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: 1, amount: 10000, currency: 'THB', method: 'cash', reason: 'Courtesy', paymentId: paid.paymentId, idempotencyKey: 'desk-refund-001' });
		const second = await s.admin.mutation(api.adminServices.createAppointment, { serviceId: s.serviceId, staffId: s.staffId, start: now - 2 * day, guestName: 'POS guest', guestPhone: '' });
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId: second.appointmentId });
		await s.payOrder(orderId, now - day);
		const args = { appointmentId: second.appointmentId, expectedRevision: 1, amount: 20000, currency: 'THB', method: 'cash' as const, reason: 'Courtesy', orderId: orderId, idempotencyKey: 'receipt-refund-001' };
		await s.admin.mutation(api.adminServices.refundAppointment, args);
		await s.admin.mutation(api.adminServices.refundAppointment, args);
		const report = await s.report('cash');
		expect(report.sales).toHaveLength(2);
		expect(report.sales.find(r => r.id === appointmentId)).toMatchObject({ kind: 'appointment', channel: 'desk', collected: 50000, refunded: 10000 });
		expect(report.sales.find(r => r.id === orderId)).toMatchObject({ kind: 'order', collected: 50000, refunded: 20000 });
		expect(report.events.filter(e => e.kind === 'refund').map(e => e.amount).sort()).toEqual([10000, 20000]);
		expect(report.events.filter(e => e.saleId === orderId)).toEqual([{ saleId: orderId, kind: 'refund', day: '2026-11-09', amount: 20000 }]);
	});
});

describe('report attribution and limits', () => {
	it('maps admin, messaging, unknown web, tracked web/chat and current-link snapshots; retains referenced archives', async () => {
		const s = await setup();
		const last = { linkId: s.linkId, campaignId: s.campaignId, slug: 'frozen', campaignName: 'Frozen name', source: 'facebook', medium: 'social', entry: 'link' as const };
		const first = { ...last, slug: 'first' };
		for (const source of ['admin', 'line', 'whatsapp', 'messenger', 'instagram', 'web'] as const) await s.booking({ source, paymentStatus: 'paid', paidAt: now });
		await s.booking({ source: 'web', paymentStatus: 'paid', paidAt: now, marketingAttribution: { model: 'last_touch_30d@1', evidence: 'tracked', last, first, capturedAt: now } });
		await s.booking({ source: 'web', paymentStatus: 'paid', paidAt: now, marketingAttribution: { model: 'last_touch_30d@1', evidence: 'current_link', last, capturedAt: now } });
		const chatSessionId = await s.t.run(ctx => ctx.db.insert('conversations', { channel: 'web', createdAt: now }));
		await s.booking({ source: 'web', chatSessionId, paymentStatus: 'paid', paidAt: now, marketingAttribution: { model: 'last_touch_30d@1', evidence: 'tracked', last, first, capturedAt: now } });
		await s.t.run(async ctx => { await ctx.db.patch(s.linkId, { status: 'archived' }); await ctx.db.patch(s.campaignId, { status: 'archived' }); });
		const report = await s.report();
		expect(report.sales.map(r => r.bucket)).toEqual(['staff', 'messaging', 'messaging', 'messaging', 'messaging', 'unknown', 'tracked', 'tracked', 'tracked']);
		expect(report.sales[6]).toMatchObject({ evidence: 'tracked', last, first });
		expect(report.sales[7].first).toBeUndefined();
		expect(report.sales[8]).toMatchObject({ channel: 'web_chat', first });
		expect(report.links).toHaveLength(1);
		expect(report.campaigns).toHaveLength(1);
	});

	it('rejects invalid/over-92-day ranges and unauthorised reads', async () => {
		const s = await setup();
		for (const [from, to] of [['2026-01-01', '2026-04-03'], ['bad', '2026-11-09'], ['2026-11-10', '2026-11-09']]) await expect(s.report('cash', from, to)).rejects.toThrow(/92 Bangkok days/);
		// Exactly 92 days is allowed.
		expect((await s.report('cash', '2026-08-10', '2026-11-09')).truncated).toBe(false);
		await expect(s.t.query(api.marketingReport.getReport, { from: '2026-11-09', to: '2026-11-09', basis: 'cash' })).rejects.toThrow('authenticated');
	});

	it('excludes foreign stays and orders once per sale', async () => {
		const s = await setup();
		const id = await s.booking({ currency: 'USD', paymentStatus: 'paid', paidAt: now });
		await s.payment(id, 100000);
		const { orderId } = await s.admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 5000 } });
		await s.payOrder(orderId);
		await s.t.run(ctx => ctx.db.patch(orderId, { currency: 'USD' }));
		for (const basis of ['cash', 'cohort'] as const) expect(await s.report(basis)).toMatchObject({ sales: [], events: [], excluded: { nonThb: 2 } });
	});

	it('keeps names, spend and completed sales when a later candidate exhausts the budget', async () => {
		const s = await setup();
		await s.admin.mutation(api.marketingReport.saveSpend, { campaignId: s.campaignId, amount: 90000, from: '2026-11-01', to: '2026-11-09' });
		const first = await s.booking({ paymentStatus: 'paid', paidAt: now });
		await s.booking({ paymentStatus: 'paid', paidAt: now });
		const args = { from: '2026-11-09', to: '2026-11-09', basis: 'cohort' as const };
		const probe = new ReadBudget();
		expect((await s.t.run(ctx => readMarketingReport(ctx, args, probe))).truncated).toBe(false);
		// Stop on the second stay's refunds, before the order, appointment and conversion scans.
		const result = await s.t.run(ctx => readMarketingReport(ctx, args, new ReadBudget(16_000, probe.ranges - 8)));
		expect(result.truncated).toBe(true);
		expect(result.sales.map(sale => sale.id)).toEqual([first]);
		expect(result).toMatchObject({ campaigns: [{ id: s.campaignId }], links: [{ id: s.linkId }], spend: [{ amount: 90000 }], properties: [{ id: s.propertyId }] });
	});

	it('keeps the same range-budget truncation point with batched POS refunds', async () => {
		const s = await setup();
		const orders = await s.t.run(async ctx => {
			const ids = [];
			for (let i = 0; i < 1050; i++) {
				const orderId = await insertFixture(ctx, 'orders', { status: 'paid', currency: 'THB', itemCount: 1, total: 50000, due: 0, hasItems: true, revision: 1, paidAt: now, createdBy: email, createdAt: now, updatedAt: now });
				await ctx.db.insert('orderPayments', { orderId: orderId, method: 'cash', amount: 50000, idempotencyKey: `budget-${i}`, createdBy: email, createdAt: now });
				const lineId = await insertFixture(ctx, 'orderLines', { orderId: orderId, kind: 'extra', name: 'Water', unitPrice: 50000, qty: 1, currency: 'THB', createdAt: now });
				ids.push({ orderId, lineId });
			}
			return ids;
		});
		vi.setSystemTime(now + 2 * day);
		const args = { from: '2026-08-10', to: '2026-11-09', basis: 'cash' as const };
		const beforeBudget = new ReadBudget();
		const before = await s.t.run(ctx => readMarketingReport(ctx, args, beforeBudget));
		await s.t.run(async ctx => {
			for (const { orderId, lineId } of orders) {
				await ctx.db.insert('orderRefunds', { orderId, lineId, amount: 10000, currency: 'THB', method: 'cash', reason: 'Return', idempotencyKey: `refund-${orderId}`, businessDate: '2026-11-10', createdAt: now + day, createdBy: email, createdByEmail: email });
				await ctx.db.patch(orderId, { correctionRevision: 1 });
			}
		});
		const afterBudget = new ReadBudget();
		const after = await s.t.run(ctx => readMarketingReport(ctx, args, afterBudget));
		expect(before.truncated).toBe(false);
		expect(after.truncated).toBe(false);
		expect(after.sales).toHaveLength(1050);
		expect(after.sales.every(sale => sale.refunded === 10000)).toBe(true);
		expect(afterBudget.ranges).toBe(beforeBudget.ranges);
		for (const maxRanges of [beforeBudget.ranges - 1, beforeBudget.ranges]) {
			const report = await s.t.run(ctx => readMarketingReport(ctx, args, new ReadBudget(16000, maxRanges)));
			expect(report.truncated).toBe(maxRanges < beforeBudget.ranges);
			expect(report.sales.map(sale => sale.id)).toEqual(before.sales.map(sale => sale.id));
		}
	});

	it('answers a busy month (3 stays and 20 walk-in orders a day) inside the budget', async () => {
		const s = await setup();
		await s.t.run(async ctx => {
			for (let d = 0; d < 30; d++) {
				const at = now - d * day;
				for (let i = 0; i < 3; i++) {
					const bookingId = await insertFixture(ctx, 'bookings', { propertyId: s.propertyId, guestName: 'Guest', guestPhone: '+66811112222', checkIn: '2026-12-01', checkOut: '2026-12-02', guests: 2, nights: 1, subtotal: 100000, discountAmount: 0, total: 100000, currency: 'THB', paymentStatus: 'paid', status: 'confirmed', amountPaid: 100000, paidAt: at, createdAt: at });
					await ctx.db.insert('bookingPayments', { bookingId, origin: 'manual', method: 'cash', currency: 'THB', amount: 100000, effectiveAt: at, recordedAt: at, recordedBy: email, status: 'recorded', refunded: 0 });
				}
				for (let i = 0; i < 20; i++) {
					const orderId = await insertFixture(ctx, 'orders', { status: 'paid', currency: 'THB', itemCount: 1, total: 50000, due: 0, hasItems: true, revision: 1, paidAt: at, paymentEffectiveAt: at, createdBy: email, createdAt: at, updatedAt: at });
					await ctx.db.insert('orderPayments', { orderId, method: 'cash', amount: 50000, idempotencyKey: `busy-${d}-${i}`, createdBy: email, createdAt: at, effectiveAt: at });
				}
			}
		});
		for (const basis of ['cohort', 'cash'] as const) {
			const report = await s.report(basis, '2026-10-11', '2026-11-09');
			expect(report.truncated).toBe(false);
			expect(report.sales).toHaveLength(690);
			expect(report.sales.reduce((sum, sale) => sum + sale.collected, 0)).toBe(90 * 100000 + 600 * 50000);
			expect(report.campaigns).toHaveLength(1);
		}
	});

	it('finds an order\'s refund dated before its corrected payment day', async () => {
		const s = await setup();
		const appointmentId = await s.appointment();
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId });
		// Each step is entered on its own day, so the refund was typed in before the report's refund batch begins.
		vi.setSystemTime(now - 5 * day);
		await s.payOrder(orderId, now - 5 * day);
		vi.setSystemTime(now - 3 * day);
		const appointment = (await s.t.run(ctx => ctx.db.get(appointmentId)))!;
		await s.admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: appointment.revision ?? 0, amount: 20000, currency: 'THB', method: 'cash', reason: 'Courtesy', orderId: orderId, idempotencyKey: 'early-refund-001' });
		vi.setSystemTime(now);
		await s.admin.mutation(api.pos.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'later-date-001', reason: 'Wrong day', effectiveAt: now - day, tenders: [{ method: 'cash', amount: 50000 }] });
		// The range starts after the refund's day; the sale still shows what was given back.
		expect((await s.report('cohort', '2026-11-08')).sales).toMatchObject([{ id: orderId, collected: 50000, refunded: 20000 }]);
	});

	it('finds a refund back-dated to before the range on an order paid in it', async () => {
		const s = await setup();
		const appointmentId = await s.appointment();
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId });
		await s.payOrder(orderId);
		const appointment = (await s.t.run(ctx => ctx.db.get(appointmentId)))!;
		await s.admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: appointment.revision ?? 0, amount: 20000, currency: 'THB', method: 'cash', reason: 'Courtesy', orderId: orderId, idempotencyKey: 'backdated-refund-001', effectiveAt: now - 3 * day });
		expect((await s.report()).sales).toMatchObject([{ id: orderId, collected: 50000, refunded: 20000 }]);
		// The money view dates it where staff put it.
		expect((await s.report('cash')).events).toEqual([{ saleId: orderId, kind: 'payment', day: '2026-11-09', amount: 50000 }]);
		expect((await s.report('cash', '2026-11-06')).events).toEqual([{ saleId: orderId, kind: 'refund', day: '2026-11-06', amount: 20000 }]);
	});

	it('files an order under the villa of the stay it charged when that stay has its own open order', async () => {
		const s = await setup();
		const bookingId = await s.booking({ source: 'admin' });
		// The empty order made with the booking stays the booking's own, so the order that charges it gets no bookingId.
		await s.t.run(ctx => insertFixture(ctx, 'orders', { status: 'draft', bookingId, currency: 'THB', itemCount: 0, total: 0, due: 0, hasItems: false, revision: 1, createdBy: email, createdAt: now, updatedAt: now }));
		const { orderId } = await s.admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: s.serviceId } });
		await s.admin.mutation(api.pos.attach, { orderId, bookingId });
		await s.payOrder(orderId);
		expect((await s.t.run(ctx => ctx.db.get(orderId)))!.bookingId).toBeUndefined();
		expect((await s.report()).sales.find(sale => sale.id === orderId)).toMatchObject({ kind: 'order', collected: 50000, propertyId: s.propertyId });
	});

	it('counts a desk payment for an appointment that belongs to a stay', async () => {
		const s = await setup();
		const bookingId = await s.booking({ source: 'admin' });
		const appointmentId = await s.appointment();
		await s.t.run(ctx => ctx.db.patch(appointmentId, { bookingId }));
		await s.admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId, expectedRevision: 0, method: 'cash', idempotencyKey: 'desk-stay-appt' });
		const cash = await s.report('cash');
		expect(cash.sales).toMatchObject([{ id: appointmentId, kind: 'appointment', channel: 'desk', collected: 50000, propertyId: s.propertyId }]);
		expect(cash.events).toMatchObject([{ saleId: appointmentId, kind: 'payment', amount: 50000 }]);
	});

	it('returns a marked partial report when any document/range/byte budget runs out', async () => {
		const s = await setup();
		await s.booking({ paymentStatus: 'paid', paidAt: now });
		for (const budget of [new ReadBudget(0), new ReadBudget(16000, 0), new ReadBudget(16000, 2000, 0)]) {
			expect(await s.t.run(ctx => readMarketingReport(ctx, { from: '2026-11-09', to: '2026-11-09', basis: 'cohort' }, budget))).toMatchObject({ truncated: true });
		}
		expect((await s.report()).truncated).toBe(false);
	});
});

describe('spend and diagnostic rollups', () => {
	it('validates spend, preserves creation time, audits CRUD and reports only live overlapping entries', async () => {
		const s = await setup();
		const draft = { campaignId: s.campaignId, amount: 100000, from: '2026-11-01', to: '2026-11-10', note: 'Launch' };
		await expect(s.admin.mutation(api.marketingReport.saveSpend, { ...draft, amount: 1.5 })).rejects.toThrow('positive amount');
		await expect(s.t.mutation(api.marketingReport.saveSpend, draft)).rejects.toThrow('authenticated');
		const id = await s.admin.mutation(api.marketingReport.saveSpend, draft);
		vi.setSystemTime(now + 1000);
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, id, amount: 200000 });
		expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ createdAt: now, updatedAt: now + 1000 });
		const deleted = await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, note: 'Delete' });
		await s.admin.mutation(api.marketingReport.deleteSpend, { id: deleted });
		await s.admin.mutation(api.marketingReport.deleteSpend, { id: deleted });
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, from: '2026-11-10', to: '2026-11-11' });
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, from: '2026-10-01', to: '2026-11-08' });
		expect((await s.report()).spend).toEqual([{ id, ...draft, amount: 200000 }]);
		expect(await s.admin.query(api.marketingReport.listSpend, { campaignId: s.campaignId })).toHaveLength(3);
		const history = await s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'marketingSpend').eq('entityId', id)).take(10));
		expect(history.map(r => r.kind)).toEqual(['created', 'updated']);
		expect(history[1]).toMatchObject({ before: { amount: 100000, from: draft.from, to: draft.to, note: 'Launch' }, after: { amount: 200000, from: draft.from, to: draft.to, note: 'Launch' } });
		const deletion = await s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'marketingSpend').eq('entityId', deleted)).take(10));
		expect(deletion.map(r => r.kind)).toEqual(['created', 'deleted']);
		await expect(s.admin.mutation(api.marketingReport.saveSpend, { ...draft, id: deleted })).rejects.toThrow('not found');
		// Moving an entry to another campaign shows in its history.
		const other = await s.admin.mutation(api.marketing.saveCampaign, { name: 'December', source: 'facebook', medium: 'social' });
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, id, amount: 200000, campaignId: other });
		const moved = await s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'marketingSpend').eq('entityId', id)).take(10));
		expect(moved[2]).toMatchObject({ kind: 'updated', before: { campaign: 'November' }, after: { campaign: 'December' } });
		await s.t.run(ctx => ctx.db.delete(s.campaignId));
		await expect(s.admin.mutation(api.marketingReport.saveSpend, draft)).rejects.toThrow('Campaign not found');
	});

	it('normalizes refusals, counts problems/surfaces, drops unauthorised/rate-limited calls and stores no unknown text', async () => {
		const s = await setup();
		const note = { code: ' spa100 ', problem: 'sold_out' as const, surface: 'booking' as const };
		await s.t.mutation(api.marketingReport.noteCouponRefusal, note);
		await s.t.mutation(api.marketingReport.noteCouponRefusal, note);
		await s.t.mutation(api.marketingReport.noteCouponRefusal, { ...note, surface: 'pos' });
		await s.t.withIdentity({ email: 'guest@example.com' }).mutation(api.marketingReport.noteCouponRefusal, { ...note, surface: 'admin_booking' });
		await s.admin.mutation(api.marketingReport.noteCouponRefusal, { ...note, surface: 'admin_booking', problem: 'expired' });
		await s.admin.mutation(api.marketingReport.noteCouponRefusal, { ...note, surface: 'pos' });
		await s.t.mutation(api.marketingReport.noteCouponRefusal, { ...note, code: 'private unknown text' });
		await s.t.mutation(api.marketingReport.noteCouponRefusal, { ...note, problem: 'coupon_worse' });
		const summary = await s.admin.query(api.marketingReport.couponRefusals, { couponId: s.couponId });
		expect(summary).toMatchObject({ since: '2026-10-11', total: 4, byProblem: expect.arrayContaining([{ problem: 'sold_out', count: 3 }, { problem: 'expired', count: 1 }, { problem: 'coupon_worse', count: 1 }]), bySurface: expect.arrayContaining([{ surface: 'booking', count: 2 }, { surface: 'admin_booking', count: 1 }, { surface: 'pos', count: 1 }]) });
		const unknown = await s.t.run(ctx => ctx.db.query('couponRefusalDays').withIndex('by_couponId_and_day', q => q.eq('couponId', undefined)).take(10));
		expect(unknown).toMatchObject([{ problem: 'not_found', count: 1 }]);
		expect(JSON.stringify(unknown)).not.toContain('private');
		await s.t.run(async ctx => { const limit = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', 'coupon-refusal:global')).unique(); await ctx.db.patch(limit!._id, { count: 5000 }); });
		await s.t.mutation(api.marketingReport.noteCouponRefusal, note);
		expect(await s.admin.query(api.marketingReport.couponRefusals, { couponId: s.couponId })).toEqual(summary);
		// Public traffic can't use up the staff surfaces' limit.
		await s.admin.mutation(api.marketingReport.noteCouponRefusal, { ...note, surface: 'pos' });
		expect((await s.admin.query(api.marketingReport.couponRefusals, { couponId: s.couponId } )).total).toBe(5);
		// A scanned link without an offer keeps its reason, without a coupon.
		await s.admin.mutation(api.marketingReport.noteCouponRefusal, { code: 'old-card', problem: 'link_without_offer', surface: 'pos' });
		const linkRows = await s.t.run(ctx => ctx.db.query('couponRefusalDays').withIndex('by_couponId_and_day', q => q.eq('couponId', undefined)).take(10));
		expect(linkRows).toEqual(expect.arrayContaining([expect.objectContaining({ problem: 'link_without_offer', surface: 'pos', count: 1 })]));
		await expect(s.admin.query(api.marketingReport.couponRefusals, { couponId: s.couponId, days: 91 })).rejects.toThrow('90 days');
		await expect(s.t.query(api.marketingReport.couponRefusals, { couponId: s.couponId })).rejects.toThrow('authenticated');
		vi.setSystemTime(now + day);
		expect((await s.admin.query(api.marketingReport.couponRefusals, { couponId: s.couponId, days: 1 })).total).toBe(0);
	});

	it('rolls sessions up by Bangkok day/link and inserts/counts nothing when rate-limited', async () => {
		const s = await setup();
		const visitorKey = 'mv_' + '1'.repeat(32);
		vi.setSystemTime(Date.parse('2026-11-08T16:59:59Z'));
		await s.t.mutation(api.marketing.startSession, { visitorKey, slug: 'spa', landingPath: '/' });
		vi.setSystemTime(Date.parse('2026-11-08T17:00:00Z'));
		for (let i = 0; i < 29; i++) await s.t.mutation(api.marketing.startSession, { visitorKey, slug: 'spa', landingPath: '/' });
		expect((await s.t.mutation(api.marketing.startSession, { visitorKey, landingPath: '/' })).sessionId).toBeNull();
		// A visitor over their own limit doesn't use up the allowance everyone shares.
		expect((await s.t.run(ctx => ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', 'marketing-session:global')).unique()))!.count).toBe(30);
		const rollups = await s.t.run(ctx => ctx.db.query('marketingSessionDays').take(10));
		expect(rollups).toMatchObject([{ day: '2026-11-08', linkId: s.linkId, campaignId: s.campaignId, count: 1 }, { day: '2026-11-09', linkId: s.linkId, count: 29 }]);
		expect(await s.t.run(ctx => ctx.db.query('marketingSessions').take(100))).toHaveLength(30);
		await s.t.mutation(api.marketing.startSession, { landingPath: '/' });
		expect((await s.report()).sessions).toEqual(expect.arrayContaining([{ day: '2026-11-09', linkId: s.linkId, campaignId: s.campaignId, count: 29 }, { day: '2026-11-09', count: 1 }]));
		const before = await s.t.run(ctx => ctx.db.query('marketingSessionDays').take(10));
		await s.t.run(async ctx => { const limit = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', 'marketing-session:global')).unique(); await ctx.db.patch(limit!._id, { count: 5000 }); });
		expect((await s.t.mutation(api.marketing.startSession, { slug: 'spa', landingPath: '/' })).sessionId).toBeNull();
		expect(await s.t.run(ctx => ctx.db.query('marketingSessionDays').take(10))).toEqual(before);
		expect(await s.t.run(ctx => ctx.db.query('marketingSessions').take(100))).toHaveLength(31);
	});

	it('keeps a moved link\'s earlier sessions under the campaign it had then', async () => {
		const s = await setup();
		await s.t.mutation(api.marketing.startSession, { slug: 'spa', landingPath: '/' });
		const other = await s.admin.mutation(api.marketing.saveCampaign, { name: 'December', source: 'facebook', medium: 'social' });
		await s.t.run(ctx => ctx.db.patch(s.linkId, { campaignId: other }));
		for (let i = 0; i < 2; i++) await s.t.mutation(api.marketing.startSession, { slug: 'spa', landingPath: '/' });
		expect((await s.report()).sessions.map(row => [row.campaignId, row.count]).sort()).toEqual([[s.campaignId, 1], [other, 2]].sort());
	});
});


describe('coupon-only Finance settlements (exported API)', () => {
	async function checkout(mixed = false) {
		const s = await setup(50000);
		const bookingId = mixed ? await s.booking({ total: 200000, subtotal: 200000 }) : undefined;
		const { orderId } = bookingId
			? await s.admin.mutation(api.pos.openOrderFor, { bookingId })
			: await s.admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: s.serviceId } });
		if (bookingId) await s.admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId: s.serviceId } });
		await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, code: 'SPA100' });
		await s.payOrder(orderId);
		return { ...s, orderId, bookingId };
	}

	it.each([false, true])('includes fully covered service without fake cash (mixed stay: %s)', async mixed => {
		const s = await checkout(mixed);
		const cash = await s.report('cash');
		expect(cash.sales.find(sale => sale.id === s.orderId)).toMatchObject({ collected: 0, discount: 50000, settlementDay: '2026-11-09' });
		expect(cash.sales.find(sale => sale.id === s.orderId)?.paidDay).toBeUndefined();
		expect(cash.events.filter(e => e.saleId === s.orderId)).toEqual([]);
		expect(cash.events.reduce((sum, e) => sum + e.amount, 0)).toBe(mixed ? 200000 : 0);
		expect(cash.sales.filter(sale => sale.id === s.orderId)).toHaveLength(1);
		expect((await s.report()).sales.find(sale => sale.id === s.orderId)).toMatchObject({ paid: true, collected: 0, discount: 50000 });
	});

	it.each([false, true])('moves coupon settlement with its corrected date and deduplicates scans (mixed: %s)', async mixed => {
		const s = await checkout(mixed);
		await s.admin.mutation(api.pos.amendOrderPayment, { orderId: s.orderId, expectedCorrectionRevision: 0, idempotencyKey: 'coupon-date-001', reason: 'Yesterday', effectiveAt: now - day });
		expect((await s.report('cash')).sales).toEqual([]);
		const corrected = await s.report('cash', '2026-11-08');
		expect(corrected.sales.find(sale => sale.id === s.orderId)).toMatchObject({ discount: 50000, settlementDay: '2026-11-08' });
		expect(corrected.events).toEqual(mixed ? [{ saleId: s.bookingId, kind: 'payment', day: '2026-11-08', amount: 200000 }] : []);
		expect((await s.report('cash', '2026-11-08', '2026-11-09')).sales).toHaveLength(mixed ? 2 : 1);
	});

	it.each([true, false])('retains consumed coupon for real void, releases unreceived void (%s)', async unreceived => {
		const s = await checkout();
		if (unreceived) await s.admin.mutation(api.pos.voidUnreceivedOrder, { orderId: s.orderId, expectedCorrectionRevision: 0, idempotencyKey: 'coupon-void-001', reason: 'No money' });
		else await s.admin.mutation(api.pos.voidOrder, { orderId: s.orderId, reason: 'Real void' });
		const cash = await s.report('cash');
		expect(cash.sales).toHaveLength(unreceived ? 0 : 1);
		expect(cash.sales.reduce((sum, sale) => sum + sale.discount, 0)).toBe(unreceived ? 0 : 50000);
		const coupon = (await s.t.run(ctx => ctx.db.get(s.couponId)))!;
		expect(coupon.discountGranted).toBe(unreceived ? 0 : 50000);
		expect(coupon.used).toBe(unreceived ? 0 : 1);
	});

	it('keeps positive checkout and partially paid stay first-payment dates', async () => {
		const s = await setup();
		const { orderId } = await s.admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: s.serviceId } });
		await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, code: 'SPA100' });
		await s.payOrder(orderId);
		const bookingId = await s.booking({ total: 200000, subtotal: 200000, amountPaid: 30000, paymentStatus: 'pending' });
		await s.payment(bookingId, 30000);
		const cash = await s.report('cash');
		expect(cash.sales.find(sale => sale.id === orderId)).toMatchObject({ paidDay: '2026-11-09', collected: 40000, discount: 10000 });
		expect(cash.sales.find(sale => sale.id === bookingId)).toMatchObject({ paidDay: '2026-11-09', collected: 30000 });
		expect(cash.events.map(e => e.amount).sort((a, b) => a - b)).toEqual([30000, 40000]);
	});
});


it('retains consumed coupon discount after a real service refund', async () => {
	const s = await setup();
	const appointmentId = await s.appointment();
	const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId });
	await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, code: 'SPA100' });
	await s.payOrder(orderId);
	await s.admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: 1, amount: 20000, currency: 'THB', method: 'cash', reason: 'Courtesy', orderId: orderId, idempotencyKey: 'coupon-refund-001' });
	const cash = await s.report('cash');
	expect(cash.sales).toMatchObject([{ id: orderId, collected: 40000, refunded: 20000, discount: 10000, paidDay: '2026-11-09' }]);
	expect(await s.t.run(ctx => ctx.db.get(s.couponId))).toMatchObject({ used: 1, discountGranted: 10000 });
});

it('reports zero coupon discount for a custom-price stay without changing coupon history or counters', async () => {
	const s = await setup();
	const { couponId } = await s.admin.mutation(api.marketing.saveCoupon, { campaignId: s.campaignId, code: 'VILLA100', benefit: { kind: 'fixed', amount: 10000 }, scope: 'accommodation' });
	await s.admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
	const { bookingId } = await s.t.mutation(api.bookings.bookings.create, { propertySlug: 'villa', guestName: 'Custom guest', guestEmail: 'guest@example.com', guestPhone: '+66811112222', checkIn: '2026-11-15', checkOut: '2026-11-16', guests: 2, couponCode: 'VILLA100' });
	await s.t.mutation(internal.bookings.bookings.markPaidFromTrustedWebhook, { bookingId });
	const before = await s.t.run(async ctx => ({ booking: await ctx.db.get(bookingId), coupon: await ctx.db.get(couponId), redemption: await ctx.db.query('couponRedemptions').withIndex('by_couponId_and_createdAt', q => q.eq('couponId', couponId)).unique() }));
	await s.admin.mutation(api.bookings.commands.editBooking.editBooking, { bookingId, propertyId: s.propertyId, expectedRevision: before.booking!.revision ?? 0, checkIn: '2026-11-15', checkOut: '2026-11-16', guests: 2, guestName: 'Custom guest', guestPhone: '+66811112222', guestEmail: 'guest@example.com', priceOverride: { total: 75000, reason: 'Agreed price' }, notifyGuest: false });
	for (const basis of ['cash', 'cohort'] as const) expect((await s.report(basis)).sales).toMatchObject([{ id: bookingId, customPrice: true, discount: 0, coupon: { couponId, code: 'VILLA100' } }]);
	const after = await s.t.run(async ctx => ({ booking: await ctx.db.get(bookingId), coupon: await ctx.db.get(couponId), redemption: await ctx.db.get(before.redemption!._id) }));
	expect(after.booking!.promotion).toEqual(before.booking!.promotion);
	expect(after.coupon).toEqual(before.coupon);
	expect(after.redemption).toEqual(before.redemption);
});

it.each(['viewer', 'marketer', 'finance', 'manager', 'admin'] as const)('redacts personal fields server-side for %s across report, affiliate credits and coupon detail', async role => {
	const s = await setup();
	const fullDetail = role === 'finance' || role === 'manager' || role === 'admin';
	const affiliateId = await s.admin.mutation(api.marketingAffiliates.saveAffiliate, { name: 'Partner', slug: 'partner', campaignId: s.campaignId, contactEmail: 'private-partner@example.com', notes: 'Private partner note' });
	await s.admin.mutation(api.marketingAffiliates.setAffiliateStatus, { affiliateId, status: 'active' });
	const { couponId } = await s.admin.mutation(api.marketing.saveCoupon, { campaignId: s.campaignId, code: 'BOTH100', benefit: { kind: 'fixed', amount: 10000 }, scope: 'accommodation_and_services' });
	await s.admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
	await s.admin.mutation(api.marketingAffiliates.assignCoupon, { affiliateId, couponId });
	const { bookingId } = await s.t.mutation(api.bookings.bookings.create, { propertySlug: 'villa', guestName: 'Private Guest', guestEmail: 'private@example.com', guestPhone: '+66811112222', checkIn: '2026-11-15', checkOut: '2026-11-16', guests: 2, couponCode: 'BOTH100' });
	await s.t.mutation(internal.bookings.bookings.markPaidFromTrustedWebhook, { bookingId });
	await s.t.run(ctx => ctx.db.patch(bookingId, { confirmationCode: 'PRIVATE-CONF' }));
	const { orderId } = await s.admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId: s.serviceId } });
	await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, code: 'BOTH100' });
	await s.payOrder(orderId);
	await s.t.run(ctx => ctx.db.patch(orderId, { customerSnapshot: { name: 'Private Customer' } }));
	const appointmentId = await s.appointment();
	await s.admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId, expectedRevision: 0, method: 'cash', idempotencyKey: 'privacy-desk' });
	const reader = role === 'admin' ? s.admin : s.t.withIdentity({ email: 'reader@example.com', tokenIdentifier: 'reader' });
	if (role !== 'admin') await s.t.run(ctx => ctx.db.insert('marketingGrants', { email: 'reader@example.com', tokenIdentifier: 'reader', role, createdAt: now, updatedAt: now, updatedByEmail: email }));
	const data = await reader.query(api.marketingReport.getReport, { from: '2026-11-09', to: '2026-11-09', basis: 'cohort' });
	expect(data.sales.find(row => row.id === bookingId)).toMatchObject({ label: fullDetail ? 'Private Guest' : 'Guest' });
	expect(data.sales.find(row => row.id === bookingId)?.ref).toBe(fullDetail ? 'PRIVATE-CONF' : undefined);
	expect(data.sales.find(row => row.id === orderId)?.label).toBe(fullDetail ? 'Private Customer' : 'Guest');
	expect(data.sales.find(row => row.id === appointmentId)?.label).toBe(fullDetail ? 'Desk guest' : 'Guest');
	const credits = await reader.query(api.marketingAffiliates.listCredits, {});
	expect(credits.rows).toHaveLength(2);
	for (const credit of credits.rows) {
		const isStay = credit.bookingId === bookingId;
		expect(credit.label).toBe(fullDetail ? isStay ? 'Private Guest' : 'Private Customer' : 'Guest');
		if (isStay) expect(credit.ref).toBe(fullDetail ? 'PRIVATE-CONF' : 'Booking');
		expect(credit.candidates[0].contactEmail).toBe(fullDetail ? 'private-partner@example.com' : undefined);
		expect(credit.snapshot.candidates[0].contactEmail).toBe(fullDetail ? 'private-partner@example.com' : undefined);
		await s.admin.mutation(api.marketingAffiliates.reviewCredit, { creditId: credit._id, expectedRevision: credit.revision, decision: 'rejected', reason: 'Private finance reason' });
		const detail = await reader.query(api.marketingAffiliates.getCredit, { creditId: credit._id });
		expect(detail!.credit.reason).toBe(fullDetail ? 'Private finance reason' : null);
		expect(detail!.credit.reasonHidden ?? false).toBe(!fullDetail);
		expect(detail!.history[0].reason).toBe(fullDetail ? 'Private finance reason' : null);
		expect(detail!.history[0].reasonHidden ?? false).toBe(!fullDetail);
		expect((await reader.query(api.marketingAffiliates.listCredits, {})).rows.find(row => row._id === credit._id)!.reason).toBe(fullDetail ? 'Private finance reason' : null);
	}
	await s.admin.mutation(api.marketingAffiliates.saveAffiliate, { id: affiliateId, name: 'Partner', slug: 'partner', campaignId: s.campaignId, contactEmail: 'new-private@example.com', notes: 'New private note' });
	for (const entityId of [undefined, affiliateId]) {
		const history = await reader.query(api.recordHistory.list, { entityType: 'marketingAffiliate', ...(entityId ? { entityId } : {}), paginationOpts: { numItems: 100, cursor: null } });
		const serialized = JSON.stringify(history);
		for (const value of ['private-partner@example.com', 'new-private@example.com', 'Private partner note', 'New private note']) {
			if (fullDetail) expect(serialized).toContain(value);
			else expect(serialized).not.toContain(value);
		}
	}
	const partners = await reader.query(api.marketingAffiliates.listAffiliates, {});
	expect(partners.rows[0].contactEmail).toBe(fullDetail ? 'new-private@example.com' : undefined);
	const coupon = await reader.query(api.marketing.getCoupon, { couponId });
	const booking = coupon!.redemptions.find(row => row.bookingId === bookingId)!.booking!;
	expect(booking.guestName).toBe(fullDetail ? 'Private Guest' : 'Guest');
	expect(booking.confirmationCode).toBe(fullDetail ? 'PRIVATE-CONF' : undefined);
	expect(coupon!.redemptions.find(row => row.orderId === orderId)!.order!.customerName).toBe(fullDetail ? 'Private Customer' : 'Guest');
	if (!fullDetail) {
		const responses = JSON.stringify([data, credits, coupon, partners]);
		for (const secret of ['Private Guest', 'PRIVATE-CONF', 'Private Customer', 'private-partner@example.com', 'Desk guest']) expect(responses).not.toContain(secret);
	}
	// Redaction is a read boundary: admin still sees persisted history unchanged after these reads.
	expect((await s.admin.query(api.marketingAffiliates.listCredits, {})).rows[0].snapshot.candidates[0].contactEmail).toBe('private-partner@example.com');
});


it('exposes only the verified session cohort needed for conversion, without visitor identity', async () => {
	const s = await setup();
	const sessionId = await s.t.run(async ctx => {
		await ctx.db.insert('marketingSessionDays', { day: '2026-11-09', linkId: s.linkId, campaignId: s.campaignId, count: 1 });
		return ctx.db.insert('marketingSessions', { visitorKey: 'private-visitor-key', linkId: s.linkId, campaignId: s.campaignId, startedAt: now, landingPath: '/' });
	});
	const last = { linkId: s.linkId, campaignId: s.campaignId, slug: 'spa', campaignName: 'November', source: 'print', medium: 'qr', entry: 'qr' as const };
	for (let i = 0; i < 2; i++) await s.booking({ paymentStatus: 'paid', paidAt: now, marketingAttribution: { model: 'last_touch_30d@1', evidence: 'tracked', sessionId, last, first: last, capturedAt: now } });
	const report = await s.report();
	expect(report.sales).toHaveLength(2);
	for (const sale of report.sales) expect(sale.session).toEqual({ id: sessionId, day: '2026-11-09', linkId: s.linkId, campaignId: s.campaignId });
	expect(JSON.stringify(report)).not.toContain('private-visitor-key');
});

it('keeps session-cohort conversion after the raw session is deleted, using the cohort frozen on the booking', async () => {
	const s = await setup();
	const sessionId = await s.t.run(async ctx => {
		await ctx.db.insert('marketingSessionDays', { day: '2026-11-09', linkId: s.linkId, campaignId: s.campaignId, count: 1 });
		return ctx.db.insert('marketingSessions', { visitorKey: 'private-visitor-key', linkId: s.linkId, campaignId: s.campaignId, startedAt: now, landingPath: '/' });
	});
	const last = { linkId: s.linkId, campaignId: s.campaignId, slug: 'spa', campaignName: 'November', source: 'print', medium: 'qr', entry: 'qr' as const };
	await s.booking({ paymentStatus: 'paid', paidAt: now, marketingAttribution: { model: 'last_touch_30d@1', evidence: 'tracked', sessionId, session: { startedAt: now, linkId: s.linkId, campaignId: s.campaignId }, last, first: last, capturedAt: now } });
	await s.t.run(ctx => ctx.db.delete(sessionId));
	const report = await s.report();
	expect(report.sales[0].session).toEqual({ id: sessionId, day: '2026-11-09', linkId: s.linkId, campaignId: s.campaignId });
});


it.each(['cohort', 'cash'] as const)('skips financial reads for checkout payment changes (%s)', async basis => {
	const s = await setup();
	const count = 8;
	const changeIds: Id<'appointmentChanges'>[] = [];
	for (let i = 0; i < count; i++) {
		const appointmentId = await s.appointment(now - (i + 1) * day);
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId });
		await s.payOrder(orderId, now - day);
		const changes = await s.t.run(ctx => ctx.db.query('appointmentChanges').withIndex('by_appointmentId_and_at', q => q.eq('appointmentId', appointmentId)).collect());
		const change = changes.find(c => c.kind === 'payment')!;
		changeIds.push(change._id);
		await s.t.run(ctx => ctx.db.patch(change._id, { at: now - day }));
	}
	const args = { from: '2026-11-09', to: '2026-11-09', basis };
	const before = new ReadBudget();
	await s.t.run(ctx => readMarketingReport(ctx, args, before));
	for (const id of changeIds) await s.t.run(ctx => ctx.db.patch(id, { at: now }));
	const after = new ReadBudget();
	const report = await s.t.run(ctx => readMarketingReport(ctx, args, after));
	expect(report.truncated).toBe(false);
	expect(report.sales).toEqual([]);
	// Checkout changes no longer trigger appointment evidence scans: ledger rows own report money.
	expect(after.ranges - before.ranges).toBe(0);
	expect(after.documents - before.documents).toBe(0);
});

it.each([false, true])('exposes a direct-only web session, frozen=%s', async frozen => {
	const s = await setup();
	const sessionId = await s.t.run(async ctx => {
		await ctx.db.insert('marketingSessionDays', { day: '2026-11-09', count: 1 });
		return ctx.db.insert('marketingSessions', { visitorKey: 'private-direct-visitor', startedAt: now, landingPath: '/' });
	});
	const chatSessionId = await s.t.run(ctx => ctx.db.insert('conversations', { channel: 'web', createdAt: now }));
	for (const chat of [false, true]) await s.booking({ paymentStatus: 'paid', paidAt: now, ...(chat ? { chatSessionId } : {}), marketingAttribution: { model: 'last_touch_30d@1', evidence: 'tracked', sessionId, ...(frozen ? { session: { startedAt: now } } : {}), capturedAt: now } });
	if (frozen) await s.t.run(ctx => ctx.db.delete(sessionId));
	const report = await s.report();
	expect(report.sales).toHaveLength(2);
	for (const sale of report.sales) expect(sale).toMatchObject({ bucket: 'unknown', session: { id: sessionId, day: '2026-11-09' } });
	expect(JSON.stringify(report)).not.toContain('private-direct-visitor');
});

it.each(['cohort', 'cash'] as const)('reports prior-day converted sessions independently of %s money dates', async basis => {
	const s = await setup();
	for (const frozen of [false, true]) for (const direct of [false, true]) {
		const campaign = direct ? {} : { linkId: s.linkId, campaignId: s.campaignId };
		const sessionId = await s.t.run(ctx => ctx.db.insert('marketingSessions', { visitorKey: `private-${frozen}-${direct}`, startedAt: now - day, landingPath: '/', ...campaign }));
		const attribution = { model: 'last_touch_30d@1' as const, evidence: 'tracked' as const, sessionId, ...(frozen ? { session: { startedAt: now - day, ...campaign } } : {}), capturedAt: now };
		for (let i = 0; i < 2; i++) {
			const bookingId = await s.booking({ source: 'web', paymentStatus: 'paid', amountPaid: 100000, paidAt: now, marketingAttribution: attribution });
			await s.payment(bookingId, 100000);
		}
		if (frozen) await s.t.run(ctx => ctx.db.delete(sessionId));
		const report = await s.report(basis, '2026-11-08');
		expect(report.convertedSessions).toContainEqual({ id: sessionId, day: '2026-11-08', ...campaign });
		expect(report.sales).toEqual([]);
		expect(report.events).toEqual([]);
		expect(JSON.stringify(report)).not.toContain('private-');
	}
	const report = await s.report(basis, '2026-11-08');
	expect(report.convertedSessions).toHaveLength(4);
	expect((await s.report(basis)).convertedSessions).toEqual([]);
});

it('clips conversion cohorts to the Bangkok range and requires real payment evidence', async () => {
	const s = await setup();
	const cohorts = [];
	for (const offset of [-day, 0, day]) {
		const startedAt = Date.parse('2026-11-08T17:00:00Z') + offset;
		const sessionId = await s.t.run(ctx => ctx.db.insert('marketingSessions', { visitorKey: `range-${offset}`, startedAt, landingPath: '/' }));
		const marketingAttribution = { model: 'last_touch_30d@1' as const, evidence: 'tracked' as const, sessionId, session: { startedAt }, capturedAt: now };
		cohorts.push({ sessionId, marketingAttribution });
		const bookingId = await s.booking({ amountPaid: 100000, paymentStatus: 'paid', paidAt: now, marketingAttribution });
		await s.payment(bookingId, 100000);
	}
	const unpaidSession = await s.t.run(ctx => ctx.db.insert('marketingSessions', { visitorKey: 'unpaid-visit', startedAt: now, landingPath: '/' }));
	const unpaid = await s.booking({ amountPaid: 0, marketingAttribution: { ...cohorts[1].marketingAttribution, sessionId: unpaidSession } });
	await s.payment(unpaid, 100000, now, 'cancelled');
	const zeroSession = await s.t.run(ctx => ctx.db.insert('marketingSessions', { visitorKey: 'zero-cash', startedAt: now, landingPath: '/' }));
	await s.booking({ total: 0, paymentStatus: 'paid', marketingAttribution: { ...cohorts[1].marketingAttribution, sessionId: zeroSession } });
	for (const basis of ['cohort', 'cash'] as const) expect((await s.report(basis)).convertedSessions).toEqual([{ id: cohorts[1].sessionId, day: '2026-11-09' }]);
});

it('does not spend a booking lookup on every non-converting raw visit', async () => {
	const s = await setup();
	await s.t.run(async ctx => {
		await ctx.db.insert('marketingSessionDays', { day: '2026-11-09', count: 2500 });
		for (let i = 0; i < 2500; i++) await ctx.db.insert('marketingSessions', { visitorKey: `no-booking-${i}`, startedAt: now, landingPath: '/' });
	});
	const report = await s.t.run(ctx => readMarketingReport(ctx, { from: '2026-11-09', to: '2026-11-09', basis: 'cohort' }, new ReadBudget(16_000, 100)));
	expect(report).toMatchObject({ convertedSessions: [], sales: [], truncated: false });
});
