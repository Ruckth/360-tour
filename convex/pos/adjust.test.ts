// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import type { FunctionArgs } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { resolveCommerceSettings } from '../commerce/model';
import * as budgets from '../lib/readBudget';
import schema from '../schema';
import { DEFAULT_CASHIER_RULES } from '../shared/staffTypes';
import { termsOf } from './private/paymentCommerce';

const modules = import.meta.glob('/convex/**/*.ts');
const { adjust, approve } = api.pos.commands.adjust;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function setup({ cutover = true } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-19T04:00:00Z'));
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const t = convexTest(schema, modules);
  const now = Date.now();
  const identity = (role: string) => t.withIdentity({
    tokenIdentifier: role, email: `${role}@example.com`, emailVerified: true,
  });
  const ids = await t.run(async ctx => {
    for (const role of ['manager', 'cashier'] as const) await ctx.db.insert('staffGrants', {
      role, email: `${role}@example.com`, tokenIdentifier: role, createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
    });
    if (cutover) await ctx.db.insert('commerceSettings', {
      key: 'default', ...resolveCommerceSettings(null), paymentsMode: 'attempts',
    });
    const orderId = await ctx.db.insert('orders', {
      status: 'paid', orderNumber: 1, receiptNumber: 100, currency: 'THB', itemCount: 1, hasItems: true,
      total: 120000, due: 0, revision: 3, paidAt: now, customerSnapshot: { name: 'Original payer' },
      createdAt: now, updatedAt: now, createdBy: 'cashier',
    });
    const paymentId = await ctx.db.insert('orderPayments', {
      orderId, method: 'card', amount: 120000, idempotencyKey: 'card-payment', createdAt: now, createdBy: 'cashier',
    });
    const serviceId = await ctx.db.insert('services', {
      name: 'Massage', slug: 'massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
      price: 120000, currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
    });
    const lineId = await ctx.db.insert('orderLines', {
      orderId, serviceId, kind: 'service', name: 'Massage', currency: 'THB', qty: 1,
      unitPrice: 120000, catalogUnitPrice: 120000, createdAt: now,
    });
    const propertyId = await ctx.db.insert('properties', {
      slug: 'pool-villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 850000, currency: 'THB',
      maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 145, images: [], amenities: [],
      tourRoomIds: [], directDiscountPercent: 0, status: 'active',
    });
    return { orderId, lineId, paymentId, serviceId, propertyId };
  });
  return { t, now, owner: identity('owner'), manager: identity('manager'), cashier: identity('cashier'), ...ids };
}

function amend(orderId: Id<'orders'>) {
  return {
    target: { targetType: 'order', targetId: orderId }, kind: 'amendPayment', expectedRevision: 0, clientKey: 'payment-fix',
    input: { tenders: [{ method: 'cash', amount: 120000 }] }, reasonCode: 'staffMistake',
  } satisfies FunctionArgs<typeof adjust>;
}

it('applies and replays a receipt correction with one audit and linked correction, preserving the issued sale', async () => {
  const { t, manager, orderId, lineId, paymentId } = await setup();
  const edit = amend(orderId);
  const result = await manager.mutation(adjust, edit);
  expect(result).toMatchObject({ status: 'applied', revision: 1, effects: [{ kind: 'orderCorrection' }] });
  expect(await manager.mutation(adjust, edit)).toEqual(result);
  await expect(manager.mutation(adjust, { ...edit, input: { tenders: [{ method: 'transfer', amount: 120000 }] } }))
    .rejects.toMatchObject({ data: { code: 'ADJUSTMENT_KEY_CONFLICT' } });
  await expect(manager.mutation(adjust, { ...edit, clientKey: 'new-key' }))
    .rejects.toMatchObject({ data: { code: 'STALE_ADJUSTMENT_REVISION', currentRevision: 1 } });
  await t.run(async ctx => {
    const history = await ctx.db.query('commerceAdjustments').collect();
    const corrections = await ctx.db.query('orderCorrections').collect();
    expect(history).toHaveLength(1);
    expect(corrections).toHaveLength(1);
    expect(history[0]).toMatchObject({
      targetType: 'order', targetId: orderId, kind: 'amendPayment', actor: 'manager',
      before: { tenders: [{ method: 'card', amount: 120000 }] }, after: edit.input,
      revisionBefore: 0, revisionAfter: 1, effects: [{ kind: 'orderCorrection', id: corrections[0]._id }],
    });
    expect(await ctx.db.get(paymentId)).toMatchObject({ method: 'card', amount: 120000 });
    expect(await ctx.db.get(lineId)).toMatchObject({ unitPrice: 120000 });
    expect(await ctx.db.get(orderId)).toMatchObject({
      correctionRevision: 1, commerceRevision: 1, revision: 3, receiptNumber: 100, amendedTenders: edit.input.tenders,
    });
  });
});

