// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { holdCouponRedemption } from './lib/couponRedemptions';
import { writeBooking } from './lib/bookingMoney';
import { createBookingRecord } from './lib/bookingWrites';

declare global { interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; } }
const modules = import.meta.glob('./**/*.ts');
const email = 'admin@example.com';
const NOW = Date.parse('2026-11-07T10:00:00Z');
beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', email);
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

type Limits = { usageLimit?: number; discountBudget?: number; maxSaving?: number; minNights?: number; percent?: number };
async function setup(limits: Limits = {}) {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email, tokenIdentifier: 'admin' });
  const propertyId = await t.run(ctx => ctx.db.insert('properties', {
    slug: 'mossbell', name: 'Mossbell Garden Suite', tagline: '', description: '', pricePerNight: 450000, currency: 'THB', maxGuests: 2,
    bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 1500, status: 'active'
  }));
  const rules = {
    code: 'DCNT-F1-20', benefit: { kind: 'percent' as const, percent: limits.percent ?? 2000 }, scope: 'accommodation' as const,
    bookFrom: '2026-11-01', bookTo: '2026-11-30', stayFrom: '2026-11-01', stayTo: '2026-12-20',
    minNights: limits.minNights ?? 2, maxSaving: limits.maxSaving ?? 300000, usageLimit: limits.usageLimit ?? 500,
    discountBudget: limits.discountBudget ?? 8000000
  };
  const { couponId } = await admin.mutation(api.marketing.saveCoupon, rules);
  await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
  const input = { propertySlug: 'mossbell', guestName: 'Mia', guestPhone: '+66811112222', guestEmail: 'mia@example.com', checkIn: '2026-11-10', checkOut: '2026-11-12', guests: 2, couponCode: ' dcnt-f1-20 ' };
  const get = async (id: Id<'bookings'>) => (await t.run(ctx => ctx.db.get(id)))!;
  const coupon = async () => (await t.run(ctx => ctx.db.get(couponId)))!;
  const row = async (id: Id<'bookings'>) => (await t.run(ctx => ctx.db.query('couponRedemptions').withIndex('by_bookingId', q => q.eq('bookingId', id)).unique()))!;
  const create = (changes: Partial<typeof input> = {}) => admin.mutation(api.adminBookings.createBooking, { ...input, notifyGuest: false, ...changes });
  const web = (changes: Partial<typeof input> = {}) => t.mutation(api.bookings.create, { ...input, ...changes });
  const edit = async (id: Id<'bookings'>, changes: { checkIn?: string; checkOut?: string; guests?: number; propertyId?: Id<'properties'>; priceOverride?: null | { total: number; reason: string }; expectedPrice?: { total: number; currency: string } } = {}) => {
    const b = await get(id);
    return admin.mutation(api.adminBookings.editBooking, { bookingId: id, expectedRevision: b.revision ?? 0, propertyId: b.propertyId, checkIn: b.checkIn, checkOut: b.checkOut, guests: b.guests, guestName: b.guestName, guestPhone: b.guestPhone, guestEmail: b.guestEmail, notifyGuest: false, ...changes });
  };
  const pay = async (id: Id<'bookings'>) => {
    const b = await get(id);
    return admin.mutation(api.adminBookings.recordPayment, { bookingId: id, expectedRevision: b.revision ?? 0, expectedAmount: b.total - (b.amountPaid ?? 0), method: 'cash', idempotencyKey: `manual-${id}`, notifyGuest: false });
  };
  const cancel = async (id: Id<'bookings'>) => admin.mutation(api.adminBookings.cancelStay, { bookingId: id, expectedRevision: (await get(id)).revision ?? 0, reason: 'Guest cancelled', notifyGuest: false });
  const checkout = async (id: Id<'bookings'>) => {
    const b = await get(id);
    const { request } = await t.mutation(internal.payments.beginCheckout, { bookingId: id, accessToken: b.accessToken!, siteUrl: 'https://example.com' });
    if (!request) throw new Error('Missing checkout request');
    const sessionId = `cs_${id}`;
    await t.mutation(internal.payments.saveCheckoutSession, { bookingId: id, accessToken: b.accessToken!, sessionId, url: 'https://checkout.stripe.com/test', expiresAt: request.expiresAt, attempt: request.attempt, total: request.total, currency: request.currency, checkIn: request.checkIn, checkOut: request.checkOut });
    return { bookingId: id, sessionId, amountTotal: request.total, currency: 'thb', paymentIntentId: `pi_${id}` };
  };
  const expire = async (id: Id<'bookings'>, sessionId?: string) => {
    await t.run(ctx => ctx.db.patch(id, { unpaidHoldExpiresAt: NOW - 1, stripeCheckoutExpiresAt: NOW - 1 }));
    if (sessionId) await t.mutation(internal.payments.expireCheckout, { bookingId: id, sessionId });
    else await t.mutation(internal.crons.expireBookingHold, { bookingId: id, expectedRevision: 0 });
  };
  const reconcile = async () => {
    const rows = await t.run(ctx => ctx.db.query('couponRedemptions').withIndex('by_couponId_and_createdAt', q => q.eq('couponId', couponId)).take(100));
    const held = rows.filter(r => r.state === 'held');
    const used = rows.filter(r => r.state === 'consumed' || r.state === 'reversed');
    const c = await coupon();
    expect(c.held ?? 0).toBe(held.length);
    expect(c.heldDiscount ?? 0).toBe(held.reduce((sum, r) => sum + r.discount, 0));
    expect(c.used).toBe(used.length);
    expect(c.discountGranted).toBe(used.reduce((sum, r) => sum + r.discount, 0));
    for (const r of rows) {
      const b = r.bookingId ? await get(r.bookingId) : null;
      if (!b?.promotion) continue;
      expect(b.promotion.discount).toBe(r.discount);
      if (!b.priceOverride) {
        expect(b.discountAmount).toBe(r.discount);
        expect(b.total).toBe(b.subtotal - r.discount);
      }
    }
  };
  return { t, admin, propertyId, couponId, rules, input, get, coupon, row, create, web, edit, pay, cancel, checkout, expire, reconcile };
}

