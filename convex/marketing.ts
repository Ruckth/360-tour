// Marketing release 1: campaigns, short links, QR entry and the coupon catalog.
// CONTRACT — names, args and return types are fixed so the admin UI and backend can be built in parallel.
// Handlers marked "not implemented" are owned by the backend work package.
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import type { OfferResult } from './lib/offers';

const campaignStatus = v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('ended'), v.literal('archived'));
const linkStatus = v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('archived'));
const couponStatus = linkStatus;
const destination = v.union(
	v.object({ kind: v.literal('home') }),
	v.object({ kind: v.literal('booking'), propertySlug: v.optional(v.string()) }),
	v.object({ kind: v.literal('villa'), propertySlug: v.string() }),
	v.object({ kind: v.literal('experiences') }),
	v.object({ kind: v.literal('chat') })
);
const benefit = v.union(
	v.object({ kind: v.literal('percent'), percent: v.number() }),
	v.object({ kind: v.literal('fixed'), amount: v.number() })
);
const couponRules = {
	benefit,
	scope: v.union(v.literal('accommodation'), v.literal('services'), v.literal('accommodation_and_services')),
	propertySlugs: v.optional(v.array(v.string())),
	bookFrom: v.optional(v.string()),
	bookTo: v.optional(v.string()),
	stayFrom: v.optional(v.string()),
	stayTo: v.optional(v.string()),
	minNights: v.optional(v.number()),
	minEligibleSubtotal: v.optional(v.number()),
	maxSaving: v.optional(v.number()),
	usageLimit: v.optional(v.number()),
	discountBudget: v.optional(v.number()),
	terms: v.optional(v.string())
};
const quoteArgs = {
	code: v.string(),
	propertySlug: v.string(),
	checkIn: v.string(),
	checkOut: v.string(),
	services: v.optional(v.array(v.object({ label: v.string(), amount: v.number() })))
};

export type CampaignRow = Doc<'marketingCampaigns'> & { linkCount: number; couponCount: number; opens: number };
export type LinkRow = Doc<'marketingLinks'> & { campaignName: string; couponCode?: string; shortUrlPath: string };
export type CouponRow = Doc<'coupons'> & { rules: Doc<'couponVersions'>; campaignName?: string };
export type CouponDetail = CouponRow & { versions: Doc<'couponVersions'>[]; links: LinkRow[] };
export type SlugCheck = { ok: true; slug: string } | { ok: false; slug: string; reason: 'empty' | 'invalid' | 'reserved' | 'taken' };
export type ResolvedLink = {
	/** Relative path to redirect to, with locale prefix and `?mk=<slug>` (and `&coupon=` when attached). */
	path: string;
	status: 'active' | 'paused' | 'archived';
	/** Paused/archived links still resolve to a safe destination with the offer removed. */
	offerRemoved: boolean;
	campaignName: string;
	couponCode?: string;
};

const todo = (name: string): never => {
	throw new Error(`${name}: not implemented`);
};

// ---------- Admin queries ----------

export const listCampaigns = query({
	args: { status: v.optional(campaignStatus) },
	handler: async (_ctx, _args): Promise<CampaignRow[]> => todo('listCampaigns')
});

export const listLinks = query({
	args: { campaignId: v.optional(v.id('marketingCampaigns')), status: v.optional(linkStatus) },
	handler: async (_ctx, _args): Promise<LinkRow[]> => todo('listLinks')
});

export const listCoupons = query({
	args: { status: v.optional(couponStatus) },
	handler: async (_ctx, _args): Promise<CouponRow[]> => todo('listCoupons')
});

export const getCoupon = query({
	args: { couponId: v.id('coupons') },
	handler: async (_ctx, _args): Promise<CouponDetail | null> => todo('getCoupon')
});

export const checkSlug = query({
	args: { slug: v.string(), linkId: v.optional(v.id('marketingLinks')) },
	handler: async (_ctx, _args): Promise<SlugCheck> => todo('checkSlug')
});

/** Admin "test a quote": same engine as the guest, ignores draft/paused status so drafts can be tested. */
export const testQuote = query({
	args: quoteArgs,
	handler: async (_ctx, _args): Promise<OfferResult> => todo('testQuote')
});

// ---------- Admin mutations ----------

export const saveCampaign = mutation({
	args: {
		campaignId: v.optional(v.id('marketingCampaigns')),
		name: v.string(),
		source: v.string(),
		medium: v.string(),
		startsOn: v.optional(v.string()),
		endsOn: v.optional(v.string()),
		budget: v.optional(v.number()),
		notes: v.optional(v.string())
	},
	handler: async (_ctx, _args): Promise<Id<'marketingCampaigns'>> => todo('saveCampaign')
});

export const setCampaignStatus = mutation({
	args: { campaignId: v.id('marketingCampaigns'), status: campaignStatus },
	handler: async (_ctx, _args): Promise<null> => todo('setCampaignStatus')
});

export const saveLink = mutation({
	args: {
		linkId: v.optional(v.id('marketingLinks')),
		slug: v.string(),
		name: v.string(),
		campaignId: v.id('marketingCampaigns'),
		placement: v.optional(v.string()),
		destination,
		locale: v.optional(v.string()),
		couponId: v.optional(v.id('coupons')),
		entry: v.union(v.literal('link'), v.literal('qr'))
	},
	handler: async (_ctx, _args): Promise<Id<'marketingLinks'>> => todo('saveLink')
});

export const setLinkStatus = mutation({
	args: { linkId: v.id('marketingLinks'), status: linkStatus },
	handler: async (_ctx, _args): Promise<null> => todo('setLinkStatus')
});

/** Creates the coupon, or writes a new immutable version when any rule changes. Code is fixed after the first redemption. */
export const saveCoupon = mutation({
	args: { couponId: v.optional(v.id('coupons')), code: v.string(), campaignId: v.optional(v.id('marketingCampaigns')), ...couponRules },
	handler: async (_ctx, _args): Promise<{ couponId: Id<'coupons'>; version: number }> => todo('saveCoupon')
});

export const setCouponStatus = mutation({
	args: { couponId: v.id('coupons'), status: couponStatus },
	handler: async (_ctx, _args): Promise<null> => todo('setCouponStatus')
});

// ---------- Public ----------

/** Short-link resolver used by the `/<slug>` route. Returns null for unknown slugs. */
export const resolveLink = query({
	args: { slug: v.string() },
	handler: async (_ctx, _args): Promise<ResolvedLink | null> => todo('resolveLink')
});

/** Counts a raw open. Bots are stored but excluded from counts; rate-limited per link. */
export const recordOpen = mutation({
	args: { slug: v.string(), bot: v.boolean() },
	handler: async (_ctx, _args): Promise<null> => todo('recordOpen')
});

/** Guest quote preview. Reserves nothing. */
export const previewCoupon = query({
	args: quoteArgs,
	handler: async (_ctx, _args): Promise<OfferResult> => todo('previewCoupon')
});
