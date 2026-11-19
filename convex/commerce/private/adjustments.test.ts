// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { expect, it } from 'vitest';
import type { Id } from '../../_generated/dataModel';
import { canReadCheckoutOrder, requireStaff } from '../../auth/model';
import { readBudget, reserveWrites } from '../../lib/readBudget';
import schema from '../../schema';
import { resortTodayIso } from '../../shared/time';
import {
  adjust, cashierAdjustmentRoute, executeApprovedAdjustment, type AdjustmentCommand, type AdjustmentWriter,
} from './adjustments';
import { listCommerceHistory, listGuestCommerceHistory, transferHistorySourceKey } from './history';

const modules = import.meta.glob('../../**/*.ts');
const balances = { paid: 50_000, goodwill: 0 };
const terms = {
  preserveExpiredPackageValue: true, unusedFullRefundDays: 7, refundDueDays: { cashOrTransfer: 15, card: 45 },
  packageValidityDays: 180, voucherValidityDays: 365, allowSessionTransfer: true,
  packageSplit: 'voucherFaceValue' as const, packageVatTiming: 'atSale' as const,
  pointsVatTreatment: 'discount' as const, pointsExpiryMonths: 12,
};

async function fixture() {
  const t = convexTest(schema, modules);
  const manager = t.withIdentity({ email: 'manager@example.com', emailVerified: true, tokenIdentifier: 'manager' });
  const cashier = t.withIdentity({ email: 'cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier' });
  const ids = await t.run(async ctx => {
    for (const role of ['cashier', 'manager'] as const) {
      await ctx.db.insert('staffGrants', {
        role, email: `${role}@example.com`, tokenIdentifier: role, createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
      });
    }
    const branchId = await ctx.db.insert('branches', { key: 'main' });
    const orderId = await ctx.db.insert('orders', {
      status: 'paid', orderNumber: 1, currency: 'THB', itemCount: 1, hasItems: true,
      total: 50_000, due: 0, revision: 1, paidAt: Date.now(), createdBy: 'cashier', createdAt: 1, updatedAt: 1,
    });
    const lineId = await ctx.db.insert('orderLines', {
      orderId, kind: 'extra', name: 'Gift voucher', qty: 1, unitPrice: 50_000, catalogUnitPrice: 50_000, currency: 'THB', createdAt: 1,
    });
    const voucher = () => ctx.db.insert('vouchers', {
      branchId, source: { kind: 'sale', orderId, lineId },
      faceValue: balances.paid, paidBalance: balances.paid, goodwillBalance: 0,
      issuedExpiresAt: 1_800_000_000_000, effectiveExpiresAt: 1_800_000_000_000, status: 'active',
      name: 'Mia', revision: 0, settingsRevision: 0, terms,
    });
    return { voucherId: await voucher(), otherVoucherId: await voucher(), branchId, orderId, lineId };
  });
  return { t, manager, cashier, ...ids };
}

// Exercises the same writer contract for a direct or approved edit on the actual tables.
const voucherWriter: AdjustmentWriter = {
  assertScope: async (ctx, actor, command) => {
    if (command.target.targetType !== 'voucher') throw new Error('Invalid voucher operation');
    const budget = readBudget(ctx);
    budget.range();
    const voucher = await ctx.db.get(command.target.targetId);
    if (voucher) budget.document(voucher);
    budget.assert();
    if (!voucher) throw new ConvexError({ code: 'VOUCHER_SCOPE_DENIED' });
    if (actor.role === 'cashier') {
      budget.range();
      const order = await ctx.db.get(voucher.source.orderId);
      if (order) budget.document(order);
      budget.assert();
      if (canReadCheckoutOrder(actor, order)) return;
      throw new ConvexError({ code: 'VOUCHER_SCOPE_DENIED' });
    }
  },
  prepare: async (ctx, actor, { target, kind, input }) => {
    if (target.targetType !== 'voucher') throw new Error('Invalid voucher operation');
    const budget = readBudget(ctx);
    budget.range();
    const voucher = await ctx.db.get(target.targetId);
    if (!voucher) throw new Error('Voucher disappeared');
    budget.document(voucher);
    budget.assert();
    const delta = kind === 'addGoodwill' && typeof input.delta === 'number' ? input.delta : 0;
    const name = kind === 'rename' && typeof input.name === 'string' ? input.name : voucher.name;
    const expiresAt = kind === 'extend' && typeof input.expiresAt === 'number' ? input.expiresAt : voucher.effectiveExpiresAt;
    const before = { paid: voucher.paidBalance, goodwill: voucher.goodwillBalance };
    const after = { ...before, goodwill: before.goodwill + delta };
    return {
      before: { goodwill: before.goodwill, voucherCode: 'GV-ABCD-WXYZ' },
      after: { goodwill: after.goodwill, voucherCode: 'GV-DEFH-QRST' },
      goodwillFaceValueDelta: delta,
      apply: async ({ revisionAfter, recordedAt, sourceKey }) => {
        reserveWrites(ctx, 2);
        await ctx.db.patch(voucher._id, { revision: revisionAfter, goodwillBalance: after.goodwill, name, effectiveExpiresAt: expiresAt });
        const id = await ctx.db.insert('voucherEntries', {
          voucherId: voucher._id, before, after, actor: actor.email, createdAt: recordedAt,
          guestFact: 'Gift voucher updated', kind: 'edit', sourceKey,
        });
        return [{ kind: 'voucherEntry', id }];
      },
    };
  },
};

