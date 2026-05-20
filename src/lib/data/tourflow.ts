export interface TourConclusion {
	propertyId: string;
	headline: string;
	summary: string;
	highlights: string[];
	closingLine: string;
}

export const tourConclusions: TourConclusion[] = [
	{
		propertyId: 'pool-villa',
		headline: 'Your Stay Awaits',
		summary: 'Two sun-drenched rooms, a private infinity pool, and the kind of quiet that lets you hear your own thoughts again. This is not a hotel. This is your home on the island.',
		highlights: [
			'Private infinity pool steps from your bed',
			'Open-plan living with floor-to-ceiling glass',
			'Tropical garden surrounding the villa',
			'Personal concierge for island excursions'
		],
		closingLine: 'Make this more than a daydream'
	},
	{
		propertyId: 'garden-suite',
		headline: 'Your Retreat Awaits',
		summary: 'Wrapped in tropical gardens, the Garden Suite is where the pace of life slows to the rhythm of rustling palms. Every detail invites you to stay a little longer.',
		highlights: [
			'Private terrace overlooking the gardens',
			'Rainfall shower surrounded by nature',
			'Steps from secluded island beaches',
			'Daily breakfast with fresh island flavors'
		],
		closingLine: 'Make this more than a daydream'
	},
	{
		propertyId: 'penthouse',
		headline: 'Your Loft Awaits',
		summary: 'The Canopy Loft Penthouse feels like a private studio above the trees: bright grid windows, black beams, warm wood, and soft woven textures pulled together into one calm hideaway.',
		highlights: [
			'Tall treetop windows with a built-in ledge',
			'Cozy loft sleeping platform',
			'Relaxed lounge corner with boho styling',
			'Compact kitchenette for slow mornings'
		],
		closingLine: 'Make this more than a daydream'
	}
];

export function getConclusionForProperty(propertyId: string): TourConclusion | undefined {
	return tourConclusions.find((c) => c.propertyId === propertyId);
}
