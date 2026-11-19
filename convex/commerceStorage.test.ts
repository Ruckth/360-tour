import { convexTest } from 'convex-test';
import type { Infer } from 'convex/values';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import {
  adjustmentKind, adjustmentTarget, benefitBucket, catalogueStatus, handoverKind, handoverStatus,
  resolveCommerceSettings, saleSwitch, sessionUseKind, stockMovementKind, voucherCodeStatus, voucherEntryKind,
  voucherStatus,
} from './commerce/validators';
import {
  orderLineKind, orderRefundMethod, orderReturnStatus, orderTenderMethod, paymentAttemptStatus,
  paymentLegState, returnClaimState, returnPart,
} from './pos/validators';
import { approvalStatus, type CashierRules } from './shared/staffTypes';
import { insertFixture } from './testing/completeFixture.test-support';
import { adminIdentity, asAdmin, createHarness } from './testing/harness';

const now = Date.UTC(2026, 10, 19, 8);
const businessDate = '2026-11-19';
const actor = 'staff@example.com';
const currency = 'THB';
const lineFields = { name: 'Massage', unitPrice: 120000, catalogUnitPrice: 120000, currency, qty: 1, createdAt: now };
const approvalFields = {
  reason: 'Guest requested a change', requesterEmail: actor, requesterTokenIdentifier: 'test|cashier',
  requesterAccessFingerprint: 'access', rulesRevision: 0, createdAt: now, expiresAt: now + 300000,
};
const existingOrderApproval = { orderFingerprint: 'order', orderRevision: 0, totalBefore: 120000, totalAfter: 120000, amount: 0 };
const existingRules = { discountLimitPercent: 1000, customPrice: 'manager', voidPaidSale: 'manager', paymentFix: 'manager' } as const;
const terms = {
  preserveExpiredPackageValue: true, unusedFullRefundDays: 7, refundDueDays: { cashOrTransfer: 15, card: 45 },
  packageValidityDays: 180, voucherValidityDays: 365, allowSessionTransfer: true,
  packageSplit: 'voucherFaceValue', packageVatTiming: 'atSale', pointsVatTreatment: 'discount', pointsExpiryMonths: 12,
} as const;

afterEach(() => vi.unstubAllEnvs());

async function existingRecords(ctx: MutationCtx) {
  const serviceId = await ctx.db.insert('services', {
    slug: 'massage', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
    price: 120000, currency, staffIds: [], status: 'active', createdAt: now, updatedAt: now,
  });
  const staffId = await ctx.db.insert('staff', {
    name: 'Therapist', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active',
    createdAt: now, updatedAt: now,
  });
  const propertyId = await ctx.db.insert('properties', {
    slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100000, currency, maxGuests: 4,
    bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active',
  });
  const bookingId = await insertFixture(ctx, 'bookings', {
    propertyId, guestName: 'Guest', guestPhone: '0800000000', checkIn: businessDate, checkOut: '2026-11-20',
    guests: 2, nights: 1, subtotal: 100000, discountAmount: 0, total: 100000, currency,
    paymentStatus: 'pending', status: 'confirmed', createdAt: now,
  });
  const appointmentId = await ctx.db.insert('appointments', {
    serviceId, staffId, amountPaid: 0, amountRefunded: 0, serviceNameSnapshot: 'Massage', staffNameSnapshot: 'Therapist',
    start: now, end: now + 3600000, blockedUntil: now + 3600000, guestName: 'Guest', guestPhone: '0800000000',
    guestPhoneDigits: '0800000000', source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 120000,
    currency, confirmationCode: 'MASSAGE', accessToken: 'test-only', createdAt: now,
  });
  const orderId = await ctx.db.insert('orders', {
    status: 'paid', orderNumber: 1, receiptNumber: 1, paidAt: now, currency, itemCount: 1, total: 120000,
    due: 0, hasItems: true, revision: 0, createdBy: actor, createdAt: now, updatedAt: now,
  });
  const lineId = await ctx.db.insert('orderLines', { ...lineFields, orderId, serviceId, kind: 'service' });
  return { serviceId, propertyId, bookingId, appointmentId, orderId, lineId };
}

