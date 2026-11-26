// @vitest-environment edge-runtime
import { seedTestBranch, asTestOwner } from '../testing/staff.test-support';
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { resolveCommerceSettings } from './model';

const modules = import.meta.glob('/convex/**/*.ts');
const now = Date.parse('2026-11-19T04:00:00Z');
const DAY = 86_400_000;
const firstPage = { numItems: 20, cursor: null };
const { saleSwitches, paymentsMode, revision, ...terms } = resolveCommerceSettings(null);
const PRIVATE = 'Private note and code GV-ABCD-WXYZ';

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, { email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'owner' });
  const as = (who: string) => who === 'owner' ? owner : t.withIdentity({ email: `${who}@example.com`, emailVerified: true, tokenIdentifier: who });
  const ids = await t.run(async ctx => {
    for (const role of ['cashier', 'manager'] as const) {
      await ctx.db.insert('staffGrants', { branchIds: [await seedTestBranch(ctx)], role, email: `${role}@example.com`, tokenIdentifier: role, createdAt: now, updatedAt: now, updatedByEmail: 'owner@example.com' });
    }
    const order = (orderNumber: number, paidAt: number) => ctx.db.insert('orders', {
      orderNumber, receiptNumber: orderNumber, status: 'paid', paidAt, itemCount: 1, hasItems: true,
      currency: 'THB', total: 60000, due: 0, revision: 1, createdBy: 'cashier', createdAt: paidAt, updatedAt: paidAt,
    });
    const today = await order(1, now);
    const yesterday = await order(2, now - DAY);
    const lineId = await ctx.db.insert('orderLines', {
      orderId: today, kind: 'voucher', name: 'Gift voucher', qty: 1, unitPrice: 60000, catalogUnitPrice: 60000, currency: 'THB', createdAt: now,
    });
    const branchId = await seedTestBranch(ctx);
    const voucherId = await ctx.db.insert('vouchers', {
      faceValue: 60000, paidBalance: 40000, goodwillBalance: 10000, status: 'active', branchId,
      source: { kind: 'sale', orderId: today, lineId }, issuedExpiresAt: now + DAY, effectiveExpiresAt: now + DAY,
      revision: 3, settingsRevision: 0, terms,
    });
    const entry = (createdAt: number, kind: 'issue' | 'spend' | 'edit', before: number, after: number, goodwill = [0, 0]) =>
      ctx.db.insert('voucherEntries', {
        voucherId, kind, sourceKey: `entry-${createdAt}`, createdAt, actor: 'ploy@example.com', guestFact: PRIVATE,
        before: { paid: before, goodwill: goodwill[0] }, after: { paid: after, goodwill: goodwill[1] },
      });
    await entry(1, 'issue', 0, 60000);
    await entry(2, 'spend', 60000, 40000);
    await entry(3, 'edit', 40000, 40000, [0, 10000]);
    const settingsId = await ctx.db.insert('commerceSettings', { ...terms, key: 'default', revision, paymentsMode, saleSwitches });
    const log = { before: {}, after: {}, paidLiabilityDelta: 0, goodwillFaceValueDelta: 0, quantityDelta: 0, actor: 'owner',
      actorLabel: 'Owner', requesterKey: 'owner', fingerprint: 'f', recordedAt: now, businessDate: '2026-11-19' };
    await ctx.db.insert('commerceAdjustments', { ...log, targetType: 'settings', targetId: settingsId, kind: 'updateSettings',
      before: { voucherValidityDays: 365 }, after: { voucherValidityDays: null },
      revisionBefore: 0, revisionAfter: 1, clientKey: 'settings', reasonCode: 'priceChange', reasonText: 'New season' });
    for (const orderId of [today, yesterday]) {
      await ctx.db.insert('commerceAdjustments', { ...log, targetType: 'order', targetId: orderId, kind: 'amendPayment',
        revisionBefore: 0, revisionAfter: 1, clientKey: `order-${orderId}`, reasonCode: 'staffMistake' });
    }
    return { voucherId, settingsId, today, yesterday, branchId, lineId };
  });
  return { t, as, ...ids };
}

