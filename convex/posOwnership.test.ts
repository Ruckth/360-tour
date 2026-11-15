// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import { requireStaff } from './auth/model';
import { ensureLinkedOrder } from './pos/model';
import { orderLines } from './pos/private/orderLines';
import { executeOrderRefund, orderRefunds } from './pos/private/orderRefunds';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('rolls back the caller order counter and source link, then reuses one committed source order', async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const owner = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'owner' });
  const staffId = await owner.mutation(api.services.commands.createStaff.createStaff, { name: 'Mali', role: 'Therapist', color: '#abc', workingHours: [], breaks: [] });
  const serviceId = await owner.mutation(api.services.commands.createService.createService, { slug: 'massage', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0, price: 10000, currency: 'THB', staffIds: [staffId] });
  const appointmentId = await t.run(ctx => ctx.db.insert('appointments', {
    serviceId, staffId, start: 1, end: 2, blockedUntil: 2, guestName: 'Guest', guestPhone: '0800000000', source: 'admin',
    status: 'booked', paymentStatus: 'unpaid', price: 10000, currency: 'THB', confirmationCode: 'TEST', accessToken: 'test-only',
    revision: 0, createdAt: 1, guestPhoneDigits: '0800000000', amountPaid: 0, amountRefunded: 0, serviceNameSnapshot: 'Massage', staffNameSnapshot: 'Mali',
  }));
  const snapshot = () => t.run(async ctx => ({ orders: await ctx.db.query('orders').collect(), counters: await ctx.db.query('orderCounters').collect() }));
  const before = await snapshot();
  await expect(t.run(async ctx => { await ensureLinkedOrder(ctx, { appointmentId }, 'test'); throw new Error('abort caller'); })).rejects.toThrow('abort caller');
  expect(await snapshot()).toEqual(before);
  const first = await t.run(ctx => ensureLinkedOrder(ctx, { appointmentId }, 'test'));
  const second = await t.run(ctx => ensureLinkedOrder(ctx, { appointmentId }, 'test'));
  expect(second._id).toBe(first._id);
  expect(first.orderNumber).toBe(1);
});

it('rolls back refund money, order revision and both audits when the outer caller fails; replay writes once', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'owner' });
  const { orderId } = await owner.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Tea', price: 10000 } });
  await owner.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, expectedRevision: 1, expectedDue: 10000, idempotencyKey: 'settle-model-test', tenders: [{ method: 'cash', amount: 10000 }] });
  const [line] = await t.run(ctx => orderLines(ctx, orderId));
  const input = { orderId, lineId: line._id, amount: 1000, currency: 'THB', method: 'cash' as const, reason: 'Short service', idempotencyKey: 'refund-model-test' };
  const snapshot = () => t.run(async ctx => ({ order: await ctx.db.get(orderId), refunds: await orderRefunds(ctx, orderId),
    audit: await ctx.db.query('orderAudit').collect(), history: await ctx.db.query('recordChanges').collect() }));
  const before = await snapshot();
  await expect(owner.run(async ctx => { await executeOrderRefund(ctx, input, await requireStaff(ctx, 'checkout')); throw new Error('abort refund caller'); })).rejects.toThrow('abort refund caller');
  expect(await snapshot()).toEqual(before);
  const first = await owner.run(async ctx => executeOrderRefund(ctx, input, await requireStaff(ctx, 'checkout')));
  const replay = await owner.run(async ctx => executeOrderRefund(ctx, input, await requireStaff(ctx, 'checkout')));
  expect(first.replayed).toBe(false);
  expect(replay).toEqual({ ...first, replayed: true });
  const after = await snapshot();
  expect(after.refunds).toHaveLength(1);
  expect(after.order?.revision).toBe(before.order!.revision + 1);
  expect(after.audit).toHaveLength(before.audit.length + 1);
  expect(after.history).toHaveLength(before.history.length + 1);
});

it('retires lib implementations without compatibility registrations for anonymous and owner clients', async () => {
  const t = convexTest(schema, modules);
  for (const client of [t, t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'owner' })]) {
    for (const [module, name] of Object.entries({ orderLines: 'orderLines', orderRefunds: 'executeOrderRefund', lineLinks: 'activeSourceLink',
      orderLinks: 'ensureLinkedOrder', displayView: 'displayOrderState', orderLifecycle: 'liveFees', staffApprovalState: 'assertNoPendingApprovals' })) {
      await expect(client.mutation(makeFunctionReference<'mutation'>(`lib/${module}:${name}`), {})).rejects.toThrow(`Could not find module for: "lib/${module}"`);
    }
  }
});
