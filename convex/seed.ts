import { mutation } from './_generated/server';

const sharedBenefits = [
	{ benefit: 'Free airport pickup', directOnly: true },
	{ benefit: 'Welcome basket', directOnly: true },
	{ benefit: 'Late checkout (2pm)', directOnly: true },
	{ benefit: 'No service fees', directOnly: true },
	{ benefit: 'Free cancellation (48h)', directOnly: false },
	{ benefit: 'Direct WhatsApp support', directOnly: true }
];

export const seedAll = mutation({
	args: {},
	handler: async (ctx) => {
		// Check if already seeded
		const existing = await ctx.db.query('properties').first();
		if (existing) {
			return { status: 'already_seeded' };
		}

		// --- Properties ---
		const poolVillaId = await ctx.db.insert('properties', {
			slug: 'pool-villa',
			name: 'Pool Villa',
			tagline: 'Private paradise with infinity pool',
			description:
				'Experience ultimate luxury in our spacious Pool Villa featuring a private infinity pool, open-plan living area, and lush tropical garden. Floor-to-ceiling windows bring the outside in, with stunning views from every room.',
			pricePerNight: 8500,
			currency: 'THB',
			maxGuests: 4,
			bedrooms: 2,
			bathrooms: 2,
			area: 145,
			images: [
				'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&h=800&fit=crop',
				'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&h=800&fit=crop'
			],
			amenities: ['Private Pool', 'WiFi', 'Air Conditioning', 'Kitchen', 'Garden View', 'King Bed'],
			tourRoomIds: ['pv-living', 'pv-pool'],
			directDiscountPercent: 15,
			status: 'active'
		});

		const gardenSuiteId = await ctx.db.insert('properties', {
			slug: 'garden-suite',
			name: 'Garden Suite',
			tagline: 'Serene retreat surrounded by nature',
			description:
				'Nestled among tropical gardens, the Garden Suite offers a tranquil escape with a spacious bedroom, modern bathroom, and private terrace. Wake up to birdsong and the scent of frangipani.',
			pricePerNight: 4500,
			currency: 'THB',
			maxGuests: 2,
			bedrooms: 1,
			bathrooms: 1,
			area: 65,
			images: [
				'/garden-image.jpg',
				'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&h=800&fit=crop'
			],
			amenities: ['WiFi', 'Air Conditioning', 'Garden Terrace', 'Rain Shower', 'Queen Bed'],
			tourRoomIds: ['gs-lounge', 'gs-dining'],
			directDiscountPercent: 15,
			status: 'active'
		});

		const penthouseId = await ctx.db.insert('properties', {
			slug: 'penthouse',
			name: 'Penthouse',
			tagline: 'Elevated living with panoramic views',
			description:
				'Our signature Penthouse crowns the property with sweeping panoramic views, a rooftop terrace, and designer interiors. Two bedrooms, a full kitchen, and a living space designed for those who appreciate the finer things.',
			pricePerNight: 12000,
			currency: 'THB',
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
			tourRoomIds: ['ph-bedroom'],
			directDiscountPercent: 15,
			status: 'active'
		});

		const propertyMap = {
			'pool-villa': poolVillaId,
			'garden-suite': gardenSuiteId,
			penthouse: penthouseId
		};

		// --- Rooms ---
		await ctx.db.insert('rooms', {
			propertyId: poolVillaId,
			slug: 'pv-living',
			name: 'Living Area',
			imagePath: '/pool-villa-living.jpg',
			hotspots: [
				{ id: 'pv-living-to-pool', position: [300, -30, -200], targetRoomSlug: 'pv-pool', label: 'Pool Area' }
			]
		});
		await ctx.db.insert('rooms', {
			propertyId: poolVillaId,
			slug: 'pv-pool',
			name: 'Pool Area',
			imagePath: '/pool-villa-pool.jpg',
			hotspots: [
				{ id: 'pv-pool-to-living', position: [-300, 0, 200], targetRoomSlug: 'pv-living', label: 'Living Area' }
			]
		});
		await ctx.db.insert('rooms', {
			propertyId: gardenSuiteId,
			slug: 'gs-lounge',
			name: 'Lounge',
			imagePath: '/garden-suite-interior.jpg',
			hotspots: [
				{
					id: 'gs-lounge-to-dining',
					position: [250, -30, 300],
					targetRoomSlug: 'gs-dining',
					label: 'Dining Area'
				}
			]
		});
		await ctx.db.insert('rooms', {
			propertyId: gardenSuiteId,
			slug: 'gs-dining',
			name: 'Dining Area',
			imagePath: '/garden-dining360.jpg',
			hotspots: [
				{ id: 'gs-dining-to-lounge', position: [-250, 0, -300], targetRoomSlug: 'gs-lounge', label: 'Lounge' }
			]
		});
		await ctx.db.insert('rooms', {
			propertyId: penthouseId,
			slug: 'ph-bedroom',
			name: 'Master Bedroom',
			imagePath: '/penthouse-bedroom.jpg',
			hotspots: []
		});

		// --- Pricing ---
		await ctx.db.insert('pricing', {
			propertyId: poolVillaId,
			directRate: 8500,
			otaPricing: [
				{
					platform: 'booking.com',
					displayName: 'Booking.com',
					nightlyRate: 10200,
					serviceFeePercent: 14,
					cleaningFee: 800,
					logo: 'B'
				},
				{
					platform: 'airbnb',
					displayName: 'Airbnb',
					nightlyRate: 9800,
					serviceFeePercent: 14,
					cleaningFee: 600,
					logo: 'A'
				},
				{
					platform: 'agoda',
					displayName: 'Agoda',
					nightlyRate: 9950,
					serviceFeePercent: 12,
					cleaningFee: 700,
					logo: 'AG'
				}
			],
			directBenefits: sharedBenefits
		});
		await ctx.db.insert('pricing', {
			propertyId: gardenSuiteId,
			directRate: 4500,
			otaPricing: [
				{
					platform: 'booking.com',
					displayName: 'Booking.com',
					nightlyRate: 5400,
					serviceFeePercent: 14,
					cleaningFee: 500,
					logo: 'B'
				},
				{
					platform: 'airbnb',
					displayName: 'Airbnb',
					nightlyRate: 5200,
					serviceFeePercent: 14,
					cleaningFee: 400,
					logo: 'A'
				},
				{
					platform: 'agoda',
					displayName: 'Agoda',
					nightlyRate: 5300,
					serviceFeePercent: 12,
					cleaningFee: 450,
					logo: 'AG'
				}
			],
			directBenefits: sharedBenefits
		});
		await ctx.db.insert('pricing', {
			propertyId: penthouseId,
			directRate: 12000,
			otaPricing: [
				{
					platform: 'booking.com',
					displayName: 'Booking.com',
					nightlyRate: 14400,
					serviceFeePercent: 14,
					cleaningFee: 1200,
					logo: 'B'
				},
				{
					platform: 'airbnb',
					displayName: 'Airbnb',
					nightlyRate: 13800,
					serviceFeePercent: 14,
					cleaningFee: 900,
					logo: 'A'
				},
				{
					platform: 'agoda',
					displayName: 'Agoda',
					nightlyRate: 14100,
					serviceFeePercent: 12,
					cleaningFee: 1000,
					logo: 'AG'
				}
			],
			directBenefits: sharedBenefits
		});

		// --- Social Proof ---
		await ctx.db.insert('socialProof', {
			propertyId: poolVillaId,
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
			}
		});
		await ctx.db.insert('socialProof', {
			propertyId: gardenSuiteId,
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
			}
		});
		await ctx.db.insert('socialProof', {
			propertyId: penthouseId,
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
			}
		});

		// --- Reviews (sample from each property) ---
		const reviewsData = [
			{
				propertyId: poolVillaId,
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
				propertyId: poolVillaId,
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
				propertyId: poolVillaId,
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
				propertyId: gardenSuiteId,
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
				propertyId: gardenSuiteId,
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
				propertyId: penthouseId,
				authorName: 'Alexander Petrov',
				authorCity: 'Moscow',
				authorCountry: 'Russia',
				authorAvatarUrl:
					'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=80&h=80&fit=crop&crop=face',
				rating: 5,
				title: 'Panoramic views that take your breath away',
				body: 'The rooftop terrace alone is worth the price. We watched the sunset over Koh Nang Yuan every evening with a cocktail in hand.',
				date: '2026-03-22',
				verified: true,
				photos: [
					'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=400&h=300&fit=crop',
					'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400&h=300&fit=crop'
				]
			},
			{
				propertyId: penthouseId,
				authorName: 'Charlotte Williams',
				authorCity: 'London',
				authorCountry: 'United Kingdom',
				authorAvatarUrl:
					'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=80&h=80&fit=crop&crop=face',
				rating: 5,
				title: 'Worth every penny',
				body: 'We celebrated our anniversary at the Penthouse and it was perfect. Two spacious bedrooms, a living area that feels like a luxury hotel.',
				date: '2026-03-10',
				verified: true
			}
		];

		for (const review of reviewsData) {
			await ctx.db.insert('reviews', review);
		}

		// --- Tour Snippets ---
		await ctx.db.insert('tourSnippets', {
			propertyId: poolVillaId,
			roomSlug: 'pv-pool',
			position: [200, 60, 250],
			quote: 'The infinity pool at sunrise is absolutely magical!',
			authorName: 'Sophie L.',
			authorCity: 'Paris',
			rating: 5
		});
		await ctx.db.insert('tourSnippets', {
			propertyId: poolVillaId,
			roomSlug: 'pv-living',
			position: [-200, 80, 250],
			quote: 'Open-plan living feels incredibly luxurious.',
			authorName: 'James C.',
			authorCity: 'Singapore',
			rating: 5
		});
		await ctx.db.insert('tourSnippets', {
			propertyId: gardenSuiteId,
			roomSlug: 'gs-lounge',
			position: [180, 70, -200],
			quote: 'Such a peaceful retreat surrounded by nature.',
			authorName: 'Anna M.',
			authorCity: 'Berlin',
			rating: 5
		});
		await ctx.db.insert('tourSnippets', {
			propertyId: penthouseId,
			roomSlug: 'ph-bedroom',
			position: [220, 80, -180],
			quote: 'The views from the bedroom are absolutely breathtaking.',
			authorName: 'Charlotte W.',
			authorCity: 'London',
			rating: 5
		});

		// --- Recent Booking Display ---
		const recentBookingsData = [
			{ propertyId: poolVillaId, name: 'Mark', city: 'Sydney', dates: 'Apr 12-17', timeAgo: '2 hours ago' },
			{
				propertyId: gardenSuiteId,
				name: 'Sakura',
				city: 'Tokyo',
				dates: 'Apr 18-22',
				timeAgo: '4 hours ago'
			},
			{ propertyId: penthouseId, name: 'Lars', city: 'Oslo', dates: 'Apr 20-26', timeAgo: '5 hours ago' },
			{ propertyId: poolVillaId, name: 'Priya', city: 'Mumbai', dates: 'Apr 25-30', timeAgo: '7 hours ago' },
			{
				propertyId: gardenSuiteId,
				name: 'Elena',
				city: 'Barcelona',
				dates: 'May 1-5',
				timeAgo: '9 hours ago'
			},
			{ propertyId: penthouseId, name: 'Tom', city: 'New York', dates: 'May 3-8', timeAgo: '11 hours ago' },
			{
				propertyId: poolVillaId,
				name: 'Anh',
				city: 'Ho Chi Minh City',
				dates: 'May 10-15',
				timeAgo: '13 hours ago'
			},
			{
				propertyId: gardenSuiteId,
				name: 'Clara',
				city: 'Zurich',
				dates: 'May 8-12',
				timeAgo: '16 hours ago'
			}
		];

		for (const rb of recentBookingsData) {
			await ctx.db.insert('recentBookingDisplay', rb);
		}

		return {
			status: 'seeded',
			properties: { poolVilla: poolVillaId, gardenSuite: gardenSuiteId, penthouse: penthouseId }
		};
	}
});
