import { usersFields } from './validators';
import { staffRole } from '../shared/staffTypes';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Owned by auth; assembled only by convex/schema.ts.
export const authTables = {
 staffGrants: defineTable({
  email: v.string(), role: staffRole, tokenIdentifier: v.optional(v.string()), revision: v.optional(v.number()),
  inviteExpiresAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(), updatedByEmail: v.string()
 }).index('by_email', ['email']).index('by_tokenIdentifier', ['tokenIdentifier']),

	users: defineTable(usersFields)
		.index('by_token', ['tokenIdentifier'])
		.index('by_clerk_id', ['clerkId'])
};
