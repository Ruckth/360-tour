import { v, type Infer } from 'convex/values';
import { commerceCopyArgs } from '../shared/commerce/reasons';

export const catalogueStatus = v.union(v.literal('draft'), v.literal('active'), v.literal('archived'));
export const vatProfile = v.union(v.literal('standard'), v.literal('exempt'));

export const stockMovementKind = v.union(
  v.literal('opening'), v.literal('sale'), v.literal('room_bill'), v.literal('taken_back'),
  v.literal('return'), v.literal('write_off'), v.literal('adjust'),
);

export const handoverKind = v.union(v.literal('room_bill'), v.literal('recollect'));
export const handoverStatus = v.union(v.literal('open'), v.literal('closed'));
export const handoverCounts = {
  quantity: v.number(),
  withGuest: v.number(),
  backSellable: v.number(),
  backDamaged: v.number(),
  unpaid: v.number(),
  paid: v.number(),
};
export const handoverContent = v.object({
  contentKey: v.string(),
  variantId: v.id('productVariants'),
  originalMovementId: v.id('stockMovements'),
  allocatedPrice: v.number(),
  ...handoverCounts,
});

export const packageContent = v.union(
  v.object({ kind: v.literal('session'), contentKey: v.string(), units: v.number(), serviceIds: v.array(v.id('services')) }),
  v.object({ kind: v.literal('product'), contentKey: v.string(), units: v.number(), variantId: v.id('productVariants') }),
  v.object({ kind: v.literal('chooseProduct'), contentKey: v.string(), units: v.number(), productId: v.id('products') }),
  v.object({ kind: v.literal('voucher'), contentKey: v.string(), faceValue: v.number() }),
);

export const commerceSaleSource = {
  orderId: v.id('orders'),
  lineId: v.id('orderLines'),
  contentKey: v.string(),
};
export const benefitPause = v.object({ startedAt: v.number(), until: v.optional(v.number()) });

export const sessionUseKind = v.union(
  v.literal('issue'), v.literal('use'), v.literal('restore'), v.literal('no_show'),
  v.literal('waive'), v.literal('transfer'), v.literal('expire'), v.literal('cancel'),
  v.literal('cancel_reversed'), v.literal('edit'),
);
export const benefitBucket = v.union(v.literal('paid'), v.literal('goodwill'));
export const benefitBalances = v.object({ paid: v.number(), goodwill: v.number() });

export const voucherStatus = v.union(v.literal('active'), v.literal('disabled'), v.literal('expired'), v.literal('revoked'));
export const voucherCodeStatus = v.union(v.literal('active'), v.literal('replaced'), v.literal('disabled'));
export const voucherEntryKind = v.union(
  v.literal('issue'), v.literal('spend'), v.literal('refund_credit'), v.literal('revoke'),
  v.literal('disable'), v.literal('reissue'), v.literal('expire'), v.literal('edit'), v.literal('transfer'),
);
export const voucherGuestFact = v.union(
  v.string(),
  v.object({ key: v.string(), args: v.optional(commerceCopyArgs) }),
);
export const voucherSource = v.union(
  v.object({ kind: v.literal('sale'), orderId: v.id('orders'), lineId: v.id('orderLines'), templateId: v.optional(v.id('voucherTemplates')) }),
  v.object({ kind: v.literal('package'), ...commerceSaleSource, packageVersionId: v.id('packageVersions') }),
  v.object({ kind: v.literal('refund_credit'), voucherId: v.id('vouchers'), orderId: v.id('orders'), returnId: v.optional(v.id('orderReturns')) }),
);