it('pages a voucher History for staff with facts, balances and who, newest first', async () => {
  const { as, voucherId } = await setup();
  const page = await as('cashier').query(api.commerce.history.staffPage, { target: { targetType: 'voucher', targetId: voucherId }, paginationOpts: firstPage });
  expect(page.isDone).toBe(true);
  expect(page.page.map(entry => entry.fact)).toEqual([
    { key: 'goodwillAdded' }, { key: 'spent', args: { amount: 20000 } }, { key: 'issued', args: { amount: 60000 } },
  ]);
  expect(page.page[1]).toMatchObject({
    at: 2, balance: { unit: 'money', before: { paid: 60000, goodwill: 0 }, after: { paid: 40000, goodwill: 0 } },
    staff: { actorName: 'ploy@example.com', reason: null, reasonText: null },
  });
  // Free-text ledger facts may hold notes or a full code; History never shows them.
  expect(JSON.stringify(page)).not.toContain('GV-ABCD');
});

it('shapes Show guest on the server: dated facts and balances, no staff or notes', async () => {
  const { as, voucherId } = await setup();
  const page = await as('cashier').query(api.commerce.history.guestPage, { target: { targetType: 'voucher', targetId: voucherId }, paginationOpts: { numItems: 2, cursor: null } });
  expect(page.page).toEqual([
    { entryId: expect.any(String), at: 3, fact: { key: 'goodwillAdded' }, balance: { unit: 'money', before: { paid: 40000, goodwill: 0 }, after: { paid: 40000, goodwill: 10000 } } },
    { entryId: expect.any(String), at: 2, fact: { key: 'spent', args: { amount: 20000 } }, balance: { unit: 'money', before: { paid: 60000, goodwill: 0 }, after: { paid: 40000, goodwill: 0 } } },
  ]);
  expect(page.isDone).toBe(false);
  expect(JSON.stringify(page)).not.toMatch(/ploy|Private|GV-ABCD/);
  const rest = await as('cashier').query(api.commerce.history.guestPage, { target: { targetType: 'voucher', targetId: voucherId }, paginationOpts: { numItems: 2, cursor: page.continueCursor } });
  expect(rest.page.map(entry => entry.at)).toEqual([1]);
});

it('opens a receipt or settings History only for staff who may see it', async () => {
  const { as, settingsId, today, yesterday } = await setup();
  const history = (who: string, target: { targetType: 'order'; targetId: Id<'orders'> } | { targetType: 'settings'; targetId: Id<'commerceSettings'> }) =>
    as(who).query(api.commerce.history.staffPage, { target, paginationOpts: firstPage });
  const settings = { targetType: 'settings' as const, targetId: settingsId };
  expect((await history('cashier', settings)).page).toEqual([]);
  // Managers read Checkout rules and its History; only the owner changes them.
  expect((await history('manager', settings)).page).toHaveLength(1);
  expect((await history('owner', settings)).page).toEqual([{
    entryId: expect.any(String), at: now, fact: { key: 'rulesChanged' }, balance: null,
    before: { voucherValidityDays: 365 }, after: { voucherValidityDays: null },
    staff: { actorName: 'Owner', reason: 'priceChange', reasonText: 'New season' },
    changes: [{ field: 'voucherValidityDays', before: 365, after: null }],
  }]);
  // A cashier opens today's receipts only, as today.
  expect((await history('cashier', { targetType: 'order', targetId: today })).page).toHaveLength(1);
  expect((await history('cashier', { targetType: 'order', targetId: yesterday })).page).toEqual([]);
  expect((await history('manager', { targetType: 'order', targetId: yesterday })).page).toHaveLength(1);
  await expect(as('stranger').query(api.commerce.history.staffPage, { target: settings, paginationOpts: firstPage })).rejects.toThrow('Not authorized');
});

