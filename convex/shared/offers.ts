import { percentageOf } from './money';
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
	/** Release 2: slots / discount held by unpaid bookings; count toward usageLimit / discountBudget. */
	held?: number;
	heldDiscount?: number;
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
	/** Which offer the guest gets. `coupon_worse` = valid coupon but the direct offer is better.
	 * 'coupon' with a services-only coupon still includes the direct offer on accommodation (see `discount`). */
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

/**
 * Largest quote subtotal the engine accepts. Every line and discount is at most this, so
 * discount × line ≤ 8.1e15 < 2^53 and the integer allocation below is exact.
 * (A year in the largest villa is about ฿4.4M.)
 */
export const MAX_QUOTE_SUBTOTAL = 9_000_000_000;

/** Stable largest-remainder allocation: equal remainders follow input line order. */
function allocate(eligible: QuoteLine[], discount: number): Map<QuoteLine, number> {
	const total = eligible.reduce((sum, line) => sum + line.amount, 0);
	const shares = eligible.map((line, index) => {
		const product = BigInt(discount) * BigInt(line.amount);
  const remainder = total > 0 ? Number(product % BigInt(total)) : 0;
  return { line, index, remainder, value: total > 0 ? Number(product / BigInt(total)) : 0 };
	});
	let remaining = discount - shares.reduce((sum, share) => sum + share.value, 0);
	for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
		if (remaining-- <= 0) break;
		share.value++;
	}
	return new Map(shares.map((share) => [share.line, share.value]));
}

/** First failing rule wins; keep this order stable for guest-facing explanations. */
function couponProblem(coupon: CouponRules, accommodation: Extract<QuoteLine, { kind: 'accommodation' }>[], today: string, eligibleSubtotal: number): CouponProblem | undefined {
	if (coupon.status !== 'active') return { code: 'not_active' };
	if (coupon.bookFrom && today < coupon.bookFrom) return { code: 'not_started', startsOn: coupon.bookFrom };
	if (coupon.bookTo && today > coupon.bookTo) return { code: 'expired', endedOn: coupon.bookTo };
	if (coupon.usageLimit !== undefined && coupon.used + (coupon.held ?? 0) >= coupon.usageLimit) return { code: 'sold_out' };
	if (coupon.discountBudget !== undefined && coupon.discountGranted + (coupon.heldDiscount ?? 0) >= coupon.discountBudget) return { code: 'budget_used' };
	if (coupon.propertySlugs?.length && accommodation.some((line) => !coupon.propertySlugs!.includes(line.propertySlug))) return { code: 'wrong_property' };
	if (accommodation.some((line) => {
		// Checkout is exclusive; the final occupied night may equal stayTo.
		const lastNight = new Date(Date.parse(`${line.checkOut}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
		return (coupon.stayFrom && line.checkIn < coupon.stayFrom) || (coupon.stayTo && lastNight > coupon.stayTo);
	})) return { code: 'stay_outside_dates', ...(coupon.stayFrom && { stayFrom: coupon.stayFrom }), ...(coupon.stayTo && { stayTo: coupon.stayTo }) };
	const nights = accommodation.reduce((sum, line) => sum + line.nights, 0);
	if (coupon.minNights !== undefined && nights < coupon.minNights) return { code: 'min_nights', minNights: coupon.minNights, missingNights: coupon.minNights - nights };
	if (eligibleSubtotal <= 0) return { code: 'nothing_eligible' };
	if (coupon.minEligibleSubtotal !== undefined && eligibleSubtotal < coupon.minEligibleSubtotal) return { code: 'min_subtotal', minEligibleSubtotal: coupon.minEligibleSubtotal, eligibleSubtotal };
}

export function evaluateOffer(input: OfferInput): OfferResult {
	const { lines, coupon, today } = input;
	// Quotes use integer satang. Reject invalid callers before largest-remainder rounding.
	if (lines.some(line => !Number.isSafeInteger(line.amount) || line.amount < 0)) {
		throw new Error('Quote line amounts must be non-negative safe integers');
	}
	const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
	if (subtotal > MAX_QUOTE_SUBTOTAL) throw new Error(`Quote subtotal must be at most ${MAX_QUOTE_SUBTOTAL}`);
	const accommodation = lines.filter((line) => line.kind === 'accommodation');
	const eligible = coupon ? lines.filter((line) => line.kind !== 'extra' && (
		coupon.scope === 'accommodation_and_services' ||
		(coupon.scope === 'accommodation' ? line.kind === 'accommodation' : line.kind === 'service')
	)) : [];
	const eligibleSubtotal = eligible.reduce((sum, line) => sum + line.amount, 0);
	const problem = coupon ? couponProblem(coupon, accommodation, today, eligibleSubtotal) : undefined;

	const accommodationSubtotal = accommodation.reduce((sum, line) => sum + line.amount, 0);
	const directDiscount = Math.min(accommodationSubtotal, Math.max(0,
		percentageOf(accommodationSubtotal, input.directDiscountPercent)));
	let couponDiscount = 0;
	let capped = false;
	if (coupon && !problem) {
		couponDiscount = Math.min(eligibleSubtotal, coupon.benefit.kind === 'percent' ? percentageOf(eligibleSubtotal, coupon.benefit.percent) : coupon.benefit.amount);
		const cap = Math.min(coupon.maxSaving ?? Infinity,
			coupon.discountBudget === undefined ? Infinity : coupon.discountBudget - coupon.discountGranted - (coupon.heldDiscount ?? 0));
		if (couponDiscount > cap) {
			couponDiscount = Math.max(0, Math.floor(cap));
			capped = true;
		}
	}
	// A services-only coupon never overlaps the direct offer (accommodation only), so both apply.
	// Any coupon that covers accommodation competes with the direct offer: the better one wins.
	const stacks = !!coupon && !problem && coupon.scope === 'services';
	const applied = coupon && !problem
		? stacks || couponDiscount > directDiscount ? 'coupon' : 'direct'
		: directDiscount > 0 ? 'direct' : 'none';
	const discount = stacks ? directDiscount + couponDiscount : applied === 'coupon' ? couponDiscount : directDiscount;
	const allocation = applied === 'coupon' ? allocate(eligible, couponDiscount) : allocate(accommodation, directDiscount);
	if (stacks) {
		for (const [line, amount] of allocate(accommodation, directDiscount)) allocation.set(line, amount);
	}
	return {
		subtotal, applied,
		couponStatus: !coupon ? 'none' : problem ? 'invalid' : applied === 'coupon' ? 'applied' : 'coupon_worse',
		...(problem && { problem }), directDiscount, couponDiscount, capped, discount, total: subtotal - discount,
		allocation: lines.map((line) => ({ lineId: line.id, discount: allocation.get(line) ?? 0 }))
	};
}
