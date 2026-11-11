import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { validateMarketingSlug } from './marketingSlugs';

/**
 * Release 3a: which marketing link brought a booking.
 *
 * The browser only ever sends a link slug (kept for one tab, no consent needed) or, after analytics
 * consent, a server-minted visitor key. Everything else (link, campaign, source, medium, times) is
 * looked up and set on the server, so a forged request can at most claim a real link, exactly as
 * clicking it would.
 */
export const ATTRIBUTION_MODEL = 'last_touch_30d@1';
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** The browser starts a new session after this much inactivity (or when a different link arrives). */
export const SESSION_IDLE_MS = 30 * 60 * 1000;
/** Bounds the per-visitor session read when a booking is stamped. */
export const MAX_SESSIONS_READ = 200;

const entry = v.union(v.literal('link'), v.literal('qr'));

/** One link touch. Campaign name, source and medium are frozen when the booking is stamped. */
export const marketingTouchValidator = v.object({
	linkId: v.id('marketingLinks'),
	slug: v.string(),
	campaignId: v.id('marketingCampaigns'),
	campaignName: v.string(),
	source: v.string(),
	medium: v.string(),
	entry,
	placement: v.optional(v.string()),
	/** Tracked touches only: the session that arrived through the link, and when. */
	sessionId: v.optional(v.id('marketingSessions')),
	touchedAt: v.optional(v.number())
});

export const marketingAttributionValidator = v.object({
	model: v.literal(ATTRIBUTION_MODEL),
	/** tracked: consented sessions. current_link: only the link this tab arrived through (before consent). */
	evidence: v.union(v.literal('tracked'), v.literal('current_link')),
	/** Tracked only: the visitor's latest session, for visit-cohort conversion. */
	sessionId: v.optional(v.id('marketingSessions')),
	/** That session's cohort, frozen because raw sessions are deleted after the retention period. */
	session: v.optional(v.object({
		startedAt: v.number(),
		linkId: v.optional(v.id('marketingLinks')),
		campaignId: v.optional(v.id('marketingCampaigns'))
	})),
	/** Absent on a tracked visit with no link in the window (a direct visit). */
	last: v.optional(marketingTouchValidator),
	/** Earliest link touch in the window. Set whenever `last` is tracked; may equal it. */
	first: v.optional(marketingTouchValidator),
	capturedAt: v.number()
});

/** What the browser sends with a booking or a chat session. Both fields are optional and untrusted. */
export const marketingCaptureValidator = v.object({
	visitorKey: v.optional(v.string()),
	slug: v.optional(v.string())
});

export type MarketingTouch = Infer<typeof marketingTouchValidator>;
export type MarketingAttribution = Infer<typeof marketingAttributionValidator>;
export type MarketingCapture = Infer<typeof marketingCaptureValidator>;

const VISITOR_KEY = /^mv_[0-9a-f]{32}$/;
export const isVisitorKey = (key: string | undefined): key is string => key !== undefined && VISITOR_KEY.test(key);
export const newVisitorKey = () => 'mv_' + crypto.randomUUID().replace(/-/g, '');

/** Keeps only a well-formed visitor key and a valid slug; undefined when neither is left. */
export function cleanCapture(capture: MarketingCapture | undefined): MarketingCapture | undefined {
	const visitorKey = isVisitorKey(capture?.visitorKey) ? capture.visitorKey : undefined;
	const checked = capture?.slug === undefined ? undefined : validateMarketingSlug(capture.slug);
	const slug = checked && !checked.reason ? checked.slug : undefined;
	return visitorKey || slug ? { ...(visitorKey ? { visitorKey } : {}), ...(slug ? { slug } : {}) } : undefined;
}

/** Path only (no query or fragment), capped, always starting with "/". */
export function cleanLandingPath(path: string): string {
	const bare = path.split(/[?#]/, 1)[0].trim();
	const safe = bare.startsWith('/') && !bare.startsWith('//') ? bare : '/';
	return safe.replace(/[\s\u0000-\u001f\u007f]/g, '').slice(0, 200) || '/';
}

/** A lower-case host name, or undefined for junk, our own site or anything too long. */
export function cleanReferrerHost(host: string | undefined, ownHost?: string): string | undefined {
	const value = host?.trim().toLowerCase().replace(/^www\./, '');
	if (!value || value.length > 100 || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return undefined;
	const own = ownHost?.toLowerCase().replace(/^www\./, '');
	return value === own ? undefined : value;
}

export function touchFromLink(
	link: Pick<Doc<'marketingLinks'>, '_id' | 'slug' | 'campaignId' | 'entry' | 'placement'>,
	campaign: Pick<Doc<'marketingCampaigns'>, 'name' | 'source' | 'medium'>,
	session?: { sessionId: Id<'marketingSessions'>; startedAt: number }
): MarketingTouch {
	return {
		linkId: link._id, slug: link.slug, campaignId: link.campaignId, campaignName: campaign.name,
		source: campaign.source, medium: campaign.medium, entry: link.entry,
		...(link.placement ? { placement: link.placement } : {}),
		...(session ? { sessionId: session.sessionId, touchedAt: session.startedAt } : {})
	};
}

/** A visitor's session with its link touch already resolved (absent when it arrived without a usable link). */
export type SessionTouch = { sessionId: Id<'marketingSessions'>; startedAt: number; linkId?: Id<'marketingLinks'>; campaignId?: Id<'marketingCampaigns'>; touch?: MarketingTouch };

/**
 * The attribution rule, kept pure for tests.
 * - Consented sessions in the last 30 days win: last = latest linked one, first = earliest linked one,
 *   so a later direct visit never erases a link. A tab link that none of those sessions carries is a
 *   visit that wasn't recorded (startSession was refused or failed), so it is the newest touch.
 * - Otherwise the link this tab arrived through, labelled current_link.
 * - Otherwise nothing: R3b reports the booking under unknown, staff-entered or messaging.
 */
export function buildAttribution(input: { sessions: SessionTouch[]; currentLink?: MarketingTouch; now: number }): MarketingAttribution | undefined {
	const { now, currentLink } = input;
	const recent = input.sessions
		.filter(s => s.startedAt <= now && s.startedAt >= now - ATTRIBUTION_WINDOW_MS)
		.sort((a, b) => a.startedAt - b.startedAt);
	if (recent.length) {
		const linked = recent.filter(s => s.touch);
		const unrecorded = currentLink && !linked.some(s => s.touch!.linkId === currentLink.linkId) ? currentLink : undefined;
		const last = unrecorded ?? linked[linked.length - 1]?.touch;
		const first = linked[0]?.touch ?? unrecorded;
		const latest = recent[recent.length - 1];
		const session = { startedAt: latest.startedAt, ...(latest.linkId ? { linkId: latest.linkId } : {}), ...(latest.campaignId ? { campaignId: latest.campaignId } : {}) };
		return {
			model: ATTRIBUTION_MODEL, evidence: 'tracked', sessionId: latest.sessionId, session,
			...(last ? { last } : {}), ...(first ? { first } : {}), capturedAt: now
		};
	}
	if (currentLink) return { model: ATTRIBUTION_MODEL, evidence: 'current_link', last: currentLink, capturedAt: now };
	return undefined;
}

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
