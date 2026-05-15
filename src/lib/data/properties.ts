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
		name: 'Pool Villa',
		tagline: 'Private paradise with infinity pool',
		description:
			'Experience ultimate luxury in our spacious Pool Villa featuring a private infinity pool, open-plan living area, and lush tropical garden. Floor-to-ceiling windows bring the outside in, with stunning views from every room.',
		pricePerNight: 8500,
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
		name: 'Garden Suite',
		tagline: 'Serene retreat surrounded by nature',
		description:
			'Nestled among tropical gardens, the Garden Suite offers a tranquil escape with a spacious bedroom, modern bathroom, and private terrace. Wake up to birdsong and the scent of frangipani.',
		pricePerNight: 4500,
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
		name: 'Penthouse',
		tagline: 'Elevated living with panoramic views',
		description:
			'Our signature Penthouse crowns the property with sweeping panoramic views, a rooftop terrace, and designer interiors. Two bedrooms, a full kitchen, and a living space designed for those who appreciate the finer things.',
		pricePerNight: 12000,
		maxGuests: 6,
		bedrooms: 2,
		bathrooms: 2,
		area: 200,
		images: [
			'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=1200&h=800&fit=crop',
			'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&h=800&fit=crop'
		],
		amenities: [
			'Rooftop Terrace',
			'WiFi',
			'Air Conditioning',
			'Full Kitchen',
			'Panoramic View',
			'King Bed',
			'Bathtub'
		],
		tourRoomIds: ['ph-bedroom']
	}
];

export function getPropertyById(id: string): Property | undefined {
	return properties.find((p) => p.id === id);
}
