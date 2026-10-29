// @vitest-environment edge-runtime
// Independent first-pass business regressions. CONFIRMED REGRESSION cases intentionally
// assert the required behavior and fail until fixed; preserve implementer tests separately.
import { convexTest } from 'convex-test';
import { anyApi } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { orderBackfillPatch, orderBackfillPlan } from './lib/orderBackfill';
import { localDateTimeUtc } from './lib/serviceSlots';

const api = anyApi;
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T03:00:00Z'));
  vi.stubEnv('ADMIN_EMAILS', 'sol-audit@example.com');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'sol-audit@example.com', tokenIdentifier: 'sol-audit' });
  const staffId = await admin.mutation(api.adminServices.createStaff, {
    name: 'Audit therapist', role: 'Therapist', color: '#abc',
    workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: []
  });
  const serviceId = await admin.mutation(api.adminServices.createService, {
    slug: 'sol-audit-service', name: 'Audit massage', description: '', category: 'Massage',
    durationMin: 60, bufferMin: 15, price: 1200, currency: 'THB', staffIds: [staffId]
  });
  const { propertyId, bookingId, appointmentId } = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', {
      slug: 'sol-audit-villa', name: 'Audit villa', tagline: '', description: '', pricePerNight: 10000,
      currency: 'THB', maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [],
      tourRoomIds: [], directDiscountPercent: 0, status: 'active'
    });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, guestName: 'Booking guest', guestPhone: '+66 81 234 5678', guestPhoneDigits: '66812345678',
      checkIn: '2026-11-01', checkOut: '2026-11-04', guests: 2, nights: 3, subtotal: 30000,
      discountAmount: 0, total: 30000, currency: 'THB', amountPaid: 10000,
      paymentStatus: 'pending', status: 'confirmed', accessToken: 'sol-audit-token', createdAt: Date.now(),
      confirmationEmailsQueuedAt: Date.now()
    });
    const start = localDateTimeUtc('2026-11-02', '10:00');
    const appointmentId = await ctx.db.insert('serviceAppointments', {
      serviceId, staffId, bookingId, start, end: start + 3600000, blockedUntil: start + 4500000,
      guestName: 'Appointment guest', guestPhone: '+66 81 234 5678', source: 'admin', status: 'booked',
      paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: 'SVC-SOL-AUDIT',
      accessToken: 'sol-audit-appointment-token', createdAt: Date.now()
    });
    return { propertyId, bookingId, appointmentId };
  });
  const view = async (orderId: Id<'bills'>) => (await admin.query(api.pos.getOrder, { orderId }))!;
  const review = async (orderId: Id<'bills'>, key = 'sol-attempt-0001') => {
    const data = await view(orderId);
    return { orderId, idempotencyKey: key, expectedDue: data.totals.due, expectedRevision: data.order.revision,
      tenders: data.totals.due ? [{ method: 'card' as const, amount: data.totals.due }] : [] };
  };
  const extra = () => admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Audit water', price: 90 } });
  return { t, admin, staffId, serviceId, propertyId, bookingId, appointmentId, view, review, extra };
}

