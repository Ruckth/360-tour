import type { Doc } from '../_generated/dataModel';

export { initializeReviewStats, adjustReviewStats } from './reviewStats';

export type PublicProperty = NonNullable<ReturnType<typeof toPublicProperty>>;

/** Public queries never expose the private iCal export token or tenant link. */
export function toPublicProperty(property: Doc<'properties'> | null) {
	if (!property || property.status !== 'active') return null;
	return {
		_id: property._id,
		_creationTime: property._creationTime,
		slug: property.slug,
		name: property.name,
		tagline: property.tagline,
		description: property.description,
		pricePerNight: property.pricePerNight,
		currency: property.currency,
		maxGuests: property.maxGuests,
		bedrooms: property.bedrooms,
		bathrooms: property.bathrooms,
		area: property.area,
		images: property.images,
		amenities: property.amenities,
		tourRoomIds: property.tourRoomIds,
		directDiscountPercent: property.directDiscountPercent,
		translations: property.translations,
		contentEditedAt: property.contentEditedAt,
		status: property.status,
	};
}