function command(voucherId: Id<'vouchers'>, extra: Partial<AdjustmentCommand> = {}): AdjustmentCommand {
  return {
    target: { targetType: 'voucher', targetId: voucherId }, kind: 'addGoodwill',
    input: { delta: 2500, scope: 'counter' }, expectedRevision: 0, clientKey: 'test-key',
    reasonCode: 'goodwill', reasonText: 'Customer service', ...extra,
  };
}

it('returns the original edit for the same payload and refuses a different payload under that key', async () => {
  const { t, manager, voucherId } = await fixture();
  const edit = command(voucherId);
  const result = await manager.run(async ctx => {
    const actor = await requireStaff(ctx, 'checkout');
    const applied = await adjust(ctx, actor, edit, voucherWriter);
    expect(readBudget(ctx).documents).toBeLessThanOrEqual(8);
    return applied;
  });
  expect(result.status).toBe('applied');
  const replay = await manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), {
    ...edit, input: { scope: 'counter', delta: 2500 },
  }, voucherWriter));
  expect(replay).toEqual(result);
  await expect(manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), {
    ...edit, input: { ...edit.input, delta: 5000 },
  }, voucherWriter))).rejects.toMatchObject({ data: { code: 'ADJUSTMENT_KEY_CONFLICT' } });
  const stored = await t.run(async ctx => ({
    voucher: await ctx.db.get(voucherId),
    audit: await ctx.db.query('commerceAdjustments').collect(),
    ledger: await ctx.db.query('voucherEntries').collect(),
  }));
  expect(stored.voucher).toMatchObject({ paidBalance: 50_000, goodwillBalance: 2500, revision: 1 });
  expect(stored.ledger).toHaveLength(1);
  expect(stored.audit).toHaveLength(1);
  expect(stored.audit[0]).toMatchObject({
    targetId: voucherId, actor: 'manager', actorLabel: 'manager@example.com',
    before: { goodwill: 0, voucherCode: 'GV-••••-WXYZ' },
    after: { goodwill: 2500, voucherCode: 'GV-••••-QRST' },
    revisionBefore: 0, revisionAfter: 1, paidLiabilityDelta: 0, goodwillFaceValueDelta: 2500, quantityDelta: 0,
    reasonCode: 'goodwill', reasonText: 'Customer service', businessDate: resortTodayIso(stored.audit[0].recordedAt),
    effects: [{ kind: 'voucherEntry', id: stored.ledger[0]._id }],
  });
});

it('refuses a stale primary or related revision before writing', async () => {
  const { t, manager, voucherId, otherVoucherId } = await fixture();
  await t.run(ctx => ctx.db.patch(otherVoucherId, { revision: 1 }));
  for (const input of [
    command(voucherId, { expectedRevision: 1 }),
    command(voucherId, { relatedRevisions: [{ target: { targetType: 'voucher', targetId: otherVoucherId }, revision: 0 }] }),
  ]) {
    await expect(manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), input, voucherWriter)))
      .rejects.toMatchObject({ data: { code: 'STALE_ADJUSTMENT_REVISION' } });
  }
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').first())).toBeNull();
  expect(await t.run(ctx => ctx.db.query('voucherEntries').first())).toBeNull();
});