describe('Sol independent order audit: identity, customer and settlement', () => {
  it('creates standalone orders without inventing a customer, booking or legacy counter', async () => {
    const { t, admin, extra, view, review } = await setup();
    const { orderId } = await extra();
    const initial = await view(orderId);
    expect(initial.order).toMatchObject({ orderNumber: 1, state: 'unpaid', due: 90 });
    expect(initial.customer).toBeNull();
    expect(initial.source).toBeNull();
    expect(initial.order.walkInNumber).toBeUndefined();
    await admin.mutation(api.pos.saveOrder, { orderId });
    expect((await view(orderId)).order.revision).toBe(initial.order.revision);
    vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));
    const args = await review(orderId);
    expect(await admin.mutation(api.pos.settleOrder, args)).toMatchObject({ replayed: false });
    expect(await admin.mutation(api.pos.settleOrder, args)).toMatchObject({ replayed: true });
    const paid = await view(orderId);
    expect(paid.order).toMatchObject({ orderNumber: 1, state: 'paid', due: 0 });
    expect(paid.receiptCustomer).toBeNull();
    expect(paid.payments).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query('billCounters').take(10))).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'order', value: 1 }), expect.objectContaining({ key: 'receipt', value: 1 })
    ]));
  });

  it('uses unique numbers for simultaneous standalone creation and one order for simultaneous stay opens', async () => {
    const { admin, extra, view, bookingId } = await setup();
    const sales = await Promise.all(Array.from({ length: 5 }, extra));
    const numbers = await Promise.all(sales.map(async ({ orderId }) => (await view(orderId)).order.orderNumber));
    expect(new Set(numbers).size).toBe(5);
    const opened = await Promise.all(Array.from({ length: 5 }, () => admin.mutation(api.pos.openOrderFor, { bookingId })));
    expect(new Set(opened.map(row => row.orderId)).size).toBe(1);
    expect((await view(opened[0].orderId)).lines.filter((line: Doc<'billLines'>) => line.bookingId === bookingId)).toHaveLength(1);
  });

  it('keeps same-name customers separate and supports one payer on multiple orders without changing the guest', async () => {
    const { t, admin, bookingId, extra, view, review } = await setup();
    const c1 = await admin.mutation(api.customers.createCustomer, { name: 'Same name', phone: '0811111111' });
    const c2 = await admin.mutation(api.customers.createCustomer, { name: 'Same name', phone: '0822222222' });
    expect(c1).not.toBe(c2);
    expect(await admin.query(api.customers.searchCustomers, { query: 'Same' })).toHaveLength(2);
    expect(await admin.query(api.customers.searchCustomers, { query: '0811111111' })).toMatchObject([{ _id: c1 }]);
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    const other = await extra();
    const stale = await review(orderId);
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId: c1 });
    await admin.mutation(api.pos.linkCustomer, { orderId: other.orderId, customerId: c1 });
    await expect(admin.mutation(api.pos.settleOrder, stale)).rejects.toThrow('changed');
    expect((await admin.query(api.customers.getCustomer, { customerId: c1 })).orders).toHaveLength(2);
    expect((await t.run(ctx => ctx.db.get(bookingId)))?.guestName).toBe('Booking guest');
    const number = (await view(orderId)).order.orderNumber;
    const linkedReview = await review(orderId);
    await admin.mutation(api.pos.unlinkCustomer, { orderId });
    await expect(admin.mutation(api.pos.settleOrder, linkedReview)).rejects.toThrow('changed');
    expect((await view(orderId)).order.orderNumber).toBe(number);
    await t.run(ctx => ctx.db.delete(c2));
    await expect(admin.mutation(api.pos.linkCustomer, { orderId, customerId: c2 })).rejects.toThrow('Customer not found');
  });

  it('freezes paid customer/items/tenders and preserves void history', async () => {
    const { admin, extra, view, review } = await setup();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Original payer', phone: '0811111111' });
    const { orderId, lineId } = await extra();
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
    await admin.mutation(api.pos.settleOrder, await review(orderId));
    const paid = await view(orderId);
    await admin.mutation(api.customers.updateCustomer, { customerId, name: 'New payer name', phone: '0999999999' });
    expect((await view(orderId)).receiptCustomer).toEqual({ name: 'Original payer', phone: '0811111111' });
    await expect(admin.mutation(api.pos.updateLine, { lineId, qtyChange: 1 })).rejects.toThrow('already paid');
    await expect(admin.mutation(api.pos.unlinkCustomer, { orderId })).rejects.toThrow('already paid');
    await admin.mutation(api.pos.voidOrder, { orderId, reason: 'Audit void' });
    const voided = await view(orderId);
    expect(voided.lines).toEqual(paid.lines);
    expect(voided.payments).toEqual(paid.payments);
    expect(voided.order.receiptNumber).toBe(paid.order.receiptNumber);
    expect(voided.order.orderNumber).toBe(paid.order.orderNumber);
    expect(voided.audit).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'paid' }), expect.objectContaining({ kind: 'void' })]));
  });

  it('REGRESSION COVERAGE: rejects a payment reviewed before the linked profile details changed', async () => {
    const { admin, extra, review } = await setup();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Reviewed payer' });
    const { orderId } = await extra();
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
    const reviewed = await review(orderId);
    await admin.mutation(api.customers.updateCustomer, { customerId, name: 'Different payer details' });
    await expect(admin.mutation(api.pos.settleOrder, reviewed)).rejects.toThrow(/changed|review/i);
  });

  it('REGRESSION COVERAGE: a paid receipt keeps the therapist name it was issued with', async () => {
    const { admin, serviceId, staffId, view, review } = await setup();
    const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
    await admin.mutation(api.pos.updateLine, { lineId, staffId });
    await admin.mutation(api.pos.settleOrder, await review(orderId));
    const before = await view(orderId);
    expect(before.lines[0].staffName).toBe('Audit therapist');
    await admin.mutation(api.adminServices.updateStaff, { staffId, name: 'Renamed therapist' });
    expect((await view(orderId)).lines[0].staffName).toBe(before.lines[0].staffName);
  });

  it('lists deposited stay balances, paid and void statuses correctly', async () => {
    const { admin, bookingId, extra, view, review } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    expect((await view(orderId)).totals).toMatchObject({ total: 30000, deposit: 10000, due: 20000 });
    const list = (filter: string) => admin.query(api.pos.listOrders, { filter, paginationOpts: { numItems: 50, cursor: null } });
    expect((await list('unpaid')).page).toMatchObject([{ _id: orderId, due: 20000 }]);
    const standalone = await extra();
    await admin.mutation(api.pos.settleOrder, await review(standalone.orderId));
    expect((await list('paid')).page).toMatchObject([{ _id: standalone.orderId, due: 0 }]);
    await admin.mutation(api.pos.voidOrder, { orderId: standalone.orderId, reason: 'Audit void' });
    expect((await list('paid')).page).toHaveLength(0);
    expect((await list('void')).page).toMatchObject([{ _id: standalone.orderId, due: 0 }]);
  });

  it('validates split tenders, cash change, stale amounts and a genuinely zero-price order', async () => {
    const { admin, extra, review, view } = await setup();
    const { orderId } = await extra();
    const args = await review(orderId);
    await expect(admin.mutation(api.pos.settleOrder, { ...args, expectedDue: 91 })).rejects.toThrow('changed');
    await expect(admin.mutation(api.pos.settleOrder, { ...args, tenders: [{ method: 'card', amount: 40 }] })).rejects.toThrow();
    await admin.mutation(api.pos.settleOrder, { ...args, tenders: [{ method: 'cash', amount: 40, received: 100 }, { method: 'promptpay', amount: 50 }] });
    expect((await view(orderId)).payments).toHaveLength(2);
    const free = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Complimentary', price: 0 } });
    await expect(admin.mutation(api.pos.settleOrder, await review(free.orderId))).resolves.toMatchObject({ replayed: false });
  });
});

