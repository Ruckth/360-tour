import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
// Independent first-pass business regressions. CONFIRMED REGRESSION cases intentionally
// assert the required behavior and fail until fixed; preserve implementer tests separately.
import { convexTest } from 'convex-test';
import { anyApi } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { localDateTimeUtc } from './lib/serviceSlots';

const api = anyApi;
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T03:00:00Z'));
  vi.stubEnv('ADMIN_EMAILS', 'order-audit@example.com');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'order-audit@example.com', tokenIdentifier: 'order-audit' });
  const staffId = await admin.mutation(api.adminServices.createStaff, {
    name: 'Audit therapist', role: 'Therapist', color: '#abc',
    workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: []
  });
  const serviceId = await admin.mutation(api.adminServices.createService, {
    slug: 'order-audit-service', name: 'Audit massage', description: '', category: 'Massage',
    durationMin: 60, bufferMin: 15, price: 120000, currency: 'THB', staffIds: [staffId]
  });
  const { propertyId, bookingId, appointmentId } = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', {
      slug: 'order-audit-villa', name: 'Audit villa', tagline: '', description: '', pricePerNight: 1000000,
      currency: 'THB', maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [],
      tourRoomIds: [], directDiscountPercent: 0, status: 'active'
    });
    const bookingId = await insertFixture(ctx, 'bookings', {
      propertyId, guestName: 'Booking guest', guestPhone: '+66 81 234 5678', guestPhoneDigits: '66812345678',
      checkIn: '2026-11-01', checkOut: '2026-11-04', guests: 2, nights: 3, subtotal: 3000000,
      discountAmount: 0, total: 3000000, currency: 'THB', amountPaid: 1000000,
      paymentStatus: 'pending', status: 'confirmed', accessToken: 'order-audit-token', createdAt: Date.now(),
      confirmationEmailsQueuedAt: Date.now()
    });
    const start = localDateTimeUtc('2026-11-02', '10:00');
    const appointmentId = await insertFixture(ctx, 'appointments', {
      serviceId, staffId, bookingId, start, end: start + 3600000, blockedUntil: start + 4500000,
      guestName: 'Appointment guest', guestPhone: '+66 81 234 5678', source: 'admin', status: 'booked',
      paymentStatus: 'unpaid', price: 120000, currency: 'THB', confirmationCode: 'SVC-ORDER-AUDIT',
      accessToken: 'order-audit-appointment-token', createdAt: Date.now()
    });
    return { propertyId, bookingId, appointmentId };
  });
  const view = async (orderId: Id<'orders'>) => (await admin.query(api.pos.getOrder, { orderId }))!;
  const review = async (orderId: Id<'orders'>, key = 'audit-attempt-0001') => {
    const data = await view(orderId);
    // The customer revision is part of what the cashier reviewed (customers.ts assertCustomerReviewed).
    const customerRevision = data.customer && 'revision' in data.customer ? data.customer.revision : undefined;
    return { orderId, idempotencyKey: key, expectedDue: data.totals.due, expectedRevision: data.order.revision,
      ...(customerRevision !== undefined ? { expectedCustomerRevision: customerRevision } : {}),
      tenders: data.totals.due ? [{ method: 'card' as const, amount: data.totals.due }] : [] };
  };
  const extra = () => admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Audit water', price: 9000 } });
  return { t, admin, staffId, serviceId, propertyId, bookingId, appointmentId, view, review, extra };
}

