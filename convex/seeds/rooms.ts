import type { MutationCtx } from '../_generated/server';
import type { PropertyMap } from './properties';

const ROOMS = [
	{
		propertyKey: 'pool-villa' as const,
		slug: 'pv-living',
		name: 'Living Area',
		imagePath: '/pool-villa-living.webp',
		hotspots: [
			{
				id: 'pv-living-to-pool',
				position: [300, -30, -200],
				targetRoomSlug: 'pv-pool',
				label: 'Pool Area'
			}
		]
	},
	{
		propertyKey: 'pool-villa' as const,
		slug: 'pv-pool',
		name: 'Pool Area',
		imagePath: '/pool-villa-pool.webp',
		hotspots: [
			{
				id: 'pv-pool-to-living',
				position: [-300, 0, 200],
				targetRoomSlug: 'pv-living',
				label: 'Living Area'
			}
		]
	},
	{
		propertyKey: 'garden-suite' as const,
		slug: 'gs-lounge',
		name: 'Lounge',
		imagePath: '/garden-suite-interior.webp',
		hotspots: [
			{
				id: 'gs-lounge-to-dining',
				position: [250, -30, 300],
				targetRoomSlug: 'gs-dining',
				label: 'Dining Area'
			}
		]
	},
	{
		propertyKey: 'garden-suite' as const,
		slug: 'gs-dining',
		name: 'Dining Area',
		imagePath: '/garden-dining360.webp',
		hotspots: [
			{
				id: 'gs-dining-to-lounge',
				position: [-250, 0, -300],
				targetRoomSlug: 'gs-lounge',
				label: 'Lounge'
			}
		]
	},
	{
		propertyKey: 'penthouse' as const,
		slug: 'ph-window-bedroom',
		name: 'Window Bedroom',
		imagePath: '/canopy-loft-window-bedroom-360.jpg',
		hotspots: [
			{
				id: 'ph-window-bedroom-to-lounge',
				position: [240, -20, -260],
				targetRoomSlug: 'ph-lounge',
				label: 'Lounge Corner'
			},
			{
				id: 'ph-window-bedroom-to-sleeping-nook',
				position: [-260, -20, 240],
				targetRoomSlug: 'ph-sleeping-nook',
				label: 'Sleeping Nook'
			}
		]
	},
	{
		propertyKey: 'penthouse' as const,
		slug: 'ph-lounge',
		name: 'Lounge Corner',
		imagePath: '/canopy-loft-lounge-360.jpg',
		hotspots: [
			{
				id: 'ph-lounge-to-kitchenette',
				position: [280, -15, -210],
				targetRoomSlug: 'ph-kitchenette',
				label: 'Kitchenette'
			},
			{
				id: 'ph-lounge-to-window-bedroom',
				position: [-260, -20, 230],
				targetRoomSlug: 'ph-window-bedroom',
				label: 'Window Bedroom'
			}
		]
	},
	{
		propertyKey: 'penthouse' as const,
		slug: 'ph-kitchenette',
		name: 'Kitchenette',
		imagePath: '/canopy-loft-kitchenette-360.jpg',
		hotspots: [
			{
				id: 'ph-kitchenette-to-entry',
				position: [260, -10, -240],
				targetRoomSlug: 'ph-entry-wardrobe',
				label: 'Entry & Wardrobe'
			},
			{
				id: 'ph-kitchenette-to-lounge',
				position: [-280, -15, 210],
				targetRoomSlug: 'ph-lounge',
				label: 'Lounge Corner'
			}
		]
	},
	{
		propertyKey: 'penthouse' as const,
		slug: 'ph-sleeping-nook',
		name: 'Sleeping Nook',
		imagePath: '/canopy-loft-sleeping-nook-360.jpg',
		hotspots: [
			{
				id: 'ph-sleeping-nook-to-window-bedroom',
				position: [260, -20, -240],
				targetRoomSlug: 'ph-window-bedroom',
				label: 'Window Bedroom'
			},
			{
				id: 'ph-sleeping-nook-to-lounge',
				position: [-240, -20, 260],
				targetRoomSlug: 'ph-lounge',
				label: 'Lounge Corner'
			}
		]
	},
	{
		propertyKey: 'penthouse' as const,
		slug: 'ph-entry-wardrobe',
		name: 'Entry & Wardrobe',
		imagePath: '/canopy-loft-entry-wardrobe-360.jpg',
		hotspots: [
			{
				id: 'ph-entry-to-kitchenette',
				position: [260, -15, -240],
				targetRoomSlug: 'ph-kitchenette',
				label: 'Kitchenette'
			},
			{
				id: 'ph-entry-to-lounge',
				position: [-260, -20, 240],
				targetRoomSlug: 'ph-lounge',
				label: 'Lounge Corner'
			}
		]
	}
];

export async function seedRooms(ctx: MutationCtx, properties: PropertyMap): Promise<void> {
	for (const { propertyKey, ...rest } of ROOMS) {
		await ctx.db.insert('rooms', {
			propertyId: properties[propertyKey],
			...rest
		});
	}
}
