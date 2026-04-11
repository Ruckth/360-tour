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
		imagePath: '/pool-villa-living.jpg',
		hotspots: [
			{ id: 'pv-living-to-pool', position: [300, -30, -200], targetRoomId: 'pv-pool', label: 'Pool Area' }
		]
	},
	{
		id: 'pv-pool',
		name: 'Pool Area',
		imagePath: '/pool-villa-pool.jpg',
		hotspots: [
			{ id: 'pv-pool-to-living', position: [-300, 0, 200], targetRoomId: 'pv-living', label: 'Living Area' }
		]
	},

	// Garden Suite rooms
	{
		id: 'gs-lounge',
		name: 'Lounge',
		imagePath: '/garden-suite-interior.jpg',
		hotspots: [
			{ id: 'gs-lounge-to-dining', position: [250, -30, 300], targetRoomId: 'gs-dining', label: 'Dining Area' }
		]
	},
	{
		id: 'gs-dining',
		name: 'Dining Area',
		imagePath: '/garden-dining360.jpg',
		hotspots: [
			{ id: 'gs-dining-to-lounge', position: [-250, 0, -300], targetRoomId: 'gs-lounge', label: 'Lounge' }
		]
	},

	// Penthouse rooms
	{
		id: 'ph-bedroom',
		name: 'Master Bedroom',
		imagePath: '/penthouse-bedroom.jpg',
		hotspots: []
	}
];

export function getRoomById(id: string): Room | undefined {
	return rooms.find((r) => r.id === id);
}
