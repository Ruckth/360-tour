// @vitest-environment edge-runtime
// Independent final audit. Required-behavior assertions intentionally fail for confirmed gaps.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { orderBackfillPatch } from './lib/orderBackfill';
import { ensureLinkedOrder } from './lib/orderLinks';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('ADMIN_EMAILS', 'sol-final@example.com'));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'sol-final@example.com', tokenIdentifier: 'sol-final' });
  const ids = await t.run(async ctx => {
    const staffId = await ctx.db.insert('staff', { name: 'Original therapist', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: Date.now(), updatedAt: Date.now() });
    const serviceId = await ctx.db.insert('services', { slug: 'sol-final-service', name: 'Final massage', description: '', category: 'Massage', durationMin: 60, bufferMin: 0, price: 1200, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: Date.now(), updatedAt: Date.now() });
    const appointmentId = await ctx.db.insert('serviceAppointments', { serviceId, staffId, start: Date.now() + 86400000, end: Date.now() + 90000000, blockedUntil: Date.now() + 90000000, guestName: 'Unique appointment guest', guestPhone: '+66 81 123 4567', guestEmail: 'unique-appointment@example.com', source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: 'SVC-SOL-FINAL', accessToken: 'sol-final-test-token', createdAt: Date.now() });
    return { staffId, serviceId, appointmentId };
  });
  return { t, admin, ...ids };
}

describe('Independent final audit: appointment discovery and rollout/history', () => {
  it('rejects direct appointment payment while checkout charges it, using the real accepted arguments', async () => {
    const { admin, appointmentId } = await setup();
    await admin.mutation(api.pos.attach, { appointmentId });
    await expect(admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId })).rejects.toThrow(/still open|order/i);
  });

  it('finds a standalone appointment by the email promised in Add booking', async () => {
    const { admin, appointmentId } = await setup();
    const rows = await admin.query(api.pos.listAttachable, { query: 'unique-appointment@example.com' });
    expect(rows.map(row => row.id)).toContain(appointmentId);
  });

  it('finds a standalone appointment by digits regardless of stored phone formatting', async () => {
    const { admin, appointmentId } = await setup();
    const rows = await admin.query(api.pos.listAttachable, { query: '66811234567' });
    expect(rows.map(row => row.id)).toContain(appointmentId);
  });

  it('suggests a linked payer\'s standalone appointment when its email matches', async () => {
    const { admin, appointmentId } = await setup();
    const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Separate payer', email: 'unique-appointment@example.com' });
    const { orderId } = await admin.mutation(api.pos.linkCustomer, { customerId });
    const rows = await admin.query(api.pos.listAttachable, { orderId });
    expect(rows.map(row => row.id)).toContain(appointmentId);
  });

  it('shows the remaining deposited balance on a legacy unpaid row before its migration page', async () => {
    const { t, admin } = await setup();
    const orderId = await t.run(async ctx => {
      const id = await ctx.db.insert('bills', { status: 'held', currency: 'THB', createdBy: 'legacy', itemCount: 1, total: 30000, hasItems: true, revision: 1, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert('billLines', { billId: id, kind: 'booking', name: 'Legacy deposited stay', unitPrice: 30000, deposit: 10000, currency: 'THB', qty: 1, createdAt: 1 });
      return id;
    });
    expect((await admin.query(api.pos.getOrder, { orderId }))?.totals.due).toBe(20000);
    const rows = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 20, cursor: null } });
    expect(rows.page.find(row => row._id === orderId)?.due).toBe(20000);
  });

  it('preserves a legacy receipt therapist after the migration and a later staff rename', async () => {
    const { t, admin, staffId, serviceId } = await setup();
    const orderId = await t.run(async ctx => {
      const id = await ctx.db.insert('bills', { status: 'paid', receiptNumber: 17, currency: 'THB', createdBy: 'legacy', itemCount: 1, total: 1200, hasItems: true, revision: 1, createdAt: 1, updatedAt: 1 });
      await ctx.db.insert('billLines', { billId: id, kind: 'service', serviceId, staffId, name: 'Legacy massage', unitPrice: 1200, currency: 'THB', qty: 1, createdAt: 1 });
      const order = (await ctx.db.get(id))!;
      const patch = await orderBackfillPatch(ctx, order);
      if (patch) await ctx.db.patch(id, patch);
      return id;
    });
    const before = await admin.query(api.pos.getOrder, { orderId });
    expect(before?.lines[0].staffName).toBe('Original therapist');
    await admin.mutation(api.adminServices.updateStaff, { staffId, name: 'Renamed therapist' });
    const after = await admin.query(api.pos.getOrder, { orderId });
    expect(after?.lines[0].staffName).toBe(before?.lines[0].staffName);
  });
});


describe('Independent final recheck: attaching to an existing standalone order', () => {
  it('shows the charged appointment despite its own empty order, keeps payer/identity and reopens without duplicate charge', async () => {
    const { t, admin, appointmentId } = await setup();
    const placeholder = await t.run(ctx => ensureLinkedOrder(ctx, { appointmentId }, 'creation'));
    const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Separate extra', price: 90 } });
    const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Separate payer' });
    await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
    const before = await admin.query(api.pos.getOrder, { orderId });
    await admin.mutation(api.pos.attach, { orderId, appointmentId });
    const after = await admin.query(api.pos.getOrder, { orderId });
    expect(after?.source).toMatchObject({ id: appointmentId, reference: 'SVC-SOL-FINAL', guestName: 'Unique appointment guest' });
    expect(after?.customer?.name).toBe('Separate payer');
    expect(after?.order.orderNumber).toBe(before?.order.orderNumber);
    expect((await t.run(ctx => ctx.db.get(placeholder._id)))?.appointmentId).toBe(appointmentId);
    expect(await admin.mutation(api.pos.openOrderFor, { appointmentId })).toEqual({ orderId });
    expect((await admin.query(api.pos.getOrder, { orderId }))?.lines).toHaveLength(2);
    const orders = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 20, cursor: null } });
    expect(orders.page.find(row => row._id === orderId)?.bookingReference).toBe('SVC-SOL-FINAL');
    expect(orders.page.map(row => row._id)).not.toContain(placeholder._id);
  });
});