describe('Sol independent order audit: booking/source integrity', () => {
  it('REGRESSION COVERAGE: opening appointment before stay still charges the unpaid stay exactly once', async () => {
    const { admin, bookingId, appointmentId, view } = await setup();
    const appointmentOrder = await admin.mutation(api.pos.openOrderFor, { appointmentId });
    const stayOrder = await admin.mutation(api.pos.openOrderFor, { bookingId });
    expect(stayOrder.orderId).toBe(appointmentOrder.orderId);
    const data = await view(stayOrder.orderId);
    expect(data.lines.filter((line: Doc<'billLines'>) => line.appointmentId === appointmentId)).toHaveLength(1);
    expect(data.lines.filter((line: Doc<'billLines'>) => line.bookingId === bookingId)).toHaveLength(1);
    expect(data.totals.due).toBe(21200);
  });

  it.each(['clear', 'remove'] as const)('REGRESSION COVERAGE: reopening a stay after %s restores its unpaid source charge', async operation => {
    const { admin, bookingId, view } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    if (operation === 'clear') await admin.mutation(api.pos.clearOrder, { orderId });
    else await admin.mutation(api.pos.removeLine, { lineId: (await view(orderId)).lines[0]._id });
    expect((await admin.mutation(api.pos.openOrderFor, { bookingId })).orderId).toBe(orderId);
    expect((await view(orderId)).lines.filter((line: Doc<'billLines'>) => line.bookingId === bookingId)).toHaveLength(1);
  });

  it('reuses stay-first order for its appointment and prevents competing allocation/manual payments', async () => {
    const { admin, bookingId, appointmentId, view } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    expect(await admin.mutation(api.pos.openOrderFor, { appointmentId })).toEqual({ orderId });
    expect(await admin.mutation(api.pos.openOrderFor, { appointmentId })).toEqual({ orderId });
    expect((await view(orderId)).totals.due).toBe(21200);
    await expect(admin.mutation(api.pos.attach, { bookingId })).rejects.toThrow('already on');
    await expect(admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'markPaid' })).rejects.toThrow('still open');
    await expect(admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId })).rejects.toThrow('still open');
  });

  it.each([
    ['price', { total: 31000 }], ['dates', { checkOut: '2026-11-05', nights: 4 }],
    ['deposit', { amountPaid: 15000 }], ['cancelled', { status: 'cancelled' }],
    ['externally paid', { paymentStatus: 'paid', amountPaid: 30000 }],
    ['refunded', { paymentStatus: 'refunded' }],
    ['online checkout', { stripeCheckoutExpiresAt: 1793332800000 + 86400000 }]
  ] as const)('rejects stale stay settlement after %s', async (_label, patch) => {
    const { t, admin, bookingId, view, review } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    const args = await review(orderId);
    await t.run(ctx => ctx.db.patch(bookingId, patch));
    expect((await view(orderId)).lines[0].sourceIssue).not.toBeNull();
    await expect(admin.mutation(api.pos.settleOrder, args)).rejects.toThrow();
    expect((await view(orderId)).payments).toHaveLength(0);
    expect((await view(orderId)).order.status).toBe('draft');
  });

  it('updates a changed deposit once, rejects the old revision and settles only the new balance', async () => {
    const { t, admin, bookingId, view, review } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    const stale = await review(orderId);
    await t.run(ctx => ctx.db.patch(bookingId, { amountPaid: 15000 }));
    await admin.mutation(api.pos.updateSourceLine, { lineId: (await view(orderId)).lines[0]._id });
    expect((await view(orderId)).totals.due).toBe(15000);
    await expect(admin.mutation(api.pos.settleOrder, stale)).rejects.toThrow('changed');
    await admin.mutation(api.pos.settleOrder, await review(orderId));
    expect(await t.run(ctx => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
  });

  it.each(['price', 'start', 'cancelled', 'paid'] as const)('detects a changed appointment %s', async change => {
    const { t, admin, appointmentId, review, view } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
    const stale = await review(orderId);
    await t.run(async ctx => {
      const a = (await ctx.db.get(appointmentId))!;
      await ctx.db.patch(appointmentId, change === 'price' ? { price: 1300 } : change === 'start' ? { start: a.start + 3600000 } : change === 'cancelled' ? { status: 'cancelled' } : { paymentStatus: 'paid' });
    });
    expect((await view(orderId)).lines[0].sourceIssue).not.toBeNull();
    await expect(admin.mutation(api.pos.settleOrder, stale)).rejects.toThrow();
  });

  it('uses a linked additional order for an extended paid stay without rewriting the original receipt', async () => {
    const { t, admin, bookingId, view, review } = await setup();
    const original = await admin.mutation(api.pos.openOrderFor, { bookingId });
    await admin.mutation(api.pos.settleOrder, await review(original.orderId));
    const before = await view(original.orderId);
    await t.run(ctx => ctx.db.patch(bookingId, { total: 40000, nights: 4, checkOut: '2026-11-05' }));
    const later = await admin.mutation(api.pos.openOrderFor, { bookingId });
    expect(later.orderId).not.toBe(original.orderId);
    expect((await view(later.orderId)).order.parentOrderId).toBe(original.orderId);
    expect((await view(later.orderId)).totals).toMatchObject({ total: 40000, deposit: 30000, due: 10000 });
    await admin.mutation(api.pos.settleOrder, await review(later.orderId, 'sol-attempt-0002'));
    expect((await view(original.orderId)).order).toEqual(before.order);
    expect((await view(original.orderId)).lines).toEqual(before.lines);
    expect((await view(original.orderId)).payments).toEqual(before.payments);
  });

  it('REGRESSION COVERAGE: shared stay creation establishes an order before first checkout', async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, {
      propertySlug: 'sol-audit-villa', guestName: 'New guest', guestPhone: '0812222222', checkIn: '2026-12-01', checkOut: '2026-12-03', guests: 2
    });
    expect((await admin.query(api.pos.ordersForBooking, { bookingId })).activeOrder).not.toBeNull();
    expect(await t.run(ctx => ctx.db.query('bills').take(10))).toHaveLength(1);
  });

  it('REGRESSION COVERAGE: shared appointment creation establishes an order before first checkout', async () => {
    const { admin, serviceId, staffId } = await setup();
    const { appointmentId } = await admin.mutation(api.adminServices.createAppointment, {
      serviceId, staffId, start: localDateTimeUtc('2026-11-03', '10:00'), guestName: '', guestPhone: ''
    });
    expect((await admin.query(api.pos.ordersForBooking, { appointmentId })).activeOrder).not.toBeNull();
  });

  it.each(['manual', 'stripe'] as const)('REGRESSION COVERAGE: %s full settlement of a deposited stay records the full paid amount', async method => {
    const { t, admin, bookingId } = await setup();
    if (method === 'manual') await admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'markPaid' });
    else {
      await t.run(ctx => ctx.db.patch(bookingId, { stripeCheckoutSessionId: 'cs_sol_audit' }));
      await t.mutation(api.payments.completeCheckout, { bookingId, sessionId: 'cs_sol_audit', amountTotal: 3000000, currency: 'thb', paymentIntentId: 'pi_sol_audit' });
    }
    expect(await t.run(ctx => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 30000 });
    expect((await admin.query(api.pos.ordersForBooking, { bookingId })).balance.owed).toBe(0);
  });
});