async function commerceRecords(ctx: MutationCtx) {
  const base = await existingRecords(ctx);
  const { orderId, lineId, serviceId } = base;
  const { revision: settingsRevision } = resolveCommerceSettings(null);
  const settingsId = await ctx.db.insert('commerceSettings', { key: 'default', ...resolveCommerceSettings(null) });
  const branchId = await ctx.db.insert('branches', { key: 'main' });
  const categoryId = await ctx.db.insert('productCategories', { name: 'Spa shop', sort: 0 });
  const productId = await ctx.db.insert('products', {
    categoryId, name: 'Oil', status: 'active', vatProfile: 'standard', options: [],
    minPrice: 39000, maxPrice: 39000, variantCount: 1, sort: 0, revision: 0,
  });
  const variantId = await ctx.db.insert('productVariants', {
    productId, optionValueIds: [], label: 'Oil', sku: 'OIL', barcode: '12345', price: 39000, status: 'active', revision: 0,
  });
  const stockId = await ctx.db.insert('stockLevels', { branchId, productId, variantId, onHand: 3, revision: 0 });
  const packageId = await ctx.db.insert('packages', { name: 'Spa gift', status: 'active', sort: 0, revision: 0 });
  const packageVersionId = await ctx.db.insert('packageVersions', {
    packageId, version: 1, name: 'Spa gift', price: 200000, validityDays: 180, allowTransfer: true,
    contents: [
      { kind: 'session', contentKey: 'massage', units: 2, serviceIds: [serviceId] },
      { kind: 'product', contentKey: 'oil', units: 1, variantId },
      { kind: 'chooseProduct', contentKey: 'gift', units: 1, productId },
      { kind: 'voucher', contentKey: 'credit', faceValue: 50000 },
    ],
    estimatedSplit: [{ contentKey: 'credit', amount: 50000 }],
  });
  const ownerId = await ctx.db.insert('customers', { name: 'Attendee', createdBy: actor, createdAt: now, updatedAt: now });
  const grantId = await ctx.db.insert('sessionGrants', {
    orderId, lineId, contentKey: 'massage', branchId, packageVersionId, ownerId, total: 2, used: 0,
    paidUnits: 2, goodwillUnits: 0, returnedUnits: 0, paidShare: 100000, expiresAt: now,
    issuedTerms: { expiresAt: now, serviceIds: [serviceId], allowTransfer: true },
    settingsRevision, terms, grantServiceIds: [], revision: 0,
  });
  const grantServiceId = await ctx.db.insert('grantServices', { grantId, ownerId, serviceId, branchId, usable: true, expiresAt: now });
  await ctx.db.patch(grantId, { grantServiceIds: [grantServiceId] });
  const templateId = await ctx.db.insert('voucherTemplates', {
    name: 'Gift 500', faceValue: 50000, validityDays: 365, status: 'active', sort: 0, revision: 0,
  });
  const voucherFields = {
    faceValue: 50000, paidBalance: 50000, goodwillBalance: 0, issuedExpiresAt: now, effectiveExpiresAt: now,
    status: 'active' as const, branchId, customerId: ownerId, revision: 0, settingsRevision, terms,
  };
  const voucherId = await ctx.db.insert('vouchers', { ...voucherFields, source: { kind: 'sale', orderId, lineId, templateId } });
  const packageVoucherId = await ctx.db.insert('vouchers', {
    ...voucherFields, source: { kind: 'package', orderId, lineId, contentKey: 'credit', packageVersionId },
  });
  const replacementVoucherId = await ctx.db.insert('vouchers', {
    ...voucherFields, source: { kind: 'refund_credit', orderId, voucherId },
  });
  return {
    ...base, settingsId, branchId, productId, variantId, stockId, ownerId, packageId, packageVersionId, grantId,
    grantServiceId, templateId, voucherId, packageVoucherId, replacementVoucherId, settingsRevision, terms,
  };
}