describe('booking coupon reservations', () => {
  it('Mossbell 2n F1-20: freezes 7200 and holds one 1800 redemption; previews reserve nothing', async () => {
    const s = await setup();
    expect(await s.t.query(api.marketing.previewCoupon, { code: s.input.couponCode, propertySlug: 'mossbell', checkIn: s.input.checkIn, checkOut: s.input.checkOut })).toMatchObject({ couponStatus: 'applied', total: 720000 });
    expect(await s.coupon()).toMatchObject({ used: 0 });
    const { bookingId, accessToken } = await s.web();
    expect(await s.t.query(api.bookings.getById, { id: bookingId, accessToken })).toMatchObject({ promotion: { code: 'DCNT-F1-20', discount: 180000 } });
    expect(await s.get(bookingId)).toMatchObject({ subtotal: 900000, discountAmount: 180000, total: 720000, promotion: { code: 'DCNT-F1-20', couponVersion: 1, discount: 180000 } });
    expect(await s.row(bookingId)).toMatchObject({ bookingId, state: 'held', discount: 180000 });
    expect(await s.admin.query(api.adminBookings.getForAdmin, { bookingId })).toMatchObject({ promotion: { discount: 180000 } });
    expect(await s.admin.query(api.adminBookings.listForAdmin, { from: '2026-11-10', to: '2026-11-13' })).toMatchObject({ bookings: [{ promotion: { discount: 180000 } }] });
    await s.reconcile();
  });

  it('serializes two final-slot bookings, with a guest-readable coupon_unavailable on the second', async () => {
    const s = await setup({ usageLimit: 1 });
    await s.create();
    await expect(s.create({ checkIn: '2026-11-14', checkOut: '2026-11-16' })).rejects.toThrow(/coupon_unavailable.*no uses left.*sold_out/);
    expect(await s.t.run(ctx => ctx.db.query('bookings').collect())).toHaveLength(1);
    await s.reconcile();
  });

  it('re-reads the coupon before holding, even if the caller has a stale snapshot', async () => {
    const s = await setup({ usageLimit: 1 });
    const stale = await s.coupon();
    const first = await s.create();
    await expect(s.t.run(ctx => holdCouponRedemption(ctx, { coupon: stale, couponVersion: 1, discount: 180000, bookingId: first }))).rejects.toThrow(/sold_out/);
    await s.reconcile();
  });

  it('rechecks budget in holdCouponRedemption rather than trusting the supplied snapshot', async () => {
    const s = await setup({ discountBudget: 180000 });
    const stale = await s.coupon();
    const id = await s.create();
    await expect(s.t.run(ctx => holdCouponRedemption(ctx, { coupon: stale, couponVersion: 1, discount: 180000, bookingId: id }))).rejects.toThrow(/budget_used/);
    await s.reconcile();
  });

  it('reserves discount budget, caps the final quote to remaining budget, then refuses another hold', async () => {
    const s = await setup({ discountBudget: 340000 });
    await s.create();
    const second = await s.create({ checkIn: '2026-11-14', checkOut: '2026-11-16' });
    expect(await s.get(second)).toMatchObject({ discountAmount: 160000, total: 740000 });
    await expect(s.create({ checkIn: '2026-11-17', checkOut: '2026-11-19' })).rejects.toThrow(/coupon_unavailable.*budget_used/);
    await s.reconcile();
  });

  it.each([1000, 2000])('coupon_worse books direct without a hold (%s percent)', async percent => {
    const s = await setup({ percent });
    if (percent === 2000) await s.t.run(ctx => ctx.db.patch(s.propertyId, { pricePerNight: 1200000 }));
    const id = await s.create(percent === 2000 ? { checkOut: '2026-11-13' } : {});
    const b = await s.get(id);
    expect(b.promotion).toBeUndefined();
    expect(b.total).toBe(percent === 2000 ? 3060000 : 765000);
    expect(await s.row(id)).toBeNull();
    await s.reconcile();
  });

  it('rejects missing, paused, expired, minimum-night and service-only codes without creating a booking', async () => {
    const s = await setup();
    await expect(s.create({ couponCode: 'unknown' })).rejects.toThrow(/not_found/);
    await expect(s.create({ checkOut: '2026-11-11' })).rejects.toThrow(/Add 1 more night.*min_nights/);
    await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'paused' });
    await expect(s.create()).rejects.toThrow(/not_active/);
    await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'active' });
    await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, bookTo: '2026-11-06' });
    await expect(s.create()).rejects.toThrow(/expired/);
    await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, scope: 'services' });
    await expect(s.create()).rejects.toThrow(/nothing_eligible/);
    expect(await s.t.run(ctx => ctx.db.query('bookings').collect())).toHaveLength(0);
    await s.reconcile();
  });

  it.each(['admin', 'web', 'whatsapp', 'messenger', 'line', 'instagram'] as const)('preserves no-code direct pricing for %s', async source => {
    const s = await setup();
    const { bookingId } = await s.t.run(ctx => createBookingRecord(ctx, { ...s.input, couponCode: '  ', source }));
    expect(await s.get(bookingId)).toMatchObject({ subtotal: 900000, discountAmount: 135000, total: 765000 });
    expect((await s.get(bookingId)).promotion).toBeUndefined();
    await s.reconcile();
  });
});