export const adjustmentTargets = [
  v.object({ targetType: v.literal('product'), targetId: v.id('products') }),
  v.object({ targetType: v.literal('variant'), targetId: v.id('productVariants') }),
  v.object({ targetType: v.literal('package'), targetId: v.id('packages') }),
  v.object({ targetType: v.literal('voucherTemplate'), targetId: v.id('voucherTemplates') }),
  v.object({ targetType: v.literal('service'), targetId: v.id('services') }),
  v.object({ targetType: v.literal('property'), targetId: v.id('properties') }),
  v.object({ targetType: v.literal('voucher'), targetId: v.id('vouchers') }),
  v.object({ targetType: v.literal('grant'), targetId: v.id('sessionGrants') }),
  v.object({ targetType: v.literal('stock'), targetId: v.id('stockLevels') }),
  v.object({ targetType: v.literal('handover'), targetId: v.id('handovers') }),
  v.object({ targetType: v.literal('order'), targetId: v.id('orders') }),
  v.object({ targetType: v.literal('settings'), targetId: v.id('commerceSettings') }),
] as const;
export const adjustmentTarget = v.union(...adjustmentTargets);
export const adjustmentTargetType = v.union(...adjustmentTargets.map(target => target.fields.targetType));
export const adjustmentKind = v.union(
  v.literal('publish'), v.literal('editCatalogue'), v.literal('extend'), v.literal('pause'), v.literal('resume'),
  v.literal('addGoodwill'), v.literal('removeGoodwill'), v.literal('rename'), v.literal('reissue'),
  v.literal('disable'), v.literal('transfer'), v.literal('addService'), v.literal('substituteService'),
  v.literal('narrowServices'), v.literal('shorten'), v.literal('adjustStock'), v.literal('takeBack'),
  v.literal('moveRoomCharge'), v.literal('amendPayment'), v.literal('updateSettings'), v.literal('waive'),
);

export const adjustmentEffect = v.union(
  v.object({ kind: v.literal('voucherEntry'), id: v.id('voucherEntries') }),
  v.object({ kind: v.literal('sessionUse'), id: v.id('sessionUses') }),
  v.object({ kind: v.literal('stockMovement'), id: v.id('stockMovements') }),
  v.object({ kind: v.literal('orderCorrection'), id: v.id('orderCorrections') }),
);

// Changed fields retain nested catalogue values such as options and package contents.
const changeScalar = v.union(v.string(), v.number(), v.boolean(), v.null());
const changeLeaf = v.union(changeScalar, v.array(changeScalar));
const changeRecord = v.record(v.string(), changeLeaf);
const changeObject = v.record(v.string(), v.union(changeLeaf, changeRecord, v.array(changeRecord)));
export const adjustmentFields = v.record(v.string(), v.union(changeLeaf, changeObject, v.array(changeObject)));
export const adjustmentConsent = v.object({ recordedAt: v.number(), evidence: v.string() });

export const saleSwitch = v.union(v.literal('off'), v.literal('managers'), v.literal('everyone'));
export const saleSwitches = v.object({
  products: saleSwitch,
  vouchers: saleSwitch,
  sessionPackages: saleSwitch,
  mixedPackages: saleSwitch,
});
export const paymentsMode = v.union(v.literal('direct'), v.literal('attempts'));
export const commerceTermsFields = {
  preserveExpiredPackageValue: v.boolean(),
  unusedFullRefundDays: v.number(),
  refundDueDays: v.object({ cashOrTransfer: v.number(), card: v.number() }),
  packageValidityDays: v.number(),
  voucherValidityDays: v.number(),
  allowSessionTransfer: v.boolean(),
  packageSplit: v.union(v.literal('voucherFaceValue'), v.literal('normalPrice')),
  packageVatTiming: v.union(v.literal('atSale'), v.literal('atUse')),
  pointsVatTreatment: v.union(v.literal('discount'), v.literal('payment')),
  pointsExpiryMonths: v.number(),
};
export const commerceTerms = v.object(commerceTermsFields);
export const commerceSettingsFields = {
  revision: v.number(),
  ...commerceTermsFields,
  saleSwitches,
  paymentsMode,
  cutover: v.optional(v.object({
    pausedAt: v.number(),
    activatedAt: v.optional(v.number()),
    actor: v.string(),
  })),
};

export const commerceSettingsValidator = v.object(commerceSettingsFields);
export type CommerceSettings = Infer<typeof commerceSettingsValidator>;

export function resolveCommerceSettings(settings: CommerceSettings | null | undefined): CommerceSettings {
  return settings ?? {
    revision: 0,
    preserveExpiredPackageValue: true,
    unusedFullRefundDays: 7,
    refundDueDays: { cashOrTransfer: 15, card: 45 },
    packageValidityDays: 180,
    voucherValidityDays: 365,
    allowSessionTransfer: true,
    packageSplit: 'voucherFaceValue',
    packageVatTiming: 'atSale',
    pointsVatTreatment: 'discount',
    pointsExpiryMonths: 12,
    saleSwitches: { products: 'off', vouchers: 'off', sessionPackages: 'off', mixedPackages: 'off' },
    paymentsMode: 'direct',
  };
}
