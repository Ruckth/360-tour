import { authenticatedMutation, publicQuery } from '../auth/model';

export const store = authenticatedMutation({
	args: {},
	handler: async (ctx) => {
		const identity = ctx.identity;
		if (!identity) {
			throw new Error("Not authenticated");
		}

		const existing = await ctx.db
			.query("users")
			.withIndex("by_token", (q) =>
				q.eq("tokenIdentifier", identity.tokenIdentifier)
			)
			.unique();

		if (existing) {
			// Update if profile info changed
			if (
				existing.name !== identity.name ||
				existing.email !== identity.email ||
				existing.imageUrl !== identity.pictureUrl
			) {
				await ctx.db.patch(existing._id, {
					name: identity.name ?? undefined,
					email: identity.email!,
					imageUrl: identity.pictureUrl ?? undefined,
				});
			}
			return existing._id;
		}

		return await ctx.db.insert("users", {
			clerkId: identity.subject,
			tokenIdentifier: identity.tokenIdentifier,
			email: identity.email!,
			name: identity.name ?? undefined,
			imageUrl: identity.pictureUrl ?? undefined,
		});
	},
});

export const current = publicQuery({
  reason: "Self lookup by authenticated tokenIdentifier, or null when signed out.",
	args: {},
	handler: async (ctx) => {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return null;
		}

		return await ctx.db
			.query("users")
			.withIndex("by_token", (q) =>
				q.eq("tokenIdentifier", identity.tokenIdentifier)
			)
			.unique();
	},
});
