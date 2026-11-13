// POS coupons (marketing release 2b). Pure, no I/O: Convex (pos.ts) and the checkout UI's fixture
// backend share it, as they share orderMath. One coupon per order. It discounts service and
// appointment rows only; stays, rooms, extras and fees are never discounted, and an attached stay
// keeps the price its own booking promotion gave it.
import { v, type Infer } from 'convex/values';
import { lineCouponBase, type LineKind, type PricedLine } from './orderMath';
import { validateMarketingSlug } from './marketingSlugs';
import { evaluateOffer, MAX_QUOTE_SUBTOTAL, normalizeCouponCode, type CouponProblem, type CouponRules } from './offers';

/** Why a coupon can't be used on an order: the engine's reasons plus the POS-only rules. */
export type PosCouponProblem =
	| CouponProblem
	/** The coupon is limited to certain villas. Checkout rows carry no villa, so it is refused. */
	| { code: 'villa_only' }
	/** A stay attached to this order already used this coupon (one use per booking or sale). */
	| { code: 'already_on_stay' }
	/** The eligible rows are above what the engine prices exactly (MAX_QUOTE_SUBTOTAL satang). */
	| { code: 'order_too_large' }
	/** A scanned or pasted short link that is unknown, not active, or carries no active coupon. */
	| { code: 'link_without_offer' };

const plain = <C extends string>(code: C) => v.object({ code: v.literal(code) });
/** Stored on `orders.promotion.problem`; mirrors PosCouponProblem exactly. */
export const posCouponProblemValidator = v.union(
	plain('not_found'), plain('not_active'),
	v.object({ code: v.literal('not_started'), startsOn: v.string() }),
	v.object({ code: v.literal('expired'), endedOn: v.string() }),
	plain('sold_out'), plain('budget_used'), plain('wrong_property'),
	v.object({ code: v.literal('stay_outside_dates'), stayFrom: v.optional(v.string()), stayTo: v.optional(v.string()) }),
	v.object({ code: v.literal('min_nights'), minNights: v.number(), missingNights: v.number() }),
	v.object({ code: v.literal('min_subtotal'), minEligibleSubtotal: v.number(), eligibleSubtotal: v.number() }),
	plain('nothing_eligible'), plain('villa_only'), plain('already_on_stay'), plain('order_too_large'), plain('link_without_offer')
);
// Compile-time check that the validator and the type agree in both directions.
type StoredProblem = Infer<typeof posCouponProblemValidator>;
const _sameProblem: [StoredProblem extends PosCouponProblem ? true : never, PosCouponProblem extends StoredProblem ? true : never] = [true, true];
void _sameProblem;

/** The order's coupon, as pos.getOrder returns it. */
export type OrderPromotionView = {
	code: string;
	couponVersion: number;
	/** The rows' coupon shares added up now: 0 while `problem` is set. */
	discount: number;
	/** Set when the coupon no longer fits the order as it stands. Payment is refused until it is fixed or removed. */
	problem: PosCouponProblem | null;
	/** Customer terms of the frozen version, if any. */
	terms: string | null;
};

export type PosCouponLine = PricedLine & { id: string; kind: LineKind; fee?: unknown };

export type OrderCouponInput = {
	lines: readonly PosCouponLine[];
	/** The rules of the order's frozen coupon version, with the coupon's live status and counters. */
	coupon: CouponRules;
	/** Business date, YYYY-MM-DD in Asia/Bangkok: today when applying, editing and settling. */
	today: string;
	/** True when a booking row on this order has a promotion with the same coupon. */
	usedOnAttachedStay?: boolean;
};

export type OrderCouponResult =
	| {
			ok: true;
			/** Integer satang; equals the sum of `allocation`. */
			discount: number;
			capped: boolean;
			eligibleSubtotal: number;
			/** One entry per eligible row, in input order; other rows get no coupon share. */
			allocation: { lineId: string; discount: number }[];
	  }
	| { ok: false; problem: PosCouponProblem };

/** Services sold at the desk and attached appointments. Never stays, rooms, extras or fee rows. */
export function isCouponEligibleLine(line: { kind: LineKind; fee?: unknown }): boolean {
	return (line.kind === 'service' || line.kind === 'appointment') && !line.fee;
}

