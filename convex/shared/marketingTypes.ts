import type { Doc, Id } from '../_generated/dataModel';

export type CampaignRow = Doc<'marketingCampaigns'> & {
	linkCount: number; couponCount: number; opens: number;
	/** A child read reached 500, so the counts and opens are lower bounds. */
	countsCapped: boolean;
};

export type LinkRow = Doc<'marketingLinks'> & { campaignName: string; couponCode?: string; shortUrlPath: string };

export type CouponRow = Doc<'coupons'> & { rules: Doc<'couponVersions'>; campaignName?: string };

/** Release 2: one coupon use, newest first in CouponDetail. */
export type RedemptionRow = Doc<'couponRedemptions'> & {
	booking?: { guestName: string; checkIn: string; checkOut: string; confirmationCode?: string };
	/** Release 2b: a checkout order's use. `receiptNumber` is formatted ("R-000123"); null if never paid. */
	order?: { orderId: Id<'orders'>; title: string; receiptNumber: string | null; customerName: string | null };
};

export type CouponDetail = CouponRow & { versions: Doc<'couponVersions'>[]; links: LinkRow[]; redemptions: RedemptionRow[] };

export type SlugCheck = { ok: true; slug: string } | { ok: false; slug: string; reason: 'empty' | 'invalid' | 'reserved' | 'taken' };

export type ResolvedLink = {
	/** Relative path to redirect to, with locale prefix and `?mk=<slug>` (and `&coupon=` when attached). */
	path: string;
	status: 'active' | 'paused' | 'archived';
	/** Paused/archived links and unavailable villas resolve safely with the offer removed. */
	offerRemoved: boolean;
	couponCode?: string;
};
