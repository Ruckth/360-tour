import { paginationOptsValidator } from 'convex/server';
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { assertValidEmail, normalizeEmail } from './lib/validation';
import { requireAdmin } from './lib/adminAuth';
import { enforceRateLimit } from './lib/rateLimit';

const leadSource = v.union(
	v.literal('tour_completion'),
	v.literal('chat'),
	v.literal('booking_abandonment')
);

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

		// Check for duplicate email + property combination
		const existing = await ctx.db
			.query('leads')
			.withIndex('by_email', (q) => q.eq('email', email))
			.first();

		if (existing) {
			return existing._id;
		}

		return await ctx.db.insert('leads', {
			propertyId,
			email,
			source: args.source,
			createdAt: Date.now()
		});
	}
});

export const list = query({
	args: { paginationOpts: paginationOptsValidator, source: v.optional(leadSource) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const newest = ctx.db.query('leads').order('desc');
		const { source } = args;
		// Filtered pages can come back short; the client keeps loading until isDone.
		return await (source ? newest.filter((q) => q.eq(q.field('source'), source)) : newest).paginate(
			args.paginationOpts
		);
	}
});
