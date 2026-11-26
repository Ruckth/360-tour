// @vitest-environment edge-runtime
import { seedTestBranch } from '../testing/staff.test-support';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import type { MutationCtx } from '../_generated/server';
import { creditMoney, syncAffiliateCredit } from '../marketing/model';
import { DEFAULT_CASHIER_RULES } from '../shared/staffTypes';
import { projectTender } from '../shared/tenderProjection';
import { resortTodayIso } from '../shared/time';

import {
  command, now, day, settings, setup, receipt, line, payment, allocation, snapshot, catalog, product, voucher, selection, destination, give, soldProduct, maximumPackages,
} from '../../tests/support/return-items-fixture';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('keeps the original refund deadline when a failed give-back is retried by another method (lead decision)', async () => {
  const { t, owner } = await setup();
  const { args } = await t.run(ctx => soldProduct(ctx));
  const result = await owner.mutation(command.authorize, args);
  const promised = result.claims[0].dueAt;
  const failed = await owner.mutation(command.recordPayout, { ...give(result), outcome: 'failed' });
  // Cash would quote 15 days from today; the guest was promised the card's 45.
  const ready = await owner.mutation(command.retry, { ...destination(failed), reason: 'Card declined', method: 'cash' });
  expect(ready.claims[0]).toMatchObject({ method: 'cash', state: 'owed', dueAt: promised });
  const armed = await owner.mutation(command.arm, destination(ready));
  expect(armed.claims[0]).toMatchObject({ method: 'cash', state: 'instructed', dueAt: promised });
});

it('shows reconciliation on terminal approval and reload, then records exactly one next-day payout', async () => {
  const { t, owner, date, other } = await setup();
  const { orderId, stockId, args } = await t.run(ctx => soldProduct(ctx));
  const result = await owner.mutation(command.authorize, args);
  expect(result.instruction).toMatchObject({ state: 'instructed', amount: 100, method: 'card' });
  expect(await owner.mutation(command.authorize, args)).toMatchObject({ replayed: true, instruction: null });
  expect((await t.run(ctx => ctx.db.get(stockId)))?.onHand).toBe(2);
  const view = await owner.query(command.get, { orderId, tillId: 'desk-a' });
  expect(view).toMatchObject({ claims: [{ state: 'instructed' }] });
  expect(view).not.toHaveProperty('instruction');
  await expect(owner.mutation(command.arm, destination(result))).rejects.toThrow('RETURN_CHECK_PREVIOUS');
  date.mockReturnValue(now + day);
  const claim = await other.mutation(command.claim, {
    returnId: result.returnId, operatorRevision: result.operatorRevision, tillId: 'desk-b',
    previousOperatorStopped: true, reason: 'First operator finished for the day',
  });
  await expect(owner.mutation(command.recordPayout, give(result))).rejects.toThrow('RETURN_OPERATOR_REQUIRED');
  const payout = { ...give(claim, 'desk-b'), reference: 'CARD-APPROVED-1', givenAt: now + 1000 };
  const responses = await Promise.all([other.mutation(command.recordPayout, payout), other.mutation(command.recordPayout, payout)]);
  expect(responses.map(item => item.replayed).sort()).toEqual([false, true]);
  const saved = await t.run(async ctx => ({
    payouts: await ctx.db.query('returnPayouts').collect(),
    refunds: await ctx.db.query('orderRefunds').collect(),
    order: await ctx.db.get(orderId), stock: await ctx.db.get(stockId),
  }));
  expect(saved.payouts).toMatchObject([{ amount: 100, businessDate: '2026-11-19', reference: 'CARD-APPROVED-1' }]);
  expect(saved.refunds).toMatchObject([{ amount: 100, returnId: result.returnId }]);
  expect(saved.order?.returnedTotal).toBe(100);
  expect(saved.stock?.onHand).toBe(3);
  expect(projectTender({
    payouts: saved.payouts, refunds: saved.refunds.map(refund => ({ ...refund, date: refund.businessDate })),
  }).refunded).toBe(100);
});

it('binds approval to the cashier and serializes four competing tills', async () => {
  const { t, cashier, manager, other, owner } = await setup();
  const { args } = await t.run(ctx => soldProduct(ctx));
  const request = await cashier.mutation(command.askManager, args);
  expect(await t.run(ctx => ctx.db.get(request.requestId))).toMatchObject({ commerceRevision: 0 });
  expect(await cashier.mutation(command.askManager, args)).toEqual(request);
  await expect(cashier.mutation(command.decideApproval, { requestId: request.requestId, decision: 'approve' }))
    .rejects.toThrow('RETURN_SELF_APPROVAL');
  const approved = await manager.mutation(command.decideApproval, { requestId: request.requestId, decision: 'approve' });
  expect(approved.status).toBe('authorized');
  const view = (await cashier.query(command.get, { orderId: args.orderId, tillId: 'desk-a' }))!;
  expect(view).toMatchObject({ isOperatorTill: true, claims: [{ state: 'owed' }] });
  const armed = await cashier.mutation(command.arm, destination(view));
  expect(armed.instruction.state).toBe('instructed');
  const claims = await Promise.allSettled([owner, manager, other, owner].map((actor, index) => actor.mutation(command.claim, {
    returnId: view.returnId, tillId: `desk-${index + 2}`, operatorRevision: armed.operatorRevision,
    previousOperatorStopped: true, reason: 'Previous operator released the terminal',
  })));
  expect(claims.filter(claim => claim.status === 'fulfilled')).toHaveLength(1);
  const winner = claims.findIndex(claim => claim.status === 'fulfilled');
  const actor = [owner, manager, other, owner][winner];
  const won = claims[winner];
  if (won.status !== 'fulfilled') throw new Error('Missing claim winner');
  await actor.mutation(command.recordPayout, give(won.value, `desk-${winner + 2}`));
  expect(await cashier.query(api.pos.staffApprovals.myStatus, { requestId: request.requestId })).toMatchObject({ status: 'applied' });
});

