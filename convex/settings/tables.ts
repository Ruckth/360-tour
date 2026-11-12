import { cashierRulesFields } from '../lib/staffTypes';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { bookingRulesValidator } from '../lib/siteSettings';

// Owned by settings; assembled only by convex/schema.ts.
export const settingsTables = {
 cashierRules: defineTable({ key: v.literal('default'), ...cashierRulesFields, revision: v.number(), updatedAt: v.number(), updatedByEmail: v.string() }).index('by_key', ['key']),

 recordChanges: defineTable({
  entityType: v.string(), entityId: v.string(), recordedAt: v.number(),
  effectiveAt: v.number(), actor: v.string(), kind: v.string(),
  reason: v.optional(v.string()), before: v.optional(v.any()), after: v.optional(v.any())
 }).index('by_entityType_and_entityId_and_recordedAt', ['entityType', 'entityId', 'recordedAt'])
   .index('by_entityType_and_recordedAt', ['entityType', 'recordedAt']),

	configurationHistoryIndex: defineTable({
		entityType: v.union(v.literal('property'), v.literal('room')),
		entityId: v.string(),
		propertyId: v.id('properties'),
		name: v.string(),
		slug: v.string(),
		deleted: v.boolean(),
		updatedAt: v.number()
	})
		.index('by_entityType_and_entityId', ['entityType', 'entityId'])
		.index('by_propertyId_and_entityType', ['propertyId', 'entityType'])
		.index('by_entityType_and_deleted', ['entityType', 'deleted']),


	// Admin-editable business profile; a single row with key 'default'. Missing fields fall back to lib/siteSettings defaults.
	siteSettings: defineTable({
		key: v.literal('default'),
		bookingRules: v.optional(bookingRulesValidator),
		revision: v.optional(v.number()),
		businessName: v.optional(v.string()),
		tagline: v.optional(v.string()),
		contactEmail: v.optional(v.string()),
		contactPhone: v.optional(v.string()),
		whatsapp: v.optional(v.string()),
		lineId: v.optional(v.string()),
		lineUrl: v.optional(v.string()),
		address: v.optional(v.string()),
		currency: v.optional(v.string()),
		timezone: v.optional(v.string()),
		checkInTime: v.optional(v.string()),
		checkOutTime: v.optional(v.string()),
		cancellationPolicy: v.optional(v.string()),
		ai: v.optional(
			v.object({
				tone: v.optional(v.string()),
				extraInstructions: v.optional(v.string()),
				maxWords: v.optional(v.number())
			})
		),
		email: v.optional(
			v.object({
				fromName: v.optional(v.string()),
				ownerNotificationEmail: v.optional(v.string()),
				footer: v.optional(v.string())
			})
		),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_key', ['key'])
};
