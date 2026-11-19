// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { resolveCommerceSettings } from './commerce/model';
import { ReadBudget } from './lib/readBudget';
import schema from './schema';
import { benefitExpiresAt, DEFAULT_COMMERCE_SETTINGS, freezePackageVatBases, freezeRowVatBase, incrementalShare, splitPackagePrice } from './shared/commerce';
import { sha256 } from './shared/displayTokens';
import { orderTotals } from './shared/orderMath';
import { insertFixture } from './testing/completeFixture.test-support';

const modules = import.meta.glob('./**/*.ts');
const now = Date.parse('2026-11-19T03:00:00Z');
const businessDate = '2026-11-19';
const { revision, saleSwitches, paymentsMode, cutover, ...terms } = resolveCommerceSettings(null);
const rawCode = 'GOLD-X17L-V54Z';
const codeMask = '•••• V54Z';

beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function setup() {
  const t = convexTest(schema, modules);
  const owner = t.withIdentity({ emailVerified: true, email: 'owner@example.com', tokenIdentifier: 'owner' });
  const view = async (orderId: Id<'orders'>) => (await owner.query(api.pos.orders.getOrder, { orderId }))!;
  const display = async (orderId: Id<'orders'>) => {
    const token = 'paired-test-device-with-a-long-token-0001';
    const tokenHash = await sha256(token);
    await t.run(async ctx => {
      const leaseId = 'display-lease';
      const tillId = await ctx.db.insert('tills', { key: 'default', orderId, leaseId });
      await ctx.db.insert('displayDriverLeases', { tillId, leaseId, expiresAt: now + 60_000 });
      await ctx.db.insert('displays', { tillId, name: 'Till screen', status: 'active', tokenHash, createdAt: now });
    });
    return () => t.query(api.pos.displays.current, { token });
  };
  return { t, owner, view, display };
}

function order(ctx: MutationCtx, total: number, fields: Partial<Doc<'orders'>> = {}) {
  return ctx.db.insert('orders', {
    orderNumber: 1, receiptNumber: 100, currency: 'THB', status: 'paid', itemCount: 1, hasItems: true,
    total, due: 0, revision: 1, paidAt: now, createdBy: 'owner', createdAt: now, updatedAt: now, ...fields,
  });
}

function line(ctx: MutationCtx, orderId: Id<'orders'>, kind: Doc<'orderLines'>['kind'], price: number, fields: Partial<Doc<'orderLines'>> = {}) {
  return ctx.db.insert('orderLines', {
    orderId, kind, name: kind, currency: 'THB', qty: 1, unitPrice: price, catalogUnitPrice: price, createdAt: now, ...fields,
  });
}

function allocation(paidShare: number, vatBase: number, returnedAmount = 0) {
  return { paidShare, vatBase, returnedAmount, returnedUnits: returnedAmount ? 1 : 0, tenderCells: [{ kind: 'external' as const, amount: paidShare }] };
}

function snapshot(label: string, paidShare: number, vatBase: number): NonNullable<Doc<'orderLines'>['saleSnapshot']> {
  return {
    label, settingsRevision: revision, terms, ...allocation(paidShare, vatBase),
    chosenVariants: [], contents: [], goodwillDiscounts: [],
  };
}

async function retail(ctx: MutationCtx) {
  const categoryId = await ctx.db.insert('productCategories', { name: 'Gifts', sort: 0 });
  const productId = await ctx.db.insert('products', {
    categoryId, name: 'Robe', status: 'active', vatProfile: 'standard', options: [], minPrice: 129000, maxPrice: 129000, variantCount: 1, sort: 0, revision: 0,
  });
  const variantId = await ctx.db.insert('productVariants', { productId, optionValueIds: [], label: 'Robe · Gold', price: 129000, status: 'active', revision: 0 });
  const branchId = await ctx.db.insert('branches', { key: 'default' });
  return { branchId, productId, variantId };
}

