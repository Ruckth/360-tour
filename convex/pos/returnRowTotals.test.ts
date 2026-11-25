// @vitest-environment edge-runtime
import { seedTestBranch } from '../testing/staff.test-support';
import { afterEach, expect, it, vi } from 'vitest';
import type { Id } from '../_generated/dataModel';
import { command, give, line, payment, receipt, selection, setup, snapshot, voucher } from '../../tests/support/return-items-fixture';

/*
 * `orders.rowReturnedTotal` lets authorize skip reading earlier-returned siblings. Randomized partial-return
 * sequences (authorize, payout, verified cancel, voucher-only completion, receipts returned before the total
 * existed) prove it always equals the full row sum, and that planning from it quotes exactly what the
 * full row read quotes.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

it.each(Array.from({ length: 12 }, (_, index) => index + 1))('stored row total matches the full row read through random partial returns (seed %i)', async seed => {
  const next = random(seed);
  const pick = (max: number) => Math.floor(next() * max);
  const { t, owner } = await setup();
  const { orderId, lineIds } = await t.run(async ctx => {
    const shares = Array.from({ length: 30 }, () => ({ qty: 1 + pick(3), share: 1 + pick(60) }));
    const total = shares.reduce((sum, row) => sum + row.share, 0);
    const orderId = await receipt(ctx, total, shares.length);
    const branchId = await seedTestBranch(ctx);
    const lineIds: Id<'orderLines'>[] = [];
    for (const [index, { qty, share }] of shares.entries()) {
      lineIds.push(await line(ctx, orderId, 'service', Math.ceil(share / qty), { qty, saleSnapshot: snapshot(`Row ${index}`, share) }));
    }
    // The voucher tender makes it a commerce receipt; its share varies the voucher-first routing.
    const voucherTender = Math.max(1, Math.floor(total * (0.05 + next() * 0.8)));
    const voucherId = await voucher(ctx, { kind: 'sale', orderId, lineId: lineIds[0] }, branchId, 0, { faceValue: total });
    await payment(ctx, orderId, { method: 'voucher', voucherId, amount: voucherTender });
    await payment(ctx, orderId, { method: pick(2) ? 'card' : 'cash', amount: total - voucherTender });
    return { orderId, lineIds };
  });
  const state = () => t.run(async ctx => ({
    order: (await ctx.db.get(orderId))!,
    lines: await ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', orderId)).take(101),
  }));
  const fullSum = (lines: Awaited<ReturnType<typeof state>>['lines']) =>
    lines.reduce((sum, row) => sum + (row.saleSnapshot?.returnedAmount ?? 0), 0);
  let compared = 0;
  for (let step = 0; step < 10; step++) {
    const { order, lines } = await state();
    const open = lines.filter(row => row.saleSnapshot!.returnedUnits < row.qty);
    if (!open.length) break;
    // A receipt returned before the stored total existed: planning must fall back to reading the rows.
    if (order.rowReturnedTotal !== undefined && pick(6) === 0) await t.run(ctx => ctx.db.patch(orderId, { rowReturnedTotal: undefined }));
    const chosen = [...new Map(Array.from({ length: 1 + pick(4) }, () => open[pick(open.length)]).map(row => [row._id, row])).values()];
    const args = selection(orderId, chosen.map(row => ({
      kind: 'line' as const, lineId: row._id, units: 1 + pick(row.qty - row.saleSnapshot!.returnedUnits),
    })), { expectedRevision: order.revision, clientKey: `random-${seed}-${step}` });
    const stored = (await state()).order.rowReturnedTotal;
    if (stored !== undefined) {
      const bounded = await owner.query(command.preview, args);
      await t.run(ctx => ctx.db.patch(orderId, { rowReturnedTotal: undefined }));
      const full = await owner.query(command.preview, args);
      await t.run(ctx => ctx.db.patch(orderId, { rowReturnedTotal: stored }));
      expect(bounded).toEqual(full);
      compared++;
    }
    const held = await owner.mutation(command.authorize, args);
    if (held.status === 'authorized') {
      if (pick(4) === 0) {
        const failed = await owner.mutation(command.recordPayout, { ...give(held), outcome: 'failed' });
        expect((await owner.mutation(command.cancel, { returnId: held.returnId, tillId: args.tillId, operatorRevision: failed.operatorRevision })).status).toBe('cancelled');
      } else {
        expect((await owner.mutation(command.recordPayout, give(held))).status).toBe('completed');
      }
    } else expect(held.status).toBe('completed');
    const after = await state();
    if (after.order.rowReturnedTotal !== undefined) expect(after.order.rowReturnedTotal).toBe(fullSum(after.lines));
  }
  expect(compared).toBeGreaterThan(0);
  const { order, lines } = await state();
  // Every satang taken off a row went to a card/cash payout or back to the funding voucher.
  const voucherTender = await t.run(ctx => ctx.db.query('orderPayments').withIndex('by_orderId_and_method', q => q.eq('orderId', orderId).eq('method', 'voucher')).first());
  const credited = fullSum(lines) - (order.returnedTotal ?? 0);
  expect(credited).toBeGreaterThanOrEqual(0);
  expect(credited).toBeLessThanOrEqual(voucherTender?.amount ?? 0);
  expect(lineIds).toHaveLength(30);
});