describe('Independent order audit: identity, customer and settlement', () => {
  it('creates standalone orders without inventing a customer, booking or legacy counter', async () => {
    const { t, admin, extra, view, review } = await setup();
    const { orderId } = await extra();
    const initial = await view(orderId);
    expect(initial.order).toMatchObject({ orderNumber: 1, state: 'unpaid', due: 9000 });
    expect(initial.customer).toBeNull();
    expect(initial.source).toBeNull();
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
    expect(await t.run(ctx => ctx.db.query('orderCounters').take(10))).toEqual(expect.arrayContaining([
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
    expect((await view(opened[0].orderId)).lines.filter((line: Doc<'orderLines'>) => line.bookingId === bookingId)).toHaveLength(1);
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
    expect(voided.lines).toEqual(paid.lines.map((line: Doc<'orderLines'>) => ({ ...line, remainingRefundableSatang: 0 })));
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
    expect((await view(orderId)).totals).toMatchObject({ total: 3000000, deposit: 1000000, due: 2000000 });
    const list = (filter: string) => admin.query(api.pos.listOrders, { filter, paginationOpts: { numItems: 50, cursor: null } });
    expect((await list('unpaid')).page).toMatchObject([{ _id: orderId, due: 2000000 }]);
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
    await expect(admin.mutation(api.pos.settleOrder, { ...args, expectedDue: 9100 })).rejects.toThrow('changed');
    await expect(admin.mutation(api.pos.settleOrder, { ...args, tenders: [{ method: 'card', amount: 4000 }] })).rejects.toThrow();
    await admin.mutation(api.pos.settleOrder, { ...args, tenders: [{ method: 'cash', amount: 4000, received: 10000 }, { method: 'promptpay', amount: 5000 }] });
    expect((await view(orderId)).payments).toHaveLength(2);
    const free = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Complimentary', price: 0 } });
    await expect(admin.mutation(api.pos.settleOrder, await review(free.orderId))).resolves.toMatchObject({ replayed: false });
  });
});

describe('Independent order audit: booking/source integrity', () => {
  it('REGRESSION COVERAGE: opening appointment before stay still charges the unpaid stay exactly once', async () => {
    const { admin, bookingId, appointmentId, view } = await setup();
    const appointmentOrder = await admin.mutation(api.pos.openOrderFor, { appointmentId });
    const stayOrder = await admin.mutation(api.pos.openOrderFor, { bookingId });
    expect(stayOrder.orderId).toBe(appointmentOrder.orderId);
    const data = await view(stayOrder.orderId);
    expect(data.lines.filter((line: Doc<'orderLines'>) => line.appointmentId === appointmentId)).toHaveLength(1);
    expect(data.lines.filter((line: Doc<'orderLines'>) => line.bookingId === bookingId)).toHaveLength(1);
    expect(data.totals.due).toBe(2120000);
  });

  it.each(['clear', 'remove'] as const)('REGRESSION COVERAGE: reopening a stay after %s restores its unpaid source charge', async operation => {
    const { admin, bookingId, view } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    if (operation === 'clear') await admin.mutation(api.pos.clearOrder, { orderId });
    else await admin.mutation(api.pos.removeLine, { lineId: (await view(orderId)).lines[0]._id });
    expect((await admin.mutation(api.pos.openOrderFor, { bookingId })).orderId).toBe(orderId);
    expect((await view(orderId)).lines.filter((line: Doc<'orderLines'>) => line.bookingId === bookingId)).toHaveLength(1);
  });

  it('reuses stay-first order for its appointment and prevents competing allocation/manual payments', async () => {
    const { admin, bookingId, appointmentId, view } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    expect(await admin.mutation(api.pos.openOrderFor, { appointmentId })).toEqual({ orderId });
    expect(await admin.mutation(api.pos.openOrderFor, { appointmentId })).toEqual({ orderId });
    expect((await view(orderId)).totals.due).toBe(2120000);
    await expect(admin.mutation(api.pos.attach, { bookingId })).rejects.toThrow('already on');
    await expect(admin.mutation(api.adminBookings.updateBooking, { bookingId, action: 'markPaid' })).rejects.toThrow('still open');
    await expect(admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId })).rejects.toThrow('still open');
  });

  it.each([
    ['price', { total: 3100000 }], ['dates', { checkOut: '2026-11-05', nights: 4 }],
    ['deposit', { amountPaid: 1500000 }], ['cancelled', { status: 'cancelled' }],
    ['externally paid', { paymentStatus: 'paid', amountPaid: 3000000 }],
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
    await t.run(ctx => ctx.db.patch(bookingId, { amountPaid: 1500000 }));
    await admin.mutation(api.pos.updateSourceLine, { lineId: (await view(orderId)).lines[0]._id });
    expect((await view(orderId)).totals.due).toBe(1500000);
    await expect(admin.mutation(api.pos.settleOrder, stale)).rejects.toThrow('changed');
    await admin.mutation(api.pos.settleOrder, await review(orderId));
    expect(await t.run(ctx => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 3000000 });
  });

  it.each(['price', 'start', 'cancelled', 'paid'] as const)('detects a changed appointment %s', async change => {
    const { t, admin, appointmentId, review, view } = await setup();
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
    const stale = await review(orderId);
    await t.run(async ctx => {
      const a = (await ctx.db.get(appointmentId))!;
      await ctx.db.patch(appointmentId, change === 'price' ? { price: 130000 } : change === 'start' ? { start: a.start + 3600000 } : change === 'cancelled' ? { status: 'cancelled' } : { paymentStatus: 'paid' });
    });
    expect((await view(orderId)).lines[0].sourceIssue).not.toBeNull();
    await expect(admin.mutation(api.pos.settleOrder, stale)).rejects.toThrow();
  });

  it('uses a linked additional order for an extended paid stay without rewriting the original receipt', async () => {
    const { t, admin, bookingId, view, review } = await setup();
    const original = await admin.mutation(api.pos.openOrderFor, { bookingId });
    await admin.mutation(api.pos.settleOrder, await review(original.orderId));
    const before = await view(original.orderId);
    await t.run(ctx => ctx.db.patch(bookingId, { total: 4000000, nights: 4, checkOut: '2026-11-05' }));
    const later = await admin.mutation(api.pos.openOrderFor, { bookingId });
    expect(later.orderId).not.toBe(original.orderId);
    expect((await view(later.orderId)).order.parentOrderId).toBe(original.orderId);
    expect((await view(later.orderId)).totals).toMatchObject({ total: 4000000, deposit: 3000000, due: 1000000 });
    await admin.mutation(api.pos.settleOrder, await review(later.orderId, 'audit-attempt-0002'));
    expect((await view(original.orderId)).order).toEqual(before.order);
    expect((await view(original.orderId)).lines).toEqual(before.lines);
    expect((await view(original.orderId)).payments).toEqual(before.payments);
  });

  it('REGRESSION COVERAGE: shared stay creation establishes an order before first checkout', async () => {
    const { t, admin } = await setup();
    const bookingId = await admin.mutation(api.adminBookings.createBooking, {
      propertySlug: 'order-audit-villa', guestName: 'New guest', guestPhone: '0812222222', checkIn: '2026-12-01', checkOut: '2026-12-03', guests: 2
    });
    expect((await admin.query(api.pos.ordersForBooking, { bookingId })).activeOrder).not.toBeNull();
    expect(await t.run(ctx => ctx.db.query('orders').take(10))).toHaveLength(1);
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
      await t.run(ctx => ctx.db.patch(bookingId, { stripeCheckoutSessionId: 'cs_order_audit', stripeCheckoutAmount: 2000000 }));
      await t.mutation(api.payments.completeCheckout, { bookingId, sessionId: 'cs_order_audit', amountTotal: 2000000, currency: 'thb', paymentIntentId: 'pi_order_audit' });
    }
    expect(await t.run(ctx => ctx.db.get(bookingId))).toMatchObject({ paymentStatus: 'paid', amountPaid: 3000000 });
    expect((await admin.query(api.pos.ordersForBooking, { bookingId })).balance.owed).toBe(0);
  });
});

