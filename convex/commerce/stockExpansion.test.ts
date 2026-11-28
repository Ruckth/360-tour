// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import { asTestOwner, seedTestBranch } from '../testing/staff.test-support';
import { readStockAvailability } from './private/stockAvailability';
import { readStockReturnLots } from './private/stockExpansionLedger';
import { readStockLevel, writeStockMovement } from './private/stockLedger';
import { consumeStock, releaseStock, reserveStock } from './private/stockReservations';

const modules = import.meta.glob('/convex/**/*.ts');
const endpoints = api.commerce.stockExpansion;
const minute = 60_000;

afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const identity = { email: 'stockowner@example.com', emailVerified: true, tokenIdentifier: 'issuer|stock-owner' };
  const owner = await asTestOwner(t, identity);
  const receiverIdentity = { email: 'receiver@example.com', emailVerified: true, tokenIdentifier: 'issuer|receiver' };
  const receiver = t.withIdentity(receiverIdentity);
  const senderIdentity = { email: 'sender@example.com', emailVerified: true, tokenIdentifier: 'issuer|sender' };
  const sender = t.withIdentity(senderIdentity);
  const fixture = await t.run(async ctx => {
    const originId = await seedTestBranch(ctx);
    const destinationId = await seedTestBranch(ctx, 'phuket');
    const ownerGrant = (await ctx.db.query('staffGrants').withIndex('by_email', q => q.eq('email', identity.email)).unique())!;
    const now = Date.now();
    const receiverGrant = await ctx.db.insert('staffGrants', {
      email: receiverIdentity.email, role: 'cashier', tokenIdentifier: receiverIdentity.tokenIdentifier,
      branchIds: [destinationId], createdAt: now, updatedAt: now, updatedByEmail: identity.email,
    });
    const senderGrant = await ctx.db.insert('staffGrants', {
      email: senderIdentity.email, role: 'cashier', tokenIdentifier: senderIdentity.tokenIdentifier,
      branchIds: [originId], createdAt: now, updatedAt: now, updatedByEmail: identity.email,
    });
    const all = { requester: true, buyer: true, receiver: true, lead: true, approver: true };
    for (const [staffGrantId, branchId, roles] of [
      [ownerGrant._id, originId, all],
      [ownerGrant._id, destinationId, all],
      [senderGrant, originId, { requester: true, buyer: true, receiver: false, lead: false, approver: false }],
      [receiverGrant, destinationId, { requester: false, buyer: false, receiver: true, lead: false, approver: false }],
    ] as const) {
      await ctx.db.insert('stockGrants', { staffGrantId, branchId, roles, revision: 1, changedBy: identity.email, changedAt: now });
    }
    const categoryId = await ctx.db.insert('productCategories', { name: 'Clinic shop', sort: 1 });
    const productId = await ctx.db.insert('products', {
      categoryId, name: 'Stock item', status: 'active', vatProfile: 'standard',
      options: [], minPrice: 1000, maxPrice: 1000, variantCount: 1, sort: 1, revision: 0,
    });
    const variantId = await ctx.db.insert('productVariants', {
      productId, optionValueIds: [], label: 'Stock item', price: 1000, status: 'active', revision: 0,
    });
    return { branchId: originId, originId, destinationId, variantId };
  });
  return { t, owner, receiver, sender, ...fixture };
}

it('dispatches once, requires destination authority, and closes a partial transfer with shortage evidence', async () => {
  const { t, owner, receiver, originId, destinationId, variantId } = await setup();
  await t.run(ctx => writeStockMovement(ctx, {
    branchId: originId, variantId, delta: 8, kind: 'opening', sourceKey: 'opening', actor: 'seed',
  }));
  const draft = { originId, destinationId, lines: [{ variantId, quantity: 3 }], requestId: 'draft' };
  const transferId = await owner.mutation(endpoints.createTransfer, draft);
  expect(await owner.mutation(endpoints.createTransfer, draft)).toBe(transferId);
  await expect(receiver.mutation(endpoints.sendTransfer, { transferId, revision: 0 })).rejects.toThrow('access to this branch');
  await owner.mutation(endpoints.sendTransfer, { transferId, revision: 0 });
  await owner.mutation(endpoints.sendTransfer, { transferId, revision: 0 });
  const afterDispatch = await receiver.query(endpoints.transferDetail, { transferId, branchId: destinationId });
  expect(afterDispatch!.transfer.state).toBe('inTransit');
  const lineId = afterDispatch!.lines[0]!._id;
  const receipt = { transferId, requestId: 'received-1', lines: [{ lineId, quantity: 2 }] };
  const eventId = await receiver.mutation(endpoints.receiveTransfer, receipt);
  expect(await receiver.mutation(endpoints.receiveTransfer, receipt)).toBe(eventId);
  await expect(receiver.mutation(endpoints.receiveTransfer, {
    ...receipt, requestId: 'excess',
  })).rejects.toThrow('exceeds the quantity still in transit');
  await expect(receiver.mutation(endpoints.closeTransferShort, { transferId, requestId: 'short', reason: 'One missing', reviewed: [{ lineId, quantity: 1 }] }))
    .rejects.toThrow('required stock permission');
  await owner.mutation(endpoints.closeTransferShort, { transferId, requestId: 'short', reason: 'One missing', reviewed: [{ lineId, quantity: 1 }] });
  const final = await owner.query(endpoints.transferDetail, { transferId, branchId: originId });
  expect(final!.transfer).toMatchObject({ state: 'short', shortageReason: 'One missing' });
  expect(final!.lines).toMatchObject([{ quantity: 3, received: 2 }]);
  expect(await t.run(async ctx => [
    (await readStockLevel(ctx, originId, variantId))?.onHand,
    (await readStockLevel(ctx, destinationId, variantId))?.onHand,
  ])).toEqual([5, 2]);
});

