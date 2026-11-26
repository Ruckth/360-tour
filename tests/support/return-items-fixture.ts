import { seedTestBranch, asTestOwner } from '../../convex/testing/staff.test-support';
import { convexTest } from 'convex-test';
// convex-test counts every get, patch and returned query row the way native Convex does.
import { TransactionMetricsTracker } from 'convex-test/dist/transactionMetrics.js';
import { expect, vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { MutationCtx } from '../../convex/_generated/server';
import { resolveCommerceSettings } from '../../convex/commerce/model';
import * as budgets from '../../convex/lib/readBudget';
import schema from '../../convex/schema';
import { termsOf } from '../../convex/pos/private/paymentCommerce';
import type { ReturnPart } from '../../convex/pos/private/returnPlan';

/*
 * Return items fixtures on the real Convex functions (convex-test): receipts, rows, tenders, vouchers,
 * the 100-row benefit maximum and a read/write meter. Shared by convex/pos/returnItems*.test.ts.
 */

const modules = import.meta.glob('/convex/**/*.ts');
export const command = api.pos.commands.returnItems;
export const now = Date.parse('2026-11-19T03:00:00Z');
export const day = 86400000;
export const settings = resolveCommerceSettings(null);
export const { revision } = settings;
export const terms = termsOf(settings);
export type Snapshot = NonNullable<Doc<'orderLines'>['saleSnapshot']>;
export type Payment = { method: 'card' | 'cash' | 'transfer' | 'promptpay'; amount: number } | { method: 'voucher'; amount: number; voucherId: Id<'vouchers'> };

export async function setup() {
  const date = vi.spyOn(Date, 'now').mockReturnValue(now);
  const t = convexTest(schema, modules);
  const staff = (token: string) => t.withIdentity({ tokenIdentifier: token, email: `${token}@example.com`, emailVerified: true });
  await t.run(async ctx => {
    for (const [tokenIdentifier, role] of [['cashier', 'cashier'], ['manager', 'manager'], ['other', 'manager']] as const) {
      await ctx.db.insert('staffGrants', { branchIds: [await seedTestBranch(ctx)],
        role, email: `${tokenIdentifier}@example.com`, tokenIdentifier, createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com',
      });
    }
  });
  return { t, date, cashier: staff('cashier'), manager: staff('manager'), other: staff('other'), owner: await asTestOwner(t, { email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'owner' }) };
}

export function receipt(ctx: MutationCtx, total: number, itemCount = 1) {
  return ctx.db.insert('orders', {
    orderNumber: 1, receiptNumber: 100, currency: 'THB', status: 'paid', itemCount, hasItems: true,
    total, due: 0, revision: 1, paidAt: now, createdBy: 'cashier', createdAt: now, updatedAt: now, vatVersion: 2,
  });
}

export function line(ctx: MutationCtx, orderId: Id<'orders'>, kind: Doc<'orderLines'>['kind'], price: number, fields: Partial<Doc<'orderLines'>> = {}) {
  return ctx.db.insert('orderLines', {
    orderId, kind, name: kind, currency: 'THB', qty: 1, unitPrice: price, catalogUnitPrice: price, createdAt: now, ...fields,
  });
}

export function payment(ctx: MutationCtx, orderId: Id<'orders'>, tender: Payment) {
  return ctx.db.insert('orderPayments', { orderId, ...tender, idempotencyKey: `pay:${orderId}`, createdAt: now, createdBy: 'cashier' });
}

export function allocation(paidShare: number): Pick<Snapshot, 'paidShare' | 'vatBase' | 'returnedAmount' | 'returnedUnits' | 'tenderCells'> {
  return { paidShare, vatBase: paidShare, returnedAmount: 0, returnedUnits: 0, tenderCells: [{ kind: 'external', amount: paidShare }] };
}
export function snapshot(label: string, paidShare: number, contents: Snapshot['contents'] = []): Snapshot {
  return {
    label, settingsRevision: revision, terms, ...allocation(paidShare), contents, chosenVariants: [], goodwillDiscounts: [],
  };
}

export async function catalog(ctx: MutationCtx, existingBranch?: Id<'branches'>) {
  const branchId = existingBranch ?? await seedTestBranch(ctx);
  const categoryId = await ctx.db.insert('productCategories', { name: 'Gifts', sort: 0 });
  const productId = await ctx.db.insert('products', {
    categoryId, name: 'Robe', status: 'active', vatProfile: 'standard', options: [],
    minPrice: 100, maxPrice: 100, variantCount: 20, sort: 0, revision: 0,
  });
  return { branchId, productId };
}

export async function product(ctx: MutationCtx, item: Awaited<ReturnType<typeof catalog>>, orderId: Id<'orders'>, price: number, handover = false) {
  const variantId = await ctx.db.insert('productVariants', {
    productId: item.productId, optionValueIds: [], label: 'Robe', price, status: 'active', revision: 0,
  });
  const stockId = await ctx.db.insert('stockLevels', { ...item, variantId, onHand: 2, revision: 1 });
  const movementId = await ctx.db.insert('stockMovements', {
    branchId: item.branchId, variantId, delta: -1, before: 3, after: 2, kind: handover ? 'room_bill' : 'sale',
    sourceKey: 'sale', actor: 'cashier', createdAt: now,
  });
  const lineId = await line(ctx, orderId, 'product', price, {
    variantId, saleSnapshot: snapshot('Robe', price, [{
      contentKey: 'product', label: 'Robe', units: 1, ...allocation(price), vatProfile: 'standard', stockMovementId: movementId,
    }]),
  });
  const handoverId = handover ? await ctx.db.insert('handovers', {
    kind: 'room_bill', orderId, lineId, variantId, originalMovementId: movementId, unitPrice: price, quantity: 1, withGuest: 1,
    backSellable: 0, backDamaged: 0, unpaid: 0, paid: 1, status: 'open', movementIds: [movementId], clientKey: 'sale', revision: 1,
  }) : undefined;
  return { lineId, stockId, handoverId };
}

export function voucher(
  ctx: MutationCtx, source: Doc<'vouchers'>['source'], branchId: Id<'branches'>,
  paidBalance: number, fields: Partial<Doc<'vouchers'>> = {},
) {
  return ctx.db.insert('vouchers', {
    faceValue: paidBalance, paidBalance, goodwillBalance: 0, issuedExpiresAt: now + day, effectiveExpiresAt: now + day,
    status: 'active', branchId, source, revision: 0, settingsRevision: revision, terms, ...fields,
  });
}

export function selection(orderId: Id<'orders'>, parts: ReturnPart[], fields = {}) {
  return {
    orderId, parts, clientKey: 'return-test-1', reason: 'Guest return', tillId: 'desk-a', expectedRevision: 1,
    expectedCorrectionRevision: 0, ...fields,
  };
}
export function destination(row: { returnId: Id<'orderReturns'>; operatorRevision: number }, tillId = 'desk-a', destinationKey = 'external:1') {
  return { returnId: row.returnId, operatorRevision: row.operatorRevision, tillId, destinationKey };
}

export const give = (...args: Parameters<typeof destination>) => ({ ...destination(...args), outcome: 'given' as const });

export async function soldProduct(ctx: MutationCtx, amount = 100, handover = false) {
  const orderId = await receipt(ctx, amount);
  const goods = await product(ctx, await catalog(ctx), orderId, amount, handover);
  await payment(ctx, orderId, { amount, method: 'card' });
  const part = { kind: 'line', lineId: goods.lineId, units: 1, disposition: 'sellable' } as const;
  return { orderId, ...goods, args: selection(orderId, [part]) };
}


export async function maximumPackages(ctx: MutationCtx, allVoucher: boolean) {
  const orderId = await receipt(ctx, allVoucher ? 2000 : 4000, 100);
  const branchId = await seedTestBranch(ctx);
  const ownerId = await ctx.db.insert('customers', { name: 'Customer', createdAt: now, updatedAt: now, createdBy: 'cashier' });
  const packageId = await ctx.db.insert('packages', { name: 'Package', status: 'active', sort: 0, revision: 0 });
  const packageVersionId = await ctx.db.insert('packageVersions', {
    packageId, version: 1, name: 'Package', price: 100, validityDays: 180, allowTransfer: false, contents: [], estimatedSplit: [],
  });
  const serviceIds = await Promise.all(Array.from({ length: 10 }, (_, index) => ctx.db.insert('services', {
    slug: `return-service-${index}`, name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
    price: 100, currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
  })));
  const parts: ReturnPart[] = [];
  const grants: Id<'sessionGrants'>[] = [];
  const issued: Id<'vouchers'>[] = [];
  const funding: Id<'vouchers'>[] = [];
  for (let index = 0; index < 20; index++) {
    const price = allVoucher ? 100 : 200;
    const lineId = await line(ctx, orderId, 'package', price, { packageVersionId });
    const grantId = await ctx.db.insert('sessionGrants', {
      ownerId, orderId, lineId, contentKey: 'sessions', packageVersionId, branchId, total: 5, used: 0, paidUnits: 5,
      goodwillUnits: 1, returnedUnits: 0, paidShare: 100, expiresAt: now + day, issuedTerms: { expiresAt: now + day, serviceIds, allowTransfer: false },
      settingsRevision: revision, terms, grantServiceIds: [], revision: 1,
    });
    const grantServiceIds = await Promise.all(serviceIds.map(serviceId => ctx.db.insert('grantServices', {
      grantId, ownerId, serviceId, branchId, usable: true, expiresAt: now + day,
    })));
    await ctx.db.patch(grantId, { grantServiceIds });
    const slots: Snapshot['contents'] = [{
      contentKey: 'sessions', label: 'Massage', units: 5, grantId, vatProfile: 'standard', ...allocation(100),
    }];
    if (!allVoucher) {
      const voucherId = await voucher(ctx, { kind: 'package', orderId, lineId, contentKey: 'gift', packageVersionId }, branchId, 50, {
        faceValue: 100, status: 'expired', effectiveExpiresAt: now - day, packageUnusedPaid: 50,
      });
      slots.push({ contentKey: 'gift', label: 'Gift', units: 1, voucherId, vatProfile: 'exempt', ...allocation(100) });
      issued.push(voucherId);
    }
    await ctx.db.patch(lineId, { saleSnapshot: snapshot('Package', price, slots) });
    parts.push({ kind: 'cancelPackage', lineId });
    grants.push(grantId);
  }
  for (let index = 0; index < 80; index++) await line(ctx, orderId, 'service', 0, { saleSnapshot: snapshot('Other', 0) });
  if (allVoucher) {
    const lineId = parts[0].lineId;
    for (let index = 0; index < 2; index++) {
      const id = await voucher(ctx, { kind: 'sale', orderId, lineId }, branchId, 0, {
        faceValue: 1000, status: index ? 'disabled' : 'expired', effectiveExpiresAt: now - day,
      });
      await payment(ctx, orderId, { amount: 1000, method: 'voucher', voucherId: id });
      funding.push(id);
    }
    for (const part of parts) {
      const row = (await ctx.db.get(part.lineId))!;
      const saleSnapshot = row.saleSnapshot!;
      const tenderCells = funding.map(voucherId => ({ kind: 'voucher' as const, voucherId, amount: 50 }));
      await ctx.db.patch(part.lineId, { saleSnapshot: {
        ...saleSnapshot, tenderCells, contents: saleSnapshot.contents.map(content => ({ ...content, tenderCells })),
      } });
    }
  } else await payment(ctx, orderId, { amount: 4000, method: 'card' });
  return { orderId, args: selection(orderId, parts), grants, issued, funding };
}

/** `reads`: edge meter (+1 headroom). `native`: documents the deployment counts (gets, patches, query rows). */
export async function measured<T>(label: string, limits: { reads?: number; native?: number; writes: number }, run: () => Promise<T>) {
  const native = vi.spyOn(TransactionMetricsTracker.prototype, 'trackRead');
  const reads = vi.spyOn(budgets.ReadBudget.prototype, 'document');
  const ranges = vi.spyOn(budgets.ReadBudget.prototype, 'range');
  const writes = vi.spyOn(budgets, 'reserveWrites');
  const started = performance.now();
  try {
    const result = await run();
    const count = writes.mock.calls.reduce((sum, [, amount]) => sum + amount, 0);
    console.info(`${label}: ${native.mock.calls.length} native reads, ${reads.mock.calls.length} metered reads, ${ranges.mock.calls.length} ranges, ${count} reserved writes, ${Math.round(performance.now() - started)} ms`);
    if (limits.reads) expect(reads.mock.calls.length + 1).toBeLessThanOrEqual(limits.reads);
    if (limits.native) expect(native.mock.calls.length).toBeLessThanOrEqual(limits.native);
    expect(count).toBeLessThanOrEqual(limits.writes);
    expect(count).toBeGreaterThan(0);
    return result;
  } finally {
    native.mockRestore();
    reads.mockRestore();
    ranges.mockRestore();
    writes.mockRestore();
  }
}