it('cannot authorize a cashier return after their last assigned branch is archived', async () => {
  const { t, cashier, owner } = await setup();
  const { args } = await t.run(ctx => soldProduct(ctx));
  const { requestId } = await cashier.mutation(command.askManager, args);
  const [branch] = await owner.query(api.branches.branches.list, {});
  await owner.mutation(internal.branches.branches.setState, { branchId: branch._id, revision: branch.revision, state: 'suspended', reason: 'Closing' });
  await owner.mutation(internal.branches.branches.setState, { branchId: branch._id, revision: branch.revision + 1, state: 'archived' });
  await expect(owner.mutation(command.decideApproval, { requestId, decision: 'approve' })).resolves.toMatchObject({ status: 'stale' });
  expect(await t.run(ctx => ctx.db.query('orderReturns').first())).toBeNull();
});

it('authorizes at a cashier till only under the current Refund rule, including on replay', async () => {
  const { t, cashier, owner } = await setup();
  const { args } = await t.run(ctx => soldProduct(ctx));
  const managerRequired = { data: { code: 'RETURN_MANAGER_REQUIRED' } };
  await expect(cashier.mutation(command.authorize, args)).rejects.toMatchObject(managerRequired);
  const { revision, ...rules } = DEFAULT_CASHIER_RULES;
  const allowed = await owner.mutation(api.settings.cashierRules.updateCashierRules, {
    ...rules, expectedRevision: revision, refund: 'cashier',
  });
  const held = await cashier.mutation(command.authorize, args);
  expect(held).toMatchObject({
    replayed: false, isOperatorTill: true, claims: [{ state: 'instructed' }],
    instruction: { key: held.claims[0].key, state: 'instructed' },
  });
  await expect(cashier.mutation(command.authorize, args)).resolves.toMatchObject({
    replayed: true, returnId: held.returnId, instruction: null,
  });
  await owner.mutation(api.settings.cashierRules.updateCashierRules, {
    ...rules, expectedRevision: allowed.revision, refund: 'manager',
  });
  await expect(cashier.mutation(command.authorize, args)).rejects.toMatchObject(managerRequired);
  await expect(cashier.mutation(command.recordPayout, give(held))).resolves.toMatchObject({ status: 'completed' });
  expect(await t.run(ctx => ctx.db.query('orderReturns').take(2))).toHaveLength(1);
});

it('rechecks stock shared with another receipt when its payout changes the reviewed revision', async () => {
  const { t, cashier, manager, owner } = await setup();
  const fixture = await t.run(async ctx => {
    const reviewed = await soldProduct(ctx);
    const original = (await ctx.db.get(reviewed.lineId))!;
    const otherId = await receipt(ctx, 100);
    const otherLineId = await line(ctx, otherId, 'product', 100, {
      variantId: original.variantId, saleSnapshot: original.saleSnapshot,
    });
    await payment(ctx, otherId, { method: 'card', amount: 100 });
    return { reviewed: reviewed.args, other: selection(otherId, [{ kind: 'line', lineId: otherLineId, units: 1, disposition: 'sellable' }]) };
  });
  const request = await cashier.mutation(command.askManager, fixture.reviewed);
  expect(await manager.query(api.pos.staffApprovals.detail, { requestId: request.requestId })).toMatchObject({ status: 'pending' });
  const paid = await owner.mutation(command.authorize, fixture.other);
  await owner.mutation(command.recordPayout, give(paid));
  expect(await manager.query(api.pos.staffApprovals.detail, { requestId: request.requestId })).toMatchObject({ status: 'stale' });
  expect(await manager.mutation(command.decideApproval, { requestId: request.requestId, decision: 'approve' }))
    .toMatchObject({ status: 'stale' });
  expect(await t.run(ctx => ctx.db.query('orderReturns').take(2))).toHaveLength(1);
});

it('keeps a partially paid return open, verifies an unknown payment, and retries by a manager-selected method', async () => {
  const { t, owner } = await setup();
  const { orderId, stockId, args } = await t.run(ctx => soldProduct(ctx));
  const result = await owner.mutation(command.authorize, { ...args, destinations: [{ amount: 30, method: 'card' }, { amount: 70, method: 'cash' }] });
  const first = await owner.mutation(command.recordPayout, give(result));
  await expect(owner.mutation(command.cancel, { returnId: result.returnId, tillId: 'desk-a', operatorRevision: first.operatorRevision }))
    .rejects.toThrow('RETURN_ALREADY_PAID');
  const second = await owner.mutation(command.arm, { returnId: result.returnId, tillId: 'desk-a', operatorRevision: first.operatorRevision, destinationKey: 'external:2' });
  const unknown = await owner.mutation(command.recordPayout, { ...give(second, 'desk-a', 'external:2'), outcome: 'unknown' });
  const retryArgs = { ...destination(unknown, 'desk-a', 'external:2'), reason: 'Terminal verified', method: 'transfer' as const };
  await expect(owner.mutation(command.retry, retryArgs)).rejects.toThrow('RETURN_CHECK_PREVIOUS');
  const failed = await owner.mutation(command.recordPayout, { ...give(unknown, 'desk-a', 'external:2'), outcome: 'failed' });
  const ready = await owner.mutation(command.retry, { ...retryArgs, operatorRevision: failed.operatorRevision });
  const final = await owner.mutation(command.arm, {
    returnId: result.returnId, tillId: 'desk-a', operatorRevision: ready.operatorRevision, destinationKey: 'external:2',
  });
  expect((await t.run(ctx => ctx.db.get(stockId)))?.onHand).toBe(2);
  await owner.mutation(command.recordPayout, give(final, 'desk-a', 'external:2'));
  expect((await t.run(ctx => ctx.db.get(orderId)))?.returnedTotal).toBe(100);
  expect(await t.run(ctx => ctx.db.query('returnPayouts').collect())).toMatchObject([
    { amount: 30, method: 'card' }, { amount: 70, method: 'transfer' },
  ]);
});