it('checks scope and role before looking up a replay', async () => {
  const { t, manager, cashier, voucherId, orderId } = await fixture();
  const edit = command(voucherId, { kind: 'removeGoodwill' });
  await manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), edit, voucherWriter));
  await expect(cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), edit, voucherWriter)))
    .rejects.toMatchObject({ data: { code: 'ADJUSTMENT_FORBIDDEN' } });
  const rename = command(voucherId, { kind: 'rename', input: { name: 'Mia Tanaka' }, expectedRevision: 1, clientKey: 'rename' });
  await cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), rename, voucherWriter));
  await t.run(ctx => ctx.db.patch(orderId, { paidAt: 1 }));
  await expect(cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), rename, voucherWriter)))
    .rejects.toMatchObject({ data: { code: 'VOUCHER_SCOPE_DENIED' } });
});

it('uses the stored benefitEdit and sessionWaive cashier rules', async () => {
  const { t, cashier, voucherId } = await fixture();
  const waiveRoute = () => cashier.run(async ctx => cashierAdjustmentRoute(ctx, await requireStaff(ctx, 'checkout'), 'sessionWaive'));
  expect(await waiveRoute()).toBe('approval');
  await t.run(ctx => ctx.db.insert('cashierRules', {
    key: 'default', revision: 1, discountLimitPercent: 1000, voidPaidSale: 'manager',
    customPrice: 'manager', paymentFix: 'manager', benefitEdit: 'cashier', sessionWaive: 'cashier',
    updatedAt: 1, updatedByEmail: 'owner@example.com',
  }));
  expect(await waiveRoute()).toBe('direct');
  const edit = command(voucherId, { kind: 'extend', input: { expiresAt: 1_900_000_000_000 } });
  expect(await cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), edit, voucherWriter)))
    .toMatchObject({ status: 'applied', revision: 1 });
  expect(await t.run(ctx => ctx.db.get(voucherId))).toMatchObject({ effectiveExpiresAt: 1_900_000_000_000 });
});

it('replays a target-scoped request and applies it at most once through manager approval', async () => {
  const { t, manager, cashier, voucherId } = await fixture();
  const edit = command(voucherId);
  const request = await cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), edit, voucherWriter));
  if (request.status !== 'approvalRequired') throw new Error('Expected manager approval');
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').first())).toBeNull();
  expect(await cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), edit, voucherWriter))).toEqual(request);
  await expect(cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), {
    ...edit, reasonCode: 'other', reasonText: 'Different reason',
  }, voucherWriter))).rejects.toMatchObject({ data: { code: 'ADJUSTMENT_KEY_CONFLICT' } });

  await expect(cashier.run(async ctx =>
    executeApprovedAdjustment(ctx, await requireStaff(ctx, 'checkout'), request.requestId, voucherWriter)))
    .rejects.toMatchObject({ data: { code: 'ADJUSTMENT_FORBIDDEN' } });
  const approve = () => manager.run(async ctx =>
    executeApprovedAdjustment(ctx, await requireStaff(ctx, 'approve'), request.requestId, voucherWriter));
  const result = await approve();
  expect(result.status).toBe('applied');
  expect(await approve()).toEqual(result);
  expect(await cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), edit, voucherWriter))).toEqual(request);
  const stored = await t.run(async ctx => ({
    request: await ctx.db.get(request.requestId),
    audit: await ctx.db.query('commerceAdjustments').collect(),
    ledger: await ctx.db.query('voucherEntries').collect(),
  }));
  expect(stored.request).toMatchObject({ kind: 'adjustment', status: 'applied', approverEmail: 'manager@example.com', payload: {
    target: edit.target, requester: 'cashier', clientKey: edit.clientKey,
  } });
  expect(stored.request).not.toHaveProperty('orderId');
  expect(stored.audit).toHaveLength(1);
  expect(stored.ledger).toHaveLength(1);
  expect(stored.audit[0]).toMatchObject({
    actor: 'manager', requesterKey: 'cashier', approvalId: request.requestId, clientKey: `approval:${request.requestId}`,
  });
});

it('rechecks the reviewed revision when the manager applies a request', async () => {
  const { t, manager, cashier, voucherId } = await fixture();
  const request = await cashier.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), command(voucherId), voucherWriter));
  if (request.status !== 'approvalRequired') throw new Error('Expected manager approval');
  await t.run(ctx => ctx.db.patch(voucherId, { revision: 1 }));
  await expect(manager.run(async ctx =>
    executeApprovedAdjustment(ctx, await requireStaff(ctx, 'approve'), request.requestId, voucherWriter)))
    .rejects.toMatchObject({ data: { code: 'STALE_ADJUSTMENT_REVISION' } });
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').first())).toBeNull();
  expect(await t.run(ctx => ctx.db.query('voucherEntries').first())).toBeNull();
});