it('validates and reads pre-commerce orders, lines, payments, refunds, appointments and approvals', async () => {
  const t = createHarness(convexTest);
  await t.run(async ctx => {
    const { orderId, lineId, appointmentId, serviceId, propertyId } = await existingRecords(ctx);
    expect(await ctx.db.get(serviceId)).not.toHaveProperty('revision');
    expect(await ctx.db.get(propertyId)).not.toHaveProperty('revision');
    const appointmentRefundId = await ctx.db.insert('appointmentRefunds', {
      appointmentId, amount: 100, currency, method: 'card', reason: 'Refund',
      effectiveAt: now, recordedAt: now, recordedBy: actor, idempotencyKey: 'appointment-refund',
      netBefore: 100, netAfter: 0,
    });
    expect(await ctx.db.get(appointmentRefundId)).not.toHaveProperty('returnId');
    const paymentId = await ctx.db.insert('orderPayments', {
      orderId, method: 'cash', amount: 120000, received: 150000, idempotencyKey: 'payment-1', createdBy: actor, createdAt: now,
    });
    const refundId = await ctx.db.insert('orderRefunds', {
      orderId, lineId, method: 'card', amount: 2500, currency, reason: 'Adjustment', idempotencyKey: 'refund-1',
      createdBy: actor, createdByEmail: actor, createdAt: now, businessDate,
    });
    for (const { value: status } of approvalStatus.members) {
      const requestId = await ctx.db.insert('staffApprovalRequests', {
        ...approvalFields, ...existingOrderApproval, orderId, kind: 'voidPaidSale', payload: { kind: 'voidPaidSale' }, status,
      });
      expect(await ctx.db.get(requestId)).toMatchObject({ orderId, payload: { kind: 'voidPaidSale' }, status });
    }
    expect(await ctx.db.get(orderId)).toMatchObject({ status: 'paid', due: 0, total: 120000 });
    expect(await ctx.db.get(lineId)).toMatchObject({ kind: 'service', orderId, qty: 1 });
    expect(await ctx.db.get(paymentId)).toMatchObject({ method: 'cash', amount: 120000, received: 150000 });
    expect(await ctx.db.get(refundId)).toMatchObject({ method: 'card', amount: 2500, lineId });
    expect(await ctx.db.get(appointmentId)).toMatchObject({ status: 'booked', price: 120000 });
  });
});

it('defaults missing cashier policies and keeps new settings when old clients save', async () => {
  vi.stubEnv('ADMIN_EMAILS', adminIdentity.email);
  const t = createHarness(convexTest);
  const owner = asAdmin(t);
  const get = () => owner.query(api.settings.cashierRules.getCashierRules, {});
  const save = (expectedRevision: number, fields: Partial<Pick<CashierRules, 'sessionWaive' | 'benefitEdit'>> = {}) => owner.mutation(api.settings.cashierRules.updateCashierRules, {
    ...existingRules, expectedRevision, ...fields,
  });
  const defaults = { ...existingRules, refund: 'manager', sessionWaive: 'manager', benefitEdit: 'manager' };
  expect(await get()).toEqual({ ...defaults, revision: 0 });
  await t.run(ctx => ctx.db.insert('cashierRules', {
    ...existingRules, key: 'default', refund: 'cashier', revision: 2, updatedAt: now, updatedByEmail: actor,
  }));
  expect(await get()).toEqual({ ...defaults, refund: 'cashier', revision: 2 });
  expect(await save(2, { sessionWaive: 'cashier', benefitEdit: 'cashier' })).toMatchObject({
    revision: 3, refund: 'cashier', sessionWaive: 'cashier', benefitEdit: 'cashier',
  });
  expect(await save(3)).toEqual({ ...defaults, revision: 4, refund: 'cashier', sessionWaive: 'cashier', benefitEdit: 'cashier' });
  expect(await get()).toMatchObject({ revision: 4, sessionWaive: 'cashier', benefitEdit: 'cashier' });
});

it('resolves the D20 defaults and independently stores rollout and attempt cutover', async () => {
  const t = createHarness(convexTest);
  await t.run(async ctx => {
    const read = async () => resolveCommerceSettings(await ctx.db.query('commerceSettings')
      .withIndex('by_key', q => q.eq('key', 'default')).unique());
    const defaults = {
      ...terms, revision: 0, paymentsMode: 'direct',
      saleSwitches: { products: 'off', vouchers: 'off', sessionPackages: 'off', mixedPackages: 'off' },
    };
    expect(await read()).toEqual(defaults);
    expect(resolveCommerceSettings(undefined)).toEqual(defaults);
    const id = await ctx.db.insert('commerceSettings', { key: 'default', ...resolveCommerceSettings(null) });
    for (const { value: state } of saleSwitch.members) {
      const saleSwitches = { products: state, vouchers: state, sessionPackages: state, mixedPackages: state };
      await ctx.db.patch(id, { saleSwitches });
      expect(await read()).toMatchObject({ saleSwitches, paymentsMode: 'direct' });
    }
    await ctx.db.patch(id, {
      revision: 1, preserveExpiredPackageValue: false, unusedFullRefundDays: 9, refundDueDays: { cashOrTransfer: 20, card: 50 },
      packageValidityDays: 90, voucherValidityDays: 180, allowSessionTransfer: false, packageSplit: 'normalPrice',
      packageVatTiming: 'atUse', pointsVatTreatment: 'payment', pointsExpiryMonths: 24,
      saleSwitches: { products: 'managers', vouchers: 'off', sessionPackages: 'everyone', mixedPackages: 'off' },
      paymentsMode: 'attempts', cutover: { pausedAt: now, activatedAt: now + 1, actor },
    });
    expect(await read()).toMatchObject({
      revision: 1, packageSplit: 'normalPrice', packageVatTiming: 'atUse', pointsVatTreatment: 'payment', paymentsMode: 'attempts',
      saleSwitches: { products: 'managers', vouchers: 'off', sessionPackages: 'everyone', mixedPackages: 'off' },
    });
  });
});

