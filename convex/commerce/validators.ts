import { v, type Infer } from 'convex/values';
import { commerceTermsFields } from '../shared/commerce/validators';

export {
  adjustmentConsent, adjustmentEffect, adjustmentFields, adjustmentKind, adjustmentTarget, adjustmentTargets,
  adjustmentTargetType, commerceTerms, commerceTermsFields, vatProfile,
} from '../shared/commerce/validators';

export const catalogueStatus = v.union(v.literal('draft'), v.literal('active'), v.literal('archived'));

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
  v.object({ kind: v.literal('session'), contentKey: v.string(), units: v.number(), serviceIds: v.array(v.id('services')), durationMins: v.optional(v.array(v.number())) }),
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
export const structuredGuestFact = v.union(
  v.object({
    key: v.union(
      v.literal('updated'), v.literal('restored'), v.literal('noShow'), v.literal('waived'),
      v.literal('transferredIn'), v.literal('transferredOut'), v.literal('paused'),
      v.literal('goodwillAdded'), v.literal('goodwillRemoved'), v.literal('reissued'),
      v.literal('disabled'), v.literal('expired'), v.literal('cancelled'), v.literal('sold'),
      v.literal('stockAdjusted'), v.literal('takenBack'), v.literal('published'),
    ),
    args: v.optional(v.object({})),
  }),
  v.object({ key: v.union(v.literal('purchased'), v.literal('renamed')), args: v.object({ name: v.string() }) }),
  v.object({ key: v.union(v.literal('used'), v.literal('serviceAdded')), args: v.object({ service: v.string() }) }),
  v.object({ key: v.union(v.literal('issued'), v.literal('spent'), v.literal('refundCredit')), args: v.object({ amount: v.number() }) }),
  v.object({ key: v.union(v.literal('extended'), v.literal('resumed')), args: v.object({ date: v.number() }) }),
  v.object({ key: v.literal('roomCharge'), args: v.object({ room: v.string() }) }),
);

// Earlier ledger writers stored text. History derives a safe fact from those rows.
export const ledgerGuestFact = v.union(v.string(), structuredGuestFact);
export const voucherSource = v.union(
  v.object({ kind: v.literal('sale'), orderId: v.id('orders'), lineId: v.id('orderLines'), templateId: v.optional(v.id('voucherTemplates')) }),
  v.object({ kind: v.literal('package'), ...commerceSaleSource, packageVersionId: v.id('packageVersions') }),
  v.object({ kind: v.literal('refund_credit'), voucherId: v.id('vouchers'), orderId: v.id('orders'), returnId: v.optional(v.id('orderReturns')) }),
);

export const saleSwitch = v.union(v.literal('off'), v.literal('managers'), v.literal('everyone'));
export const saleSwitches = v.object({
  products: saleSwitch,
  vouchers: saleSwitch,
  sessionPackages: saleSwitch,
  mixedPackages: saleSwitch,
});
export const paymentsMode = v.union(v.literal('direct'), v.literal('attempts'));
export const commerceSettingsFields = {
  revision: v.number(),
  ...commerceTermsFields,
  saleSwitches,
  paymentsMode,
  cutover: v.optional(v.object({
    pausedAt: v.number(),
    activatedAt: v.optional(v.number()),
    actor: v.string(),
    revision: v.optional(v.number()),
  })),
  /** When the owner first paused checkout for the payments cutover. Kept after an unpause. */
  cutoverStartedAt: v.optional(v.number()),
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
