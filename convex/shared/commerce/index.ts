/**
 * Pure checkout-commerce rules. All amounts including VAT bases are integer satang.
 * Preserve receipt row, tender and package content order for deterministic ties.
 *
 * COMMERCE_LIMITS / assertCommerceCaps — bounds for sales, returns and catalogue definitions.
 * commerceLineEligibility / canSpendVoucher — row policies and cart-wide voucher exclusions.
 * DEFAULT_COMMERCE_SETTINGS — D20 defaults to copy into a sale's frozen terms.
 * benefitExpiresAt / benefitState — Bangkok validity and retained/forfeited expiry outcomes.
 * canTransferSessions / isProtectedUnusedRefund / refundDueOn — frozen benefit and refund terms.
 * splitPointsSpend / pointsExpireOn — monetary treatment and expiry of already-valued loyalty points.
 * apportionMoney / allocateSalePayments / allocateGoodwillDiscount — deterministic sale allocations.
 * splitPackagePrice — freeze D1 content values and shares after staff discount.
 * freezeRowVatBase / freezePackageVatBases / receiptVat — frozen v2 bases and pre-commerce (v1) VAT.
 * incrementalShare / quoteSessionReturn / quotePackageVoucherReturn — cumulative reversal math.
 * assertStandaloneVoucherPrice / quoteStandaloneVoucherReturn — D8 pricing and mistaken-sale exception.
 * splitBenefitUse — separate paid and goodwill use so undo can restore both.
 * assertExternalCorrection / routeReceiptRefund — preserve sale cells and plan receipt-wide destinations.
 *
 * Callers own persistence, replay keys, eligibility against live records, and application of effects.
 */
export { assertCommerceCaps, COMMERCE_LIMITS, type CommerceCapsInput } from './caps';
export { canSpendVoucher, commerceLineEligibility, type CommerceLine } from './eligibility';
export {
  allocateGoodwillDiscount, allocateSalePayments, apportionMoney,
  type CommerceTender, type ExternalTender, type PaymentRow, type TenderCells, type VoucherTender,
} from './allocation';
export { assertStandaloneVoucherPrice, splitPackagePrice, type PackageContent, type PackageContentShare } from './pricing';
export {
  benefitExpiresAt, benefitState, canTransferSessions, DEFAULT_COMMERCE_SETTINGS, isProtectedUnusedRefund,
  pointsExpireOn, refundDueOn, splitPointsSpend, type BenefitState, type CommerceSettings,
} from './settings';
export { freezePackageVatBases, freezeRowVatBase, receiptVat, type FrozenVatBase, type ReceiptVatInput } from './vat';
export {
  assertExternalCorrection, incrementalShare, quotePackageVoucherReturn, quoteSessionReturn,
  quoteStandaloneVoucherReturn, routeReceiptRefund, splitBenefitUse,
  type BenefitBuckets, type SessionRefundMode, type SessionReturn, type UnitProgress,
  type VoucherRefundBalance, type VoucherRefundStatus,
} from './returns';
