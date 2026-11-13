import { affiliateState, creditState, affiliateSnapshot, marketingRole } from '../lib/affiliateTypes';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { couponRefusalProblemValidator, couponRefusalSurfaceValidator } from '../lib/marketingReport';

// Owned by marketing; assembled only by convex/schema.ts.
export const marketingTables = {

	// Marketing release 1: campaigns, short links and coupon catalog (see convex/marketing.ts).

	// Marketing R4: grants bind an explicit email invitation to the authenticated canonical identity.
	marketingGrants: defineTable({
		email: v.string(),
		role: marketingRole,
		inviteExpiresAt: v.optional(v.number()),
		tokenIdentifier: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_email', ['email']).index('by_tokenIdentifier', ['tokenIdentifier']),

	marketingAffiliates: defineTable({
		name: v.string(),
		slug: v.string(),
		campaignId: v.id('marketingCampaigns'),
		canonicalLinkId: v.optional(v.id('marketingLinks')),
		status: affiliateState,
		contactEmail: v.optional(v.string()),
		propertySlugs: v.optional(v.array(v.string())),
		startsOn: v.optional(v.string()),
		endsOn: v.optional(v.string()),
		notes: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_slug', ['slug']).index('by_status', ['status']),

	// Net collections and manual referral approval only. These records never calculate a commission or payout.
	affiliateCredits: defineTable({
		sourceKey: v.string(),
		bookingId: v.optional(v.id('bookings')),
		orderId: v.optional(v.id('orders')),
		snapshot: affiliateSnapshot,
		affiliateId: v.optional(v.id('marketingAffiliates')),
		state: creditState,
		eligibleNet: v.number(),
		approvedNet: v.number(),
		eligible: v.boolean(),
		revision: v.number(),
		reason: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_sourceKey', ['sourceKey'])
		.index('by_affiliateId_and_state', ['affiliateId', 'state'])
		.index('by_state', ['state']),

	// Append-only: one row for each credit revision; decision reasons and amount/reversal changes are retained.
	affiliateCreditChanges: defineTable({
		creditId: v.id('affiliateCredits'),
		revision: v.number(),
		actor: v.string(),
		kind: v.string(),
		reason: v.optional(v.string()),
		state: creditState,
		eligibleNet: v.number(),
		approvedNet: v.number(),
		affiliateId: v.optional(v.id('marketingAffiliates')),
		recordedAt: v.number()
	}).index('by_creditId_and_revision', ['creditId', 'revision']),


	marketingCampaigns: defineTable({
		name: v.string(),
		source: v.string(),
		medium: v.string(),
		status: v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('ended'), v.literal('archived')),
		startsOn: v.optional(v.string()),
		endsOn: v.optional(v.string()),
		budget: v.optional(v.number()),
		notes: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_status', ['status']),


	marketingLinks: defineTable({
		affiliateId: v.optional(v.id('marketingAffiliates')),
		slug: v.string(),
		name: v.string(),
		campaignId: v.id('marketingCampaigns'),
		placement: v.optional(v.string()),
		destination: v.union(
			v.object({ kind: v.literal('home') }),
			v.object({ kind: v.literal('booking'), propertySlug: v.optional(v.string()) }),
			v.object({ kind: v.literal('villa'), propertySlug: v.string() }),
			v.object({ kind: v.literal('experiences') }),
			v.object({ kind: v.literal('chat') })
		),
		locale: v.optional(v.string()),
		couponId: v.optional(v.id('coupons')),
		entry: v.union(v.literal('link'), v.literal('qr')),
		status: v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('archived')),
		opens: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	})
		.index('by_slug', ['slug'])
		.index('by_campaign', ['campaignId', 'status'])
		.index('by_status', ['status'])
		.index('by_couponId', ['couponId'])
		.index('by_affiliateId', ['affiliateId']),


	marketingEvents: defineTable({
		linkId: v.id('marketingLinks'),
		kind: v.literal('open'),
		bot: v.boolean(),
		occurredAt: v.number()
	}).index('by_link_and_time', ['linkId', 'occurredAt']).index('by_occurredAt', ['occurredAt']),


	// Release 3a: one consented browser session (see convex/shared/marketingAttribution.ts). No personal data.
	marketingSessions: defineTable({
		/** Server-minted, kept in the browser only after analytics consent. */
		visitorKey: v.string(),
		linkId: v.optional(v.id('marketingLinks')),
		campaignId: v.optional(v.id('marketingCampaigns')),
		landingPath: v.string(),
		referrerHost: v.optional(v.string()),
		startedAt: v.number()
	})
		.index('by_visitorKey_and_startedAt', ['visitorKey', 'startedAt'])
		.index('by_linkId_and_startedAt', ['linkId', 'startedAt'])
		.index('by_startedAt', ['startedAt']),


	// Release 3b: consented sessions per Bangkok day, link and the campaign the link belonged to then,
	// kept by startSession so the report never reads raw sessions.
	marketingSessionDays: defineTable({
		day: v.string(),
		/** Absent = sessions that arrived without a link. */
		linkId: v.optional(v.id('marketingLinks')),
		campaignId: v.optional(v.id('marketingCampaigns')),
		count: v.number()
	}).index('by_day_and_linkId_and_campaignId', ['day', 'linkId', 'campaignId']),


	// Release 3b: what a campaign cost, entered by staff in integer satang and spread evenly over its days.
	marketingSpend: defineTable({
		campaignId: v.id('marketingCampaigns'),
		amount: v.number(),
		from: v.string(),
		to: v.string(),
		note: v.optional(v.string()),
		/** Soft delete: kept for history, left out of every report. */
		deletedAt: v.optional(v.number()),
		deletedByEmail: v.optional(v.string()),
		createdAt: v.number(),
		createdByEmail: v.string(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	})
		.index('by_campaignId_and_from', ['campaignId', 'from'])
		.index('by_to', ['to']),


	// Release 3b: coupon refusals per Bangkok day. No guest data and never the typed text (unknown codes have no couponId).
	couponRefusalDays: defineTable({
		day: v.string(),
		couponId: v.optional(v.id('coupons')),
		problem: couponRefusalProblemValidator,
		surface: couponRefusalSurfaceValidator,
		count: v.number()
	})
		.index('by_day_and_couponId_and_problem_and_surface', ['day', 'couponId', 'problem', 'surface'])
		.index('by_couponId_and_day', ['couponId', 'day']),


	coupons: defineTable({
		affiliateId: v.optional(v.id('marketingAffiliates')),
		code: v.string(),
		campaignId: v.optional(v.id('marketingCampaigns')),
		status: v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('archived')),
		currentVersion: v.number(),
		used: v.number(),
		discountGranted: v.number(),
		// Release 2: slots and discount held by unpaid bookings (see convex/marketing/couponRedemptions.ts).
		held: v.optional(v.number()),
		heldDiscount: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	})
		.index('by_code', ['code'])
		.index('by_status', ['status'])
		.index('by_campaignId', ['campaignId'])
		.index('by_affiliateId', ['affiliateId']),


	// One row per coupon use. held -> consumed (first payment) | released (unpaid stay cancelled/expired);
	// consumed -> reversed (stay cancelled after payment; the slot is NOT given back).
	couponRedemptions: defineTable({
		couponId: v.id('coupons'),
		couponVersion: v.number(),
		code: v.string(),
		bookingId: v.optional(v.id('bookings')),
		/** Release 2b: a checkout order's coupon use. Exactly one of bookingId / orderId is set. */
		orderId: v.optional(v.id('orders')),
		state: v.union(v.literal('held'), v.literal('consumed'), v.literal('released'), v.literal('reversed')),
		discount: v.number(),
		// Captured money is always honoured: set when a late payment consumed a slot past the limit or budget.
		overLimit: v.optional(v.boolean()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_bookingId', ['bookingId'])
		.index('by_orderId', ['orderId'])
		.index('by_couponId_and_state', ['couponId', 'state'])
		.index('by_couponId_and_createdAt', ['couponId', 'createdAt']),


	// Immutable: a change to the offer writes a new version; redemptions keep the version they used.
	couponVersions: defineTable({
		couponId: v.id('coupons'),
		version: v.number(),
		benefit: v.union(
			v.object({ kind: v.literal('percent'), percent: v.number() }),
			v.object({ kind: v.literal('fixed'), amount: v.number() })
		),
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
		terms: v.optional(v.string()),
		createdAt: v.number(),
		createdByEmail: v.string()
	}).index('by_coupon_and_version', ['couponId', 'version'])
};