export function evaluateOrderCoupon({ lines, coupon, today, usedOnAttachedStay }: OrderCouponInput): OrderCouponResult {
	// A stays-only coupon has nothing to discount at the desk, whatever else is wrong with it.
	if (coupon.scope === 'accommodation') return { ok: false, problem: { code: 'nothing_eligible' } };
	const eligible = lines.filter(isCouponEligibleLine);
 const quoteLines = eligible.map(line => ({ id: line.id, kind: 'service', label: '', amount: lineCouponBase(line) } as const));
 const eligibleUnits = quoteLines.reduce((sum, line) => sum + line.amount, 0);
 if (eligibleUnits > MAX_QUOTE_SUBTOTAL) return { ok: false, problem: { code: 'order_too_large' } };
 const result = evaluateOffer({ lines: quoteLines, directDiscountPercent: 0, today, coupon });
 if (result.problem) return { ok: false, problem: result.problem };
	if (coupon.propertySlugs?.length) return { ok: false, problem: { code: 'villa_only' } };
	if (usedOnAttachedStay) return { ok: false, problem: { code: 'already_on_stay' } };
	// Nothing to give: a budget remainder under one unit, or a percentage too small to round to one.
	if (result.couponStatus !== 'applied' || result.couponDiscount <= 0) return { ok: false, problem: { code: result.capped ? 'budget_used' : 'nothing_eligible' } };
	return {
		ok: true,
		discount: result.couponDiscount,
		capped: result.capped,
		eligibleSubtotal: eligibleUnits,
		allocation: result.allocation.map((share) => ({ lineId: share.lineId, discount: share.discount }))
	};
}

/** What staff typed, scanned or pasted, before the server looks it up. */
export type CouponInput =
	| { kind: 'code'; code: string }
	| { kind: 'slug'; slug: string }
	| { kind: 'invalid'; reason: 'empty' | 'outside_link' | 'no_offer' };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const BARE_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|\?|$)/i;

/**
 * A typed code ("dcnt-spa-500"), or a link on this site: one carrying `?coupon=CODE` or `?mk=SLUG`,
 * or a short link such as /q1 or https://book.example/q1 (a USB/Bluetooth scanner types the QR's URL). Links
 * on any other host are refused, and nothing is ever fetched.
 */
export function parseCouponInput(raw: string, siteOrigin: string): CouponInput {
	const text = raw.trim();
	if (!text) return { kind: 'invalid', reason: 'empty' };
	const isLink = SCHEME.test(text) || text.startsWith('/') || BARE_HOST.test(text);
	if (!isLink) return { kind: 'code', code: normalizeCouponCode(text) };
	let url: URL;
	let site: URL;
	try {
		site = new URL(siteOrigin);
		url = new URL(SCHEME.test(text) ? text : text.startsWith('/') ? site.origin + text : `${site.protocol}//${text}`);
	} catch {
		return { kind: 'invalid', reason: 'no_offer' };
	}
	if (url.host.toLowerCase() !== site.host.toLowerCase()) return { kind: 'invalid', reason: 'outside_link' };
	const coupon = url.searchParams.get('coupon')?.trim();
	if (coupon) return { kind: 'code', code: normalizeCouponCode(coupon) };
	// A page a short link already redirected to (…/booking?mk=q1) still names its link.
	const viaLink = url.searchParams.get('mk')?.trim();
	if (viaLink && !validateMarketingSlug(viaLink).reason) return { kind: 'slug', slug: viaLink };
	let path: string;
	try {
		path = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
	} catch {
		return { kind: 'invalid', reason: 'no_offer' };
	}
	const checked = validateMarketingSlug(path);
	return checked.reason ? { kind: 'invalid', reason: 'no_offer' } : { kind: 'slug', slug: checked.slug };
}

const money = (baht: number) => `฿${(baht / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const day = (iso: string) =>
	new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** Staff-facing explanation, used for ConvexError messages and by the checkout UI. */
export function posCouponMessage(problem: PosCouponProblem): string {
	switch (problem.code) {
		case 'not_found': return 'No coupon has this code. Check the spelling.';
		case 'not_active': return 'This coupon is paused or not published yet.';
		case 'not_started': return `This coupon starts on ${day(problem.startsOn)}.`;
		case 'expired': return `This coupon ended on ${day(problem.endedOn)}.`;
		case 'sold_out': return 'This coupon has no uses left.';
		case 'budget_used': return 'This coupon has used up its discount budget.';
		case 'wrong_property': return 'This coupon does not cover this villa.';
		case 'stay_outside_dates': return 'This coupon does not cover these stay dates.';
		case 'min_nights': return `This coupon needs a stay of at least ${problem.minNights} night${problem.minNights === 1 ? '' : 's'}, so it can't be used on checkout items.`;
		case 'min_subtotal': return `Eligible items come to ${money(problem.eligibleSubtotal)}. This coupon needs at least ${money(problem.minEligibleSubtotal)}.`;
		case 'nothing_eligible': return 'This coupon does not cover any item on this order.';
		case 'villa_only': return "This coupon is limited to certain villas, so it can't be used at checkout.";
		case 'already_on_stay': return 'The stay on this order already used this coupon.';
		case 'order_too_large': return 'This order is too large for a coupon. Split it into two orders.';
		case 'link_without_offer': return 'This link has no active offer.';
	}
}

/** Staff-facing explanation for input refused before any lookup. */
export function couponInputMessage(reason: Extract<CouponInput, { kind: 'invalid' }>['reason']): string {
	switch (reason) {
		case 'empty': return 'Enter a coupon code, or scan or paste an offer link.';
		case 'outside_link': return 'Only offer links from this site can be used.';
		case 'no_offer': return 'This link has no coupon. Enter the code instead.';
	}
}