it('allocates earliest eligible lots and traces their custody and original expiry across transfer and sale return', async () => {
  const { t, owner, receiver, sender, originId, destinationId, variantId } = await setup();
  const now = Date.now();
  const scope = { branchId: originId, variantId };
  await owner.mutation(endpoints.enableLotTracking, scope);
  await expect(owner.query(endpoints.trackedItems, { branchId: originId, variantIds: [variantId] })).resolves.toEqual([variantId]);
  await expect(owner.query(api.commerce.stock.selectedBalances, { branchId: originId, variantIds: [variantId] }))
    .resolves.toMatchObject([{ variantId, lotTracked: true, onHand: 0 }]);
  for (const [code, expiresAt, quantity] of [
    ['expired', now - minute, 2], ['early', now + 100 * minute, 2], ['late', now + 200 * minute, 5],
  ] as const) {
    await owner.mutation(endpoints.adjustLot, {
      ...scope, requestId: code, change: { kind: 'add', lot: { code, expiresAt } }, reason: 'Verified receipt', quantity,
    });
  }
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ onHand: 9, sellable: 7 });
  const transferId = await owner.mutation(endpoints.createTransfer, {
    originId, destinationId, requestId: 'tracked-draft', lines: [{ variantId, quantity: 3 }],
  });
  await owner.mutation(endpoints.sendTransfer, { transferId, revision: 0 });
  const line = (await receiver.query(endpoints.transferDetail, { transferId, branchId: destinationId }))!.lines[0]!;
  expect(line.lots).toMatchObject([{ code: 'early', quantity: 2 }, { code: 'late', quantity: 1 }]);
  await expect(receiver.mutation(endpoints.receiveTransfer, {
    transferId, requestId: 'missing-lot', lines: [{ lineId: line._id, quantity: 1 }],
  })).rejects.toThrow('Confirm the shipped lot');
  const [early, late] = line.lots;
  const expired = (await owner.query(endpoints.lotBalances, scope)).lots.find(lot => lot.code === 'expired')!;
  await expect(receiver.mutation(endpoints.receiveTransfer, {
    transferId, requestId: 'unshipped', lines: [{ lineId: line._id, quantity: 1, allocations: [{ lotId: expired.lotId, quantity: 1 }] }],
  })).rejects.toThrow('exceeds the dispatch');
  const partial = { transferId, requestId: 'partial', lines: [{ lineId: line._id, quantity: 1, allocations: [{ lotId: early!.lotId, quantity: 1 }] }] };
  await expect(sender.mutation(endpoints.receiveTransfer, partial)).rejects.toThrow('access to this branch');
  expect(await t.run(ctx => readStockLevel(ctx, destinationId, variantId))).toBeNull();
  const first = await receiver.mutation(endpoints.receiveTransfer, partial);
  expect(await receiver.mutation(endpoints.receiveTransfer, partial)).toBe(first);
  await expect(receiver.mutation(endpoints.receiveTransfer, { ...partial, lines: [{
    lineId: line._id, quantity: 1, allocations: [{ lotId: late!.lotId, quantity: 1 }],
  }] })).rejects.toThrow('used for a different action');
  const second = await owner.mutation(endpoints.receiveTransfer, {
    transferId, requestId: 'received', lines: [{ lineId: line._id, quantity: 2,
      allocations: [{ lotId: early!.lotId, quantity: 1 }, { lotId: late!.lotId, quantity: 1 }],
    }],
  });
  expect(second).not.toBe(first);
  const { page } = await receiver.query(endpoints.transferEvents, {
    branchId: destinationId, transferId, paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(page).toMatchObject([
    { actor: 'stockowner@example.com', receipts: [{ quantity: 2 }] },
    { actor: 'receiver@example.com', receipts: [{ quantity: 1 }] },
  ]);
  const dest = { ...scope, branchId: destinationId };
  const sale = await t.run(ctx => writeStockMovement(ctx, {
    ...dest, delta: -2, kind: 'sale', actor: 'cashier', sourceKey: 'tracked-sale',
  }));
  expect(await receiver.query(endpoints.movementLots, { branchId: destinationId, movementId: sale.movementId }))
    .toMatchObject({ allocations: [{ code: 'early', quantity: 2 }] });
  const returned = await t.run(ctx => writeStockMovement(ctx, {
    ...dest, delta: 1, kind: 'return', actor: 'cashier', sourceKey: 'tracked-return', originalMovementId: sale.movementId,
  }));
  expect(await receiver.query(endpoints.movementLots, { branchId: destinationId, movementId: returned.movementId }))
    .toMatchObject({ allocations: [{ code: 'early', expiresAt: now + 100 * minute, quantity: 1 }] });
  expect(await owner.query(endpoints.lotBalances, dest)).toMatchObject({ onHand: 2, sellable: 2 });
});