describe('Sol independent order audit: legacy backfill', () => {
  it('registered migration dry run rolls back its counter/row writes and one-batch cursors resume safely', async () => {
    const { t } = await setup();
    const ids = await t.run(async ctx => {
      const ids: Id<'bills'>[] = [];
      for (let i = 0; i < 3; i++) ids.push(await ctx.db.insert('bills', { status: 'held', currency: 'THB', itemCount: 0, total: 0,
        hasItems: false, revision: 0, createdBy: 'legacy', createdAt: i, updatedAt: i }));
      return ids;
    });
    const before = await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))));
    await expect(t.mutation(api.migrations.backfillOrders, { oneBatchOnly: true, cursor: null, batchSize: 1, dryRun: true })).rejects.toThrow('DRY RUN');
    expect(await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))))).toEqual(before);
    expect(await t.run(ctx => ctx.db.query('billCounters').take(10))).toHaveLength(0);
    let cursor: string | null = null;
    for (let i = 0; i < 3; i++) {
      const result: { processed: number; continueCursor: string } = await t.mutation(api.migrations.backfillOrders, { oneBatchOnly: true, cursor, batchSize: 1, dryRun: false });
      expect(result.processed).toBe(1);
      cursor = result.continueCursor;
    }
    const after = await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))));
    expect(after.map(row => row!.orderNumber)).toEqual([1, 2, 3]);
    expect(after.map(row => row!.status)).toEqual(['draft', 'draft', 'draft']);
    const verified = await t.query(api.migrations.verifyOrderBackfill, { paginationOpts: { numItems: 50, cursor: null } });
    expect(verified.problems).toEqual([]);
    await t.mutation(api.migrations.backfillOrders, { oneBatchOnly: true, cursor: null, batchSize: 10, dryRun: false });
    expect(await t.run(ctx => Promise.all(ids.map(id => ctx.db.get(id))))).toEqual(after);
  });

  it('migrates an anonymous standalone appointment without fabricating a customer or stay', async () => {
    const { t, appointmentId } = await setup();
    await t.run(async ctx => {
      await ctx.db.patch(appointmentId, { bookingId: undefined, guestName: '', guestPhone: '' });
      const id = await ctx.db.insert('bills', { status: 'draft', currency: 'THB', itemCount: 1, total: 1200,
        hasItems: true, revision: 1, createdBy: 'legacy', createdAt: 1, updatedAt: 1 });
      await ctx.db.insert('billLines', { billId: id, kind: 'appointment', appointmentId, name: 'Legacy appointment', unitPrice: 1200, currency: 'THB', qty: 1, createdAt: 1 });
      const plan = await orderBackfillPlan(ctx, (await ctx.db.get(id))!);
      expect(plan.patch).toMatchObject({ appointmentId, due: 1200 });
      expect(plan.patch.bookingId).toBeUndefined();
      expect(plan.patch.customerSnapshot).toBeUndefined();
      expect(plan.patch.customerId).toBeUndefined();
    });
  });

  it('REGRESSION COVERAGE: a legacy held order remains discoverable before its backfill page runs', async () => {
    const { t, admin } = await setup();
    const orderId = await t.run(ctx => ctx.db.insert('bills', { status: 'held', guestName: 'Legacy guest', currency: 'THB', itemCount: 1,
      total: 90, hasItems: true, revision: 1, createdBy: 'legacy', createdAt: 1, updatedAt: 1 }));
    const result = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 50, cursor: null } });
    expect(result.page.map((row: { _id: Id<'bills'> }) => row._id)).toContain(orderId);
  });

  it('CONFIRMED REGRESSION: paginates beyond 50 legacy held orders during the migration window', async () => {
    const { t, admin } = await setup();
    const ids = await t.run(async ctx => {
      const ids: Id<'bills'>[] = [];
      for (let i = 0; i < 51; i++) {
        const id = await ctx.db.insert('bills', { status: 'held', currency: 'THB', itemCount: 1, total: 90,
          hasItems: true, revision: 1, createdBy: 'legacy', createdAt: i, updatedAt: i });
        await ctx.db.insert('billLines', { billId: id, kind: 'extra', name: 'Legacy sale', unitPrice: 90, currency: 'THB', qty: 1, createdAt: i });
        ids.push(id);
      }
      return ids;
    });
    const seen = new Set<Id<'bills'>>();
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const result: { page: Array<{ _id: Id<'bills'> }>; isDone: boolean; continueCursor: string } = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 50, cursor } });
      for (const row of result.page) seen.add(row._id);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('previews without writes, migrates draft/held/paid/void conservatively, preserves IDs/history and reruns idempotently', async () => {
    const { t, bookingId, appointmentId } = await setup();
    await t.run(async ctx => {
      const ids: Id<'bills'>[] = [];
      for (const status of ['draft', 'held', 'paid', 'void'] as const) {
        const orderId = await ctx.db.insert('bills', {
          status, walkInNumber: 7, guestName: 'Legacy same name', guestPhone: '0811111111', currency: 'THB', itemCount: 2,
          total: 31200, hasItems: true, revision: 4, ...(status === 'paid' || status === 'void' ? { receiptNumber: ids.length + 100 } : {}),
          createdBy: 'legacy', createdAt: Date.now(), updatedAt: Date.now()
        });
        ids.push(orderId);
        await ctx.db.insert('billLines', { billId: orderId, kind: 'booking', bookingId, name: 'Legacy stay', unitPrice: 30000, deposit: 10000, currency: 'THB', qty: 1, createdAt: 1 });
        await ctx.db.insert('billLines', { billId: orderId, kind: 'appointment', appointmentId, name: 'Legacy massage', unitPrice: 1200, currency: 'THB', qty: 1, createdAt: 1 });
        if (status === 'paid' || status === 'void') {
          await ctx.db.insert('billPayments', { billId: orderId, method: 'cash', amount: 21200, idempotencyKey: 'legacy-payment', createdBy: 'legacy', createdAt: 1 });
          await ctx.db.insert('billAudit', { billId: orderId, kind: 'paid', actor: 'legacy', at: 1 });
        }
      }
      const beforeOrders = await Promise.all(ids.map(id => ctx.db.get(id)));
      const beforeLines = await ctx.db.query('billLines').take(100);
      const beforePayments = await ctx.db.query('billPayments').take(100);
      const beforeAudit = await ctx.db.query('billAudit').take(100);
      for (const order of beforeOrders) await orderBackfillPlan(ctx, order!);
      expect(await Promise.all(ids.map(id => ctx.db.get(id)))).toEqual(beforeOrders);
      expect(await ctx.db.query('billCounters').take(10)).toHaveLength(0);
      for (const id of ids) {
        const patch = await orderBackfillPatch(ctx, (await ctx.db.get(id))!);
        if (patch) await ctx.db.patch(id, patch);
      }
      const migrated = await Promise.all(ids.map(id => ctx.db.get(id)));
      expect(migrated.map(order => order!.orderNumber)).toEqual([1, 2, 3, 4]);
      expect(migrated.map(order => order!.due)).toEqual([21200, 21200, 0, 0]);
      expect(migrated[0]!.bookingId).toBe(bookingId);
      expect(migrated[1]!.bookingId).toBeUndefined(); // competing legacy open row is left for review
      expect(migrated[1]!.status).toBe('draft');
      expect(migrated[2]!.customerSnapshot).toEqual({ name: 'Legacy same name', phone: '0811111111' });
      expect(migrated[2]!.receiptNumber).toBe(102);
      expect(await ctx.db.query('customers').take(10)).toHaveLength(0);
      for (const order of migrated) expect(await orderBackfillPatch(ctx, order!)).toBeUndefined();
      expect(await ctx.db.query('billLines').take(100)).toEqual(beforeLines);
      expect(await ctx.db.query('billPayments').take(100)).toEqual(beforePayments);
      expect(await ctx.db.query('billAudit').take(100)).toEqual(beforeAudit);
      expect((await ctx.db.query('billCounters').first())!.value).toBe(4);
    });
  });

  it('leaves ambiguous multiple-stay history unlinked rather than inventing a relationship', async () => {
    const { t, bookingId } = await setup();
    await t.run(async ctx => {
      const booking = (await ctx.db.get(bookingId))!;
      const { _id: ignoredId, _creationTime: ignoredTime, ...fields } = booking;
      void ignoredId; void ignoredTime;
      const second = await ctx.db.insert('bookings', { ...fields, guestName: 'Other guest' });
      const id = await ctx.db.insert('bills', { status: 'paid', receiptNumber: 5, currency: 'THB', itemCount: 2, total: 60000, hasItems: true, revision: 2, createdBy: 'legacy', createdAt: 1, updatedAt: 1 });
      for (const source of [bookingId, second]) await ctx.db.insert('billLines', { billId: id, kind: 'booking', bookingId: source, name: 'Stay', unitPrice: 30000, currency: 'THB', qty: 1, createdAt: 1 });
      const plan = await orderBackfillPlan(ctx, (await ctx.db.get(id))!);
      expect(plan.patch.bookingId).toBeUndefined();
      expect(plan.notes.join(' ')).toContain('2 booking(s)');
    });
  });

  it('CONFIRMED REGRESSION: a missing appointment source does not make a historical multi-stay order unambiguous', async () => {
    const { t, bookingId, appointmentId } = await setup();
    await t.run(async ctx => {
      const { _id: ignoredId, _creationTime: ignoredTime, ...booking } = (await ctx.db.get(bookingId))!;
      void ignoredId; void ignoredTime;
      const otherStay = await ctx.db.insert('bookings', { ...booking, guestName: 'Second booking guest' });
      const id = await ctx.db.insert('bills', { status: 'paid', receiptNumber: 5, currency: 'THB', itemCount: 2, total: 31200,
        hasItems: true, revision: 2, createdBy: 'legacy', createdAt: 1, updatedAt: 1 });
      await ctx.db.insert('billLines', { billId: id, kind: 'booking', bookingId: otherStay, name: 'Other stay', unitPrice: 30000, currency: 'THB', qty: 1, createdAt: 1 });
      await ctx.db.insert('billLines', { billId: id, kind: 'appointment', appointmentId, name: 'First stay appointment', unitPrice: 1200, currency: 'THB', qty: 1, createdAt: 1 });
      // This bill charged two stays. Once the appointment was deleted, its stay is unknown;
      // migration must flag the missing source rather than infer one booking from partial data.
      await ctx.db.delete(appointmentId);
      const plan = await orderBackfillPlan(ctx, (await ctx.db.get(id))!);
      expect(plan.patch.bookingId).toBeUndefined();
      expect(plan.notes.join(' ')).toMatch(/no longer exists|missing|unknown/i);
    });
  });

  it('REGRESSION COVERAGE: source allocation cannot disappear behind 20 newer legacy history lines', async () => {
    const { t, admin, bookingId, appointmentId, extra, view } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < 22; i++) {
        const id = await ctx.db.insert('bills', { status: i === 0 ? 'draft' : 'void', currency: 'THB', itemCount: 1, total: 1200,
          hasItems: true, revision: 1, ...(i ? { receiptNumber: i } : {}), createdBy: 'legacy', createdAt: i, updatedAt: i });
        await ctx.db.insert('billLines', { billId: id, kind: 'appointment', appointmentId, name: 'Legacy appointment', unitPrice: 1200, currency: 'THB', qty: 1, createdAt: i });
        // Keep the open row unlinked: represents an ambiguous multi-booking legacy order.
        if (!i) await ctx.db.insert('billLines', { billId: id, kind: 'booking', bookingId, name: 'Legacy stay', unitPrice: 30000, currency: 'THB', qty: 1, createdAt: i });
      }
    });
    const newOrder = await extra();
    await expect(admin.mutation(api.pos.attach, { orderId: newOrder.orderId, appointmentId })).rejects.toThrow('already on');
    expect((await view(newOrder.orderId)).lines).toHaveLength(1);
  });
});

