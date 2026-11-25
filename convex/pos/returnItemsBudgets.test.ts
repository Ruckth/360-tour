// @vitest-environment edge-runtime
import { seedTestBranch } from '../testing/staff.test-support';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import * as budgets from '../lib/readBudget';
import { assertCommerceCaps } from '../shared/commerce';
import { maskVoucherCodes, normalizeVoucherCode, voucherCodeMask } from '../shared/voucherCode';

import {
  command, now, day, setup, receipt, line, payment, allocation, snapshot, catalog, product, voucher, selection, destination, give, maximumPackages, measured,
} from '../../tests/support/return-items-fixture';

/*
 * Return items at the legal caps: native-read-sensitive authorize, cancel and payout budgets (v27), split
 * from returnItems.test.ts so each file stays readable.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('finishes a 100-row all-voucher return with 20 grants, 200 service projections and two replacement slips within budget', async () => {
  const { t, owner } = await setup();
  const { args, grants, funding } = await t.run(ctx => maximumPackages(ctx, true));
  const result = await measured('All-voucher authorize', { reads: 440, native: 440, writes: 510 }, () => owner.mutation(command.authorize, args));
  expect(result.status).toBe('completed');
  expect(result.claims).toEqual([]);
  expect(result.destinations).toMatchObject([
    { kind: 'voucher', amount: 1000, destination: { kind: 'newVoucher' } },
    { kind: 'voucher', amount: 1000, destination: { kind: 'newVoucher' } },
  ]);
  expect(result.giftSlips.map(slip => slip.amount)).toEqual([1000, 1000]);
  // Round 2, blocker 3: each slip names the expired voucher it replaces, and its code is one every
  // voucher reader and the shared masker recognise, stored with the shared mask.
  expect(new Set(result.giftSlips.map(slip => slip.replaces))).toEqual(new Set(funding));
  const stored = await t.run(ctx => Promise.all(result.giftSlips.map(slip => ctx.db.query('voucherCodes').withIndex('by_code', q => q.eq('code', slip.code)).unique())));
  for (const [index, slip] of result.giftSlips.entries()) {
    expect(normalizeVoucherCode(slip.code)).toBe(slip.code);
    expect(normalizeVoucherCode(slip.code.toLowerCase().replaceAll('-', ' '))).toBe(slip.code);
    expect(maskVoucherCodes(`Slip ${slip.code}`)).toBe(`Slip ${voucherCodeMask(slip.code)}`);
    expect(stored[index]).toMatchObject({ voucherId: slip.voucherId, mask: voucherCodeMask(slip.code), status: 'active' });
  }
  expect((await owner.query(command.get, { returnId: result.returnId }))?.giftSlips).toEqual(result.giftSlips);
  // A voucher-only return refunds no cash, yet the receipt knows to read its slips back after a reload.
  const receipt = await owner.query(api.pos.orders.getOrder, { orderId: args.orderId });
  expect(receipt?.order.returnedTotal ?? 0).toBe(0);
  expect(receipt?.commerce?.hasReplacementSlips).toBe(true);
  expect(await owner.query(command.get, { orderId: args.orderId })).toBeNull();
  expect(await owner.query(command.get, { orderId: args.orderId, completed: true }))
    .toMatchObject({ returnId: result.returnId, giftSlips: result.giftSlips });
  // Unlimited voucher validity (D20 Off) still prints the slip, without an end date.
  await t.run(async ctx => { for (const slip of result.giftSlips) await ctx.db.patch(slip.voucherId, { effectiveExpiresAt: null }); });
  expect((await owner.query(command.get, { orderId: args.orderId, completed: true }))?.giftSlips.map(slip => slip.expiresAt)).toEqual([null, null]);
  expect(await t.run(async ctx => (await Promise.all(grants.map(id => ctx.db.get(id)))).map(row => row?.paidUnits))).toEqual(Array(20).fill(0));
});

it('authorizes and cancels 20 grants, 200 projections and 20 issued vouchers on 100 rows within budget', async () => {
  const { t, owner } = await setup();
  const { args, grants, issued } = await t.run(ctx => maximumPackages(ctx, false));
  const result = await measured('Authorize benefit-heavy receipt', { reads: 440, native: 440, writes: 510 }, () => owner.mutation(command.authorize, args));
  expect(result.claims).toMatchObject([{ amount: 3000 }]);
  const failed = await owner.mutation(command.recordPayout, { ...give(result), outcome: 'failed' });
  await measured('Cancel benefit-heavy receipt', { writes: 320 }, () => owner.mutation(command.cancel, {
    returnId: result.returnId, tillId: 'desk-a', operatorRevision: failed.operatorRevision,
  }));
  expect(await t.run(async ctx => (await Promise.all(grants.map(id => ctx.db.get(id)))).map(row => row?.paidUnits))).toEqual(Array(20).fill(5));
  expect(await t.run(async ctx => (await Promise.all(issued.map(id => ctx.db.get(id)))).map(row => row?.paidBalance))).toEqual(Array(20).fill(50));
});

it('pays out and releases 20 paid room handovers within budget and refuses the old commerce void without writes', async () => {
  const { t, owner } = await setup();
  const { args, houses } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 2000, 100);
    const retail = await catalog(ctx);
    const houses = await Promise.all(Array.from({ length: 20 }, () => product(ctx, retail, orderId, 100, true)));
    for (let index = 0; index < 80; index++) await line(ctx, orderId, 'service', 0, { saleSnapshot: snapshot('Other', 0) });
    await payment(ctx, orderId, { amount: 2000, method: 'card' });
    return { houses, args: selection(orderId, houses.map(({ lineId }) => ({ kind: 'line', lineId, units: 1, disposition: 'sellable' }))) };
  });
  const writes = vi.spyOn(budgets, 'reserveWrites');
  await expect(owner.mutation(api.pos.commands.voidOrder.voidOrder, { orderId: args.orderId, reason: 'Incorrect sale' })).rejects.toThrow('USE_RETURN_ITEMS');
  expect(writes).not.toHaveBeenCalled();
  writes.mockRestore();
  const result = await measured('Authorize 20 paid handovers', { reads: 440, native: 440, writes: 510 }, () => owner.mutation(command.authorize, args));
  await measured('Payout 20 paid handovers', { writes: 280 }, () => owner.mutation(command.recordPayout, give(result)));
  const rows = await t.run(ctx => Promise.all(houses.map(({ handoverId }) => ctx.db.get(handoverId!))));
  expect(rows.every(row => row?.status === 'closed' && row.withGuest === 0 && row.backSellable === 1)).toBe(true);
});

it('settles the benefit-heavy maximum after the terminal payout', async () => {
  const { t, owner } = await setup();
  const { args } = await t.run(ctx => maximumPackages(ctx, false));
  const held = await owner.mutation(command.authorize, args);
  expect(await measured('Benefit-heavy final payout', { writes: 280 }, () => owner.mutation(command.recordPayout, give(held))))
    .toMatchObject({ status: 'completed' });
});

it('after a verified cancel all 20 paid room handovers remain with the guest and none restock', async () => {
  const { t, owner } = await setup();
  const { args, goods } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 200000, 20);
    const retail = await catalog(ctx);
    const goods = await Promise.all(Array.from({ length: 20 }, () => product(ctx, retail, orderId, 10000, true)));
    await payment(ctx, orderId, { amount: 200000, method: 'card' });
    return { goods, args: selection(orderId, goods.map(({ lineId }) => ({ kind: 'line', lineId, units: 1, disposition: 'sellable' }))) };
  });
  const held = await owner.mutation(command.authorize, args);
  const failed = await owner.mutation(command.recordPayout, { ...destination(held), outcome: 'failed' });
  expect(await measured('Cancel 20 paid handovers', { writes: 320 }, () =>
    owner.mutation(command.cancel, { returnId: held.returnId, operatorRevision: failed.operatorRevision, tillId: args.tillId })))
    .toMatchObject({ status: 'cancelled' });
  await t.run(async ctx => {
    for (const item of goods) {
      const handover = await ctx.db.get(item.handoverId!);
      expect(handover).toMatchObject({ withGuest: 1, paid: 1, backSellable: 0, status: 'open' });
      expect(handover).not.toHaveProperty('pendingReturnId');
      expect((await ctx.db.get(item.stockId))?.onHand).toBe(2);
    }
  });
});

it('a 100-row receipt can finish 20 returned products with two replacement vouchers and one cash payout', async () => {
  const { t, owner } = await setup();
  const args = await t.run(async ctx => {
    const sourceOrderId = await receipt(ctx, 100000, 2);
    const sourceLineId = await line(ctx, sourceOrderId, 'voucher', 50000);
    const orderId = await receipt(ctx, 200000, 100);
    const retail = await catalog(ctx);
    const original = await Promise.all((['expired', 'disabled'] as const).map(status =>
      voucher(ctx, { kind: 'sale', orderId: sourceOrderId, lineId: sourceLineId }, retail.branchId, 0, {
        status, faceValue: 50000, paidBalance: 0, effectiveExpiresAt: now - day,
      })));
    const goods = await Promise.all(Array.from({ length: 20 }, () => product(ctx, retail, orderId, 10000)));
    for (const goodsRow of goods) {
      const row = (await ctx.db.get(goodsRow.lineId))!;
      const saleSnapshot = row.saleSnapshot!;
      const tenderCells = [
        ...original.map(voucherId => ({ kind: 'voucher' as const, voucherId, amount: 2500 })),
        { kind: 'external' as const, amount: 5000 },
      ];
      await ctx.db.patch(row._id, { saleSnapshot: { ...saleSnapshot, tenderCells, contents: saleSnapshot.contents.map(part => ({ ...part, tenderCells })) } });
    }
    for (let index = 0; index < 80; index++) await line(ctx, orderId, 'service', 0, { saleSnapshot: snapshot('Other', 0) });
    for (const voucherId of original) await payment(ctx, orderId, { method: 'voucher', voucherId, amount: 50000 });
    await payment(ctx, orderId, { method: 'cash', amount: 100000 });
    return selection(orderId, goods.map(({ lineId }) => ({ kind: 'line', lineId, units: 1, disposition: 'sellable' })));
  });
  const held = await measured('20 goods + 2 replacements authorize', { reads: 440, native: 440, writes: 510 }, () => owner.mutation(command.authorize, args));
  const final = await measured('20 goods + 2 replacements payout', { writes: 280 }, () => owner.mutation(command.recordPayout, give(held)));
  expect(final).toMatchObject({ status: 'completed', claims: [{ amount: 100000, method: 'cash', state: 'given' }], giftSlips: [{ amount: 50000 }, { amount: 50000 }] });
});

it.each(['direct', 'approved'] as const)('reverses the 100-line commerce void through the %s path within 500 writes', async mode => {
  const { t, owner, cashier, manager } = await setup();
  const fixture = await t.run(async ctx => {
    const { orderId, grants, issued } = await maximumPackages(ctx, false);
    const branch = (await ctx.db.query('branches').first())!;
    const retail = await catalog(ctx, branch._id);
    const lines = await ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', orderId)).take(100);
    const variantId = await ctx.db.insert('productVariants', {
      productId: retail.productId, optionValueIds: [], label: 'Robe', price: 100, status: 'active', revision: 0,
    });
    const movementId = await ctx.db.insert('stockMovements', {
      branchId: branch._id, variantId, delta: -80, before: 100, after: 20,
      kind: 'sale', sourceKey: 'maximum-void', actor: 'owner', createdAt: now,
    });
    const roomMovement = await ctx.db.insert('stockMovements', {
      branchId: branch._id, variantId, delta: -20, before: 120, after: 100,
      kind: 'room_bill', sourceKey: 'maximum-room-void', actor: 'owner', createdAt: now,
    });
    const stockId = await ctx.db.insert('stockLevels', { ...retail, variantId, onHand: 20, revision: 1 });
    const handedOver = [];
    for (const [index, row] of lines.entries()) {
      const snap = row.saleSnapshot!;
      const goods = { ...allocation(100), contentKey: 'product', label: 'Robe', units: 1,
        vatProfile: 'standard' as const, stockMovementId: index < 80 ? movementId : roomMovement };
      await ctx.db.patch(row._id, {
        ...(row.kind === 'package' ? {} : { kind: 'product' as const, variantId }), unitPrice: row.unitPrice + 100,
        saleSnapshot: { ...snap, paidShare: snap.paidShare + 100, contents: [...snap.contents, goods] },
      });
      if (index >= 80) handedOver.push(await ctx.db.insert('handovers', {
        kind: 'room_bill', orderId, lineId: row._id, variantId, originalMovementId: roomMovement, unitPrice: 100,
        quantity: 1, withGuest: 1, backSellable: 0, backDamaged: 0, unpaid: 0,
        paid: 1, status: 'open', movementIds: [roomMovement], clientKey: `room:${index}`, revision: 1,
      }));
    }
    await ctx.db.patch(orderId, { total: 14000 });
    const paid = (await ctx.db.query('orderPayments').withIndex('by_orderId', q => q.eq('orderId', orderId)).first())!;
    await ctx.db.patch(paid._id, { amount: 12000 });
    const fundingOrderId = await receipt(ctx, 2000);
    for (let index = 0; index < 2; index++) {
      const lineId = await line(ctx, fundingOrderId, 'voucher', 1000);
      const voucherId = await voucher(ctx, { kind: 'sale', orderId: fundingOrderId, lineId }, branch._id, 0, {
        faceValue: 1000, status: index ? 'disabled' : 'expired', effectiveExpiresAt: now - day,
      });
      await payment(ctx, orderId, { method: 'voucher', voucherId, amount: 1000 });
    }
    return { orderId, grants, issued, stockId, handedOver };
  });
  const reason = 'No external money received';
  if (mode === 'approved') {
    const request = await cashier.mutation(api.pos.staffApprovals.create, {
      orderId: fixture.orderId, reason, payload: { kind: 'paymentFix', action: 'voidUnreceivedOrder' },
    });
    expect(await measured('Approved commerce void at benefit and custody caps', { writes: 500 }, () =>
      manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId }))).toMatchObject({ status: 'applied' });
  } else {
    expect(await measured('Direct commerce void at benefit and custody caps', { writes: 500 }, () =>
      owner.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, {
        orderId: fixture.orderId, expectedCorrectionRevision: 0, reason, idempotencyKey: 'void-at-limit',
      }))).toHaveProperty('recollectionOrderId');
  }
  await t.run(async ctx => {
    const correction = (await ctx.db.query('orderCorrections').first())!;
    const { recollectionOrderId } = correction;
    expect(await ctx.db.get(recollectionOrderId!)).toMatchObject({ parentOrderId: fixture.orderId, itemCount: 100, due: 10000, commerceRevision: 1 });
    const handovers = await ctx.db.query('handovers').take(101);
    expect(handovers).toHaveLength(100);
    expect(handovers.every(row => row.kind === 'recollect' && row.unpaid === 1 && row.withGuest === 1 && row.paid === 0)).toBe(true);
    expect(fixture.handedOver.every(id => handovers.some(row => row._id === id))).toBe(true);
    expect(await ctx.db.get(fixture.stockId)).toMatchObject({ onHand: 20 });
    expect(await ctx.db.query('stockMovements').take(3)).toHaveLength(2);
    expect(await ctx.db.query('returnPayouts').first()).toBeNull();
    expect(correction.voucherRestorations).toHaveLength(2);
    expect((await Promise.all(fixture.grants.map(id => ctx.db.get(id)))).every(row => row?.paidUnits === 0 && row.goodwillUnits === 0)).toBe(true);
    expect((await Promise.all(fixture.issued.map(id => ctx.db.get(id)))).every(row => row?.paidBalance === 0 && row.status === 'revoked')).toBe(true);
    expect((await ctx.db.query('grantServices').take(201)).every(row => !row.usable)).toBe(true);
  });
});

it('reconciles unselected returned siblings and keeps receipt-order satang ties on a large receipt', async () => {
  const { t, owner } = await setup();
  const { orderId, first, second, third, filler, voucherId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 4, 24);
    const branchId = await seedTestBranch(ctx);
    const first = await line(ctx, orderId, 'service', 2);
    const second = await line(ctx, orderId, 'service', 1, { saleSnapshot: snapshot('Second', 1) });
    const third = await line(ctx, orderId, 'service', 1, { saleSnapshot: snapshot('Third', 1) });
    const voucherId = await voucher(ctx, { kind: 'sale', orderId, lineId: first }, branchId, 0, { faceValue: 3 });
    await ctx.db.patch(first, { saleSnapshot: { ...snapshot('First', 2), tenderCells: [{ kind: 'voucher', voucherId, amount: 2 }] } });
    const fillers = [];
    for (let index = 0; index < 21; index++) fillers.push(await line(ctx, orderId, 'service', 0, { saleSnapshot: snapshot('Other', 0) }));
    await payment(ctx, orderId, { method: 'voucher', voucherId, amount: 3 });
    await payment(ctx, orderId, { method: 'card', amount: 1 });
    return { orderId, first, second, third, filler: fillers[0], voucherId };
  });
  expect(await owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId: first, units: 1 }])))
    .toMatchObject({ status: 'completed', voucherCredits: [{ paid: 2 }] });
  const order = (await t.run(ctx => ctx.db.get(orderId)))!;
  const args = selection(orderId, [third, second].map(lineId => ({ kind: 'line', lineId, units: 1 })), {
    expectedRevision: order.revision, clientKey: 'large-receipt-next-return',
  });
  // The first return stored the exact receipt total; a total that does not reconcile still fails.
  expect(order.rowReturnedTotal).toBe(2);
  await t.run(ctx => ctx.db.patch(orderId, { rowReturnedTotal: -1 }));
  await expect(owner.mutation(command.authorize, args)).rejects.toThrow('RETURN_TOTAL_CHANGED');
  // Without a stored total (receipts returned before it existed) an unselected invalid balance is read and fails too.
  await t.run(ctx => ctx.db.patch(orderId, { rowReturnedTotal: undefined }));
  await t.run(ctx => ctx.db.patch(filler, { saleSnapshot: { ...snapshot('Other', 0), returnedAmount: -3 } }));
  await expect(owner.mutation(command.authorize, args)).rejects.toThrow('RETURN_TOTAL_CHANGED');
  await t.run(ctx => ctx.db.patch(filler, { saleSnapshot: snapshot('Other', 0) }));
  const held = await owner.mutation(command.authorize, args);
  expect(held).toMatchObject({ status: 'authorized', claims: [{ amount: 1 }], voucherCredits: [{ paid: 1 }] });
  await owner.mutation(command.recordPayout, give(held));
  expect(await t.run(ctx => ctx.db.get(orderId))).toMatchObject({ returnedTotal: 1, rowReturnedTotal: 4 });
  expect(await t.run(ctx => ctx.db.get(voucherId))).toMatchObject({ paidBalance: 3 });
  const refunds = await t.run(ctx => ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', orderId)).take(4));
  expect(refunds.map(({ lineId, amount, method }) => ({ lineId, amount, method }))).toEqual([
    { lineId: first, amount: 2, method: 'voucher' },
    { lineId: third, amount: 1, method: 'card' },
    { lineId: second, amount: 1, method: 'voucher' },
  ]);
});

async function combinedMaximum(ctx: MutationCtx) {
  const fixture = await maximumPackages(ctx, false);
  const originals = await Promise.all(fixture.args.parts.map(part => ctx.db.get(part.lineId)));
  for (let group = 0; group < 2; group++) {
    const destination = originals[group]!;
    const slots = [];
    for (let n = group * 10; n < group * 10 + 10; n++) {
      for (const content of originals[n]!.saleSnapshot!.contents) {
        const contentKey = content.contentKey + ':' + n;
        slots.push({ ...content, contentKey });
        if (content.grantId) await ctx.db.patch(content.grantId, { lineId: destination._id, contentKey });
        if (content.voucherId) {
          const voucher = await ctx.db.get(content.voucherId);
          if (voucher?.source.kind !== 'package') throw new Error('Expected a package voucher');
          await ctx.db.patch(content.voucherId, { source: { ...voucher.source, lineId: destination._id, contentKey } });
        }
      }
    }
    await ctx.db.patch(destination._id, { unitPrice: 2000, saleSnapshot: snapshot('Ten benefits', 2000, slots) });
  }
  for (const row of originals.slice(2)) await ctx.db.delete(row!._id);
  const retail = await catalog(ctx);
  const goods = [];
  for (let index = 0; index < 18; index++) goods.push(await product(ctx, retail, fixture.orderId, 100, true));
  await ctx.db.patch(fixture.orderId, { total: 5800 });
  const pay = (await ctx.db.query('orderPayments').withIndex('by_orderId', q => q.eq('orderId', fixture.orderId)).first())!;
  await ctx.db.patch(pay._id, { amount: 5800 });
  return { ...fixture, goods, args: selection(fixture.orderId, [
    ...originals.slice(0, 2).map(row => ({ kind: 'cancelPackage' as const, lineId: row!._id })),
    ...goods.map(row => ({ kind: 'line' as const, lineId: row.lineId, units: 1, disposition: 'sellable' as const })),
  ], { clientKey: 'combined-maximum-return' }) };
}

it('keeps combined legal caps within the authorize and re-authorization budgets after verified cancel', async () => {
  const { t, owner } = await setup();
  const { args, orderId, grants, issued, goods } = await t.run(async ctx => {
    const fixture = await combinedMaximum(ctx);
    const lines = await ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', fixture.orderId)).take(101);
    assertCommerceCaps({
      kind: 'sale', rows: lines.length, packageRows: 2, expandedContents: 58, distinctVariants: 18,
      sessionGrants: 20, coveredRows: 0, voucherIssuances: 20, roomCharges: 18, feeRows: 0, paymentRows: 1,
      distinctFundingVouchers: 0, requestBytes: new TextEncoder().encode(JSON.stringify(fixture.args)).length,
      commerceStays: 0, commerceStayNights: 0, productQuantities: Array<number>(18).fill(1),
      rowSnapshotBytes: lines.map(row => new TextEncoder().encode(JSON.stringify(row.saleSnapshot)).length),
    });
    expect(lines).toHaveLength(100);
    return fixture;
  });
  expect(args.parts).toHaveLength(20);
  const authorize = (input: typeof args) => measured('Combined maximum authorize', { reads: 120, native: 440, writes: 510 },
    () => owner.mutation(command.authorize, input));
  const held = await authorize(args);
  expect(held).toMatchObject({ status: 'authorized', voucherCredits: [], claims: [{ amount: 4800, state: 'instructed' }] });
  const reservedState = () => t.run(async ctx => ({
    grants: await Promise.all(grants.map(id => ctx.db.get(id))),
    issued: await Promise.all(issued.map(id => ctx.db.get(id))),
    goods: await Promise.all(goods.map(async item => ({
      stock: await ctx.db.get(item.stockId), handover: await ctx.db.get(item.handoverId!),
    }))),
    projections: await ctx.db.query('grantServices').take(201),
  }));
  const before = await reservedState();
  for (const grant of before.grants) expect(grant).toMatchObject({ paidUnits: 0, goodwillUnits: 0, returnedUnits: 5, pendingReturnId: held.returnId });
  for (const voucher of before.issued) expect(voucher).toMatchObject({ paidBalance: 0, goodwillBalance: 0, pendingReturnId: held.returnId });
  for (const item of before.goods) {
    expect(item.stock).toMatchObject({ onHand: 2 });
    expect(item.handover).toMatchObject({ withGuest: 1, pendingReturnId: held.returnId });
  }
  expect(before.projections).toHaveLength(200);
  expect(before.projections.every(row => !row.usable)).toBe(true);
  const failed = await owner.mutation(command.recordPayout, { ...give(held), outcome: 'failed' });
  const cancelled = await measured('Combined maximum cancel', { writes: 320 }, () => owner.mutation(command.cancel, {
    returnId: held.returnId, tillId: args.tillId, operatorRevision: failed.operatorRevision,
  }));
  expect(cancelled.status).toBe('cancelled');
  const restored = await reservedState();
  for (const grant of restored.grants) expect(grant).toMatchObject({ paidUnits: 5, goodwillUnits: 1, returnedUnits: 0 });
  for (const voucher of restored.issued) expect(voucher).toMatchObject({ paidBalance: 50, goodwillBalance: 0 });
  expect(restored.projections.every(row => row.usable)).toBe(true);
  expect([...restored.grants, ...restored.issued, ...restored.goods.map(item => item.handover)].every(row => !row?.pendingReturnId)).toBe(true);
  const order = (await t.run(ctx => ctx.db.get(orderId)))!;
  const again = await authorize({ ...args, expectedRevision: order.revision, clientKey: 'combined-after-cancel' });
  expect(again.claims.map(({ amount, method, state }) => ({ amount, method, state })))
    .toEqual(held.claims.map(({ amount, method, state }) => ({ amount, method, state })));
  expect(again.parts).toEqual(held.parts);
  expect(again.voucherCredits).toEqual(held.voucherCredits);
  expect(again.returnId).not.toBe(held.returnId);
  const second = await reservedState();
  for (const [index, grant] of second.grants.entries()) expect(grant).toEqual({
    ...before.grants[index], revision: before.grants[index]!.revision + 2, pendingReturnId: again.returnId,
  });
  for (const [index, voucher] of second.issued.entries()) expect(voucher).toEqual({
    ...before.issued[index], revision: before.issued[index]!.revision + 2, pendingReturnId: again.returnId,
  });
  expect(second.projections).toEqual(before.projections);
  const paid = await measured('Combined maximum payout', { writes: 280 }, () => owner.mutation(command.recordPayout, give(again)));
  expect(paid.status).toBe('completed');
  const final = await reservedState();
  for (const item of final.goods) {
    expect(item.stock).toMatchObject({ onHand: 3 });
    expect(item.handover).toMatchObject({ withGuest: 0, backSellable: 1, status: 'closed' });
  }
  expect(await t.run(ctx => ctx.db.get(orderId))).toMatchObject({ returnedTotal: 4800 });
  const refunds = await t.run(ctx => ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', orderId)).take(21));
  expect(refunds).toHaveLength(20);
  expect(refunds.reduce((sum, row) => sum + row.amount, 0)).toBe(4800);
});

it('keeps authorize, re-authorize and payout within budget after earlier returns on the other 80 rows', async () => {
  const { t, owner } = await setup();
  const { args, orderId, prior } = await t.run(async ctx => {
    const fixture = await combinedMaximum(ctx);
    const lines = await ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', fixture.orderId)).take(101);
    const selected = new Set(fixture.args.parts.map(part => part.lineId));
    const prior = lines.filter(row => !selected.has(row._id));
    expect(prior).toHaveLength(80);
    for (const row of prior) await ctx.db.patch(row._id, { unitPrice: 1, catalogUnitPrice: 1, saleSnapshot: snapshot('Earlier service', 1) });
    await ctx.db.patch(fixture.orderId, { total: 5880 });
    const pay = (await ctx.db.query('orderPayments').withIndex('by_orderId', q => q.eq('orderId', fixture.orderId)).first())!;
    await ctx.db.patch(pay._id, { amount: 5880 });
    const sold = await ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', fixture.orderId)).take(101);
    assertCommerceCaps({
      kind: 'sale', rows: 100, packageRows: 2, expandedContents: 58, distinctVariants: 18, sessionGrants: 20, coveredRows: 0,
      voucherIssuances: 20, roomCharges: 18, feeRows: 0, paymentRows: 1, distinctFundingVouchers: 0,
      requestBytes: new TextEncoder().encode(JSON.stringify(fixture.args)).length, commerceStays: 0, commerceStayNights: 0,
      productQuantities: Array<number>(18).fill(1), rowSnapshotBytes: sold.map(row => new TextEncoder().encode(JSON.stringify(row.saleSnapshot)).length),
    });
    return { ...fixture, prior };
  });
  const current = async () => (await t.run(ctx => ctx.db.get(orderId)))!;
  // Four real completed returns: no fabricated totals or returned snapshots.
  for (let batch = 0; batch < 4; batch++) {
    const parts = prior.slice(batch * 20, batch * 20 + 20).map(row => ({ kind: 'line' as const, lineId: row._id, units: 1 }));
    const held = await owner.mutation(command.authorize, selection(orderId, parts, { expectedRevision: (await current()).revision, clientKey: `earlier-${batch}` }));
    expect((await owner.mutation(command.recordPayout, give(held))).status).toBe('completed');
  }
  expect(await current()).toMatchObject({ returnedTotal: 80, rowReturnedTotal: 80 });
  const authorize = async (clientKey: string) => {
    const input = { ...args, expectedRevision: (await current()).revision, clientKey };
    return await measured('Combined maximum after 80 earlier returns authorize', { native: 440, writes: 510 },
      () => owner.mutation(command.authorize, input));
  };
  const held = await authorize('combined-after-priors');
  expect(held).toMatchObject({ status: 'authorized', voucherCredits: [], claims: [{ amount: 4800, state: 'instructed' }] });
  const failed = await owner.mutation(command.recordPayout, { ...give(held), outcome: 'failed' });
  await measured('Combined maximum after earlier returns cancel', { writes: 320 }, () => owner.mutation(command.cancel, {
    returnId: held.returnId, tillId: args.tillId, operatorRevision: failed.operatorRevision,
  }));
  expect(await current()).toMatchObject({ returnedTotal: 80, rowReturnedTotal: 80 });
  const again = await authorize('combined-after-priors-again');
  expect(again.claims.map(({ amount, method }) => ({ amount, method }))).toEqual([{ amount: 4800, method: 'card' }]);
  expect((await measured('Combined maximum after earlier returns payout', { writes: 280 },
    () => owner.mutation(command.recordPayout, give(again)))).status).toBe('completed');
  expect(await current()).toMatchObject({ returnedTotal: 4880, rowReturnedTotal: 4880 });
});