it('reserves without changing physical stock, excludes holds from sales, and releases on expiry', async () => {
  vi.useFakeTimers();
  const { t, originId: branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  await t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: 5, kind: 'opening', sourceKey: 'opening', actor: 'seed',
  }));
  const now = Date.now();
  const request = { ...scope, quantity: 3, sourceKey: 'hold-1', expiresAt: now + minute, actor: 'portal' };
  const reservationId = await t.run(ctx => reserveStock(ctx, request));
  const another = await t.run(ctx => reserveStock(ctx, { ...request, sourceKey: 'hold-2', quantity: 1 }));
  expect(await t.run(ctx => reserveStock(ctx, request))).toBe(reservationId);
  await expect(t.run(ctx => reserveStock(ctx, { ...request, sourceKey: 'excess-hold' }))).rejects.toThrow('insufficient sellable stock');
  await expect(t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: -2, kind: 'sale', sourceKey: 'walk-in', actor: 'cashier',
  }))).rejects.toThrow('held for another order');
  await t.run(ctx => releaseStock(ctx, another, 'portal'));
  const consume = { reservationId, sourceKey: 'paid-1', actor: 'portal' };
  expect(await t.run(ctx => consumeStock(ctx, consume.reservationId, consume.sourceKey, consume.actor))).toMatchObject({ before: 5, after: 2 });
  expect(await t.run(ctx => consumeStock(ctx, consume.reservationId, consume.sourceKey, consume.actor))).toMatchObject({ before: 5, after: 2 });
  const expires = await t.run(ctx => reserveStock(ctx, { ...request, sourceKey: 'hold-3', quantity: 2 }));
  expect(await t.run(ctx => readStockAvailability(ctx, { ...scope, onHand: 2 }))).toMatchObject({ held: 2, sellable: 0 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run(ctx => readStockAvailability(ctx, { ...scope, onHand: 2 }))).toMatchObject({ held: 0, sellable: 2 });
  expect(await t.run(ctx => ctx.db.get(expires))).toMatchObject({ state: 'expired' });
});

it('keeps a held lot eligible through hold expiry and excludes it from walk-in FEFO allocation', async () => {
  vi.useFakeTimers();
  const { t, owner, branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  const now = Date.now();
  await owner.mutation(endpoints.enableLotTracking, scope);
  for (const [code, expiresAt, quantity] of [
    ['today', now + minute, 2], ['tomorrow', now + 10 * minute, 3],
  ] as const) {
    await owner.mutation(endpoints.adjustLot, {
      ...scope, requestId: code, reason: 'Verified receipt', quantity, change: { kind: 'add', lot: { code, expiresAt } },
    });
  }
  const reservationId = await t.run(ctx => reserveStock(ctx, {
    ...scope, sourceKey: 'portal-checkout', actor: 'portal', quantity: 3, expiresAt: now + 2 * minute,
  }));
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({
    onHand: 5, sellable: 2, held: 3, lots: [{ code: 'today', available: 2 }, { code: 'tomorrow', available: 0 }],
  });
  await vi.advanceTimersByTimeAsync(minute);
  await t.finishInProgressScheduledFunctions();
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ onHand: 5, sellable: 0, held: 3 });
  await expect(t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: -1, kind: 'sale', actor: 'cashier', sourceKey: 'walk-in', allowNegative: true,
  }))).rejects.toThrow('insufficient sellable stock');
  const consumed = await t.run(ctx => consumeStock(ctx, reservationId, 'online-sale', 'portal'));
  expect(await owner.query(endpoints.movementLots, { branchId, movementId: consumed.movementId }))
    .toMatchObject({ allocations: [{ code: 'tomorrow', quantity: 3 }] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('requires exact lot confirmation for partial multi-lot returns and reuses the same movement on retry', async () => {
  const { t, owner, branchId, destinationId, variantId } = await setup();
  const scope = { branchId, variantId };
  const now = Date.now();
  await owner.mutation(endpoints.enableLotTracking, scope);
  for (const [code, expiresAt] of [['early', now + minute], ['late', now + 10 * minute]] as const) {
    await owner.mutation(endpoints.adjustLot, {
      ...scope, requestId: code, reason: 'Verified receipt', quantity: 2, change: { kind: 'add', lot: { code, expiresAt } },
    });
  }
  const sale = await t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: -4, kind: 'sale', sourceKey: 'counter-sale', actor: 'cashier',
  }));
  const original = { ...scope, originalMovementId: sale.movementId };
  const { lots: options, tracked } = await t.run(ctx => readStockReturnLots(ctx, original));
  expect(tracked).toBe(true);
  expect(options).toMatchObject([{ code: 'early', quantity: 2 }, { code: 'late', quantity: 2 }]);
  expect(await t.run(ctx => readStockReturnLots(ctx, { ...original, branchId: destinationId }))).toEqual({ tracked: false, lots: [] });
  const physicalReturn = { ...original, delta: 1, kind: 'return' as const, sourceKey: 'confirmed-return', actor: 'cashier' };
  await expect(t.run(ctx => writeStockMovement(ctx, physicalReturn))).rejects.toThrow('Confirm the lot code');
  const exact = { ...physicalReturn, lotAllocations: [{ lotId: options[1]!.lotId, quantity: 1 }] };
  const applied = await t.run(ctx => writeStockMovement(ctx, exact));
  expect(await t.run(ctx => writeStockMovement(ctx, exact))).toEqual(applied);
  await expect(t.run(ctx => writeStockMovement(ctx, {
    ...exact, lotAllocations: [{ lotId: options[0]!.lotId, quantity: 1 }],
  }))).rejects.toThrow('already used for a different action');
  expect(await t.run(ctx => readStockReturnLots(ctx, original))).toMatchObject({ tracked: true, lots: [
    { code: 'early', quantity: 2 }, { code: 'late', quantity: 1 },
  ] });
});

