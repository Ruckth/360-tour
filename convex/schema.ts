import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export default defineSchema({
	users: defineTable({
		clerkId: v.string(),
		tokenIdentifier: v.string(),
		email: v.string(),
		name: v.optional(v.string()),
		imageUrl: v.optional(v.string())
	})
		.index('by_token', ['tokenIdentifier'])
		.index('by_clerk_id', ['clerkId']),

	tenants: defineTable({
		name: v.string(),
		email: v.string(),
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
		paidAt: v.optional(v.number()),
		paymentMethod: v.optional(v.string()),
		confirmationCode: v.optional(v.string()),
		invoiceNumber: v.optional(v.string()),
		receiptNumber: v.optional(v.string()),
		accessToken: v.optional(v.string()),
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
		.index('by_property_checkIn', ['propertyId', 'checkIn'])
		.index('by_tenant', ['tenantId'])
		.index('by_status', ['status']),

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
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		channel: v.union(v.literal('web'), v.literal('whatsapp'), v.literal('line')),
		visitorId: v.optional(v.string()),
		visitorName: v.optional(v.string()),
		visitorEmail: v.optional(v.string()),
		visitorPhone: v.optional(v.string()),
		visitorContactApp: v.optional(v.union(v.literal('whatsapp'), v.literal('line'))),
		visitorContactHandle: v.optional(v.string()),
		currentPath: v.optional(v.string()),
		referrer: v.optional(v.string()),
		userAgent: v.optional(v.string()),
		timeZone: v.optional(v.string()),
		browserLanguage: v.optional(v.string()),
		screenSize: v.optional(v.string()),
		viewportSize: v.optional(v.string()),
		platform: v.optional(v.string()),
		lastSeenAt: v.optional(v.number()),
		lastOpenedAt: v.optional(v.number()),
		lastClosedAt: v.optional(v.number()),
		// Legacy embedded messages — kept optional for migration compatibility.
		// New sessions write to the chatMessages table instead.
		messages: v.optional(
			v.array(
				v.object({
					role: v.union(v.literal('user'), v.literal('assistant')),
					content: v.string(),
					timestamp: v.number()
				})
			)
		),
		createdAt: v.number()
	})
		.index('by_property', ['propertyId'])
		.index('by_last_seen', ['lastSeenAt'])
		.index('by_property_last_seen', ['propertyId', 'lastSeenAt'])
		.index('by_visitor', ['visitorId']),

	chatMessages: defineTable({
		sessionId: v.id('chatSessions'),
		role: v.union(v.literal('user'), v.literal('assistant')),
		content: v.string(),
		action: v.optional(v.union(v.literal('booking'), v.literal('tour'), v.literal('none'))),
		timestamp: v.number()
	}).index('by_session', ['sessionId', 'timestamp']),

	chatBrowserHandoffs: defineTable({
		token: v.string(),
		sessionId: v.id('chatSessions'),
		expiresAt: v.number(),
		claimedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_token', ['token'])
		.index('by_expires_at', ['expiresAt']),

	lineWebhookEvents: defineTable({
		eventKey: v.string(),
		sessionId: v.optional(v.id('chatSessions')),
		lineUserId: v.optional(v.string()),
		sourceType: v.optional(v.string()),
		eventType: v.union(
			v.literal('message'),
			v.literal('follow'),
			v.literal('postback'),
			v.literal('unsupported')
		),
		messageText: v.optional(v.string()),
		postbackData: v.optional(v.string()),
		status: v.union(
			v.literal('received'),
			v.literal('processing'),
			v.literal('replied'),
			v.literal('ignored'),
			v.literal('failed')
		),
		replyMode: v.optional(
			v.union(
				v.literal('exact'),
				v.literal('question_bank_exact'),
				v.literal('question_bank_semantic'),
				v.literal('ai'),
				v.literal('postback'),
				v.literal('follow'),
				v.literal('ignored'),
				v.literal('failed')
			)
		),
		lineReplyStatus: v.optional(v.number()),
		userMessageId: v.optional(v.id('chatMessages')),
		assistantMessageId: v.optional(v.id('chatMessages')),
		error: v.optional(v.string()),
		eventTimestamp: v.optional(v.number()),
		processingStartedAt: v.number(),
		processedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_event_key', ['eventKey'])
		.index('by_session', ['sessionId'])
		.index('by_status_and_created_at', ['status', 'createdAt']),

	chatSuggestedQuestions: defineTable({
		sessionId: v.id('chatSessions'),
		assistantMessageId: v.id('chatMessages'),
		userMessageId: v.optional(v.id('chatMessages')),
		question: v.string(),
		normalizedQuestion: v.string(),
		translations: v.optional(v.record(v.string(), v.string())),
		locale: v.string(),
		propertySlug: v.optional(v.string()),
		topic: v.string(),
		score: v.number(),
		status: v.union(v.literal('active'), v.literal('clicked'), v.literal('archived')),
		shownAt: v.optional(v.number()),
		clickedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_session_and_status', ['sessionId', 'status'])
		.index('by_session_status_score', ['sessionId', 'status', 'score'])
		.index('by_session_and_assistant', ['sessionId', 'assistantMessageId'])
		.index('by_created_at', ['createdAt'])
		.index('by_status_and_created_at', ['status', 'createdAt']),

	curatedChatQuestions: defineTable({
		question: v.string(),
		normalizedQuestion: v.string(),
		translations: v.optional(v.record(v.string(), v.string())),
		answer: v.optional(v.string()),
		answerTranslations: v.optional(v.record(v.string(), v.string())),
		answerMode: v.optional(v.union(v.literal('static'), v.literal('dynamic'))),
		dynamicIntent: v.optional(
			v.union(
				v.literal('availability'),
				v.literal('pricing'),
				v.literal('property_details'),
				v.literal('booking_help'),
				v.literal('contact')
			)
		),
		propertySlug: v.optional(v.string()),
		topic: v.string(),
		score: v.number(),
		status: v.union(v.literal('active'), v.literal('archived')),
		createdAt: v.number(),
		updatedAt: v.number(),
		archivedAt: v.optional(v.number()),
		createdByAdminEmail: v.string(),
		updatedByAdminEmail: v.string(),
		archivedByAdminEmail: v.optional(v.string())
	})
		.index('by_created_at', ['createdAt'])
		.index('by_status_and_created_at', ['status', 'createdAt'])
		.index('by_status_and_score', ['status', 'score'])
		.index('by_status_and_propertySlug_and_score', ['status', 'propertySlug', 'score']),

	chatQuestionInteractions: defineTable({
		sessionId: v.id('chatSessions'),
		questionId: v.id('curatedChatQuestions'),
		shownAt: v.optional(v.number()),
		clickedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_question', ['sessionId', 'questionId']),

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
