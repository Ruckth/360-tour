import type { MutationCtx } from '../_generated/server';
import type { PropertyMap } from './properties';

const TOUR_SNIPPETS = [
	{
		propertyKey: 'pool-villa' as const,
		roomSlug: 'pv-pool',
		position: [200, 60, 250],
		quote: 'The infinity pool at sunrise is absolutely magical!',
		authorName: 'Sophie L.',
		authorCity: 'Paris',
		rating: 5
	},
	{
		propertyKey: 'pool-villa' as const,
		roomSlug: 'pv-living',
		position: [-200, 80, 250],
		quote: 'Open-plan living feels incredibly luxurious.',
		authorName: 'James C.',
		authorCity: 'Singapore',
		rating: 5
	},
	{
		propertyKey: 'garden-suite' as const,
		roomSlug: 'gs-lounge',
		position: [180, 70, -200],
		quote: 'Such a peaceful retreat surrounded by nature.',
		authorName: 'Anna M.',
		authorCity: 'Berlin',
		rating: 5
	},
	{
		propertyKey: 'penthouse' as const,
		roomSlug: 'ph-window-bedroom',
		position: [220, 80, -180],
		quote: 'The morning light through the tall windows is beautiful.',
		authorName: 'Charlotte W.',
		authorCity: 'London',
		rating: 5
	}
];

export async function seedTourSnippets(ctx: MutationCtx, properties: PropertyMap): Promise<void> {
	for (const { propertyKey, ...rest } of TOUR_SNIPPETS) {
		await ctx.db.insert('tourSnippets', {
			propertyId: properties[propertyKey],
			...rest
		});
	}
}
