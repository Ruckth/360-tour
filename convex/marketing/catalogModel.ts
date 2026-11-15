import { ConvexError, v, type ObjectType } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../auth/model';
import { isIsoDate, nightsBetween } from '../shared/dates';
import { resortTodayIso } from '../shared/time';
import { validateMarketingSlug } from '../shared/marketingSlugs';
import { MAX_QUOTE_SUBTOTAL, evaluateOffer, normalizeCouponCode, type OfferResult, type QuoteLine } from '../shared/offers';
import { appendRecordHistory } from '../settings/model';
import type { CouponRow, LinkRow, SlugCheck } from '../shared/marketingTypes';

export const publishStatus = v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('archived'));

export const campaignStatus = v.union(publishStatus, v.literal('ended'));

export const destination = v.union(
	v.object({ kind: v.literal('home') }),
	v.object({ kind: v.literal('booking'), propertySlug: v.optional(v.string()) }),
	v.object({ kind: v.literal('villa'), propertySlug: v.string() }),
	v.object({ kind: v.literal('experiences') }),
	v.object({ kind: v.literal('chat') })
);

export const benefit = v.union(
	v.object({ kind: v.literal('percent'), percent: v.number() }),
	v.object({ kind: v.literal('fixed'), amount: v.number() })
);

export const couponRules = {
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

export const quoteArgs = {
	code: v.string(),
	propertySlug: v.string(),
	checkIn: v.string(),
	checkOut: v.string(),
	services: v.optional(v.array(v.object({ label: v.string(), amount: v.number() })))
};

export type RuleFields = Pick<Doc<'couponVersions'>, keyof typeof couponRules>;

export type QuoteArgs = ObjectType<typeof quoteArgs>;

export async function getOrThrow<Table extends 'marketingCampaigns' | 'marketingLinks' | 'coupons'>(ctx: QueryCtx, table: Table, id: Id<Table>): Promise<Doc<Table>> {
	const row = await ctx.db.get(id);
	if (!row) {
		const label = { marketingCampaigns: 'Campaign', marketingLinks: 'Link', coupons: 'Coupon' }[table];
		throw new ConvexError({ code: `${label.toLowerCase()}_not_found`, message: `${label} not found. Refresh and choose an existing ${label.toLowerCase()}.` });
	}
	return row;
}

export function auditFields(admin: { email: string }) {
	return { updatedAt: Date.now(), updatedByEmail: admin.email };
}

export function canonical(value: unknown): string {
	return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
		? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export async function readable(ctx: MutationCtx, key: string, value: unknown): Promise<[string, unknown]> {
	if (key === 'campaignId') return ['campaign', value ? (await ctx.db.get(value as Id<'marketingCampaigns'>))?.name ?? null : null];
	if (key === 'couponId') return ['coupon', value ? (await ctx.db.get(value as Id<'coupons'>))?.code ?? null : null];
	return [key, value ?? null];
}

export async function recordChanges(ctx: MutationCtx, entityType: string, entityId: string, actor: string,
	before: Record<string, unknown> | null, after: Record<string, unknown>, kind = 'updated') {
	const keys = Object.keys(after).filter(key => !before || canonical(before[key]) !== canonical(after[key]));
	if (!keys.length) return;
	const values = async (fields: Record<string, unknown>) => Object.fromEntries(await Promise.all(keys.map(key => readable(ctx, key, fields[key]))));
	await appendRecordHistory(ctx, { entityType, entityId, actor, kind: before ? kind : 'created',
		...(before ? { before: await values(before) } : {}), after: await values(after) });
}

export function validateRange(from?: string, to?: string) {
	if ((from !== undefined && !isIsoDate(from)) || (to !== undefined && !isIsoDate(to)) || (from && to && from > to)) {
		throw new ConvexError({ code: 'invalid_date_range', message: 'Invalid date range. Use valid dates with the end on or after the start.' });
	}
}

export function validateRules(rules: RuleFields) {
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

export async function currentRules(ctx: QueryCtx, coupon: Doc<'coupons'>): Promise<Doc<'couponVersions'>> {
	const rules = await ctx.db.query('couponVersions').withIndex('by_coupon_and_version', q =>
		q.eq('couponId', coupon._id).eq('version', coupon.currentVersion)).unique();
	if (!rules) throw new Error('Coupon version not found');
	return rules;
}

export async function enrichLink(ctx: QueryCtx, link: Doc<'marketingLinks'>): Promise<LinkRow> {
	const campaign = await ctx.db.get(link.campaignId);
	const coupon = link.couponId ? await ctx.db.get(link.couponId) : null;
	return { ...link, campaignName: campaign?.name ?? '', ...(coupon && { couponCode: coupon.code }), shortUrlPath: '/' + link.slug };
}

export async function enrichCoupon(ctx: QueryCtx, coupon: Doc<'coupons'>): Promise<CouponRow> {
	const campaign = coupon.campaignId ? await ctx.db.get(coupon.campaignId) : null;
	return { ...coupon, rules: await currentRules(ctx, coupon), ...(campaign && { campaignName: campaign.name }) };
}

export async function slugCheck(ctx: QueryCtx, slug: string, linkId?: Id<'marketingLinks'>): Promise<SlugCheck> {
	const checked = validateMarketingSlug(slug);
	if (checked.reason) return { ok: false, slug: checked.slug, reason: checked.reason };
	const existing = await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', checked.slug)).unique();
	return existing && existing._id !== linkId
		? { ok: false, slug: checked.slug, reason: 'taken' }
		: { ok: true, slug: checked.slug };
}

export async function validateLinkDestination(ctx: QueryCtx, destination: Doc<'marketingLinks'>['destination'], active: boolean) {
	if (!('propertySlug' in destination) || destination.propertySlug === undefined) return;
	const slug = destination.propertySlug;
	const property = await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique();
	if (active && property?.status !== 'active') {
		throw new ConvexError({ code: 'villa_not_public', message: 'This villa is not public. Publish the villa or choose an active villa before activating this link.' });
	}
	if (!property) throw new ConvexError({ code: 'property_not_found', message: 'Property not found. Choose an available villa.' });
}

export async function quote(ctx: QueryCtx, args: QuoteArgs, adminTest: boolean): Promise<OfferResult> {
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

export const campaignTransitions: Record<Doc<'marketingCampaigns'>['status'], Doc<'marketingCampaigns'>['status'][]> = {
	draft: ['active'], active: ['paused', 'ended'], paused: ['active', 'ended'], ended: ['archived'], archived: ['ended']
};