it('enforces required reasons, Other text, reason length and the row byte limit', async () => {
  const { t, manager, voucherId } = await fixture();
  for (const edits of [
    { reasonCode: '' }, { reasonCode: 'Other', reasonText: '   ' }, { reasonText: 'a'.repeat(501) },
  ]) {
    await expect(manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), command(voucherId, edits), voucherWriter)))
      .rejects.toMatchObject({ data: { code: 'INVALID_ADJUSTMENT_REASON' } });
  }
  const largerWriter: AdjustmentWriter = {
    ...voucherWriter,
    prepare: async (...args) => ({
      ...await voucherWriter.prepare(...args), before: { label: 'ท'.repeat(3000) },
    }),
  };
  await expect(manager.run(async ctx => adjust(ctx, await requireStaff(ctx, 'checkout'), command(voucherId), largerWriter)))
    .rejects.toMatchObject({ data: { code: 'ADJUSTMENT_TOO_LARGE' } });
  expect(await t.run(ctx => ctx.db.query('commerceAdjustments').first())).toBeNull();
  expect(await t.run(ctx => ctx.db.query('voucherEntries').first())).toBeNull();
  expect(await t.run(ctx => ctx.db.get(voucherId))).toMatchObject({ revision: 0, goodwillBalance: 0 });
});

it.each(['voucher', 'grant'] as const)('keeps %s guest history within the latest ownership period', async targetType => {
  const { t, voucherId, branchId, orderId, lineId } = await fixture();
  const target = targetType === 'voucher' ? { targetType, targetId: voucherId } : await t.run(async ctx => {
    const ownerId = await ctx.db.insert('customers', { name: 'Fixture guest', createdBy: 'staff', createdAt: 1, updatedAt: 1 });
    const packageId = await ctx.db.insert('packages', { name: 'Massage', status: 'active', sort: 1, revision: 0 });
    const packageVersionId = await ctx.db.insert('packageVersions', {
      packageId, version: 1, name: 'Massage', price: 100, validityDays: 180, allowTransfer: true, contents: [], estimatedSplit: [],
    });
    const expiresAt = 1_800_000_000_000;
    const targetId = await ctx.db.insert('sessionGrants', {
      ownerId, orderId, lineId, packageVersionId, contentKey: 'massages', branchId,
      total: 3, used: 0, paidUnits: 3, goodwillUnits: 0, returnedUnits: 0, paidShare: 100,
      expiresAt, issuedTerms: { expiresAt, serviceIds: [], allowTransfer: true },
      settingsRevision: 0, terms, grantServiceIds: [], revision: 0,
    });
    return { targetType, targetId };
  });
  const add = async (recordedAt: number, revision: number, kind: 'issue' | 'use' | 'transfer') => {
    await t.run(async ctx => {
      const fields = {
        createdAt: recordedAt, before: { paid: 3, goodwill: 0 }, after: { paid: 2, goodwill: 0 },
        actor: 'Private Staff', guestFact: 'Private notes and a code GV-ABCD-WXYZ',
        sourceKey: kind === 'transfer' ? transferHistorySourceKey(target, revision) : `entry-${revision}`,
      };
      if (target.targetType === 'grant') await ctx.db.insert('sessionUses', { ...fields, grantId: target.targetId, kind });
      else await ctx.db.insert('voucherEntries', {
        ...fields, voucherId: target.targetId, kind: kind === 'use' ? 'spend' : kind === 'transfer' ? 'edit' : 'issue',
      });
    });
  };
  await add(1, 1, 'issue');
  await add(2, 2, 'use');
  const firstOwner = await t.run(ctx => listGuestCommerceHistory(ctx, target, { cursor: null, numItems: 1 }));
  await add(2, 3, 'transfer'); // Same millisecond as the previous owner's last use.
  const secondOwner = await t.run(ctx => listGuestCommerceHistory(ctx, target, { cursor: null, numItems: 20 }));
  expect(secondOwner.page.map(row => row.kind)).toEqual(['transfer']);
  await add(3, 4, 'use');
  await add(4, 5, 'transfer');
  await add(5, 6, 'use');
  await expect(t.run(ctx => listGuestCommerceHistory(ctx, target, { cursor: firstOwner.continueCursor, numItems: 1 })))
    .rejects.toMatchObject({ data: { code: 'STALE_HISTORY_CURSOR' } });
  const latest = await t.run(ctx => listGuestCommerceHistory(ctx, target, { cursor: null, numItems: 1 }));
  const end = await t.run(ctx => listGuestCommerceHistory(ctx, target, { cursor: latest.continueCursor, numItems: 1 }));
  expect(latest.page).toEqual([{ entryId: expect.any(String), kind: targetType === 'grant' ? 'use' : 'spend', recordedAt: 5,
    fact: targetType === 'grant' ? { key: 'updated' } : { key: 'spent', args: { amount: 1 } },
    before: { paid: 3, goodwill: 0 }, after: { paid: 2, goodwill: 0 } }]);
  expect(JSON.stringify(latest)).not.toMatch(/Private|GV-ABCD/);
  expect(end).toMatchObject({ page: [{ kind: 'transfer', recordedAt: 4, fact: { key: 'transferredIn' } }], isDone: true });
  const staff = await t.run(ctx => listCommerceHistory(ctx, target, { cursor: null, numItems: 20 }));
  expect(staff.page).toHaveLength(6);
});

