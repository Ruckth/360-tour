import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { creditMoney } from './marketing/affiliateCredits';
import { APPROVAL_TTL_MS, type CashierRules } from './lib/staffTypes';

const modules = import.meta.glob('./**/*.ts');
const now = Date.parse('2026-11-12T03:00:00Z');
const day = 86_400_000;
beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const error = (code: string) => ({ data: expect.objectContaining({ code }) });

async function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner' });
  const manager = t.withIdentity({ email: 'manager@example.com', tokenIdentifier: 'issuer|manager' });
  const cashier = t.withIdentity({ email: 'cashier@example.com', tokenIdentifier: 'issuer|cashier' });
  for (const [email, role, client] of [
    ['manager@example.com', 'manager', manager], ['cashier@example.com', 'cashier', cashier],
  ] as const) {
    await owner.mutation(api.staffAccess.setGrant, { email, role });
    await client.mutation(api.staffAccess.claimInvite, {});
  }
  const serviceId = await t.run(ctx => ctx.db.insert('services', {
    slug: 'refund-spa', name: 'Spa', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
    price: 100000, currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
  }));
  const propertyId = await t.run(ctx => ctx.db.insert('properties', {
    slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100000, currency: 'THB', maxGuests: 4,
    bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active',
  }));
  const sale = () => owner.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'service', serviceId } });
  const view = async (orderId: Id<'orders'>) => (await owner.query(api.pos.orders.getOrder, { orderId }))!;
  const pay = async (orderId: Id<'orders'>, effectiveAt = now) => {
    const current = await view(orderId);
    return owner.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, idempotencyKey: `pay:${orderId}`, expectedDue: current.totals.due,
      expectedRevision: current.order.revision, tenders: [{ method: 'cash', amount: current.totals.due }], effectiveAt });
  };
  const args = (orderId: Id<'orders'>, lineId: Id<'orderLines'>, amount = 25000, idempotencyKey = 'refund-attempt-1') =>
    ({ orderId, lineId, amount, idempotencyKey, currency: 'THB', method: 'cash' as const, reason: '  Shorter service  ' });
  const rules = async (patch: Partial<Omit<CashierRules, 'revision'>>) => {
    const { revision, ...fields } = await owner.query(api.settings.cashierRules.getCashierRules, {});
    return owner.mutation(api.settings.cashierRules.updateCashierRules, { expectedRevision: revision, ...fields, ...patch });
  };
  const request = (input: ReturnType<typeof args>) => {
    const { orderId, amount, ...payload } = input;
    return cashier.mutation(api.pos.staffApprovals.create, { orderId, reason: 'Please approve this return', payload: { kind: 'refund', amountSatang: amount, ...payload } });
  };
  const appointment = () => t.run(async ctx => {
    const staffId = await ctx.db.insert('staff', { name: 'Therapist', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: now, updatedAt: now });
    return insertFixture(ctx, 'appointments', {
      serviceId, staffId, start: now + 3_600_000, end: now + 7_200_000, blockedUntil: now + 7_200_000,
      guestName: 'Guest', guestPhone: '0800000000', source: 'admin', status: 'booked', paymentStatus: 'unpaid',
      price: 100000, currency: 'THB', confirmationCode: 'APPT', accessToken: 'test-only', createdAt: now,
    });
  });
  const booking = () => t.run(ctx => insertFixture(ctx, 'bookings', {
    propertyId, guestName: 'Guest', guestPhone: '+66811112222', checkIn: '2026-11-13', checkOut: '2026-11-14', guests: 2,
    nights: 1, subtotal: 100000, discountAmount: 0, total: 100000, currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: now,
  }));
  const records = (orderId: Id<'orders'>) => t.run(ctx => ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', orderId)).take(1001));
  return { t, owner, manager, cashier, sale, view, pay, args, rules, request, appointment, booking, records, serviceId };
}

