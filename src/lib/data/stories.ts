export interface Vignette {
	id: string;
	text: string;
	imageUrl: string;
	delaySeconds: number;
	durationSeconds: number;
}

export interface RoomStory {
	roomId: string;
	headline: string;
	subtext: string;
	imagineText: string;
	vignettes: Vignette[];
}

export const roomStories: RoomStory[] = [
	{
		roomId: 'pv-living',
		headline: 'Where mornings begin slowly',
		subtext: 'Sunlight pours through floor-to-ceiling glass, warming the teak beneath your feet',
		imagineText: 'Imagine settling into this space with nowhere to rush to...',
		vignettes: [
			{
				id: 'pv-living-v1',
				text: 'A quiet coffee as golden light fills the room',
				imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=400&h=300&fit=crop',
				delaySeconds: 10,
				durationSeconds: 6
			},
			{
				id: 'pv-living-v2',
				text: 'Bare feet on cool tile, the sound of palms outside',
				imageUrl: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=400&h=300&fit=crop',
				delaySeconds: 20,
				durationSeconds: 6
			}
		]
	},
	{
		roomId: 'pv-pool',
		headline: 'Wake up to a private dip',
		subtext: 'Just steps from your bed, your infinity pool awaits',
		imagineText: 'Imagine your morning here...',
		vignettes: [
			{
				id: 'pv-pool-v1',
				text: 'Sundowner cocktails as the sky turns gold',
				imageUrl: 'https://images.unsplash.com/photo-1551918120-9739cb430c6d?w=400&h=300&fit=crop',
				delaySeconds: 10,
				durationSeconds: 6
			},
			{
				id: 'pv-pool-v2',
				text: 'Floating under the stars, the world miles away',
				imageUrl: 'https://images.unsplash.com/photo-1573052905904-34ad8c27f0cc?w=400&h=300&fit=crop',
				delaySeconds: 20,
				durationSeconds: 6
			}
		]
	},
	{
		roomId: 'gs-lounge',
		headline: 'A quiet corner of the island',
		subtext: 'Tropical gardens wrap around you, a private world of green and birdsong',
		imagineText: 'Imagine an afternoon with nothing but a good book...',
		vignettes: [
			{
				id: 'gs-lounge-v1',
				text: 'Rain on broad leaves, tea in your hands',
				imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=300&fit=crop',
				delaySeconds: 10,
				durationSeconds: 6
			},
			{
				id: 'gs-lounge-v2',
				text: 'The scent of frangipani drifting through open windows',
				imageUrl: 'https://images.unsplash.com/photo-1515191107209-c28698631303?w=400&h=300&fit=crop',
				delaySeconds: 20,
				durationSeconds: 6
			}
		]
	},
	{
		roomId: 'gs-dining',
		headline: 'Meals worth lingering over',
		subtext: 'Fresh island flavors, unhurried evenings, candlelight on the terrace',
		imagineText: 'Imagine sharing a slow dinner under the palms...',
		vignettes: [
			{
				id: 'gs-dining-v1',
				text: 'Fresh mango and sticky rice, prepared just for you',
				imageUrl: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=400&h=300&fit=crop',
				delaySeconds: 10,
				durationSeconds: 6
			},
			{
				id: 'gs-dining-v2',
				text: 'Candlelight conversations that stretch past midnight',
				imageUrl: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=400&h=300&fit=crop',
				delaySeconds: 20,
				durationSeconds: 6
			}
		]
	},
	{
		roomId: 'ph-window-bedroom',
		headline: 'Wake In The Canopy',
		subtext: 'Soft morning light, treetop windows, and a calm loft wrapped in warm textures',
		imagineText: 'Imagine waking here, coffee close by and the trees just beyond the glass...',
		vignettes: [
			{
				id: 'ph-window-bedroom-v1',
				text: 'First light moving across the window ledge and linen bedding',
				imageUrl: 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=400&h=300&fit=crop',
				delaySeconds: 10,
				durationSeconds: 6
			},
			{
				id: 'ph-window-bedroom-v2',
				text: 'String lights glowing over woven details as the room slows down',
				imageUrl: 'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=400&h=300&fit=crop',
				delaySeconds: 20,
				durationSeconds: 6
			}
		]
	},
	{
		roomId: 'ph-lounge',
		headline: 'Settle Into The Loft',
		subtext: 'A quiet lounge corner with woven textures, plants, and string lights overhead',
		imagineText: 'Imagine ending the day here, the room warm and softly lit...',
		vignettes: []
	},
	{
		roomId: 'ph-kitchenette',
		headline: 'Slow Mornings Start Here',
		subtext: 'Open shelves, pendant bulbs, and a compact kitchenette for coffee and breakfast',
		imagineText: 'Imagine making coffee while the loft slowly brightens...',
		vignettes: []
	},
	{
		roomId: 'ph-sleeping-nook',
		headline: 'A Softer Corner',
		subtext: 'Layered bedding, dreamcatcher details, and the hush of a private studio',
		imagineText: 'Imagine slipping back into the quiet after a day outside...',
		vignettes: []
	},
	{
		roomId: 'ph-entry-wardrobe',
		headline: 'Arrive And Unpack',
		subtext: 'Louvered wardrobe screens, warm slatted wood, and a glimpse into the loft',
		imagineText: 'Imagine dropping your bags and feeling the stay begin...',
		vignettes: []
	}
];

export function getStoryForRoom(roomId: string): RoomStory | undefined {
	return roomStories.find((s) => s.roomId === roomId);
}

export function getPropertyTagline(propertyId: string): string {
	const taglines: Record<string, string> = {
		'pool-villa': 'Where mornings begin with a private dip under open skies',
		'garden-suite': 'A quiet corner of the island, wrapped in green',
		penthouse: 'Wake among soft light, warm wood, and treetop windows'
	};
	return taglines[propertyId] ?? '';
}
