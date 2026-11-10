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

async function setup() {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email, tokenIdentifier: 'admin' });
	const propertyId = await t.run(ctx => ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 1000, currency: 'THB', maxGuests: 4, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' }));
	const campaignId = await admin.mutation(api.marketing.saveCampaign, { name: 'November', source: 'print', medium: 'qr' });
	const { couponId } = await admin.mutation(api.marketing.saveCoupon, { campaignId, code: 'SPA100', benefit: { kind: 'fixed', amount: 100 }, scope: 'services' });
	await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
	const linkId = await admin.mutation(api.marketing.saveLink, { campaignId, couponId, slug: 'spa', name: 'Spa card', destination: { kind: 'home' }, entry: 'qr' });
	await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
	const booking = (patch: Partial<Doc<'bookings'>> = {}) => t.run(ctx => ctx.db.insert('bookings', { propertyId, guestName: 'Guest', guestPhone: '+66811112222', checkIn: '2026-11-15', checkOut: '2026-11-16', guests: 2, nights: 1, subtotal: 1000, discountAmount: 0, total: 1000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: now, ...patch }));
	const order = async (orderId: Id<'bills'>) => (await admin.query(api.pos.getOrder, { orderId }))!;
	const report = (basis: 'cohort' | 'cash' = 'cohort', from = '2026-11-09', to = from) => admin.query(api.marketingReport.getReport, { from, to, basis });
	const payOrder = async (orderId: Id<'bills'>, effectiveAt = now) => {
		const view = await order(orderId);
		const args = { orderId, expectedRevision: view.order.revision, expectedDue: view.totals.due, idempotencyKey: `settle-${orderId}`, tenders: [{ method: 'cash' as const, amount: view.totals.due }], effectiveAt };
		await admin.mutation(api.pos.settleOrder, args);
		return () => admin.mutation(api.pos.settleOrder, args);
	};
	const payment = (bookingId: Id<'bookings'>, amount: number, effectiveAt = now, status: 'recorded' | 'cancelled' = 'recorded') => t.run(ctx => ctx.db.insert('bookingPayments', { bookingId, origin: 'manual', method: 'cash', currency: 'THB', amount, effectiveAt, recordedAt: now, recordedBy: email, status, refunded: 0 }));
	const staffId = await admin.mutation(api.adminServices.createStaff, { name: 'Mali', role: 'Therapist', color: '#abc', workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] });
	const serviceId = await admin.mutation(api.adminServices.createService, { slug: 'spa', name: 'Spa', description: '', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 500, currency: 'THB', staffIds: [staffId] });
	const appointment = () => admin.mutation(api.adminServices.createAppointment, { serviceId, staffId, start: now - day, guestName: 'Desk guest', guestPhone: '' }).then(r => r.appointmentId);
	/** An order paid before stay payments were itemised: ฿1,000 for the stay and ฿50 of water, with no bookingPayments row. */
	const oldOrder = (bookingId: Id<'bookings'>) => t.run(async ctx => {
		const id = await ctx.db.insert('bills', { status: 'paid', bookingId, currency: 'THB', itemCount: 2, total: 1050, due: 0, hasItems: true, revision: 1, paidAt: now, paymentEffectiveAt: now, createdBy: email, createdAt: now, updatedAt: now });
		await ctx.db.insert('billLines', { billId: id, kind: 'booking', bookingId, name: 'Stay', unitPrice: 1000, currency: 'THB', qty: 1, createdAt: now });
		await ctx.db.insert('billLines', { billId: id, kind: 'extra', name: 'Water', unitPrice: 50, currency: 'THB', qty: 1, createdAt: now });
		await ctx.db.insert('billPayments', { billId: id, method: 'cash', amount: 1050, idempotencyKey: `old-order-${bookingId}`, createdBy: email, createdAt: now, effectiveAt: now });
		return id;
	});
	return { t, admin, propertyId, campaignId, couponId, linkId, booking, order, report, payOrder, payment, serviceId, staffId, appointment, oldOrder };
}

