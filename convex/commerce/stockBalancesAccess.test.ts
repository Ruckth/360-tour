// @vitest-environment edge-runtime
import type { FunctionReturnType } from 'convex/server';
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

it('records optional unitCost, restricts cost visibility to buyers/leads, and supports multi-line opening stock (S19, S20)', async () => {
  const { t, owner, manager, branchId, cashierId, v1, v2 } = await setup();
  const cashier = t.withIdentity({ email: 'arch-e2e-cashier@example.com', emailVerified: true, tokenIdentifier: 'cashier' });
  await owner.mutation(stock.setGrant, {
    branchId, staffGrantId: cashierId,
    roles: { ...emptyStockRoles, receiver: true },
    expectedRevision: 0,
  });
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
  // Buyer/lead sees reference unitCost
  const op = await manager.query(stock.getOperation, { branchId, operationId: opId });
  expect(op.lines).toHaveLength(2);
  expect(op.lines[0]).toMatchObject({ variantId: v1, before: 0, after: 16, unitCost: 12_500 });
  expect(op.lines[1]).toMatchObject({ variantId: v2, before: 0, after: 8 });
  expect(op.lines[1].unitCost).toBeUndefined();

  // Plain receiver without buyer/lead role does not receive unitCost (S19 cost visibility policy)
  const cashierOp = await cashier.query(stock.getOperation, { branchId, operationId: opId });
  expect(cashierOp.lines[0].unitCost).toBeUndefined();
});

it('paginates eligible staff and partial search beyond 200 company-wide grants without truncating to one page (S24)', async () => {
  const { t, owner, branchId, otherBranchId } = await setup();
  // Insert 205 ineligible grants on otherBranchId and 3 eligible grants on branchId AFTER the 200 cutoff
  await t.run(async ctx => {
    for (let i = 0; i < 205; i++) {
      await ctx.db.insert('staffGrants', {
        role: 'cashier',
        branchIds: [otherBranchId],
        email: `other-branch-${String(i).padStart(3, '0')}@example.com`,
        tokenIdentifier: `other-bulk-${i}`,
        createdAt: 10 + i,
        updatedAt: 10 + i,
        updatedByEmail: 'owner@example.com',
      });
    }
    for (let i = 1; i <= 3; i++) {
      await ctx.db.insert('staffGrants', {
        role: 'cashier',
        branchIds: [branchId],
        email: `late-samui-${i}@example.com`,
        tokenIdentifier: `late-samui-${i}`,
        createdAt: 300 + i,
        updatedAt: 300 + i,
        updatedByEmail: 'owner@example.com',
      });
    }
  });

  // Unfiltered real pagination reaches targets inserted after 205 ineligible grants
  const seenEmails: string[] = [];
  let cursor: string | null = null;
  let guard = 0;
  do {
    const page: FunctionReturnType<typeof stock.listGrants> = await owner.query(stock.listGrants, {
      branchId,
      paginationOpts: { numItems: 2, cursor },
    });
    seenEmails.push(...page.page.map(r => r.email));
    cursor = page.isDone ? null : page.continueCursor;
    guard++;
  } while (cursor !== null && guard < 10);
  expect(seenEmails).toContain('late-samui-1@example.com');
  expect(seenEmails).toContain('late-samui-3@example.com');
  expect(seenEmails.some(e => e.startsWith('other-branch-'))).toBe(false);

  // Partial search past 200 cutoff paginates across multiple result pages (numItems: 2 over 3 matches)
  const searchP1 = await owner.query(stock.listGrants, {
    branchId, search: 'late-samui', paginationOpts: { numItems: 2, cursor: null },
  });
  expect(searchP1.page.map(r => r.email)).toEqual(['late-samui-1@example.com', 'late-samui-2@example.com']);
  expect(searchP1.isDone).toBe(false);
  expect(searchP1.continueCursor).not.toBe('');

  const searchP2 = await owner.query(stock.listGrants, {
    branchId, search: 'late-samui', paginationOpts: { numItems: 2, cursor: searchP1.continueCursor },
  });
  expect(searchP2.page.map(r => r.email)).toEqual(['late-samui-3@example.com']);
  expect(searchP2.isDone).toBe(true);

  // Partial email and display name search still work and respect branch isolation
  const byName = await owner.query(stock.listGrants, {
    branchId, search: 'nadia', paginationOpts,
  });
  expect(byName.page.map(r => r.email)).toEqual(['arch-e2e-cashier@example.com']);
  expect(byName.page[0].name).toBe('Nadia Cashier');

  const wrongBranch = await owner.query(stock.listGrants, {
    branchId: otherBranchId, search: 'arch-e2e-cas', paginationOpts,
  });
  expect(wrongBranch.page).toEqual([]);
});

it('returns a non-terminal continuation cursor after >500 non-matches and finds a match on the next page (S24)', async () => {
  const { t, owner, branchId, otherBranchId } = await setup();
  // Insert 505 ineligible grants on otherBranchId before one eligible match on branchId
  await t.run(async ctx => {
    for (let i = 0; i < 505; i++) {
      await ctx.db.insert('staffGrants', {
        role: 'cashier',
        branchIds: [otherBranchId],
        email: `skip-${String(i).padStart(4, '0')}@example.com`,
        tokenIdentifier: `skip-${i}`,
        createdAt: 1000 + i,
        updatedAt: 1000 + i,
        updatedByEmail: 'owner@example.com',
      });
    }
    await ctx.db.insert('staffGrants', {
      role: 'cashier',
      branchIds: [branchId],
      email: 'after-500-target@example.com',
      tokenIdentifier: 'after-500-target',
      createdAt: 2000,
      updatedAt: 2000,
      updatedByEmail: 'owner@example.com',
    });
  });

  // Page 1 scans bounded 500 records -> 0 matches for 'after-500-target', but isDone is false with a valid cursor
  const page1 = await owner.query(stock.listGrants, {
    branchId, search: 'after-500-target', paginationOpts,
  });
  expect(page1.page).toEqual([]);
  expect(page1.isDone).toBe(false);
  expect(page1.continueCursor).not.toBe('');

  // Page 2 resumes from cursor and finds the match past the 500 scan boundary
  const page2 = await owner.query(stock.listGrants, {
    branchId, search: 'after-500-target', paginationOpts: { numItems: 25, cursor: page1.continueCursor },
  });
  expect(page2.page.map(r => r.email)).toEqual(['after-500-target@example.com']);
  expect(page2.isDone).toBe(true);
});
