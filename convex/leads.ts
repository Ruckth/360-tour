import { paginationOptsValidator } from 'convex/server';
import { mutation, query, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { assertValidEmail, normalizeEmail } from './lib/validation';
import { requireAdmin } from './lib/adminAuth';
import { enforceRateLimit } from './lib/rateLimit';

const leadSource = v.union(
	v.literal('tour_completion'),
	v.literal('chat'),
	v.literal('booking_abandonment')
);

const EXPORT_LIMIT = 5000;

/**
 * One row per email + source + villa: a repeat sign-up from somewhere new gets its own row,
 * an identical repeat returns the existing one.
 */
export async function recordLead(
	ctx: MutationCtx,
	lead: { email: string; source: Doc<'leads'>['source']; propertyId?: Id<'properties'> }
) {
	// first(), not unique(): older data may already hold duplicates of a combination.
	const duplicate = await ctx.db
		.query('leads')
		.withIndex('by_email_and_source_and_propertyId', (q) =>
			q.eq('email', lead.email).eq('source', lead.source).eq('propertyId', lead.propertyId)
		)
		.first();
	if (duplicate) return duplicate._id;

	return await ctx.db.insert('leads', {
		...(lead.propertyId ? { propertyId: lead.propertyId } : {}),
		email: lead.email,
		source: lead.source,
		createdAt: Date.now()
	});
}

export const save = mutation({
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

export const list = query({
	args: { paginationOpts: paginationOptsValidator, source: v.optional(leadSource) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const { source } = args;
		const leads = source
			? ctx.db.query('leads').withIndex('by_source', (q) => q.eq('source', source))
			: ctx.db.query('leads');
		return await leads.order('desc').paginate(args.paginationOpts);
	}
});

/** Every lead for the source filter (newest first, capped) for the CSV export. */
export const exportRows = query({
	args: { source: v.optional(leadSource) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const { source } = args;
		const leads = source
			? ctx.db.query('leads').withIndex('by_source', (q) => q.eq('source', source))
			: ctx.db.query('leads');
		const rows = await leads.order('desc').take(EXPORT_LIMIT + 1);
		return { rows: rows.slice(0, EXPORT_LIMIT), truncated: rows.length > EXPORT_LIMIT };
	}
});

export const remove = mutation({
	args: { leadId: v.id('leads') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (await ctx.db.get(args.leadId)) await ctx.db.delete(args.leadId);
		return null;
	}
});
