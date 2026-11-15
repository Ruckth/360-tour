import { messagesFields, channelEventsFields, messageDocument, channelEventDocument } from './validators';
import { chatCouponValidator } from '../bookings/model';
import { defineTable } from 'convex/server';
import { inboxReasonValidator } from '../shared/inboxTypes';
import { v } from 'convex/values';
import { marketingCaptureValidator } from '../shared/marketingAttribution';

// Owned by messaging; assembled only by convex/schema.ts.
export const messagingTables = {

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


	// Phase 3: AI Chat
	conversations: defineTable({
        inboxProjectionVersion: v.optional(v.literal(1)),
        lastActivityAt: v.optional(v.number()),
        lastMessagePreview: v.optional(v.union(v.null(), messageDocument)),
        lastDeliveryStatus: v.optional(v.union(v.null(), channelEventDocument)),
		guestTokenHash: v.optional(v.string()),
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
		/** Release 3a: web chat only. The untrusted capture sent at createSession; resolved when the chat books. */
		marketingCapture: v.optional(marketingCaptureValidator),
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
		settledGuestMessageId: v.optional(v.id('messages')),

		latestGuestMessageId: v.optional(v.id('messages')),
		answeredGuestMessageId: v.optional(v.id('messages')),
		inboxState: v.optional(v.union(v.literal('needs_staff'), v.literal('processing'), v.literal('done'))),
		inboxReason: v.optional(inboxReasonValidator),
		inboxHandoff: v.optional(v.boolean()),
		staffTask: v.optional(v.string()),
		keepWithStaff: v.optional(v.boolean()),
		inboxSendRequestId: v.optional(v.string()),
		inboxSendError: v.optional(v.string()),
		resolutionSource: v.optional(v.union(v.literal('ai'), v.literal('staff'), v.literal('manual'))),
		resolutionMessageId: v.optional(v.id('messages')),
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
				subtotal: v.optional(v.number()),
				discountAmount: v.optional(v.number()),
				coupon: v.optional(chatCouponValidator),
				currency: v.string(),
				createdAt: v.number(),
				confirmSecret: v.optional(v.string()),
				proposalId: v.optional(v.string()),
				expiresAt: v.optional(v.number()),
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
			appointmentId: v.optional(v.id('appointments'))
		})),
		pendingServiceCancellation: v.optional(v.object({
			appointmentId: v.id('appointments'),
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
		createdAt: v.number()
	})
		.index('by_property', ['propertyId'])
		.index('by_last_seen', ['lastSeenAt'])
		.index('by_property_last_seen', ['propertyId', 'lastSeenAt'])
		.index('by_visitor', ['visitorId'])
		.index('by_adminSortAt', ['adminSortAt'])
        .index('by_inboxState_and_lastActivityAt', ['inboxState', 'lastActivityAt'])
        .index('by_inboxProjectionVersion', ['inboxProjectionVersion'])
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


	messages: defineTable(messagesFields)
		.index('by_sessionId_and_role', ['sessionId', 'role'])
    .index('by_session', ['sessionId', 'timestamp'])
		.searchIndex('search_content', {
			searchField: 'content',
			filterFields: ['sessionId']
		}),


	adminReplyAttempts: defineTable({
		requestId: v.string(),
		sessionId: v.id('conversations'),
		adminEmail: v.string(),
		replyToMessageId: v.optional(v.id('messages')),
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
		sessionId: v.id('conversations'),
		expiresAt: v.number(),
		claimedAt: v.optional(v.number()),
		createdAt: v.number()
	})
		.index('by_token', ['token'])
		.index('by_expires_at', ['expiresAt'])
		.index('by_sessionId', ['sessionId']),


	channelEvents: defineTable(channelEventsFields)
		.index('by_sessionId_and_status_and_createdAt', ['sessionId', 'status', 'createdAt'])
    .index('by_status_and_leaseExpiresAt', ['status', 'leaseExpiresAt'])
    .index('by_status_and_nextAttemptAt', ['status', 'nextAttemptAt'])
    .index('by_channel_and_eventKey', ['channel', 'eventKey'])
 .index('by_channel_and_createdAt', ['channel', 'createdAt'])
		.index('by_channel_and_sessionId', ['channel', 'sessionId'])
		.index('by_channel_and_status_and_createdAt', ['channel', 'status', 'createdAt']),


	chatStaticSuggestionInteractions: defineTable({
		sessionId: v.id('conversations'),
		suggestionKey: v.string(),
		shownAt: v.optional(v.number()),
		clickedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_session', ['sessionId'])
		.index('by_session_and_suggestionKey', ['sessionId', 'suggestionKey'])
};
