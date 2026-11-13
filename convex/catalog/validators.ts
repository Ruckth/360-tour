import { v } from 'convex/values';

export const propertiesFields = {
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
	};

export const tourScenesFields = {
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
	};

export const reviewsFields = {
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
	};

export const reviewStatsFields = {
		propertyId: v.id('properties'),
		overallRating: v.number(),
		totalReviews: v.number(),
        ratingTotal: v.optional(v.number()),
	};

export const tourSnippetsFields = {
		propertyId: v.id('properties'),
		roomSlug: v.string(),
		position: v.array(v.number()),
		quote: v.string(),
		authorName: v.string(),
		authorCity: v.string(),
		rating: v.number()
	};

export const otaRatesFields = {
		propertyId: v.id('properties'),
		platform: v.union(v.literal('booking_com'), v.literal('agoda'), v.literal('airbnb'), v.literal('expedia')),
		nightlyRate: v.number(),
		url: v.optional(v.string()),
		updatedAt: v.number()
	};

// Published no-login response contracts. Fields are selected by each owning endpoint.
const publicPropertyFields = {
  slug: propertiesFields.slug,
  name: propertiesFields.name,
  tagline: propertiesFields.tagline,
  description: propertiesFields.description,
  pricePerNight: propertiesFields.pricePerNight,
  currency: propertiesFields.currency,
  maxGuests: propertiesFields.maxGuests,
  bedrooms: propertiesFields.bedrooms,
  bathrooms: propertiesFields.bathrooms,
  area: propertiesFields.area,
  images: propertiesFields.images,
  amenities: propertiesFields.amenities,
  tourRoomIds: propertiesFields.tourRoomIds,
  directDiscountPercent: propertiesFields.directDiscountPercent,
  translations: propertiesFields.translations,
  contentEditedAt: propertiesFields.contentEditedAt,
};
export const publicProperty = v.object({ ...publicPropertyFields, _id: v.id('properties'), _creationTime: v.number(), status: v.literal('active') });
export const propertiesListResult = v.array(publicProperty);
export const propertiesGetBySlugResult = v.union(v.null(), publicProperty);
export const propertiesGetByIdResult = propertiesGetBySlugResult;
export const propertiesGetRoomsResult = v.array(v.object({ ...tourScenesFields, _id: v.id('tourScenes'), _creationTime: v.number() }));
export const propertiesGetTourRoomsResult = v.union(v.null(), v.array(v.object({ slug: tourScenesFields.slug, name: tourScenesFields.name, imagePath: tourScenesFields.imagePath, hotspots: tourScenesFields.hotspots })));
export const propertiesGetOtaComparisonResult = v.union(v.null(), v.object({ currency: v.string(), pricePerNight: v.number(), directDiscountPercent: v.number(), rates: v.array(v.object({ platform: otaRatesFields.platform, nightlyRate: otaRatesFields.nightlyRate, url: otaRatesFields.url, updatedAt: otaRatesFields.updatedAt })) }));
export const propertiesGetSocialProofResult = v.union(v.null(), v.object({ propertyId: reviewStatsFields.propertyId, overallRating: reviewStatsFields.overallRating, totalReviews: reviewStatsFields.totalReviews, _id: v.id('reviewStats'), _creationTime: v.number() }));
export const propertiesGetReviewsResult = v.array(v.object({ ...reviewsFields, _id: v.id('reviews'), _creationTime: v.number() }));
export const propertiesGetTourSnippetsResult = v.array(v.object({ ...tourSnippetsFields, _id: v.id('tourSnippets'), _creationTime: v.number() }));
const publicVilla = v.object({ ...publicPropertyFields, _id: v.id('properties'), translations: v.array(v.object({ locale: v.string(), tagline: v.optional(v.string()), description: v.optional(v.string()), amenities: v.optional(v.array(v.string())) })), contentEditedAt: v.union(v.number(), v.null()), reviewCount: v.number(), averageRating: v.union(v.number(), v.null()) });
const reviewCopy = {
  authorName: reviewsFields.authorName,
  authorCity: reviewsFields.authorCity,
  authorCountry: reviewsFields.authorCountry,
  authorAvatarUrl: reviewsFields.authorAvatarUrl,
  rating: reviewsFields.rating,
  title: reviewsFields.title,
  body: reviewsFields.body,
  date: reviewsFields.date,
  verified: reviewsFields.verified,
};
const publicReview = v.object({ ...reviewCopy, id: v.id('reviews'), propertySlug: v.string(), photos: v.array(v.string()) });
export const publicPropertiesListResult = v.object({ hasProperties: v.boolean(), villas: v.array(publicVilla) });
export const publicPropertiesGetBySlugResult = v.union(v.null(), v.object({ villa: publicVilla, reviews: v.array(publicReview) }));
export const publicPropertiesFeaturedReviewsResult = v.array(publicReview);
