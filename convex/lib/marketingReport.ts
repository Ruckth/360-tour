import { roundRatio } from "../shared/money";
import { v, type Infer } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { isIsoDate } from './dates';
import type { ATTRIBUTION_MODEL } from '../shared/marketingAttribution';

/**
 * Release 3b: what the marketing dashboard reads.
 *
 * The server (convex/marketingReport.ts getReport) returns one flat list of sales for the range,
 * with their money and attribution already worked out. The admin UI groups them by source,
 * campaign, link or coupon, filters by property and switches last/first touch without another
 * read. The CSV export is built from the same data.
 *
 * Money rules (each fixed by a convex-test gate):
 * - One sale is counted once. A stay balance paid at the POS is on the stay (its bookingPayments row,
 *   origin `pos`), so the order that took it counts only its other money: tenders minus that stay part.
 *   Exception: an old order that charged a stay before stay payments were itemised has no such row, so
 *   that money and its refunds stay on the order and are taken off the stay.
 * - Older stay money with no payment row has no date of its own: it is dated by the stay's `paidAt`.
 * - A desk payment for an appointment is its own sale, also when the appointment belongs to a stay.
 * - Collected is money received (recorded payments, never `orders.total`). Cancelled payment rows and
 *   orders voided with "no money received" count nothing. An order voided with the money kept counts.
 * - Refunds are their own figure, dated by their business date. Net = collected - refunded. Net is not profit.
 * - Discount is the coupon discount only, counted on first payment or checkout settlement.
 * - Days are Bangkok business days (UTC+7, `resortLocalParts`). Money uses its business date
 *   (`effectiveAt`, an order's `paymentEffectiveAt ?? paidAt`), not when it was typed in.
 * - THB only. Rows in another currency are left out and counted in `excluded.nonThb`.
 */

/** Live ranges are capped so one read stays inside the read budget. */
export const MAX_REPORT_DAYS = 92;

/** cohort: sales made in the range, with all their money to date. cash: money and coupon settlements dated in the range. */
export type ReportBasis = 'cohort' | 'cash';
export const reportBasisValidator = v.union(v.literal('cohort'), v.literal('cash'));

/**
 * tracked: a web or web-chat stay whose snapshot has a link, or a POS coupon applied from a scanned link.
 * unknown: web or web-chat with no link (typed address, declined measurement, other device, direct visit).
 * staff: admin bookings, checkout orders and desk appointments without a scanned link.
 * messaging: stays booked through LINE, WhatsApp, Messenger or Instagram.
 */
export type ReportBucket = 'tracked' | 'unknown' | 'staff' | 'messaging';

/** A link touch. Stays use the frozen booking snapshot; scanned POS coupons use the link as it is now. */
export type ReportTouch = {
	linkId: Id<'marketingLinks'>;
	campaignId: Id<'marketingCampaigns'>;
	slug: string;
	campaignName: string;
	source: string;
	medium: string;
	entry: 'link' | 'qr';
};