async function issueVoucher(ctx: MutationCtx, source: Doc<'vouchers'>['source'], branchId: Id<'branches'>) {
  const issuedExpiresAt = benefitExpiresAt(now, 'voucher', DEFAULT_COMMERCE_SETTINGS)!;
  const voucherId = await ctx.db.insert('vouchers', {
    faceValue: 50000, paidBalance: 50000, goodwillBalance: 0, issuedExpiresAt, effectiveExpiresAt: issuedExpiresAt,
    status: 'active', branchId, source, revision: 0, settingsRevision: revision, terms,
  });
  const codeId = await ctx.db.insert('voucherCodes', { voucherId, code: rawCode, mask: codeMask, status: 'active' });
  await ctx.db.patch(voucherId, { activeCodeId: codeId });
  return { voucherId, issuedExpiresAt };
}

it('preserves pre-commerce receipt and display VAT with absent or unrecognized VAT versions', async () => {
  const { t, view, display } = setup();
  const orderId = await t.run(async ctx => {
    const orderId = await order(ctx, 60000);
    await line(ctx, orderId, 'service', 60000, { priceOverride: { price: 60000, note: 'Private note', by: 'owner', at: now } });
    return orderId;
  });
  const show = await display(orderId);
  const first = await view(orderId);
  const shown = await show();
  expect(first.totals).toEqual(orderTotals([{ unitPrice: 60000, qty: 1 }]));
  expect(first).not.toHaveProperty('commerce');
  expect(first.paymentRecord).not.toHaveProperty('allTenders');
  expect(shown).toMatchObject({ state: 'paid', total: 60000, vat: 3925, amountPaid: 60000 });
  expect(JSON.stringify(shown)).not.toContain('Private note');
  await t.run(ctx => ctx.db.patch(orderId, { vatVersion: 99 }));
  expect((await view(orderId)).totals).toEqual(first.totals);
  expect(await show()).toEqual(shown);
});