describe('Sol independent order audit: authorization', () => {
  it('public booking response does not expose the payer profile or order history', async () => {
    const { t, admin, bookingId } = await setup();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Private corporate payer', email: 'private-payer@example.com', notes: 'Private notes' });
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
    const data = await t.query(api.bookings.getById, { id: bookingId, accessToken: 'sol-audit-token' });
    expect(data._id).toBe(bookingId);
    expect(data.customerId).toBeUndefined();
    expect(data.customerSnapshot).toBeUndefined();
    expect(data.orderId).toBeUndefined();
    expect(data.orders).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('Private corporate payer');
  });

  it('rejects anonymous/non-admin access to every new POS and customer endpoint', async () => {
    const { t, admin, extra, bookingId } = await setup();
    const { orderId, lineId } = await extra();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Private payer' });
    const queries = [
      [api.pos.catalog, {}], [api.pos.getOrder, { orderId }], [api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 10, cursor: null } }],
      [api.pos.findOrderByNumber, { orderNumber: 1 }], [api.pos.ordersForBooking, { bookingId }], [api.pos.listAttachable, { orderId }],
      [api.customers.searchCustomers, { query: 'Private' }], [api.customers.getCustomer, { customerId }]
    ] as const;
    const mutations = [
      [api.pos.openOrderFor, { bookingId }], [api.pos.addItem, { item: { kind: 'extra', name: 'Unauthorized', price: 1 } }],
      [api.pos.attach, { orderId, bookingId }], [api.pos.updateLine, { lineId, qtyChange: 1 }],
      [api.pos.overrideLinePrice, { lineId, price: 1, note: 'Unauthorized' }], [api.pos.removeLine, { lineId }], [api.pos.updateSourceLine, { lineId }],
      [api.pos.linkCustomer, { orderId, customerId }], [api.pos.unlinkCustomer, { orderId }], [api.pos.saveOrder, { orderId }], [api.pos.clearOrder, { orderId }],
      [api.pos.settleOrder, { orderId, idempotencyKey: 'unauthorized-key', expectedDue: 90, expectedRevision: 1, tenders: [{ method: 'card', amount: 90 }] }],
      [api.pos.voidOrder, { orderId, reason: 'Unauthorized' }], [api.customers.createCustomer, { name: 'Unauthorized' }],
      [api.customers.updateCustomer, { customerId, name: 'Unauthorized' }]
    ] as const;
    for (const client of [t, t.withIdentity({ email: 'not-admin@example.com', tokenIdentifier: 'outsider' })]) {
      for (const [ref, args] of queries) await expect(client.query(ref, args)).rejects.toThrow(/Not authenticated|Not authorized/);
      for (const [ref, args] of mutations) await expect(client.mutation(ref, args)).rejects.toThrow(/Not authenticated|Not authorized/);
    }
  });
});