export type ReportSale = {
	kind: 'stay' | 'order' | 'appointment';
	/** The booking, bill or appointments id. */
	id: string;
	/** Staff-facing: guest or customer name, else "Walk-in". */
	label: string;
	/** Confirmation code, "Order #118" or the appointment's service name. */
	ref?: string;
	/** Stays, and orders attached to a stay. Sales without one show only under All properties. */
	propertyId?: Id<'properties'>;
	/** web_chat: a web stay booked through the concierge. pos: checkout order. desk: appointment desk payment. */
	channel: 'web' | 'web_chat' | 'messaging' | 'admin' | 'pos' | 'desk';
	bucket: ReportBucket;
	/** How the touch is known. Only on tracked sales. */
	evidence?: 'tracked' | 'current_link' | 'scanned';
	/** Verified attribution.sessionId and its recorded cohort; never includes visitor identity. */
	session?: { id: Id<'marketingSessions'>; day: string; linkId?: Id<'marketingLinks'>; campaignId?: Id<'marketingCampaigns'> };
	/** Coupon attribution is retained, but a custom price grants no reportable coupon discount. */
	customPrice?: boolean;
	last?: ReportTouch;
	/** Stays with tracked evidence only. Scanned and current-link sales have no separate first touch. */
	first?: ReportTouch;
	coupon?: { couponId: Id<'coupons'>; code: string; campaignId?: Id<'marketingCampaigns'> };
	/** Stays: the day booked. Orders: settlement day. Appointments: the day first paid. */
	createdDay: string;
	/** Day the first own money was received; absent without actual cash, including coupon-only orders. */
	paidDay?: string;
	/** Checkout orders: day settled, including fully coupon-covered orders; corrected business date. */
	settlementDay?: string;
	/** Stays/appointments: at least one recorded payment. Orders: settled, including coupon-only. Refunds keep it paid. */
	paid: boolean;
	/** Money received to date, every date. A stay's equals its stay money gross, less any old order's part (see above). */
	collected: number;
	/** Refunds to date, every date, as a positive number. */
	refunded: number;
	/** Coupon discount granted; 0 before first payment or checkout settlement. */
	discount: number;
};

/** Cash basis only: one dated payment or refund. Amounts are positive. */
export type ReportMoneyEvent = { saleId: string; kind: 'payment' | 'refund'; day: string; amount: number };

export type ReportSpend = {
	id: Id<'marketingSpend'>;
	campaignId: Id<'marketingCampaigns'>;
	/** Whole baht for the whole entry, spread evenly over its days. */
	amount: number;
	from: string;
	to: string;
	note?: string;
};

export type ReportData = {
	asOf: number;
	from: string;
	to: string;
	basis: ReportBasis;
	timeZone: 'Asia/Bangkok';
	currency: 'THB';
	model: typeof ATTRIBUTION_MODEL;
	/**
	 * cohort: paid stays booked in range, checkout orders settled in range and desk appointments first paid in range.
	 * cash: every sale with an event in `events` or a positive coupon discount settled in range.
	 */
	sales: ReportSale[];
	/** Cash basis: payments and refunds dated in the range, each pointing at a sale above. Empty for cohort. */
	events: ReportMoneyEvent[];
	/** Consented visit sessions per day and link (linkId absent = arrived without a link). Diagnostic, not people. */
	sessions: { day: string; linkId?: Id<'marketingLinks'>; campaignId?: Id<'marketingCampaigns'>; count: number }[];
	/** Paid-stay sessions started in range, independently of the selected money dates. */
	convertedSessions?: NonNullable<ReportSale['session']>[];
	campaigns: { id: Id<'marketingCampaigns'>; name: string; source: string; medium: string; status: string; budget?: number }[];
	links: { id: Id<'marketingLinks'>; slug: string; name: string; campaignId: Id<'marketingCampaigns'>; entry: 'link' | 'qr'; status: string }[];
	coupons: { id: Id<'coupons'>; code: string; campaignId?: Id<'marketingCampaigns'>; status: string }[];
	properties: { id: Id<'properties'>; name: string }[];
	/** Spend entries that overlap the range (deleted ones left out). */
	spend: ReportSpend[];
	excluded: { nonThb: number };
	/** The read budget ran out: figures are incomplete and the UI must say so. */
	truncated: boolean;
};

/** Days from `from` to `to` inclusive, or null when either is not a YYYY-MM-DD date or to < from. */
export function reportDayCount(from: string, to: string): number | null {
	if (!isIsoDate(from) || !isIsoDate(to)) return null;
	const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
	return days >= 1 ? days : null;
}