it('returns cumulative paid units to zero and consumes a voucher contribution before cash', async () => {
  const { t, owner } = await setup();
  const { orderId, lineId, voucherId } = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const orderId = await receipt(ctx, 11);
    const lineId = await line(ctx, orderId, 'service', 11, { qty: 5 });
    const voucherId = await voucher(ctx, { kind: 'sale', orderId, lineId }, branchId, 0, { faceValue: 3 });
    const saleSnapshot = snapshot('Five equal units', 11);
    saleSnapshot.tenderCells = [{ kind: 'voucher', voucherId, amount: 3 }, { kind: 'external', amount: 8 }];
    await ctx.db.patch(lineId, { saleSnapshot });
    await payment(ctx, orderId, { amount: 3, method: 'voucher', voucherId });
    await payment(ctx, orderId, { amount: 8, method: 'cash' });
    return { orderId, lineId, voucherId };
  });
  for (const [index, returnedAmount] of [2, 4, 7, 9, 11].entries()) {
    const order = await t.run(ctx => ctx.db.get(orderId));
    const result = await owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId, units: 1 }], {
      clientKey: `return-step-${index}`, expectedRevision: order!.revision,
    }));
    if (result.status === 'authorized') await owner.mutation(command.recordPayout, give(result));
    const lineRow = await t.run(ctx => ctx.db.get(lineId));
    expect(lineRow?.saleSnapshot).toMatchObject({ returnedUnits: index + 1, returnedAmount, paidShare: 11, vatBase: 11 });
  }
  expect((await t.run(ctx => ctx.db.get(voucherId)))?.paidBalance).toBe(3);
  expect((await t.run(ctx => ctx.db.get(orderId)))?.returnedTotal).toBe(8);
});

it('reduces partner credit once for external money and leaves the voucher credit out of the cash total', async () => {
  const { t, owner } = await setup();
  const { orderId, lineId, creditId, voucherId } = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const orderId = await receipt(ctx, 600);
    const lineId = await line(ctx, orderId, 'service', 600);
    const voucherId = await voucher(ctx, { kind: 'sale', orderId, lineId }, branchId, 0, { faceValue: 200 });
    const changes = { createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com' };
    const campaignId = await ctx.db.insert('marketingCampaigns', {
      name: 'Referral', source: 'partner', medium: 'link', status: 'active', ...changes,
    });
    const affiliateId = await ctx.db.insert('marketingAffiliates', {
      campaignId, name: 'Partner', slug: 'partner', status: 'active', ...changes,
    });
    await ctx.db.patch(orderId, {
      affiliateSnapshot: {
        capturedAt: now, affiliateId, flags: [],
        candidates: [{ affiliateId, name: 'Partner', slug: 'partner', origin: 'link', eligible: true }],
      },
    });
    await ctx.db.patch(lineId, {
      saleSnapshot: { ...snapshot('Massage', 600), tenderCells: [{ kind: 'voucher', voucherId, amount: 200 }, { kind: 'external', amount: 400 }] },
    });
    await payment(ctx, orderId, { method: 'voucher', voucherId, amount: 200 });
    await payment(ctx, orderId, { method: 'card', amount: 400 });
    const creditId = (await syncAffiliateCredit(ctx, { orderId }))!;
    await ctx.db.patch(creditId, { state: 'approved', approvedNet: 400 });
    return { orderId, lineId, creditId, voucherId };
  });
  const result = await owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId, units: 1 }]));
  expect(result.voucherCredits).toMatchObject([{ voucherId, paid: 200, goodwill: 0 }]);
  expect(result.claims).toMatchObject([{ amount: 400 }]);
  expect(await t.run(ctx => ctx.db.get(creditId))).toMatchObject({ approvedNet: 400, revision: 0 });
  expect((await t.run(ctx => ctx.db.get(voucherId)))?.paidBalance).toBe(0);
  await owner.mutation(command.recordPayout, give(result));
  await owner.mutation(command.recordPayout, give(result));
  expect(await t.run(ctx => ctx.db.get(creditId))).toMatchObject({ state: 'reversed', approvedNet: 0, eligibleNet: 0, revision: 1 });
  expect((await t.run(ctx => ctx.db.get(voucherId)))?.paidBalance).toBe(200);
  expect((await t.run(ctx => ctx.db.get(orderId)))?.returnedTotal).toBe(400);
});

/** Two massages plus a ฿200 robe (a commerce row that earns no partner credit), all paid by card. */
async function partnerOrder(ctx: MutationCtx, prices: number[]) {
  const robe = 20000;
  const total = prices.reduce((sum, price) => sum + price, robe);
  const orderId = await receipt(ctx, total, prices.length + 1);
  const lineIds = [];
  for (const price of prices) lineIds.push(await line(ctx, orderId, 'service', price, { saleSnapshot: snapshot('Massage', price) }));
  await line(ctx, orderId, 'product', robe, { saleSnapshot: snapshot('Robe', robe) });
  const changes = { createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com' };
  const campaignId = await ctx.db.insert('marketingCampaigns', { name: 'Referral', source: 'partner', medium: 'link', status: 'active', ...changes });
  const affiliateId = await ctx.db.insert('marketingAffiliates', { campaignId, name: 'Partner', slug: 'partner', status: 'active', ...changes });
  await ctx.db.patch(orderId, { affiliateSnapshot: {
    capturedAt: now, affiliateId, flags: [], candidates: [{ affiliateId, name: 'Partner', slug: 'partner', origin: 'link', eligible: true }],
  } });
  await payment(ctx, orderId, { method: 'card', amount: total });
  return { orderId, lineIds };
}

it('lowers approved partner credit by a partial payout exactly as a full recount would', async () => {
  const { t, owner } = await setup();
  const { orderId, lineIds, creditId } = await t.run(async ctx => {
    const sale = await partnerOrder(ctx, [60000, 40000]);
    const creditId = (await syncAffiliateCredit(ctx, { orderId: sale.orderId }))!;
    await ctx.db.patch(creditId, { state: 'approved', approvedNet: 100000 });
    return { ...sale, creditId };
  });
  const result = await owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId: lineIds[1], units: 1 }]));
  await owner.mutation(command.recordPayout, give(result));
  const credit = await t.run(ctx => ctx.db.get(creditId));
  expect(credit).toMatchObject({ state: 'approved', eligible: true, eligibleNet: 60000, approvedNet: 60000, revision: 1 });
  // The full recount from history agrees with the bounded update.
  expect(await t.run(async ctx => creditMoney(ctx, { orderId }))).toEqual({ eligible: true, net: 60000 });
});