it('pages a 1,000-entry target newest first within 300ms and the read budget', async () => {
  const { t, voucherId } = await fixture();
  const selected = await t.run(async ctx => {
    const settings = { ...terms, key: 'default' as const, revision: 0, paymentsMode: 'direct' as const, saleSwitches: {
      products: 'off' as const, vouchers: 'off' as const, sessionPackages: 'off' as const, mixedPackages: 'off' as const,
    } };
    const targetId = await ctx.db.insert('commerceSettings', settings);
    const emptyId = await ctx.db.insert('commerceSettings', settings);
    for (let i = 0; i < 1000; i++) {
      await ctx.db.insert('commerceAdjustments', {
        targetType: 'settings', targetId, kind: 'updateSettings', before: {}, after: {},
        revisionBefore: i, revisionAfter: i + 1, paidLiabilityDelta: 0, goodwillFaceValueDelta: 0, quantityDelta: 0,
        actor: 'owner', actorLabel: 'Owner', requesterKey: 'owner', clientKey: String(i), fingerprint: String(i),
        recordedAt: i, businessDate: '2026-11-19',
      });
    }
    return { targetId, emptyId };
  });
  const target = { targetType: 'settings' as const, targetId: selected.targetId };
  const measured = await t.run(async ctx => {
    const start = performance.now();
    const first = await listCommerceHistory(ctx, target, { cursor: null, numItems: 20 });
    const elapsed = performance.now() - start;
    const budget = readBudget(ctx);
    return { first, elapsed, documents: budget.documents, ranges: budget.ranges, bytes: budget.bytes };
  });
  expect(measured.first.page.map(row => 'recordedAt' in row && row.recordedAt)).toEqual(
    Array.from({ length: 20 }, (_, index) => 999 - index),
  );
  expect(measured.first.isDone).toBe(false);
  expect(measured.documents).toBe(20);
  expect(measured.ranges).toBe(1);
  expect(measured.bytes).toBeLessThanOrEqual(160 * 1024);
  expect(measured.elapsed, `1,000 adjustments read in ${measured.elapsed.toFixed(1)} ms`).toBeLessThanOrEqual(300);

  const empty = await t.run(ctx => listCommerceHistory(ctx, { ...target, targetId: selected.emptyId }, { cursor: null, numItems: 20 }));
  expect(empty).toMatchObject({ page: [], isDone: true });
  const voucher = { targetType: 'voucher' as const, targetId: voucherId };
  await t.run(async ctx => {
    for (let i = 0; i < 21; i++) await ctx.db.insert('voucherEntries', {
      voucherId, kind: 'edit', sourceKey: String(i), before: balances, after: balances,
      actor: 'Staff', guestFact: 'Edited', createdAt: i,
    });
  });
  const firstPage = await t.run(ctx => listCommerceHistory(ctx, voucher, { cursor: null, numItems: 20 }));
  expect(firstPage.page).toHaveLength(20);
  expect(firstPage.isDone).toBe(false);
  const lastPage = await t.run(ctx => listCommerceHistory(ctx, voucher, { cursor: firstPage.continueCursor, numItems: 20 }));
  expect(lastPage).toMatchObject({ page: [{ createdAt: 0 }], isDone: true });
  const exact = await t.run(ctx => listCommerceHistory(ctx, voucher, { cursor: null, numItems: 1 }));
  const finalFullPage = await t.run(ctx => listCommerceHistory(ctx, voucher, { cursor: exact.continueCursor, numItems: 20 }));
  expect(finalFullPage.page).toHaveLength(20);
  expect(finalFullPage.isDone).toBe(true);
});
