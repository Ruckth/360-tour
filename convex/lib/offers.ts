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
	/** 'coupon' with a services-only coupon still includes the direct offer on accommodation (see `discount`). */
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

/** Stable largest-remainder allocation: equal remainders follow input line order. */
function allocate(lines: QuoteLine[], eligible: QuoteLine[], discount: number): OfferResult['allocation'] {
	const total = eligible.reduce((sum, line) => sum + line.amount, 0);
	const shares = eligible.map((line, index) => {
		const exact = total > 0 ? discount * line.amount / total : 0;
		return { line, index, value: Math.floor(exact), remainder: exact - Math.floor(exact) };
	});
	let remaining = discount - shares.reduce((sum, share) => sum + share.value, 0);
	for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
		if (remaining-- <= 0) break;
		share.value++;
	}
	const byLine = new Map(shares.map((share) => [share.line, share.value]));
	return lines.map((line) => ({ lineId: line.id, discount: byLine.get(line) ?? 0 }));
}

export function evaluateOffer(input: OfferInput): OfferResult {
	const { lines, coupon, today } = input;
	const accommodation = lines.filter((line) => line.kind === 'accommodation');
	const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
	const accommodationSubtotal = accommodation.reduce((sum, line) => sum + line.amount, 0);
	const directDiscount = Math.min(Math.floor(accommodationSubtotal), Math.max(0,
		Math.round(accommodationSubtotal * Math.min(100, input.directDiscountPercent) / 100)));
	let problem: CouponProblem | undefined;
	let eligible: QuoteLine[] = [];
	let couponDiscount = 0;
	let capped = false;
	if (coupon) {
		const nights = accommodation.reduce((sum, line) => sum + line.nights, 0);
		eligible = lines.filter((line) => line.kind !== 'extra' && (
			coupon.scope === 'accommodation_and_services' ||
			(coupon.scope === 'accommodation' ? line.kind === 'accommodation' : line.kind === 'service')
		));
		const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.amount, 0);
		if (coupon.status !== 'active') problem = { code: 'not_active' };
		else if (coupon.bookFrom && today < coupon.bookFrom) problem = { code: 'not_started', startsOn: coupon.bookFrom };
		else if (coupon.bookTo && today > coupon.bookTo) problem = { code: 'expired', endedOn: coupon.bookTo };
		else if (coupon.usageLimit !== undefined && coupon.used >= coupon.usageLimit) problem = { code: 'sold_out' };
		else if (coupon.discountBudget !== undefined && coupon.discountGranted >= coupon.discountBudget) problem = { code: 'budget_used' };
		else if (coupon.propertySlugs?.length && accommodation.some((line) => !coupon.propertySlugs!.includes(line.propertySlug))) problem = { code: 'wrong_property' };
		else if (accommodation.some((line) => {
			// Checkout is exclusive; the final occupied night may equal stayTo.
			const lastNight = new Date(Date.parse(`${line.checkOut}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
			return (coupon.stayFrom && line.checkIn < coupon.stayFrom) || (coupon.stayTo && lastNight > coupon.stayTo);
		})) problem = { code: 'stay_outside_dates', ...(coupon.stayFrom && { stayFrom: coupon.stayFrom }), ...(coupon.stayTo && { stayTo: coupon.stayTo }) };
		else if (coupon.minNights !== undefined && nights < coupon.minNights) problem = { code: 'min_nights', minNights: coupon.minNights, missingNights: coupon.minNights - nights };
		else if (eligibleSubtotal <= 0) problem = { code: 'nothing_eligible' };
		else if (coupon.minEligibleSubtotal !== undefined && eligibleSubtotal < coupon.minEligibleSubtotal) problem = { code: 'min_subtotal', minEligibleSubtotal: coupon.minEligibleSubtotal, eligibleSubtotal };
		else {
			couponDiscount = Math.min(Math.floor(eligibleSubtotal), Math.round(coupon.benefit.kind === 'percent'
				? eligibleSubtotal * coupon.benefit.percent / 100 : coupon.benefit.amount));
			const cap = Math.min(coupon.maxSaving ?? Infinity,
				coupon.discountBudget === undefined ? Infinity : coupon.discountBudget - coupon.discountGranted);
			if (couponDiscount > cap) {
				couponDiscount = Math.max(0, Math.floor(cap));
				capped = true;
			}
		}
	}
	// A services-only coupon never overlaps the direct offer (accommodation only), so both apply.
	// Any coupon that covers accommodation competes with the direct offer: the better one wins.
	const stacks = !!coupon && !problem && coupon.scope === 'services';
	const applied = coupon && !problem
		? stacks || couponDiscount > directDiscount ? 'coupon' : 'direct'
		: directDiscount > 0 ? 'direct' : 'none';
	const discount = stacks ? directDiscount + couponDiscount : applied === 'coupon' ? couponDiscount : directDiscount;
	const allocation = stacks
		? sumAllocations(allocate(lines, accommodation, directDiscount), allocate(lines, eligible, couponDiscount))
		: allocate(lines, applied === 'coupon' ? eligible : accommodation, discount);
	return {
		subtotal, applied,
		couponStatus: !coupon ? 'none' : problem ? 'invalid' : applied === 'coupon' ? 'applied' : 'coupon_worse',
		...(problem && { problem }), directDiscount, couponDiscount, capped, discount, total: subtotal - discount,
		allocation
	};
}

function sumAllocations(a: OfferResult['allocation'], b: OfferResult['allocation']): OfferResult['allocation'] {
	return a.map((entry, index) => ({ lineId: entry.lineId, discount: entry.discount + b[index].discount }));
}