describe('POS line refunds', () => {
  it('refunds a part then exactly the remainder; keeps the paid receipt and exposes line balances', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const issued = await s.view(orderId);
    const first = await s.manager.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId));
    expect(first).toMatchObject({ replayed: false, refund: { amount: 25000, reason: 'Shorter service', businessDate: '2026-11-12', createdByEmail: 'manager@example.com' } });
    expect(first.refund).not.toHaveProperty('createdBy');
    expect((await s.records(orderId))[0].createdBy).toBe('issuer|manager');
    expect((await s.view(orderId)).lines[0]).toMatchObject({ refundedAmountSatang: 25000, remainingRefundableSatang: 75000 });
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 75001, 'too-much-attempt'))).rejects.toMatchObject(error('REFUND_EXCEEDS_REMAINING'));
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 75000, 'remaining-attempt'));
    const view = await s.view(orderId);
    expect(view).toMatchObject({ fullyRefunded: true, refundedAmountSatang: 100000, order: { status: 'paid', receiptNumber: issued.order.receiptNumber } });
    expect(view.lines[0]).toMatchObject({ refundedAmountSatang: 100000, remainingRefundableSatang: 0, net: 100000 });
    expect(view.payments).toEqual(issued.payments);
    expect(view.totals).toEqual(issued.totals);
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 1, 'one-more-attempt'))).rejects.toMatchObject(error('REFUND_EXCEEDS_REMAINING'));
  });

  it('invalidates an already-open correction after a refund, without bumping again on replay', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const before = await s.view(orderId);
    const args = s.args(orderId, lineId);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, args);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, args);
    expect((await s.view(orderId)).paymentRecord.correctionRevision).toBe(before.paymentRecord.correctionRevision + 1);
    await expect(s.owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { orderId, expectedCorrectionRevision: before.paymentRecord.correctionRevision, reason: 'Correct date', effectiveAt: now - day, idempotencyKey: 'stale-correction' })).rejects.toThrow('since you opened it');
  });

  it.each(['direct', 'approval'] as const)('rejects payment dates after the earliest refund through %s', async route => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId, Date.parse('2026-11-01T03:00:00Z'));
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-03T03:00:00Z'));
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId));
    vi.mocked(Date.now).mockReturnValue(now);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 100, 'later-refund'));
    // A legacy forward correction makes this receipt visible to today's cashier.
    if (route === 'approval') await s.t.run(ctx => ctx.db.patch(orderId, { paymentEffectiveAt: now }));
    const badDate = Date.parse('2026-11-05T03:00:00Z');
    if (route === 'direct') {
      await expect(s.owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { orderId, expectedCorrectionRevision: 2, reason: 'Correct date', effectiveAt: badDate, idempotencyKey: 'invalid-payment-date' })).rejects.toMatchObject(error('PAYMENT_DATE_AFTER_REFUND'));
    } else {
      const request = await s.cashier.mutation(api.pos.staffApprovals.create, { orderId, reason: 'Correct date', payload: { kind: 'paymentFix', action: 'amendOrderPayment', effectiveAt: badDate } });
      await expect(s.manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).rejects.toMatchObject(error('PAYMENT_DATE_AFTER_REFUND'));
      expect(await s.t.run(ctx => ctx.db.get(request.requestId))).toMatchObject({ status: 'pending' });
      await s.cashier.mutation(api.pos.staffApprovals.cancel, { requestId: request.requestId });
    }
    // Same Bangkok day is valid even after the refund's time, as is moving earlier.
    for (const [i, effectiveAt] of [Date.parse('2026-11-03T16:30:00Z'), Date.parse('2026-10-31T03:00:00Z')].entries()) {
      await s.owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { orderId, expectedCorrectionRevision: 2 + i, reason: 'Correct date', effectiveAt, idempotencyKey: `earlier-payment-${i}` });
    }
    expect((await s.view(orderId)).paymentRecord.effectiveAt).toBe(Date.parse('2026-10-31T03:00:00Z'));
  });

  it('discovers a sale paid before the cash range from its in-range refund', async () => {
    const s = await setup();
    vi.mocked(Date.now).mockReturnValue(now - 10 * day);
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId, now - 10 * day);
    vi.mocked(Date.now).mockReturnValue(now);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId));
    const report = await s.owner.query(api.marketing.report.getReport, { from: '2026-11-12', to: '2026-11-12', basis: 'cash' });
    expect(report.truncated).toBe(false);
    expect(report.sales).toMatchObject([{ id: orderId, collected: 100000, refunded: 25000 }]);
    expect(report.events).toEqual([{ saleId: orderId, kind: 'refund', day: '2026-11-12', amount: 25000 }]);
    const cohort = await s.owner.query(api.marketing.report.getReport, { from: '2026-11-02', to: '2026-11-02', basis: 'cohort' });
    expect(cohort.sales).toMatchObject([{ id: orderId, collected: 100000, refunded: 25000 }]);
  });

  it.each([1000, 1002])('renders %s refund rows with safe totals and blocks further refunds', async count => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    await s.t.run(async ctx => {
      for (let i = 0; i < count; i++) await ctx.db.insert('orderRefunds', { ...s.args(orderId, lineId, 1, `history-limit-${i}`), createdAt: now, businessDate: '2026-11-12', createdBy: 'issuer|owner', createdByEmail: 'owner@example.com' });
    });
    const view = await s.view(orderId);
    expect(view).toMatchObject({ refundHistoryTruncated: count > 1000, fullyRefunded: false, refundedAmountSatang: Math.min(count, 1001), lines: [{ remainingRefundableSatang: 0 }] });
    expect(view.posRefunds).toHaveLength(50);
    expect(view.posRefunds![0].idempotencyKey).toBe(`history-limit-${count - 1}`);
    expect(view.order.status).toBe('paid');
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 1, 'over-history-limit'))).rejects.toMatchObject(error('REFUND_HISTORY_LIMIT'));
    const page = await s.owner.query(api.pos.orderHistoryPages.orderRefunds, { orderId, paginationOpts: { cursor: null, numItems: 50 } });
    expect(page.page).toHaveLength(50);
    expect(page.isDone).toBe(false);
  });

  it('subtracts POS refunds from customer money and exposes satang totals on order rows', async () => {
    const s = await setup();
    const customerId = await s.owner.mutation(api.pos.customers.createCustomer, { name: 'Guest' });
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    await s.owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'assign-customer', reason: 'Receipt payer', customer: { customerId, expectedCustomerRevision: 0 } });
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 25001));
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 10000, 'second-return'));
    const paginationOpts = { cursor: null, numItems: 10 };
    expect((await s.owner.query(api.pos.customers.getCustomer, { customerId }))!.orders).toMatchObject([{ total: 64999, refundedAmountSatang: 35001 }]);
    expect((await s.owner.query(api.pos.customers.listCustomerOrders, { customerId, paginationOpts })).page).toMatchObject([{ total: 64999, refundedAmountSatang: 35001 }]);
    expect((await s.owner.query(api.pos.orders.listOrders, { filter: 'paid', paginationOpts })).page).toMatchObject([{ total: 100000, refundedAmountSatang: 35001 }]);
  });

  it.each([150000, 200000])('keeps a mixed-order coupon of %s from spending a stay deposit on walk-in lines', async amount => {
    const s = await setup();
    const bookingId = await s.booking();
    await s.t.run(ctx => ctx.db.patch(bookingId, { amountPaid: 90000, paymentStatus: 'paid' }));
    const appointmentId = await s.appointment();
    const { orderId } = await s.owner.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
    await s.owner.mutation(api.pos.commands.attach.attach, { orderId, appointmentId });
    const { lineId } = await s.owner.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'service', serviceId: s.serviceId } });
    const { couponId } = await s.owner.mutation(api.marketing.commands.saveCoupon.saveCoupon, { code: 'MIXED', scope: 'services', benefit: { kind: 'fixed', amount } });
    await s.owner.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'active' });
    await s.owner.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'MIXED' });
    const issued = await s.view(orderId);
    const stay = issued.lines.find(line => line.bookingId === bookingId)!;
    const appointment = issued.lines.find(line => line.appointmentId === appointmentId)!;
    const walkIn = issued.lines.find(line => line._id === lineId)!;
    expect(stay).toMatchObject({ net: 100000, deposit: 90000 });
    expect(stay.couponDiscount ?? 0).toBe(0);
    expect(appointment.deposit ?? 0).toBe(0);
    expect(appointment.net).toBe((200000 - amount) / 2);
    expect(issued.totals.due).toBe(10000 + appointment.net + walkIn.net);
    await s.pay(orderId);
    const cap = walkIn.net;
    const tenders = (await s.view(orderId)).payments.reduce((sum, tender) => sum + tender.amount, 0);
    expect(cap).toBeLessThanOrEqual(tenders);
    if (cap) await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, cap));
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 1, 'after-mixed-cap'))).rejects.toMatchObject(error('REFUND_EXCEEDS_REMAINING'));
  });

  it('uses the issued coupon allocation after manual discount, preserving consumed redemption on full refund', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    const second = await s.owner.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'service', serviceId: s.serviceId } });
    await s.owner.mutation(api.pos.commands.updateLine.updateLine, { lineId, discount: { type: 'amount', value: 10000 } });
    const { couponId } = await s.owner.mutation(api.marketing.commands.saveCoupon.saveCoupon, { code: 'SPA33', scope: 'services', benefit: { kind: 'fixed', amount: 33333 } });
    await s.owner.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'active' });
    await s.owner.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'SPA33' });
    await s.pay(orderId);
    const issued = await s.view(orderId);
    const line = issued.lines.find(row => row._id === lineId)!;
    expect(line.couponDiscount).toBeGreaterThan(0);
    expect(line.net).toBeLessThan(90000);
    const cap = line.net;
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, cap + 1))).rejects.toMatchObject(error('REFUND_EXCEEDS_REMAINING'));
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, cap));
    expect((await s.view(orderId)).fullyRefunded).toBe(false);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, second.lineId, issued.lines.find(row => row._id === second.lineId)!.net, 'second-line-refund'));
    expect((await s.view(orderId)).fullyRefunded).toBe(true);
    expect(await s.t.run(ctx => ctx.db.get(issued.order.promotion!.redemptionId!))).toMatchObject({ state: 'consumed' });
    expect((await s.view(orderId)).promotion).toEqual(issued.promotion);
  });

  it('replays without any new write and rejects a reused key with different arguments', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const args = s.args(orderId, lineId);
    const first = await s.owner.mutation(api.pos.commands.refundLine.refundLine, args);
    const snapshot = await s.view(orderId);
    const history = await s.owner.query(api.pos.orders.orderHistory, { orderId, paginationOpts: { cursor: null, numItems: 50 } });
    expect(await s.owner.mutation(api.pos.commands.refundLine.refundLine, args)).toEqual({ ...first, replayed: true });
    expect(await s.view(orderId)).toEqual(snapshot);
    expect(await s.owner.query(api.pos.orders.orderHistory, { orderId, paginationOpts: { cursor: null, numItems: 50 } })).toEqual(history);
    for (const patch of [{ amount: 1 }, { method: 'card' as const }, { reason: 'Different reason' }, { currency: 'USD' }])
      await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, { ...args, ...patch })).rejects.toMatchObject(error('IDEMPOTENCY_CONFLICT'));
    expect(await s.records(orderId)).toHaveLength(1);
  });

  it('serializes simultaneous refunds and same-key double submits', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const results = await Promise.allSettled([
      s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 60000, 'concurrent-one')),
      s.manager.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 60000, 'concurrent-two')),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({ reason: error('REFUND_EXCEEDS_REMAINING') });
    const args = s.args(orderId, lineId, 40000, 'same-key-concurrent');
    const replays = await Promise.all([s.owner.mutation(api.pos.commands.refundLine.refundLine, args), s.owner.mutation(api.pos.commands.refundLine.refundLine, args)]);
    expect(replays.map(r => r.replayed).sort()).toEqual([false, true]);
    expect((await s.records(orderId)).reduce((n, r) => n + r.amount, 0)).toBe(100000);
  });

  it.each([0, -1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid satang amount %s', async amount => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, amount))).rejects.toMatchObject(error('INVALID_REFUND_AMOUNT'));
    expect(await s.records(orderId)).toHaveLength(0);
  });

  it('requires a bounded reason, attempt key, matching currency and a line on the order', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const other = await s.sale();
    for (const [patch, code] of [
      [{ reason: '   ' }, 'INVALID_REFUND_REASON'], [{ reason: 'a'.repeat(501) }, 'INVALID_REFUND_REASON'],
      [{ idempotencyKey: 'short' }, 'INVALID_IDEMPOTENCY_KEY'], [{ currency: 'USD' }, 'REFUND_CURRENCY_MISMATCH'],
      [{ lineId: other.lineId }, 'LINE_NOT_REFUNDABLE'],
    ] as const) await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, { ...s.args(orderId, lineId), ...patch })).rejects.toMatchObject(error(code));
    expect(await s.records(orderId)).toHaveLength(0);
  });

  it('refuses unpaid and void orders; neither void mode can follow a partial refund', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId))).rejects.toMatchObject(error('ORDER_NOT_PAID'));
    await s.pay(orderId);
    await s.owner.mutation(api.pos.commands.voidOrder.voidOrder, { orderId, reason: 'Wrong sale' });
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId))).rejects.toMatchObject(error('ORDER_NOT_PAID'));
    const next = await s.sale();
    await s.pay(next.orderId);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(next.orderId, next.lineId));
    const before = await s.view(next.orderId);
    await expect(s.owner.mutation(api.pos.commands.voidOrder.voidOrder, { orderId: next.orderId, reason: 'Wrong sale' })).rejects.toMatchObject(error('ORDER_HAS_REFUNDS'));
    await expect(s.owner.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, { orderId: next.orderId, reason: 'No money', idempotencyKey: 'void-attempt', expectedCorrectionRevision: before.paymentRecord.correctionRevision })).rejects.toMatchObject(error('ORDER_HAS_REFUNDS'));
    expect(await s.view(next.orderId)).toEqual(before);
  });

  it.each(['booking', 'appointment'] as const)('refuses attached %s lines', async kind => {
    const s = await setup();
    const source = kind === 'booking' ? { bookingId: await s.booking() } : { appointmentId: await s.appointment() };
    const { orderId } = await s.owner.mutation(api.pos.commands.openOrderFor.openOrderFor, source);
    const lineId = (await s.view(orderId)).lines[0]._id;
    await s.pay(orderId);
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId))).rejects.toMatchObject(error('LINE_NOT_REFUNDABLE'));
  });

  it('returns a standalone POS appointment fee without changing the appointment', async () => {
    const s = await setup();
    const appointmentId = await s.appointment();
    await s.t.run(ctx => ctx.db.patch(appointmentId, { status: 'no_show' }));
    const { orderId } = await s.owner.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 10000, reason: 'Missed service' });
    const lineId = (await s.view(orderId)).lines[0]._id;
    await s.pay(orderId);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 10000));
    expect((await s.view(orderId)).fullyRefunded).toBe(true);
    expect(await s.t.run(ctx => ctx.db.get(appointmentId))).toMatchObject({ status: 'no_show', paymentStatus: 'unpaid' });
  });

  it('refuses allocated walk-in lines and prevents later allocation of refunded money', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const appointmentId = await s.appointment();
    const linkArgs = { orderId, lineId, appointmentId, expectedTargetRevision: 0, expectedCorrectionRevision: 0, idempotencyKey: 'link-attempt', reason: 'Assign to guest' };
    const link = await s.owner.mutation(api.pos.commands.linkPaidLine.linkPaidLine, linkArgs);
    await expect(s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId))).rejects.toMatchObject(error('LINE_NOT_REFUNDABLE'));
    await s.owner.mutation(api.pos.commands.unlinkPaidLine.unlinkPaidLine, { orderId, linkId: link.linkId, expectedCorrectionRevision: 1, idempotencyKey: 'unlink-attempt', reason: 'Wrong guest' });
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId));
    await expect(s.owner.mutation(api.pos.commands.linkPaidLine.linkPaidLine, { ...linkArgs, expectedCorrectionRevision: 3, idempotencyKey: 'relink-attempt' })).rejects.toMatchObject(error('LINE_HAS_REFUNDS'));
  });

  it('keeps stay money on the stay while refunding only a walk-in line on a mixed receipt', async () => {
    const s = await setup();
    const bookingId = await s.booking();
    const { orderId } = await s.owner.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
    const { lineId } = await s.owner.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'service', serviceId: s.serviceId } });
    await s.pay(orderId);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 20000));
    const report = await s.owner.query(api.marketing.report.getReport, { from: '2026-11-12', to: '2026-11-12', basis: 'cash' });
    expect(report.sales.find(sale => sale.id === bookingId)).toMatchObject({ collected: 100000, refunded: 0 });
    expect(report.sales.find(sale => sale.id === orderId)).toMatchObject({ collected: 100000, refunded: 20000 });
    expect(report.events.filter(event => event.kind === 'refund')).toEqual([{ saleId: orderId, kind: 'refund', day: '2026-11-12', amount: 20000 }]);
    expect(await s.t.run(ctx => creditMoney(ctx, { orderId: orderId }))).toEqual({ eligible: true, net: 80000 });
    expect((await s.view(orderId)).fullyRefunded).toBe(false);
    const before = report.events;
    await expect(s.owner.mutation(api.pos.commands.voidOrder.voidOrder, { orderId, reason: 'Wrong order' })).rejects.toMatchObject(error('ORDER_HAS_REFUNDS'));
    expect((await s.owner.query(api.marketing.report.getReport, { from: '2026-11-12', to: '2026-11-12', basis: 'cash' })).events).toEqual(before);
  });

  it('reports on the Bangkok refund day, reduces affiliate credit, and feeds complete audit and order history', async () => {
    const s = await setup();
    const campaignId = await s.owner.mutation(api.marketing.commands.saveCampaign.saveCampaign, { name: 'Partners', source: 'partner', medium: 'affiliate' });
    const affiliateId = await s.owner.mutation(api.marketing.commands.saveAffiliate.saveAffiliate, { name: 'Partner', slug: 'partner', campaignId });
    await s.owner.mutation(api.marketing.commands.setAffiliateStatus.setAffiliateStatus, { affiliateId, status: 'active' });
    const { couponId } = await s.owner.mutation(api.marketing.commands.saveCoupon.saveCoupon, { code: 'PARTNER100', scope: 'services', benefit: { kind: 'fixed', amount: 10000 } });
    await s.owner.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'active' });
    await s.owner.mutation(api.marketing.commands.assignCoupon.assignCoupon, { affiliateId, couponId });
    const { orderId, lineId } = await s.sale();
    await s.owner.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'PARTNER100' });
    await s.pay(orderId, now - day);
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-12T18:30:00Z')); // November 13 in Bangkok.
    await s.manager.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 10000));
    expect(await s.t.run(ctx => creditMoney(ctx, { orderId: orderId }))).toEqual({ eligible: true, net: 80000 });
    const credit = await s.t.run(ctx => ctx.db.query('affiliateCredits').withIndex('by_sourceKey', q => q.eq('sourceKey', `order:${orderId}`)).unique());
    expect(credit).toMatchObject({ eligibleNet: 80000, eligible: true });
    const report = (from: string, basis: 'cash' | 'cohort' = 'cash') => s.owner.query(api.marketing.report.getReport, { from, to: from, basis });
    expect((await report('2026-11-11')).events).toEqual([{ saleId: orderId, kind: 'payment', day: '2026-11-11', amount: 90000 }]);
    expect((await report('2026-11-12')).events).toEqual([]);
    expect((await report('2026-11-13')).events).toEqual([{ saleId: orderId, kind: 'refund', day: '2026-11-13', amount: 10000 }]);
    expect((await report('2026-11-11', 'cohort')).sales).toMatchObject([{ id: orderId, collected: 90000, refunded: 10000 }]);
    const pageArgs = { orderId, paginationOpts: { cursor: null, numItems: 1 } };
    const history = await s.owner.query(api.pos.orders.orderHistory, pageArgs);
    expect(history.page).toMatchObject([{ kind: 'refund', actor: 'manager@example.com', after: { amount: 10000, businessDate: '2026-11-13' } }]);
    expect((await s.owner.query(api.pos.orderHistoryPages.audit, pageArgs)).page).toMatchObject([{ kind: 'refund', fromPrice: 90000, toPrice: 80000 }]);
    const page = await s.owner.query(api.pos.orderHistoryPages.orderRefunds, pageArgs);
    expect(page.page).toMatchObject([{ amount: 10000, businessDate: '2026-11-13' }]);
    expect(page.page[0]).not.toHaveProperty('createdBy');
    await s.manager.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 80000, 'full-return-attempt'));
    expect(await s.t.run(ctx => creditMoney(ctx, { orderId: orderId }))).toEqual({ eligible: false, net: 0 });
    expect((await report('2026-11-13')).events.reduce((sum, e) => sum + e.amount, 0)).toBe(90000);
    const secondPage = await s.owner.query(api.pos.orderHistoryPages.orderRefunds, { ...pageArgs, paginationOpts: { numItems: 1, cursor: (await s.owner.query(api.pos.orderHistoryPages.orderRefunds, pageArgs)).continueCursor } });
    expect(secondPage.page).toHaveLength(1);
  });
});