describe('Independent order audit: legacy backfill', () => {

  it('REGRESSION COVERAGE: a legacy held order remains discoverable before its backfill page runs', async () => {
    const { t, admin } = await setup();
    const orderId = await t.run(ctx => insertFixture(ctx, 'orders', { status: 'draft', currency: 'THB', itemCount: 1,
      total: 9000, hasItems: true, revision: 1, createdBy: 'legacy', createdAt: 1, updatedAt: 1 }));
    const result = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 50, cursor: null } });
    expect(result.page.map((row: { _id: Id<'orders'> }) => row._id)).toContain(orderId);
  });

  it('CONFIRMED REGRESSION: paginates beyond 50 legacy held orders during the migration window', async () => {
    const { t, admin } = await setup();
    const ids = await t.run(async ctx => {
      const ids: Id<'orders'>[] = [];
      for (let i = 0; i < 51; i++) {
        const id = await insertFixture(ctx, 'orders', { status: 'draft', currency: 'THB', itemCount: 1, total: 9000,
          hasItems: true, revision: 1, createdBy: 'legacy', createdAt: i, updatedAt: i });
        await insertFixture(ctx, 'orderLines', { orderId: id, kind: 'extra', name: 'Legacy sale', unitPrice: 9000, currency: 'THB', qty: 1, createdAt: i });
        ids.push(id);
      }
      return ids;
    });
    const seen = new Set<Id<'orders'>>();
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const result: { page: Array<{ _id: Id<'orders'> }>; isDone: boolean; continueCursor: string } = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 50, cursor } });
      for (const row of result.page) seen.add(row._id);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect([...seen].sort()).toEqual([...ids].sort());
  });

  it('REGRESSION COVERAGE: source allocation cannot disappear behind 20 newer legacy history lines', async () => {
    const { t, admin, bookingId, appointmentId, extra, view } = await setup();
    await t.run(async ctx => {
      for (let i = 0; i < 22; i++) {
        const id = await insertFixture(ctx, 'orders', { status: i === 0 ? 'draft' : 'void', currency: 'THB', itemCount: 1, total: 120000,
          hasItems: true, revision: 1, ...(i ? { receiptNumber: i } : {}), createdBy: 'legacy', createdAt: i, updatedAt: i });
        await insertFixture(ctx, 'orderLines', { orderId: id, kind: 'appointment', appointmentId, name: 'Legacy appointment', unitPrice: 120000, currency: 'THB', qty: 1, createdAt: i });
        // Keep the open row unlinked: represents an ambiguous multi-booking legacy order.
        if (!i) await insertFixture(ctx, 'orderLines', { orderId: id, kind: 'booking', bookingId, name: 'Legacy stay', unitPrice: 3000000, currency: 'THB', qty: 1, createdAt: i });
      }
    });
    const newOrder = await extra();
    await expect(admin.mutation(api.pos.attach, { orderId: newOrder.orderId, appointmentId })).rejects.toThrow('already on');
    expect((await view(newOrder.orderId)).lines).toHaveLength(1);
  });
});