it('reads Gold Wellness at the D1 split and ฿418.69 VAT, with issued terms and masked codes', async () => {
  expect(saleSwitches).toEqual({ products: 'off', vouchers: 'off', sessionPackages: 'off', mixedPackages: 'off' });
  expect(paymentsMode).toBe('direct');
  expect(cutover).toBeUndefined();
  const { t, view, display } = setup();
  const { orderId, draftId, voucherExpiry, grantExpiry, handoverId } = await t.run(async ctx => {
    const { branchId, productId, variantId } = await retail(ctx);
    const orderId = await order(ctx, 690000, { vatVersion: 2, returnedTotal: 113251 });
    const lineId = await line(ctx, orderId, 'package', 690000, { detail: 'Private package note' });
    const packageId = await ctx.db.insert('packages', { name: 'Gold Wellness', status: 'active', sort: 0, revision: 1 });
    const serviceId = await ctx.db.insert('services', {
      slug: 'spa', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0, price: 120000,
      currency: 'THB', staffIds: [], status: 'active', createdAt: now, updatedAt: now,
    });
    const packageVersionId = await ctx.db.insert('packageVersions', {
      packageId, version: 1, name: 'Gold Wellness', price: 690000, validityDays: 180, allowTransfer: true,
      contents: [
        { kind: 'session', contentKey: 'massage', units: 5, serviceIds: [serviceId] },
        { kind: 'chooseProduct', contentKey: 'robe', units: 1, productId },
        { kind: 'voucher', contentKey: 'gift', faceValue: 50000 },
      ],
      estimatedSplit: [{ contentKey: 'massage', amount: 526749 }, { contentKey: 'robe', amount: 113251 }, { contentKey: 'gift', amount: 50000 }],
    });
    const draftId = await order(ctx, 690000, { orderNumber: 2, status: 'draft', due: 690000, paidAt: undefined, receiptNumber: undefined });
    await line(ctx, draftId, 'package', 690000, { name: 'Gold Wellness', packageVersionId });
    const ownerId = await ctx.db.insert('customers', { name: 'Payer', createdBy: 'owner', createdAt: now, updatedAt: now });
    const grantExpiry = benefitExpiresAt(now, 'sessions', DEFAULT_COMMERCE_SETTINGS)!;
    const grantId = await ctx.db.insert('sessionGrants', {
      ownerId, orderId, lineId, contentKey: 'massage', branchId, packageVersionId,
      total: 5, used: 2, paidUnits: 5, goodwillUnits: 0, returnedUnits: 0, paidShare: 526749,
      expiresAt: grantExpiry + 86400000, issuedTerms: { expiresAt: grantExpiry, serviceIds: [], allowTransfer: true },
      settingsRevision: revision, terms, grantServiceIds: [], revision: 1,
    });
    const { voucherId, issuedExpiresAt: voucherExpiry } = await issueVoucher(ctx, { kind: 'package', orderId, lineId, contentKey: 'gift', packageVersionId }, branchId);
    const { shares } = splitPackagePrice({ price: 690000, contents: [
      { contentKey: 'massage', kind: 'sessions', units: 5, serviceUnitPrices: [120000, 150000] },
      { contentKey: 'robe', kind: 'product', quantity: 1, variantUnitPrice: 129000, chooseAtSale: true },
      { contentKey: 'gift', kind: 'voucher', face: 50000 },
    ] }, DEFAULT_COMMERCE_SETTINGS);
    const bases = freezePackageVatBases(shares, DEFAULT_COMMERCE_SETTINGS);
    const counts = { quantity: 1, withGuest: 0, backSellable: 1, backDamaged: 0, unpaid: 0, paid: 1 };
    const movementId = await ctx.db.insert('stockMovements', { branchId, variantId, delta: -1, before: 3, after: 2, kind: 'sale', sourceKey: 'robe', actor: 'owner', createdAt: now });
    const handoverId = await ctx.db.insert('handovers', {
      orderId, lineId, kind: 'recollect', status: 'closed', unitPrice: 113251, ...counts,
      contents: [{ contentKey: 'robe', variantId, originalMovementId: movementId, allocatedPrice: 113251, ...counts }],
      movementIds: [movementId], clientKey: 'recollect-robe', revision: 1,
    });
    await ctx.db.insert('commerceAdjustments', {
      targetType: 'handover', targetId: handoverId, kind: 'takeBack',
      before: { withGuest: 1 }, after: { backSellable: 1 }, revisionBefore: 0, revisionAfter: 1,
      paidLiabilityDelta: 0, goodwillFaceValueDelta: 0, quantityDelta: 1,
      actor: 'owner', actorLabel: 'Manager', requesterKey: 'owner', clientKey: 'take-back',
      fingerprint: 'take-back', recordedAt: now, businessDate, reasonText: 'Private inventory note',
    });
    const { amount: robeReturn } = incrementalShare(shares[1].paidShare, { unitsSold: 1, unitsBefore: 0, unitsThrough: 1 });
    await ctx.db.patch(lineId, { packageVersionId, saleSnapshot: {
      ...snapshot('Gold Wellness', 690000, bases.vatBase), returnedAmount: robeReturn, chosenVariants: [{ contentKey: 'robe', variantId }],
      contents: shares.map((content, i) => ({
        contentKey: content.contentKey, label: content.contentKey, units: content.kind === 'voucher' ? 1 : content.units,
        vatProfile: content.kind === 'voucher' ? 'exempt' as const : 'standard' as const,
        ...allocation(content.paidShare, bases.contents[i].vatBase, content.kind === 'product' ? robeReturn : 0),
        ...(content.kind === 'sessions' ? { grantId } : content.kind === 'voucher' ? { voucherId } : { stockMovementId: movementId }),
      })),
    } });
    await ctx.db.insert('orderPayments', { orderId, method: 'card', amount: 690000, createdAt: now, createdBy: 'owner', idempotencyKey: 'gold-payment' });
    return { orderId, draftId, voucherExpiry, grantExpiry, handoverId };
  });
  expect((await view(draftId)).lines[0].draftPackage).toMatchObject({
    contents: [{ kind: 'session', units: 5 }, { kind: 'chooseProduct', units: 1 }, { kind: 'voucher', faceValue: 50000 }],
    estimatedSplit: [{ amount: 526749 }, { amount: 113251 }, { amount: 50000 }],
  });
  const receipt = await view(orderId);
  expect(receipt.totals).toMatchObject({ total: 690000, vatBase: 640000, vat: 41869 });
  expect(receipt.refundedAmountSatang).toBe(113251);
  expect(receipt.lines[0]).toMatchObject({ kind: 'package', name: 'Gold Wellness', refundedAmountSatang: 113251, remainingRefundableSatang: 0 });
  expect(receipt.lines[0].saleSnapshot?.contents.map(({ paidShare, vatBase, returnedAmount }) => [paidShare, vatBase, returnedAmount]))
    .toEqual([[526749, 526749, 0], [113251, 113251, 113251], [50000, 0, 0]]);
  expect(receipt.commerce).toMatchObject({
    returnedAmountSatang: 113251, editHistory: { targetType: 'order', targetId: orderId },
    issuedBenefits: [{ contentKey: 'massage', issuedExpiresAt: grantExpiry }, { contentKey: 'gift', issuedExpiresAt: voucherExpiry, codeMask }],
    handovers: [{ editHistory: { targetType: 'handover', targetId: handoverId }, contents: [{ contentKey: 'robe', backSellable: 1, paid: 1, unpaid: 0 }] }],
  });
  const show = await display(orderId);
  const shown = await show();
  expect(shown).toMatchObject({ state: 'paid', vat: 41869, voucherCodeMasks: [codeMask] });
  expect(JSON.stringify(shown)).not.toContain(rawCode);
  expect(JSON.stringify(shown)).not.toContain('Private package note');
  expect(JSON.stringify(shown)).not.toContain('Private inventory note');
});