it('routes a cashier payment fix through one manager request and applies it once', async () => {
  const { t, manager, cashier, orderId } = await setup();
  const edit = amend(orderId);
  const request = await cashier.mutation(adjust, edit);
  if (request.status !== 'approvalRequired') throw new Error('Expected manager approval');
  expect(await cashier.mutation(adjust, edit)).toEqual(request);
  await expect(cashier.mutation(adjust, { ...edit, reasonCode: 'other' }))
    .rejects.toMatchObject({ data: { code: 'INVALID_ADJUSTMENT_REASON' } });
  await expect(cashier.mutation(adjust, { ...edit, reasonText: 'Changed payload' }))
    .rejects.toMatchObject({ data: { code: 'ADJUSTMENT_KEY_CONFLICT' } });
  await expect(cashier.mutation(approve, { requestId: request.requestId })).rejects.toThrow('Not authorized');
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').first())).toBeNull();
  const result = await manager.mutation(approve, { requestId: request.requestId });
  expect(result).toMatchObject({ status: 'applied', revision: 1 });
  expect(await manager.mutation(approve, { requestId: request.requestId })).toEqual(result);
  expect(await cashier.mutation(adjust, edit)).toEqual(request);
  await t.run(async ctx => {
    expect(await ctx.db.query('commerceAdjustments').collect()).toMatchObject([{
      requesterKey: 'cashier', approvalId: request.requestId, actor: 'manager', clientKey: `approval:${request.requestId}`,
    }]);
    expect(await ctx.db.get(request.requestId)).toMatchObject({ status: 'applied', approverTokenIdentifier: 'manager' });
    expect(await ctx.db.get(orderId)).toMatchObject({ commerceRevision: 1 });
    expect(await ctx.db.query('orderCorrections').collect()).toHaveLength(1);
  });
});

it('corrects only external methods on a voucher-funded receipt and counts vouchers in the tender cap', async () => {
  const { t, manager, now, orderId, lineId } = await setup();
  const vouchers = await t.run(async ctx => {
    const branchId = await ctx.db.insert('branches', { key: 'default' });
    const rules = resolveCommerceSettings(null);
    return await Promise.all([1, 2].map(async index => {
      const voucherId = await ctx.db.insert('vouchers', {
        branchId, source: { kind: 'sale', orderId, lineId }, faceValue: 10000, paidBalance: 0, goodwillBalance: 0,
        issuedExpiresAt: now + 86400000, effectiveExpiresAt: now + 86400000, status: 'active',
        revision: 1, settingsRevision: rules.revision, terms: termsOf(rules),
      });
      await ctx.db.insert('orderPayments', {
        orderId, method: 'voucher', voucherId, amount: 10000, idempotencyKey: `voucher-${index}`, createdAt: now, createdBy: 'cashier',
      });
      return voucherId;
    }));
  });
  const edit = amend(orderId);
  await expect(manager.mutation(adjust, { ...edit, input: { tenders: [
    { method: 'cash', amount: 60000 }, { method: 'transfer', amount: 60000 },
  ] } })).rejects.toMatchObject({ data: { code: 'ADJUSTMENT_INVALID_PAYMENT' } });
  await expect(manager.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, {
    orderId, tenders: edit.input.tenders, expectedCorrectionRevision: 0, reason: 'Staff mistake', idempotencyKey: 'old-payment-fix',
  })).rejects.toMatchObject({ data: { code: 'COMMERCE_CORRECTION_UNAVAILABLE' } });
  expect(await manager.mutation(adjust, edit)).toMatchObject({ status: 'applied' });
  const receipt = await manager.query(api.pos.orders.getOrder, { orderId });
  expect(receipt).toMatchObject({ paymentRecord: { allTenders: [
    { method: 'cash', amount: 120000 }, ...vouchers.map(voucherId => ({ method: 'voucher', voucherId, amount: 10000 })),
  ] } });
});

it('checks receipt scope again before replay and before the manager applies a request', async () => {
  const { t, now, cashier, manager, orderId } = await setup();
  const request = await cashier.mutation(adjust, amend(orderId));
  if (request.status !== 'approvalRequired') throw new Error('Expected manager approval');
  await t.run(ctx => ctx.db.patch(orderId, { paidAt: now - 86400000 }));
  await expect(cashier.mutation(adjust, amend(orderId))).rejects.toMatchObject({ data: { code: 'ADJUSTMENT_TARGET_MISSING' } });
  await expect(manager.mutation(approve, { requestId: request.requestId })).rejects.toMatchObject({ data: { code: 'ADJUSTMENT_TARGET_MISSING' } });
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').first())).toBeNull();
});

