import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { marketingTables } from './tables';
import { ConvexError, v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { marketingQuery } from '../auth/model';
import { readBudget, ReadBudgetExceeded } from '../lib/readBudget';
import { canReadMarketingPersonalData } from '../shared/marketingPrivacy';
import { activeServiceById, serviceQuery } from '../services/model';
import { type OfferResult } from '../shared/offers';
import { formatReceiptNumber, orderTitle } from '../shared/orderMath';
import { CAMPAIGN_PAGE_SIZE, type CampaignRow, type CouponDetail, type CouponRow, type LinkRow, type RedemptionRow, type SlugCheck } from '../shared/marketingTypes';
import { campaignStatus, currentRules, enrichCoupon, enrichLink, publishStatus, quote, quoteArgs, slugCheck } from './catalogModel';

// ---------- Admin queries ----------

const CAMPAIGN_WINDOW = 500;
const CHILD_CAP = 500;

function campaignWithCounts(campaign: Doc<'marketingCampaigns'>, links: Doc<'marketingLinks'>[], coupons: Doc<'coupons'>[]): CampaignRow {
	return {
		...campaign,
		countsCapped: links.length === CHILD_CAP || coupons.length === CHILD_CAP,
		linkCount: links.length,
		couponCount: coupons.length,
		opens: links.reduce((sum, link) => sum + link.opens, 0)
	};
}

async function readCampaignRange<T>(ctx: object, range: AsyncIterable<T>, limit: number): Promise<T[]> {
	const budget = readBudget(ctx);
	if (!budget.range()) throw new ReadBudgetExceeded();
	const rows: T[] = [];
	for await (const row of range) {
		if (!budget.document(row)) throw new ReadBudgetExceeded();
		rows.push(row);
		if (rows.length === limit) break;
	}
	return rows;
}

export const listCampaigns = marketingQuery({
  permission: 'view',
  args: { status: v.optional(campaignStatus), campaignIds: v.optional(v.array(v.id('marketingCampaigns'))) },
  returns: v.array(v.object({
    ...marketingTables.marketingCampaigns.validator.fields,
    _id: v.id('marketingCampaigns'), _creationTime: v.number(),
    linkCount: v.number(), couponCount: v.number(), opens: v.number(), countsCapped: v.boolean()
  })),
  handler: async (ctx, { campaignIds, status }): Promise<CampaignRow[]> => {
    // A displayed page preserves the requested order and bounds work across all children.
    if (campaignIds) {
      if (campaignIds.length > CAMPAIGN_PAGE_SIZE) {
        throw new ConvexError({ code: 'campaign_page_size', message: `Choose up to ${CAMPAIGN_PAGE_SIZE} campaigns per page.` });
      }
      const budget = readBudget(ctx);
      const rows: CampaignRow[] = [];
      for (const campaignId of new Set(campaignIds)) {
        if (!budget.range()) throw new ReadBudgetExceeded();
        const campaign = await ctx.db.get(campaignId);
        if (!campaign || (status && campaign.status !== status)) continue;
        if (!budget.document(campaign)) throw new ReadBudgetExceeded();
        const links = await readCampaignRange(ctx, ctx.db.query('marketingLinks').withIndex('by_campaign', q => q.eq('campaignId', campaignId)), CHILD_CAP);
        const coupons = await readCampaignRange(ctx, ctx.db.query('coupons').withIndex('by_campaignId', q => q.eq('campaignId', campaignId)), CHILD_CAP);
        rows.push(campaignWithCounts(campaign, links, coupons));
      }
      return rows;
    }
    // Existing callers without a page receive the status-ordered campaign window.
    const campaigns = await ctx.db.query('marketingCampaigns').withIndex('by_status', q => status ? q.eq('status', status) : q).take(CAMPAIGN_WINDOW);
    return Promise.all(campaigns.map(async campaign => {
      const links = await ctx.db.query('marketingLinks').withIndex('by_campaign', q => q.eq('campaignId', campaign._id)).take(CHILD_CAP);
      const coupons = await ctx.db.query('coupons').withIndex('by_campaignId', q => q.eq('campaignId', campaign._id)).take(CHILD_CAP);
      return campaignWithCounts(campaign, links, coupons);
    }));
  }
});

/** Keeps the campaign window and order for selectors and campaign table filters. */
export const listCampaignOptions = marketingQuery({
	permission: 'view',
	args: { projection: v.optional(v.union(v.literal('search'), v.literal('attribution'))) },
	returns: v.array(v.object({
		_id: v.id('marketingCampaigns'),
		name: v.string(),
		status: campaignStatus,
		source: v.optional(v.string()),
		medium: v.optional(v.string()),
		searchText: v.optional(v.string())
	})),
	handler: async (ctx, { projection }) => {
		const campaigns = await readCampaignRange(ctx, ctx.db.query('marketingCampaigns').withIndex('by_status'), CAMPAIGN_WINDOW);
		return campaigns.map(({ _id, name, status, source, medium, notes }) => ({
			_id, name, status,
			...(projection === 'search' ? { searchText: [name, source, medium, notes ?? ''].join(' ').toLowerCase() } : {}),
			...(projection === 'attribution' ? { source, medium } : {})
		}));
	}
});

export const listLinks = marketingQuery({
  permission: 'view',
	args: { campaignId: v.optional(v.id('marketingCampaigns')), status: v.optional(publishStatus) },
	handler: async (ctx, args): Promise<LinkRow[]> => {
		const links = args.campaignId
			? await ctx.db.query('marketingLinks').withIndex('by_campaign', q => {
				const index = q.eq('campaignId', args.campaignId!);
				return args.status ? index.eq('status', args.status) : index;
			}).take(500)
			: await ctx.db.query('marketingLinks').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(links.map(link => enrichLink(ctx, link)));
	}
});

export const listCoupons = marketingQuery({
  permission: 'view',
	args: { status: v.optional(publishStatus) },
	handler: async (ctx, args): Promise<CouponRow[]> => {
		const coupons = await ctx.db.query('coupons').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(coupons.map(coupon => enrichCoupon(ctx, coupon)));
	}
});

export const listCampaignCoupons = marketingQuery({
	permission: 'view',
	args: { campaignId: v.id('marketingCampaigns') },
  returns: v.array(v.object({
    ...marketingTables.coupons.validator.fields, _id: v.id('coupons'), _creationTime: v.number(),
    rules: v.object({ ...marketingTables.couponVersions.validator.fields, _id: v.id('couponVersions'), _creationTime: v.number() }),
    campaignName: v.optional(v.string())
  })),
	handler: async (ctx, { campaignId }): Promise<CouponRow[]> => {
		const coupons = await ctx.db.query('coupons').withIndex('by_campaignId', q => q.eq('campaignId', campaignId)).take(CHILD_CAP);
		return Promise.all(coupons.map(async coupon => ({ ...coupon, rules: await currentRules(ctx, coupon) })));
	}
});

export const getCoupon = marketingQuery({
  permission: 'view',
	args: { couponId: v.string() },
	handler: async (ctx, args): Promise<CouponDetail | null> => {
		const access = ctx.marketing;
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

export const checkSlug = marketingQuery({
  permission: 'view',
	args: { slug: v.string(), linkId: v.optional(v.id('marketingLinks')) },
	handler: async (ctx, args): Promise<SlugCheck> => {
		return slugCheck(ctx, args.slug, args.linkId);
	}
});

export const listQuoteServices = marketingQuery({
	permission: 'view',
	args: { paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(v.object({ id: v.id('services'), name: v.string(), category: v.string(), durationMin: v.number() })),
	handler: async (ctx, { paginationOpts }) => {
		const result = await serviceQuery(ctx, {}).paginate({
			...paginationOpts,
			numItems: Math.max(1, Math.min(20, paginationOpts.numItems)),
		});
		return {
			...result,
			page: result.page.map(({ _id, name, category, durationMin }) => ({ id: _id, name, category, durationMin })),
		};
	},
});

/** Admin "test a quote": same engine as the guest, ignores draft/paused status so drafts can be tested. */
export const testQuote = marketingQuery({
  permission: 'view',
	args: { ...quoteArgs, services: v.optional(v.array(v.object({ serviceId: v.id('services'), amount: v.number() }))) },
	handler: async (ctx, { services, ...args }): Promise<OfferResult> => {
		if ((services?.length ?? 0) > 50) throw new ConvexError({ code: 'too_many_services', message: 'Use at most 50 services in a quote.' });
		const catalog = new Map(await Promise.all([...new Set(services?.map(({ serviceId }) => serviceId))].map(
			async (id) => [id, await activeServiceById(ctx, id)] as const,
		)));
		const lines = services?.map(({ serviceId, amount }) => {
			const service = catalog.get(serviceId);
			if (!service) throw new ConvexError({ code: 'service_unavailable', message: 'A selected service is no longer available. Choose another service.' });
			return { label: service.name, amount };
		});
		return quote(ctx, { ...args, services: lines }, true);
	}
});

/** Minimal marketing catalog for scoped roles. */
export const catalog = marketingQuery({
  permission: 'view',args:{},handler:async ctx=>{return (await ctx.db.query('properties').take(500)).map(({_id,name,slug,status,pricePerNight,currency,maxGuests,directDiscountPercent})=>({_id,name,slug,status,pricePerNight,currency,maxGuests,directDiscountPercent}));}});
