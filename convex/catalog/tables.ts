import { propertiesFields, reviewsFields, reviewStatsFields, tourScenesFields, tourSnippetsFields, otaRatesFields } from './validators';
import { defineTable } from 'convex/server';

// Owned by catalog; assembled only by convex/schema.ts.
export const catalogTables = {

	properties: defineTable(propertiesFields)
		.index('by_slug', ['slug'])
		.index('by_icalExportToken', ['icalExportToken'])
		.index('by_status', ['status']),


	tourScenes: defineTable(tourScenesFields)
		.index('by_property', ['propertyId'])
		.index('by_slug', ['slug']),


	reviews: defineTable(reviewsFields)
		.index('by_property', ['propertyId'])
		.index('by_property_date', ['propertyId', 'date'])
		.index('by_rating', ['rating']),


	reviewStats: defineTable(reviewStatsFields).index('by_property', ['propertyId']),


	tourSnippets: defineTable(tourSnippetsFields).index('by_property', ['propertyId']),


	// Owner-entered OTA nightly rates for the guest "book direct vs OTA" comparison.
	otaRates: defineTable(otaRatesFields).index('by_property_platform', ['propertyId', 'platform'])
};
