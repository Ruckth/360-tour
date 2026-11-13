import { v } from 'convex/values';
import { marketingQuery } from '../auth/model';
import { canReadMarketingPersonalData } from '../lib/marketingPrivacy';
import { type OfferResult } from '../lib/offers';
import { formatReceiptNumber, orderTitle } from '../shared/orderMath';
import type { CampaignRow, CouponDetail, CouponRow, LinkRow, RedemptionRow, SlugCheck } from '../shared/marketingTypes';
import { campaignStatus, enrichCoupon, enrichLink, publishStatus, quote, quoteArgs, slugCheck } from './catalogModel';

// ---------- Admin queries ----------

export const listCampaigns = marketingQuery({
  permission: 'view',
	args: { status: v.optional(campaignStatus) },
	handler: async (ctx, args): Promise<CampaignRow[]> => {
		const campaigns = await ctx.db.query('marketingCampaigns').withIndex('by_status', q => args.status ? q.eq('status', args.status) : q).take(500);
		return Promise.all(campaigns.map(async campaign => {
			const links = await ctx.db.query('marketingLinks').withIndex('by_campaign', q => q.eq('campaignId', campaign._id)).take(500);
			const coupons = await ctx.db.query('coupons').withIndex('by_campaignId', q => q.eq('campaignId', campaign._id)).take(500);
			return { ...campaign, countsCapped: links.length === 500 || coupons.length === 500, linkCount: links.length, couponCount: coupons.length, opens: links.reduce((sum, link) => sum + link.opens, 0) };
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

/** Admin "test a quote": same engine as the guest, ignores draft/paused status so drafts can be tested. */
export const testQuote = marketingQuery({
  permission: 'view',
	args: quoteArgs,
	handler: async (ctx, args): Promise<OfferResult> => {
		return quote(ctx, args, true);
	}
});

/** Minimal marketing catalog for scoped roles. */
export const catalog = marketingQuery({
  permission: 'view',args:{},handler:async ctx=>{return (await ctx.db.query('properties').take(500)).map(({_id,name,slug,status,pricePerNight,currency,maxGuests,directDiscountPercent})=>({_id,name,slug,status,pricePerNight,currency,maxGuests,directDiscountPercent}));}});