it('keeps corrected external money, voucher paid value and goodwill separate through receipt and display', async () => {
  const { t, view, display } = setup();
  const { orderId, voucherId, attemptId, issueOrder } = await t.run(async ctx => {
    const branchId = await ctx.db.insert('branches', { key: 'default' });
    const issueOrder = await order(ctx, 50000, { vatVersion: 2, orderNumber: 2 });
    const issueLine = await line(ctx, issueOrder, 'voucher', 50000, { detail: rawCode });
    const { voucherId } = await issueVoucher(ctx, { kind: 'sale', orderId: issueOrder, lineId: issueLine }, branchId);
    const issueVat = freezeRowVatBase({ kind: 'voucher', net: 50000 });
    await ctx.db.patch(issueLine, { saleSnapshot: {
      ...snapshot('Gift voucher', 50000, issueVat.vatBase),
      contents: [{ ...allocation(50000, 0), contentKey: 'gift', label: 'Gift voucher', units: 1, vatProfile: 'exempt', voucherId }],
    } });
    const orderId = await order(ctx, 50000, { vatVersion: 2, amendedTenders: [{ method: 'transfer', amount: 30000 }] });
    const appointmentVat = freezeRowVatBase({ kind: 'taxable', net: 60000, goodwillDiscount: 10000 });
    await line(ctx, orderId, 'appointment', 60000, { saleSnapshot: {
      ...snapshot('Aroma massage', 50000, appointmentVat.vatBase),
      goodwillDiscounts: [{ voucherId, amount: 10000 }],
      tenderCells: [{ kind: 'voucher', voucherId, amount: 20000 }, { kind: 'external', amount: 30000 }],
    } });
    const paid = { orderId, createdAt: now, createdBy: 'owner', idempotencyKey: 'spa-payment' };
    await ctx.db.insert('orderPayments', { ...paid, method: 'voucher', voucherId, amount: 20000 });
    await ctx.db.insert('orderPayments', { ...paid, method: 'cash', amount: 30000, received: 40000 });
    const attemptId = await ctx.db.insert('paymentAttempts', {
      orderId, key: 'attempt', fingerprint: 'request fingerprint', status: 'settled',
      reviewedRequest: { revision: 1, due: 50000, customers: [], vouchers: [{ voucherId, paid: 20000, goodwill: 10000 }], businessDate, settingsRevision: 0 },
      legs: [{ key: 'cash', method: 'cash', amount: 30000, state: 'taken', received: 40000, change: 10000 }],
      owner: 'owner', tillId: 'Till 1', ownerRevision: 1, createdAt: now, updatedAt: now,
    });
    await ctx.db.patch(orderId, { activeAttemptId: attemptId });
    return { orderId, voucherId, attemptId, issueOrder };
  });
  const issued = await view(issueOrder);
  expect(issued.lines[0]).toMatchObject({ kind: 'voucher', name: 'Gift voucher', net: 50000 });
  expect(issued.totals).toMatchObject({ total: 50000, vatBase: 0, vat: 0 });
  const receipt = await view(orderId);
  expect(receipt.payments).toMatchObject([{ method: 'cash', amount: 30000, received: 40000 }]);
  expect(receipt.voucherPayments).toMatchObject([{ method: 'voucher', voucherId, amount: 20000, codeMask }]);
  expect(JSON.stringify(receipt.voucherPayments)).not.toContain(rawCode);
  expect(receipt.paymentRecord).toMatchObject({
    tenders: [{ method: 'transfer', amount: 30000 }],
    allTenders: [{ method: 'transfer', amount: 30000 }, { method: 'voucher', voucherId, amount: 20000 }],
  });
  expect(receipt.paymentAttempt).toMatchObject({
    _id: attemptId, status: 'settled', tillId: 'Till 1', due: 50000, legs: [{ state: 'taken', received: 40000, change: 10000 }],
  });
  expect(receipt.paymentAttempt).not.toHaveProperty('fingerprint');
  expect(receipt.lines[0]).toMatchObject({ kind: 'appointment', net: 50000, goodwillDiscount: 10000 });
  expect(receipt.totals).toMatchObject({ total: 50000, goodwillDiscount: 10000, vatBase: 50000, vat: 3271 });
  const show = await display(orderId);
  expect(await show()).toMatchObject({ state: 'paid', total: 50000, amountPaid: 50000, goodwillDiscount: 10000 });
  await t.run(async ctx => {
    const till = (await ctx.db.query('tills').withIndex('by_key', q => q.eq('key', 'default')).unique())!;
    await ctx.db.patch(till._id, { orderId: issueOrder });
    await ctx.db.patch(issueOrder, { status: 'draft' });
  });
  const voucherDraft = await show();
  expect(voucherDraft).toMatchObject({ state: 'order', lines: [{ name: 'Gift voucher', detail: null }], vat: 0 });
  expect(JSON.stringify(voucherDraft)).not.toContain(rawCode);
});

