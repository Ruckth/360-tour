// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { omit } from 'convex-helpers';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import { benefitExpiresAt } from '../shared/commerce/settings';
import { resolveCommerceSettings } from './model';

const modules = import.meta.glob('/convex/**/*.ts');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('issues an unlimited voucher with frozen null terms and projects it with its own History target and mask', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const soldAt = Date.parse('2026-11-19T03:00:00Z');
  const t = convexTest(schema, modules);
  const { orderId, unlimited } = await t.run(async ctx => {
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
    const activeCodeId = await ctx.db.insert('voucherCodes', { voucherId: unlimited, code: 'GV-7K2M-U500', mask: 'GV-••••-U500', status: 'active' });
    await ctx.db.patch(unlimited, { activeCodeId });
    const allocation = { paidShare: 50000, vatBase: 0, tenderCells: [], returnedUnits: 0, returnedAmount: 0 };
    await ctx.db.patch(lineId, { saleSnapshot: {
      ...allocation, label: 'Unlimited voucher', settingsRevision: revision, terms: frozen, goodwillDiscounts: [], chosenVariants: [],
      contents: [{ ...allocation, contentKey: 'voucher', label: 'Gift voucher', units: 1, vatProfile: 'exempt', voucherId: unlimited }],
    } });
    return { orderId, unlimited };
  });
  const owner = t.withIdentity({ emailVerified: true, email: 'owner@example.com', tokenIdentifier: 'owner' });
  expect(await owner.query(api.pos.orders.getOrder, { orderId })).toMatchObject({
    commerce: { unlimitedIssuedBenefits: [{ issuedExpiresAt: null, codeMask: 'GV-••••-U500', editHistory: { targetType: 'voucher', targetId: unlimited } }] },
    lines: [{ saleSnapshot: { terms: { voucherValidityDays: null } } }],
  });
});