describe('Independent order audit: authorization', () => {
  it('public booking response does not expose the payer profile or order history', async () => {
    const { t, admin, bookingId } = await setup();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Private corporate payer', email: 'private-payer@example.com', notes: 'Private notes' });
    const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
    const data = await t.query(api.bookings.getById, { id: bookingId, accessToken: 'order-audit-token' });
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
      [api.pos.openOrderFor, { bookingId }], [api.pos.addItem, { item: { kind: 'extra', name: 'Unauthorized', price: 100 } }],
      [api.pos.attach, { orderId, bookingId }], [api.pos.updateLine, { lineId, qtyChange: 1 }],
      [api.pos.overrideLinePrice, { lineId, price: 100, note: 'Unauthorized' }], [api.pos.removeLine, { lineId }], [api.pos.updateSourceLine, { lineId }],
      [api.pos.linkCustomer, { orderId, customerId }], [api.pos.unlinkCustomer, { orderId }], [api.pos.saveOrder, { orderId }], [api.pos.clearOrder, { orderId }],
      [api.pos.settleOrder, { orderId, idempotencyKey: 'unauthorized-key', expectedDue: 9000, expectedRevision: 1, tenders: [{ method: 'card', amount: 9000 }] }],
      [api.pos.voidOrder, { orderId, reason: 'Unauthorized' }], [api.customers.createCustomer, { name: 'Unauthorized' }],
      [api.customers.updateCustomer, { customerId, name: 'Unauthorized' }]
    ] as const;
    for (const client of [t, t.withIdentity({ email: 'not-admin@example.com', tokenIdentifier: 'outsider' })]) {
      for (const [ref, args] of queries) await expect(client.query(ref, args)).rejects.toThrow(/Not authenticated|Not authorized/);
      for (const [ref, args] of mutations) await expect(client.mutation(ref, args)).rejects.toThrow(/Not authenticated|Not authorized/);
    }
  });
});
