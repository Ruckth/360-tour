import type { PropertySocialProof, RecentBooking } from './reviews';

export const socialProofData: PropertySocialProof[] = [
	{
		propertyId: 'pool-villa',
		overallRating: 4.92,
		totalReviews: 127,
		isSuperhost: true,
		breakdown: {
			cleanliness: 4.9,
			accuracy: 4.95,
			communication: 5.0,
			location: 4.8,
			checkIn: 4.95,
			value: 4.85
		},
		reviews: [
			{
				id: 'pv-r1',
				propertyId: 'pool-villa',
				author: {
					name: 'Sophie Laurent',
					city: 'Paris',
					country: 'France',
					avatarUrl:
						'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'The pool was absolutely stunning',
				body: 'We spent every morning swimming in the infinity pool watching the sunrise over Koh Tao. The villa is even more beautiful in person than the photos. The kitchen was fully equipped and the king bed was incredibly comfortable. Our host was responsive and provided excellent restaurant recommendations.',
				date: '2026-03-15',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=400&h=300&fit=crop',
					'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&h=300&fit=crop'
				]
			},
			{
				id: 'pv-r2',
				propertyId: 'pool-villa',
				author: {
					name: 'James Chen',
					city: 'Singapore',
					country: 'Singapore',
					avatarUrl:
						'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Perfect honeymoon getaway',
				body: 'My wife and I chose the Pool Villa for our honeymoon and it exceeded every expectation. The private pool area is so peaceful, and the open-plan living space feels incredibly luxurious. The tropical garden surrounding the villa gives you complete privacy. We will definitely be back.',
				date: '2026-03-02',
				verified: true
			},
			{
				id: 'pv-r3',
				propertyId: 'pool-villa',
				author: {
					name: 'Emma Johansson',
					city: 'Stockholm',
					country: 'Sweden',
					avatarUrl:
						'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Felt like a five-star resort',
				body: 'The villa is impeccably maintained. Every detail has been thought of, from the quality linens to the Bluetooth speaker by the pool. Air conditioning worked perfectly even in the hottest part of the day. The location is quiet but close enough to walk to shops and restaurants.',
				date: '2026-02-18',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=400&h=300&fit=crop'
				]
			},
			{
				id: 'pv-r4',
				propertyId: 'pool-villa',
				author: {
					name: 'Kenji Tanaka',
					city: 'Tokyo',
					country: 'Japan',
					avatarUrl:
						'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=80&h=80&fit=crop&crop=face'
				},
				rating: 4,
				title: 'Beautiful villa, great for families',
				body: 'We stayed with our two kids and had an amazing time. The pool is safe and the garden provides plenty of space for the children to play. The villa is spacious with two proper bedrooms. Only minor note is that the WiFi could be a bit stronger by the pool area.',
				date: '2026-02-01',
				verified: true
			},
			{
				id: 'pv-r5',
				propertyId: 'pool-villa',
				author: {
					name: 'Maria Santos',
					city: 'Lisbon',
					country: 'Portugal',
					avatarUrl:
						'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Best stay in Thailand',
				body: 'After travelling through Thailand for three weeks, this was by far our favourite accommodation. The pool villa is paradise. Waking up, opening the sliding doors, and diving straight into the pool — you cannot beat that. The host arranged a private chef one evening which was unforgettable.',
				date: '2026-01-22',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1602002418816-5c0aeef426aa?w=400&h=300&fit=crop'
				]
			},
			{
				id: 'pv-r6',
				propertyId: 'pool-villa',
				author: {
					name: 'Oliver Wright',
					city: 'Melbourne',
					country: 'Australia',
					avatarUrl:
						'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Superhost for a reason',
				body: 'From check-in to check-out, everything was seamless. The villa photos are accurate, the amenities are top-notch, and the location on Koh Tao is ideal. We did the 360 tour before booking and what you see is exactly what you get. Highly recommend.',
				date: '2026-01-10',
				verified: true
			}
		],
		tourSnippets: [
			{
				id: 'pv-ts1',
				roomId: 'pv-pool',
				position: [200, 60, 250],
				quote: 'The infinity pool at sunrise is absolutely magical!',
				authorName: 'Sophie L.',
				authorCity: 'Paris',
				rating: 5
			},
			{
				id: 'pv-ts2',
				roomId: 'pv-living',
				position: [-200, 80, 250],
				quote: 'Open-plan living feels incredibly luxurious.',
				authorName: 'James C.',
				authorCity: 'Singapore',
				rating: 5
			}
		],
		recentBookings: []
	},
	{
		propertyId: 'garden-suite',
		overallRating: 4.87,
		totalReviews: 89,
		isSuperhost: false,
		breakdown: {
			cleanliness: 4.85,
			accuracy: 4.9,
			communication: 4.8,
			location: 4.95,
			checkIn: 4.85,
			value: 4.9
		},
		reviews: [
			{
				id: 'gs-r1',
				propertyId: 'garden-suite',
				author: {
					name: 'Anna Muller',
					city: 'Berlin',
					country: 'Germany',
					avatarUrl:
						'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Garden view at sunset was magical',
				body: 'The private terrace looking out over the tropical garden is where we spent every evening. Watching the sunset with the frangipani trees swaying — it was like being in a painting. The rain shower is also fantastic after a day at the beach. Such a peaceful retreat.',
				date: '2026-03-20',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=300&fit=crop'
				]
			},
			{
				id: 'gs-r2',
				propertyId: 'garden-suite',
				author: {
					name: 'David Kim',
					city: 'Seoul',
					country: 'South Korea',
					avatarUrl:
						'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Perfect for couples',
				body: 'The Garden Suite is exactly what you need for a romantic getaway. Cosy but not cramped, beautifully designed, and the garden setting feels very private. We loved having breakfast on the terrace every morning. The bed is extremely comfortable.',
				date: '2026-03-08',
				verified: true
			},
			{
				id: 'gs-r3',
				propertyId: 'garden-suite',
				author: {
					name: 'Isabella Rossi',
					city: 'Milan',
					country: 'Italy',
					avatarUrl:
						'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=80&h=80&fit=crop&crop=face'
				},
				rating: 4,
				title: 'Charming and well-located',
				body: 'A lovely space surrounded by nature. The garden is lush and well-maintained, and you can hear birds singing in the morning. The suite itself is modern with nice touches. Walking distance to the best restaurants and dive shops on the island.',
				date: '2026-02-15',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=400&h=300&fit=crop'
				]
			},
			{
				id: 'gs-r4',
				propertyId: 'garden-suite',
				author: {
					name: 'Thomas Anderson',
					city: 'Vancouver',
					country: 'Canada',
					avatarUrl:
						'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Great value for Koh Tao',
				body: 'Honestly surprised by the quality at this price point. The suite is spotless, tastefully decorated, and the air conditioning keeps it perfectly cool. The garden terrace is a highlight. Communication with the host was quick and helpful.',
				date: '2026-01-28',
				verified: true
			},
			{
				id: 'gs-r5',
				propertyId: 'garden-suite',
				author: {
					name: 'Yuki Sato',
					city: 'Osaka',
					country: 'Japan',
					avatarUrl:
						'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Peaceful island escape',
				body: 'Exactly what we were looking for. A quiet retreat with beautiful surroundings. The garden is filled with tropical flowers and the sound of nature is incredibly calming. We used the suite as our base for diving and exploring the island. Highly recommended.',
				date: '2026-01-12',
				verified: true
			}
		],
		tourSnippets: [
			{
				id: 'gs-ts1',
				roomId: 'gs-lounge',
				position: [180, 70, -200],
				quote: 'Such a peaceful retreat surrounded by nature.',
				authorName: 'Anna M.',
				authorCity: 'Berlin',
				rating: 5
			},
			{
				id: 'gs-ts2',
				roomId: 'gs-dining',
				position: [-180, 60, 220],
				quote: 'Breakfast on the terrace was our favourite part!',
				authorName: 'David K.',
				authorCity: 'Seoul',
				rating: 5
			}
		],
		recentBookings: []
	},
	{
		propertyId: 'penthouse',
		overallRating: 4.95,
		totalReviews: 64,
		isSuperhost: false,
		breakdown: {
			cleanliness: 4.95,
			accuracy: 4.9,
			communication: 5.0,
			location: 5.0,
			checkIn: 4.95,
			value: 4.85
		},
		reviews: [
			{
				id: 'ph-r1',
				propertyId: 'penthouse',
				author: {
					name: 'Alexander Petrov',
					city: 'Moscow',
					country: 'Russia',
					avatarUrl:
						'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Panoramic views that take your breath away',
				body: 'The rooftop terrace alone is worth the price. We watched the sunset over Koh Nang Yuan every evening with a cocktail in hand. The penthouse interiors are beautifully designed with high-end finishes throughout. The full kitchen meant we could cook when we wanted. An extraordinary property.',
				date: '2026-03-22',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=400&h=300&fit=crop',
					'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop'
				]
			},
			{
				id: 'ph-r2',
				propertyId: 'penthouse',
				author: {
					name: 'Charlotte Williams',
					city: 'London',
					country: 'United Kingdom',
					avatarUrl:
						'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Worth every penny',
				body: 'We celebrated our anniversary at the Penthouse and it was perfect. Two spacious bedrooms, a living area that feels like a luxury hotel, and those views! The bathtub overlooking the island is a dream. The host arranged flowers and champagne for our arrival. Truly special.',
				date: '2026-03-10',
				verified: true
			},
			{
				id: 'ph-r3',
				propertyId: 'penthouse',
				author: {
					name: 'Lucas Fernandez',
					city: 'Buenos Aires',
					country: 'Argentina',
					avatarUrl:
						'https://images.unsplash.com/photo-1463453091185-61582044d556?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'The best accommodation in Koh Tao',
				body: 'We have stayed at many places on the island but nothing compares to the Penthouse. The 200 sqm space is massive, the designer furniture is gorgeous, and the panoramic views from every room are incredible. The rooftop terrace is perfect for stargazing at night.',
				date: '2026-02-20',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=400&h=300&fit=crop'
				]
			},
			{
				id: 'ph-r4',
				propertyId: 'penthouse',
				author: {
					name: 'Mei Lin Wong',
					city: 'Hong Kong',
					country: 'China',
					avatarUrl:
						'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Elevated luxury on a tropical island',
				body: 'The attention to detail in the Penthouse is remarkable. From the quality of the mattresses to the kitchen appliances, everything is premium. We hosted a small dinner party on the rooftop terrace and our friends were blown away by the setting. Cannot recommend enough.',
				date: '2026-02-05',
				verified: true
			},
			{
				id: 'ph-r5',
				propertyId: 'penthouse',
				author: {
					name: 'Henrik Larsen',
					city: 'Copenhagen',
					country: 'Denmark',
					avatarUrl:
						'https://images.unsplash.com/photo-1552058544-f2b08422138a?w=80&h=80&fit=crop&crop=face'
				},
				rating: 5,
				title: 'Unforgettable stay',
				body: 'Traveling with friends, the Penthouse gave us the space and comfort we needed. Two great bedrooms, a fantastic kitchen for group cooking, and the rooftop became our evening hangout. The panoramic view is genuinely stunning — photos do not do it justice.',
				date: '2026-01-18',
				verified: true
			}
		],
		tourSnippets: [
			{
				id: 'ph-ts1',
				roomId: 'ph-bedroom',
				position: [220, 80, -180],
				quote: 'The views from the bedroom are absolutely breathtaking.',
				authorName: 'Charlotte W.',
				authorCity: 'London',
				rating: 5
			}
		],
		recentBookings: []
	}
];

export const recentBookings: RecentBooking[] = [
	{ name: 'Mark', city: 'Sydney', propertyId: 'pool-villa', dates: 'Apr 12-17', timeAgo: '2 hours ago' },
	{ name: 'Sakura', city: 'Tokyo', propertyId: 'garden-suite', dates: 'Apr 18-22', timeAgo: '4 hours ago' },
	{ name: 'Lars', city: 'Oslo', propertyId: 'penthouse', dates: 'Apr 20-26', timeAgo: '5 hours ago' },
	{ name: 'Priya', city: 'Mumbai', propertyId: 'pool-villa', dates: 'Apr 25-30', timeAgo: '7 hours ago' },
	{ name: 'Elena', city: 'Barcelona', propertyId: 'garden-suite', dates: 'May 1-5', timeAgo: '9 hours ago' },
	{ name: 'Tom', city: 'New York', propertyId: 'penthouse', dates: 'May 3-8', timeAgo: '11 hours ago' },
	{ name: 'Anh', city: 'Ho Chi Minh City', propertyId: 'pool-villa', dates: 'May 10-15', timeAgo: '13 hours ago' },
	{ name: 'Clara', city: 'Zurich', propertyId: 'garden-suite', dates: 'May 8-12', timeAgo: '16 hours ago' }
];

export function getSocialProofByPropertyId(propertyId: string) {
	return socialProofData.find((sp) => sp.propertyId === propertyId);
}
