// Marketing release 1: campaigns, short links, QR entry and the coupon catalog.
// CONTRACT — names, args and return types are fixed so the admin UI and backend can be built in parallel.
import { v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { evaluateOffer, normalizeCouponCode, type OfferResult, type QuoteLine } from './lib/offers';
import { requireAdmin } from './lib/adminAuth';
import { isIsoDate, nightsBetween, resortTodayIso } from './lib/dates';
import { enforceRateLimit } from './lib/rateLimit';
import { isMarketingLocale, localizeMarketingPath, validateMarketingSlug } from './lib/marketingSlugs';

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

type RuleFields = Pick<Doc<'couponVersions'>, keyof typeof couponRules>;
type QuoteArgs = { code: string; propertySlug: string; checkIn: string; checkOut: string; services?: { label: string; amount: number }[] };

function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
		? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

function validateRange(from?: string, to?: string) {
	if ((from !== undefined && !isIsoDate(from)) || (to !== undefined && !isIsoDate(to)) || (from && to && from > to)) {
		throw new Error('Invalid date range');
	}
}

function validateRules(rules: RuleFields) {
	const value = rules.benefit.kind === 'percent' ? rules.benefit.percent : rules.benefit.amount;
	if (!Number.isFinite(value) || value <= 0 || (rules.benefit.kind === 'percent' && (value < 1 || value > 100))) {
		throw new Error('Invalid coupon benefit');
	}
	validateRange(rules.bookFrom, rules.bookTo);
	validateRange(rules.stayFrom, rules.stayTo);
	for (const value of [rules.minNights, rules.minEligibleSubtotal, rules.maxSaving, rules.usageLimit, rules.discountBudget]) {
		if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new Error('Limits must be positive integers');
	}
}

async function currentRules(ctx: QueryCtx, coupon: Doc<'coupons'>): Promise<Doc<'couponVersions'>> {
	const rules = await ctx.db.query('couponVersions').withIndex('by_coupon_and_version', q =>
		q.eq('couponId', coupon._id).eq('version', coupon.currentVersion)).unique();
	if (!rules) throw new Error('Coupon version not found');
	return rules;
}

async function enrichLink(ctx: QueryCtx, link: Doc<'marketingLinks'>): Promise<LinkRow> {
	const campaign = await ctx.db.get(link.campaignId);
	const coupon = link.couponId ? await ctx.db.get(link.couponId) : null;
	return { ...link, campaignName: campaign?.name ?? '', ...(coupon && { couponCode: coupon.code }), shortUrlPath: '/' + link.slug };
}

async function enrichCoupon(ctx: QueryCtx, coupon: Doc<'coupons'>): Promise<CouponRow> {
	const campaign = coupon.campaignId ? await ctx.db.get(coupon.campaignId) : null;
	return { ...coupon, rules: await currentRules(ctx, coupon), ...(campaign && { campaignName: campaign.name }) };
}

async function slugCheck(ctx: QueryCtx, slug: string, linkId?: Id<'marketingLinks'>): Promise<SlugCheck> {
	const checked = validateMarketingSlug(slug);
	if (checked.reason) return { ok: false, slug: checked.slug, reason: checked.reason };
	const existing = await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', checked.slug)).unique();
	return existing && existing._id !== linkId
		? { ok: false, slug: checked.slug, reason: 'taken' }
		: { ok: true, slug: checked.slug };
}

async function quote(ctx: QueryCtx, args: QuoteArgs, adminTest: boolean): Promise<OfferResult> {
	if (!isIsoDate(args.checkIn) || !isIsoDate(args.checkOut) || args.checkOut <= args.checkIn) throw new Error('Invalid stay dates');
	const property = await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', args.propertySlug)).unique();
	if (!property || (!adminTest && property.status !== 'active')) throw new Error('Property not found');
	const nights = nightsBetween(args.checkIn, args.checkOut);
	const lines: QuoteLine[] = [{ id: 'accommodation', kind: 'accommodation', propertySlug: property.slug,
		checkIn: args.checkIn, checkOut: args.checkOut, nights, amount: property.pricePerNight * nights }];
	for (const [index, service] of (args.services ?? []).entries()) {
		if (!Number.isFinite(service.amount) || service.amount < 0) throw new Error('Invalid service amount');
		lines.push({ id: `service-${index}`, kind: 'service', ...service });
	}
	const code = normalizeCouponCode(args.code);
	const coupon = code ? await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique() : null;
	const rules = coupon ? await currentRules(ctx, coupon) : null;
	const result = evaluateOffer({ lines, directDiscountPercent: property.directDiscountPercent, today: resortTodayIso(),
		...(coupon && rules && { coupon: { ...rules, code: coupon.code, version: coupon.currentVersion,
			status: adminTest && (coupon.status === 'draft' || coupon.status === 'paused') ? 'active' : coupon.status,
			used: coupon.used, discountGranted: coupon.discountGranted } }) });
	return code && !coupon ? { ...result, couponStatus: 'invalid', problem: { code: 'not_found' } } : result;
}

// ---------- Admin queries ----------

export const listCampaigns = query({
	args: { status: v.optional(campaignStatus) },
	handler: async (ctx, args): Promise<CampaignRow[]> => {
		await requireAdmin(ctx);
		const campaigns = await ctx.db.query('marketingCampaigns').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(campaigns.map(async campaign => {
			const links = await ctx.db.query('marketingLinks').withIndex('by_campaign', q => q.eq('campaignId', campaign._id)).take(500);
			const coupons = await ctx.db.query('coupons').withIndex('by_campaignId', q => q.eq('campaignId', campaign._id)).take(500);
			return { ...campaign, linkCount: links.length, couponCount: coupons.length, opens: links.reduce((sum, link) => sum + link.opens, 0) };
		}));
	}
});

export const listLinks = query({
	args: { campaignId: v.optional(v.id('marketingCampaigns')), status: v.optional(linkStatus) },
	handler: async (ctx, args): Promise<LinkRow[]> => {
		await requireAdmin(ctx);
		const links = args.campaignId
			? await ctx.db.query('marketingLinks').withIndex('by_campaign', q => {
				const index = q.eq('campaignId', args.campaignId!);
				return args.status ? index.eq('status', args.status) : index;
			}).take(500)
			: await ctx.db.query('marketingLinks').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(links.map(link => enrichLink(ctx, link)));
	}
});

export const listCoupons = query({
	args: { status: v.optional(couponStatus) },
	handler: async (ctx, args): Promise<CouponRow[]> => {
		await requireAdmin(ctx);
		const coupons = await ctx.db.query('coupons').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(coupons.map(coupon => enrichCoupon(ctx, coupon)));
	}
});

export const getCoupon = query({
	args: { couponId: v.id('coupons') },
	handler: async (ctx, args): Promise<CouponDetail | null> => {
		await requireAdmin(ctx);
		const coupon = await ctx.db.get(args.couponId);
		if (!coupon) return null;
		const versions = await ctx.db.query('couponVersions').withIndex('by_coupon_and_version', q => q.eq('couponId', coupon._id)).order('desc').take(500);
		const links = await ctx.db.query('marketingLinks').withIndex('by_couponId', q => q.eq('couponId', coupon._id)).take(500);
		return { ...await enrichCoupon(ctx, coupon), versions, links: await Promise.all(links.map(link => enrichLink(ctx, link))) };
	}
});

export const checkSlug = query({
	args: { slug: v.string(), linkId: v.optional(v.id('marketingLinks')) },
	handler: async (ctx, args): Promise<SlugCheck> => {
		await requireAdmin(ctx);
		return slugCheck(ctx, args.slug, args.linkId);
	}
});

/** Admin "test a quote": same engine as the guest, ignores draft/paused status so drafts can be tested. */
export const testQuote = query({
	args: quoteArgs,
	handler: async (ctx, args): Promise<OfferResult> => {
		await requireAdmin(ctx);
		return quote(ctx, args, true);
	}
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
	handler: async (ctx, args): Promise<Id<'marketingCampaigns'>> => {
		const admin = await requireAdmin(ctx);
		const { campaignId, ...fields } = args;
		if (!fields.name.trim() || !fields.source.trim() || !fields.medium.trim()) throw new Error('Name, source and medium are required');
		validateRange(fields.startsOn, fields.endsOn);
		if (fields.budget !== undefined && (!Number.isFinite(fields.budget) || fields.budget < 0)) throw new Error('Invalid budget');
		const audit = { updatedAt: Date.now(), updatedByEmail: admin.email };
		if (campaignId) {
			if (!await ctx.db.get(campaignId)) throw new Error('Campaign not found');
			await ctx.db.patch(campaignId, { ...fields, startsOn: fields.startsOn, endsOn: fields.endsOn, budget: fields.budget, notes: fields.notes, ...audit });
			return campaignId;
		}
		return ctx.db.insert('marketingCampaigns', { ...fields, ...audit, createdAt: audit.updatedAt, status: 'draft' });
	}
});

export const setCampaignStatus = mutation({
	args: { campaignId: v.id('marketingCampaigns'), status: campaignStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = await requireAdmin(ctx);
		if (!await ctx.db.get(args.campaignId)) throw new Error('Campaign not found');
		await ctx.db.patch(args.campaignId, { status: args.status, updatedAt: Date.now(), updatedByEmail: admin.email });
		return null;
	}
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
	handler: async (ctx, args): Promise<Id<'marketingLinks'>> => {
		const admin = await requireAdmin(ctx);
		const { linkId, ...fields } = args;
		const checked = await slugCheck(ctx, args.slug, linkId);
		if (!checked.ok) throw new Error(`Slug ${checked.reason}`);
		const campaign = await ctx.db.get(fields.campaignId);
		if (!campaign) throw new Error('Campaign not found');
		if (fields.couponId && !await ctx.db.get(fields.couponId)) throw new Error('Coupon not found');
		if (fields.locale !== undefined && !isMarketingLocale(fields.locale)) throw new Error('Invalid locale');
		if ('propertySlug' in fields.destination && fields.destination.propertySlug !== undefined) {
			const slug = fields.destination.propertySlug;
			if (!await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique()) throw new Error('Property not found');
		}
		const values = { ...fields, placement: fields.placement, locale: fields.locale, couponId: fields.couponId, slug: checked.slug, updatedAt: Date.now(), updatedByEmail: admin.email };
		if (linkId) {
			const existing = await ctx.db.get(linkId);
			if (!existing) throw new Error('Link not found');
			// Printed QR codes and shared posts point at the slug, so it is fixed once the link has been live.
			if (existing.status !== 'draft' && existing.slug !== checked.slug) throw new Error('Slug is locked after publishing');
			await ctx.db.patch(linkId, values);
			return linkId;
		}
		return ctx.db.insert('marketingLinks', { ...values, createdAt: values.updatedAt, opens: 0, status: 'draft' });
	}
});

export const setLinkStatus = mutation({
	args: { linkId: v.id('marketingLinks'), status: linkStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = await requireAdmin(ctx);
		if (!await ctx.db.get(args.linkId)) throw new Error('Link not found');
		await ctx.db.patch(args.linkId, { status: args.status, updatedAt: Date.now(), updatedByEmail: admin.email });
		return null;
	}
});

/** Creates the coupon, or writes a new immutable version when any rule changes. Code is fixed after the first redemption. */
export const saveCoupon = mutation({
	args: { couponId: v.optional(v.id('coupons')), code: v.string(), campaignId: v.optional(v.id('marketingCampaigns')), ...couponRules },
	handler: async (ctx, args): Promise<{ couponId: Id<'coupons'>; version: number }> => {
		const admin = await requireAdmin(ctx);
		const { couponId, code: rawCode, campaignId, ...rules } = args;
		const code = normalizeCouponCode(rawCode);
		if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new Error('Invalid coupon code');
		validateRules(rules);
		if (campaignId && !await ctx.db.get(campaignId)) throw new Error('Campaign not found');
		for (const slug of rules.propertySlugs ?? []) {
			if (!await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique()) throw new Error('Property not found');
		}
		const existing = await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique();
		if (existing && existing._id !== couponId) throw new Error('Coupon code taken');
		const now = Date.now();
		const audit = { updatedAt: now, updatedByEmail: admin.email };
		if (couponId) {
			const coupon = await ctx.db.get(couponId);
			if (!coupon) throw new Error('Coupon not found');
			if (coupon.used > 0 && code !== coupon.code) throw new Error('Cannot change a used coupon code');
			const current = await currentRules(ctx, coupon);
			// Compare the known rule fields individually, independent of object key ordering.
			const changed = (Object.keys(couponRules) as (keyof RuleFields)[]).some(key => canonical(current[key]) !== canonical(rules[key]));
			const version = coupon.currentVersion + (changed ? 1 : 0);
			if (changed) await ctx.db.insert('couponVersions', { ...rules, couponId, version, createdAt: now, createdByEmail: admin.email });
			await ctx.db.patch(couponId, { code, campaignId, currentVersion: version, ...audit });
			return { couponId, version };
		}
		const id = await ctx.db.insert('coupons', { code, campaignId, status: 'draft', currentVersion: 1, used: 0, discountGranted: 0, createdAt: now, ...audit });
		await ctx.db.insert('couponVersions', { ...rules, couponId: id, version: 1, createdAt: now, createdByEmail: admin.email });
		return { couponId: id, version: 1 };
	}
});

export const setCouponStatus = mutation({
	args: { couponId: v.id('coupons'), status: couponStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = await requireAdmin(ctx);
		if (!await ctx.db.get(args.couponId)) throw new Error('Coupon not found');
		await ctx.db.patch(args.couponId, { status: args.status, updatedAt: Date.now(), updatedByEmail: admin.email });
		return null;
	}
});

// ---------- Public ----------

/** Short-link resolver used by the `/<slug>` route. Returns null for unknown slugs. */
export const resolveLink = query({
	args: { slug: v.string() },
	handler: async (ctx, args): Promise<ResolvedLink | null> => {
		const link = await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', args.slug)).unique();
		if (!link || link.status === 'draft') return null;
		const campaign = await ctx.db.get(link.campaignId);
		const coupon = link.couponId ? await ctx.db.get(link.couponId) : null;
		const couponCode = link.status === 'active' && coupon?.status === 'active' ? coupon.code : undefined;
		let path: string;
		switch (link.destination.kind) {
			case 'home': path = '/'; break;
			case 'booking': path = '/booking'; break;
			case 'villa': path = '/rooms/' + encodeURIComponent(link.destination.propertySlug); break;
			case 'experiences': path = '/experiences'; break;
			case 'chat': path = '/chat'; break;
		}
		const params = new URLSearchParams();
		if (link.destination.kind === 'booking' && link.destination.propertySlug) params.set('property', link.destination.propertySlug);
		params.set('mk', link.slug);
		if (couponCode) params.set('coupon', couponCode);
		return { path: localizeMarketingPath(path, link.locale) + '?' + params.toString(), status: link.status,
			offerRemoved: link.status !== 'active', campaignName: campaign?.name ?? '', ...(couponCode && { couponCode }) };
	}
});

/** Stores a raw open and counts active human opens. One per-link rate budget bounds both; excess requests are dropped. */
export const recordOpen = mutation({
	args: { slug: v.string(), bot: v.boolean() },
	handler: async (ctx, args): Promise<null> => {
		const link = await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', args.slug)).unique();
		if (!link || link.status === 'draft') return null;
		try {
			await enforceRateLimit(ctx, `marketing-open:${link._id}`, 120, 60_000);
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Too many requests.')) return null;
			throw error;
		}
		await ctx.db.insert('marketingEvents', { linkId: link._id, kind: 'open', bot: args.bot, occurredAt: Date.now() });
		if (!args.bot && link.status === 'active') await ctx.db.patch(link._id, { opens: link.opens + 1 });
		return null;
	}
});

/** Guest quote preview. Reserves nothing. */
export const previewCoupon = query({
	args: quoteArgs,
	handler: async (ctx, args): Promise<OfferResult> => {
		return quote(ctx, args, false);
	}
});