it('round-trips each row and tender kind, and only permits vouchers on POS tender records', async () => {
  vi.stubEnv('ADMIN_EMAILS', adminIdentity.email);
  const t = createHarness(convexTest);
  const { orderId, lineId, bookingId, voucherId } = await t.run(commerceRecords);
  await t.run(async ctx => {
    for (const { value: kind } of orderLineKind.members) {
      const id = await ctx.db.insert('orderLines', { ...lineFields, orderId, kind });
      expect((await ctx.db.get(id))?.kind).toBe(kind);
    }
    const payment = { orderId, amount: 100, createdBy: actor, createdAt: now };
    for (const method of [...orderTenderMethod.members[0].members.map(member => member.value), 'voucher'] as const) {
      const id = await ctx.db.insert('orderPayments', {
        ...payment, idempotencyKey: 'pay-' + method, ...(method === 'voucher' ? { method, voucherId } : { method }),
      });
      expect(await ctx.db.get(id)).toMatchObject(method === 'voucher' ? { method, voucherId } : { method });
    }
    const refund = { ...payment, lineId, currency, reason: 'Return', createdByEmail: actor, businessDate };
    for (const method of [...orderRefundMethod.members[0].members.map(member => member.value), 'voucher'] as const) {
      const id = await ctx.db.insert('orderRefunds', {
        ...refund, idempotencyKey: 'refund-' + method, ...(method === 'voucher' ? { method, voucherId } : { method }),
      });
      expect(await ctx.db.get(id)).toMatchObject(method === 'voucher' ? { method, voucherId } : { method });
    }
    // @ts-expect-error A voucher tender must identify the stable voucher record.
    await expect(ctx.db.insert('orderPayments', { ...payment, idempotencyKey: 'missing-voucher-id', method: 'voucher' })).rejects.toThrow('Validator error');
    // @ts-expect-error An external refund cannot point to a voucher.
    await expect(ctx.db.insert('orderRefunds', { ...refund, idempotencyKey: 'wrong-refund-method', method: 'cash', voucherId })).rejects.toThrow('Validator error');
  });
  const owner = asAdmin(t);
  await expect(owner.mutation(api.pos.commands.amendOrderPayment.amendOrderPayment, {
    orderId, expectedCorrectionRevision: 0, reason: 'Correction', idempotencyKey: 'voucher-correction',
    // @ts-expect-error Corrected tenders use external payment methods.
    tenders: [{ method: 'voucher', amount: 100 }],
  })).rejects.toThrow('Validator error');
  await expect(owner.mutation(api.bookings.commands.recordPayment.recordPayment, {
    bookingId, expectedRevision: 0, expectedAmount: 100000, idempotencyKey: 'voucher-booking',
    // @ts-expect-error Booking payment methods are external.
    method: 'voucher',
  })).rejects.toThrow('Validator error');
});