it('records a payout on a receipt with more refund history than a partner recount can read', async () => {
  const { t, owner } = await setup();
  const { orderId, lineIds, creditId } = await t.run(async ctx => {
    const sale = await partnerOrder(ctx, [60000, 40000]);
    // 1,001 earlier ฿0 refund rows: a full recount refuses at MAX_ORDER_REFUNDS (1,000).
    for (let index = 0; index <= 1000; index++) {
      await ctx.db.insert('orderRefunds', {
        orderId: sale.orderId, lineId: sale.lineIds[0], amount: 0, currency: 'THB', method: 'cash', reason: 'Earlier',
        idempotencyKey: `earlier:${index}`, createdBy: 'cashier', createdByEmail: 'cashier@example.com', createdAt: now, businessDate: '2026-11-19',
      });
    }
    const creditId = await ctx.db.insert('affiliateCredits', {
      sourceKey: `order:${sale.orderId}`, orderId: sale.orderId, snapshot: (await ctx.db.get(sale.orderId))!.affiliateSnapshot!,
      state: 'approved', eligibleNet: 100000, approvedNet: 100000, eligible: true, revision: 0, createdAt: now, updatedAt: now,
    });
    return { ...sale, creditId };
  });
  await expect(t.run(async ctx => creditMoney(ctx, { orderId }))).rejects.toThrow('credit review limit');
  const result = await owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId: lineIds[1], units: 1 }]));
  expect(await owner.mutation(command.recordPayout, give(result))).toMatchObject({ status: 'completed' });
  expect(await t.run(ctx => ctx.db.get(creditId))).toMatchObject({ state: 'approved', eligibleNet: 60000, approvedNet: 60000, revision: 1 });
  expect((await t.run(ctx => ctx.db.get(orderId)))?.returnedTotal).toBe(40000);
});

it.each([0, 50000])('restores goodwill as goodwill only with %s external satang', async external => {
  const { t, owner } = await setup();
  const { orderId, lineId, voucherId } = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const orderId = await receipt(ctx, external);
    const lineId = await line(ctx, orderId, 'service', external + 10000);
    const voucherId = await voucher(ctx, { kind: 'sale', orderId, lineId }, branchId, 0, { faceValue: 40000 });
    await ctx.db.patch(lineId, { saleSnapshot: { ...snapshot('Massage', external), goodwillDiscounts: [{ voucherId, amount: 10000 }] } });
    if (external) await payment(ctx, orderId, { amount: external, method: 'cash' });
    return { orderId, lineId, voucherId };
  });
  const result = await owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId, units: 1 }]));
  const before = await t.run(ctx => ctx.db.get(voucherId));
  if (external) {
    expect(before).toMatchObject({ goodwillBalance: 0, pendingReturnId: result.returnId });
    expect(result.claims).toMatchObject([{ amount: external }]);
    await owner.mutation(command.recordPayout, give(result));
  } else {
    expect(result.status).toBe('completed');
    expect(result.claims).toEqual([]);
  }
  expect(await t.run(ctx => ctx.db.get(voucherId))).toMatchObject({ paidBalance: 0, goodwillBalance: 10000 });
  expect((await t.run(ctx => ctx.db.get(orderId)))?.returnedTotal).toBe(external);
});

it('guards existing money writers during the return and cancels a verified not-given payout without releasing stock', async () => {
  const { t, owner } = await setup();
  const { orderId, lineId, stockId, handoverId, args } = await t.run(ctx => soldProduct(ctx, 100, true));
  const result = await owner.mutation(command.authorize, args);
  const correction = { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'correct-test', reason: 'Mistake' };
  await expect(owner.mutation(api.pos.commands.refundLine.refundLine, {
    orderId, lineId, amount: 100, currency: 'THB', method: 'card', idempotencyKey: 'refund-test', reason: 'Return',
  })).rejects.toThrow('RETURN_IN_PROGRESS');
  await expect(owner.mutation(api.pos.commands.voidOrder.voidOrder, { orderId, reason: 'Mistake' })).rejects.toThrow('RETURN_IN_PROGRESS');
  await expect(owner.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, correction)).rejects.toThrow('RETURN_IN_PROGRESS');
  await expect(owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, correction)).rejects.toThrow('RETURN_IN_PROGRESS');
  const failed = await owner.mutation(command.recordPayout, { ...give(result), outcome: 'failed' });
  const cancelled = await owner.mutation(command.cancel, { returnId: result.returnId, tillId: 'desk-a', operatorRevision: failed.operatorRevision });
  expect(cancelled.status).toBe('cancelled');
  expect(await t.run(ctx => ctx.db.get(handoverId!))).toMatchObject({ withGuest: 1, backSellable: 0 });
  expect((await t.run(ctx => ctx.db.get(handoverId!)))?.pendingReturnId).toBeUndefined();
  expect((await t.run(ctx => ctx.db.get(stockId)))?.onHand).toBe(2);
  await expect(owner.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, correction)).resolves.toMatchObject({ replayed: false });
});

it('rejects visit rows without a visit and accommodation parts before creating a claim', async () => {
  const { t, owner } = await setup();
  const { orderId, appointmentLine, roomLine } = await t.run(async ctx => {
    const { orderId } = await soldProduct(ctx);
    return {
      orderId,
      appointmentLine: await line(ctx, orderId, 'appointment', 0, { saleSnapshot: snapshot('Visit', 0) }),
      roomLine: await line(ctx, orderId, 'booking', 0, { saleSnapshot: snapshot('Stay', 0) }),
    };
  });
  await expect(owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId: appointmentLine, units: 1 }])))
    .rejects.toThrow('RETURN_VISIT_SOURCE');
  await expect(owner.mutation(command.authorize, selection(orderId, [{ kind: 'line', lineId: roomLine, units: 1 }])))
    .rejects.toThrow('RETURN_BOOKING_OWNED');
  expect(await t.run(ctx => ctx.db.query('orderReturns').collect())).toEqual([]);
});

