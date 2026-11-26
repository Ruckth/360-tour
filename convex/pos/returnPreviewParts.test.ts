// @vitest-environment edge-runtime
import { asTestOwner, seedTestBranch } from '../testing/staff.test-support';
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { resolveCommerceSettings } from '../commerce/model';
import { ReadBudget } from '../lib/readBudget';
import schema from '../schema';
import { termsOf } from './private/paymentCommerce';

const modules = import.meta.glob('/convex/**/*.ts');
const now = Date.parse('2026-11-19T03:00:00Z');
const expiresAt = now + 86400000;
const { revision } = resolveCommerceSettings(null);
const terms = termsOf(resolveCommerceSettings(null));
type Snapshot = NonNullable<Doc<'orderLines'>['saleSnapshot']>;

afterEach(() => {
  vi.restoreAllMocks();
});

function allocation(paidShare: number): Pick<Snapshot, 'paidShare' | 'vatBase' | 'returnedAmount' | 'returnedUnits' | 'tenderCells'> {
  return { paidShare, vatBase: paidShare, returnedAmount: 0, returnedUnits: 0, tenderCells: [{ kind: 'external', amount: paidShare }] };
}

it.each([[50000, 479300], [20000, 449300]])(
  'quotes each Gold Wellness part with %s satang left on the issued voucher',
  async (paidBalance, total) => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const t = convexTest(schema, modules);
    const owner = await asTestOwner(t, { tokenIdentifier: 'owner', email: 'owner@example.com', emailVerified: true });
    const { orderId, lineId } = await t.run(async ctx => {
      const orderId = await ctx.db.insert('orders', {
        orderNumber: 1, receiptNumber: 100, currency: 'THB', status: 'paid', itemCount: 1, hasItems: true,
        total: 690000, due: 0, revision: 1, paidAt: now, createdBy: 'owner', createdAt: now, updatedAt: now, vatVersion: 2,
      });
      const branchId = await seedTestBranch(ctx);
      const ownerId = await ctx.db.insert('customers', { name: 'Guest', createdAt: now, updatedAt: now, createdBy: 'owner' });
      const categoryId = await ctx.db.insert('productCategories', { name: 'Gifts', sort: 0 });
      const productId = await ctx.db.insert('products', {
        categoryId, name: 'Robe', status: 'active', vatProfile: 'standard', options: [],
        minPrice: 129000, maxPrice: 129000, variantCount: 1, sort: 0, revision: 0,
      });
      const variantId = await ctx.db.insert('productVariants', { productId, optionValueIds: [], label: 'Gold robe', price: 129000, status: 'active', revision: 0 });
      const stockMovementId = await ctx.db.insert('stockMovements', {
        branchId, variantId, delta: -1, before: 3, after: 2, kind: 'sale', sourceKey: 'gold-robe', actor: 'owner', createdAt: now,
      });
      await ctx.db.insert('stockLevels', { branchId, productId, variantId, onHand: 2, revision: 1 });
      const packageId = await ctx.db.insert('packages', { name: 'Gold Wellness', status: 'active', sort: 0, revision: 0 });
      const packageVersionId = await ctx.db.insert('packageVersions', {
        packageId, version: 1, name: 'Gold Wellness', price: 690000, validityDays: 180, allowTransfer: true, contents: [], estimatedSplit: [],
      });
      const lineId = await ctx.db.insert('orderLines', {
        orderId, kind: 'package', name: 'Gold Wellness', currency: 'THB', qty: 1, unitPrice: 690000, catalogUnitPrice: 690000,
        packageVersionId, createdAt: now,
      });
      const grantId = await ctx.db.insert('sessionGrants', {
        ownerId, orderId, lineId, contentKey: 'massage', packageVersionId, branchId, total: 5, used: 2, paidUnits: 3,
        goodwillUnits: 1, returnedUnits: 0, paidShare: 526749, expiresAt, issuedTerms: { expiresAt, serviceIds: [], allowTransfer: true },
        settingsRevision: revision, terms, grantServiceIds: [], revision: 3,
      });
      const voucherId = await ctx.db.insert('vouchers', {
        source: { kind: 'package', orderId, lineId, contentKey: 'gift', packageVersionId }, branchId, faceValue: 50000,
        paidBalance, goodwillBalance: 0, issuedExpiresAt: expiresAt, effectiveExpiresAt: expiresAt, status: 'active',
        revision: Number(paidBalance < 50000), settingsRevision: revision, terms,
      });
      await ctx.db.patch(lineId, { saleSnapshot: {
        label: 'Gold Wellness', settingsRevision: revision, terms, ...allocation(690000), vatBase: 640000,
        chosenVariants: [{ contentKey: 'robe', variantId }], goodwillDiscounts: [],
        contents: [
          { contentKey: 'massage', label: 'Massage sessions', units: 5, grantId, vatProfile: 'standard', ...allocation(526749) },
          { contentKey: 'robe', label: 'Robe', units: 1, stockMovementId, vatProfile: 'standard', ...allocation(113251) },
          { contentKey: 'gift', label: 'Voucher value', units: 1, voucherId, vatProfile: 'exempt', ...allocation(50000), vatBase: 0 },
        ],
      } });
      await ctx.db.insert('orderPayments', { orderId, method: 'card', amount: 690000, createdAt: now, createdBy: 'owner', idempotencyKey: 'gold-payment' });
      return { orderId, lineId };
    });
    const reads = vi.spyOn(ReadBudget.prototype, 'document');
    const quote = await owner.query(api.pos.commands.returnItems.preview, {
      orderId, expectedRevision: 1, expectedCorrectionRevision: 0, clientKey: 'gold-return', tillId: 'desk', reason: 'Guest request',
      parts: [{ kind: 'cancelPackage', lineId }, { kind: 'content', lineId, contentKey: 'robe', disposition: 'sellable', units: 1 }],
    });
    expect(quote).toMatchObject({
      amount: total, external: { method: 'card', amount: total },
      rows: [{ lineId, label: 'Gold Wellness', amount: total, parts: [
        { kind: 'session', contentKey: 'massage', label: 'Massage sessions', amount: 316049 },
        { kind: 'product', contentKey: 'robe', label: 'Robe', disposition: 'sellable', amount: 113251 },
        { kind: 'voucher', contentKey: 'gift', label: 'Voucher value', amount: paidBalance },
      ] }],
    });
    expect(reads.mock.calls.length).toBeLessThanOrEqual(440);
    expect(await owner.query(api.pos.orders.getOrder, { orderId })).toMatchObject({ commerce: { issuedBenefits: [
      { contentKey: 'massage', issuedExpiresAt: expiresAt, unusedPaidSessions: 3 },
      { contentKey: 'gift', issuedExpiresAt: expiresAt },
    ] } });
    expect(await t.run(ctx => ctx.db.query('orderReturns').first())).toBeNull();
  },
);