it('round-trips stock, session and voucher ledger discriminators and covered appointments', async () => {
  const t = createHarness(convexTest);
  await t.run(async ctx => {
    const { orderId, lineId, bookingId, appointmentId, serviceId, branchId, variantId, grantId, ownerId, voucherId,
      packageVoucherId, replacementVoucherId, packageVersionId, settingsRevision, terms, templateId } = await commerceRecords(ctx);
    const ledger = { before: { paid: 2, goodwill: 1 }, after: { paid: 1, goodwill: 1 }, actor, createdAt: now, guestFact: 'Session activity' };
    for (const { value: kind } of stockMovementKind.members) {
      const id = await ctx.db.insert('stockMovements', {
        branchId, variantId, delta: -1, before: 3, after: 2, kind, sourceKey: 'stock-' + kind, actor, createdAt: now,
      });
      expect(await ctx.db.get(id)).toMatchObject({ kind, delta: -1 });
    }
    for (const { value: kind } of sessionUseKind.members) {
      const id = await ctx.db.insert('sessionUses', { ...ledger, grantId, kind, sourceKey: 'session-' + kind });
      expect(await ctx.db.get(id)).toMatchObject({ kind, grantId });
    }
    for (const { value: bucket } of benefitBucket.members) {
      const useId = await ctx.db.insert('sessionUses', {
        ...ledger, grantId, kind: 'use', bucket, sourceKey: 'use-' + bucket,
        activeAppointmentId: appointmentId, lineId, serviceId, beneficiaryId: ownerId,
      });
      await ctx.db.patch(appointmentId, { attendeeId: ownerId, coverage: { grantId, useId } });
      await ctx.db.patch(lineId, { coverage: { grantId, useId, attendeeId: ownerId, priceBefore: 120000 } });
      expect(await ctx.db.get(useId)).toMatchObject({ bucket, beneficiaryId: ownerId });
      expect(await ctx.db.get(appointmentId)).toMatchObject({ coverage: { grantId, useId }, attendeeId: ownerId });
    }
    for (const { value: kind } of voucherEntryKind.members) {
      const id = await ctx.db.insert('voucherEntries', { ...ledger, voucherId, kind, sourceKey: 'voucher-' + kind });
      expect(await ctx.db.get(id)).toMatchObject({ kind, voucherId, guestFact: ledger.guestFact });
    }
    for (const guestFact of [{ key: 'transferredIn' }, { key: 'issued', args: { amount: 50000 } }]) {
      const id = await ctx.db.insert('voucherEntries', {
        ...ledger, voucherId, kind: 'transfer', sourceKey: 'structured-' + guestFact.key, guestFact,
      });
      expect((await ctx.db.get(id))?.guestFact).toEqual(guestFact);
    }
    for (const { value: status } of voucherCodeStatus.members) {
      const id = await ctx.db.insert('voucherCodes', { voucherId, status, code: 'CODE-' + status, mask: '••••-ABCD' });
      expect(await ctx.db.get(id)).toMatchObject({ status, voucherId });
    }
    for (const { value: status } of voucherStatus.members) {
      await ctx.db.patch(voucherId, { status });
      expect(await ctx.db.get(voucherId)).toMatchObject({ status });
    }
    for (const { value: status } of catalogueStatus.members) {
      await ctx.db.patch(templateId, { status });
      expect(await ctx.db.get(templateId)).toMatchObject({ status, faceValue: 50000, validityDays: 365 });
    }
    for (const { value: kind } of handoverKind.members) {
      for (const { value: status } of handoverStatus.members) {
        const id = await ctx.db.insert('handovers', {
          kind, status, ...(kind === 'room_bill' ? { bookingId } : {}), orderId, lineId, variantId,
          unitPrice: 39000, quantity: 1, withGuest: 1, backSellable: 0, backDamaged: 0, unpaid: 1, paid: 0,
          movementIds: [], clientKey: kind + status, revision: 0,
        });
        expect(await ctx.db.get(id)).toMatchObject({ kind, status, variantId });
      }
    }
    const saleAllocation = {
      paidShare: 39000, vatBase: 39000, returnedUnits: 0, returnedAmount: 0,
      tenderCells: [
        { kind: 'external' as const, amount: 30000 },
        { kind: 'voucher' as const, amount: 9000, voucherId },
      ],
    };
    const packageLineId = await ctx.db.insert('orderLines', {
      ...lineFields, orderId, kind: 'package', packageVersionId,
      saleSnapshot: {
        ...saleAllocation, label: 'Spa gift', settingsRevision, terms, goodwillDiscounts: [],
        chosenVariants: [{ contentKey: 'oil', variantId }],
        contents: [{ contentKey: 'oil', label: 'Oil', units: 1, vatProfile: 'standard', ...saleAllocation }],
      },
    });
    expect(await ctx.db.get(packageLineId)).toMatchObject({ saleSnapshot: saleAllocation });
    expect((await ctx.db.get(packageVersionId))?.contents.map(content => content.kind)).toEqual(['session', 'product', 'chooseProduct', 'voucher']);
    expect((await ctx.db.get(packageVoucherId))?.source.kind).toBe('package');
    expect((await ctx.db.get(replacementVoucherId))?.source.kind).toBe('refund_credit');
  });
});

