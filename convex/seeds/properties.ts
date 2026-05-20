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
		name: 'Pool Villa',
		tagline: 'Private paradise with infinity pool',
		description:
			'Experience ultimate luxury in our spacious Pool Villa featuring a private infinity pool, open-plan living area, and lush tropical garden. Floor-to-ceiling windows bring the outside in, with stunning views from every room.',
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
		name: 'Garden Suite',
		tagline: 'Serene retreat surrounded by nature',
		description:
			'Nestled among tropical gardens, the Garden Suite offers a tranquil escape with a spacious bedroom, modern bathroom, and private terrace. Wake up to birdsong and the scent of frangipani.',
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
		name: 'Canopy Loft Penthouse',
		tagline: 'Boho loft living framed by treetop windows',
		description:
			'Our Canopy Loft Penthouse is a bright, loft-style villa wrapped in tall grid windows, warm wood ledges, soft neutral textiles, and relaxed boho details. A cozy sleeping platform, lounge corner, and kitchenette create an intimate hideaway above the trees.',
		pricePerNight: 12000,
		currency: 'THB',
		maxGuests: 6,
		bedrooms: 2,
		bathrooms: 2,
		area: 200,
		images: [
			'/canopy-loft-window-bedroom-360.jpg',
			'/canopy-loft-lounge-360.jpg',
			'/canopy-loft-kitchenette-360.jpg',
			'/canopy-loft-sleeping-nook-360.jpg',
			'/canopy-loft-entry-wardrobe-360.jpg'
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
		tourRoomIds: ['ph-window-bedroom', 'ph-lounge', 'ph-kitchenette', 'ph-sleeping-nook', 'ph-entry-wardrobe'],
		directDiscountPercent: 15,
		status: 'active' as const
	}
];

export async function seedProperties(ctx: MutationCtx): Promise<PropertyMap> {
	const ids: Partial<PropertyMap> = {};
	for (const property of PROPERTIES) {
		const id = await ctx.db.insert('properties', property);
		ids[property.slug as keyof PropertyMap] = id;
	}
	return ids as PropertyMap;
}
