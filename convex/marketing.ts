import { canReadMarketingPersonalData } from './lib/marketingPrivacy';
// Marketing release 1: campaigns, short links, QR entry and the coupon catalog.
// CONTRACT — names, args and return types are fixed so the admin UI and backend can be built in parallel.
import { ConvexError, v, type ObjectType } from 'convex/values';
import { mutation, query, type QueryCtx, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { MAX_QUOTE_SUBTOTAL, evaluateOffer, normalizeCouponCode, type OfferResult, type QuoteLine } from './lib/offers';
import { orderTitle, formatReceiptNumber } from './lib/orderMath';
import { requireMarketingPermission, requireEditableDraft } from './lib/marketingAccess';
import { isIsoDate, nightsBetween, resortTodayIso } from './lib/dates';
import { appendRecordHistory } from './lib/recordHistory';
import { cleanLandingPath, cleanReferrerHost, isVisitorKey, newVisitorKey } from './lib/marketingAttribution';
import { enforceRateLimit, rateLimitReached } from './lib/rateLimit';
import { isMarketingLocale, localizeMarketingPath, validateMarketingSlug } from './lib/marketingSlugs';

const publishStatus = v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('archived'));
const campaignStatus = v.union(publishStatus, v.literal('ended'));
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

type RuleFields = Pick<Doc<'couponVersions'>, keyof typeof couponRules>;
type QuoteArgs = ObjectType<typeof quoteArgs>;

async function getOrThrow<Table extends 'marketingCampaigns' | 'marketingLinks' | 'coupons'>(ctx: QueryCtx, table: Table, id: Id<Table>): Promise<Doc<Table>> {
	const row = await ctx.db.get(id);
	if (!row) {
		const label = { marketingCampaigns: 'Campaign', marketingLinks: 'Link', coupons: 'Coupon' }[table];
		throw new ConvexError({ code: `${label.toLowerCase()}_not_found`, message: `${label} not found. Refresh and choose an existing ${label.toLowerCase()}.` });
	}
	return row;
}

function auditFields(admin: { email: string }) {
	return { updatedAt: Date.now(), updatedByEmail: admin.email };
}

function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
		? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

/** History shows the campaign name and coupon code staff recognise, not document ids. */
async function readable(ctx: MutationCtx, key: string, value: unknown): Promise<[string, unknown]> {
	if (key === 'campaignId') return ['campaign', value ? (await ctx.db.get(value as Id<'marketingCampaigns'>))?.name ?? null : null];
	if (key === 'couponId') return ['coupon', value ? (await ctx.db.get(value as Id<'coupons'>))?.code ?? null : null];
	return [key, value ?? null];
}

async function recordChanges(ctx: MutationCtx, entityType: string, entityId: string, actor: string,
	before: Record<string, unknown> | null, after: Record<string, unknown>, kind = 'updated') {
	const keys = Object.keys(after).filter(key => !before || canonical(before[key]) !== canonical(after[key]));
	if (!keys.length) return;
	const values = async (fields: Record<string, unknown>) => Object.fromEntries(await Promise.all(keys.map(key => readable(ctx, key, fields[key]))));
	await appendRecordHistory(ctx, { entityType, entityId, actor, kind: before ? kind : 'created',
		...(before ? { before: await values(before) } : {}), after: await values(after) });
}

function validateRange(from?: string, to?: string) {
	if ((from !== undefined && !isIsoDate(from)) || (to !== undefined && !isIsoDate(to)) || (from && to && from > to)) {
		throw new ConvexError({ code: 'invalid_date_range', message: 'Invalid date range. Use valid dates with the end on or after the start.' });
	}
}

