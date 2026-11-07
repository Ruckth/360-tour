// Shared offer engine (pure, no I/O). Used by the guest quote, admin "test a quote" and, later, POS.
// CONTRACT — implementation owned by the backend work package. Keep these exported types stable.

export type CouponBenefit = { kind: 'percent'; percent: number } | { kind: 'fixed'; amount: number };
export type CouponScope = 'accommodation' | 'services' | 'accommodation_and_services';

/** The rules of one immutable coupon version, as stored in `couponVersions`. */
export type CouponRules = {
	code: string;
	version: number;
	status: 'draft' | 'active' | 'paused' | 'archived';
	benefit: CouponBenefit;
	scope: CouponScope;
	propertySlugs?: string[];
	bookFrom?: string; // YYYY-MM-DD, inclusive, Asia/Bangkok
	bookTo?: string;
	stayFrom?: string;
	stayTo?: string;
	minNights?: number;
	minEligibleSubtotal?: number;
	maxSaving?: number;
	usageLimit?: number;
	discountBudget?: number;
	used: number;
	discountGranted: number;
};

export type QuoteLine =
	| { id: string; kind: 'accommodation'; propertySlug: string; checkIn: string; checkOut: string; nights: number; amount: number }
	| { id: string; kind: 'service'; amount: number; label: string }
	| { id: string; kind: 'extra'; amount: number; label: string };

export type OfferInput = {
	lines: QuoteLine[];
	/** Direct-booking percent for accommodation lines (property.directDiscountPercent); 0 off-web. */
	directDiscountPercent: number;
	/** Booking date, YYYY-MM-DD in Asia/Bangkok. */
	today: string;
	coupon?: CouponRules;
};

export type CouponProblem =
	| { code: 'not_found' }
	| { code: 'not_active' }
	| { code: 'not_started'; startsOn: string }
	| { code: 'expired'; endedOn: string }
	| { code: 'sold_out' }
	| { code: 'budget_used' }
	| { code: 'wrong_property' }
	| { code: 'stay_outside_dates'; stayFrom?: string; stayTo?: string }
	| { code: 'min_nights'; minNights: number; missingNights: number }
	| { code: 'min_subtotal'; minEligibleSubtotal: number; eligibleSubtotal: number }
	| { code: 'nothing_eligible' };

export type OfferResult = {
	subtotal: number;
	/** Which offer the guest gets. `coupon_worse` = valid coupon but the direct offer is better. */
	applied: 'none' | 'direct' | 'coupon';
	couponStatus: 'none' | 'applied' | 'invalid' | 'coupon_worse';
	problem?: CouponProblem;
	directDiscount: number;
	couponDiscount: number; // what the coupon would give (after cap), even when not applied
	capped: boolean;
	discount: number; // the applied discount
	total: number;
	/** Per-line allocation of the applied discount; sums exactly to `discount`. */
	allocation: { lineId: string; discount: number }[];
};

/** "dcnt-f1-20 " -> "DCNT-F1-20" */
export function normalizeCouponCode(raw: string): string {
	return raw.trim().toUpperCase();
}

export function evaluateOffer(_input: OfferInput): OfferResult {
	throw new Error('evaluateOffer: not implemented');
}