describe('payment and status synchronization', () => {
  it('consumes on Stripe completion, without double counting a webhook redelivery', async () => {
    const s = await setup();
    const { bookingId } = await s.web();
    const args = await s.checkout(bookingId);
    expect(args.amountTotal).toBe(720000);
    await s.t.mutation(internal.payments.completeCheckout, args);
    const before = await s.row(bookingId);
    expect(before).toMatchObject({ state: 'consumed', discount: 180000 });
    await s.t.mutation(internal.payments.completeCheckout, args);
    expect(await s.row(bookingId)).toEqual(before);
    expect(await s.coupon()).toMatchObject({ held: 0, used: 1, heldDiscount: 0, discountGranted: 180000 });
    await s.reconcile();
  });

  it.each(['manual', 'POS'] as const)('consumes on a %s payment', async origin => {
    const s = await setup();
    const id = await s.create();
    if (origin === 'manual') await s.pay(id);
    else {
      const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { bookingId: id });
      const view = (await s.admin.query(api.pos.getOrder, { orderId }))!;
      expect(view.totals.due).toBe(720000);
      await s.admin.mutation(api.pos.settleOrder, { orderId, expectedRevision: view.order.revision, expectedDue: view.totals.due, idempotencyKey: 'pos-coupon-payment', tenders: [{ method: 'cash', amount: view.totals.due }] });
    }
    expect(await s.row(id)).toMatchObject({ state: 'consumed' });
    await s.reconcile();
  });

  it('consumes on a partial deposit even while paymentStatus is pending', async () => {
    const s = await setup();
    const id = await s.create();
    await s.t.run(async ctx => { const b = (await ctx.db.get(id))!; await writeBooking(ctx, b, { amountPaid: 10000 }, { actor: email, kind: 'deposit' }); });
    expect(await s.row(id)).toMatchObject({ state: 'consumed' });
    await s.reconcile();
  });

  it.each(['cron', 'checkout'] as const)('releases an unpaid hold on %s expiry exactly once', async path => {
    const s = await setup();
    const { bookingId } = await s.web();
    const args = path === 'checkout' ? await s.checkout(bookingId) : undefined;
    await s.expire(bookingId, args?.sessionId);
    const before = await s.row(bookingId);
    expect(before.state).toBe('released');
    await s.expire(bookingId, args?.sessionId);
    expect(await s.row(bookingId)).toEqual(before);
    await s.reconcile();
  });

  it.each(['free', 'slot_full', 'budget_full'] as const)('honours expired-then-recovered checkout when capacity is %s', async capacity => {
    const s = await setup({ usageLimit: capacity === 'slot_full' ? 1 : 500, discountBudget: capacity === 'budget_full' ? 180000 : 8000000 });
    const { bookingId } = await s.web();
    const args = await s.checkout(bookingId);
    await s.expire(bookingId, args.sessionId);
    if (capacity !== 'free') await s.create({ checkIn: '2026-11-14', checkOut: '2026-11-16' });
    await s.t.mutation(internal.payments.completeCheckout, args);
    expect(await s.row(bookingId)).toMatchObject({ state: 'consumed', discount: 180000 });
    expect((await s.row(bookingId)).overLimit).toBe(capacity !== 'free' ? true : undefined);
    expect(await s.get(bookingId)).toMatchObject({ total: 720000, amountPaid: 720000, status: 'confirmed' });
    await s.t.mutation(internal.payments.completeCheckout, args);
    await s.reconcile();
  });

  it.each(['slot', 'budget'] as const)('rejects unpaid reopen when another booking took its %s', async limit => {
    const s = await setup(limit === 'slot' ? { usageLimit: 1 } : { discountBudget: 180000 });
    const id = await s.create();
    await s.cancel(id);
    await s.create({ checkIn: '2026-11-14', checkOut: '2026-11-16' });
    const before = await s.coupon();
    await expect(s.admin.mutation(api.adminBookings.reopenBooking, { bookingId: id, expectedRevision: (await s.get(id)).revision!, confirmed: false, reason: 'Guest returned', notifyGuest: false })).rejects.toThrow(
      /coupon_unavailable.*DCNT-F1-20 has no uses left, so this booking can't reopen at its coupon price. Raise the coupon's limit, or create a new booking./
    );
    expect(await s.row(id)).toMatchObject({ state: 'released' });
    expect(await s.get(id)).toMatchObject({ status: 'cancelled', total: 720000 });
    expect(await s.coupon()).toEqual(before);
    await s.reconcile();
  });

  it('reholds an unpaid reopened booking when its slot is free', async () => {
    const s = await setup({ usageLimit: 1 });
    const id = await s.create();
    await s.cancel(id);
    await s.admin.mutation(api.adminBookings.reopenBooking, { bookingId: id, expectedRevision: (await s.get(id)).revision!, confirmed: false, reason: 'Guest returned', notifyGuest: false });
    expect(await s.row(id)).toMatchObject({ state: 'held' });
    expect((await s.row(id)).overLimit).toBeUndefined();
    await s.reconcile();
  });

  it('cancel and full refund after payment reverse without restoring capacity, even on reopen', async () => {
    const s = await setup({ usageLimit: 1 });
    const id = await s.create();
    await s.pay(id);
    const before = await s.coupon();
    await s.cancel(id);
    expect((await s.row(id)).state).toBe('reversed');
    await s.admin.mutation(api.adminBookings.recordRefund, { bookingId: id, expectedRevision: (await s.get(id)).revision!, amount: 720000, currency: 'THB', method: 'cash', reason: 'Returned payment', idempotencyKey: 'coupon-full-refund' });
    expect(await s.coupon()).toEqual(before);
    await s.admin.mutation(api.adminBookings.reopenBooking, { bookingId: id, expectedRevision: (await s.get(id)).revision!, confirmed: false, reason: 'Guest returned', notifyGuest: false });
    expect((await s.row(id)).state).toBe('reversed');
    await expect(s.create({ checkIn: '2026-11-14', checkOut: '2026-11-16' })).rejects.toThrow(/sold_out/);
    await s.reconcile();
  });

  it('a partial refund on a live repriced stay keeps the use consumed and counters unchanged', async () => {
    const s = await setup();
    const id = await s.create({ checkOut: '2026-11-13' });
    await s.pay(id);
    await s.edit(id, { checkOut: '2026-11-12' });
    const before = await s.coupon();
    await s.admin.mutation(api.adminBookings.recordRefund, { bookingId: id, expectedRevision: (await s.get(id)).revision!, amount: 360000, currency: 'THB', method: 'cash', reason: 'Shorter stay', idempotencyKey: 'coupon-credit-refund' });
    expect(await s.row(id)).toMatchObject({ state: 'consumed' });
    expect(await s.coupon()).toEqual(before);
    await s.reconcile();
  });

  it('deleting an unpaid booking releases its slot and keeps the ledger', async () => {
    const s = await setup();
    const id = await s.create();
    await s.admin.mutation(api.adminBookings.deleteBooking, { bookingId: id, expectedRevision: (await s.get(id)).revision! });
    expect(await s.get(id)).toBeNull();
    expect(await s.row(id)).toMatchObject({ state: 'released' });
    await s.reconcile();
  });
});

