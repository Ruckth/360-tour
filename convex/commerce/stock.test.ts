// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import schema from '../schema';
import { asTestOwner, seedTestBranch } from '../testing/staff.test-support';
import { emptyStockRoles } from './private/stockAccess';
import { writeStockMovement } from './private/stockLedger';

const modules = import.meta.glob('/convex/**/*.ts');
const stock = api.commerce.stock;
const paginationOpts = { numItems: 25, cursor: null };

async function fixture() {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, { email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'owner' });
  const manager = t.withIdentity({ email: 'manager@example.com', emailVerified: true, tokenIdentifier: 'manager' });
  const cashier = t.withIdentity({ email: 'cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier' });
  const { branchId, otherBranchId, managerId, cashierId } = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const otherBranchId = await seedTestBranch(ctx, 'other');
    const managerId = await ctx.db.insert('staffGrants', {
      role: 'manager', branchIds: [branchId, otherBranchId], email: 'manager@example.com', tokenIdentifier: 'manager',
      createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
    });
    const cashierId = await ctx.db.insert('staffGrants', {
      role: 'cashier', branchIds: [branchId], email: 'cashier@example.com', tokenIdentifier: 'cashier',
      createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
    });
    return { branchId, otherBranchId, managerId, cashierId };
  });
  await owner.mutation(stock.setGrant, {
    branchId, staffGrantId: managerId, roles: { ...emptyStockRoles, lead: true, buyer: true, receiver: true }, expectedRevision: 0,
  });
  const productId = await manager.mutation(stock.saveProduct, {
    branchId, name: 'Handwoven Robe', vatProfile: 'standard', variants: [{ label: 'Medium', sku: 'ROB-019', price: 74_900 }],
  });
  const product = await manager.query(stock.getProduct, { branchId, productId });
  return { t, owner, cashier, manager, branchId, otherBranchId, productId, managerId, cashierId, variantId: product!.variants[0]._id };
}

it('looks up staff beyond the first grant page without returning another branch’s cashier', async () => {
  const { owner, branchId, otherBranchId, cashier } = await fixture();
  const first = { numItems: 1, cursor: null };
  const lookup = (branch: typeof branchId) => owner.query(stock.listGrants, {
    branchId: branch, emailPrefix: ' CASHIER@ ', paginationOpts: first,
  });
  expect((await lookup(branchId)).page.map(row => row.email)).toEqual(['cashier@example.com']);
  expect((await lookup(otherBranchId)).page).toEqual([]);
  await expect(cashier.query(stock.listGrants, { branchId, emailPrefix: 'manager', paginationOpts: first })).rejects.toThrow();
});

it('keeps branch roles and direct permissions off until an owner grants them', async () => {
  const { owner, manager, cashier, cashierId, branchId, otherBranchId } = await fixture();
  await expect(cashier.query(stock.listBalances, { branchId, paginationOpts })).rejects.toMatchObject({ data: { code: 'STOCK_FORBIDDEN' } });
  expect((await cashier.query(api.auth.staffAccess.myAccess)).capabilities.stock).toBeUndefined();
  await expect(manager.query(stock.listBalances, { branchId: otherBranchId, paginationOpts })).rejects.toMatchObject({ data: { code: 'STOCK_FORBIDDEN' } });
  await expect(cashier.query(stock.access, { branchId: otherBranchId })).rejects.toMatchObject({ data: { code: 'BRANCH_FORBIDDEN' } });
  await expect(manager.query(stock.access, { branchId })).resolves.toMatchObject({
    read: true, buyer: true, receiver: true, directOrder: false, directReceipt: false,
  });
  await owner.mutation(stock.setBranchPolicy, { branchId, directOrder: true, directReceipt: true, expectedRevision: 0 });
  await owner.mutation(stock.setGrant, { branchId, staffGrantId: cashierId, roles: { ...emptyStockRoles, requester: true }, expectedRevision: 0 });
  await expect(manager.query(stock.access, { branchId })).resolves.toMatchObject({ directOrder: true, directReceipt: true });
  await expect(cashier.query(stock.access, { branchId })).resolves.toMatchObject({ read: true, requester: true, directOrder: false, directReceipt: false });
  expect((await cashier.query(api.auth.staffAccess.myAccess)).capabilities.stock).toBe(true);
  await expect(cashier.mutation(stock.setBranchPolicy, { branchId, directOrder: false, directReceipt: false, expectedRevision: 1 })).rejects.toThrow('Not authorized');
});

