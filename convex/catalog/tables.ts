import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Owned by catalog; assembled only by convex/schema.ts.
export const catalogTables = {

	properties: defineTable({
		icalExportToken: v.optional(v.string()),
		slug: v.string(),
		name: v.string(),
		tagline: v.string(),
		description: v.string(),
		pricePerNight: v.number(),
		currency: v.string(),
		maxGuests: v.number(),
		bedrooms: v.number(),
		bathrooms: v.number(),
		area: v.number(),
		images: v.array(v.string()),
		amenities: v.array(v.string()),
		tourRoomIds: v.array(v.string()),
		directDiscountPercent: v.number(),
		status: v.union(v.literal('active'), v.literal('draft'), v.literal('archived')),
		// Optional per-locale copy; the public site falls back to English (see src/lib/i18n/public-content.ts).
		translations: v.optional(
			v.array(
				v.object({
					locale: v.string(),
					tagline: v.optional(v.string()),
					description: v.optional(v.string()),
					amenities: v.optional(v.array(v.string()))
				})
			)
		),
		// Set when an admin edits name/tagline/description/amenities, so edited English beats bundled i18n copy.
		contentEditedAt: v.optional(v.number())
	})
		.index('by_slug', ['slug'])
		.index('by_icalExportToken', ['icalExportToken'])
		.index('by_status', ['status']),


	tourScenes: defineTable({
		propertyId: v.id('properties'),
		slug: v.string(),
		name: v.string(),
		imagePath: v.string(),
		hotspots: v.array(
			v.object({
				id: v.string(),
				position: v.array(v.number()),
				targetRoomSlug: v.string(),
				label: v.string()
			})
		)
	})
		.index('by_property', ['propertyId'])
		.index('by_slug', ['slug']),


	reviews: defineTable({
		propertyId: v.id('properties'),
		authorName: v.string(),
		authorCity: v.string(),
		authorCountry: v.string(),
		authorAvatarUrl: v.string(),
		rating: v.number(),
		title: v.string(),
		body: v.string(),
		date: v.string(),
		verified: v.boolean(),
		photos: v.optional(v.array(v.string()))
	})
		.index('by_property', ['propertyId'])
		.index('by_property_date', ['propertyId', 'date'])
		.index('by_rating', ['rating']),


	reviewStats: defineTable({
		propertyId: v.id('properties'),
		overallRating: v.number(),
		totalReviews: v.number(),
	}).index('by_property', ['propertyId']),


	tourSnippets: defineTable({
		propertyId: v.id('properties'),
		roomSlug: v.string(),
		position: v.array(v.number()),
		quote: v.string(),
		authorName: v.string(),
		authorCity: v.string(),
		rating: v.number()
	}).index('by_property', ['propertyId']),


	// Owner-entered OTA nightly rates for the guest "book direct vs OTA" comparison.
	otaRates: defineTable({
		propertyId: v.id('properties'),
		platform: v.union(v.literal('booking_com'), v.literal('agoda'), v.literal('airbnb'), v.literal('expedia')),
		nightlyRate: v.number(),
		url: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_property_platform', ['propertyId', 'platform'])
};
