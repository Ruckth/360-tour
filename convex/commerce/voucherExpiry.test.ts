// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { omit } from 'convex-helpers';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { ReadBudget } from '../lib/readBudget';
import schema from '../schema';
import { benefitExpiresAt, DEFAULT_COMMERCE_SETTINGS } from '../shared/commerce/settings';
import { resolveCommerceSettings } from './model';

const modules = import.meta.glob('/convex/**/*.ts');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('issues an unlimited voucher with frozen null terms and skips it in the nightly expiry range', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const soldAt = Date.parse('2026-11-19T03:00:00Z');
  const finiteExpiry = benefitExpiresAt(soldAt, 'voucher', DEFAULT_COMMERCE_SETTINGS, 1)!;
  const effectiveExpiry = finiteExpiry + 86400000;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(finiteExpiry);
  const t = convexTest(schema, modules);
  const { orderId, unlimited, finite } = await t.run(async ctx => {
    const settings = resolveCommerceSettings(null);
    const { revision } = settings;
    const terms = omit(settings, ['revision', 'saleSwitches', 'paymentsMode', 'cutover']);
    const branchId = await ctx.db.insert('branches', { key: 'main' });
    const orderId = await ctx.db.insert('orders', {
      orderNumber: 1, receiptNumber: 1, status: 'paid', currency: 'THB', total: 50000, due: 0, hasItems: true,
      revision: 1, itemCount: 1, paidAt: soldAt, createdAt: soldAt, updatedAt: soldAt, createdBy: 'owner',
    });
    const lineId = await ctx.db.insert('orderLines', {
      orderId, kind: 'voucher', name: 'Gift voucher', qty: 1, unitPrice: 50000, catalogUnitPrice: 50000, currency: 'THB', createdAt: soldAt,
    });
    const frozen = { ...terms, voucherValidityDays: null };
    const issuedExpiresAt = benefitExpiresAt(soldAt, 'voucher', frozen);
    const base = {
      faceValue: 50000, paidBalance: 50000, goodwillBalance: 1000, status: 'active' as const, branchId,
      source: { kind: 'sale' as const, orderId, lineId }, revision: 0, settingsRevision: revision,
    };
    const unlimited = await ctx.db.insert('vouchers', { ...base, terms: frozen, issuedExpiresAt, effectiveExpiresAt: issuedExpiresAt });
    const finite = await ctx.db.insert('vouchers', { ...base, terms, issuedExpiresAt: finiteExpiry, effectiveExpiresAt: effectiveExpiry });
    const allocation = { paidShare: 50000, vatBase: 0, tenderCells: [], returnedUnits: 0, returnedAmount: 0 };
    await ctx.db.patch(lineId, { saleSnapshot: {
      ...allocation, label: 'Unlimited voucher', settingsRevision: revision, terms: frozen, goodwillDiscounts: [], chosenVariants: [],
      contents: [{ ...allocation, contentKey: 'voucher', label: 'Gift voucher', units: 1, vatProfile: 'exempt', voucherId: unlimited }],
    } });
    return { orderId, unlimited, finite };
  });
  const owner = t.withIdentity({ emailVerified: true, email: 'owner@example.com', tokenIdentifier: 'owner' });
  expect(await owner.query(api.pos.orders.getOrder, { orderId })).toMatchObject({
    commerce: { unlimitedIssuedBenefits: [{ issuedExpiresAt: null, editHistory: { targetType: 'voucher', targetId: unlimited } }] },
    lines: [{ saleSnapshot: { terms: { voucherValidityDays: null } } }],
  });

  const reads = vi.spyOn(ReadBudget.prototype, 'document');
  const expire = () => t.mutation(internal.commerce.voucherExpiry.expireVouchers, {});
  await expire();
  expect(reads).not.toHaveBeenCalled(); // The issued cutoff is past, but the effective one controls expiry.
  clock.mockReturnValue(effectiveExpiry);
  await expire();
  expect(reads.mock.calls.map(([doc]) => doc)).toEqual([expect.objectContaining({ _id: finite }), expect.objectContaining({ _id: orderId })]);
  await expire();
  expect(reads).toHaveBeenCalledTimes(2);
  const state = await t.run(async ctx => ({
    unlimited: await ctx.db.get(unlimited), finite: await ctx.db.get(finite), order: await ctx.db.get(orderId),
    entries: await ctx.db.query('voucherEntries').take(2),
  }));
  expect(state.unlimited).toMatchObject({ status: 'active', issuedExpiresAt: null, effectiveExpiresAt: null, terms: { voucherValidityDays: null }, revision: 0 });
  expect(state.finite).toMatchObject({ status: 'expired', issuedExpiresAt: finiteExpiry, effectiveExpiresAt: effectiveExpiry, paidBalance: 0, goodwillBalance: 0, revision: 1 });
  expect(state.entries).toMatchObject([{ voucherId: finite, kind: 'expire', before: { paid: 50000, goodwill: 1000 }, after: { paid: 0, goodwill: 0 } }]);
  expect(state.order).toMatchObject({ revision: 1, commerceRevision: 1 });
});
