import { v } from 'convex/values';

export const vatProfile = v.union(v.literal('standard'), v.literal('exempt'));
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

export const commerceTermsFields = {
  preserveExpiredPackageValue: v.boolean(),
  // null disables the special unused-full-refund window.
  unusedFullRefundDays: v.union(v.number(), v.null()),
  refundDueDays: v.object({ cashOrTransfer: v.number(), card: v.number() }),
  packageValidityDays: v.number(),
  // null is unlimited standalone voucher validity.
  voucherValidityDays: v.union(v.number(), v.null()),
  allowSessionTransfer: v.boolean(),
  packageSplit: v.union(v.literal('voucherFaceValue'), v.literal('normalPrice')),
  packageVatTiming: v.union(v.literal('atSale'), v.literal('atUse')),
  pointsVatTreatment: v.union(v.literal('discount'), v.literal('payment')),
  pointsExpiryMonths: v.number(),
};
export const commerceTerms = v.object(commerceTermsFields);
