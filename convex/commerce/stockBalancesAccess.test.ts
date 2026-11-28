// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import { asTestOwner, seedTestBranch } from '../testing/staff.test-support';
import { emptyStockRoles } from './private/stockAccess';
import { writeStockMovement } from './private/stockLedger';

const modules = import.meta.glob('/convex/**/*.ts');
const stock = api.commerce.stock;
const paginationOpts = { numItems: 25, cursor: null };

async function setup() {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, { email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'owner' });
  const manager = t.withIdentity({ email: 'manager@example.com', emailVerified: true, tokenIdentifier: 'manager' });
  const { branchId, otherBranchId, managerId, cashierId, otherCashierId } = await t.run(async ctx => {
    const branchId = await seedTestBranch(ctx);
    const otherBranchId = await seedTestBranch(ctx, 'other');
    // Insert an ineligible staff grant BEFORE branch-eligible grants to verify page 1 never returns empty
    const otherCashierId = await ctx.db.insert('staffGrants', {
      role: 'cashier', branchIds: [otherBranchId], email: 'other-only@example.com', tokenIdentifier: 'other-cashier',
      createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com',
    });
    const managerId = await ctx.db.insert('staffGrants', {
      role: 'manager', branchIds: [branchId], email: 'manager@example.com', tokenIdentifier: 'manager',
      createdAt: 2, updatedAt: 2, updatedByEmail: 'owner@example.com',
    });
    const cashierId = await ctx.db.insert('staffGrants', {
      role: 'cashier', branchIds: [branchId], email: 'arch-e2e-cashier@example.com', tokenIdentifier: 'cashier',
      createdAt: 3, updatedAt: 3, updatedByEmail: 'owner@example.com',
    });
    await ctx.db.insert('users', {
      clerkId: 'clerk_cashier',
      tokenIdentifier: 'cashier',
      email: 'arch-e2e-cashier@example.com',
      name: 'Nadia Cashier',
    });
    return { branchId, otherBranchId, managerId, cashierId, otherCashierId };
  });
  await owner.mutation(stock.setGrant, {
    branchId, staffGrantId: managerId,
    roles: { ...emptyStockRoles, lead: true, buyer: true, receiver: true, requester: true },
    expectedRevision: 0,
  });
  const productId = await manager.mutation(stock.saveProduct, {
    branchId, name: 'Aloe Gel', vatProfile: 'standard',
    variants: [
      { label: '120 mL', sku: 'SPA-ALOE-120', price: 31_000 },
      { label: '60 mL', sku: 'SPA-ALOE-060', price: 18_000 },
    ],
  });
  const product = await manager.query(stock.getProduct, { branchId, productId });
  return {
    t, owner, manager, branchId, otherBranchId, managerId, cashierId, otherCashierId, productId,
    v1: product!.variants[0]._id, v2: product!.variants[1]._id,
  };
}

it('returns recountCount and lastVerifiedCountAt from stock.access (S05, S07)', async () => {
  const { t, manager, branchId, v1 } = await setup();
  // Before any counts or recounts: recountCount=0 and lastVerifiedCountAt=null
  await expect(manager.query(stock.access, { branchId })).resolves.toMatchObject({
    recountCount: 0,
    lastVerifiedCountAt: null,
  });

  // Flag an item for recount
  await t.run(async ctx => {
    await writeStockMovement(ctx, {
      branchId, variantId: v1, delta: 2, kind: 'opening', sourceKey: 's05:open', actor: 'manager', markRecount: true,
    });
  });
  await expect(manager.query(stock.access, { branchId })).resolves.toMatchObject({
    recountCount: 1,
    lastVerifiedCountAt: null,
  });

  // Post a verified count -> clears recountCount and records lastVerifiedCountAt
  await manager.mutation(stock.postOperation, {
    branchId, kind: 'count', operationKey: 's07:count',
    lines: [{ variantId: v1, quantity: 2, expectedRevision: 1 }],
  });
  const after = await manager.query(stock.access, { branchId });
  expect(after.recountCount).toBe(0);
  expect(typeof after.lastVerifiedCountAt).toBe('number');
});

it('records optional unitCost and multi-line opening stock operations (S19, S20)', async () => {
  const { manager, branchId, v1, v2 } = await setup();
  const opId = await manager.mutation(stock.postOperation, {
    branchId,
    kind: 'opening',
    operationKey: 's19-20:bulk-open',
    reason: 'Branch launch',
    reasonCode: 'opening_stock',
    lines: [
      { variantId: v1, quantity: 16, expectedRevision: 0, unitCost: 12_500 },
      { variantId: v2, quantity: 8, expectedRevision: 0 },
    ],
  });
  const op = await manager.query(stock.getOperation, { branchId, operationId: opId });
  expect(op.lines).toHaveLength(2);
  expect(op.lines[0]).toMatchObject({ variantId: v1, before: 0, after: 16, unitCost: 12_500 });
  expect(op.lines[1]).toMatchObject({ variantId: v2, before: 0, after: 8 });
  expect(op.lines[1].unitCost).toBeUndefined();
});

it('supports partial name/email staff search and never returns an empty first page when eligible staff exist (S24)', async () => {
  const { owner, branchId, otherBranchId } = await setup();
  // Even with numItems=1 and an ineligible grant inserted before eligible staff, page 1 returns eligible staff
  const firstPage = await owner.query(stock.listGrants, {
    branchId, paginationOpts: { numItems: 1, cursor: null },
  });
  expect(firstPage.page).toHaveLength(1);
  expect(firstPage.page[0].email).not.toBe('other-only@example.com');

  // Partial email search finds arch-e2e-cashier@example.com
  const byEmailPrefix = await owner.query(stock.listGrants, {
    branchId, search: 'arch-e2e-cas', paginationOpts,
  });
  expect(byEmailPrefix.page.map(r => r.email)).toEqual(['arch-e2e-cashier@example.com']);
  expect(byEmailPrefix.page[0].name).toBe('Nadia Cashier');

  // Partial display name search finds Nadia Cashier
  const byName = await owner.query(stock.listGrants, {
    branchId, search: 'nadia', paginationOpts,
  });
  expect(byName.page.map(r => r.email)).toEqual(['arch-e2e-cashier@example.com']);

  // Branch scope respected: searching for branchId's cashier on otherBranchId returns empty
  const wrongBranch = await owner.query(stock.listGrants, {
    branchId: otherBranchId, search: 'arch-e2e-cas', paginationOpts,
  });
  expect(wrongBranch.page).toEqual([]);
});
