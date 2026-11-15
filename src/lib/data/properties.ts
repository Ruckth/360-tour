export interface Property {
	id: string;
	name: string;
	tagline: string;
	description: string;
	pricePerNight: number;
	maxGuests: number;
	bedrooms: number;
	bathrooms: number;
	area: number;
	images: string[];
	amenities: string[];
	tourRoomIds: string[];
}

export const defaultTourPropertyId = 'garden-suite';

export function getTourHref(propertyId = defaultTourPropertyId): string {
	return `/rooms/${propertyId}?tour=1`;
}

export const properties: Property[] = [
	{
		id: 'pool-villa',
		name: 'Tideglass Pool Residence',
		tagline: 'Private paradise with infinity pool',
		description:
			'Experience ultimate luxury in our spacious Tideglass Pool Residence featuring a private infinity pool, open-plan living area, and lush tropical garden. Floor-to-ceiling windows bring the outside in, with stunning views from every room.',
		pricePerNight: 850000,
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
		tourRoomIds: ['pv-living', 'pv-pool']
	},
	{
		id: 'garden-suite',
		name: 'Mossbell Garden Suite',
		tagline: 'Serene retreat surrounded by nature',
		description:
			'Nestled among tropical gardens, the Mossbell Garden Suite offers a tranquil escape with a spacious bedroom, modern bathroom, and private terrace. Wake up to birdsong and the scent of frangipani.',
		pricePerNight: 450000,
		maxGuests: 2,
		bedrooms: 1,
		bathrooms: 1,
		area: 65,
		images: [
			'/garden-image.webp',
			'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&h=800&fit=crop'
		],
		amenities: ['WiFi', 'Air Conditioning', 'Garden Terrace', 'Rain Shower', 'Queen Bed'],
		tourRoomIds: ['gs-garden', 'gs-dining']
	},
	{
		id: 'penthouse',
		name: 'Canopy Halo Loft',
		tagline: 'Boho loft living framed by treetop windows',
		description:
			'Our Canopy Halo Loft is a bright, loft-style villa wrapped in tall grid windows, warm wood ledges, soft neutral textiles, and relaxed boho details. A cozy sleeping platform, lounge corner, and kitchenette create an intimate hideaway above the trees.',
		pricePerNight: 1200000,
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
		tourRoomIds: ['ph-bedroom']
	}
];

export function getPropertyById(id: string): Property | undefined {
	return properties.find((p) => p.id === id);
}