describe('POS refund staff approvals', () => {
  it('requires approval by default, executes once atomically, and allows the cashier rule', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const args = s.args(orderId, lineId);
    await expect(s.cashier.mutation(api.pos.commands.refundLine.refundLine, args)).rejects.toMatchObject(error('NEEDS_APPROVAL'));
    const request = await s.request(args);
    expect((await s.cashier.query(api.pos.staffApprovals.forOrder, { orderId }))[0]).toMatchObject({ payload: { amountSatang: 25000, reason: args.reason }, amount: 25000 });
    expect(request).toMatchObject({ amount: 25000, totalBefore: 100000, totalAfter: 75000, expiresAt: now + APPROVAL_TTL_MS });
    expect(await s.records(orderId)).toHaveLength(0);
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).toEqual({ status: 'applied', replayed: false });
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).toEqual({ status: 'applied', replayed: true });
    expect(await s.records(orderId)).toHaveLength(1);
    expect((await s.records(orderId))[0]).toMatchObject({ createdBy: 'issuer|manager', createdByEmail: 'manager@example.com' });
    // The original client key survives approval, so a lost response can safely be retried.
    expect(await s.cashier.mutation(api.pos.commands.refundLine.refundLine, args)).toMatchObject({ replayed: true });
    await s.rules({ refund: 'cashier' });
    await s.cashier.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 10000, 'cashier-return-attempt'));
    expect((await s.records(orderId))[1].createdBy).toBe('issuer|cashier');
  });

  it.each(['rule', 'refund', 'line', 'order', 'requester'] as const)('stales a refund request after a change to %s', async change => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const request = await s.request(s.args(orderId, lineId));
    if (change === 'rule') { await s.rules({ refund: 'cashier' }); await s.rules({ refund: 'manager' }); }
    if (change === 'refund') await s.manager.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 1, 'other-refund-attempt'));
    if (change === 'line') await s.t.run(ctx => ctx.db.patch(lineId, { couponDiscount: 100 }));
    if (change === 'order') await s.owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'amend-attempt', reason: 'Correct date', effectiveAt: now - day });
    if (change === 'requester') await s.owner.mutation(api.staffAccess.setGrant, { email: 'cashier@example.com', role: null });
    expect(await s.manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).toEqual({ status: 'stale', replayed: false });
    expect(await s.records(orderId)).toHaveLength(change === 'refund' ? 1 : 0);
  });

  it('rolls back approval execution if its key was already used for different details', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId, 1));
    const request = await s.request(s.args(orderId, lineId, 100));
    const before = await s.view(orderId);
    await expect(s.manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).rejects.toMatchObject(error('IDEMPOTENCY_CONFLICT'));
    expect(await s.view(orderId)).toEqual(before);
    expect(await s.t.run(ctx => ctx.db.get(request.requestId))).toMatchObject({ status: 'pending' });
    expect(await s.records(orderId)).toHaveLength(1);
  });

  it('expires at five minutes, refuses self approval, and rechecks the approving role', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId);
    const request = await s.request(s.args(orderId, lineId));
    await s.owner.mutation(api.staffAccess.setGrant, { email: 'cashier@example.com', role: 'manager' });
    await expect(s.cashier.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).rejects.toThrow('own request');
    await s.owner.mutation(api.staffAccess.setGrant, { email: 'manager@example.com', role: null });
    await expect(s.manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).rejects.toThrow('Not authorized');
    vi.mocked(Date.now).mockReturnValue(now + APPROVAL_TTL_MS);
    expect(await s.owner.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).toEqual({ status: 'expired', replayed: false });
    expect(await s.records(orderId)).toHaveLength(0);
  });

  it('keeps cashier refund writes, requests and history within existing receipt visibility', async () => {
    const s = await setup();
    const { orderId, lineId } = await s.sale();
    await s.pay(orderId, now - day);
    await s.rules({ refund: 'cashier' });
    expect(await s.cashier.query(api.pos.orders.getOrder, { orderId })).toBeNull();
    await expect(s.cashier.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId))).rejects.toMatchObject(error('ORDER_NOT_FOUND'));
    await expect(s.request(s.args(orderId, lineId))).rejects.toThrow('Order not found');
    await expect(s.cashier.query(api.pos.orderHistoryPages.orderRefunds, { orderId, paginationOpts: { cursor: null, numItems: 20 } })).rejects.toThrow('Order not found');
    await s.owner.mutation(api.pos.commands.refundLine.refundLine, s.args(orderId, lineId));
    expect(await s.records(orderId)).toHaveLength(1);
  });
});