describe('admin coupon repricing', () => {
  it.each(['held', 'consumed'] as const)('grows percent savings with nights and updates %s money by the delta', async state => {
    const s = await setup();
    const id = await s.create();
    if (state === 'consumed') await s.pay(id);
    await s.edit(id, { checkOut: '2026-11-13' });
    expect(await s.get(id)).toMatchObject({ subtotal: 1350000, discountAmount: 270000, total: 1080000, promotion: { discount: 270000 } });
    expect(await s.row(id)).toMatchObject({ state, discount: 270000 });
    expect(await s.coupon()).toMatchObject(state === 'held' ? { heldDiscount: 270000, discountGranted: 0 } : { heldDiscount: 0, discountGranted: 270000 });
    await s.reconcile();
  });

  it.each(['held', 'consumed'] as const)('removes a minimum-night failure and releases/reverses %s', async state => {
    const s = await setup();
    const id = await s.create();
    if (state === 'consumed') await s.pay(id);
    await s.edit(id, { checkOut: '2026-11-11' });
    expect(await s.get(id)).toMatchObject({ subtotal: 450000, discountAmount: 67500, total: 382500 });
    expect((await s.get(id)).promotion).toBeUndefined();
    expect(await s.row(id)).toMatchObject({ state: state === 'held' ? 'released' : 'reversed', discount: 180000 });
    expect(await s.coupon()).toMatchObject(state === 'held' ? { held: 0, heldDiscount: 0, used: 0 } : { used: 1, discountGranted: 180000 });
    await s.reconcile();
  });

  it('removes a coupon when the direct offer becomes better', async () => {
    const s = await setup();
    const id = await s.create();
    await s.edit(id, { checkOut: '2026-11-16' });
    expect(await s.get(id)).toMatchObject({ subtotal: 2700000, discountAmount: 405000, total: 2295000 });
    expect((await s.get(id)).promotion).toBeUndefined();
    expect(await s.row(id)).toMatchObject({ state: 'released' });
    await s.reconcile();
  });

  it('uses frozen rules as active after edits, pause, exhausted slots and the booking window closes', async () => {
    const s = await setup({ usageLimit: 1 });
    const id = await s.create();
    await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, benefit: { kind: 'percent', percent: 500 }, minNights: 20 });
    await s.admin.mutation(api.marketing.setCouponStatus, { couponId: s.couponId, status: 'paused' });
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-12-01T10:00:00Z'));
    await s.edit(id, { checkIn: '2026-12-02', checkOut: '2026-12-05' });
    expect(await s.get(id)).toMatchObject({ total: 1080000, promotion: { couponVersion: 1, discount: 270000 } });
    await s.reconcile();
  });

  it.each(['held', 'consumed'] as const)('excludes its own %s discount from the budget cap', async state => {
    const s = await setup({ usageLimit: 1, discountBudget: 270000 });
    const id = await s.create();
    if (state === 'consumed') await s.pay(id);
    await s.edit(id, { checkOut: '2026-11-13' });
    expect(await s.row(id)).toMatchObject({ state, discount: 270000 });
    await s.edit(id, { guests: 1 });
    expect(await s.row(id)).toMatchObject({ state, discount: 270000 });
    await s.reconcile();
  });

  it('includes other held and granted discounts when repricing within the budget', async () => {
    const s = await setup({ discountBudget: 400000 });
    const id = await s.create();
    const second = await s.create({ checkIn: '2026-11-14', checkOut: '2026-11-16' });
    await s.pay(second);
    await s.edit(id, { checkOut: '2026-11-13' });
    expect(await s.get(id)).toMatchObject({ total: 1130000, discountAmount: 220000 });
    expect(await s.coupon()).toMatchObject({ heldDiscount: 220000, discountGranted: 180000 });
    await s.reconcile();
  });

  it('custom price overrides keep the promotion and ledger discount until returning to villa pricing', async () => {
    const s = await setup();
    const id = await s.create();
    const before = await s.row(id);
    await s.edit(id, { checkOut: '2026-11-13', priceOverride: { total: 800000, reason: 'Host quote' } });
    expect(await s.get(id)).toMatchObject({ total: 800000, promotion: { discount: 180000 }, priceOverride: { total: 800000 } });
    expect(await s.row(id)).toEqual(before);
    await s.edit(id, { priceOverride: null });
    expect(await s.get(id)).toMatchObject({ total: 1080000, discountAmount: 270000, promotion: { discount: 270000 } });
    expect((await s.get(id)).priceOverride).toBeUndefined();
    await s.reconcile();
  });

  it('surfaces the latest 50 uses, newest first, with guest and confirmation details', async () => {
    const s = await setup();
    const id = await s.create();
    const b = await s.get(id);
    await s.t.run(async ctx => {
      for (let i = 1; i <= 51; i++) await ctx.db.insert('couponRedemptions', {
        couponId: s.couponId, couponVersion: 1, code: 'DCNT-F1-20', bookingId: id,
        state: 'released', discount: 180000, createdAt: NOW + i, updatedAt: NOW + i
      });
    });
    const detail = (await s.admin.query(api.marketing.getCoupon, { couponId: s.couponId }))!;
    expect(detail.redemptions).toHaveLength(50);
    expect(detail.redemptions[0]).toMatchObject({ createdAt: NOW + 51, booking: { guestName: 'Mia', checkIn: '2026-11-10', checkOut: '2026-11-12', confirmationCode: b.confirmationCode } });
    expect(detail.redemptions[49].createdAt).toBe(NOW + 2);
  });

  it('includes the code in admin create idempotency and replays the same attempt without another hold', async () => {
    const s = await setup();
    const args = { ...s.input, idempotencyKey: 'same-booking-coupon', notifyGuest: false };
    const id = await s.admin.mutation(api.adminBookings.createBooking, args);
    expect(await s.admin.mutation(api.adminBookings.createBooking, { ...args, couponCode: 'DCNT-F1-20' })).toBe(id);
    await expect(s.admin.mutation(api.adminBookings.createBooking, { ...args, couponCode: '' })).rejects.toThrow(/different details/);
    await s.reconcile();
  });
});