function validateRules(rules: RuleFields) {
	const value = rules.benefit.kind === 'percent' ? rules.benefit.percent : rules.benefit.amount;
	if (!Number.isSafeInteger(value) || value <= 0 || (rules.benefit.kind === 'percent' && (value < 100 || value > 10000))) {
		throw new ConvexError({ code: 'invalid_coupon_benefit', message: 'Invalid coupon benefit. Enter a positive amount or a percentage from 1 to 100.' });
	}
	validateRange(rules.bookFrom, rules.bookTo);
	validateRange(rules.stayFrom, rules.stayTo);
	for (const value of [rules.minNights, rules.minEligibleSubtotal, rules.maxSaving, rules.usageLimit, rules.discountBudget]) {
		if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) throw new ConvexError({ code: 'invalid_coupon_limits', message: 'Limits must be positive integers. Leave a limit empty if it does not apply.' });
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

/** Drafts may target unpublished villas; every active destination must be publicly bookable. */
async function validateLinkDestination(ctx: QueryCtx, destination: Doc<'marketingLinks'>['destination'], active: boolean) {
	if (!('propertySlug' in destination) || destination.propertySlug === undefined) return;
	const slug = destination.propertySlug;
	const property = await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique();
	if (active && property?.status !== 'active') {
		throw new ConvexError({ code: 'villa_not_public', message: 'This villa is not public. Publish the villa or choose an active villa before activating this link.' });
	}
	if (!property) throw new ConvexError({ code: 'property_not_found', message: 'Property not found. Choose an available villa.' });
}

async function quote(ctx: QueryCtx, args: QuoteArgs, adminTest: boolean): Promise<OfferResult> {
	if (!isIsoDate(args.checkIn) || !isIsoDate(args.checkOut) || args.checkOut <= args.checkIn) throw new ConvexError({ code: 'invalid_stay_dates', message: 'Invalid stay dates. Choose a valid check-out date after check-in.' });
	const property = await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', args.propertySlug)).unique();
	if (!property || (!adminTest && property.status !== 'active')) throw new ConvexError({ code: 'property_not_found', message: 'Property not found. Choose an available villa.' });
	const nights = nightsBetween(args.checkIn, args.checkOut);
	const accommodationAmount = property.pricePerNight * nights;
	if (!Number.isSafeInteger(accommodationAmount) || accommodationAmount < 0) {
		throw new ConvexError({ code: 'invalid_accommodation_amount', message: 'The stay price must be non-negative integer satang. Check the villa nightly rate and stay dates.' });
	}
	if ((args.services?.length ?? 0) > 50) throw new ConvexError({ code: 'too_many_services', message: 'Use at most 50 services in a quote.' });
	const lines: QuoteLine[] = [{ id: 'accommodation', kind: 'accommodation', propertySlug: property.slug,
		checkIn: args.checkIn, checkOut: args.checkOut, nights, amount: accommodationAmount }];
	for (const [index, service] of (args.services ?? []).entries()) {
		if (!Number.isSafeInteger(service.amount) || service.amount < 0 || service.amount > 1_000_000_000) throw new ConvexError({ code: 'invalid_service_amount', message: 'Invalid service amount. Enter integer satang from 0 to 1,000,000,000 per service.' });
		lines.push({ id: `service-${index}`, kind: 'service', ...service });
	}
	if (lines.reduce((sum, line) => sum + line.amount, 0) > MAX_QUOTE_SUBTOTAL) {
		throw new ConvexError({ code: 'invalid_quote_total', message: 'The quote total is too large. Reduce the stay length or service amounts.' });
	}
	const code = normalizeCouponCode(args.code);
	const coupon = code ? await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique() : null;
	const rules = coupon ? await currentRules(ctx, coupon) : null;
	const result = evaluateOffer({ lines, directDiscountPercent: property.directDiscountPercent, today: resortTodayIso(),
		...(coupon && rules && { coupon: { ...rules, code: coupon.code, version: coupon.currentVersion,
			status: adminTest && (coupon.status === 'draft' || coupon.status === 'paused') ? 'active' : coupon.status,
			used: coupon.used, discountGranted: coupon.discountGranted, held: coupon.held, heldDiscount: coupon.heldDiscount } }) });
	return code && !coupon ? { ...result, couponStatus: 'invalid', problem: { code: 'not_found' } } : result;
}

// ---------- Admin queries ----------

export const listCampaigns = query({
	args: { status: v.optional(campaignStatus) },
	handler: async (ctx, args): Promise<CampaignRow[]> => {
		await requireMarketingPermission(ctx, 'view');
		const campaigns = await ctx.db.query('marketingCampaigns').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(campaigns.map(async campaign => {
			const links = await ctx.db.query('marketingLinks').withIndex('by_campaign', q => q.eq('campaignId', campaign._id)).take(500);
			const coupons = await ctx.db.query('coupons').withIndex('by_campaignId', q => q.eq('campaignId', campaign._id)).take(500);
			return { ...campaign, countsCapped: links.length === 500 || coupons.length === 500, linkCount: links.length, couponCount: coupons.length, opens: links.reduce((sum, link) => sum + link.opens, 0) };
		}));
	}
});

export const listLinks = query({
	args: { campaignId: v.optional(v.id('marketingCampaigns')), status: v.optional(publishStatus) },
	handler: async (ctx, args): Promise<LinkRow[]> => {
		await requireMarketingPermission(ctx, 'view');
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
	args: { status: v.optional(publishStatus) },
	handler: async (ctx, args): Promise<CouponRow[]> => {
		await requireMarketingPermission(ctx, 'view');
		const coupons = await ctx.db.query('coupons').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(coupons.map(coupon => enrichCoupon(ctx, coupon)));
	}
});

export const getCoupon = query({
	args: { couponId: v.string() },
	handler: async (ctx, args): Promise<CouponDetail | null> => {
		const access = await requireMarketingPermission(ctx, 'view');
		const fullDetail = canReadMarketingPersonalData(access);
		const couponId = ctx.db.normalizeId('coupons', args.couponId);
		if (!couponId) return null;
		const coupon = await ctx.db.get(couponId);
		if (!coupon) return null;
		const versions = await ctx.db.query('couponVersions').withIndex('by_coupon_and_version', q => q.eq('couponId', coupon._id)).order('desc').take(500);
		const links = await ctx.db.query('marketingLinks').withIndex('by_couponId', q => q.eq('couponId', coupon._id)).take(500);
		const rows = await ctx.db.query('couponRedemptions').withIndex('by_couponId_and_createdAt', q => q.eq('couponId', coupon._id)).order('desc').take(50);
		const redemptions: RedemptionRow[] = await Promise.all(rows.map(async row => {
			const booking = row.bookingId ? await ctx.db.get(row.bookingId) : null;
			const order = row.orderId ? await ctx.db.get(row.orderId) : null;
			return {
				...row,
				...(order && { order: {
					orderId: order._id, title: orderTitle(order.orderNumber),
					receiptNumber: order.receiptNumber !== undefined ? formatReceiptNumber(order.receiptNumber) : null,
					customerName: fullDetail ? order.customerSnapshot?.name ?? null : 'Guest'
				} }),
				...(booking && { booking: { guestName: fullDetail ? booking.guestName : 'Guest', checkIn: booking.checkIn, checkOut: booking.checkOut, ...(fullDetail && booking.confirmationCode ? { confirmationCode: booking.confirmationCode } : {}) } })
			};
		}));
		return { ...await enrichCoupon(ctx, coupon), versions, links: await Promise.all(links.map(link => enrichLink(ctx, link))), redemptions };
	}
});

export const checkSlug = query({
	args: { slug: v.string(), linkId: v.optional(v.id('marketingLinks')) },
	handler: async (ctx, args): Promise<SlugCheck> => {
		await requireMarketingPermission(ctx, 'view');
		return slugCheck(ctx, args.slug, args.linkId);
	}
});

/** Admin "test a quote": same engine as the guest, ignores draft/paused status so drafts can be tested. */
export const testQuote = query({
	args: quoteArgs,
	handler: async (ctx, args): Promise<OfferResult> => {
		await requireMarketingPermission(ctx, 'view');
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
		const admin = await requireMarketingPermission(ctx, 'draft');
		const { campaignId, ...fields } = args;
		if (admin.role === 'marketer' && fields.budget !== undefined) throw new Error('Marketers cannot set budgets');
		if (!fields.name.trim() || !fields.source.trim() || !fields.medium.trim()) throw new ConvexError({ code: 'missing_campaign_fields', message: 'Name, source and medium are required. Fill in all three fields.' });
		validateRange(fields.startsOn, fields.endsOn);
		if (fields.budget !== undefined && (!Number.isSafeInteger(fields.budget) || fields.budget < 0)) throw new ConvexError({ code: 'invalid_budget', message: 'Invalid budget. Enter a finite, non-negative amount.' });
		const audit = auditFields(admin);
		if (campaignId) {
			const existing = await getOrThrow(ctx, 'marketingCampaigns', campaignId);
			requireEditableDraft(admin, existing);
			if (admin.role === 'marketer') fields.budget = existing.budget;
			await recordChanges(ctx, 'marketingCampaign', campaignId, admin.email, existing, { ...fields, startsOn: fields.startsOn, endsOn: fields.endsOn, budget: fields.budget, notes: fields.notes });
			await ctx.db.patch(campaignId, { ...fields, startsOn: fields.startsOn, endsOn: fields.endsOn, budget: fields.budget, notes: fields.notes, ...audit });
			return campaignId;
		}
		const id = await ctx.db.insert('marketingCampaigns', { ...fields, ...audit, createdAt: audit.updatedAt, status: 'draft' });
		await recordChanges(ctx, 'marketingCampaign', id, admin.email, null, fields);
		return id;
	}
});

const campaignTransitions: Record<Doc<'marketingCampaigns'>['status'], Doc<'marketingCampaigns'>['status'][]> = {
	draft: ['active'], active: ['paused', 'ended'], paused: ['active', 'ended'], ended: ['archived'], archived: ['ended']
};

export const setCampaignStatus = mutation({
	args: { campaignId: v.id('marketingCampaigns'), status: campaignStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = await requireMarketingPermission(ctx, 'publish');
		const campaign = await getOrThrow(ctx, 'marketingCampaigns', args.campaignId);
		if (args.status !== campaign.status && !campaignTransitions[campaign.status].includes(args.status)) {
			throw new ConvexError({ code: 'invalid_transition', message: 'This campaign status change is unavailable. Use the next action in the campaign lifecycle.' });
		}
		await recordChanges(ctx, 'marketingCampaign', args.campaignId, admin.email, campaign, { status: args.status }, 'status_changed');
		await ctx.db.patch(args.campaignId, { status: args.status, ...auditFields(admin) });
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
		affiliateId: v.optional(v.id('marketingAffiliates')),
		entry: v.union(v.literal('link'), v.literal('qr'))
	},
	handler: async (ctx, args): Promise<Id<'marketingLinks'>> => {
		const admin = await requireMarketingPermission(ctx, 'draft');
		const { linkId, ...fields } = args;
		if (fields.affiliateId) { await requireMarketingPermission(ctx, 'partners'); const affiliate = await ctx.db.get(fields.affiliateId); if (!affiliate || affiliate.status === 'archived') throw new Error('Partner unavailable'); }
		const checked = await slugCheck(ctx, args.slug, linkId);
		if (!checked.ok) throw new ConvexError({ code: `slug_${checked.reason}`, message: `Slug ${checked.reason}. Choose a different short URL.` });
		await getOrThrow(ctx, 'marketingCampaigns', fields.campaignId);
		if (fields.couponId) await getOrThrow(ctx, 'coupons', fields.couponId);
		if (fields.locale !== undefined && !isMarketingLocale(fields.locale)) throw new ConvexError({ code: 'invalid_locale', message: 'Invalid locale. Choose a supported language.' });
		const existing = linkId ? await getOrThrow(ctx, 'marketingLinks', linkId) : null;
		requireEditableDraft(admin, existing);
		if (existing?.affiliateId && existing.slug.startsWith('r/')) throw new Error('Edit canonical partner aliases from Partners');
		if (existing?.affiliateId && existing.affiliateId !== fields.affiliateId) await requireMarketingPermission(ctx, 'partners');
		await validateLinkDestination(ctx, fields.destination, existing?.status === 'active');
		const values = { ...fields, placement: fields.placement, locale: fields.locale, couponId: fields.couponId, affiliateId: fields.affiliateId, slug: checked.slug, ...auditFields(admin) };
		if (linkId && existing) {
			// Printed QR codes and shared posts point at the slug, so it is fixed once the link has been live.
			if (existing.status !== 'draft' && existing.slug !== checked.slug) throw new ConvexError({ code: 'slug_locked', message: 'Slug is locked after publishing. Create a new link to use a different slug.' });
			await recordChanges(ctx, 'marketingLink', linkId, admin.email, existing, { ...fields, slug: checked.slug, placement: fields.placement, locale: fields.locale, couponId: fields.couponId });
			await ctx.db.patch(linkId, values);
			return linkId;
		}
		const id = await ctx.db.insert('marketingLinks', { ...values, createdAt: values.updatedAt, opens: 0, status: 'draft' });
		await recordChanges(ctx, 'marketingLink', id, admin.email, null, { ...fields, slug: checked.slug });
		return id;
	}
});

export const setLinkStatus = mutation({
	args: { linkId: v.id('marketingLinks'), status: publishStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = await requireMarketingPermission(ctx, 'publish');
		const link = await getOrThrow(ctx, 'marketingLinks', args.linkId);
		if (link.affiliateId) { const partner = await ctx.db.get(link.affiliateId); if (link.slug.startsWith('r/')) throw new Error('Change canonical link status from Partners'); if (args.status === 'active' && partner?.status !== 'active') throw new Error('Activate the partner first'); }
		if (args.status === 'draft' && link.status !== 'draft') {
			throw new ConvexError({ code: 'invalid_transition', message: 'A link cannot return to draft. Pause or archive it to remove its offer.' });
		}
		if (args.status === 'active') await validateLinkDestination(ctx, link.destination, true);
		await recordChanges(ctx, 'marketingLink', args.linkId, admin.email, link, { status: args.status }, 'status_changed');
		await ctx.db.patch(args.linkId, { status: args.status, ...auditFields(admin) });
		return null;
	}
});

/** Creates the coupon, or writes a new immutable version when any rule changes. Code is fixed after the first redemption. */
export const saveCoupon = mutation({
	args: { couponId: v.optional(v.id('coupons')), code: v.string(), campaignId: v.optional(v.id('marketingCampaigns')), ...couponRules },
	handler: async (ctx, args): Promise<{ couponId: Id<'coupons'>; version: number }> => {
		const admin = await requireMarketingPermission(ctx, 'draft');
		const { couponId, code: rawCode, campaignId, ...rules } = args;
		const code = normalizeCouponCode(rawCode);
		if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new ConvexError({ code: 'invalid_coupon_code', message: 'Invalid coupon code. Use 3 to 32 letters, numbers or hyphens.' });
		validateRules(rules);
		if (campaignId) await getOrThrow(ctx, 'marketingCampaigns', campaignId);
		for (const slug of rules.propertySlugs ?? []) {
			if (!await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique()) throw new ConvexError({ code: 'property_not_found', message: 'Property not found. Choose an available villa.' });
		}
		const existing = await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique();
		if (existing && existing._id !== couponId) throw new ConvexError({ code: 'coupon_code_taken', message: 'Coupon code taken. Choose a different code.' });
		const audit = auditFields(admin);
		const now = audit.updatedAt;
		if (couponId) {
			const coupon = await getOrThrow(ctx, 'coupons', couponId);
			requireEditableDraft(admin, coupon);
			if (coupon.used > 0 && code !== coupon.code) throw new ConvexError({ code: 'coupon_code_locked', message: 'Cannot change a used coupon code. Create a new coupon to use a different code.' });
			const current = await currentRules(ctx, coupon);
			// Compare the known rule fields individually, independent of object key ordering.
			const changed = (Object.keys(couponRules) as (keyof RuleFields)[]).some(key => canonical(current[key]) !== canonical(rules[key]));
			const version = coupon.currentVersion + (changed ? 1 : 0);
			if (changed) {
				await ctx.db.insert('couponVersions', { ...rules, couponId, version, createdAt: now, createdByEmail: admin.email });
				await appendRecordHistory(ctx, { entityType: 'coupon', entityId: couponId, actor: admin.email, kind: 'version_added', after: { ...rules, version } });
			}
			await recordChanges(ctx, 'coupon', couponId, admin.email, coupon, { code, campaignId });
			await ctx.db.patch(couponId, { code, campaignId, currentVersion: version, ...audit });
			return { couponId, version };
		}
		const id = await ctx.db.insert('coupons', { code, campaignId, status: 'draft', currentVersion: 1, used: 0, discountGranted: 0, createdAt: now, ...audit });
		await ctx.db.insert('couponVersions', { ...rules, couponId: id, version: 1, createdAt: now, createdByEmail: admin.email });
		await recordChanges(ctx, 'coupon', id, admin.email, null, { code, campaignId });
		await appendRecordHistory(ctx, { entityType: 'coupon', entityId: id, actor: admin.email, kind: 'version_added', after: { ...rules, version: 1 } });
		return { couponId: id, version: 1 };
	}
});

export const setCouponStatus = mutation({
	args: { couponId: v.id('coupons'), status: publishStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = await requireMarketingPermission(ctx, 'publish');
		const coupon = await getOrThrow(ctx, 'coupons', args.couponId);
		if (coupon.status === 'archived' && args.status !== 'archived') {
			throw new ConvexError({ code: 'invalid_transition', message: 'Archived coupons cannot change status. Create a new coupon instead.' });
		}
		await recordChanges(ctx, 'coupon', args.couponId, admin.email, coupon, { status: args.status }, 'status_changed');
		await ctx.db.patch(args.couponId, { status: args.status, ...auditFields(admin) });
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
		const coupon = link.couponId ? await ctx.db.get(link.couponId) : null;
		const propertySlug = 'propertySlug' in link.destination ? link.destination.propertySlug : undefined;
		const property = propertySlug !== undefined
			? await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', propertySlug)).unique() : null;
		const villaUnavailable = propertySlug !== undefined && property?.status !== 'active';
		const affiliate = link.affiliateId ? await ctx.db.get(link.affiliateId) : null;
		const offerRemoved = link.status !== 'active' || villaUnavailable || (!!link.affiliateId && affiliate?.status !== 'active');
		const couponCode = !offerRemoved && coupon?.status === 'active' ? coupon.code : undefined;
		let path: string;
		switch (link.destination.kind) {
			case 'home': path = '/'; break;
			case 'booking': path = '/booking'; break;
			case 'villa': path = '/rooms/' + encodeURIComponent(link.destination.propertySlug); break;
			case 'experiences': path = '/experiences'; break;
			case 'chat': path = '/chat'; break;
		}
		if (villaUnavailable) path = '/booking';
		const params = new URLSearchParams();
		if (!villaUnavailable && link.destination.kind === 'booking' && link.destination.propertySlug) params.set('property', link.destination.propertySlug);
		params.set('mk', link.slug);
		if (couponCode) params.set('coupon', couponCode);
		return { path: localizeMarketingPath(path, link.locale) + '?' + params.toString(), status: link.status,
			offerRemoved, ...(couponCode && { couponCode }) };
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

/**
 * Release 3a: starts a consented browser session. Called only after analytics consent, when the tab
 * has no live session, was idle for SESSION_IDLE_MS, or arrived through a different link.
 * - `visitorKey`: reused when it is a well-formed key (isVisitorKey); otherwise a new one is minted and returned.
 * - `slug`: the link this tab arrived through. Any non-draft link counts; unknown or draft slugs are ignored.
 * - `landingPath` / `referrerHost`: sanitised with cleanLandingPath / cleanReferrerHost before storing.
 * Rate limited per visitor key and globally; over the limit it returns the key with `sessionId: null`
 * (never throws for that).
 */
export const startSession = mutation({
	args: { visitorKey: v.optional(v.string()), slug: v.optional(v.string()), landingPath: v.string(), referrerHost: v.optional(v.string()) },
	handler: async (ctx, args): Promise<{ visitorKey: string; sessionId: Id<'marketingSessions'> | null }> => {
		const visitorKey = isVisitorKey(args.visitorKey) ? args.visitorKey : newVisitorKey();
		// A visitor over their own limit is turned away first, so their calls can't use up everyone's allowance.
		if (await rateLimitReached(ctx, `marketing-session:${visitorKey}`, 30)) return { visitorKey, sessionId: null };
		try {
			await enforceRateLimit(ctx, 'marketing-session:global', 5000, 60 * 60 * 1000);
			await enforceRateLimit(ctx, `marketing-session:${visitorKey}`, 30, 60 * 60 * 1000);
		} catch (error) {
			if (error instanceof Error && error.message.startsWith('Too many requests.')) return { visitorKey, sessionId: null };
			throw error;
		}
		const link = args.slug === undefined ? null : await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', args.slug!)).unique();
		let ownHost: string | undefined;
		const siteUrl = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
		if (siteUrl) {
			try { ownHost = new URL(siteUrl).hostname; } catch { /* Ignore an invalid site configuration. */ }
		}
		const referrerHost = cleanReferrerHost(args.referrerHost, ownHost);
		const sessionId = await ctx.db.insert('marketingSessions', {
			visitorKey, landingPath: cleanLandingPath(args.landingPath), startedAt: Date.now(),
			...(referrerHost ? { referrerHost } : {}),
			...(link && link.status !== 'draft' ? { linkId: link._id, campaignId: link.campaignId } : {})
		});
		const day = resortTodayIso();
		const linkId = link && link.status !== 'draft' ? link._id : undefined;
		// One row per link and campaign: a link moved to another campaign keeps its earlier sessions under the first.
		const campaignId = linkId ? link!.campaignId : undefined;
		const rollup = await ctx.db.query('marketingSessionDays').withIndex('by_day_and_linkId_and_campaignId', q => q.eq('day', day).eq('linkId', linkId).eq('campaignId', campaignId)).unique();
		if (rollup) await ctx.db.patch(rollup._id, { count: rollup.count + 1 });
		else await ctx.db.insert('marketingSessionDays', { day, linkId, campaignId, count: 1 });
		return { visitorKey, sessionId };
	}
});

/** Guest quote preview. Reserves nothing. */
export const previewCoupon = query({
	args: quoteArgs,
	handler: async (ctx, args): Promise<OfferResult> => {
		return quote(ctx, args, false);
	}
});

/** Minimal marketing catalog for scoped roles. */
export const catalog = query({args:{},handler:async ctx=>{await requireMarketingPermission(ctx,'view');return (await ctx.db.query('properties').take(500)).map(({_id,name,slug,status,pricePerNight,currency,maxGuests,directDiscountPercent})=>({_id,name,slug,status,pricePerNight,currency,maxGuests,directDiscountPercent}));}});
