import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	tenants: defineTable({
		name: v.string(),
		email: v.string(),
		stripeAccountId: v.optional(v.string()),
		whatsappNumber: v.optional(v.string()),
		lineId: v.optional(v.string()),
		createdAt: v.number()
	}).index('by_email', ['email']),

	properties: defineTable({
		tenantId: v.optional(v.id('tenants')),
		slug: v.string(),
		name: v.string(),
		tagline: v.string(),
		description: v.string(),
		pricePerNight: v.number(),
		currency: v.string(),
		maxGuests: v.number(),
		bedrooms: v.number(),
		bathrooms: v.number(),
		area: v.number(),
		images: v.array(v.string()),
		amenities: v.array(v.string()),
		tourRoomIds: v.array(v.string()),
		directDiscountPercent: v.number(),
		status: v.union(v.literal('active'), v.literal('draft'), v.literal('archived'))
	})
		.index('by_slug', ['slug'])
		.index('by_tenant', ['tenantId'])
		.index('by_status', ['status']),

	rooms: defineTable({
		propertyId: v.id('properties'),
		slug: v.string(),
		name: v.string(),
		imagePath: v.string(),
		hotspots: v.array(
			v.object({
				id: v.string(),
				position: v.array(v.number()),
				targetRoomSlug: v.string(),
				label: v.string()
			})
		)
	})
		.index('by_property', ['propertyId'])
		.index('by_slug', ['slug']),

	bookings: defineTable({
		propertyId: v.id('properties'),
		tenantId: v.optional(v.id('tenants')),
		guestName: v.string(),
		guestEmail: v.string(),
		guestPhone: v.string(),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		nights: v.number(),
		subtotal: v.number(),
		discountAmount: v.number(),
		total: v.number(),
		currency: v.string(),
		stripePaymentIntentId: v.optional(v.string()),
		stripeSessionId: v.optional(v.string()),
		paymentStatus: v.union(
			v.literal('pending'),
			v.literal('paid'),
			v.literal('failed'),
			v.literal('refunded')
		),
		status: v.union(
			v.literal('pending'),
			v.literal('confirmed'),
			v.literal('cancelled'),
			v.literal('completed')
		),
		createdAt: v.number()
	})
		.index('by_property', ['propertyId'])
		.index('by_tenant', ['tenantId'])
		.index('by_status', ['status'])
		.index('by_stripe_session', ['stripeSessionId']),

	reviews: defineTable({
		propertyId: v.id('properties'),
		authorName: v.string(),
		authorCity: v.string(),
		authorCountry: v.string(),
		authorAvatarUrl: v.string(),
		rating: v.number(),
		title: v.string(),
		body: v.string(),
		date: v.string(),
		verified: v.boolean(),
		photos: v.optional(v.array(v.string()))
	})
		.index('by_property', ['propertyId'])
		.index('by_rating', ['rating']),

	socialProof: defineTable({
		propertyId: v.id('properties'),
		overallRating: v.number(),
		totalReviews: v.number(),
		isSuperhost: v.boolean(),
		breakdown: v.object({
			cleanliness: v.number(),
			accuracy: v.number(),
			communication: v.number(),
			location: v.number(),
			checkIn: v.number(),
			value: v.number()
		})
	}).index('by_property', ['propertyId']),

	tourSnippets: defineTable({
		propertyId: v.id('properties'),
		roomSlug: v.string(),
		position: v.array(v.number()),
		quote: v.string(),
		authorName: v.string(),
		authorCity: v.string(),
		rating: v.number()
	}).index('by_property', ['propertyId']),

	recentBookingDisplay: defineTable({
		propertyId: v.id('properties'),
		name: v.string(),
		city: v.string(),
		dates: v.string(),
		timeAgo: v.string()
	}).index('by_property', ['propertyId']),

	leads: defineTable({
		propertyId: v.optional(v.id('properties')),
		email: v.string(),
		source: v.union(
			v.literal('tour_completion'),
			v.literal('chat'),
			v.literal('booking_abandonment')
		),
		createdAt: v.number()
	})
		.index('by_email', ['email'])
		.index('by_property', ['propertyId']),

	pricing: defineTable({
		propertyId: v.id('properties'),
		directRate: v.number(),
		otaPricing: v.array(
			v.object({
				platform: v.string(),
				displayName: v.string(),
				nightlyRate: v.number(),
				serviceFeePercent: v.number(),
				cleaningFee: v.number(),
				logo: v.string()
			})
		),
		directBenefits: v.array(
			v.object({
				benefit: v.string(),
				directOnly: v.boolean()
			})
		)
	}).index('by_property', ['propertyId']),

	// Phase 2: Availability & iCal sync
	icalSources: defineTable({
		propertyId: v.id('properties'),
		platform: v.string(),
		icalUrl: v.string(),
		lastSyncedAt: v.optional(v.number())
	}).index('by_property', ['propertyId']),

	availability: defineTable({
		propertyId: v.id('properties'),
		date: v.string(),
		status: v.union(v.literal('available'), v.literal('booked'), v.literal('blocked')),
		source: v.union(
			v.literal('direct'),
			v.literal('airbnb'),
			v.literal('booking_com'),
			v.literal('agoda'),
			v.literal('manual')
		),
		bookingId: v.optional(v.id('bookings'))
	})
		.index('by_property', ['propertyId'])
		.index('by_property_date', ['propertyId', 'date']),

	// Phase 3: AI Chat
	chatSessions: defineTable({
		propertyId: v.id('properties'),
		channel: v.union(v.literal('web'), v.literal('whatsapp'), v.literal('line')),
		messages: v.array(
			v.object({
				role: v.union(v.literal('user'), v.literal('assistant')),
				content: v.string(),
				timestamp: v.number()
			})
		),
		createdAt: v.number()
	}).index('by_property', ['propertyId']),

	propertyKnowledge: defineTable({
		propertyId: v.id('properties'),
		category: v.union(
			v.literal('pricing_rules'),
			v.literal('availability_notes'),
			v.literal('faq_pairs')
		),
		content: v.string()
	}).index('by_property', ['propertyId'])
});
