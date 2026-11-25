import { grantRole, usersFields } from './validators';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Owned by auth; assembled only by convex/schema.ts.
export const authTables = {
 staffGrants: defineTable({
  email: v.string(), role: grantRole, branchIds: v.array(v.id('branches')), tokenIdentifier: v.optional(v.string()), revision: v.optional(v.number()),
  inviteExpiresAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(), updatedByEmail: v.string()
 }).index('by_email', ['email']).index('by_tokenIdentifier', ['tokenIdentifier'])
   .index('by_role', ['role']).index('by_role_and_tokenIdentifier', ['role', 'tokenIdentifier']),

	users: defineTable(usersFields)
		.index('by_token', ['tokenIdentifier'])
		.index('by_clerk_id', ['clerkId'])
};
