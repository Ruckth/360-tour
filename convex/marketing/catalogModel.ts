import { ConvexError, v, type ObjectType } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { type MutationCtx, type QueryCtx } from '../auth/model';
import { isIsoDate, nightsBetween } from '../shared/dates';
import { resortTodayIso } from '../shared/time';
import { validateMarketingSlug } from '../shared/marketingSlugs';
import { MAX_QUOTE_SUBTOTAL, evaluateOffer, normalizeCouponCode, type CouponRules, type OfferResult, type QuoteLine } from '../shared/offers';
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
type TestQuoteArgs = Pick<QuoteArgs, 'code' | 'services'> & Partial<Omit<QuoteArgs, 'code' | 'services'>>;

export function validatedCouponCode(raw: string) {
	const code = normalizeCouponCode(raw);
	if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new ConvexError({ code: 'invalid_coupon_code', message: 'Invalid coupon code. Use 3 to 32 letters, numbers or hyphens.' });
	return code;
}

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

export async function validateRuleProperties(ctx: QueryCtx, { propertySlugs }: Pick<RuleFields, 'propertySlugs'>) {
	for (const slug of new Set(propertySlugs)) {
		const property = await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique();
		if (!property) throw new ConvexError({ code: 'property_not_found', message: 'Property not found. Choose an available villa.' });
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

export async function quote(ctx: QueryCtx, args: TestQuoteArgs, adminTest: boolean, proposed?: { rules: RuleFields; coupon: Doc<'coupons'> | null }): Promise<OfferResult> {
	const { checkIn, checkOut, propertySlug } = args;
	const hasStay = !adminTest || checkIn !== undefined || checkOut !== undefined || propertySlug !== undefined;
	const lines: QuoteLine[] = [];
	let directDiscountPercent = 0;
	if (hasStay) {
		if (!checkIn || !checkOut || !isIsoDate(checkIn) || !isIsoDate(checkOut) || checkOut <= checkIn) {
			throw new ConvexError({ code: 'invalid_stay_dates', message: 'Invalid stay dates. Choose a valid check-out date after check-in.' });
		}
		const property = propertySlug && await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', propertySlug)).unique();
		if (!property || (!adminTest && property.status !== 'active')) throw new ConvexError({ code: 'property_not_found', message: 'Property not found. Choose an available villa.' });
		const nights = nightsBetween(checkIn, checkOut);
		const amount = property.pricePerNight * nights;
		if (!Number.isSafeInteger(amount) || amount < 0) {
			throw new ConvexError({ code: 'invalid_accommodation_amount', message: 'The stay price must be non-negative integer satang. Check the villa nightly rate and stay dates.' });
		}
		lines.push({ id: 'accommodation', kind: 'accommodation', propertySlug: property.slug, checkIn, checkOut, nights, amount });
		directDiscountPercent = property.directDiscountPercent;
	}
	if ((args.services?.length ?? 0) > 50) throw new ConvexError({ code: 'too_many_services', message: 'Use at most 50 services in a quote.' });
	for (const [index, service] of (args.services ?? []).entries()) {
		if (!Number.isSafeInteger(service.amount) || service.amount < 0 || service.amount > 1_000_000_000) throw new ConvexError({ code: 'invalid_service_amount', message: 'Invalid service amount. Enter integer satang from 0 to 1,000,000,000 per service.' });
		lines.push({ id: `service-${index}`, kind: 'service', ...service });
	}
	if (lines.reduce((sum, line) => sum + line.amount, 0) > MAX_QUOTE_SUBTOTAL) {
		throw new ConvexError({ code: 'invalid_quote_total', message: 'The quote total is too large. Reduce the stay length or service amounts.' });
	}
	const code = normalizeCouponCode(args.code);
	const coupon = proposed ? proposed.coupon : code ? await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique() : null;
	const rules = proposed?.rules ?? (coupon ? await currentRules(ctx, coupon) : null);
	if (!hasStay && rules && rules.scope !== 'services') {
		throw new ConvexError({ code: 'stay_required', message: 'Choose a villa and stay dates for this coupon.' });
	}
	const status = coupon?.status ?? 'draft';
	const testedRules: CouponRules | undefined = rules
		? {
			...rules, code, version: coupon?.currentVersion ?? 1,
			status: adminTest && status !== 'archived' ? 'active' : status,
			used: coupon?.used ?? 0, discountGranted: coupon?.discountGranted ?? 0,
			held: coupon?.held, heldDiscount: coupon?.heldDiscount,
		}
		: undefined;
	const result = evaluateOffer({ lines, directDiscountPercent, today: resortTodayIso(), coupon: testedRules });
	return code && !testedRules ? { ...result, couponStatus: 'invalid', problem: { code: 'not_found' } } : result;
}

export const campaignTransitions: Record<Doc<'marketingCampaigns'>['status'], Doc<'marketingCampaigns'>['status'][]> = {
	draft: ['active'], active: ['paused', 'ended'], paused: ['active', 'ended'], ended: ['archived'], archived: ['ended']
};