it('gives only the tab that arms a retry a fresh payout instruction, even in the same millisecond', async () => {
  const { t, owner, manager } = await setup();
  const { args, orderId } = await t.run(ctx => soldProduct(ctx));
  const revision = async (expected: number) => {
    expect((await t.run(ctx => ctx.db.get(orderId)))?.commerceRevision).toBe(expected);
  };
  const first = await owner.mutation(command.authorize, args);
  await revision(1);
  const oldKey = first.instruction!.key;
  const firstView = (await owner.query(command.get, { orderId, tillId: args.tillId }))!;
  expect(firstView.claims[0]).toMatchObject({ key: oldKey, state: 'instructed' });
  expect(firstView).not.toHaveProperty('instruction');

  const failed = await owner.mutation(command.recordPayout, { ...destination(first, args.tillId, oldKey), outcome: 'failed' });
  await revision(2);
  const owed = await owner.mutation(command.retry, { ...destination(failed, args.tillId, oldKey), reason: 'Checked the terminal' });
  await revision(3);
  const contenders = await Promise.allSettled([owner, owner].map(tab => tab.mutation(command.arm, destination(owed))));
  const winner = contenders.find(result => result.status === 'fulfilled');
  expect(contenders.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(winner?.value.instruction).toMatchObject({ instructedAt: first.instruction!.instructedAt });
  const newKey = winner!.value.instruction.key;
  const latest = (await owner.query(command.get, { orderId, tillId: args.tillId }))!;
  expect(latest.claims[0]).toMatchObject({ key: newKey, state: 'instructed' });
  expect(newKey).not.toBe(oldKey);
  expect(latest).not.toHaveProperty('instruction');
  await revision(4);

  const released = await owner.mutation(command.release, { returnId: latest.returnId, tillId: args.tillId, operatorRevision: latest.operatorRevision });
  await revision(5);
  const claimed = await manager.mutation(command.claim, { returnId: released.returnId, operatorRevision: released.operatorRevision, tillId: 'desk-b' });
  await revision(6);
  expect(claimed.claims[0].key).not.toBe(newKey);
  expect(claimed).not.toHaveProperty('instruction');
  await manager.mutation(command.recordPayout, give(claimed, 'desk-b', claimed.claims[0].key));
  await revision(7);
  expect(await t.run(ctx => ctx.db.query('returnPayouts').take(2))).toMatchObject([{ destinationKey: 'external:1' }]);
});

it('keeps the original till in reconciliation after a manager takes over, releases, and the original till reclaims', async () => {
  const { t, manager } = await setup();
  const { args, orderId } = await t.run(ctx => soldProduct(ctx));
  const original = await manager.mutation(command.authorize, args);
  const taken = await manager.mutation(command.claim, {
    returnId: original.returnId, tillId: 'desk-b', operatorRevision: original.operatorRevision,
    previousOperatorStopped: true, reason: 'Previous cashier has left the terminal',
  });
  const released = await manager.mutation(command.release, {
    returnId: original.returnId, tillId: 'desk-b', operatorRevision: taken.operatorRevision,
  });
  const reclaimed = await manager.mutation(command.claim, {
    returnId: original.returnId, tillId: args.tillId, operatorRevision: released.operatorRevision,
  });
  const views = [taken, released, reclaimed, await manager.query(command.get, { orderId, tillId: args.tillId })];
  for (const view of views) {
    expect(view).not.toHaveProperty('instruction');
    expect(view?.claims[0]).toMatchObject({ state: 'instructed', instructedAt: original.instruction!.instructedAt });
    expect(view?.claims[0].key).not.toBe(original.instruction!.key);
  }
  expect((await manager.query(api.pos.orders.getOrder, { orderId }))?.activeReturn?.claims).toEqual(reclaimed.claims);
  await expect(manager.mutation(command.recordPayout, give(original, args.tillId, original.instruction!.key)))
    .rejects.toThrow('RETURN_DESTINATION_NOT_FOUND');
  await expect(manager.mutation(command.arm, destination(reclaimed, args.tillId, reclaimed.claims[0].key)))
    .rejects.toThrow('RETURN_CHECK_PREVIOUS');
});

it('retains only open return operator recovery after midnight and closes both ID and replay access on completion', async () => {
  const { t, cashier, manager, date } = await setup();
  const { args, orderId } = await t.run(ctx => soldProduct(ctx));
  const request = await cashier.mutation(command.askManager, args);
  const approved = await manager.mutation(command.decideApproval, { requestId: request.requestId, decision: 'approve' });
  if (!('returnId' in approved) || !approved.returnId) throw new Error('Missing authorized return');
  const armed = await cashier.mutation(command.arm, destination({ returnId: approved.returnId, operatorRevision: 0 }));
  date.mockReturnValue(now + day);
  expect(await cashier.query(api.pos.orders.getOrder, { orderId })).toMatchObject({ activeReturn: { _id: armed.returnId } });
  expect(await cashier.query(api.pos.orders.findOrderByNumber, { orderNumber: 1 })).toBe(orderId);
  expect(await cashier.query(api.pos.staffApprovals.forOrder, { orderId })).toEqual([]);
  expect((await cashier.query(command.get, { orderId, tillId: args.tillId }))?.claims[0].state).toBe('instructed');
  const given = { ...give(armed, args.tillId, armed.instruction.key), givenAt: now + 1 };
  await cashier.mutation(command.recordPayout, given);
  expect(await cashier.query(api.pos.orders.findOrderByNumber, { orderNumber: 1 })).toBeNull();
  expect(await cashier.query(command.get, { returnId: armed.returnId, tillId: args.tillId })).toBeNull();
  await expect(cashier.mutation(command.recordPayout, given)).rejects.toThrow('RETURN_ORDER_NOT_FOUND');
  expect(await manager.query(command.get, { returnId: armed.returnId })).toMatchObject({ status: 'completed' });
  expect(await t.run(ctx => ctx.db.query('returnPayouts').first())).toMatchObject({ businessDate: '2026-11-19', createdAt: now + 1 });
});

it('keeps a paid room charge out of the quote and authorization when the goods stay with the guest', async () => {
  const { t, owner } = await setup();
  const { args, lineId, handoverId, stockId } = await t.run(ctx => soldProduct(ctx, 35000, true));
  const kept = { ...args, parts: [{ kind: 'line' as const, lineId, units: 1 }] };
  await expect(owner.query(command.preview, kept)).rejects.toThrow('RETURN_CUSTODY_REQUIRED');
  await expect(owner.mutation(command.authorize, kept)).rejects.toThrow('RETURN_CUSTODY_REQUIRED');
  expect(await t.run(ctx => ctx.db.query('orderReturns').first())).toBeNull();
  expect(await t.run(ctx => ctx.db.get(handoverId!))).toMatchObject({ withGuest: 1, paid: 1 });
  expect(await t.run(ctx => ctx.db.get(stockId))).toMatchObject({ onHand: 2 });
});

it('reauthorizes an unspent mistaken voucher after a verified cancel and rejects any lifetime spend', async () => {
  const { t, owner } = await setup();
  const { args, voucherId } = await t.run(async ctx => {
    const orderId = await receipt(ctx, 50000);
    const lineId = await line(ctx, orderId, 'voucher', 50000);
    const voucherId = await voucher(ctx, { kind: 'sale', orderId, lineId }, (await catalog(ctx)).branchId, 50000);
    await ctx.db.patch(lineId, { saleSnapshot: snapshot('Gift', 50000, [{
      contentKey: 'voucher', label: 'Gift', units: 1, ...allocation(50000), vatProfile: 'exempt', voucherId,
    }]) });
    await payment(ctx, orderId, { method: 'card', amount: 50000 });
    return { voucherId, args: selection(orderId, [{ kind: 'line', lineId, units: 1 }], { mistakenSale: true }) };
  });
  const cancel = async (currentArgs: typeof args) => {
    const held = await owner.mutation(command.authorize, currentArgs);
    const failed = await owner.mutation(command.recordPayout, { ...destination(held), outcome: 'failed' });
    await owner.mutation(command.cancel, { returnId: held.returnId, operatorRevision: failed.operatorRevision, tillId: args.tillId });
    expect(await t.run(ctx => ctx.db.get(voucherId))).toMatchObject({ paidBalance: 50000 });
  };
  await cancel(args);
  expect(await t.run(ctx => ctx.db.get(args.orderId))).toMatchObject({ commerceRevision: 3, revision: 3 });
  await cancel({ ...args, expectedRevision: 3, clientKey: 'return-voucher-after-cancel' });
  await t.run(ctx => ctx.db.insert('voucherEntries', {
    voucherId, kind: 'spend', sourceKey: 'paid-since-fully-restored', before: { paid: 50000, goodwill: 0 },
    after: { paid: 40000, goodwill: 0 }, guestFact: 'Spent before balance restoration', actor: 'owner', createdAt: now,
  }));
  await expect(owner.mutation(command.authorize, { ...args, expectedRevision: 5, clientKey: 'return-voucher-already-spent' }))
    .rejects.toThrow('RETURN_VOUCHER_NOT_REFUNDABLE');
});

it.each(['direct', 'approved'] as const)('voids a mistaken paid robe through the %s path and collects without moving stock again', async mode => {
  const { t, owner, cashier, manager } = await setup();
  const { orderId, stockId, lineId } = await t.run(ctx => soldProduct(ctx, 129000));
  const command = api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder;
  const args = { orderId, reason: 'Cash was never taken', expectedCorrectionRevision: 0, idempotencyKey: 'void-audit-w2b' };
  if (mode === 'direct') {
    const result = await owner.mutation(command, args);
    expect(result).toMatchObject({ replayed: false });
    expect(await owner.mutation(command, args)).toEqual({ ...result, replayed: true });
  } else {
    const request = await cashier.mutation(api.pos.staffApprovals.create, {
      orderId, reason: args.reason, payload: { kind: 'paymentFix', action: 'voidUnreceivedOrder' },
    });
    expect(await manager.mutation(api.pos.staffApprovals.approve, { requestId: request.requestId })).toMatchObject({ status: 'applied' });
  }
  const state = await t.run(async ctx => ({
    sale: await ctx.db.get(orderId), payments: await ctx.db.query('orderPayments').take(2),
    handover: await ctx.db.query('handovers').first(), correction: await ctx.db.query('orderCorrections').first(),
    payout: await ctx.db.query('returnPayouts').first(),
  }));
  expect(state.sale).toMatchObject({ status: 'void', voidUnreceived: true, receiptNumber: 100, total: 129000, commerceRevision: 1 });
  expect(state.payments).toMatchObject([{ orderId, amount: 129000 }]);
  expect(state.payout).toBeNull();
  const successor = state.correction!.recollectionOrderId!;
  expect(state.handover).toMatchObject({ kind: 'recollect', orderId, lineId, successorOrderId: successor, withGuest: 1, paid: 0, unpaid: 1 });
  const held = await owner.query(api.pos.orders.getOrder, { orderId: successor });
  expect(held).toMatchObject({ order: { parentOrderId: orderId, status: 'draft', total: 129000, due: 129000 } });
  await expect(owner.mutation(api.pos.commands.removeLine.removeLine, { lineId: state.handover!.successorLineId! })).rejects.toThrow('HANDOVER_IN_CUSTODY');
  await expect(owner.mutation(api.pos.commands.clearOrder.clearOrder, { orderId: successor })).rejects.toThrow('HANDOVER_IN_CUSTODY');
  await expect(owner.mutation(api.pos.commands.discardOrder.discardOrder, { orderId: successor, expectedRevision: 0, idempotencyKey: 'discard-recollection' }))
    .rejects.toThrow('HANDOVER_IN_CUSTODY');
  await t.run(ctx => ctx.db.insert('commerceSettings', { key: 'default', ...settings, paymentsMode: 'attempts' }));
  const deviceKey = 'test-recollection-device', tabKey = 'test-recollection-tab-aaaa';
  const { tillId } = await owner.mutation(api.commerce.paymentCutover.acknowledge, { deviceKey, loadedMode: 'attempts', loadedRevision: 0 });
  const started = await owner.mutation(api.pos.commands.startPaymentAttempt.startPaymentAttempt, {
    orderId: successor, tillId, tabKey, load: { tillId, deviceKey, loadedMode: 'attempts', loadedRevision: 0 }, clientKey: 'collect-recollection',
    expectedRevision: 0, expectedDue: 129000, businessDate: resortTodayIso(now), customers: [], vouchers: [],
    legs: [{ key: 'cash-1', method: 'cash', amount: 129000 }],
  });
  if (started.status !== 'ready') throw new Error(JSON.stringify(started));
  const attempt = { attemptId: started.attempt.attemptId, ownerRevision: started.attempt.ownerRevision, tillId, tabKey };
  expect(await owner.mutation(api.pos.commands.armPaymentLeg.armPaymentLeg, { ...attempt, load: { tillId, deviceKey, loadedMode: 'attempts', loadedRevision: 0 }, legKey: 'cash-1' })).toMatchObject({ status: 'instruct' });
  await owner.mutation(api.pos.commands.recordPaymentLeg.recordPaymentLeg, { ...attempt, legKey: 'cash-1', outcome: 'taken', received: 129000 });
  expect(await owner.mutation(api.pos.commands.settleOrder.settlePaymentAttempt, attempt)).toMatchObject({ status: 'settled' });
  await t.run(async ctx => {
    expect(await ctx.db.get(stockId)).toMatchObject({ onHand: 2 });
    expect(await ctx.db.query('stockMovements').take(2)).toHaveLength(1);
    expect(await ctx.db.get(orderId)).toMatchObject({ commerceRevision: 2 });
    expect(await ctx.db.get(successor)).toMatchObject({ commerceRevision: 2 });
    expect(await ctx.db.get(state.handover!._id)).toMatchObject({ withGuest: 1, unpaid: 0, paid: 1 });
    expect((await ctx.db.get(state.handover!.successorLineId!))?.saleSnapshot?.contents[0].stockMovementId)
      .toBe(state.handover?.originalMovementId);
  });
  const paid = (await owner.query(api.pos.orders.getOrder, { orderId: successor }))!;
  const returned = await owner.mutation(api.pos.commands.returnItems.authorize, {
    ...selection(successor, [{ kind: 'line', lineId: state.handover!.successorLineId!, units: 1, disposition: 'sellable' }]),
    expectedRevision: paid.order.revision,
  });
  expect(await t.run(ctx => ctx.db.get(orderId))).toMatchObject({ commerceRevision: 3 });
  await owner.mutation(api.pos.commands.returnItems.recordPayout, give(returned));
  await t.run(async ctx => {
    expect(await ctx.db.get(orderId)).toMatchObject({ commerceRevision: 4 });
    expect(await ctx.db.get(successor)).toMatchObject({ commerceRevision: 4 });
    expect(await ctx.db.get(state.handover!._id)).toMatchObject({ status: 'closed', withGuest: 0, backSellable: 1 });
    expect(await ctx.db.get(stockId)).toMatchObject({ onHand: 3 });
  });
});

it('requires reconciliation when an issued session was used, leaving the sale and its other benefits intact', async () => {
  const { t, owner } = await setup();
  const fixture = await t.run(async ctx => {
    const sale = await maximumPackages(ctx, false);
    await ctx.db.patch(sale.grants[0], { used: 1, paidUnits: 4 });
    return sale;
  });
  await expect(owner.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, {
    orderId: fixture.orderId, expectedCorrectionRevision: 0, reason: 'No external money received', idempotencyKey: 'used-session-void',
  })).rejects.toThrow('COMMERCE_VOID_RECONCILIATION_REQUIRED');
  await t.run(async ctx => {
    expect(await ctx.db.get(fixture.orderId)).toMatchObject({ status: 'paid' });
    expect(await ctx.db.get(fixture.grants[1])).toMatchObject({ paidUnits: 5 });
    expect(await ctx.db.get(fixture.issued[0])).toMatchObject({ paidBalance: 50, status: 'expired' });
    expect(await ctx.db.query('orderCorrections').first()).toBeNull();
  });
});