describe('report money', () => {
	it('counts online payments, an extension and POS stay balance once, with scanned spa coupon and replay-safe refunds', async () => {
		const s = await setup();
		const bookingId = await s.booking({ source: 'web', accessToken: 'token' });
		async function online(sessionId: string, paymentIntentId: string, amount: number) {
			const { request } = await s.t.mutation(internal.payments.beginCheckout, { bookingId, accessToken: 'token', siteUrl: 'https://example.com' });
			if (!request) throw new Error('Expected a new checkout');
			await s.t.mutation(internal.payments.saveCheckoutSession, { bookingId, accessToken: 'token', sessionId, url: 'https://checkout.stripe.com/test', expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
			const args = { bookingId, sessionId, paymentIntentId, amountTotal: amount * 100, currency: 'thb' };
			await s.t.mutation(internal.payments.completeCheckout, args);
			return () => s.t.mutation(internal.payments.completeCheckout, args);
		}
		const replayFirst = await online('cs_first', 'pi_first', 1000);
		await s.t.run(ctx => ctx.db.patch(bookingId, { total: 2000, subtotal: 2000 }));
		const replaySecond = await online('cs_second', 'pi_second', 1000);
		await s.t.run(ctx => ctx.db.patch(bookingId, { total: 3000, subtotal: 3000 }));
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { bookingId });
		await s.admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId: s.serviceId } });
		await s.admin.mutation(api.pos.applyOrderCoupon, { orderId, slug: 'spa' });
		const replaySettle = await s.payOrder(orderId);
		const cohort = await s.report();
		expect(cohort.events).toEqual([]);
		expect(cohort.sales).toHaveLength(2);
		expect(cohort.sales.find(r => r.id === bookingId)).toMatchObject({ kind: 'stay', collected: 3000, refunded: 0, discount: 0, bucket: 'unknown' });
		expect(cohort.sales.find(r => r.id === orderId)).toMatchObject({ kind: 'order', collected: 400, discount: 100, bucket: 'tracked', evidence: 'scanned', last: { linkId: s.linkId }, propertyId: s.propertyId });
		expect(stayMoney((await s.t.run(ctx => ctx.db.get(bookingId)))!).gross).toBe(3000);
		const cash = await s.report('cash');
		expect(cash.events.filter(e => e.kind === 'payment').reduce((sum, e) => sum + e.amount, 0)).toBe(3400);
		expect(cash.events.filter(e => e.saleId === bookingId)).toHaveLength(3);
		expect(cohort.sales.reduce((sum, r) => sum + r.discount, 0)).toBe((await s.t.run(ctx => ctx.db.get(s.couponId)))!.discountGranted);
		await replayFirst(); await replaySecond(); await replaySettle();
		expect(await s.report('cash')).toEqual(cash);
		// A real returned stay payment remains on the stay even though its source is an order.
		await s.t.run(ctx => ctx.db.patch(bookingId, { total: 2800 }));
		const current = (await s.t.run(ctx => ctx.db.get(bookingId)))!;
		const refund = { bookingId, expectedRevision: current.revision ?? 0, amount: 200, currency: 'THB', method: 'cash' as const, billId: orderId, reason: 'Shorter stay', idempotencyKey: 'stay-pos-refund', effectiveAt: now };
		await s.admin.mutation(api.adminBookings.recordRefund, refund);
		const refunded = await s.report('cash');
		await s.admin.mutation(api.adminBookings.recordRefund, refund);
		expect(await s.report('cash')).toEqual(refunded);
		expect(refunded.events.filter(e => e.kind === 'refund')).toEqual([{ saleId: bookingId, kind: 'refund', day: '2026-11-09', amount: 200 }]);
		expect(refunded.sales.find(r => r.id === bookingId)?.refunded).toBe(200);
		expect(refunded.sales.find(r => r.id === orderId)?.refunded).toBe(0);
	});

	it('counts a consumed stay coupon once, omits its unpaid hold and retains an archived referenced coupon', async () => {
		const s = await setup();
		const { couponId } = await s.admin.mutation(api.marketing.saveCoupon, { campaignId: s.campaignId, code: 'VILLA100', benefit: { kind: 'fixed', amount: 100 }, scope: 'accommodation' });
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
		const { bookingId } = await s.t.mutation(api.bookings.create, { propertySlug: 'villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66811112222', checkIn: '2026-11-15', checkOut: '2026-11-16', guests: 2, couponCode: 'VILLA100' });
		expect((await s.report()).sales).toEqual([]);
		await s.t.mutation(internal.bookings.markPaidFromTrustedWebhook, { bookingId });
		await s.t.mutation(internal.bookings.markPaidFromTrustedWebhook, { bookingId });
		await s.admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'archived' });
		const report = await s.report();
		expect(report.sales).toMatchObject([{ id: bookingId, collected: 900, discount: 100, coupon: { couponId, code: 'VILLA100', campaignId: s.campaignId } }]);
		expect(report.sales.reduce((sum, r) => sum + r.discount, 0)).toBe((await s.t.run(ctx => ctx.db.get(couponId)))!.discountGranted);
		expect(report.coupons.find(c => c.id === couponId)?.status).toBe('archived');
	});

	it('moves the POS stay payment and own order cash to the corrected day, retaining stay cohort membership', async () => {
		const s = await setup();
		const bookingId = await s.booking({ source: 'admin' });
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { bookingId });
		await s.admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Water', price: 50 } });
		await s.payOrder(orderId);
		await s.admin.mutation(api.pos.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'correct-date-001', reason: 'Yesterday', effectiveAt: now - day, tenders: [{ method: 'transfer', amount: 1050 }] });
		expect((await s.report('cash')).events).toEqual([]);
		const moved = await s.report('cash', '2026-11-08');
		expect(moved.events.map(e => e.amount).sort((a, b) => a - b)).toEqual([50, 1000]);
		expect(moved.events.every(e => e.day === '2026-11-08')).toBe(true);
		expect((await s.report()).sales.find(r => r.id === bookingId)).toMatchObject({ createdDay: '2026-11-09', collected: 1000, bucket: 'staff' });
		const row = await s.t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_billId', q => q.eq('billId', orderId)).unique());
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
		await s.payment(cancelled, 1000, now, 'cancelled');
		expect((await s.report()).sales.map(r => r.id)).toEqual([bookingId]);
		expect((await s.report('cash')).events).toEqual([{ saleId: bookingId, kind: 'payment', day: '2026-11-09', amount: 1000 }]);
	});

	it('reports mixed legacy/itemised stay money and legacy full refunds honestly', async () => {
		const s = await setup();
		const bookingId = await s.booking({ amountPaid: 1500, paymentStatus: 'paid', paidAt: now - day });
		await s.payment(bookingId, 500);
		const refunded = await s.booking({ paymentStatus: 'refunded', paidAt: now - day, refundedAt: now });
		const cohort = await s.report();
		expect(cohort.sales.find(r => r.id === bookingId)).toMatchObject({ collected: 1500, paidDay: '2026-11-08' });
		expect(cohort.sales.find(r => r.id === refunded)).toMatchObject({ collected: 1000, refunded: 1000 });
		expect((await s.report('cash')).events).toEqual(expect.arrayContaining([{ saleId: bookingId, kind: 'payment', day: '2026-11-09', amount: 500 }, { saleId: refunded, kind: 'refund', day: '2026-11-09', amount: 1000 }]));
	});

	it('uses Bangkok boundaries for payments and includes cash sales created outside the cohort', async () => {
		const s = await setup();
		const bookingId = await s.booking({ createdAt: now - 10 * day, amountPaid: 1000 });
		await s.payment(bookingId, 400, Date.parse('2026-11-08T16:59:59Z'));
		await s.payment(bookingId, 600, Date.parse('2026-11-08T17:00:00Z'));
		expect((await s.report()).sales).toEqual([]);
		expect((await s.report('cash', '2026-11-08')).events.map(e => e.amount)).toEqual([400]);
		expect((await s.report('cash')).events.map(e => e.amount)).toEqual([600]);
	});

	it('counts desk appointment payments/refunds and routes receipt refunds exclusively to the order', async () => {
		const s = await setup();
		const appointmentId = await s.appointment();
		const paid = await s.admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId, expectedRevision: 0, method: 'cash', idempotencyKey: 'desk-payment-001' });
		await s.admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: 1, amount: 100, currency: 'THB', method: 'cash', reason: 'Courtesy', paymentId: paid.paymentId, idempotencyKey: 'desk-refund-001' });
		const second = await s.admin.mutation(api.adminServices.createAppointment, { serviceId: s.serviceId, staffId: s.staffId, start: now - 2 * day, guestName: 'POS guest', guestPhone: '' });
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId: second.appointmentId });
		await s.payOrder(orderId, now - day);
		const args = { appointmentId: second.appointmentId, expectedRevision: 1, amount: 200, currency: 'THB', method: 'cash' as const, reason: 'Courtesy', billId: orderId, idempotencyKey: 'receipt-refund-001' };
		await s.admin.mutation(api.adminServices.refundAppointment, args);
		await s.admin.mutation(api.adminServices.refundAppointment, args);
		const report = await s.report('cash');
		expect(report.sales).toHaveLength(2);
		expect(report.sales.find(r => r.id === appointmentId)).toMatchObject({ kind: 'appointment', channel: 'desk', collected: 500, refunded: 100 });
		expect(report.sales.find(r => r.id === orderId)).toMatchObject({ kind: 'order', collected: 500, refunded: 200 });
		expect(report.events.filter(e => e.kind === 'refund').map(e => e.amount).sort()).toEqual([100, 200]);
		expect(report.events.filter(e => e.saleId === orderId)).toEqual([{ saleId: orderId, kind: 'refund', day: '2026-11-09', amount: 200 }]);
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
		const chatSessionId = await s.t.run(ctx => ctx.db.insert('chatSessions', { channel: 'web', createdAt: now }));
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
		await s.payment(id, 1000);
		const { orderId } = await s.admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 50 } });
		await s.payOrder(orderId);
		await s.t.run(ctx => ctx.db.patch(orderId, { currency: 'USD' }));
		for (const basis of ['cash', 'cohort'] as const) expect(await s.report(basis)).toMatchObject({ sales: [], events: [], excluded: { nonThb: 2 } });
	});

	it('keeps names, spend and completed sales when a later candidate exhausts the budget', async () => {
		const s = await setup();
		await s.admin.mutation(api.marketingReport.saveSpend, { campaignId: s.campaignId, amount: 900, from: '2026-11-01', to: '2026-11-09' });
		const first = await s.booking({ paymentStatus: 'paid', paidAt: now });
		await s.booking({ paymentStatus: 'paid', paidAt: now });
		const args = { from: '2026-11-09', to: '2026-11-09', basis: 'cohort' as const };
		const probe = new ReadBudget();
		expect((await s.t.run(ctx => readMarketingReport(ctx, args, probe))).truncated).toBe(false);
		// After the stays come three order scans and one appointment scan; stop on the second stay's refunds.
		const result = await s.t.run(ctx => readMarketingReport(ctx, args, new ReadBudget(16_000, probe.ranges - 5)));
		expect(result.truncated).toBe(true);
		expect(result.sales.map(sale => sale.id)).toEqual([first]);
		expect(result).toMatchObject({ campaigns: [{ id: s.campaignId }], links: [{ id: s.linkId }], spend: [{ amount: 900 }], properties: [{ id: s.propertyId }] });
	});

	it('answers a busy month (3 stays and 20 walk-in orders a day) inside the budget', async () => {
		const s = await setup();
		await s.t.run(async ctx => {
			for (let d = 0; d < 30; d++) {
				const at = now - d * day;
				for (let i = 0; i < 3; i++) {
					const bookingId = await ctx.db.insert('bookings', { propertyId: s.propertyId, guestName: 'Guest', guestPhone: '+66811112222', checkIn: '2026-12-01', checkOut: '2026-12-02', guests: 2, nights: 1, subtotal: 1000, discountAmount: 0, total: 1000, currency: 'THB', paymentStatus: 'paid', status: 'confirmed', amountPaid: 1000, paidAt: at, createdAt: at });
					await ctx.db.insert('bookingPayments', { bookingId, origin: 'manual', method: 'cash', currency: 'THB', amount: 1000, effectiveAt: at, recordedAt: at, recordedBy: email, status: 'recorded', refunded: 0 });
				}
				for (let i = 0; i < 20; i++) {
					const billId = await ctx.db.insert('bills', { status: 'paid', currency: 'THB', itemCount: 1, total: 500, due: 0, hasItems: true, revision: 1, paidAt: at, paymentEffectiveAt: at, createdBy: email, createdAt: at, updatedAt: at });
					await ctx.db.insert('billPayments', { billId, method: 'cash', amount: 500, idempotencyKey: `busy-${d}-${i}`, createdBy: email, createdAt: at, effectiveAt: at });
				}
			}
		});
		for (const basis of ['cohort', 'cash'] as const) {
			const report = await s.report(basis, '2026-10-11', '2026-11-09');
			expect(report.truncated).toBe(false);
			expect(report.sales).toHaveLength(690);
			expect(report.sales.reduce((sum, sale) => sum + sale.collected, 0)).toBe(90 * 1000 + 600 * 500);
			expect(report.campaigns).toHaveLength(1);
		}
	});

	it('keeps an old order\'s stay money on the order, not twice', async () => {
		const s = await setup();
		// Paid before stay payments were itemised: no bookingPayments row, the money is on the order.
		const bookingId = await s.booking({ source: 'admin', paymentStatus: 'paid', amountPaid: 1000, paidAt: now });
		const billId = await s.oldOrder(bookingId);
		for (const basis of ['cohort', 'cash'] as const) {
			const report = await s.report(basis);
			expect(report.sales.reduce((sum, sale) => sum + sale.collected, 0)).toBe(1050);
			expect(report.sales.map(sale => sale.id)).toEqual([billId]);
		}
	});

	it('counts a refund of an old order\'s stay money on that order, with or without other money on the stay', async () => {
		const s = await setup();
		const only = await s.booking({ source: 'admin', status: 'cancelled', paymentStatus: 'paid', amountPaid: 1000, paidAt: now });
		const mixed = await s.booking({ source: 'admin', status: 'cancelled', paymentStatus: 'paid', amountPaid: 1500, paidAt: now });
		await s.payment(mixed, 500);
		const bills = [await s.oldOrder(only), await s.oldOrder(mixed)];
		for (const [i, bookingId] of [only, mixed].entries()) {
			const booking = (await s.t.run(ctx => ctx.db.get(bookingId)))!;
			await s.admin.mutation(api.adminBookings.recordRefund, { bookingId, expectedRevision: booking.revision ?? 0, amount: 1000, currency: 'THB', method: 'cash', billId: bills[i], reason: 'Cancelled', idempotencyKey: `old-order-refund-${i}`, effectiveAt: now });
		}
		for (const basis of ['cohort', 'cash'] as const) {
			const report = await s.report(basis);
			expect(report.sales.map(sale => [sale.id, sale.collected, sale.refunded]).sort()).toEqual([[bills[0], 1050, 1000], [bills[1], 1050, 1000], [mixed, 500, 0]].sort());
		}
		expect((await s.report('cash')).events.filter(e => e.kind === 'refund').map(e => [e.saleId, e.amount]).sort()).toEqual(bills.map(id => [id, 1000]).sort());
	});

	it('finds an order\'s refund dated before its corrected payment day', async () => {
		const s = await setup();
		const appointmentId = await s.appointment();
		const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { appointmentId });
		await s.payOrder(orderId, now - 5 * day);
		const appointment = (await s.t.run(ctx => ctx.db.get(appointmentId)))!;
		await s.admin.mutation(api.adminServices.refundAppointment, { appointmentId, expectedRevision: appointment.revision ?? 0, amount: 200, currency: 'THB', method: 'cash', reason: 'Courtesy', billId: orderId, idempotencyKey: 'early-refund-001', effectiveAt: now - 3 * day });
		await s.admin.mutation(api.pos.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'later-date-001', reason: 'Wrong day', effectiveAt: now - day, tenders: [{ method: 'cash', amount: 500 }] });
		// The range starts after the refund's day; the sale still shows what was given back.
		expect((await s.report('cohort', '2026-11-08')).sales).toMatchObject([{ id: orderId, collected: 500, refunded: 200 }]);
	});

	it('counts a desk payment for an appointment that belongs to a stay', async () => {
		const s = await setup();
		const bookingId = await s.booking({ source: 'admin' });
		const appointmentId = await s.appointment();
		await s.t.run(ctx => ctx.db.patch(appointmentId, { bookingId }));
		await s.admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId, expectedRevision: 0, method: 'cash', idempotencyKey: 'desk-stay-appt' });
		const cash = await s.report('cash');
		expect(cash.sales).toMatchObject([{ id: appointmentId, kind: 'appointment', channel: 'desk', collected: 500, propertyId: s.propertyId }]);
		expect(cash.events).toMatchObject([{ saleId: appointmentId, kind: 'payment', amount: 500 }]);
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
		const draft = { campaignId: s.campaignId, amount: 1000, from: '2026-11-01', to: '2026-11-10', note: 'Launch' };
		await expect(s.admin.mutation(api.marketingReport.saveSpend, { ...draft, amount: 1.5 })).rejects.toThrow('whole baht');
		await expect(s.t.mutation(api.marketingReport.saveSpend, draft)).rejects.toThrow('authenticated');
		const id = await s.admin.mutation(api.marketingReport.saveSpend, draft);
		vi.setSystemTime(now + 1000);
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, id, amount: 2000 });
		expect(await s.t.run(ctx => ctx.db.get(id))).toMatchObject({ createdAt: now, updatedAt: now + 1000 });
		const deleted = await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, note: 'Delete' });
		await s.admin.mutation(api.marketingReport.deleteSpend, { id: deleted });
		await s.admin.mutation(api.marketingReport.deleteSpend, { id: deleted });
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, from: '2026-11-10', to: '2026-11-11' });
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, from: '2026-10-01', to: '2026-11-08' });
		expect((await s.report()).spend).toEqual([{ id, ...draft, amount: 2000 }]);
		expect(await s.admin.query(api.marketingReport.listSpend, { campaignId: s.campaignId })).toHaveLength(3);
		const history = await s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'marketingSpend').eq('entityId', id)).take(10));
		expect(history.map(r => r.kind)).toEqual(['created', 'updated']);
		expect(history[1]).toMatchObject({ before: { amount: 1000, from: draft.from, to: draft.to, note: 'Launch' }, after: { amount: 2000, from: draft.from, to: draft.to, note: 'Launch' } });
		const deletion = await s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'marketingSpend').eq('entityId', deleted)).take(10));
		expect(deletion.map(r => r.kind)).toEqual(['created', 'deleted']);
		await expect(s.admin.mutation(api.marketingReport.saveSpend, { ...draft, id: deleted })).rejects.toThrow('not found');
		// Moving an entry to another campaign shows in its history.
		const other = await s.admin.mutation(api.marketing.saveCampaign, { name: 'December', source: 'facebook', medium: 'social' });
		await s.admin.mutation(api.marketingReport.saveSpend, { ...draft, id, amount: 2000, campaignId: other });
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
		expect((await s.admin.query(api.marketingReport.couponRefusals, { couponId: s.couponId })).total).toBe(5);
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
});
