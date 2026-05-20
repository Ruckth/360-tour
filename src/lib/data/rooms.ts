export interface Hotspot {
	id: string;
	position: [number, number, number];
	targetRoomId: string;
	label: string;
}

export interface Room {
	id: string;
	name: string;
	imagePath: string;
	hotspots: Hotspot[];
}

export const rooms: Room[] = [
	// Pool Villa rooms
	{
		id: 'pv-living',
		name: 'Living Area',
		imagePath: '/pool-villa-living.webp',
		hotspots: [
			{ id: 'pv-living-to-pool', position: [300, -30, -200], targetRoomId: 'pv-pool', label: 'Pool Area' }
		]
	},
	{
		id: 'pv-pool',
		name: 'Pool Area',
		imagePath: '/pool-villa-pool.webp',
		hotspots: [
			{ id: 'pv-pool-to-living', position: [-300, 0, 200], targetRoomId: 'pv-living', label: 'Living Area' }
		]
	},

	// Garden Suite rooms
	{
		id: 'gs-lounge',
		name: 'Lounge',
		imagePath: '/garden-suite-interior.webp',
		hotspots: [
			{ id: 'gs-lounge-to-dining', position: [250, -30, 300], targetRoomId: 'gs-dining', label: 'Dining Area' }
		]
	},
	{
		id: 'gs-dining',
		name: 'Dining Area',
		imagePath: '/garden-dining360.webp',
		hotspots: [
			{ id: 'gs-dining-to-garden', position: [320, -20, 120], targetRoomId: 'gs-garden', label: 'Garden View' }
		]
	},
	{
		id: 'gs-garden',
		name: 'Garden View',
		imagePath: '/garden-villa-360.webp',
		hotspots: [
			{ id: 'gs-garden-to-dining', position: [-300, -10, -160], targetRoomId: 'gs-dining', label: 'Dining Area' }
		]
	},

	// Penthouse rooms
	{
		id: 'ph-window-bedroom',
		name: 'Window Bedroom',
		imagePath: '/canopy-loft-window-bedroom-360.jpg',
		hotspots: [
			{ id: 'ph-window-bedroom-to-lounge', position: [240, -20, -260], targetRoomId: 'ph-lounge', label: 'Lounge Corner' },
			{ id: 'ph-window-bedroom-to-sleeping-nook', position: [-260, -20, 240], targetRoomId: 'ph-sleeping-nook', label: 'Sleeping Nook' }
		]
	},
	{
		id: 'ph-lounge',
		name: 'Lounge Corner',
		imagePath: '/canopy-loft-lounge-360.jpg',
		hotspots: [
			{ id: 'ph-lounge-to-kitchenette', position: [280, -15, -210], targetRoomId: 'ph-kitchenette', label: 'Kitchenette' },
			{ id: 'ph-lounge-to-window-bedroom', position: [-260, -20, 230], targetRoomId: 'ph-window-bedroom', label: 'Window Bedroom' }
		]
	},
	{
		id: 'ph-kitchenette',
		name: 'Kitchenette',
		imagePath: '/canopy-loft-kitchenette-360.jpg',
		hotspots: [
			{ id: 'ph-kitchenette-to-entry', position: [260, -10, -240], targetRoomId: 'ph-entry-wardrobe', label: 'Entry & Wardrobe' },
			{ id: 'ph-kitchenette-to-lounge', position: [-280, -15, 210], targetRoomId: 'ph-lounge', label: 'Lounge Corner' }
		]
	},
	{
		id: 'ph-sleeping-nook',
		name: 'Sleeping Nook',
		imagePath: '/canopy-loft-sleeping-nook-360.jpg',
		hotspots: [
			{ id: 'ph-sleeping-nook-to-window-bedroom', position: [260, -20, -240], targetRoomId: 'ph-window-bedroom', label: 'Window Bedroom' },
			{ id: 'ph-sleeping-nook-to-lounge', position: [-240, -20, 260], targetRoomId: 'ph-lounge', label: 'Lounge Corner' }
		]
	},
	{
		id: 'ph-entry-wardrobe',
		name: 'Entry & Wardrobe',
		imagePath: '/canopy-loft-entry-wardrobe-360.jpg',
		hotspots: [
			{ id: 'ph-entry-to-kitchenette', position: [260, -15, -240], targetRoomId: 'ph-kitchenette', label: 'Kitchenette' },
			{ id: 'ph-entry-to-lounge', position: [-260, -20, 240], targetRoomId: 'ph-lounge', label: 'Lounge Corner' }
		]
	}
];

export function getRoomById(id: string): Room | undefined {
	return rooms.find((r) => r.id === id);
}