it('round-trips payment attempts, returns, payout claims and return approval authorization', async () => {
  const t = createHarness(convexTest);
  await t.run(async ctx => {
    const { orderId, lineId, grantId, voucherId, appointmentId, settingsRevision } = await commerceRecords(ctx);
    const useId = await ctx.db.insert('sessionUses', {
      grantId, kind: 'use', sourceKey: 'use-for-return', createdAt: now, actor,
      before: { paid: 2, goodwill: 0 }, after: { paid: 1, goodwill: 0 }, guestFact: 'Used a session',
    });
    const parts = [
      { kind: 'line', lineId, units: 1, disposition: 'sellable' },
      { kind: 'content', lineId, contentKey: 'oil', units: 1, disposition: 'damaged' },
      { kind: 'cancelPackage', lineId },
      { kind: 'restoreSession', lineId, useId },
    ] satisfies Infer<typeof returnPart>[];
    const returnApprovalId = await ctx.db.insert('staffApprovalRequests', {
      ...approvalFields, ...existingOrderApproval, orderId, kind: 'returnItems', status: 'authorized',
      payload: { kind: 'returnItems', parts, idempotencyKey: 'approval-return' },
    });
    expect(await ctx.db.get(returnApprovalId)).toMatchObject({ status: 'authorized', payload: { parts } });
    const legs = paymentLegState.members.map(({ value: state }) => ({ key: state, method: 'cash' as const, amount: 100, state }));
    const claimed = returnClaimState.members.map(({ value: state }) => ({
      key: state, method: 'card' as const, amount: 100, state, operator: actor, dueAt: now,
    }));
    for (const { value: status } of paymentAttemptStatus.members) {
      const refusal = { code: 'VOUCHER_LIMIT', message: 'Voucher limit reached' };
      const attemptId = await ctx.db.insert('paymentAttempts', {
        orderId, key: 'attempt-' + status, fingerprint: status, legs, status,
        ...(status === 'refused' ? { refusal } : {}),
        reviewedRequest: {
          revision: 0, due: 100, customers: [], vouchers: [{ voucherId, paid: 100, goodwill: 0 }],
          settingsRevision, businessDate,
        },
        owner: actor, tillId: 'till-1', ownerRevision: 0, createdAt: now, updatedAt: now,
      });
      await ctx.db.patch(orderId, { activeAttemptId: attemptId, vatVersion: 1, returnedTotal: 0 });
      expect(await ctx.db.get(attemptId)).toMatchObject({ status, legs });
      if (status === 'refused') {
        expect((await ctx.db.get(attemptId))?.refusal).toEqual(refusal);
        const withArgs = { ...refusal, args: { max: 2 } };
        await ctx.db.patch(attemptId, { refusal: withArgs });
        expect((await ctx.db.get(attemptId))?.refusal).toEqual(withArgs);
      }
      expect(await ctx.db.get(orderId)).toMatchObject({ activeAttemptId: attemptId, vatVersion: 1, returnedTotal: 0 });
    }
    for (const { value: status } of orderReturnStatus.members) {
      const returnId = await ctx.db.insert('orderReturns', {
        orderId, key: 'return-' + status, fingerprint: status, parts, effectsApplied: [], claims: claimed,
        voucherCredits: [{ voucherId, paid: 100, goodwill: 0 }], status, operator: actor, tillId: 'till-1',
        operatorRevision: 0, approvalId: returnApprovalId, reason: 'Guest return', createdAt: now,
      });
      expect(await ctx.db.get(returnId)).toMatchObject({ status, parts, claims: claimed, approvalId: returnApprovalId });
      if (status === 'completed') {
        const appointmentRefundId = await ctx.db.insert('appointmentRefunds', {
          appointmentId, returnId, amount: 100, currency, method: 'card', reason: 'Guest return',
          effectiveAt: now, recordedAt: now, recordedBy: actor, idempotencyKey: 'visit-return',
          netBefore: 100, netAfter: 0,
        });
        expect(await ctx.db.get(appointmentRefundId)).toMatchObject({ appointmentId, returnId });
        const payoutId = await ctx.db.insert('returnPayouts', {
          returnId, key: 'return-payout', destinationKey: 'given', sourceOwner: { kind: 'appointment', appointmentId },
          amount: 100, method: 'card', businessDate, operator: actor, createdAt: now,
        });
        expect(await ctx.db.get(payoutId)).toMatchObject({ returnId, amount: 100, method: 'card' });
        const refundId = await ctx.db.insert('orderRefunds', {
          returnId, orderId, lineId, amount: 100, currency, method: 'voucher', voucherId,
          reason: 'Guest return', idempotencyKey: 'return-credit', createdAt: now, businessDate, createdBy: actor, createdByEmail: actor,
        });
        expect(await ctx.db.get(refundId)).toMatchObject({ returnId, method: 'voucher', voucherId });
      }
    }
  });
});

