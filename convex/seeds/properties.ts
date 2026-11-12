import { bahtToSatang, percentToBasisPoints } from '../shared/money';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export type PropertyMap = {
	'pool-villa': Id<'properties'>;
	'garden-suite': Id<'properties'>;
	penthouse: Id<'properties'>;
};

const PROPERTIES = [
	{
		slug: 'pool-villa',
		name: 'Tideglass Pool Residence',
		tagline: 'Private paradise with infinity pool',
		description:
			'Experience ultimate luxury in our spacious Tideglass Pool Residence featuring a private infinity pool, open-plan living area, and lush tropical garden. Floor-to-ceiling windows bring the outside in, with stunning views from every room.',
		pricePerNight: 8500,
		currency: 'THB',
		maxGuests: 4,
		bedrooms: 2,
		bathrooms: 2,
		area: 145,
		images: [
			'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&h=800&fit=crop',
			'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&h=800&fit=crop',
			'/pool-villa-bedroom-view.webp',
			'/pool-villa-spa-bathroom.webp',
			'/pool-villa-veranda-view.webp'
		],
		amenities: ['Private Pool', 'WiFi', 'Air Conditioning', 'Kitchen', 'Garden View', 'King Bed'],
		tourRoomIds: ['pv-living', 'pv-pool'],
		directDiscountPercent: 15,
		status: 'active' as const
	},
	{
		slug: 'garden-suite',
		name: 'Mossbell Garden Suite',
		tagline: 'Serene retreat surrounded by nature',
		description:
			'Nestled among tropical gardens, the Mossbell Garden Suite offers a tranquil escape with a spacious bedroom, modern bathroom, and private terrace. Wake up to birdsong and the scent of frangipani.',
		pricePerNight: 4500,
		currency: 'THB',
		maxGuests: 2,
		bedrooms: 1,
		bathrooms: 1,
		area: 65,
		images: [
			'/garden-image.webp',
			'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&h=800&fit=crop'
		],
		amenities: ['WiFi', 'Air Conditioning', 'Garden Terrace', 'Rain Shower', 'Queen Bed'],
		tourRoomIds: ['gs-lounge', 'gs-dining'],
		directDiscountPercent: 15,
		status: 'active' as const
	},
	{
		slug: 'penthouse',
		name: 'Canopy Halo Loft',
		tagline: 'Boho loft living framed by treetop windows',
		description:
			'Our Canopy Halo Loft is a bright, loft-style villa wrapped in tall grid windows, warm wood ledges, soft neutral textiles, and relaxed boho details. A cozy sleeping platform, lounge corner, and kitchenette create an intimate hideaway above the trees.',
		pricePerNight: 12000,
		currency: 'THB',
		maxGuests: 6,
		bedrooms: 2,
		bathrooms: 2,
		area: 200,
		images: [
			'/canopy-loft-bedroom-photo.jpg',
			'/canopy-loft-lounge-photo.jpg',
			'/canopy-loft-kitchenette-photo.jpg',
			'/canopy-loft-window-view-photo.jpg',
			'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1200&h=800&fit=crop'
		],
		amenities: [
			'WiFi',
			'Air Conditioning',
			'Kitchenette',
			'Treetop Windows',
			'Loft Lounge',
			'King Bed',
			'Designer Lighting'
		],
		tourRoomIds: ['ph-bedroom'],
		directDiscountPercent: 15,
		status: 'active' as const
	}
];

export async function seedProperties(ctx: MutationCtx): Promise<PropertyMap> {
	const ids: Partial<PropertyMap> = {};
	for (const property of PROPERTIES) {
		const id = await ctx.db.insert('properties', { ...property, pricePerNight: bahtToSatang(property.pricePerNight), directDiscountPercent: percentToBasisPoints(property.directDiscountPercent) });
		ids[property.slug as keyof PropertyMap] = id;
	}
	return ids as PropertyMap;
}