it('uses frozen balances with zero refund ledger reads on a receipt with 900 earlier refunds', async () => {
  const { t, owner, view } = setup();
  const { orderId, lineId } = await t.run(async ctx => {
    const { variantId } = await retail(ctx);
    const orderId = await order(ctx, 60000, { vatVersion: 2, returnedTotal: 900 });
    const lineId = await line(ctx, orderId, 'product', 60000, {
      variantId, saleSnapshot: { ...snapshot('Robe', 60000, 60000), returnedUnits: 1, returnedAmount: 900 },
    });
    for (let i = 0; i < 900; i++) await ctx.db.insert('orderRefunds', {
      orderId, lineId, amount: 1, currency: 'THB', method: 'cash', reason: 'Earlier refund', idempotencyKey: `old-refund-${i}`,
      createdBy: 'owner', createdByEmail: 'owner@example.com', createdAt: now, businessDate,
    });
    return { orderId, lineId };
  });
  const documents = vi.spyOn(ReadBudget.prototype, 'document');
  const ranges = vi.spyOn(ReadBudget.prototype, 'range');
  const receipt = await view(orderId);
  expect(receipt).toMatchObject({ refundedAmountSatang: 900, posRefunds: [], lines: [{ _id: lineId, refundedAmountSatang: 900 }] });
  expect(documents.mock.calls.map(([doc]) => doc)).toEqual([expect.objectContaining({ _id: orderId }), expect.objectContaining({ _id: lineId })]);
  expect(ranges).toHaveBeenCalledTimes(11);
  const budget = ranges.mock.instances[0];
  if (!(budget instanceof ReadBudget)) throw new Error('No receipt read budget recorded');
  expect(budget.documents).toBe(2);
  expect(budget.bytes).toBeLessThan(4096);
  const history = await owner.query(api.pos.orderHistoryPages.orderRefunds, { orderId, paginationOpts: { numItems: 20, cursor: null } });
  expect(history.page).toHaveLength(20);
  expect(history.isDone).toBe(false);
});