it('round-trips adjustments and allows target-scoped requests without an order', async () => {
  const t = createHarness(convexTest);
  await t.run(async ctx => {
    const { orderId, lineId, bookingId, productId, variantId, packageId, templateId, serviceId,
      propertyId, voucherId, grantId, stockId, settingsId } = await commerceRecords(ctx);
    await ctx.db.patch(serviceId, { revision: 1 });
    await ctx.db.patch(propertyId, { revision: 2 });
    expect(await ctx.db.get(serviceId)).toMatchObject({ revision: 1 });
    expect(await ctx.db.get(propertyId)).toMatchObject({ revision: 2 });
    const handoverId = await ctx.db.insert('handovers', {
      kind: 'room_bill', status: 'open', bookingId, orderId, lineId, variantId,
      unitPrice: 39000, quantity: 1, withGuest: 1, backSellable: 0, backDamaged: 0, unpaid: 1, paid: 0,
      movementIds: [], clientKey: 'room-charge', revision: 0,
    });
    const targets = [
      { targetType: 'product', targetId: productId },
      { targetType: 'variant', targetId: variantId },
      { targetType: 'package', targetId: packageId },
      { targetType: 'voucherTemplate', targetId: templateId },
      { targetType: 'service', targetId: serviceId },
      { targetType: 'property', targetId: propertyId },
      { targetType: 'voucher', targetId: voucherId },
      { targetType: 'grant', targetId: grantId },
      { targetType: 'stock', targetId: stockId },
      { targetType: 'handover', targetId: handoverId },
      { targetType: 'order', targetId: orderId },
      { targetType: 'settings', targetId: settingsId },
    ] satisfies Infer<typeof adjustmentTarget>[];
    expect(targets.map(target => target.targetType)).toEqual(adjustmentTarget.members.map(member => member.fields.targetType.value));
    const edit = {
      before: { options: [] },
      after: { options: [{ key: 'size', name: 'Size', values: [{ key: 'small', label: 'Small' }] }] },
      revisionBefore: 0, revisionAfter: 1, paidLiabilityDelta: 0, goodwillFaceValueDelta: 0, quantityDelta: 0,
      actor, actorLabel: 'Manager', requesterKey: 'test|manager', fingerprint: 'edit', recordedAt: now, businessDate,
    };
    for (const target of targets) {
      const id = await ctx.db.insert('commerceAdjustments', {
        ...target, ...edit, kind: 'editCatalogue', clientKey: 'target-' + target.targetType,
      });
      expect(await ctx.db.get(id)).toMatchObject({ ...target, after: edit.after });
    }
    expect(adjustmentKind.members.map(member => member.value)).toContain('waive');
    for (const { value: kind } of adjustmentKind.members) {
      const id = await ctx.db.insert('commerceAdjustments', {
        ...edit, targetType: 'product', targetId: productId, kind, clientKey: 'kind-' + kind,
      });
      expect(await ctx.db.get(id)).toMatchObject({ kind });
    }
    const target = { targetType: 'voucher', targetId: voucherId } as const;
    const id = await ctx.db.insert('staffApprovalRequests', {
      ...approvalFields, kind: 'adjustment', status: 'pending',
      payload: {
        kind: 'adjustment', target, adjustmentKind: 'extend', input: { effectiveExpiresAt: now + 86400000 },
        expectedRevisions: [{ target, revision: 0 }], requester: actor, payloadFingerprint: 'request', clientKey: 'extend',
      },
    });
    const read = await ctx.db.get(id);
    expect(read).toMatchObject({ payload: { kind: 'adjustment', target, requester: actor }, status: 'pending' });
    expect(read).not.toHaveProperty('orderId');
  });
});