it('voids voucher tender and goodwill exactly once, replacing expired paid value and freezing the full amount owed for goods', async () => {
  const { t, owner } = await setup();
  const { orderId, stockId, active, expired, activeSourceOrder } = await t.run(async ctx => {
    const sale = await soldProduct(ctx, 50000);
    const branch = (await ctx.db.query('branches').first())!;
    const activeSourceOrder = await receipt(ctx, 20000);
    const sourceLine = await line(ctx, activeSourceOrder, 'voucher', 20000);
    const source = { kind: 'sale' as const, orderId: activeSourceOrder, lineId: sourceLine };
    const active = await voucher(ctx, source, branch._id, 0, { faceValue: 20000 });
    const expired = await voucher(ctx, source, branch._id, 0, { faceValue: 10000, status: 'expired', effectiveExpiresAt: now - 1 });
    await payment(ctx, sale.orderId, { method: 'voucher', voucherId: active, amount: 20000 });
    await payment(ctx, sale.orderId, { method: 'voucher', voucherId: expired, amount: 10000 });
    const first = (await ctx.db.query('orderPayments').withIndex('by_orderId', q => q.eq('orderId', sale.orderId)).first())!;
    await ctx.db.patch(first._id, { amount: 10000 });
    const row = (await ctx.db.get(sale.lineId))!;
    const snap = row.saleSnapshot!;
    await ctx.db.patch(sale.lineId, { saleSnapshot: {
      ...snap, paidShare: 40000, goodwillDiscounts: [{ voucherId: active, amount: 10000 }],
      contents: [{ ...snap.contents[0], paidShare: 40000, goodwillShare: 10000 }],
    } });
    return { ...sale, active, expired, activeSourceOrder };
  });
  const voidSale = api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder;
  const args = { orderId, expectedCorrectionRevision: 0, reason: 'No money received', idempotencyKey: 'restore-tender-void' };
  const first = await owner.mutation(voidSale, args);
  expect(await owner.mutation(voidSale, args)).toEqual({ ...first, replayed: true });
  await t.run(async ctx => {
    expect(await ctx.db.get(active)).toMatchObject({ paidBalance: 20000, goodwillBalance: 10000 });
    expect(await ctx.db.get(expired)).toMatchObject({ paidBalance: 0, goodwillBalance: 0 });
    expect(await ctx.db.get(activeSourceOrder)).toMatchObject({ commerceRevision: 1 });
    expect(await ctx.db.get(first.recollectionOrderId!)).toMatchObject({ due: 50000 });
    expect(await ctx.db.get(stockId)).toMatchObject({ onHand: 2 });
    const correction = (await ctx.db.query('orderCorrections').first())!;
    expect(correction.voucherRestorations).toMatchObject([
      { voucherId: active, creditedVoucherId: active, paid: 20000, goodwill: 10000 },
      { voucherId: expired, paid: 10000, goodwill: 0 },
    ]);
    const replacement = await ctx.db.get(correction.voucherRestorations![1].creditedVoucherId);
    expect(replacement).toMatchObject({ paidBalance: 10000, goodwillBalance: 0, terms: { voucherValidityDays: 90 } });
    expect(await ctx.db.query('returnPayouts').first()).toBeNull();
  });
});

