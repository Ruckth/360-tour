import { staffRole } from '../lib/staffTypes';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Owned by auth; assembled only by convex/schema.ts.
export const authTables = {
 staffGrants: defineTable({
  email: v.string(), role: staffRole, tokenIdentifier: v.optional(v.string()), revision: v.optional(v.number()),
  inviteExpiresAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(), updatedByEmail: v.string()
 }).index('by_email', ['email']).index('by_tokenIdentifier', ['tokenIdentifier']),

	users: defineTable({
		clerkId: v.string(),
		tokenIdentifier: v.string(),
		email: v.string(),
		name: v.optional(v.string()),
		imageUrl: v.optional(v.string())
	})
		.index('by_token', ['tokenIdentifier'])
		.index('by_clerk_id', ['clerkId'])
};
