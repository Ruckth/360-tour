import type { MutationCtx } from '../_generated/server';
import type { PropertyMap } from './properties';

const REVIEWS_DATA = [
	{
		propertyKey: 'pool-villa' as const,
		authorName: 'Sophie Laurent',
		authorCity: 'Paris',
		authorCountry: 'France',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face',
		rating: 5,
		title: 'The pool was absolutely stunning',
		body: 'We spent every morning swimming in the infinity pool watching the sunrise over Koh Tao. The villa is even more beautiful in person than the photos.',
		date: '2026-03-15',
		verified: true,
		photos: [
			'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=400&h=300&fit=crop',
			'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&h=300&fit=crop'
		]
	},
	{
		propertyKey: 'pool-villa' as const,
		authorName: 'James Chen',
		authorCity: 'Singapore',
		authorCountry: 'Singapore',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face',
		rating: 5,
		title: 'Perfect honeymoon getaway',
		body: 'My wife and I chose the Pool Villa for our honeymoon and it exceeded every expectation. The private pool area is so peaceful.',
		date: '2026-03-02',
		verified: true
	},
	{
		propertyKey: 'pool-villa' as const,
		authorName: 'Emma Johansson',
		authorCity: 'Stockholm',
		authorCountry: 'Sweden',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&crop=face',
		rating: 5,
		title: 'Felt like a five-star resort',
		body: 'The villa is impeccably maintained. Every detail has been thought of, from the quality linens to the Bluetooth speaker by the pool.',
		date: '2026-02-18',
		verified: true,
		photos: [
			'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=400&h=300&fit=crop'
		]
	},
	{
		propertyKey: 'garden-suite' as const,
		authorName: 'Anna Muller',
		authorCity: 'Berlin',
		authorCountry: 'Germany',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=80&h=80&fit=crop&crop=face',
		rating: 5,
		title: 'Garden view at sunset was magical',
		body: 'The private terrace looking out over the tropical garden is where we spent every evening. Watching the sunset with the frangipani trees swaying.',
		date: '2026-03-20',
		verified: true,
		photos: [
			'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=300&fit=crop'
		]
	},
	{
		propertyKey: 'garden-suite' as const,
		authorName: 'David Kim',
		authorCity: 'Seoul',
		authorCountry: 'South Korea',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=80&h=80&fit=crop&crop=face',
		rating: 5,
		title: 'Perfect for couples',
		body: 'The Garden Suite is exactly what you need for a romantic getaway. Cosy but not cramped, beautifully designed.',
		date: '2026-03-08',
		verified: true
	},
	{
		propertyKey: 'penthouse' as const,
		authorName: 'Alexander Petrov',
		authorCity: 'Moscow',
		authorCountry: 'Russia',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=80&h=80&fit=crop&crop=face',
		rating: 5,
		title: 'A loft hideaway full of soft light',
		body: 'The tall windows alone are worth the stay. We had slow mornings on the window ledge, coffee in hand, with the trees just outside.',
		date: '2026-03-22',
		verified: true,
		photos: [
			'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=400&h=300&fit=crop',
			'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop'
		]
	},
	{
		propertyKey: 'penthouse' as const,
		authorName: 'Charlotte Williams',
		authorCity: 'London',
		authorCountry: 'United Kingdom',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=80&h=80&fit=crop&crop=face',
		rating: 5,
		title: 'Worth every penny',
		body: 'We celebrated our anniversary at the Canopy Loft Penthouse and it was perfect. The sleeping nook is cozy, the lounge feels intimate, and the whole space has this calm studio atmosphere.',
		date: '2026-03-10',
		verified: true
	}
];

export async function seedReviews(ctx: MutationCtx, properties: PropertyMap): Promise<void> {
	for (const { propertyKey, ...rest } of REVIEWS_DATA) {
		await ctx.db.insert('reviews', {
			propertyId: properties[propertyKey],
			...rest
		});
	}
}