it('reserves and credits a funding voucher across receipts and invalidates its issuing receipt approval', async () => {
  const { t, owner, cashier, manager } = await setup();
  const { purchase, returned, voucherId } = await t.run(async ctx => {
    const retail = await catalog(ctx);
    const issueOrder = await receipt(ctx, 50000);
    const packageId = await ctx.db.insert('packages', { name: 'Wellness', status: 'active', sort: 0, revision: 0 });
    const packageVersionId = await ctx.db.insert('packageVersions', {
      packageId, version: 1, name: 'Wellness', price: 50000, validityDays: 180, allowTransfer: false, contents: [], estimatedSplit: [],
    });
    const issueLine = await line(ctx, issueOrder, 'package', 50000, { packageVersionId });
    const voucherId = await voucher(ctx, {
      kind: 'package', orderId: issueOrder, lineId: issueLine, contentKey: 'voucher', packageVersionId,
    }, retail.branchId, 49975, { faceValue: 50000, packageUnusedPaid: 49975, revision: 1 });
    await ctx.db.patch(issueLine, { saleSnapshot: snapshot('Gift', 50000, [{
      ...allocation(50000), contentKey: 'voucher', label: 'Gift', units: 1, vatProfile: 'exempt', voucherId,
    }]) });
    await payment(ctx, issueOrder, { method: 'cash', amount: 50000 });
    const spendingOrder = await receipt(ctx, 100);
    const goods = await product(ctx, retail, spendingOrder, 100);
    const snap = (await ctx.db.get(goods.lineId))!.saleSnapshot!;
    const tenderCells = [{ kind: 'voucher' as const, voucherId, amount: 25 }, { kind: 'external' as const, amount: 75 }];
    await ctx.db.patch(goods.lineId, { saleSnapshot: { ...snap, tenderCells, contents: [{ ...snap.contents[0], tenderCells }] } });
    await payment(ctx, spendingOrder, { method: 'voucher', voucherId, amount: 25 });
    await payment(ctx, spendingOrder, { method: 'cash', amount: 75 });
    return {
      voucherId, purchase: selection(issueOrder, [{ kind: 'cancelPackage', lineId: issueLine }]),
      returned: selection(spendingOrder, [{ kind: 'line', lineId: goods.lineId, units: 1, disposition: 'sellable' }]),
    };
  });
  const request = await cashier.mutation(command.askManager, purchase);
  expect(await manager.query(api.pos.staffApprovals.detail, { requestId: request.requestId })).toMatchObject({ status: 'pending' });
  const held = await owner.mutation(command.authorize, returned);
  expect(await t.run(ctx => ctx.db.get(purchase.orderId))).toMatchObject({ commerceRevision: 1 });
  expect(await t.run(ctx => ctx.db.get(voucherId))).toMatchObject({ pendingReturnId: held.returnId });
  expect(await manager.query(api.pos.staffApprovals.detail, { requestId: request.requestId })).toMatchObject({ status: 'stale' });
  await owner.mutation(command.recordPayout, give(held));
  expect(await t.run(ctx => ctx.db.get(purchase.orderId))).toMatchObject({ commerceRevision: 2 });
  expect(await t.run(ctx => ctx.db.get(voucherId))).toMatchObject({ paidBalance: 50000, revision: 3 });
});