it('keeps legacy sale and return balances valid without lot evidence', async () => {
  const { t, branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  await t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: 2, kind: 'opening', sourceKey: 'initial-stock', actor: 'stock-lead',
  }));
  const sale = await t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: -2, kind: 'sale', sourceKey: 'legacy-sale', actor: 'cashier',
  }));
  expect(await t.run(ctx => readStockReturnLots(ctx, { ...scope, originalMovementId: sale.movementId }))).toEqual({ tracked: false, lots: [] });
  expect(await t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: 1, kind: 'return', sourceKey: 'legacy-return', actor: 'cashier',
  }))).toMatchObject({ before: 0, after: 1 });
});

it('makes an attached hold available only to its order and consumes it with the sale movement', async () => {
  vi.useFakeTimers();
  const { t, branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  const now = Date.now();
  const orderId = await t.run(async ctx => {
    await writeStockMovement(ctx, { ...scope, delta: 3, kind: 'opening', sourceKey: 'opening', actor: 'seed' });
    return ctx.db.insert('orders', {
      status: 'draft', stockBranchId: branchId, orderNumber: 1, currency: 'THB', itemCount: 1, hasItems: true,
      total: 1000, due: 1000, revision: 1, createdBy: 'cashier', createdAt: now, updatedAt: now,
    });
  });
  const reservationId = await t.run(ctx => reserveStock(ctx, {
    ...scope, orderId, quantity: 2, sourceKey: 'shop-cart', actor: 'shop', expiresAt: now + minute,
  }));
  expect(await t.run(ctx => readStockAvailability(ctx, { ...scope, onHand: 3 }))).toMatchObject({ sellable: 1, held: 2 });
  expect(await t.run(ctx => readStockAvailability(ctx, { ...scope, onHand: 3, orderId }))).toMatchObject({
    sellable: 3, held: 0, reservationId, reservationQuantity: 2,
  });
  const sale = { ...scope, reservationId, delta: -2, kind: 'sale' as const, actor: 'cashier', sourceKey: 'sale' };
  await expect(t.run(ctx => writeStockMovement(ctx, { ...sale, sourceId: 'another-order' }))).rejects.toThrow('does not match the sale');
  const result = await t.run(ctx => writeStockMovement(ctx, { ...sale, sourceId: orderId }));
  expect(result).toMatchObject({ before: 3, after: 1 });
  expect(await t.run(ctx => ctx.db.get(reservationId))).toMatchObject({ state: 'consumed', movementId: result.movementId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('prevents inactive destination receiving and lets its origin lead close with a zero-delta shortage trace', async () => {
  const { t, owner, receiver, originId, destinationId, variantId } = await setup();
  await t.run(ctx => writeStockMovement(ctx, {
    branchId: originId, variantId, delta: 4, kind: 'opening', sourceKey: 'origin-opening', actor: 'stock-lead',
  }));
  const transferId = await owner.mutation(endpoints.createTransfer, {
    originId, destinationId, requestId: 'dest-closing', lines: [{ variantId, quantity: 3 }],
  });
  await owner.mutation(endpoints.sendTransfer, { transferId, revision: 0 });
  const initial = await owner.query(endpoints.transferDetail, { transferId, branchId: originId });
  const line = initial!.lines[0]!;
  await t.run(ctx => ctx.db.patch(destinationId, { state: 'suspended' }));
  await expect(receiver.mutation(endpoints.receiveTransfer, {
    transferId, requestId: 'suspended-receipt', lines: [{ lineId: line._id, quantity: 1 }],
  })).rejects.toThrow('destination must be active');
  await expect(owner.mutation(endpoints.closeTransferShort, {
    transferId, branchId: destinationId, requestId: 'wrong-branch', reason: 'Destination closed', reviewed: [{ lineId: line._id, quantity: 3 }],
  })).rejects.toThrow('branch responsible');
  const request = { transferId, branchId: originId, requestId: 'short-at-origin', reason: 'Destination closed', reviewed: [{ lineId: line._id, quantity: 3 }] };
  const eventId = await owner.mutation(endpoints.closeTransferShort, request);
  expect(await owner.mutation(endpoints.closeTransferShort, request)).toBe(eventId);
  const detail = await owner.query(endpoints.transferDetail, { transferId, branchId: originId });
  expect(detail!.transfer).toMatchObject({ state: 'short', shortageReason: request.reason });
  expect(Object.keys(detail!.transfer)).not.toContain('createdBy');
  const events = (await owner.query(endpoints.transferEvents, { transferId, branchId: originId, paginationOpts: { cursor: null, numItems: 10 } })).page;
  expect(events[0]).toMatchObject({ actingBranchId: originId, actor: 'stockowner@example.com', shortages: [{ quantity: 3 }] });
  expect(Object.keys(events[0]!)).not.toContain('operationKey');
  const trace = await t.run(ctx => ctx.db.get(events[0]!.shortages![0]!.movementId));
  expect(trace).toMatchObject({
    kind: 'transfer_short', delta: 0, before: 1, after: 1, branchId: originId, originalMovementId: line.dispatchMovementId,
  });
  expect(await t.run(ctx => readStockLevel(ctx, destinationId, variantId))).toBeNull();
});

it('posts a verified lot count below held stock and audits only the holds backed by the missing units', async () => {
  vi.useFakeTimers();
  const { t, owner, branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  const now = Date.now();
  await owner.mutation(endpoints.enableLotTracking, scope);
  for (const [code, expiresAt] of [['court', now + 10 * minute], ['beach', now + 20 * minute]] as const) {
    await owner.mutation(endpoints.adjustLot, {
      ...scope, requestId: code, reason: 'Initial stock', quantity: 3, change: { kind: 'add', lot: { code, expiresAt } },
    });
  }
  const first = await t.run(ctx => reserveStock(ctx, {
    ...scope, sourceKey: 'first-lot', actor: 'portal', quantity: 3, expiresAt: now + minute,
  }));
  const second = await t.run(ctx => reserveStock(ctx, {
    ...scope, sourceKey: 'second-lot', actor: 'portal', quantity: 2, expiresAt: now + minute,
  }));
  const { lots } = await owner.query(endpoints.lotBalances, scope);
  const request = {
    ...scope, lotId: lots[0]!.lotId, expectedOnHand: 3, expectedRevision: lots[0]!.revision, quantity: 1, requestId: 'verified-count', reason: 'Two missing from shelf',
  };
  const movement = await owner.mutation(endpoints.countLot, request);
  expect(await owner.mutation(endpoints.countLot, request)).toEqual(movement);
  expect(await t.run(ctx => ctx.db.get(first))).toMatchObject({
    state: 'released', closedReason: 'verified_count', movementId: movement.movementId,
  });
  expect(await t.run(ctx => ctx.db.get(second))).toMatchObject({ state: 'active' });
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ onHand: 4, sellable: 2, held: 2 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('records an untracked verified count below held stock and links the release to its movement', async () => {
  vi.useFakeTimers();
  const { t, originId: branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  await t.run(ctx => writeStockMovement(ctx, { ...scope, delta: 5, kind: 'opening', sourceKey: 'initial', actor: 'stock' }));
  const reservationId = await t.run(ctx => reserveStock(ctx, {
    ...scope, sourceKey: 'hold', actor: 'portal', quantity: 4, expiresAt: Date.now() + minute,
  }));
  const movement = await t.run(ctx => writeStockMovement(ctx, {
    ...scope, delta: -3, kind: 'count', sourceKey: 'verified-count', actor: 'stock', clearRecount: true, reason: 'Shelf shortfall confirmed',
  }));
  expect(movement).toMatchObject({ before: 5, after: 2 });
  expect(await t.run(ctx => ctx.db.get(reservationId))).toMatchObject({
    state: 'released', closedReason: 'verified_count', movementId: movement.movementId,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('preserves creation identity after a draft edit, rejects stale dispatch and shortage review, and finds older receipts by state', async () => {
  const { t, owner, receiver, originId, destinationId, variantId } = await setup();
  const opening = { branchId: originId, variantId, delta: 6, kind: 'opening' as const, sourceKey: 'opening', actor: 'stock' };
  await t.run(ctx => writeStockMovement(ctx, opening));
  const third = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx, 'third');
    const stockGrant = (await ctx.db.query('stockGrants').first())!;
    await ctx.db.insert('stockGrants', {
      staffGrantId: stockGrant.staffGrantId, branchId, roles: stockGrant.roles, revision: 1, changedBy: 'owner', changedAt: Date.now(),
    });
    return branchId;
  });
  const draft = { originId, destinationId: third, requestId: 'original', note: 'Run 1', lines: [{ variantId, quantity: 4 }] };
  const transferId = await owner.mutation(endpoints.createTransfer, draft);
  const edit = { transferId, revision: 0, destinationId, note: 'Driver 42', lines: [{ variantId, quantity: 5 }] };
  await owner.mutation(endpoints.editTransfer, edit);
  await expect(owner.mutation(endpoints.editTransfer, edit)).rejects.toThrow('draft has changed');
  expect(await owner.mutation(endpoints.createTransfer, draft)).toBe(transferId);
  expect(await t.run(ctx => readStockLevel(ctx, originId, variantId))).toMatchObject({ onHand: 6 });
  await expect(owner.mutation(endpoints.sendTransfer, { transferId, revision: 0 })).rejects.toThrow('draft changed');
  await owner.mutation(endpoints.sendTransfer, { transferId, revision: 1 });
  const origin = await owner.query(endpoints.transferDetail, { branchId: originId, transferId });
  const dest = await receiver.query(endpoints.transferDetail, { branchId: destinationId, transferId });
  expect(origin?.transfer.reference).toEqual(dest?.transfer.reference);
  expect(dest?.transfer.note).toBe('Driver 42');
  expect(dest).not.toHaveProperty('events');
  expect(await receiver.query(endpoints.transferDetail, { branchId: destinationId, transferId: 'invalid' })).toBeNull();
  await t.run(async ctx => {
    for (let i = 0; i < 5; i++) {
      await ctx.db.insert('stockTransfers', { originId, destinationId, sourceKey: 'closed' + i, state: 'received', createdAt: Date.now(), createdBy: 'stock' });
    }
  });
  expect(await owner.query(endpoints.transferDetail, { branchId: third, transferId })).toBeNull();
  const queue = await receiver.query(endpoints.listTransfers, {
    branchId: destinationId, direction: 'destination', state: 'inTransit', paginationOpts: { cursor: null, numItems: 2 },
  });
  expect(queue.page.map(row => row._id)).toEqual([transferId]);
  const lineId = dest!.lines[0]!._id;
  const short = { branchId: destinationId, transferId, requestId: 'short', reason: 'Stock missing', reviewed: [{ lineId, quantity: 5 }] };
  await receiver.mutation(endpoints.receiveTransfer, { transferId, requestId: 'receive', lines: [{ lineId, quantity: 2 }] });
  await expect(owner.mutation(endpoints.closeTransferShort, short)).rejects.toThrow('Outstanding quantities changed');
  await owner.mutation(endpoints.closeTransferShort, { ...short, reviewed: [{ lineId, quantity: 3 }] });
  const { page } = await owner.query(endpoints.transferEvents, {
    branchId: destinationId, transferId, paginationOpts: { cursor: null, numItems: 10 },
  });
  expect(page[0]!.shortages).toMatchObject([{ lineId, quantity: 3 }]);
});

it('reconciles stock and active holds in two branches before converting and retains historical return policy', async () => {
  vi.useFakeTimers();
  const { t, owner, originId, destinationId, variantId } = await setup();
  const now = Date.now();
  const scope = { branchId: originId, variantId };
  const dest = { ...scope, branchId: destinationId };
  await t.run(async ctx => {
    await writeStockMovement(ctx, { ...scope, delta: 6, kind: 'opening', sourceKey: 'open-1', actor: 'stock' });
    await writeStockMovement(ctx, { ...dest, delta: 3, kind: 'opening', sourceKey: 'open-2', actor: 'stock' });
  });
  const sale = await t.run(ctx => writeStockMovement(ctx, { ...scope, delta: -1, kind: 'sale', sourceKey: 'old-sale', actor: 'staff' }));
  const hold = await t.run(ctx => reserveStock(ctx, { ...scope, sourceKey: 'hold', expiresAt: now + minute, quantity: 2, actor: 'checkout' }));
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ tracking: false, canEnable: false, canConvert: true });
  const originLots = [{ code: 'north', expiresAt: now + 2 * minute, quantity: 5 }];
  const destinationLots = [{ code: 'south', expiresAt: now + 3 * minute, quantity: 3 }];
  const buildConversion = async () => ({
    ...scope, requestId: 'conversion',
    branches: (await owner.query(endpoints.lotConversionBalances, scope)).branches.map(row => ({
      branchId: row.branchId, expectedRevision: row.revision, lots: row.branchId === originId ? originLots : destinationLots,
    })),
  });
  const reviewed = await buildConversion();
  await expect(owner.mutation(endpoints.convertLotTracking, { ...reviewed, branches: reviewed.branches.map(row => row.branchId === destinationId
    ? { ...row, lots: [{ ...destinationLots[0]!, quantity: 1 }] } : row) })).rejects.toThrow('must equal on-hand');
  await t.run(async ctx => {
    await writeStockMovement(ctx, { ...dest, delta: -1, kind: 'sale', sourceKey: 'after-review-sale', actor: 'staff' });
    await writeStockMovement(ctx, { ...dest, delta: 1, kind: 'opening', sourceKey: 'after-review-receipt', actor: 'staff' });
  });
  await expect(owner.mutation(endpoints.convertLotTracking, reviewed)).rejects.toThrow('Stock activity changed');
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ tracking: false, lots: [] });
  const rechecked = await buildConversion();
  const id = await owner.mutation(endpoints.convertLotTracking, rechecked);
  expect(await owner.mutation(endpoints.convertLotTracking, { ...rechecked, branches: [...rechecked.branches].reverse() })).toBe(id);
  await expect(owner.mutation(endpoints.convertLotTracking, { ...rechecked, branches: reviewed.branches })).rejects.toThrow('already used for different stock');
  const audit = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt',
    q => q.eq('entityType', 'stockTracking').eq('entityId', id)).unique());
  expect(audit).toMatchObject({ kind: 'converted', after: { branches: expect.arrayContaining(rechecked.branches) } });
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ tracking: true, onHand: 5, held: 2, sellable: 3, lots: [{ code: 'north', onHand: 5 }] });
  expect(await owner.query(endpoints.lotBalances, dest)).toMatchObject({ tracking: true, onHand: 3, lots: [{ code: 'south', onHand: 3 }] });
  expect(await t.run(ctx => ctx.db.get(hold))).toMatchObject({ allocations: [{ quantity: 2 }] });
  expect(await t.run(ctx => readStockReturnLots(ctx, { ...scope, originalMovementId: sale.movementId }))).toEqual({ tracked: false, lots: [] });
  await t.run(ctx => writeStockMovement(ctx, { ...scope, delta: 1, kind: 'return', sourceKey: 'old-return', actor: 'staff', originalMovementId: sale.movementId }));
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ tracking: true, onHand: 6, expired: 1, held: 2, sellable: 3 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('handles lot count ABA, depleted lookup and per-session completion', async () => {
  vi.useFakeTimers();
  const { t, owner, originId: branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  const expiresAt = Date.now() + minute;
  await owner.mutation(endpoints.enableLotTracking, scope);
  const put = (code: string, quantity: number, requestId: string) =>
    owner.mutation(endpoints.adjustLot, { ...scope, requestId, reason: 'Recount', quantity, change: { kind: 'add', lot: { code, expiresAt } } });
  await put('first', 5, 'stock-1');
  await put('second', 2, 'stock-2');
  const { lots } = await owner.query(endpoints.lotBalances, scope);
  const first = lots.find(lot => lot.code === 'first')!;
  const second = lots.find(lot => lot.code === 'second')!;
  const sessionId = await owner.mutation(endpoints.startLotCountSession, scope);
  const count = (lot: { lotId: typeof first.lotId; onHand: number; revision: number }, quantity: number, requestId: string) =>
    owner.mutation(endpoints.countLot, { ...scope, sessionId, lotId: lot.lotId, expectedOnHand: lot.onHand,
      expectedRevision: lot.revision, quantity, reason: 'Verified', requestId });
  await owner.mutation(endpoints.adjustLot, { ...scope, requestId: 'take-one', reason: 'Recount', quantity: 1, change: { kind: 'remove', lotId: first.lotId } });
  await put('first', 1, 'add-one');
  await expect(count(first, 4, 'stale')).rejects.toThrow('lot balance changed');
  const refreshed = (await owner.query(endpoints.lotBalances, scope)).lots.find(lot => lot.code === 'first')!;
  await count(refreshed, 5, 'fresh-count');
  const session = await owner.query(endpoints.readLotCountSession, scope);
  expect(session?.lots).toEqual(expect.arrayContaining([
    expect.objectContaining({ lotId: first.lotId, counted: true }), expect.objectContaining({ lotId: second.lotId, counted: false }),
  ]));
  await expect(owner.mutation(endpoints.finishLotCountSession, { ...scope, sessionId })).rejects.toThrow('pending');
  await count(second, 0, 'clear-second');
  expect((await owner.query(endpoints.branchExpiry, { branchId, paginationOpts: { cursor: null, numItems: 10 } })).page.map(lot => lot.code)).toEqual(['first']);
  const recovered = await owner.query(endpoints.findCountLot, { ...scope, code: 'second' });
  expect(recovered).toMatchObject({ lotId: second.lotId, onHand: 0 });
  await count(recovered!, 2, 'found-second');
  await owner.mutation(endpoints.finishLotCountSession, { ...scope, sessionId });
  expect(await owner.query(endpoints.readLotCountSession, scope)).toBeNull();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('explains expired stock, secures holds across SKUs and rejects lots expiring inside the checkout hold window', async () => {
  vi.useFakeTimers();
  const { t, owner, originId: branchId, destinationId, variantId } = await setup();
  const scope = { branchId, variantId };
  const now = Date.now();
  await owner.mutation(endpoints.enableLotTracking, scope);
  for (const [code, expiresAt, quantity] of [['expired', now - minute, 2], ['soon', now + 5 * minute, 3], ['later', now + 20 * minute, 5]] as const) {
    const request = { ...scope, requestId: code, reason: 'Receipt', quantity, change: { kind: 'add' as const, lot: { code, expiresAt } } };
    const first = await owner.mutation(endpoints.adjustLot, request);
    expect(await owner.mutation(endpoints.adjustLot, request)).toEqual(first);
  }
  const request = { ...scope, expiresAt: now + 10 * minute, checkout: true as const, actor: 'staff' };
  await expect(t.run(ctx => reserveStock(ctx, { ...request, quantity: 6, sourceKey: 'too-short' }))).rejects.toThrow('expire before the ten-minute checkout hold');
  await t.run(ctx => reserveStock(ctx, { ...request, quantity: 3, sourceKey: 'later-hold' }));
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({ onHand: 10, held: 3, expired: 2, sellable: 5, lots: [
    { code: 'expired', expired: true, available: 0 }, { code: 'soon', reserved: 0 }, { code: 'later', reserved: 3 },
  ] });
  const another = await t.run(async ctx => {
    const existing = (await ctx.db.get(variantId))!;
    const id = await ctx.db.insert('productVariants', {
      productId: existing.productId, optionValueIds: [], label: 'Second SKU', price: 100, status: 'active', revision: 0,
    });
    return id;
  });
  await owner.mutation(endpoints.enableLotTracking, { branchId, variantId: another });
  await owner.mutation(endpoints.adjustLot, {
    branchId, variantId: another, requestId: 'another-sku', reason: 'Receipt', quantity: 5,
    change: { kind: 'add', lot: { code: 'another-sku', expiresAt: now + 30 * minute } },
  });
  await t.run(ctx => reserveStock(ctx, { ...request, variantId: another, quantity: 2, sourceKey: 'second-hold' }));
  const paginationOpts = { cursor: null, numItems: 10 };
  const expiryQueue = await owner.query(endpoints.branchExpiry, { branchId, window: 'week', paginationOpts });
  expect(expiryQueue.page).toEqual(expect.arrayContaining([expect.objectContaining({ variantId: another, code: 'another-sku' })]));
  expect(expiryQueue.page.map(row => row.code)).not.toContain('expired');
  expect((await owner.query(endpoints.branchReservations, { branchId, paginationOpts })).page).toEqual(expect.arrayContaining([
    expect.objectContaining({ variantId, quantity: 3, expiresAt: request.expiresAt, checkout: true }),
    expect.objectContaining({ variantId: another, quantity: 2, expiresAt: request.expiresAt, checkout: true }),
  ]));
  expect((await owner.query(endpoints.branchReservations, { branchId: destinationId, paginationOpts })).page).toEqual([]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('shows on-hand and dispatchable units and names a SKU when dispatch stock is insufficient', async () => {
  vi.useFakeTimers();
  const { t, owner, originId, destinationId, variantId } = await setup();
  const scope = { branchId: originId, variantId };
  const now = Date.now();
  await t.run(ctx => ctx.db.patch(variantId, { sku: 'LOT-SKU' }));
  await owner.mutation(endpoints.enableLotTracking, scope);
  for (const [code, expiresAt, quantity] of [['expired', now - minute, 3], ['live', now + 10 * minute, 9]] as const) {
    await owner.mutation(endpoints.adjustLot, { ...scope, requestId: code, reason: 'Intake', quantity, change: { kind: 'add', lot: { code, expiresAt } } });
  }
  await t.run(ctx => reserveStock(ctx, { ...scope, sourceKey: 'hold-five', expiresAt: now + minute, quantity: 5, actor: 'checkout' }));
  expect(await owner.query(endpoints.transferAvailability, { branchId: originId, variantIds: [variantId] }))
    .toEqual([{ variantId, onHand: 12, sellable: 4 }]);
  const transferId = await owner.mutation(endpoints.createTransfer, { originId, destinationId, requestId: 'draft-six', lines: [{ variantId, quantity: 6 }] });
  const detail = await owner.query(endpoints.transferDetail, { branchId: originId, transferId });
  expect(detail?.lines).toMatchObject([{ onHand: 12, sellable: 4, quantity: 6 }]);
  await expect(owner.mutation(endpoints.sendTransfer, { transferId, revision: 0 })).rejects.toThrow('LOT-SKU has 4 dispatchable units');
  expect(await t.run(ctx => readStockLevel(ctx, originId, variantId))).toMatchObject({ onHand: 12 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

it('separates binned, reserved, expired and sellable lot quantities without overlap', async () => {
  vi.useFakeTimers();
  const { t, owner, originId: branchId, variantId } = await setup();
  const scope = { branchId, variantId };
  const now = Date.now();
  await owner.mutation(endpoints.enableLotTracking, scope);
  for (const [code, expiresAt, quantity] of [['Expired', now - minute, 4], ['Live', now + 10 * minute, 8]] as const) {
    await owner.mutation(endpoints.adjustLot, { ...scope, requestId: code, reason: 'Intake', quantity, change: { kind: 'add', lot: { code, expiresAt } } });
  }
  await t.run(ctx => reserveStock(ctx, { ...scope, sourceKey: 'held-two', expiresAt: now + minute, quantity: 2, actor: 'checkout' }));
  const bin = await owner.mutation(api.commerce.stock.addBin, { branchId, name: 'Bin' });
  const { lots } = await owner.query(endpoints.lotBalances, scope);
  await owner.mutation(api.commerce.stock.relocateBinStock, { ...scope, from: null, to: bin, lotId: lots[0]!.lotId, quantity: 1, requestKey: 'hide-expired' });
  await owner.mutation(api.commerce.stock.relocateBinStock, { ...scope, from: null, to: bin, lotId: lots[1]!.lotId, quantity: 2, requestKey: 'store-live' });
  expect(await owner.query(endpoints.lotBalances, scope)).toMatchObject({
    onHand: 12, held: 2, assigned: 3, expired: 3, sellable: 4,
    lots: [{ code: 'Expired', assigned: 1, reserved: 0, available: 0 }, { code: 'Live', assigned: 2, reserved: 2, available: 4 }],
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});