it('the Stripe refund webhook reverses a consumed coupon without restoring its counters', async () => {
  const s = await setup();
  const { bookingId } = await s.web();
  const args = await s.checkout(bookingId);
  await s.t.mutation(internal.payments.completeCheckout, args);
  const before = await s.coupon();
  const event = { paymentIntentId: args.paymentIntentId, chargeId: 'ch_coupon_refund', eventId: 'evt_coupon_refund', eventCreated: NOW / 1000,
    amount: args.amountTotal, amountRefunded: args.amountTotal, currency: 'thb', refunds: [{ id: 're_coupon_refund', amount: args.amountTotal, currency: 'thb', status: 'succeeded' }] };
  await s.t.mutation(internal.payments.recordRefund, event);
  expect(await s.row(bookingId)).toMatchObject({ state: 'reversed' });
  expect(await s.coupon()).toEqual(before);
  await s.t.mutation(internal.payments.recordRefund, event);
  expect(await s.coupon()).toEqual(before);
  await s.reconcile();
});


describe('release 2a backend regressions', () => {
  it.each([false, true])('guest-only edits preserve frozen money and reservation (paid=%s)', async paid => {
    const s = await setup();
    const id = await s.create();
    if (paid) await s.pay(id);
    const before = await s.get(id);
    const redemption = await s.row(id);
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { pricePerNight: 600000, currency: 'USD' }));
    await s.edit(id, { guests: 1 });
    expect(await s.get(id)).toMatchObject({ guests: 1, subtotal: before.subtotal, discountAmount: before.discountAmount, total: before.total, currency: before.currency, promotion: before.promotion });
    expect((await s.get(id)).amountPaid).toBe(before.amountPaid);
    expect(await s.row(id)).toEqual(redemption);
    await s.reconcile();
  });

  it.each(['reset', 'override', 'stay'] as const)('guards paid currency on every price-writing path: %s', async path => {
    const s = await setup();
    const id = await s.create();
    if (path === 'reset') await s.edit(id, { priceOverride: { total: 700000, reason: 'Host quote' } });
    await s.pay(id);
    const before = await s.get(id);
    const redemption = await s.row(id);
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { currency: 'USD' }));
    const changes = path === 'reset' ? { priceOverride: null } : path === 'override' ? { priceOverride: { total: 750000, reason: 'New quote' } } : { checkOut: '2026-11-13' };
    await expect(s.edit(id, changes)).rejects.toThrow(/different currency/);
    expect(await s.get(id)).toEqual(before);
    expect(await s.row(id)).toEqual(redemption);
  });

  it.each(['manual', 'POS'] as const)('restores capacity when %s money was never received', async origin => {
    const s = await setup({ usageLimit: 1, discountBudget: 180000 });
    const id = await s.create();
    if (origin === 'manual') {
      await s.pay(id);
      const payment = (await s.t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', id)).first()))!;
      await s.admin.mutation(api.adminBookings.cancelPayment, { bookingId: id, expectedRevision: (await s.get(id)).revision!, paymentId: payment._id, reason: 'Cash was never received' });
    } else {
      const { orderId } = await s.admin.mutation(api.pos.openOrderFor, { bookingId: id });
      const view = (await s.admin.query(api.pos.getOrder, { orderId }))!;
      await s.admin.mutation(api.pos.settleOrder, { orderId, expectedRevision: view.order.revision, expectedDue: view.totals.due, idempotencyKey: 'mistaken-pos-payment', tenders: [{ method: 'cash', amount: view.totals.due }] });
      await s.admin.mutation(api.pos.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-mistaken-pos', reason: 'No money was actually received' });
    }
    expect(await s.row(id)).toMatchObject({ state: 'held' });
    expect(await s.coupon()).toMatchObject({ held: 1, heldDiscount: 180000, used: 0, discountGranted: 0 });
    await s.cancel(id);
    expect(await s.row(id)).toMatchObject({ state: 'released' });
    expect(await s.coupon()).toMatchObject({ held: 0, heldDiscount: 0, used: 0, discountGranted: 0 });
    await s.create({ checkIn: '2026-11-14', checkOut: '2026-11-16' });
    await s.reconcile();
  });

  it.each(['admin', 'web'] as const)('rejects zero-total coupon creates on %s without reserving anything', async source => {
    const s = await setup({ percent: 10000, maxSaving: 1000000 });
    await expect(source === 'admin' ? s.create() : s.web()).rejects.toThrow(/coupon_unavailable.*This code covers the whole stay, so it can't be booked online. Please contact us.*nothing_eligible/);
    expect(await s.t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query('couponRedemptions').take(10))).toHaveLength(0);
    expect(await s.t.run(ctx => ctx.db.query('dateBlocks').take(10))).toHaveLength(0);
    await s.reconcile();
  });

  it.each(['held', 'consumed'] as const)('quotes edits read-only with frozen rules and its own %s budget excluded', async state => {
    const s = await setup({ discountBudget: 270000, usageLimit: 1 });
    const id = await s.create();
    if (state === 'consumed') await s.pay(id);
    await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, benefit: { kind: 'percent', percent: 3000 } });
    const before = await s.get(id);
    const redemption = await s.row(id);
    const counters = await s.coupon();
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, { bookingId: id, propertySlug: 'mossbell', checkIn: before.checkIn, checkOut: '2026-11-13', guests: 2 });
    expect(quote).toEqual({ subtotal: 1350000, discountAmount: 270000, total: 1080000, currency: 'THB', promotion: { code: 'DCNT-F1-20', couponVersion: 1, discount: 270000 }, couponRemoved: false, repriced: true });
    expect(await s.get(id)).toEqual(before);
    expect(await s.row(id)).toEqual(redemption);
    expect(await s.coupon()).toEqual(counters);
    await s.edit(id, { checkOut: '2026-11-13' });
    expect(await s.get(id)).toMatchObject({ subtotal: quote.subtotal, discountAmount: quote.discountAmount, total: quote.total, currency: quote.currency, promotion: quote.promotion });
    await s.reconcile();
  });

  it('public custom-price projection hides historical coupon savings', async () => {
    const s = await setup();
    const { bookingId, accessToken } = await s.web();
    expect(await s.t.query(api.bookings.getById, { id: bookingId, accessToken })).toMatchObject({ customPrice: false, promotion: { discount: 180000 } });
    await s.edit(bookingId, { priceOverride: { total: 900000, reason: 'Full room rate agreed' } });
    const projected = await s.t.query(api.bookings.getById, { id: bookingId, accessToken });
    expect(projected).toMatchObject({ customPrice: true, total: 900000 });
    expect(projected!.promotion).toBeUndefined();
    expect((await s.get(bookingId)).promotion).toMatchObject({ discount: 180000 });
    await s.edit(bookingId, { priceOverride: null });
    expect(await s.t.query(api.bookings.getById, { id: bookingId, accessToken })).toMatchObject({ customPrice: false, total: 720000, promotion: { discount: 180000 } });
  });
});


