import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
// Independent final audit. Required-behavior assertions intentionally fail for confirmed gaps.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { ensureLinkedOrder } from './lib/orderLinks';

const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('ADMIN_EMAILS', 'order-final@example.com'));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'order-final@example.com', tokenIdentifier: 'order-final' });
  const ids = await t.run(async ctx => {
    const staffId = await ctx.db.insert('staff', { name: 'Original therapist', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: Date.now(), updatedAt: Date.now() });
    const serviceId = await ctx.db.insert('services', { slug: 'order-final-service', name: 'Final massage', description: '', category: 'Massage', durationMin: 60, bufferMin: 0, price: 120000, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: Date.now(), updatedAt: Date.now() });
    const appointmentId = await insertFixture(ctx, 'appointments', { serviceId, staffId, start: Date.now() + 86400000, end: Date.now() + 90000000, blockedUntil: Date.now() + 90000000, guestName: 'Unique appointment guest', guestPhone: '+66 81 123 4567', guestEmail: 'unique-appointment@example.com', source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 120000, currency: 'THB', confirmationCode: 'SVC-ORDER-FINAL', accessToken: 'order-final-test-token', createdAt: Date.now() });
    return { staffId, serviceId, appointmentId };
  });
  return { t, admin, ...ids };
}

describe('Independent final audit: appointment discovery and rollout/history', () => {
  it('rejects direct appointment payment while checkout charges it, using the real accepted arguments', async () => {
    const { admin, appointmentId } = await setup();
    await admin.mutation(api.pos.commands.attach.attach, { appointmentId });
    await expect(admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId })).rejects.toThrow(/still open|order/i);
  });

  it('finds a standalone appointment by the email promised in Add booking', async () => {
    const { admin, appointmentId } = await setup();
    const rows = await admin.query(api.pos.sourceReads.listAttachable, { query: 'unique-appointment@example.com' });
    expect(rows.map(row => row.id)).toContain(appointmentId);
  });

  it('finds a standalone appointment by digits regardless of stored phone formatting', async () => {
    const { admin, appointmentId } = await setup();
    const rows = await admin.query(api.pos.sourceReads.listAttachable, { query: '66811234567' });
    expect(rows.map(row => row.id)).toContain(appointmentId);
  });

  it('suggests a linked payer\'s standalone appointment when its email matches', async () => {
    const { admin, appointmentId } = await setup();
    const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: 'Separate payer', email: 'unique-appointment@example.com' });
    const { orderId } = await admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { customerId });
    const rows = await admin.query(api.pos.sourceReads.listAttachable, { orderId });
    expect(rows.map(row => row.id)).toContain(appointmentId);
  });
});


describe('Independent final recheck: attaching to an existing standalone order', () => {
  it('shows the charged appointment despite its own empty order, keeps payer/identity and reopens without duplicate charge', async () => {
    const { t, admin, appointmentId } = await setup();
    const placeholder = await t.run(ctx => ensureLinkedOrder(ctx, { appointmentId }, 'creation'));
    const { orderId } = await admin.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Separate extra', price: 9000 } });
    const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: 'Separate payer' });
    await admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId });
    const before = await admin.query(api.pos.orders.getOrder, { orderId });
    await admin.mutation(api.pos.commands.attach.attach, { orderId, appointmentId });
    const after = await admin.query(api.pos.orders.getOrder, { orderId });
    expect(after?.source).toMatchObject({ id: appointmentId, reference: 'SVC-ORDER-FINAL', guestName: 'Unique appointment guest' });
    expect(after?.customer?.name).toBe('Separate payer');
    expect(after?.order.orderNumber).toBe(before?.order.orderNumber);
    expect((await t.run(ctx => ctx.db.get(placeholder._id)))?.appointmentId).toBe(appointmentId);
    expect(await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { appointmentId })).toEqual({ orderId });
    expect((await admin.query(api.pos.orders.getOrder, { orderId }))?.lines).toHaveLength(2);
    const orders = await admin.query(api.pos.orders.listOrders, { filter: 'unpaid', paginationOpts: { numItems: 20, cursor: null } });
    expect(orders.page.find(row => row._id === orderId)?.bookingReference).toBe('SVC-ORDER-FINAL');
    expect(orders.page.map(row => row._id)).not.toContain(placeholder._id);
  });
});
