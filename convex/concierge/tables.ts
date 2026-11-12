import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Owned by concierge; assembled only by convex/schema.ts.
export const conciergeTables = {

	// Owner-maintained evidence, independent from the retired question/answer bank.
	businessFacts: defineTable({
		title: v.string(), body: v.string(), searchText: v.string(), source: v.string(),
		propertyId: v.optional(v.id('properties')),
		status: v.union(v.literal('draft'), v.literal('approved'), v.literal('archived')),
		revision: v.number(), createdAt: v.number(), updatedAt: v.number(),
		createdByAdminEmail: v.string(), updatedByAdminEmail: v.string()
	})
		.index('by_status_and_updatedAt', ['status', 'updatedAt'])
		.searchIndex('search_text', { searchField: 'searchText', filterFields: ['status', 'propertyId'] }),


	chatUnknownQuestions: defineTable({
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		sessionId: v.optional(v.id('conversations')),
		userQuestion: v.string(),
		normalizedQuestion: v.string(),
		detectedTopic: v.optional(v.string()),
		userId: v.optional(v.string()),
		pageUrl: v.optional(v.string()),
		status: v.union(v.literal('new'), v.literal('resolved'), v.literal('ignored')),
		adminNotified: v.boolean(),
		resolvedFactId: v.optional(v.id('businessFacts')),
		resolvedSource: v.optional(
			v.union(
				v.literal('settings'),
				v.literal('property_details'),
				v.literal('services'),
				v.literal('pricing_availability')
			)
		),
		createdAt: v.number(),
		updatedAt: v.number(),
		resolvedAt: v.optional(v.number()),
		ignoredAt: v.optional(v.number())
	})
		.index('by_createdAt', ['createdAt'])
		.index('by_status_and_createdAt', ['status', 'createdAt'])
		.index('by_status_and_normalizedQuestion', ['status', 'normalizedQuestion'])
		.index('by_status_and_normalizedQuestion_and_propertyId', ['status', 'normalizedQuestion', 'propertyId'])
		.index('by_propertySlug', ['propertySlug'])
		.index('by_propertyId_and_status_and_createdAt', ['propertyId', 'status', 'createdAt'])
		.index('by_sessionId_and_normalizedQuestion', ['sessionId', 'normalizedQuestion'])
		.index('by_sessionId', ['sessionId'])
		.searchIndex('search_userQuestion', { searchField: 'userQuestion', filterFields: ['status'] })
};