it('projects an open return with custody and gives link and correction previews typed refusals', async () => {
  const { t, owner, view } = setup();
  const { orderId, lineId, returnId, oldLineId, voucherId } = await t.run(async ctx => {
    const { branchId, variantId } = await retail(ctx);
    const propertyId = await ctx.db.insert('properties', {
      slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB',
      maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active',
    });
    const bookingId = await insertFixture(ctx, 'bookings', {
      propertyId, guestName: 'Guest', guestPhone: '+66811112222', checkIn: businessDate, checkOut: '2026-11-20',
      guests: 1, nights: 1, subtotal: 10000, discountAmount: 0, total: 10000, amountPaid: 5000, currency: 'THB',
      paymentStatus: 'pending', status: 'confirmed', createdAt: now,
    });
    const orderId = await order(ctx, 40000, { vatVersion: 2, itemCount: 3, returnedTotal: 0, bookingId });
    const order2 = await order(ctx, 50000, { orderNumber: 2, vatVersion: 2 });
    const voucherLine = await line(ctx, order2, 'voucher', 50000, { saleSnapshot: snapshot('Gift voucher', 50000, 0) });
    const { voucherId } = await issueVoucher(ctx, { kind: 'sale', orderId: order2, lineId: voucherLine }, branchId);
    const oldLineId = await line(ctx, orderId, 'service', 10000);
    await line(ctx, orderId, 'booking', 10000, { bookingId, propertyId, deposit: 5000, saleSnapshot: snapshot('Pool villa', 5000, 10000) });
    const lineId = await line(ctx, orderId, 'product', 20000, { variantId, saleSnapshot: snapshot('Robe', 20000, 20000) });
    const returnId = await ctx.db.insert('orderReturns', {
      orderId, key: 'return', fingerprint: 'return request', status: 'authorized',
      parts: [{ kind: 'line', lineId, units: 1, disposition: 'sellable' }], effectsApplied: [],
      claims: [{ key: 'card', method: 'card', amount: 20000, state: 'instructed', operator: 'cashier', dueAt: now, instructedAt: now }],
      voucherCredits: [], operator: 'cashier', tillId: 'Till 1', operatorRevision: 1, reason: 'Size', createdAt: now,
    });
    await ctx.db.insert('handovers', {
      kind: 'room_bill', orderId, bookingId, lineId, variantId, unitPrice: 20000, quantity: 1, withGuest: 1, backDamaged: 0,
      backSellable: 0, unpaid: 0, paid: 1, status: 'open', movementIds: [], clientKey: 'room-post', revision: 2, pendingReturnId: returnId,
    });
    return { orderId, lineId, returnId, oldLineId, voucherId };
  });
  const receipt = await view(orderId);
  expect(receipt.lines.map(row => row.kind)).toEqual(['service', 'booking', 'product']);
  expect(receipt.totals).toMatchObject({ deposit: 5000, due: 35000, total: 40000 });
  expect(receipt.activeReturn).toMatchObject({ _id: returnId, status: 'authorized', claims: [{ state: 'instructed', amount: 20000 }] });
  expect(receipt.commerce?.handovers).toMatchObject([{ lineId, kind: 'room_bill', withGuest: 1, unpaid: 0, paid: 1, pendingReturnId: returnId }]);
  const email = 'cashier@example.com';
  const cashier = t.withIdentity({ emailVerified: true, email, tokenIdentifier: 'cashier' });
  await owner.mutation(api.auth.staffAccess.setGrant, { email, role: 'cashier' });
  await cashier.mutation(api.auth.staffAccess.claimInvite, {});
  const link = (id: Id<'orderLines'>) => owner.query(api.pos.sourceReads.linkCandidates, { orderId, lineId: id });
  const correct = () => cashier.mutation(api.pos.staffApprovals.create, {
    orderId, reason: 'Change settlement', payload: { kind: 'paymentFix', action: 'amendOrderPayment', tenders: [{ method: 'transfer', amount: 35000 }] },
  });
  const inProgress = { data: { code: 'RETURN_IN_PROGRESS', message: 'Return in progress', returnId } };
  expect(receipt.correctionBlocker).toEqual(inProgress.data);
  await expect(link(oldLineId)).rejects.toMatchObject(inProgress);
  await expect(correct()).rejects.toMatchObject(inProgress);
  await t.run(ctx => ctx.db.patch(orderId, { paymentEffectiveAt: now - 86400000 }));
  expect((await cashier.query(api.pos.orders.getOrder, { orderId }))?.activeReturn?._id).toBe(returnId);

  await t.run(async ctx => {
    await ctx.db.patch(returnId, { status: 'cancelled' });
    const completed = await ctx.db.insert('orderReturns', {
      orderId, key: 'completed', fingerprint: 'completed request', status: 'completed', parts: [], effectsApplied: [], claims: [],
      voucherCredits: [{ voucherId, paid: 1000, goodwill: 0 }], operator: 'cashier', tillId: 'Till 1', operatorRevision: 1,
      reason: 'Return', createdAt: now, completedAt: now,
    });
    await ctx.db.insert('orderRefunds', { orderId, lineId, amount: 1000, currency: 'THB', method: 'voucher', voucherId, returnId: completed,
      reason: 'Voucher credit', idempotencyKey: 'refund-credit', createdBy: 'cashier', createdByEmail: email, createdAt: now, businessDate });
  });
  expect((await view(orderId)).activeReturn).toBeUndefined();
  expect(await cashier.query(api.pos.orders.getOrder, { orderId })).toBeNull();
  await t.run(ctx => ctx.db.patch(orderId, { paymentEffectiveAt: now }));
  const unsupported = { data: { code: 'COMMERCE_CORRECTION_UNAVAILABLE' } };
  await expect(link(lineId)).rejects.toMatchObject(unsupported);
  await expect(correct()).rejects.toMatchObject(unsupported);
  await expect(link(oldLineId)).rejects.toMatchObject(unsupported);
  const history = await owner.query(api.pos.orderHistoryPages.orderRefunds, { orderId, paginationOpts: { numItems: 20, cursor: null } });
  expect(history.page).toMatchObject([{ method: 'voucher', voucherId, returnId: expect.any(String), amount: 1000 }]);
});

it('blocks receipt correction, link candidates and direct amendments on a mixed product and service receipt', async () => {
  const { t, owner, view } = setup();
  const { orderId, lineId } = await t.run(async ctx => {
    const orderId = await order(ctx, 80_000, { itemCount: 2 });
    const lineId = await line(ctx, orderId, 'service', 60_000);
    await line(ctx, orderId, 'product', 20_000);
    return { orderId, lineId };
  });
  const blocker = (await view(orderId)).correctionBlocker;
  expect(blocker).toMatchObject({ code: 'COMMERCE_CORRECTION_UNAVAILABLE' });
  await expect(owner.query(api.pos.sourceReads.linkCandidates, { orderId, lineId })).rejects.toMatchObject({ data: blocker });
  await expect(owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, {
    orderId, expectedCorrectionRevision: 0, idempotencyKey: 'mixed-order-amend', reason: 'Correct the payment day',
    effectiveAt: now - 86_400_000,
  })).rejects.toMatchObject({ data: blocker });
  expect((await view(orderId)).paymentRecord.correctionRevision).toBe(0);
});
