// Backend marketing interface: actual plain helpers, never registrations.
export { marketingAccess, marketingInvitationExpiry, marketingInvitationExpired, requireMarketingPermission, requireEditableDraft } from './accessPolicy';
export { resolveMarketingAttribution } from './attribution';
export { couponUnavailable, couponVersion, holdCouponRedemption, syncCouponRedemption, quoteCouponBooking, repriceCouponBooking, consumeOrderCoupon, syncOrderCouponRedemption, type HoldInput } from './couponRedemptions';
export { captureAffiliateSnapshot, creditMoney, appendCreditChange, syncAffiliateCredit, type AffiliateSnapshot } from './affiliateCredits';
export { readMarketingReport, reportSpend } from './reportRead';