it('refuses a page over 20 rows', async () => {
  const { as, voucherId } = await setup();
  await expect(as('manager').query(api.commerce.history.staffPage, { target: { targetType: 'voucher', targetId: voucherId }, paginationOpts: { numItems: 21, cursor: null } }))
    .rejects.toMatchObject({ data: { code: 'INVALID_PAGE_SIZE' } });
});

it('passes a stored guest fact through and opens a voucher transfer as the new owner\'s first line', async () => {
  const { t, as, voucherId } = await setup();
  await t.run(async ctx => {
    await ctx.db.insert('voucherEntries', {
      voucherId, kind: 'transfer', sourceKey: 'guest-transfer:x', createdAt: 4, actor: 'ploy@example.com',
      guestFact: { key: 'transferredIn' }, before: { paid: 40000, goodwill: 10000 }, after: { paid: 40000, goodwill: 10000 },
    });
    await ctx.db.insert('voucherEntries', {
      voucherId, kind: 'spend', sourceKey: 'entry-5', createdAt: 5, actor: 'ploy@example.com',
      guestFact: { key: 'spent', args: { amount: 5000 } }, before: { paid: 40000, goodwill: 10000 }, after: { paid: 35000, goodwill: 10000 },
    });
  });
  const page = await as('cashier').query(api.commerce.history.staffPage, { target: { targetType: 'voucher', targetId: voucherId }, paginationOpts: { numItems: 2, cursor: null } });
  expect(page.page.map(entry => entry.fact)).toEqual([{ key: 'spent', args: { amount: 5000 } }, { key: 'transferredIn' }]);
});

it('masks full voucher codes in renamed facts and rejects unknown keys, types and extra guest arguments at write', async () => {
  const { t, as, voucherId } = await setup();
  const row = {
    voucherId, kind: 'edit' as const, sourceKey: 'rename', createdAt: 4, actor: 'Private staff',
    reasonCode: 'other', reasonText: 'Private notes', before: { paid: 40000, goodwill: 10000 }, after: { paid: 40000, goodwill: 10000 },
  };
  await t.run(ctx => ctx.db.insert('voucherEntries', { ...row, guestFact: { key: 'renamed', args: { name: 'GV-ABCD-WXYZ and giftGV1234Q9XD' } } }));
  for (const guestFact of [
    { key: 'privateNote' }, { key: 'renamed', args: { name: 1234 } }, { key: 'renamed', args: { name: 'Guest', note: PRIVATE } },
  ]) {
    await expect(t.run(ctx => ctx.db.insert('voucherEntries', {
      ...row, sourceKey: 'invalid-fact',
      // @ts-expect-error Test that persisted writes enforce the same fact contract as TypeScript.
      guestFact,
    }))).rejects.toThrow(/validator|validation/i);
  }
  const args = { target: { targetType: 'voucher' as const, targetId: voucherId }, paginationOpts: { numItems: 1, cursor: null } };
  const guest = await as('cashier').query(api.commerce.history.guestPage, args);
  expect(guest.page[0].fact).toEqual({ key: 'renamed', args: { name: 'GV-••••-WXYZ and giftGV-••••-Q9XD' } });
  expect(JSON.stringify(guest)).not.toMatch(/GV-ABCD-WXYZ|GV1234Q9XD|Private|reason/);
  expect((await as('cashier').query(api.commerce.history.staffPage, args)).page[0].staff).toEqual({
    actorName: 'Private staff', reason: 'other', reasonText: 'Private notes',
  });
});

