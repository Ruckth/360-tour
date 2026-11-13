import { v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { publicMutation, publicQuery } from '../auth/model';
import { resortTodayIso } from '../shared/time';
import { localizeMarketingPath } from '../shared/marketingSlugs';
import { type OfferResult } from '../shared/offers';
import { enforceRateLimit, rateLimitReached } from '../messaging/model';
import { cleanLandingPath, cleanReferrerHost, isVisitorKey, newVisitorKey } from '../shared/marketingAttribution';
import type { ResolvedLink } from '../shared/marketingTypes';
import { quote, quoteArgs } from './catalogModel';

// ---------- Public ----------

/** Short-link resolver used by the `/<slug>` route. Returns null for unknown slugs. */
export const resolveLink = publicQuery({
  reason: "Anonymous campaign landing link with live-status and privacy projection checks.",
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
export const recordOpen = publicMutation({
  reason: "Anonymous campaign opening telemetry; validated link and rate limits.",
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
export const startSession = publicMutation({
  reason: "Anonymous consent-based attribution session; validated capture and rate limits.",
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
export const previewCoupon = publicQuery({
  reason: "Anonymous booking coupon quote; live offer rules and safe projection.",
	args: quoteArgs,
	handler: async (ctx, args): Promise<OfferResult> => {
		return quote(ctx, args, false);
	}
});