it('takes a sellable recollection unit back exactly once and bumps both orders', async () => {
  const { t, owner } = await setup();
  const { orderId, stockId } = await t.run(ctx => soldProduct(ctx, 129000, true));
  const { recollectionOrderId } = await owner.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, {
    orderId, reason: 'Cash was never taken', expectedCorrectionRevision: 0, idempotencyKey: 'void-room-takeback',
  });
  const handover = (await t.run(ctx => ctx.db.query('handovers').first()))!;
  const args = {
    target: { targetType: 'handover' as const, targetId: handover._id }, kind: 'takeBack' as const,
    input: { contentKey: 'product', quantity: 1, disposition: 'sellable' as const },
    expectedRevision: handover.revision, clientKey: 'takeback-room-recollection', reasonCode: 'staffMistake',
  };
  const result = await owner.mutation(api.pos.commands.adjust.adjust, args);
  expect(result).toMatchObject({ status: 'applied', effects: [{ kind: 'stockMovement' }] });
  expect(await owner.mutation(api.pos.commands.adjust.adjust, args)).toEqual(result);
  await t.run(async ctx => {
    expect(await ctx.db.get(handover._id)).toMatchObject({ status: 'closed', withGuest: 0, backSellable: 1, unpaid: 0 });
    expect(await ctx.db.get(recollectionOrderId!)).toMatchObject({ due: 0, itemCount: 0, commerceRevision: 2 });
    expect(await ctx.db.get(orderId)).toMatchObject({ commerceRevision: 2 });
    expect(await ctx.db.get(stockId)).toMatchObject({ onHand: 3 });
    expect(await ctx.db.query('stockMovements').take(3)).toHaveLength(2);
  });
});