it('returns absent balances from catalog search and joins On order, then audits catalog edits', async () => {
  const { t, manager, branchId, variantId, productId } = await fixture();
  const balance = (search: string) => manager.query(stock.listBalances, { branchId, search, paginationOpts });
  await expect(balance('robe')).resolves.toMatchObject({ page: [{ variantId, onHand: 0, onOrder: 0, revision: 0 }] });
  await expect(manager.query(stock.selectedBalances, { branchId, variantIds: ['invalid-id', variantId, variantId] }))
    .resolves.toMatchObject([{ variantId, onHand: 0, hasBalance: false }]);
  await t.run(async ctx => {
    await ctx.db.insert('stockIncoming', { branchId, variantId, quantity: 12 });
  });
  await expect(balance('rob-019')).resolves.toMatchObject({ page: [{ variantId, onHand: 0, onOrder: 12 }] });
  const product = await manager.query(stock.getProduct, { branchId, productId });
  await manager.mutation(stock.saveProduct, {
    branchId, productId, expectedRevision: product!.product.revision, name: 'Linen Robe', vatProfile: 'standard',
    variants: [{ variantId, label: 'Medium', sku: 'ROB-019', price: 79_900 }],
  });
  await expect(balance('linen')).resolves.toMatchObject({ page: [{ variantId, price: 79_900 }] });
  await expect(balance('handwoven')).resolves.toMatchObject({ page: [] });
  await expect(manager.query(stock.productHistory, { branchId, productId, paginationOpts })).resolves.toMatchObject({
    page: [{ after: { name: 'Linen Robe', minPrice: 79_900 } }, { after: { name: 'Handwoven Robe' } }],
  });
  await manager.mutation(stock.archiveProduct, { branchId, productId, expectedRevision: product!.product.revision + 1 });
  await expect(balance('linen')).resolves.toMatchObject({ page: [] });
  await expect(manager.query(stock.productHistory, { branchId, productId, paginationOpts })).resolves.toMatchObject({
    page: [{ after: { status: 'archived' } }, expect.anything(), expect.anything()],
  });
});

it('backfills existing variant search without rewriting its business revision', async () => {
  const { t, manager, branchId, productId } = await fixture();
  const legacy = await t.run(async ctx => await ctx.db.insert('productVariants', {
    productId, optionValueIds: [], label: 'Legacy Label', sku: 'OLD-43', price: 400, status: 'active', revision: 3,
  }));
  expect(await t.mutation(internal.commerce.stock.backfillVariantSearch, { productId, paginationOpts })).toMatchObject({ updated: 1, isDone: true });
  await expect(manager.query(stock.listBalances, { branchId, search: 'old-43', paginationOpts })).resolves.toMatchObject({ page: [{ variantId: legacy }] });
  await expect(t.run(async ctx => await ctx.db.get(legacy))).resolves.toMatchObject({ revision: 3, normalizedSku: 'old-43' });
});

