import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { type FunctionReturnType } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import schema from './schema';
import { api } from './_generated/api';
const modules = import.meta.glob('./**/*.ts');
const readers = api.pos.orderHistoryPages;
afterEach(() => vi.unstubAllEnvs());
it('authenticates every financial stream and rejects oversized or invalid pages', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  const t = convexTest(schema, modules), admin = t.withIdentity({ email: 'admin@example.com' });
  const { orderId } = await admin.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Tea', price: 1000 } });
  for (const reader of Object.values(readers)) {
    const args = { orderId, paginationOpts: { numItems: 20, cursor: null } };
    await expect(t.query(reader, args)).rejects.toThrow('Not authenticated');
    await expect(t.withIdentity({ email: 'outsider@example.com' }).query(reader, args)).rejects.toThrow('Not authorized');
    for (const n of [0, 51, 1.5]) await expect(admin.query(reader, { ...args, paginationOpts: { numItems: n, cursor: null } })).rejects.toThrow('Page size');
    expect((await admin.query(reader, args)).page).toEqual([]);
  }
});
it('pages past the getOrder 20/50 windows in all five independent ledgers without cross-order leakage', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  const t = convexTest(schema, modules), admin = t.withIdentity({ email: 'admin@example.com' });
  const { orderId } = await admin.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Tea', price: 1000 } });
  const { orderId: other } = await admin.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Other', price: 1000 } });
  await t.run(async ctx => {
    const staffId = await ctx.db.insert('staff', { name: 'Nok', role: 'Therapist', color: '#abc', status: 'active', workingHours: [], breaks: [], createdAt: 1, updatedAt: 1 });
    const serviceId = await ctx.db.insert('services', { slug: 'massage', name: 'Massage', description: '', category: 'Massage', durationMin: 60, bufferMin: 0, price: 10000, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: 1, updatedAt: 1 });
    const appointmentId = await insertFixture(ctx, 'appointments', { serviceId, staffId, start: 1, end: 2, blockedUntil: 2, guestName: 'A', guestPhone: '0812345678', source: 'admin', status: 'completed', paymentStatus: 'paid', price: 10000, currency: 'THB', confirmationCode: 'APPT-1', accessToken: 'local', createdAt: 1 });
    const propertyId = await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 10, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' });
    const bookingId = await insertFixture(ctx, 'bookings', { propertyId, guestName: 'A', guestPhone: '0812345678', checkIn: '2026-10-01', checkOut: '2026-10-02', guests: 1, nights: 1, subtotal: 10000, discountAmount: 0, total: 10000, currency: 'THB', amountPaid: 10000, paymentStatus: 'paid', status: 'confirmed', confirmationCode: 'STAY-1', createdAt: 1 });
    for (const receiptOrderId of [orderId, other]) {
      const line = (await ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', receiptOrderId)).first())!;
      for (let i = 1; i <= 61; i++) {
      await ctx.db.insert('orderCorrections', { orderId: receiptOrderId, sequence: i, kind: 'amended', reason: `Correction ${i}`, actor: 'admin@example.com', recordedAt: i, idempotencyKey: `${receiptOrderId}-${i}` });
      await ctx.db.insert('orderAudit', { orderId: receiptOrderId, at: i, actor: 'admin@example.com', kind: 'price_override', fromPrice: i, toPrice: i + 1, note: `Activity ${i}` });
      const refund = { orderId: receiptOrderId, amount: 100, currency: 'THB', method: 'cash' as const, reason: `Refund ${i}`, effectiveAt: i, recordedAt: i, recordedBy: 'admin@example.com', idempotencyKey: `${receiptOrderId}-${i}`, netBefore: 100 - i, netAfter: 99 - i };
      await ctx.db.insert('bookingRefunds', { ...refund, bookingId, context: 'credit' });
      await ctx.db.insert('appointmentRefunds', { ...refund, appointmentId });
      await ctx.db.insert('orderRefunds', { orderId: receiptOrderId, lineId: line._id, amount: 100, currency: 'THB', method: 'cash', reason: `Return ${i}`, idempotencyKey: `pos/orders:${receiptOrderId}:${i}`, createdBy: 'admin', createdByEmail: 'admin@example.com', createdAt: i, businessDate: '2026-11-12' });
      }
    }
  });
  for (const reader of Object.values(readers)) {
    let cursor: string | null = null;
    const seen: string[] = [];
    for (let page = 0; page < 4; page++) {
      const result: FunctionReturnType<typeof reader> = await admin.query(reader, { orderId, paginationOpts: { numItems: 20, cursor } });
      expect(result.page.length).toBe(page < 3 ? 20 : 1);
      expect(result.page.every(r => ('orderId' in r ? r.orderId : r.orderId) === orderId)).toBe(true);
      seen.push(...result.page.map(r => r._id));
      expect(result.isDone).toBe(page === 3); cursor = result.continueCursor;
    }
    expect(new Set(seen).size).toBe(61);
  }
  const view = await admin.query(api.pos.orders.getOrder, { orderId });
  expect(view!.corrections).toHaveLength(20); expect(view!.audit).toHaveLength(50);
});