it('gives staff a voucher rename with the old and new name from its own ledger row, never the guest', async () => {
  const { t, as, voucherId, today } = await setup();
  await t.run(async ctx => {
    const log = { paidLiabilityDelta: 0, goodwillFaceValueDelta: 0, quantityDelta: 0, actor: 'cashier', actorLabel: 'Ploy',
      requesterKey: 'cashier', fingerprint: 'f', recordedAt: now, businessDate: '2026-11-19', revisionBefore: 3, revisionAfter: 4 };
    // History reads the voucher's own stream only (D19): an adjustment link alone lends it no fields.
    const foreign = await ctx.db.insert('commerceAdjustments', { ...log, targetType: 'order', targetId: today, kind: 'amendPayment',
      before: { note: 'Private' }, after: { note: 'Other' }, clientKey: 'foreign', reasonCode: 'staffMistake' });
    const row = { voucherId, kind: 'edit' as const, createdAt: 4, actor: 'Ploy', before: { paid: 40000, goodwill: 10000 }, after: { paid: 40000, goodwill: 10000 } };
    await ctx.db.insert('voucherEntries', { ...row, sourceKey: 'rename', guestFact: { key: 'renamed', args: { name: 'Mia Tanaka' } },
      changes: { before: { name: 'Mia Tanka' }, after: { name: 'Mia Tanaka' } } });
    await ctx.db.insert('voucherEntries', { ...row, createdAt: 5, sourceKey: 'foreign', adjustmentId: foreign, guestFact: { key: 'updated' } });
  });
  const args = { target: { targetType: 'voucher' as const, targetId: voucherId }, paginationOpts: { numItems: 2, cursor: null } };
  const staff = await as('cashier').query(api.commerce.history.staffPage, args);
  expect(staff.page[1]).toMatchObject({ fact: { key: 'renamed', args: { name: 'Mia Tanaka' } }, before: { name: 'Mia Tanka' }, after: { name: 'Mia Tanaka' } });
  expect(staff.page[0]).not.toHaveProperty('before');
  expect(JSON.stringify(staff)).not.toContain('Private');
  const guest = await as('cashier').query(api.commerce.history.guestPage, args);
  expect(JSON.stringify(guest)).not.toMatch(/Mia Tanka|Private|Ploy/);
});

it('keeps grant ledger reasons and safely displays structured and older text facts', async () => {
  const { t, as, branchId, today: orderId, lineId } = await setup();
  const grantId = await t.run(async ctx => {
    const ownerId = await ctx.db.insert('customers', { name: 'Guest', createdAt: now, updatedAt: now, createdBy: 'manager' });
    const packageId = await ctx.db.insert('packages', { name: 'Spa', status: 'active', sort: 0, revision: 0 });
    const packageVersionId = await ctx.db.insert('packageVersions', {
      packageId, version: 1, name: 'Spa', price: 60000, validityDays: 180, allowTransfer: true, contents: [], estimatedSplit: [],
    });
    const grantId = await ctx.db.insert('sessionGrants', {
      ownerId, packageVersionId, branchId, orderId, lineId, contentKey: 'massage', total: 2, used: 1, paidUnits: 1, goodwillUnits: 0,
      paidShare: 60000, returnedUnits: 0, expiresAt: now + DAY, issuedTerms: { expiresAt: now + DAY, serviceIds: [], allowTransfer: true },
      settingsRevision: revision, terms, revision: 1, grantServiceIds: [],
    });
    const ledger = { grantId, actor: 'Private staff', reasonCode: 'other', reasonText: 'Private notes' };
    const atIssue = { paid: 2, goodwill: 0 };
    await ctx.db.insert('sessionUses', {
      ...ledger, kind: 'issue', sourceKey: 'issued', createdAt: 1, guestFact: PRIVATE, before: { paid: 0, goodwill: 0 }, after: atIssue,
    });
    await ctx.db.insert('sessionUses', {
      ...ledger, kind: 'use', sourceKey: 'used', createdAt: 2, guestFact: { key: 'used', args: { service: 'Massage' } },
      before: atIssue, after: { paid: 1, goodwill: 0 },
    });
    return grantId;
  });
  const args = { target: { targetType: 'grant' as const, targetId: grantId }, paginationOpts: firstPage };
  const staff = await as('cashier').query(api.commerce.history.staffPage, args);
  expect(staff.page).toMatchObject([
    { fact: { key: 'used', args: { service: 'Massage' } }, staff: { reason: 'other', reasonText: 'Private notes' } },
    { fact: { key: 'updated' }, staff: { reason: 'other', reasonText: 'Private notes' } },
  ]);
  const guest = await as('cashier').query(api.commerce.history.guestPage, args);
  expect(guest.page.map(row => row.fact)).toEqual([{ key: 'used', args: { service: 'Massage' } }, { key: 'updated' }]);
  expect(JSON.stringify(guest)).not.toMatch(/Private|reason|staff/);
});

