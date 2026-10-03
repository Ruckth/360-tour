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
		icalExportToken: v.optional(v.string()),
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
		status: v.union(v.literal('active'), v.literal('draft'), v.literal('archived')),
		// Optional per-locale copy; the public site falls back to English (see src/lib/i18n/public-content.ts).
		translations: v.optional(
			v.array(
				v.object({
					locale: v.string(),
					tagline: v.optional(v.string()),
					description: v.optional(v.string()),
					amenities: v.optional(v.array(v.string()))
				})
			)
		),
		// Set when an admin edits name/tagline/description/amenities, so edited English beats bundled i18n copy.
		contentEditedAt: v.optional(v.number())
	})
		.index('by_slug', ['slug'])
		.index('by_icalExportToken', ['icalExportToken'])
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
		guestEmail: v.optional(v.string()),
		guestPhone: v.string(),
		// Exact-lookup forms of the guest's phone (digits only) and email (trimmed, lower case).
		// Written with every booking; migrations:backfillBookingGuestLookup fills older rows.
		guestPhoneDigits: v.optional(v.string()),
		guestEmailNormalized: v.optional(v.string()),
		source: v.optional(
			v.union(
				v.literal('web'),
				v.literal('whatsapp'),
				v.literal('messenger'),
				v.literal('line'),
				v.literal('instagram'),
				v.literal('admin')
			)
		),
		chatSessionId: v.optional(v.id('chatSessions')),
		checkIn: v.string(),
		checkOut: v.string(),
		guests: v.number(),
		nights: v.number(),
		subtotal: v.number(),
		discountAmount: v.number(),
		total: v.number(),
		currency: v.string(),
		paidAt: v.optional(v.number()),
		// What the guest actually paid; the total can change later if an admin edits the stay.
		amountPaid: v.optional(v.number()),
		refundedAt: v.optional(v.number()),
		paymentMethod: v.optional(v.string()),
		confirmationCode: v.optional(v.string()),
		invoiceNumber: v.optional(v.string()),
		receiptNumber: v.optional(v.string()),
		accessToken: v.optional(v.string()),
		stripeCheckoutSessionId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		stripeCheckoutUrl: v.optional(v.string()),
		stripeCheckoutExpiresAt: v.optional(v.number()),
		checkoutAttempt: v.optional(v.number()),
		checkoutRequest: v.optional(v.object({
			attempt: v.number(),
			expiresAt: v.number(),
			total: v.number(),
			currency: v.string(),
			checkIn: v.string(),
			checkOut: v.string(),
			propertyName: v.string(),
			siteUrl: v.string(),
			guestEmail: v.optional(v.string())
		})),
		confirmationEmailsQueuedAt: v.optional(v.number()),
		cancellationEmailQueuedAt: v.optional(v.number()),
		preArrivalEmailQueuedAt: v.optional(v.number()),
		reviewEmailQueuedAt: v.optional(v.number()),
		adminNotes: v.optional(v.string()),
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
		.index('by_property_checkOut', ['propertyId', 'checkOut'])
		.index('by_checkIn', ['checkIn'])
		.index('by_tenant', ['tenantId'])
		.index('by_status', ['status'])
		.index('by_status_createdAt', ['status', 'createdAt'])
		.index('by_status_checkIn', ['status', 'checkIn'])
		.index('by_status_checkOut', ['status', 'checkOut'])
		.index('by_stripePaymentIntentId', ['stripePaymentIntentId'])
		.index('by_chatSession', ['chatSessionId'])
		.index('by_guestPhone', ['guestPhone'])
		.index('by_guestPhoneDigits', ['guestPhoneDigits'])
		.index('by_guestEmailNormalized', ['guestEmailNormalized'])
		.index('by_confirmationCode', ['confirmationCode'])
		.searchIndex('search_guestName', { searchField: 'guestName' }),

	staff: defineTable({
		name: v.string(),
		role: v.string(),
		avatarUrl: v.optional(v.string()),
		color: v.string(),
		status: v.union(v.literal('active'), v.literal('archived')),
		workingHours: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string() })),
		breaks: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string(), label: v.string() })),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_status', ['status']),

	services: defineTable({
		slug: v.string(),
		name: v.string(),
		description: v.string(),
		category: v.string(),
		durationMin: v.number(),
		bufferMin: v.number(),
		price: v.number(),
		currency: v.string(),
		staffIds: v.array(v.id('staff')),
		status: v.union(v.literal('active'), v.literal('archived')),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_slug', ['slug'])
		.index('by_status', ['status']),

	staffTimeOff: defineTable({
		staffId: v.id('staff'),
		start: v.number(),
		end: v.number(),
		label: v.string(),
		createdByAdminEmail: v.optional(v.string())
	}).index('by_staff_start', ['staffId', 'start']),

	/** Roster override for one person on one resort-local date; replaces the weekly pattern. No shifts = off. */
	staffDays: defineTable({
		staffId: v.id('staff'),
		date: v.string(),
		shifts: v.array(v.object({ start: v.string(), end: v.string() })),
		breaks: v.array(v.object({ start: v.string(), end: v.string(), label: v.string() })),
		note: v.optional(v.string()),
		updatedAt: v.number()
	})
		.index('by_staff_date', ['staffId', 'date'])
		.index('by_date', ['date']),

	/** One bulk roster action, kept so the latest one can be undone. */
	rosterBatches: defineTable({
		label: v.string(),
		status: v.union(v.literal('running'), v.literal('undoing'), v.literal('done'), v.literal('undone')),
		createdByAdminEmail: v.string(),
		createdAt: v.number(),
		// makeDefault only: each person's weekly pattern before the change.
		patterns: v.optional(v.array(v.object({
			staffId: v.id('staff'),
			workingHours: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string() })),
			breaks: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string(), label: v.string() }))
		})))
	}),

	/** A cell's state before a batch changed it; null = no override (the pattern applied). */
	rosterBatchItems: defineTable({
		batchId: v.id('rosterBatches'),
		staffId: v.id('staff'),
		date: v.string(),
		previous: v.union(v.null(), v.object({
			shifts: v.array(v.object({ start: v.string(), end: v.string() })),
			breaks: v.array(v.object({ start: v.string(), end: v.string(), label: v.string() })),
			note: v.optional(v.string())
		}))
	}).index('by_batch', ['batchId']),

	serviceAppointments: defineTable({
		serviceId: v.id('services'),
		staffId: v.id('staff'),
		start: v.number(),
		end: v.number(),
		blockedUntil: v.number(),
		guestName: v.string(),
		guestPhone: v.string(),
		guestEmail: v.optional(v.string()),
		bookingId: v.optional(v.id('bookings')),
		chatSessionId: v.optional(v.id('chatSessions')),
		source: v.union(
			v.literal('web'),
			v.literal('whatsapp'),
			v.literal('messenger'),
			v.literal('line'),
			v.literal('instagram'),
			v.literal('admin')
		),
		status: v.union(
			v.literal('booked'),
			v.literal('arrived'),
			v.literal('in_service'),
			v.literal('completed'),
			v.literal('cancelled'),
			v.literal('no_show')
		),
		paymentStatus: v.union(v.literal('unpaid'), v.literal('paid'), v.literal('refunded')),
		refundedAt: v.optional(v.number()),
		price: v.number(),
		currency: v.string(),
		notes: v.optional(v.string()),
		confirmationCode: v.string(),
		accessToken: v.string(),
		createdAt: v.number(),
		// Bumped on every change; a confirmation made against an older revision is refused. Missing = 0.
		revision: v.optional(v.number()),
		cancelledAt: v.optional(v.number()),
		/** Admin email, or "guest" for a chat cancellation. */
		cancelledBy: v.optional(v.string()),
		cancellationReason: v.optional(v.string()),
		/** The cancelled or no-show appointment this one was booked again from. */
		rebookedFromId: v.optional(v.id('serviceAppointments'))
	})
		.index('by_staff_start', ['staffId', 'start'])
		.index('by_service_start', ['serviceId', 'start'])
		.index('by_start', ['start'])
		.index('by_booking', ['bookingId'])
		.index('by_chatSession', ['chatSessionId'])
		.index('by_guestPhone', ['guestPhone']),

	/** Who changed an appointment, when, and the old and new value of each changed field. */
	appointmentChanges: defineTable({
		appointmentId: v.id('serviceAppointments'),
		at: v.number(),
		/** Admin email, or "guest" for chat. */
		actor: v.string(),
		kind: v.union(
			v.literal('rescheduled'),
			v.literal('turnaround'),
			v.literal('details'),
			v.literal('service'),
			v.literal('status'),
			v.literal('cancelled'),
			v.literal('payment'),
			v.literal('rebooked')
		),
		reason: v.optional(v.string()),
		currencyBefore: v.string(),
		currencyAfter: v.string(),
		changes: v.array(v.object({
			field: v.string(),
			from: v.union(v.string(), v.number(), v.null()),
			to: v.union(v.string(), v.number(), v.null())
		}))
	}).index('by_appointmentId_and_at', ['appointmentId', 'at']),

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
		.index('by_property_date', ['propertyId', 'date'])
		.index('by_rating', ['rating']),

	socialProof: defineTable({
		propertyId: v.id('properties'),
		overallRating: v.number(),
		totalReviews: v.number(),
		// Derived from real reviews by lib/socialProof.ts; the two fields below only exist on legacy seeded rows.
		isSuperhost: v.optional(v.boolean()),
		breakdown: v.optional(
			v.object({
				cleanliness: v.number(),
				accuracy: v.number(),
				communication: v.number(),
				location: v.number(),
				checkIn: v.number(),
				value: v.number()
			})
		)
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
		.index('by_email_and_source_and_propertyId', ['email', 'source', 'propertyId'])
		.index('by_property', ['propertyId'])
		.index('by_source', ['source']),

	rateLimits: defineTable({
		key: v.string(),
		count: v.number(),
		expiresAt: v.number(),
		// Staff alerts keep at most 30 timestamps for a rolling one-hour cap.
		timestamps: v.optional(v.array(v.number()))
	}).index('by_key', ['key']).index('by_expiresAt', ['expiresAt']),

	// Legacy seeded OTA fee estimates; no longer read (see otaRates). Kept so existing deployments with rows still validate.
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

	// Owner-entered OTA nightly rates for the guest "book direct vs OTA" comparison.
	otaRates: defineTable({
		propertyId: v.id('properties'),
		platform: v.union(v.literal('booking_com'), v.literal('agoda'), v.literal('airbnb'), v.literal('expedia')),
		nightlyRate: v.number(),
		url: v.optional(v.string()),
		updatedAt: v.number()
	}).index('by_property_platform', ['propertyId', 'platform']),

	// Phase 2: Availability & iCal sync
	icalSources: defineTable({
		propertyId: v.id('properties'),
		platform: v.string(),
		icalUrl: v.string(),
		lastSyncedAt: v.optional(v.number()),
		lastSyncError: v.optional(v.string()),
		// Set when an admin removes the feed; its nights are deleted in batches, then the row itself.
		deletingAt: v.optional(v.number()),
		// Bumped by each applied sync and URL change, so a stale background prune stops.
		syncGeneration: v.optional(v.number()),
		// Bumped when a sync starts (before its fetch), on URL change and on removal. Only the sync
		// holding the current ticket may apply its result or record its error.
		syncTicket: v.optional(v.number())
	}).index('by_property', ['propertyId']),

	// Host date blocks (owner stay, maintenance); each night is mirrored as an availability row.
	dateBlocks: defineTable({
		propertyId: v.id('properties'),
		start: v.string(),
		end: v.string(),
		reason: v.string(),
		createdAt: v.number()
	})
		.index('by_property_start', ['propertyId', 'start'])
		// With by_property_start, lets the calendar find every block overlapping a range (see stayOverlap.ts).
		.index('by_propertyId_and_end', ['propertyId', 'end']),

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
		bookingId: v.optional(v.id('bookings')),
		icalSourceId: v.optional(v.id('icalSources')),
		dateBlockId: v.optional(v.id('dateBlocks'))
	})
		.index('by_property', ['propertyId'])
		.index('by_icalSourceId', ['icalSourceId'])
		.index('by_dateBlockId', ['dateBlockId'])
		.index('by_property_date', ['propertyId', 'date']),

	// Phase 3: AI Chat
	chatSessions: defineTable({
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		channel: v.union(
			v.literal('web'),
			v.literal('whatsapp'),
			v.literal('line'),
			v.literal('facebook'),
			v.literal('instagram')
		),
		visitorId: v.optional(v.string()),
		visitorName: v.optional(v.string()),
		visitorEmail: v.optional(v.string()),
		visitorPhone: v.optional(v.string()),
		visitorContactApp: v.optional(
			v.union(
				v.literal('whatsapp'),
				v.literal('line'),
				v.literal('facebook'),
				v.literal('instagram')
			)
		),
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
		lastStaffAlertAt: v.optional(v.number()),
		lastOpenedAt: v.optional(v.number()),
		lastClosedAt: v.optional(v.number()),
		messageCount: v.optional(v.number()),
		latestMessageAt: v.optional(v.number()),
		adminSortAt: v.optional(v.number()),
		adminSearchText: v.optional(v.string()),
		// Guest message an admin marked as settled; clears the unanswered warning.
		settledGuestMessageId: v.optional(v.id('chatMessages')),
		// Inbox lifecycle set by admins; undefined = open. A new guest message reopens it.
		adminStatus: v.optional(
			v.union(v.literal('open'), v.literal('resolved'), v.literal('archived'))
		),
		resolvedAt: v.optional(v.number()),
		archivedAt: v.optional(v.number()),
		// Staff took over: no AI/automatic replies on any channel until resumed.
		aiPaused: v.optional(v.boolean()),
		assignedAdminEmail: v.optional(v.string()),
		// AI booking flow: last time the guest was in a booking conversation,
		// and the quote awaiting their "yes" (bookingId is set once confirmed).
		bookingFlowAt: v.optional(v.number()),
		pendingBookingQuote: v.optional(
			v.object({
				propertySlug: v.string(),
				checkIn: v.string(),
				checkOut: v.string(),
				guests: v.number(),
				guestName: v.string(),
				guestPhone: v.string(),
				nights: v.number(),
				total: v.number(),
				currency: v.string(),
				createdAt: v.number(),
				bookingId: v.optional(v.id('bookings'))
			})
		),
		pendingServiceQuote: v.optional(v.object({
			serviceSlug: v.string(),
			serviceName: v.string(),
			durationMin: v.optional(v.number()),
			staffId: v.optional(v.id('staff')),
			start: v.number(),
			guestName: v.string(),
			guestPhone: v.string(),
			price: v.number(),
			currency: v.string(),
			createdAt: v.number(),
			appointmentId: v.optional(v.id('serviceAppointments'))
		})),
		pendingServiceCancellation: v.optional(v.object({
			appointmentId: v.id('serviceAppointments'),
			expectedRevision: v.optional(v.number()),
			createdAt: v.number()
		})),
		// Cancellation the guest was asked to confirm; executed on a later turn.
		pendingCancellation: v.optional(
			v.object({
				bookingId: v.id('bookings'),
				createdAt: v.number()
			})
		),
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
		.index('by_visitor', ['visitorId'])
		.index('by_adminSortAt', ['adminSortAt'])
		.index('by_latestMessageAt', ['latestMessageAt'])
		.index('by_messageCount_and_adminSortAt', ['messageCount', 'adminSortAt'])
		.index('by_propertyId_and_adminSortAt', ['propertyId', 'adminSortAt'])
		.index('by_propertyId_and_latestMessageAt', ['propertyId', 'latestMessageAt'])
		// Filtered admin inbox: resolved/archived chats and one channel's chats are sparse in by_latestMessageAt.
		.index('by_adminStatus_and_latestMessageAt', ['adminStatus', 'latestMessageAt'])
		.index('by_channel_and_latestMessageAt', ['channel', 'latestMessageAt'])
		.searchIndex('search_adminSearchText', {
			searchField: 'adminSearchText'
		}),

	chatMessages: defineTable({
		sessionId: v.id('chatSessions'),
		role: v.union(v.literal('user'), v.literal('assistant')),
		source: v.optional(v.literal('admin')),
		content: v.string(),
		action: v.optional(v.union(v.literal('booking'), v.literal('tour'), v.literal('none'))),
		timestamp: v.number()
	})
		.index('by_session', ['sessionId', 'timestamp'])
		.searchIndex('search_content', {
			searchField: 'content',
			filterFields: ['sessionId']
		}),

	adminReplyAttempts: defineTable({
		requestId: v.string(),
		sessionId: v.id('chatSessions'),
		adminEmail: v.string(),
		content: v.string(),
		status: v.union(v.literal('pending'), v.literal('sent'), v.literal('failed')),
		createdAt: v.number(),
		completedAt: v.optional(v.number()),
		error: v.optional(v.string())
	})
		.index('by_requestId', ['requestId'])
		.index('by_sessionId', ['sessionId']),

	chatBrowserHandoffs: defineTable({
		token: v.string(),
		sessionId: v.id('chatSessions'),
		expiresAt: v.number(),
		claimedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_token', ['token'])
		.index('by_expires_at', ['expiresAt'])
		.index('by_sessionId', ['sessionId']),

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
				v.literal('approved_exact'),
				v.literal('question_bank_exact'),
				v.literal('question_bank_semantic'),
				v.literal('ai'),
				v.literal('unknown_fallback'),
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

	facebookWebhookEvents: defineTable({
		eventKey: v.string(),
		sessionId: v.optional(v.id('chatSessions')),
		facebookUserId: v.optional(v.string()),
		pageId: v.optional(v.string()),
		eventType: v.union(
			v.literal('message'),
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
				v.literal('approved_exact'),
				v.literal('question_bank_exact'),
				v.literal('question_bank_semantic'),
				v.literal('ai'),
				v.literal('unknown_fallback'),
				v.literal('postback'),
				v.literal('ignored'),
				v.literal('failed')
			)
		),
		facebookReplyStatus: v.optional(v.number()),
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

	instagramWebhookEvents: defineTable({
		eventKey: v.string(),
		sessionId: v.optional(v.id('chatSessions')),
		instagramUserId: v.optional(v.string()),
		instagramAccountId: v.optional(v.string()),
		eventType: v.union(
			v.literal('message'),
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
				v.literal('approved_exact'),
				v.literal('question_bank_exact'),
				v.literal('question_bank_semantic'),
				v.literal('ai'),
				v.literal('unknown_fallback'),
				v.literal('postback'),
				v.literal('ignored'),
				v.literal('failed')
			)
		),
		instagramReplyStatus: v.optional(v.number()),
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

	whatsappWebhookEvents: defineTable({
		eventKey: v.string(),
		sessionId: v.optional(v.id('chatSessions')),
		whatsappUserId: v.optional(v.string()),
		phoneNumberId: v.optional(v.string()),
		eventType: v.union(v.literal('message'), v.literal('unsupported')),
		messageText: v.optional(v.string()),
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
				v.literal('approved_exact'),
				v.literal('question_bank_exact'),
				v.literal('question_bank_semantic'),
				v.literal('ai'),
				v.literal('unknown_fallback'),
				v.literal('ignored'),
				v.literal('failed')
			)
		),
		whatsappReplyStatus: v.optional(v.number()),
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

	chatStaticSuggestionInteractions: defineTable({
		sessionId: v.id('chatSessions'),
		suggestionKey: v.string(),
		shownAt: v.optional(v.number()),
		clickedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_suggestionKey', ['sessionId', 'suggestionKey']),

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
		.index('by_propertySlug_and_normalizedQuestion', ['propertySlug', 'normalizedQuestion'])
		.index('by_status_and_propertySlug_and_score', ['status', 'propertySlug', 'score']),

	// Exact-match lookup rows for curatedChatQuestions: one per normalized question text and
	// translation. Written by every curated writer; migrations:backfillCuratedQuestionVariants fills old rows.
	curatedChatQuestionVariants: defineTable({
		questionId: v.id('curatedChatQuestions'),
		normalizedVariant: v.string(),
		propertySlug: v.optional(v.string())
	})
		.index('by_questionId', ['questionId'])
		.index('by_normalizedVariant_and_propertySlug', ['normalizedVariant', 'propertySlug']),

	chatQuestionInteractions: defineTable({
		sessionId: v.id('chatSessions'),
		questionId: v.id('curatedChatQuestions'),
		shownAt: v.optional(v.number()),
		clickedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_question', ['sessionId', 'questionId'])
		.index('by_questionId', ['questionId']),

	chatAnswers: defineTable({
		propertyId: v.optional(v.id('properties')),
		title: v.string(),
		answer: v.string(),
		status: v.union(v.literal('draft'), v.literal('approved'), v.literal('archived')),
		createdAt: v.number(),
		updatedAt: v.number(),
		archivedAt: v.optional(v.number()),
		createdByAdminEmail: v.string(),
		updatedByAdminEmail: v.string(),
		archivedByAdminEmail: v.optional(v.string())
	})
		.index('by_createdAt', ['createdAt'])
		.index('by_status_and_updatedAt', ['status', 'updatedAt'])
		.index('by_propertyId_and_status_and_updatedAt', ['propertyId', 'status', 'updatedAt'])
		.searchIndex('search_title', { searchField: 'title', filterFields: ['status'] })
		.searchIndex('search_answer', { searchField: 'answer', filterFields: ['status'] }),

	chatQuestions: defineTable({
		propertyId: v.optional(v.id('properties')),
		answerId: v.id('chatAnswers'),
		questionText: v.string(),
		normalizedQuestion: v.string(),
		isPrimary: v.boolean(),
		isAiTrigger: v.boolean(),
		createdBy: v.union(v.literal('admin'), v.literal('ai')),
		status: v.union(v.literal('approved'), v.literal('suggested'), v.literal('rejected')),
		createdAt: v.number(),
		updatedAt: v.number(),
		approvedAt: v.optional(v.number()),
		rejectedAt: v.optional(v.number()),
		createdByAdminEmail: v.optional(v.string()),
		updatedByAdminEmail: v.optional(v.string())
	})
		.index('by_answerId', ['answerId'])
		.index('by_propertyId', ['propertyId'])
		.index('by_answerId_and_normalizedQuestion', ['answerId', 'normalizedQuestion'])
		.index('by_answerId_and_status', ['answerId', 'status'])
		.index('by_answerId_and_status_and_isPrimary', ['answerId', 'status', 'isPrimary'])
		.index('by_status_and_createdAt', ['status', 'createdAt'])
		.index('by_status_and_normalizedQuestion', ['status', 'normalizedQuestion'])
		.index('by_status_and_normalizedQuestion_and_propertyId', [
			'status',
			'normalizedQuestion',
			'propertyId'
		]),

	chatKnowledgeScopes: defineTable({
		slug: v.string(),
		normalizedSlug: v.string(),
		label: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
		createdByAdminEmail: v.string(),
		updatedByAdminEmail: v.string()
	})
		.index('by_normalizedSlug', ['normalizedSlug'])
		.index('by_createdAt', ['createdAt']),

	chatAnswerPropertyScopes: defineTable({
		propertyId: v.optional(v.id('properties')),
		answerId: v.id('chatAnswers'),
		propertySlug: v.string(),
		normalizedSlug: v.string(),
		source: v.union(v.literal('property'), v.literal('custom')),
		createdAt: v.number(),
		updatedAt: v.number(),
		createdByAdminEmail: v.string(),
		updatedByAdminEmail: v.string()
	})
		.index('by_answerId', ['answerId'])
		.index('by_propertyId', ['propertyId'])
		.index('by_normalizedSlug', ['normalizedSlug'])
		.index('by_propertySlug', ['propertySlug'])
		.index('by_propertySlug_and_answerId', ['propertySlug', 'answerId']),

	chatTopics: defineTable({
		propertyId: v.optional(v.id('properties')),
		name: v.string(),
		normalizedName: v.string(),
		description: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_propertyId', ['propertyId'])
		.index('by_propertyId_and_normalizedName', ['propertyId', 'normalizedName'])
		.index('by_normalizedName', ['normalizedName']),

	chatAnswerTopics: defineTable({
		propertyId: v.optional(v.id('properties')),
		answerId: v.id('chatAnswers'),
		topicId: v.id('chatTopics'),
		createdAt: v.number()
	})
		.index('by_answerId', ['answerId'])
		.index('by_topicId', ['topicId'])
		.index('by_propertyId', ['propertyId']),

	// Owner-maintained evidence, independent from the retired question/answer bank.
	businessFacts: defineTable({
		title: v.string(), body: v.string(), searchText: v.string(), source: v.string(),
		propertyId: v.optional(v.id('properties')),
		status: v.union(v.literal('draft'), v.literal('approved'), v.literal('archived')),
		revision: v.number(), createdAt: v.number(), updatedAt: v.number(),
		createdByAdminEmail: v.string(), updatedByAdminEmail: v.string()
	})
		.index('by_status_and_updatedAt', ['status', 'updatedAt'])
		.searchIndex('search_text', { searchField: 'searchText', filterFields: ['status', 'propertyId'] }),

	chatUnknownQuestions: defineTable({
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		sessionId: v.optional(v.id('chatSessions')),
		userQuestion: v.string(),
		normalizedQuestion: v.string(),
		detectedTopic: v.optional(v.string()),
		userId: v.optional(v.string()),
		pageUrl: v.optional(v.string()),
		status: v.union(v.literal('new'), v.literal('resolved'), v.literal('ignored')),
		adminNotified: v.boolean(),
		resolvedFactId: v.optional(v.id('businessFacts')),
		resolvedSource: v.optional(
			v.union(
				v.literal('settings'),
				v.literal('property_details'),
				v.literal('services'),
				v.literal('pricing_availability')
			)
		),
		resolvedAnswerId: v.optional(v.id('chatAnswers')),
		resolvedQuestionId: v.optional(v.id('chatQuestions')),
		createdAt: v.number(),
		updatedAt: v.number(),
		resolvedAt: v.optional(v.number()),
		ignoredAt: v.optional(v.number())
	})
		.index('by_createdAt', ['createdAt'])
		.index('by_status_and_createdAt', ['status', 'createdAt'])
		.index('by_status_and_normalizedQuestion', ['status', 'normalizedQuestion'])
		.index('by_propertySlug', ['propertySlug'])
		.index('by_propertyId_and_status_and_createdAt', ['propertyId', 'status', 'createdAt'])
		.index('by_sessionId_and_normalizedQuestion', ['sessionId', 'normalizedQuestion'])
		.index('by_sessionId', ['sessionId'])
		.index('by_resolvedAnswerId', ['resolvedAnswerId'])
		.index('by_resolvedQuestionId', ['resolvedQuestionId'])
		.searchIndex('search_userQuestion', { searchField: 'userQuestion', filterFields: ['status'] }),

	// Admin-editable business profile; a single row with key 'default'. Missing fields fall back to lib/siteSettings defaults.
	siteSettings: defineTable({
		key: v.literal('default'),
		businessName: v.optional(v.string()),
		tagline: v.optional(v.string()),
		contactEmail: v.optional(v.string()),
		contactPhone: v.optional(v.string()),
		whatsapp: v.optional(v.string()),
		lineId: v.optional(v.string()),
		lineUrl: v.optional(v.string()),
		address: v.optional(v.string()),
		currency: v.optional(v.string()),
		timezone: v.optional(v.string()),
		checkInTime: v.optional(v.string()),
		checkOutTime: v.optional(v.string()),
		cancellationPolicy: v.optional(v.string()),
		ai: v.optional(
			v.object({
				tone: v.optional(v.string()),
				extraInstructions: v.optional(v.string()),
				maxWords: v.optional(v.number())
			})
		),
		email: v.optional(
			v.object({
				fromName: v.optional(v.string()),
				ownerNotificationEmail: v.optional(v.string()),
				footer: v.optional(v.string())
			})
		),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_key', ['key']),

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
