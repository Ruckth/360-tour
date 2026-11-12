import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { adminMutation, adminQuery, publicMutation } from '../auth/model';
import { assertValidEmail, normalizeEmail } from '../lib/validation';
import { recordLead } from './leadWriter';
import { enforceRateLimit } from './rateLimit';

const leadSource = v.union(
	v.literal('tour_completion'),
	v.literal('chat'),
	v.literal('booking_abandonment')
);

const EXPORT_LIMIT = 5000;

export const save = publicMutation({
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

export const list = adminQuery({
	args: { paginationOpts: paginationOptsValidator, source: v.optional(leadSource) },
	handler: async (ctx, args) => {
		const { source } = args;
		const leads = source
			? ctx.db.query('leads').withIndex('by_source', (q) => q.eq('source', source))
			: ctx.db.query('leads');
		return await leads.order('desc').paginate(args.paginationOpts);
	}
});

/** Every lead for the source filter (newest first, capped) for the CSV export. */
export const exportRows = adminQuery({
	args: { source: v.optional(leadSource) },
	handler: async (ctx, args) => {
		const { source } = args;
		const leads = source
			? ctx.db.query('leads').withIndex('by_source', (q) => q.eq('source', source))
			: ctx.db.query('leads');
		const rows = await leads.order('desc').take(EXPORT_LIMIT + 1);
		return { rows: rows.slice(0, EXPORT_LIMIT), truncated: rows.length > EXPORT_LIMIT };
	}
});

export const remove = adminMutation({
	args: { leadId: v.id('leads') },
	handler: async (ctx, args) => {
		if (await ctx.db.get(args.leadId)) await ctx.db.delete(args.leadId);
		return null;
	}
});