it.each(['staffPage', 'guestPage'] as const)('preserves Convex split metadata and page bounds for %s', async endpoint => {
  const { as, voucherId, t } = await setup();
  await t.run(async ctx => {
    for (const createdAt of [4, 5]) {
      await ctx.db.insert('voucherEntries', {
        voucherId, kind: 'edit', sourceKey: `split-${createdAt}`, createdAt, actor: 'manager',
        guestFact: { key: 'updated' }, before: { paid: 40000, goodwill: 10000 }, after: { paid: 40000, goodwill: 10000 },
      });
    }
  });
  const query = (paginationOpts: { numItems: number; cursor: string | null; endCursor?: string }) =>
    as('cashier').query(api.commerce.history[endpoint], { target: { targetType: 'voucher', targetId: voucherId }, paginationOpts });
  const initial = await query({ numItems: 3, cursor: null });
  const range = { numItems: 1, cursor: null, endCursor: initial.continueCursor };
  const split = await query(range);
  expect(split).toMatchObject({ pageStatus: 'SplitRequired', splitCursor: expect.any(String), isDone: false });
  const firstHalf = await query({ ...range, endCursor: split.splitCursor! });
  const secondHalf = await query({ ...range, cursor: split.splitCursor! });
  expect([...firstHalf.page, ...secondHalf.page].map(row => row.at)).toEqual([5, 4, 3]);
  expect(secondHalf.continueCursor).toBe(range.endCursor);
  if (endpoint === 'guestPage') {
    await expect(query({ ...range, endCursor: 'wrong-ownership-period' })).rejects.toMatchObject({
      data: { code: 'STALE_HISTORY_CURSOR' },
    });
  }
});

it('reads one branch\'s stock History through its own index', async () => {
  const { t, as } = await setup();
  const stockId = await t.run(async ctx => {
    const categoryId = await ctx.db.insert('productCategories', { name: 'Clothing', sort: 1 });
    const productId = await ctx.db.insert('products', {
      categoryId, name: 'Robe', status: 'active', vatProfile: 'standard', options: [], minPrice: 129000, maxPrice: 129000, variantCount: 1, sort: 1, revision: 0,
    });
    const variantId = await ctx.db.insert('productVariants', { productId, optionValueIds: [], label: 'M', price: 129000, status: 'active', revision: 0 });
    const [here, there] = [await seedTestBranch(ctx, 'beach'), await seedTestBranch(ctx, 'town')];
    for (const [branchId, createdAt] of [[here, 1], [there, 2], [here, 3]] as const) {
      await ctx.db.insert('stockMovements', { branchId, variantId, delta: -1, before: 3, after: 2, kind: 'sale', sourceKey: `s${createdAt}`, actor: 'ploy', createdAt });
    }
    return ctx.db.insert('stockLevels', { branchId: here, productId, variantId, onHand: 2, revision: 1 });
  });
  const page = await as('cashier').query(api.commerce.history.staffPage, { target: { targetType: 'stock', targetId: stockId }, paginationOpts: { numItems: 1, cursor: null } });
  expect(page.page).toMatchObject([{ at: 3, fact: { key: 'sold' }, balance: { unit: 'stock', before: 3, after: 2 } }]);
  const rest = await as('cashier').query(api.commerce.history.staffPage, { target: { targetType: 'stock', targetId: stockId }, paginationOpts: { numItems: 20, cursor: page.continueCursor } });
  expect(rest.page.map(entry => entry.at)).toEqual([1]);
});