it('refreshes an imported product with more than 50 variants across bounded rename batches', async () => {
  vi.useFakeTimers();
  try {
    const { t, manager, branchId, productId } = await fixture();
    const last = await t.run(async ctx => {
      const product = await ctx.db.get(productId);
      await ctx.db.patch(productId, { variantCount: 52 });
      let last;
      for (let index = 1; index < 52; index++) {
        last = await ctx.db.insert('productVariants', {
          productId, optionValueIds: [], label: index === 1 ? ' Legacy 1 ' : 'Legacy ' + index, sku: index === 1 ? '' : 'LEG-' + index, price: 100, status: 'active',
          revision: 1, productName: product!.name, productStatus: 'active', searchText: product!.name + ' Legacy ' + index,
        });
      }
      return last!;
    });
    const product = await manager.query(stock.getProduct, { branchId, productId });
    expect(product).toMatchObject({ hasMoreVariants: true });
    await manager.mutation(stock.saveProduct, {
      branchId, productId, expectedRevision: product!.product.revision, name: 'Renamed Linen Robe', vatProfile: 'standard',
      variants: product!.variants.map(({ _id: variantId, label, sku, price, status }) => ({ variantId, label: label.trim(), sku: sku?.trim() || undefined, price, status })),
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.run(async ctx => await ctx.db.get(last))).resolves.toMatchObject({ productName: 'Renamed Linen Robe', revision: 1 });
    await manager.mutation(stock.archiveProduct, { branchId, productId, expectedRevision: product!.product.revision + 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expect(t.run(async ctx => await ctx.db.get(last))).resolves.toMatchObject({ productStatus: 'archived' });
  } finally {
    vi.useRealTimers();
  }
});

it('replays exact posts, rejects changed input or withdrawn permissions, and confirms stale counts safely', async () => {
  const { t, owner, manager, branchId, variantId, managerId } = await fixture();
  const opening = { branchId, kind: 'opening' as const, operationKey: 'open:1', lines: [{ variantId, quantity: 5, expectedRevision: 0 }] };
  const operationId = await manager.mutation(stock.postOperation, opening);
  const staleCount = { branchId, kind: 'count' as const, operationKey: 'count:1', reason: 'Shelf count',
    lines: [{ variantId, quantity: 2, expectedRevision: 1 }] };
  const sale = { branchId, variantId, delta: -3, kind: 'sale' as const, sourceKey: 'sale:test:robe', actor: 'cashier', allowNegative: true };
  const first = await t.run(async ctx => await writeStockMovement(ctx, sale));
  expect(await t.run(async ctx => await writeStockMovement(ctx, sale))).toEqual(first);
  await expect(manager.mutation(stock.postOperation, opening)).resolves.toEqual(operationId);
  await expect(manager.mutation(stock.postOperation, { ...opening, lines: [{ variantId, quantity: 7, expectedRevision: 0 }] }))
    .rejects.toMatchObject({ data: { code: 'STOCK_KEY_CONFLICT' } });
  await expect(manager.mutation(stock.postOperation, staleCount)).rejects.toMatchObject({ data: { code: 'STALE_STOCK_BALANCE' } });
  await expect(manager.query(stock.listActivity, { branchId, kind: 'sale', paginationOpts })).resolves.toMatchObject({
    page: [{ _id: first.movementId, before: 5, after: 2, itemLabel: 'Handwoven Robe · Medium' }],
  });
  await owner.mutation(stock.setGrant, { branchId, staffGrantId: managerId, roles: emptyStockRoles, expectedRevision: 1 });
  await expect(manager.mutation(stock.postOperation, opening)).rejects.toMatchObject({ data: { code: 'STOCK_FORBIDDEN' } });
});

it('preserves a blocked correction as a report, bounds reversals, and clears recount with a zero-change verified count', async () => {
  const { t, manager, branchId, variantId } = await fixture();
  const op = await manager.mutation(stock.postOperation, { branchId, kind: 'opening', operationKey: 'opening',
    lines: [{ variantId, quantity: 5, expectedRevision: 0 }] });
  const operation = await manager.query(stock.getOperation, { branchId, operationId: op });
  const linked = await manager.query(stock.getMovement, { branchId, movementId: operation.lines[0].movementId });
  expect(linked).toMatchObject({ operationId: op });
  expect(linked.receiptId).toBeUndefined();
  const movementId = operation.lines[0].movementId;
  await t.run(async ctx => await writeStockMovement(ctx, {
    branchId, variantId, kind: 'sale', delta: -4, sourceKey: 'sale:correction-example:robe', actor: 'desk',
  }));
  const correction = { branchId, movementId, quantity: 3, expectedRevision: 2, reason: 'Wrong opening units' };
  await expect(manager.query(stock.previewCorrection, { branchId, movementId, quantity: 3 })).resolves.toMatchObject({
    requiresReconciliation: true, available: 5, line: { before: 1, after: -2 },
  });
  const { reportId, operationId } = await manager.mutation(stock.postCorrection, { ...correction, operationKey: 'blocked' });
  expect(operationId).toBeNull();
  expect(reportId).not.toBeNull();
  await expect(manager.query(stock.listReports, { branchId, paginationOpts })).resolves.toMatchObject({
    page: [{ _id: reportId, requestedQuantity: 3, reviewedRevision: 2 }],
  });
  await expect(manager.mutation(stock.postCorrection, { ...correction, confirmNegative: true, operationKey: 'invalid' }))
    .rejects.toMatchObject({ data: { code: 'STOCK_RECONCILIATION_REQUIRED' } });
  const result = await manager.mutation(stock.postCorrection, {
    ...correction, reportId: reportId!, physicalCount: 0, confirmNegative: true, operationKey: 'confirmed',
  });
  expect(result.operationId).not.toBeNull();
  await expect(manager.query(stock.listBalances, { branchId, recountOnly: true, paginationOpts })).resolves.toMatchObject({
    page: [{ onHand: -2, needsRecount: true }],
  });
  await expect(manager.query(stock.previewCorrection, { branchId, movementId, quantity: 3 })).rejects.toMatchObject({ data: { code: 'STOCK_CORRECTION_LIMIT' } });

  await t.run(async ctx => await writeStockMovement(ctx, {
    branchId, variantId, kind: 'direct_receipt', delta: 2, sourceKey: 'direct:recount-example:robe', actor: 'desk',
  }));
  await manager.mutation(stock.postOperation, { branchId, kind: 'count', operationKey: 'verify',
    lines: [{ variantId, quantity: 0, expectedRevision: 4 }] });
  await expect(manager.query(stock.listBalances, { branchId, recountOnly: true, paginationOpts })).resolves.toMatchObject({ page: [] });
  await expect(manager.query(stock.listActivity, { branchId, kind: 'count', paginationOpts })).resolves.toMatchObject({
    page: [{ delta: 0, before: 0, after: 0 }],
  });
});

it('requires a lead and an adjustment reason valid for the direction', async () => {
  const { owner, manager, cashier, cashierId, branchId, variantId } = await fixture();
  await owner.mutation(stock.setGrant, { branchId, staffGrantId: cashierId, roles: { ...emptyStockRoles, receiver: true }, expectedRevision: 0 });
  const input = { branchId, kind: 'adjust' as const, operationKey: 'found', lines: [{ variantId, quantity: 5, expectedRevision: 0 }] };
  await expect(cashier.mutation(stock.postOperation, { ...input, reasonCode: 'found' })).rejects.toMatchObject({ data: { code: 'STOCK_FORBIDDEN' } });
  await expect(manager.mutation(stock.postOperation, { ...input, reasonCode: 'damaged' })).rejects.toMatchObject({ data: { code: 'INVALID_STOCK_ADJUSTMENT_REASON' } });
  await expect(manager.mutation(stock.postOperation, { ...input, reasonCode: 'other', reason: 'Other:' })).rejects.toMatchObject({ data: { code: 'STOCK_REASON_REQUIRED' } });
  await manager.mutation(stock.postOperation, { ...input, reasonCode: '  ＦＯＵＮＤ ' });
  const removal = { ...input, operationKey: 'damage', lines: [{ variantId, quantity: -2, expectedRevision: 1 }] };
  await expect(manager.mutation(stock.postOperation, { ...removal, reasonCode: 'found' })).rejects.toMatchObject({ data: { code: 'INVALID_STOCK_ADJUSTMENT_REASON' } });
  await manager.mutation(stock.postOperation, { ...removal, reasonCode: 'damaged' });
  await expect(manager.query(stock.listActivity, { branchId, kind: 'write_off', paginationOpts })).resolves.toMatchObject({
    page: [{ before: 5, after: 3, reasonCode: 'damaged' }],
  });
});

it('rejects an oversized batch and rolls back all lines when posting fails after the first write', async () => {
  const { t, manager, branchId, variantId, productId } = await fixture();
  const second = await t.run(ctx => ctx.db.insert('productVariants', {
    productId, optionValueIds: [], label: 'Large', price: 450, status: 'active', revision: 0,
  }));
  const first = { variantId, quantity: 1, expectedRevision: 0 };
  const input = { branchId, kind: 'opening' as const, operationKey: 'batch' };
  await expect(manager.mutation(stock.postOperation, { ...input, lines: Array.from({ length: 51 }, () => first) }))
    .rejects.toMatchObject({ data: { code: 'INVALID_STOCK_LINES' } });
  await expect(manager.mutation(stock.postOperation, { ...input, lines: [first, {
    ...first, variantId: second, lotReceipt: { code: 'LOT', expiresAt: Date.now() + 86_400_000 },
  }] })).rejects.toMatchObject({ data: { code: 'STOCK_LOT_TRACKING_REQUIRED' } });
  await t.run(async ctx => {
    for (const table of ['stockLevels', 'stockMovements', 'stockOperations', 'stockOperationKeys'] as const) {
      expect(await ctx.db.query(table).first()).toBeNull();
    }
  });
  await manager.mutation(stock.postOperation, { ...input, lines: [first, { ...first, variantId: second }] });
  await expect(manager.query(stock.listActivity, { branchId, paginationOpts })).resolves.toMatchObject({ page: [
    expect.objectContaining({ itemLabel: 'Handwoven Robe · Large' }), expect.objectContaining({ itemLabel: 'Handwoven Robe · Medium' }),
  ] });
});

it('rejects movement, operation, and report IDs from another authorized branch', async () => {
  const { owner, manager, managerId, branchId, otherBranchId, variantId } = await fixture();
  await owner.mutation(stock.setGrant, { branchId: otherBranchId, staffGrantId: managerId,
    roles: { ...emptyStockRoles, lead: true, receiver: true }, expectedRevision: 0 });
  const operationId = await manager.mutation(stock.postOperation, {
    branchId, operationKey: 'main', kind: 'opening', lines: [{ variantId, quantity: 1, expectedRevision: 0 }],
  });
  const move = await manager.query(stock.getOperation, { branchId, operationId });
  const movementId = move.lines[0].movementId;
  const reportId = await manager.mutation(stock.reportProblem, { branchId, movementId, reason: 'Wrong shelf', operationKey: 'report' });
  const rejected = { branchId: otherBranchId, movementId };
  await expect(manager.query(stock.getMovement, rejected)).rejects.toMatchObject({ data: { code: 'STOCK_MOVEMENT_NOT_FOUND' } });
  await expect(manager.query(stock.getOperation, { branchId: otherBranchId, operationId })).rejects.toMatchObject({ data: { code: 'STOCK_OPERATION_NOT_FOUND' } });
  await expect(manager.mutation(stock.reportProblem, { ...rejected, reason: 'Wrong branch', operationKey: 'report' }))
    .rejects.toMatchObject({ data: { code: 'STOCK_MOVEMENT_NOT_FOUND' } });
  await expect(manager.mutation(stock.resolveReport, { branchId: otherBranchId, reportId, expectedRevision: 1, reason: 'Resolved', operationKey: 'resolve' }))
    .rejects.toMatchObject({ data: { code: 'STOCK_REPORT_NOT_FOUND' } });
  await expect(manager.query(stock.getMovement, { branchId, movementId })).resolves.toMatchObject({ reports: [{ _id: reportId, status: 'open' }] });
});

it('filters human actor labels and reason codes without exposing legacy tokens', async () => {
  const { t, manager, branchId, variantId } = await fixture();
  const token = 'https://clerk.example.com|user_opaque';
  const rows = await t.run(async ctx => {
    const current = await writeStockMovement(ctx, {
      branchId, variantId, kind: 'opening', delta: 2, sourceKey: 'fixture:current', actor: token,
      actorLabel: 'Kamon@example.com', reasonCode: '  Found ', createdAt: 3,
    });
    const legacyActor = await ctx.db.insert('stockMovements', {
      branchId, variantId, kind: 'sale', delta: -1, before: 2, after: 1, sourceKey: 'sale:legacy-filter:robe',
      actor: ' KAMON@example.com ', createdAt: 2,
    });
    const legacyToken = await ctx.db.insert('stockMovements', {
      branchId, variantId, kind: 'write_off', delta: -1, before: 1, after: 0, sourceKey: 'legacy:token',
      actor: token, createdAt: 1,
    });
    return { current, legacyActor, legacyToken, level: (await ctx.db.query('stockLevels').first())!._id };
  });
  await t.mutation(internal.commerce.stock.backfillMovementFilters, { paginationOpts });
  const byActor = await manager.query(stock.listActivity, { branchId, actor: ' ＫＡＭＯＮ@EXAMPLE.COM ', reasonCode: '   ', paginationOpts });
  expect(byActor.page.map(row => row._id)).toEqual([rows.current.movementId, rows.legacyActor]);
  await expect(manager.query(stock.listActivity, { branchId, reasonCode: ' FOUND ', paginationOpts })).resolves.toMatchObject({
    page: [{ _id: rows.current.movementId }],
  });
  const blank = await manager.query(stock.listActivity, { branchId, actor: ' ', reasonCode: '', paginationOpts });
  expect(blank.page.map(row => row.actorLabel)).toEqual(['Kamon@example.com', 'KAMON@example.com', 'Staff member']);
  expect(JSON.stringify(blank)).not.toContain(token);
  const history = await manager.query(api.commerce.history.staffPage, {
    target: { targetType: 'stock', targetId: rows.level }, paginationOpts: { numItems: 10, cursor: null },
  });
  expect(history.page.map(row => row.staff?.actorName)).toContain('Staff member');
  expect(JSON.stringify(history)).not.toContain(token);
});

it('detects a normalized duplicate active label when an existing variant was omitted', async () => {
  const { manager, branchId, productId } = await fixture();
  await expect(manager.mutation(stock.saveProduct, {
    branchId, productId, expectedRevision: 1, name: 'Handwoven Robe', vatProfile: 'standard',
    variants: [{ label: ' Ｍｅｄｉｕｍ ', price: 120, sku: 'ROB-020' }],
  })).rejects.toMatchObject({ data: { code: 'DUPLICATE_STOCK_VARIANT' } });
});

it.each([
  ['sale', 'sale:legacy-order:robe', 'legacy-order'],
  ['return', 'return:legacy-return:robe', 'legacy-return'],
  ['taken_back', 'approval:legacy-take-back', undefined],
  ['direct_receipt', 'purchasing:receipt:legacy-delivery', 'legacy-receipt'],
] as const)('replays a pre-migration %s with new source evidence and rejects mismatching facts', async (kind, sourceKey, sourceId) => {
  const { t, branchId, otherBranchId, variantId } = await fixture();
  const originalMovementId = await t.run(ctx => ctx.db.insert('stockMovements', {
    branchId, variantId, kind: 'opening', delta: 5, before: 0, after: 5, sourceKey: 'legacy:original', actor: 'manager', createdAt: 1,
  }));
  const delta = kind === 'sale' ? -1 : 1;
  const input = { branchId, variantId, kind, delta, sourceKey, actor: 'manager', reason: 'Legacy reason' };
  const old = await t.run(ctx => ctx.db.insert('stockMovements', { ...input, before: 5, after: 5 + delta, createdAt: 2 }));
  const replay = { ...input, originalMovementId, actorLabel: 'Manager', sourceId, reasonCode: 'fixture' };
  await expect(t.run(ctx => writeStockMovement(ctx, replay))).resolves.toEqual({ movementId: old, before: 5, after: 5 + delta });
  for (const changed of [
    { branchId: otherBranchId }, { delta: 2 }, { reason: 'Wrong reason' }, { actor: 'wrong' },
    ...(kind === 'sale' || kind === 'return' ? [{ sourceId: 'different-document' }] : []),
  ]) {
    await expect(t.run(ctx => writeStockMovement(ctx, { ...replay, ...changed })))
      .rejects.toMatchObject({ data: { code: 'STOCK_KEY_CONFLICT' } });
  }
  await t.run(ctx => ctx.db.patch(old, { originalMovementId }));
  await expect(t.run(ctx => writeStockMovement(ctx, { ...replay, originalMovementId: old })))
    .rejects.toMatchObject({ data: { code: 'STOCK_KEY_CONFLICT' } });
  expect(await t.run(ctx => ctx.db.query('stockLevels').first())).toBeNull();
});