describe('edit quote policy and lifecycle boundaries', () => {
  it.each([false, true])('quotes guest-only edits at stored totals even after rate/currency changes (custom=%s)', async custom => {
    const s = await setup();
    const id = await s.create();
    if (custom) await s.edit(id, { priceOverride: { total: 800000, reason: 'Agreed price' } });
    await s.pay(id);
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { pricePerNight: 600000, currency: 'USD' }));
    const b = await s.get(id);
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, { bookingId: id, propertySlug: 'mossbell', checkIn: b.checkIn, checkOut: b.checkOut, guests: 1 });
    expect(quote).toEqual({ subtotal: b.subtotal, discountAmount: b.discountAmount, total: b.total, currency: 'THB', promotion: custom ? null : { code: 'DCNT-F1-20', couponVersion: 1, discount: 180000 }, couponRemoved: false, repriced: false });
    await s.edit(id, { guests: 1 });
    expect((await s.get(id)).total).toBe(quote.total);
    await s.reconcile();
  });

  it('does not reprice a redundant clear-override request', async () => {
    const s = await setup();
    const id = await s.create();
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { pricePerNight: 600000 }));
    const args = { bookingId: id, propertySlug: 'mossbell', checkIn: s.input.checkIn, checkOut: s.input.checkOut, guests: 2, clearPriceOverride: true };
    expect(await s.admin.query(api.adminBookings.quoteBookingEdit, args)).toMatchObject({ total: 720000, repriced: false });
    await s.edit(id, { priceOverride: null });
    expect((await s.get(id)).total).toBe(720000);
    expect((await s.row(id)).discount).toBe(180000);
    await s.reconcile();
  });

  it.each(['minimum_nights', 'direct_better', 'wrong_property'] as const)('previews coupon removal and saves the direct fallback: %s', async reason => {
    const s = await setup();
    if (reason === 'wrong_property') await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, propertySlugs: ['mossbell'] });
    const id = await s.create();
    let propertyId = s.propertyId;
    let propertySlug = 'mossbell';
    const checkOut = reason === 'minimum_nights' ? '2026-11-11' : '2026-11-13';
    if (reason === 'direct_better') await s.t.run(ctx => ctx.db.patch(s.propertyId, { directDiscountPercent: 2500 }));
    if (reason === 'wrong_property') {
      await s.t.run(async ctx => {
        const property = (await ctx.db.get(s.propertyId))!;
        const { _id, _creationTime, ...fields } = property;
        void _id; void _creationTime;
        propertyId = await ctx.db.insert('properties', { ...fields, slug: 'other-villa' });
      });
      propertySlug = 'other-villa';
    }
    const before = await s.row(id);
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, { bookingId: id, propertySlug, checkIn: s.input.checkIn, checkOut, guests: 2 });
    expect(quote).toMatchObject({ promotion: null, couponRemoved: true, repriced: true });
    expect(await s.row(id)).toEqual(before);
    await s.edit(id, { propertyId, checkOut });
    const after = await s.get(id);
    expect({ subtotal: after.subtotal, discountAmount: after.discountAmount, total: after.total, currency: after.currency }).toEqual({ subtotal: quote.subtotal, discountAmount: quote.discountAmount, total: quote.total, currency: quote.currency });
    expect(after.promotion).toBeUndefined();
    expect((await s.row(id)).state).toBe('released');
    await s.reconcile();
  });

  it.each([false, true])('quotes override removal with the original coupon policy (stayChanged=%s)', async stayChanged => {
    const s = await setup();
    const id = await s.create();
    await s.edit(id, { priceOverride: { total: 800000, reason: 'Agreed price' } });
    const checkOut = stayChanged ? '2026-11-13' : s.input.checkOut;
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, { bookingId: id, propertySlug: 'mossbell', checkIn: s.input.checkIn, checkOut, guests: 2, clearPriceOverride: true });
    expect(quote).toMatchObject({ total: stayChanged ? 1080000 : 720000, promotion: { couponVersion: 1, discount: stayChanged ? 270000 : 180000 }, couponRemoved: false, repriced: true });
    expect((await s.get(id)).priceOverride).toBeDefined();
    await s.edit(id, { checkOut, priceOverride: null });
    expect((await s.get(id)).total).toBe(quote.total);
    expect((await s.get(id)).priceOverride).toBeUndefined();
    await s.reconcile();
  });

  it('quotes a stay with no coupon using the direct policy', async () => {
    const s = await setup();
    const id = await s.create({ couponCode: '' });
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, { bookingId: id, propertySlug: 'mossbell', checkIn: s.input.checkIn, checkOut: '2026-11-13', guests: 2 });
    expect(quote).toEqual({ subtotal: 1350000, discountAmount: 202500, total: 1147500, currency: 'THB', promotion: null, couponRemoved: false, repriced: true });
    await s.edit(id, { checkOut: '2026-11-13' });
    expect((await s.get(id)).total).toBe(quote.total);
  });

  it('requires admin and rejects invalid dates, capacity, currency, live checkout and cancelled stays', async () => {
    const s = await setup();
    const id = await s.create();
    const args = { bookingId: id, propertySlug: 'mossbell', checkIn: s.input.checkIn, checkOut: s.input.checkOut, guests: 2 };
    await expect(s.t.query(api.adminBookings.quoteBookingEdit, args)).rejects.toThrow(/Not authenticated/);
    await expect(s.admin.query(api.adminBookings.quoteBookingEdit, { ...args, checkOut: args.checkIn })).rejects.toThrow(/Check-out must be after check-in/);
    await expect(s.admin.query(api.adminBookings.quoteBookingEdit, { ...args, guests: 3 })).rejects.toThrow(/max capacity/);
    await s.edit(id, { priceOverride: { total: 800000, reason: 'Agreed price' } });
    await expect(s.admin.query(api.adminBookings.quoteBookingEdit, { ...args, checkOut: '2026-11-13' })).rejects.toThrow(/custom price/);
    await s.pay(id);
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { currency: 'USD' }));
    await expect(s.admin.query(api.adminBookings.quoteBookingEdit, { ...args, clearPriceOverride: true })).rejects.toThrow(/different currency/);
    await s.t.run(ctx => ctx.db.patch(id, { stripeCheckoutExpiresAt: NOW + 10000 }));
    await expect(s.admin.query(api.adminBookings.quoteBookingEdit, args)).rejects.toThrow(/Stripe checkout open/);
    await s.t.run(ctx => ctx.db.patch(id, { stripeCheckoutExpiresAt: undefined }));
    await s.cancel(id);
    await expect(s.admin.query(api.adminBookings.quoteBookingEdit, args)).rejects.toThrow(/Cancelled bookings are read-only/);
  });

  it('excludes its own occupied dates but rejects other bookings when quoting an extension', async () => {
    const s = await setup();
    const id = await s.create();
    await s.pay(id);
    const other = await s.create({ checkIn: '2026-11-13', checkOut: '2026-11-15' });
    await s.pay(other);
    const args = { bookingId: id, propertySlug: 'mossbell', checkIn: s.input.checkIn, checkOut: '2026-11-13', guests: 2 };
    expect(await s.admin.query(api.adminBookings.quoteBookingEdit, args)).toMatchObject({ total: 1080000 });
    await expect(s.admin.query(api.adminBookings.quoteBookingEdit, { ...args, checkOut: '2026-11-14' })).rejects.toThrow();
    await expect(s.edit(id, { checkOut: '2026-11-14' })).rejects.toThrow();
    expect((await s.row(id)).discount).toBe(180000);
    await s.reconcile();
  });

  it('voiding a cancelled mistaken payment releases its reversed use', async () => {
    const s = await setup();
    const id = await s.create();
    await s.pay(id);
    await s.cancel(id);
    expect((await s.row(id)).state).toBe('reversed');
    const payment = (await s.t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', id)).first()))!;
    await s.admin.mutation(api.adminBookings.cancelPayment, { bookingId: id, expectedRevision: (await s.get(id)).revision!, paymentId: payment._id, reason: 'Money was never received' });
    expect((await s.row(id)).state).toBe('released');
    expect(await s.coupon()).toMatchObject({ used: 0, discountGranted: 0, held: 0, heldDiscount: 0 });
    await s.reconcile();
  });

  it('keeps consumption when a mistaken payment is voided but an earlier deposit remains', async () => {
    const s = await setup();
    const id = await s.create();
    await s.t.run(async ctx => { const b = (await ctx.db.get(id))!; await writeBooking(ctx, b, { amountPaid: 10000 }, { actor: email, kind: 'deposit' }); });
    await s.pay(id);
    const payment = (await s.t.run(ctx => ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', q => q.eq('bookingId', id)).first()))!;
    await s.admin.mutation(api.adminBookings.cancelPayment, { bookingId: id, expectedRevision: (await s.get(id)).revision!, paymentId: payment._id, reason: 'Balance was never received' });
    expect((await s.get(id)).amountPaid).toBe(10000);
    expect((await s.row(id)).state).toBe('consumed');
    expect(await s.coupon()).toMatchObject({ used: 1, discountGranted: 180000, held: 0, heldDiscount: 0 });
    await s.reconcile();
  });
});

describe('edit save matches the reviewed quote', () => {
  const quoteArgs = (id: Id<'bookings'>, checkOut: string) => ({ bookingId: id, propertySlug: 'mossbell', checkIn: '2026-11-10', checkOut, guests: 2 });

  it('refuses a save whose price moved after the quote and saves the re-reviewed price', async () => {
    const s = await setup();
    const id = await s.create();
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, quoteArgs(id, '2026-11-13'));
    expect(quote.total).toBe(1080000);
    // The villa rate changes between preview and save.
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { pricePerNight: 600000 }));
    const before = await s.get(id);
    const redemption = await s.row(id);
    await expect(s.edit(id, { checkOut: '2026-11-13', expectedPrice: { total: quote.total, currency: quote.currency } }))
      .rejects.toThrow(/price changed .*Check the new price and save again/i);
    expect(await s.get(id)).toEqual(before);
    expect(await s.row(id)).toEqual(redemption);
    const fresh = await s.admin.query(api.adminBookings.quoteBookingEdit, quoteArgs(id, '2026-11-13'));
    expect(fresh.total).not.toBe(quote.total);
    await s.edit(id, { checkOut: '2026-11-13', expectedPrice: { total: fresh.total, currency: fresh.currency } });
    expect(await s.get(id)).toMatchObject({ total: fresh.total, promotion: { couponVersion: 1 } });
    await s.reconcile();
  });

  it('refuses a currency the staff did not review', async () => {
    const s = await setup();
    const id = await s.create();
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { currency: 'USD' }));
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, quoteArgs(id, '2026-11-13'));
    await expect(s.edit(id, { checkOut: '2026-11-13', expectedPrice: { total: quote.total, currency: 'THB' } })).rejects.toThrow(/price changed/i);
    expect((await s.get(id)).checkOut).toBe('2026-11-12');
  });

  it('checks a custom price against the total reviewed', async () => {
    const s = await setup();
    const id = await s.create();
    await expect(s.edit(id, { priceOverride: { total: 800000, reason: 'Agreed' }, expectedPrice: { total: 720000, currency: 'THB' } })).rejects.toThrow(/price changed/i);
    await s.edit(id, { priceOverride: { total: 800000, reason: 'Agreed' }, expectedPrice: { total: 800000, currency: 'THB' } });
    expect((await s.get(id)).total).toBe(800000);
  });

  it('keeps guest-only edits on frozen coupon pricing at the reviewed stored total', async () => {
    const s = await setup();
    const id = await s.create();
    await s.admin.mutation(api.marketing.saveCoupon, { ...s.rules, couponId: s.couponId, benefit: { kind: 'percent', percent: 3000 } });
    await s.t.run(ctx => ctx.db.patch(s.propertyId, { pricePerNight: 600000 }));
    const quote = await s.admin.query(api.adminBookings.quoteBookingEdit, { ...quoteArgs(id, '2026-11-12'), guests: 1 });
    expect(quote).toMatchObject({ total: 720000, repriced: false });
    await s.edit(id, { guests: 1, expectedPrice: { total: quote.total, currency: quote.currency } });
    expect(await s.get(id)).toMatchObject({ guests: 1, total: 720000, promotion: { couponVersion: 1, discount: 180000 } });
    await s.reconcile();
  });
});