it('honors a cashier payment-fix rule allowing direct edits and refuses cashier catalogue prices', async () => {
  const { t, cashier, orderId, serviceId } = await setup();
  const edit = { target: { targetType: 'service' as const, targetId: serviceId }, kind: 'editCatalogue' as const,
    input: { price: 99900 }, expectedRevision: 0, clientKey: 'service-price' };
  await expect(cashier.mutation(adjust, edit)).rejects.toMatchObject({ data: { code: 'ADJUSTMENT_FORBIDDEN' } });
  await t.run(ctx => ctx.db.insert('cashierRules', {
    ...DEFAULT_CASHIER_RULES, key: 'default', paymentFix: 'cashier', revision: 1, updatedAt: Date.now(), updatedByEmail: 'owner@example.com',
  }));
  expect(await cashier.mutation(adjust, amend(orderId))).toMatchObject({ status: 'applied' });
  expect(await t.run(ctx => ctx.db.query('staffApprovalRequests').first())).toBeNull();
});

it('keeps the cashier adjustment entry point dormant before payment cutover', async () => {
  const { t, cashier, orderId } = await setup({ cutover: false });
  await expect(cashier.mutation(adjust, amend(orderId))).rejects.toMatchObject({ data: { code: 'SALE_SWITCH_OFF' } });
  expect(await t.run(ctx => ctx.db.query('staffApprovalRequests').first())).toBeNull();
});

it('audits old admin saves and D19 catalogue prices in the same revision stream', async () => {
  const { t, owner, manager, serviceId, propertyId, lineId } = await setup();
  await owner.mutation(api.services.commands.updateService.updateService, { serviceId, price: 125000, name: '  Thai massage  ' });
  await owner.mutation(api.catalog.properties.update, { propertyId, pricePerNight: 800000, expectedRevision: 0 });
  await expect(owner.mutation(api.services.commands.updateService.updateService, { serviceId, price: 150000, expectedRevision: 0 }))
    .rejects.toMatchObject({ data: { code: 'STALE_ADJUSTMENT_REVISION', currentRevision: 1 } });
  await expect(owner.mutation(api.catalog.properties.update, { propertyId, pricePerNight: 825000, expectedRevision: 0 }))
    .rejects.toMatchObject({ data: { code: 'STALE_ADJUSTMENT_REVISION', currentRevision: 1 } });
  const edit = { target: { targetType: 'service' as const, targetId: serviceId }, kind: 'editCatalogue' as const,
    input: { price: 130000 }, expectedRevision: 1, clientKey: 'price-edit', reasonCode: 'priceChange' };
  const reads = vi.spyOn(budgets.ReadBudget.prototype, 'document');
  const writes = vi.spyOn(budgets, 'reserveWrites');
  const result = await manager.mutation(adjust, edit);
  expect(result).toMatchObject({ status: 'applied', revision: 2 });
  expect(reads.mock.calls.length).toBeLessThanOrEqual(8);
  expect(writes.mock.calls.reduce((sum, [, count]) => sum + count, 0)).toBe(3);
  expect(await manager.mutation(adjust, edit)).toEqual(result);
  expect(await manager.mutation(adjust, {
    ...edit, target: { targetType: 'property', targetId: propertyId }, input: { pricePerNight: 810000 }, clientKey: 'property-price-edit',
  })).toMatchObject({ status: 'applied', revision: 2 });
  await t.run(async ctx => {
    expect(await ctx.db.get(serviceId)).toMatchObject({ revision: 2, price: 130000, name: 'Thai massage' });
    expect(await ctx.db.get(propertyId)).toMatchObject({ revision: 2, pricePerNight: 810000 });
    expect(await ctx.db.get(lineId)).toMatchObject({ unitPrice: 120000, name: 'Massage' });
    expect(await ctx.db.query('commerceAdjustments').collect()).toMatchObject([
      { targetType: 'service', targetId: serviceId, before: { price: 120000, name: 'Massage' }, after: { price: 125000, name: 'Thai massage' }, revisionBefore: 0, revisionAfter: 1 },
      { targetType: 'property', targetId: propertyId, before: { pricePerNight: 850000 }, after: { pricePerNight: 800000 }, revisionBefore: 0, revisionAfter: 1 },
      { targetType: 'service', targetId: serviceId, before: { price: 125000 }, after: { price: 130000 }, revisionBefore: 1, revisionAfter: 2 },
      { targetType: 'property', targetId: propertyId, before: { pricePerNight: 800000 }, after: { pricePerNight: 810000 }, revisionBefore: 1, revisionAfter: 2 },
    ]);
  });
});

it('keeps large existing admin fields editable within the adjustment row size cap', async () => {
  const { t, owner, serviceId } = await setup();
  const description = 'A'.repeat(10000);
  await owner.mutation(api.services.commands.updateService.updateService, { serviceId, description });
  await t.run(async ctx => {
    expect(await ctx.db.get(serviceId)).toMatchObject({ description, revision: 1 });
    const [audit] = await ctx.db.query('commerceAdjustments').collect();
    expect(audit.after.description).toMatchObject({ bytes: 10002, sha256: expect.any(String) });
    expect(new TextEncoder().encode(JSON.stringify(audit)).length).toBeLessThanOrEqual(8192);
  });
});
