import { leadsSaveResult } from './validators';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { adminMutation, adminQuery, publicMutation, type QueryCtx } from '../auth/model';
import { assertValidEmail, normalizeEmail } from '../shared/validation';
import { recordLead } from './leadWriter';
import { enforceRateLimit } from './rateLimit';

const leadSource = v.union(
	v.literal('tour_completion'),
	v.literal('chat'),
	v.literal('booking_abandonment')
);

const EXPORT_LIMIT = 5000;

export const save = publicMutation({
  returns: leadsSaveResult,
  reason: "Anonymous contact capture with validated email and rate limits.",
	args: {
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		email: v.string(),
		source: leadSource
	},
	handler: async (ctx, args) => {
		const email = normalizeEmail(args.email);
		assertValidEmail(email);
		await enforceRateLimit(ctx, `lead:${email}`, 5, 60 * 60 * 1000);
		await enforceRateLimit(ctx, 'lead:global', 100, 60 * 60 * 1000);

		let propertyId = args.propertyId;
		if (!propertyId && args.propertySlug) {
			const property = await ctx.db
				.query('properties')
				.withIndex('by_slug', (q) => q.eq('slug', args.propertySlug!))
				.first();
			propertyId = property?._id;
		}

		return await recordLead(ctx, { email, source: args.source, propertyId });
	}
});

/**
 * The one lead dataset for the list and its CSV. Leads are company data: villas (their only link)
 * carry no branch, so operations access (owner or manager) sees every lead, linked or not, in any
 * branch. Filters: source, and an exact normalized email (index-bounded to that address's rows).
 */
type LeadFilters = { source?: Doc<'leads'>['source']; email?: string };
function leadsMatching(ctx: QueryCtx, { source, email }: LeadFilters) {
	const address = email?.trim() ? normalizeEmail(email) : undefined;
	if (address !== undefined) {
		const rows = ctx.db.query('leads').withIndex('by_email', (q) => q.eq('email', address));
		return source ? rows.filter((q) => q.eq(q.field('source'), source)) : rows;
	}
	return source
		? ctx.db.query('leads').withIndex('by_source', (q) => q.eq('source', source))
		: ctx.db.query('leads');
}
const leadFilterArgs = { source: v.optional(leadSource), email: v.optional(v.string()) };

export const list = adminQuery({
	args: { paginationOpts: paginationOptsValidator, ...leadFilterArgs },
	handler: async (ctx, args) => await leadsMatching(ctx, args).order('desc').paginate(args.paginationOpts)
});

/** Every lead for the same filters (newest first, capped) for the CSV export. */
export const exportRows = adminQuery({
	args: leadFilterArgs,
	handler: async (ctx, args) => {
		const rows = await leadsMatching(ctx, args).order('desc').take(EXPORT_LIMIT + 1);
		return { rows: rows.slice(0, EXPORT_LIMIT), truncated: rows.length > EXPORT_LIMIT, limit: EXPORT_LIMIT };
	}
});

export const remove = adminMutation({
	args: { leadId: v.id('leads') },
	handler: async (ctx, args) => {
		if (await ctx.db.get(args.leadId)) await ctx.db.delete(args.leadId);
		return null;
	}
});