const RESORT_OFFSET_MS = 7 * 60 * 60 * 1000;
/** [start, end) instants of a Bangkok day range. */
export function reportRangeBounds(from: string, to: string): { start: number; end: number } {
	return {
		start: Date.parse(`${from}T00:00:00Z`) - RESORT_OFFSET_MS,
		end: Date.parse(`${to}T00:00:00Z`) + 86_400_000 - RESORT_OFFSET_MS
	};
}

// ---------------------------------------------------------------- spend

export type SpendDraft = { campaignId: Id<'marketingCampaigns'>; amount: number; from: string; to: string; note?: string };
export const MAX_SPEND_AMOUNT = 10_000_000_000;
export const MAX_SPEND_DAYS = 366;
export const MAX_SPEND_NOTE = 500;

/** Shared by the spend dialog and saveSpend. Returns the first problem in plain words, or null. */
export function validateSpend(draft: Omit<SpendDraft, 'campaignId'>): string | null {
	if (!Number.isInteger(draft.amount) || draft.amount < 1) return 'Enter a positive amount with at most two decimals.';
	if (draft.amount > MAX_SPEND_AMOUNT) return 'That amount is too large.';
	const days = reportDayCount(draft.from, draft.to);
	if (days === null) return 'Choose a start date on or before the end date.';
	if (days > MAX_SPEND_DAYS) return 'One entry can cover at most a year.';
	if ((draft.note ?? '').length > MAX_SPEND_NOTE) return 'Keep the note under 500 characters.';
	return null;
}

/** The part of a spend entry that falls in [from, to], allocated by cumulative rounded days, preserving the whole entry across adjacent ranges. */
export function spendInRange(entry: Pick<ReportSpend, 'amount' | 'from' | 'to'>, from: string, to: string): number {
	const start = entry.from > from ? entry.from : from;
	const end = entry.to < to ? entry.to : to;
	const overlap = reportDayCount(start, end);
	const total = reportDayCount(entry.from, entry.to);
	if (!overlap || !total) return 0;
  const before = reportDayCount(entry.from, start)! - 1;
  return roundRatio(BigInt(entry.amount) * BigInt(before + overlap), total) - roundRatio(BigInt(entry.amount) * BigInt(before), total);
}

// ---------------------------------------------------------------- coupon refusals

/** Engine codes (lib/offers.ts), POS codes (lib/posCoupons.ts), the settle-time change, and "direct offer was better". */
export const couponRefusalProblemValidator = v.union(
	v.literal('not_found'), v.literal('not_active'), v.literal('not_started'), v.literal('expired'), v.literal('sold_out'),
	v.literal('budget_used'), v.literal('wrong_property'), v.literal('stay_outside_dates'), v.literal('min_nights'),
	v.literal('min_subtotal'), v.literal('nothing_eligible'),
	v.literal('villa_only'), v.literal('already_on_stay'), v.literal('order_too_large'), v.literal('link_without_offer'),
	v.literal('coupon_changed'), v.literal('coupon_worse')
);
export type CouponRefusalProblem = Infer<typeof couponRefusalProblemValidator>;
export const COUPON_REFUSAL_PROBLEMS: readonly CouponRefusalProblem[] = couponRefusalProblemValidator.members.map(m => m.value);

/** booking: the guest booking funnel. admin_booking: staff New booking. pos: checkout order. */
export const couponRefusalSurfaceValidator = v.union(v.literal('booking'), v.literal('admin_booking'), v.literal('pos'));
export type CouponRefusalSurface = Infer<typeof couponRefusalSurfaceValidator>;

export type CouponRefusalSummary = {
	/** First day counted (YYYY-MM-DD, Bangkok). */
	since: string;
	/** Refusals only: `coupon_worse` (valid, but the direct offer was better) is not a refusal and is left out. */
	total: number;
	/** Every problem with a count, including `coupon_worse`, which the UI shows apart as "not used". */
	byProblem: { problem: CouponRefusalProblem; count: number }[];
	/** Refusals only, like `total`. */
	bySurface: { surface: CouponRefusalSurface; count: number }[];
};
