import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import type { MarketingAttribution, MarketingCapture, MarketingTouch, SessionTouch } from '../shared/marketingAttribution';
import { ATTRIBUTION_WINDOW_MS, buildAttribution, isVisitorKey, MAX_SESSIONS_READ, touchFromLink } from '../shared/marketingAttribution';

/**
 * Server glue for createBookingRecord: reads the visitor's sessions (by_visitorKey_and_startedAt, bounded by
 * MAX_SESSIONS_READ), resolves each session's link and campaign, resolves the tab's slug (any non-draft link),
 * then applies buildAttribution. Unknown keys, unknown or draft slugs and missing campaigns are ignored.
 */
export async function resolveMarketingAttribution(
	ctx: QueryCtx, capture: MarketingCapture | undefined, now: number
): Promise<MarketingAttribution | undefined> {
	if (!capture) return undefined;
	const links = new Map<Id<'marketingLinks'>, Doc<'marketingLinks'> | null>();
	const campaigns = new Map<Id<'marketingCampaigns'>, Doc<'marketingCampaigns'> | null>();
	async function resolveTouch(linkId: Id<'marketingLinks'>, session?: { sessionId: Id<'marketingSessions'>; startedAt: number }, campaignId?: Id<'marketingCampaigns'>) {
		if (!links.has(linkId)) links.set(linkId, await ctx.db.get(linkId));
		const link = links.get(linkId);
		if (!link) return undefined;
		const resolvedCampaignId = campaignId ?? link.campaignId;
		if (!campaigns.has(resolvedCampaignId)) campaigns.set(resolvedCampaignId, await ctx.db.get(resolvedCampaignId));
		const campaign = campaigns.get(resolvedCampaignId);
		return campaign ? touchFromLink({ ...link, campaignId: resolvedCampaignId }, campaign, session) : undefined;
	}
	const rows = isVisitorKey(capture.visitorKey)
		? await ctx.db.query('marketingSessions').withIndex('by_visitorKey_and_startedAt', q =>
			q.eq('visitorKey', capture.visitorKey!).gte('startedAt', now - ATTRIBUTION_WINDOW_MS).lte('startedAt', now)
		).order('desc').take(MAX_SESSIONS_READ) : [];
	const sessions: SessionTouch[] = [];
	for (const row of rows) {
		const session = { sessionId: row._id, startedAt: row.startedAt };
		sessions.push({ ...session, ...(row.linkId ? { linkId: row.linkId } : {}), ...(row.campaignId ? { campaignId: row.campaignId } : {}), ...(row.linkId && row.campaignId ? { touch: await resolveTouch(row.linkId, session, row.campaignId) } : {}) });
	}
	let currentLink: MarketingTouch | undefined;
	if (capture.slug) {
		const link = await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', capture.slug!)).unique();
		if (link && link.status !== 'draft') {
			links.set(link._id, link);
			currentLink = await resolveTouch(link._id);
		}
	}
	return buildAttribution({ sessions, currentLink, now });
}
