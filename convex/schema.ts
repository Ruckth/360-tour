import { staffRole, cashierRulesFields, storedApprovalPayload, approvalStatus } from './lib/staffTypes';
import { affiliateState, creditState, affiliateSnapshot, marketingRole } from './lib/affiliateTypes';
import { chatCouponValidator } from './lib/chatCoupon';
import { defineSchema, defineTable } from 'convex/server';
import { inboxReasonValidator } from './lib/inboxTypes';
import { v } from 'convex/values';
import { bookingRulesValidator } from './lib/siteSettings';
import {
	bookingPriceOverride,
	correctedTender,
	receiptCustomer,
	stayPaymentOrigin,
	storedPaymentMethod,
	storedRefundMethod
} from './lib/financeValidators';
import { posCouponProblemValidator } from './lib/posCoupons';
import { marketingAttributionValidator, marketingCaptureValidator } from './lib/marketingAttribution';
import { couponRefusalProblemValidator, couponRefusalSurfaceValidator } from './lib/marketingReport';

export default defineSchema({
 staffGrants: defineTable({
  email: v.string(), role: staffRole, tokenIdentifier: v.optional(v.string()), revision: v.optional(v.number()),
  inviteExpiresAt: v.optional(v.number()), createdAt: v.number(), updatedAt: v.number(), updatedByEmail: v.string()
 }).index('by_email', ['email']).index('by_tokenIdentifier', ['tokenIdentifier']),
 cashierRules: defineTable({ key: v.literal('default'), ...cashierRulesFields, revision: v.number(), updatedAt: v.number(), updatedByEmail: v.string() }).index('by_key', ['key']),
 staffApprovalRequests: defineTable({
  orderId: v.id('orders'), lineId: v.optional(v.id('orderLines')), kind: v.union(v.literal('discount'), v.literal('customPrice'), v.literal('voidPaidSale'), v.literal('paymentFix'), v.literal('refund')),
  payload: storedApprovalPayload, reason: v.string(), requesterEmail: v.string(), requesterTokenIdentifier: v.string(),
  requesterAccessFingerprint: v.string(), orderFingerprint: v.string(), orderRevision: v.number(), rulesRevision: v.number(), rulesFingerprint: v.optional(v.string()),
  status: approvalStatus, createdAt: v.number(), expiresAt: v.number(), resolvedAt: v.optional(v.number()),
  approverEmail: v.optional(v.string()), approverTokenIdentifier: v.optional(v.string()), resolutionReason: v.optional(v.string()),
  totalBefore: v.number(), totalAfter: v.number(), amount: v.number(), percent: v.optional(v.number())
 }).index('by_orderId_and_status', ['orderId', 'status']).index('by_orderId_and_createdAt', ['orderId', 'createdAt']).index('by_status_and_createdAt', ['status', 'createdAt']),
 appointmentFeeAttempts: defineTable({
  key: v.string(), actor: v.string(), fingerprint: v.string(), orderId: v.id('orders'), lineId: v.id('orderLines')
 }).index('by_key', ['key']),
 bookingCreateAttempts: defineTable({
  key: v.string(), actor: v.string(), bookingId: v.id('bookings'), fingerprint: v.string(), recordedAt: v.number()
 }).index('by_key', ['key']),
 recordChanges: defineTable({
  entityType: v.string(), entityId: v.string(), recordedAt: v.number(),
  effectiveAt: v.number(), actor: v.string(), kind: v.string(),
  reason: v.optional(v.string()), before: v.optional(v.any()), after: v.optional(v.any())
 }).index('by_entityType_and_entityId_and_recordedAt', ['entityType', 'entityId', 'recordedAt'])
   .index('by_entityType_and_recordedAt', ['entityType', 'recordedAt']),
	users: defineTable({
		clerkId: v.string(),
		tokenIdentifier: v.string(),
		email: v.string(),
		name: v.optional(v.string()),
		imageUrl: v.optional(v.string())
	})
		.index('by_token', ['tokenIdentifier'])
		.index('by_clerk_id', ['clerkId']),

	properties: defineTable({
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
		.index('by_status', ['status']),

	tourScenes: defineTable({
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
		guestName: v.string(),
		guestEmail: v.optional(v.string()),
		guestPhone: v.string(),
		// Exact-lookup forms of the guest's phone (digits only) and email (trimmed, lower case).

		guestPhoneDigits: v.string(),
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
		chatSessionId: v.optional(v.id('conversations')),
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
		// Gross: every payment received, before refunds (see lib/orderMath bookingBalance).
		amountPaid: v.number(),

		amountRefunded: v.number(),
		/** Provider returns waived from collection; parent orderMath must subtract this from owed. */
		providerRefundWaived: v.optional(v.number()),
		/** When the stay became fully refunded (business date for recorded refunds). */
		refundedAt: v.optional(v.number()),
		/** A custom price set by staff instead of the villa rate; `total` follows it. */
		priceOverride: v.optional(bookingPriceOverride),
		// Release 2: the coupon this stay was priced with (frozen version and amount).
		promotion: v.optional(v.object({
			couponId: v.id('coupons'),
			couponVersion: v.number(),
			code: v.string(),
			discount: v.number(),
			redemptionId: v.id('couponRedemptions')
		})),
		/** Release 3a: which marketing link brought a web or web-chat booking. Set once at creation; never on admin bookings. */
		marketingAttribution: v.optional(marketingAttributionValidator),
		affiliateSnapshot: v.optional(affiliateSnapshot),
		/** Bumped on every staff/system write that goes through lib/bookingMoney; absent = 0. */
		revision: v.optional(v.number()),

		createdBy: v.optional(v.string()),
		/** Set for historical entries created without guest notification; lifecycle emails then skip it. */
		guestEmailsOff: v.optional(v.boolean()),
		cancelledAt: v.optional(v.number()),
		cancelledBy: v.optional(v.string()),
		cancelReason: v.optional(v.string()),
		paymentMethod: v.optional(v.string()),
		confirmationCode: v.optional(v.string()),
		invoiceNumber: v.optional(v.string()),
		receiptNumber: v.optional(v.string()),
		accessToken: v.optional(v.string()),
		stripeCheckoutAmount: v.optional(v.number()),
		stripeCheckoutSessionId: v.optional(v.string()),
		stripePaymentIntentId: v.optional(v.string()),
		/**
		 * The Stripe payment taken before payments were itemised, captured (with the stay's gross at
		 * the time) when its first itemised payment is written. Provider refunds and completion
		 * redeliveries for it must still match this amount exactly; nothing is inferred from it.
		 */
		stripeCheckoutUrl: v.optional(v.string()),
		stripeCheckoutExpiresAt: v.optional(v.number()),

		unpaidHoldExpiresAt: v.optional(v.number()),
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
		.index('by_status', ['status'])
		.index('by_status_createdAt', ['status', 'createdAt'])
		.index('by_createdAt', ['createdAt'])
		.index('by_marketingAttribution_session_startedAt_and_sessionId', ['marketingAttribution.session.startedAt', 'marketingAttribution.sessionId'])
		.index('by_paidAt', ['paidAt'])
		.index('by_refundedAt', ['refundedAt'])
		.index('by_status_checkIn', ['status', 'checkIn'])
		.index('by_status_checkOut', ['status', 'checkOut'])
		.index('by_stripePaymentIntentId', ['stripePaymentIntentId'])
		.index('by_chatSession', ['chatSessionId'])
		.index('by_guestPhone', ['guestPhone'])
		.index('by_guestPhoneDigits', ['guestPhoneDigits'])
		.index('by_guestEmailNormalized', ['guestEmailNormalized'])
		.index('by_confirmationCode', ['confirmationCode'])
		.searchIndex('search_guestName', { searchField: 'guestName' }),

	/**
	 * Money received for a stay, one row per recorded payment (lib/bookingMoney.ts). The booking's
	 * `amountPaid` is the transactional total; these rows say where each part came from. Rows are
	 * never deleted: a mistaken manual entry is marked cancelled, and online money is never changed.
	 * Every new payment has an explicit source row.
	 */
	bookingPayments: defineTable({
		bookingId: v.id('bookings'),
		providerPaymentIntentId: v.optional(v.string()),
		origin: stayPaymentOrigin,
		amount: v.number(),
		currency: v.string(),
		/** Manual: how it was received. POS: `order` (tenders are on the order). Online: the provider. */
		method: storedPaymentMethod,
		/** The order that settled it (POS). */
		orderId: v.optional(v.id('orders')),
		/** Business date the money was received, distinct from when it was recorded. */
		effectiveAt: v.number(),
		recordedAt: v.number(),
		recordedBy: v.string(),
		idempotencyKey: v.optional(v.string()),
		note: v.optional(v.string()),
		/** Sum of refunds recorded against this payment. */
		refunded: v.number(),
		status: v.union(v.literal('recorded'), v.literal('cancelled')),
		cancelledAt: v.optional(v.number()),
		cancelledBy: v.optional(v.string()),
		cancelReason: v.optional(v.string()),
		amendedAt: v.optional(v.number()),
		amendedBy: v.optional(v.string())
	})
		.index('by_bookingId_and_recordedAt', ['bookingId', 'recordedAt'])
		.index('by_orderId', ['orderId'])
		.index('by_providerPaymentIntentId', ['providerPaymentIntentId'])
		.index('by_idempotencyKey', ['idempotencyKey'])
		// Release 3b: the marketing report's cash view reads money by business date.
		.index('by_effectiveAt', ['effectiveAt']),

	/** Refunds recorded on a stay. Recording one moves no money; staff give it back themselves. */
	bookingRefunds: defineTable({
		requestFingerprint: v.optional(v.string()),
		bookingId: v.id('bookings'),
		amount: v.number(),
		currency: v.string(),
		method: storedRefundMethod,
		providerChargeId: v.optional(v.string()),
		providerRefundId: v.optional(v.string()),
		providerEventId: v.optional(v.string()),
		providerCumulative: v.optional(v.number()),
		reason: v.string(),
		/** `credit`: what exceeded the price of a live stay. `cancellation`: money kept on a cancelled stay. */
		context: v.union(v.literal('credit'), v.literal('cancellation')),
		paymentId: v.optional(v.id('bookingPayments')),
		orderId: v.optional(v.id('orders')),
		effectiveAt: v.number(),
		recordedAt: v.number(),
		recordedBy: v.string(),
		idempotencyKey: v.string(),
		netBefore: v.number(),
		netAfter: v.number()
	})
		.index('by_bookingId_and_recordedAt', ['bookingId', 'recordedAt'])
		.index('by_orderId', ['orderId'])
		.index('by_idempotencyKey', ['idempotencyKey'])
		.index('by_providerRefundId', ['providerRefundId'])
		.index('by_recordedAt', ['recordedAt']),

	/** High-water mark of authoritative charge.refunded snapshots, in minor units. */
	stripeRefundCharges: defineTable({
		bookingId: v.id('bookings'), chargeId: v.string(), paymentIntentId: v.string(),
		amount: v.number(), currency: v.string(), cumulative: v.number(), eventId: v.string()
	}).index('by_chargeId', ['chargeId']).index('by_bookingId', ['bookingId']),

	appointmentPayments: defineTable({
		appointmentId: v.id('appointments'), amount: v.number(), currency: v.string(), method: storedPaymentMethod,
		effectiveAt: v.number(), recordedAt: v.number(), recordedBy: v.string(), idempotencyKey: v.string(),
		status: v.union(v.literal('recorded'), v.literal('cancelled')), refunded: v.number(),
		amendedAt: v.optional(v.number()), amendedBy: v.optional(v.string()),
		cancelledAt: v.optional(v.number()), cancelledBy: v.optional(v.string()), cancelReason: v.optional(v.string())
	}).index('by_appointmentId_and_recordedAt', ['appointmentId', 'recordedAt']).index('by_idempotencyKey', ['idempotencyKey'])
		.index('by_effectiveAt', ['effectiveAt']),
	appointmentPaymentCorrections: defineTable({
		appointmentId: v.id('appointments'), paymentId: v.id('appointmentPayments'), idempotencyKey: v.string(),
		requestFingerprint: v.string(), actor: v.string(), recordedAt: v.number(), reason: v.string()
	}).index('by_idempotencyKey', ['idempotencyKey']),
	appointmentRefunds: defineTable({
		appointmentId: v.id('appointments'), amount: v.number(), currency: v.string(), method: storedRefundMethod,
		reason: v.string(), effectiveAt: v.number(), recordedAt: v.number(), recordedBy: v.string(), idempotencyKey: v.string(),
		paymentId: v.optional(v.id('appointmentPayments')), orderId: v.optional(v.id('orders')),
		netBefore: v.number(), netAfter: v.number()
	}).index('by_appointmentId_and_recordedAt', ['appointmentId', 'recordedAt'])
		.index('by_orderId', ['orderId']).index('by_idempotencyKey', ['idempotencyKey'])
		.index('by_recordedAt', ['recordedAt']),
	staff: defineTable({
		name: v.string(),
		/** Retained on archive; restoration validates each surviving service. */
		archivedServiceIds: v.optional(v.array(v.id('services'))),
		role: v.string(),
		avatarUrl: v.optional(v.string()),
		/** Set when `avatarUrl` is a photo uploaded from the staff admin, so replacing or removing it can delete the file. */
		avatarStorageId: v.optional(v.id('_storage')),
		color: v.string(),
		status: v.union(v.literal('active'), v.literal('archived')),
		workingHours: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string() })),
		breaks: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string(), label: v.string() })),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_status', ['status']).index('by_avatarUrl', ['avatarUrl']),

	/** Staff and service photo uploads not yet attached to a record. Attaching removes the row; a cron deletes stale ones. */
	staffAvatarUploads: defineTable({
		storageId: v.id('_storage'),
		createdAt: v.number()
	}).index('by_storageId', ['storageId']).index('by_createdAt', ['createdAt']),

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
		/** Optional photo shown in the admin service picker; `imageStorageId` is set when it was uploaded here. */
		imageUrl: v.optional(v.string()),
		imageStorageId: v.optional(v.id('_storage')),
		status: v.union(v.literal('active'), v.literal('archived')),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_slug', ['slug'])
		.index('by_status', ['status'])
		.index('by_status_and_category', ['status', 'category'])
		.searchIndex('search_name', { searchField: 'name', filterFields: ['status', 'category'] }),

	staffTimeOff: defineTable({
		staffId: v.id('staff'),
		start: v.number(),
		end: v.number(),
		label: v.string(),
		createdByAdminEmail: v.optional(v.string())
	}).index('by_staff_start', ['staffId', 'start']),

	/** Observed/proven weekly defaults. Append-only, independent of the undo buffer. */
	staffPatternVersions: defineTable({
		staffId: v.id('staff'),
		effectiveFrom: v.string(),
		recordedAt: v.number(),
		actor: v.string(),
		provenance: v.union(v.literal('created'), v.literal('observed'), v.literal('change')),
		workingHours: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string() })),
		breaks: v.array(v.object({ weekday: v.number(), start: v.string(), end: v.string(), label: v.string() }))
	}).index('by_staffId_and_effectiveFrom', ['staffId', 'effectiveFrom']),
	configurationHistoryIndex: defineTable({
		entityType: v.union(v.literal('property'), v.literal('room')),
		entityId: v.string(),
		propertyId: v.id('properties'),
		name: v.string(),
		slug: v.string(),
		deleted: v.boolean(),
		updatedAt: v.number()
	})
		.index('by_entityType_and_entityId', ['entityType', 'entityId'])
		.index('by_propertyId_and_entityType', ['propertyId', 'entityType'])
		.index('by_entityType_and_deleted', ['entityType', 'deleted']),

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
		undoByAdminEmail: v.optional(v.string()),
		patternVersionIds: v.optional(v.array(v.object({ staffId: v.id('staff'), versionId: v.id('staffPatternVersions') }))),
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

	appointments: defineTable({
		serviceId: v.id('services'),
		staffId: v.id('staff'),

		amountPaid: v.number(),
		amountRefunded: v.number(),
		financialRevision: v.optional(v.number()),
		serviceNameSnapshot: v.string(),
		staffNameSnapshot: v.string(),
		createdBy: v.optional(v.string()),
		paidAt: v.optional(v.number()),
		paidBy: v.optional(v.string()),
		start: v.number(),
		end: v.number(),
		blockedUntil: v.number(),
		guestName: v.string(),
		guestPhone: v.string(),
		guestEmail: v.optional(v.string()),
		// Exact-lookup forms of the guest's phone (digits only, '' when it has none) and email
		// (trimmed, lower case), written with every appointment (lib/serviceSlots.ts
		// appointmentLookupFields). Missing guestPhoneDigits means a row saved before these fields;

		guestPhoneDigits: v.string(),
		guestEmailNormalized: v.optional(v.string()),
		bookingId: v.optional(v.id('bookings')),
		chatSessionId: v.optional(v.id('conversations')),
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
		rebookedFromId: v.optional(v.id('appointments'))
	})
		.index('by_staff_start', ['staffId', 'start'])
		.index('by_service_start', ['serviceId', 'start'])
		.index('by_start', ['start'])
		.index('by_booking', ['bookingId'])
		.index('by_chatSession', ['chatSessionId'])
		.index('by_guestPhone', ['guestPhone'])
		// Checkout's "Add booking" finds unpaid appointments by the guest's phone digits or email.

		.index('by_guestPhoneDigits_and_paymentStatus', ['guestPhoneDigits', 'paymentStatus'])
		.index('by_guestEmailNormalized_and_paymentStatus', ['guestEmailNormalized', 'paymentStatus'])
		// Checkout's "Add booking" search finds appointments by their reference too.
		.index('by_confirmationCode', ['confirmationCode'])
		// Checkout's attach search finds guests who booked only an appointment.
		.searchIndex('search_guestName', { searchField: 'guestName' }),

	/** Who changed an appointment, when, and the old and new value of each changed field. */
	appointmentChanges: defineTable({
		appointmentId: v.id('appointments'),
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
	}).index('by_appointmentId_and_at', ['appointmentId', 'at'])
		.index('by_kind_and_at', ['kind', 'at']),

	/**
	 * An order (convex/pos.ts): the persistent commercial record with a permanent order number,
	 * its items, payments and receipt. The table keeps its original name so existing ids, payments
	 * and audit rows stay valid. An order may link to a booking or appointment and, separately,
	 * to a reusable customer; it may also have neither.
	 */
	orders: defineTable({

		status: v.union(v.literal('draft'), v.literal('paid'), v.literal('void'), v.literal('discarded')),

		orderNumber: v.number(),


		/** The reusable customer (payer) this order is for, if any. Not the booking's guest. */
		customerId: v.optional(v.id('customers')),
		/** The stay this order belongs to. Its checkout reuses the open order rather than starting another. */
		bookingId: v.optional(v.id('bookings')),
		/** The standalone appointment (not part of a stay) this order belongs to. */
		appointmentId: v.optional(v.id('appointments')),

		implicitSourceLink: v.optional(v.boolean()),
		/** For a later charge on a booking whose earlier order was already paid: that earlier order. */
		parentOrderId: v.optional(v.id('orders')),
		/** Who the receipt was issued to, frozen when the order is paid so later profile edits don't rewrite it. */
		customerSnapshot: v.optional(v.object({ name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()) })),
		currency: v.string(),
		// Kept in step with the lines so the orders list needs no line reads.
		itemCount: v.number(),
		total: v.number(),

		due: v.number(),
		/** itemCount > 0, indexed so empty orders (e.g. one created with a booking) stay out of the orders list. */
		hasItems: v.boolean(),
		/** Bumped on every change to the lines or customer; settleOrder refuses a payment reviewed on an older one. */
		revision: v.number(),
		/** Sequential, issued once when paid and never reused (also not after a void). */
		receiptNumber: v.optional(v.number()),
		/** Idempotency key of the payment attempt that settled the bill. */
		settleKey: v.optional(v.string()),
		paidAt: v.optional(v.number()),
		paidBy: v.optional(v.string()),
		voidedAt: v.optional(v.number()),
		voidedBy: v.optional(v.string()),
		voidReason: v.optional(v.string()),
		/** Set when the void said no money was ever received, so the charged sources were reopened. */
		voidUnreceived: v.optional(v.boolean()),
		/** Business date the payment was received; `paidAt` stays the receipt's issue time. Absent = paidAt. */
		paymentEffectiveAt: v.optional(v.number()),
		/** The linked customer's revision when the receipt was issued. */
		customerRevisionAtPayment: v.optional(v.number()),
		/** Bumped by every orderCorrections row; corrections send the revision they reviewed. Absent = 0. */
		correctionRevision: v.optional(v.number()),
		/** Corrected tenders (same total). The original orderPayments rows are never changed. */
		amendedTenders: v.optional(v.array(correctedTender)),
		/** Corrected payer; null = no named customer. `customerSnapshot` stays what the receipt was issued with. */
		amendedCustomer: v.optional(v.union(v.null(), receiptCustomer)),
		/** Set while discarded (pos.discardOrder); cleared on restore. recordChanges keeps every discard and restore. */
		discardedAt: v.optional(v.number()),
		discardedBy: v.optional(v.string()),
		discardReason: v.optional(v.string()),
		/** Attempt key of the latest discard or restore, so a retried request returns the first result. */
		lifecycleKey: v.optional(v.string()),
		/**
		 * Marketing release 2b: the order's one coupon (pos.applyOrderCoupon). Its version is frozen when
		 * applied; the rows carry the split (orderLines.couponDiscount). Nothing is held while unpaid:
		 * settleOrder re-checks it and writes a consumed couponRedemptions row in the same transaction.
		 */
		promotion: v.optional(v.object({
			couponId: v.id('coupons'),
			couponVersion: v.number(),
			code: v.string(),
			/** Sum of the rows' couponDiscount; 0 while `problem` is set. */
			discount: v.number(),
			/** Why the coupon no longer fits the order as it stands; settle refuses while set. */
			problem: v.optional(posCouponProblemValidator),
			/** Set when the order is paid. */
			redemptionId: v.optional(v.id('couponRedemptions')),
			appliedAt: v.number(),
			appliedBy: v.string(),
			/** Release 3a: set when staff applied the coupon by scanning or pasting a marketing link. Coupon origin only. */
			viaLinkId: v.optional(v.id('marketingLinks'))
		})),
		affiliateSnapshot: v.optional(affiliateSnapshot),
		createdBy: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		// The orders list: orders with items by status, newest change first. Status is a range so

		.index('by_hasItems_and_status_and_updatedAt', ['hasItems', 'status', 'updatedAt'])
		.index('by_orderNumber', ['orderNumber'])
		.index('by_bookingId_and_status', ['bookingId', 'status'])
		.index('by_appointmentId_and_status', ['appointmentId', 'status'])
		.index('by_customerId_and_updatedAt', ['customerId', 'updatedAt'])
		.index('by_customerId_and_status', ['customerId', 'status'])
		// Release 3b: settled orders by receipt time, and orders whose payment date was corrected.
		.index('by_status_and_paidAt', ['status', 'paidAt'])
		.index('by_paymentEffectiveAt', ['paymentEffectiveAt']),

	/**
	 * A reusable customer profile. Orders link to it by id; nothing is matched or merged by name,
	 * so two people with the same name stay two customers.
	 */
	customers: defineTable({
		revision: v.optional(v.number()),
		archivedAt: v.optional(v.number()),
		mergedInto: v.optional(v.id('customers')),
		mergeKey: v.optional(v.string()),
		mergeReason: v.optional(v.string()),
		name: v.string(),
		phone: v.optional(v.string()),
		/** Digits of `phone`, for exact lookup. */
		phoneDigits: v.optional(v.string()),
		email: v.optional(v.string()),
		/** Trimmed, lower-case `email`, for exact lookup. */
		emailNormalized: v.optional(v.string()),
		notes: v.optional(v.string()),
		createdBy: v.string(),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_phoneDigits', ['phoneDigits'])
		.index('by_emailNormalized', ['emailNormalized'])
		.index('by_archivedAt', ['archivedAt'])
		.searchIndex('search_name', { searchField: 'name' }),

    /** Durable, bounded customer reference migration. Original identities and receipt snapshots remain. */
    customerMergeJobs: defineTable({
        sourceId: v.id('customers'), destinationId: v.id('customers'),
        reason: v.string(), actor: v.string(), status: v.union(v.literal('running'), v.literal('completed')),
        movedOrders: v.number(), before: v.object({
            sourceId: v.id('customers'), destinationId: v.id('customers'),
            source: v.object({ name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()), notes: v.optional(v.string()) }),
            destination: v.object({ name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()), notes: v.optional(v.string()) })
        }), createdAt: v.number(), updatedAt: v.number(), completedAt: v.optional(v.number())
    }).index('by_sourceId', ['sourceId']).index('by_destinationId_and_status', ['destinationId', 'status']),

	orderLines: defineTable({
		orderId: v.id('orders'),
		kind: v.union(v.literal('service'), v.literal('room'), v.literal('extra'), v.literal('booking'), v.literal('appointment')),
		serviceId: v.optional(v.id('services')),
		propertyId: v.optional(v.id('properties')),
		bookingId: v.optional(v.id('bookings')),
		appointmentId: v.optional(v.id('appointments')),
		name: v.string(),
		/** Short second line, e.g. "60 min" or "12 Oct – 15 Oct". */
		detail: v.optional(v.string()),
		unitPrice: v.number(),

		catalogUnitPrice: v.number(),
		/** Currency of unitPrice when the row was added (always THB). */
		currency: v.string(),
		qty: v.number(),
		/** Absent = any therapist. */
		staffId: v.optional(v.id('staff')),
		/** The therapist's name as printed on the receipt, frozen when the order is paid. */
		staffName: v.optional(v.string()),


		startAt: v.optional(v.number()),

		schedule: v.optional(v.object({ date: v.optional(v.string()), time: v.optional(v.string()) })),
		discount: v.optional(v.object({ type: v.union(v.literal('amount'), v.literal('percent')), value: v.number() })),
		priceOverride: v.optional(v.object({ price: v.number(), note: v.string(), by: v.string(), at: v.number() })),
		/** Paid before checkout (an attached booking's online payment); deducted from what is due. */
		deposit: v.optional(v.number()),
		/** This row's share of the order's coupon (orders.promotion), in baht. Recomputed while unpaid, frozen once paid. */
		couponDiscount: v.optional(v.number()),
		/**
		 * A no-show or late-cancellation fee (pos.addAppointmentFee), on an `extra` row. It refers to the
		 * appointment without charging it: the appointment keeps its status and stays unpaid.
		 */
		fee: v.optional(v.object({
			kind: v.union(v.literal('no_show'), v.literal('late_cancellation')),
			reason: v.optional(v.string()),
			by: v.string(),
			at: v.number()
		})),
		/** The appointment a fee row is for (with `fee`). Deliberately not `appointmentId`, which means "charges it". */
		feeAppointmentId: v.optional(v.id('appointments')),
		createdAt: v.number()
	})
		.index('by_orderId', ['orderId'])
		.index('by_feeAppointmentId', ['feeAppointmentId'])
		// The booking and appointment rows of an order, for the booking references the orders list shows.
		.index('by_orderId_and_kind', ['orderId', 'kind'])
		.index('by_bookingId', ['bookingId'])
		.index('by_appointmentId', ['appointmentId']),

	/** Append-only POS returns, in integer satang. Recording moves no money. */
	orderRefunds: defineTable({
		orderId: v.id('orders'), lineId: v.id('orderLines'), amount: v.number(), currency: v.string(), method: storedRefundMethod,
		reason: v.string(), idempotencyKey: v.string(), createdBy: v.string(), createdByEmail: v.string(),
		createdAt: v.number(), businessDate: v.string()
	}).index('by_orderId', ['orderId']).index('by_orderId_and_businessDate', ['orderId', 'businessDate']).index('by_lineId', ['lineId'])
		.index('by_idempotencyKey', ['idempotencyKey']).index('by_businessDate', ['businessDate']),

	orderPayments: defineTable({
		orderId: v.id('orders'),
		method: v.union(v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer')),
		amount: v.number(),
		/** Cash handed over; the change is received - amount. */
		received: v.optional(v.number()),
		idempotencyKey: v.string(),
		createdBy: v.string(),
		createdAt: v.number(),
		/** Business date the money was received; `createdAt` is when it was recorded. Absent = createdAt. */
		effectiveAt: v.optional(v.number())
	})
		.index('by_orderId', ['orderId'])
		// Release 3b: tenders are written with createdAt = the order's paidAt, so the report reads a range of them at once.
		.index('by_createdAt', ['createdAt']),

	/**
	 * Audited corrections to a paid order (pos.amendOrderPayment, pos.voidUnreceivedOrder). The issued
	 * receipt, its payments and audit rows stay as they were; each row records before and after.
	 */
	orderCorrections: defineTable({
		orderId: v.id('orders'),
		/** The order's correctionRevision this row produced (1, 2, …). */
		sequence: v.number(),
		/** `linked` / `unlinked`: a paid row applied to (or taken off) an appointment or stay later (pos.linkPaidLine). */
		kind: v.union(v.literal('amended'), v.literal('void_unreceived'), v.literal('linked'), v.literal('unlinked')),
		reason: v.string(),
		actor: v.string(),
		recordedAt: v.number(),
		idempotencyKey: v.string(),
		/** Link corrections: the row, the link and its target, and the amount applied. */
		lineId: v.optional(v.id('orderLines')),
		linkId: v.optional(v.id('orderLineLinks')),
		appointmentId: v.optional(v.id('appointments')),
		bookingId: v.optional(v.id('bookings')),
		amount: v.optional(v.number()),
		tendersBefore: v.optional(v.array(correctedTender)),
		tendersAfter: v.optional(v.array(correctedTender)),
		customerBefore: v.optional(v.union(v.null(), receiptCustomer)),
		customerAfter: v.optional(v.union(v.null(), receiptCustomer)),
		customerIdBefore: v.optional(v.union(v.null(), v.id('customers'))),
		customerIdAfter: v.optional(v.union(v.null(), v.id('customers'))),
		effectiveAtBefore: v.optional(v.number()),
		effectiveAtAfter: v.optional(v.number())
	})
		.index('by_orderId_and_sequence', ['orderId', 'sequence'])
		.index('by_idempotencyKey', ['idempotencyKey']),

	/**
	 * A paid service or room row applied later to the appointment or stay it paid for
	 * (pos.linkPaidLine). The row and its issued receipt never change: the link lives here, and the
	 * target is recorded as paid by this order exactly as checkout would have done (an appointment's
	 * payment fields; a stay's `bookingPayments` row with `orderId`). One active link per row and per
	 * target. Unlinking (or voiding the order as unreceived) reverses exactly what the link applied
	 * and keeps the row as `unlinked`. Every link and unlink is also a orderCorrections row.
	 */
	orderLineLinks: defineTable({
		orderId: v.id('orders'),
		lineId: v.id('orderLines'),
		kind: v.union(v.literal('appointment'), v.literal('booking')),
		appointmentId: v.optional(v.id('appointments')),
		bookingId: v.optional(v.id('bookings')),
		/** What this order charged for the row (lineNet), applied to the target. */
		amount: v.number(),
		currency: v.string(),
		status: v.union(v.literal('active'), v.literal('unlinked')),
		/** The money's business date: the order's payment date. */
		effectiveAt: v.number(),
		/** Appointment: its price before the link set it to `amount`, restored on unlink. */
		appointmentPriceBefore: v.optional(v.number()),
		/** Stay: the payment row the link recorded, and the stay's payment status and date before it. */
		bookingPaymentId: v.optional(v.id('bookingPayments')),
		bookingPaymentStatusBefore: v.optional(v.union(v.literal('pending'), v.literal('paid'), v.literal('failed'), v.literal('refunded'))),
		bookingPaidAtBefore: v.optional(v.number()),
		reason: v.string(),
		linkedAt: v.number(),
		linkedBy: v.string(),
		/** The orderCorrections sequence that made it, and the one that ended it. */
		sequence: v.number(),
		unlinkedAt: v.optional(v.number()),
		unlinkedBy: v.optional(v.string()),
		unlinkReason: v.optional(v.string()),
		unlinkSequence: v.optional(v.number())
	})
		.index('by_orderId_and_status', ['orderId', 'status'])
		.index('by_lineId_and_status', ['lineId', 'status'])
		.index('by_appointmentId_and_status', ['appointmentId', 'status'])
		.index('by_bookingId_and_status', ['bookingId', 'status']),

	/** Price overrides, customer links, source updates, payments and voids on an order: who, when, why, old and new price. */
	orderAudit: defineTable({
		orderId: v.id('orders'),
		lineId: v.optional(v.id('orderLines')),
		at: v.number(),
		actor: v.string(),
		kind: v.union(
			v.literal('price_override'),
			v.literal('refund'),
			v.literal('cleared'),
			v.literal('paid'),
			v.literal('void'),
			v.literal('customer_linked'),
			v.literal('customer_unlinked'),
			v.literal('source_updated'),
			v.literal('source_removed')
		),
		customerId: v.optional(v.id('customers')),
		fromPrice: v.optional(v.number()),
		toPrice: v.optional(v.number()),
		note: v.optional(v.string())
	}).index('by_orderId_and_at', ['orderId', 'at']),


	orderCounters: defineTable({ key: v.string(), value: v.number() }).index('by_key', ['key']),

	/**
	 * The shop's till: a single row with key 'default'. `orderId` is the order the customer display
	 * shows, published by displays.showOrder. Only the checkout tab whose id is `driverId` (the one
	 * that last connected or took over the display) may publish it. `publishedAt` is its last publish.
	 * `leaseId` is the publishing checkout's lease: an open order is shown only while it holds one
	 * (renewed in `displayDriverLeases`). Pairing links are valid only for `pairGeneration`.
	 */
	tills: defineTable({
		key: v.literal('default'),
		orderId: v.optional(v.id('orders')),
		driverId: v.optional(v.string()),
		publishedAt: v.optional(v.number()),
		leaseId: v.optional(v.string()),
		pairGeneration: v.optional(v.number())
	}).index('by_key', ['key']),

	/**
	 * When the till's lease (`tills.leaseId`) runs out unless the driving checkout renews it. Kept
	 * apart from `tills` so renewals don't re-run the checkouts' `listDisplays`; `displays.current`
	 * reads it only while an open order is shown. One per till.
	 */
	displayDriverLeases: defineTable({
		tillId: v.id('tills'),
		leaseId: v.string(),
		expiresAt: v.number()
	}).index('by_tillId', ['tillId']),

	/** A guest-facing screen paired to a till. Only the SHA-256 of its device token is stored. */
	displays: defineTable({
		tillId: v.id('tills'),
		name: v.string(),
		tokenHash: v.string(),
		status: v.union(v.literal('pending'), v.literal('active'), v.literal('revoked')),
		pairCode: v.optional(v.string()),
		pairCodeExpiresAt: v.optional(v.number()),
		createdAt: v.number(),
		pairedAt: v.optional(v.number()),
		revokedAt: v.optional(v.number())
	})
		.index('by_tokenHash', ['tokenHash'])
		.index('by_pairCode', ['pairCode'])
		.index('by_tillId_and_status', ['tillId', 'status']),

	/** Display heartbeats, kept apart from `displays` so they don't re-run every `displays.current` subscription. */
	displayPresence: defineTable({
		displayId: v.id('displays'),
		lastSeenAt: v.number()
	}).index('by_displayId', ['displayId']),

	/** One-time pairing links. Only the SHA-256 of the secret is stored. Deleted once expired (displays.cleanPending). */
	displayPairLinks: defineTable({
		tillId: v.id('tills'),
		secretHash: v.string(),
		expiresAt: v.number(),
		usedAt: v.optional(v.number()),
		createdByEmail: v.string(),
		/** The checkout tab that made the link; it drives the display once the link is claimed. */
		driverId: v.string(),
		/** The till's `pairGeneration` when made. A newer link, a pairing or a disconnect moves it on; links without one never claim. */
		generation: v.optional(v.number())
	})
		.index('by_secretHash', ['secretHash'])
		.index('by_expiresAt', ['expiresAt']),

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

	reviewStats: defineTable({
		propertyId: v.id('properties'),
		overallRating: v.number(),
		totalReviews: v.number(),
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
	conversations: defineTable({
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

	messages: defineTable({
		sessionId: v.id('conversations'),
		role: v.union(v.literal('user'), v.literal('assistant')),
		source: v.optional(v.literal('admin')),
		replyToMessageId: v.optional(v.id('messages')),
		content: v.string(),
		action: v.optional(v.union(v.literal('booking'), v.literal('tour'), v.literal('none'))),
		timestamp: v.number()
	})
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

	channelEvents: defineTable({
		channel: v.union(v.literal('web'), v.literal('line'), v.literal('facebook'), v.literal('instagram'), v.literal('whatsapp')),
		eventKey: v.string(),
    recipient: v.optional(v.string()), accountId: v.optional(v.string()), profileName: v.optional(v.string()),
    admittedAt: v.optional(v.number()), replyToken: v.optional(v.string()), arrivedAt: v.optional(v.number()),
    claimToken: v.optional(v.string()), leaseExpiresAt: v.optional(v.number()), attempts: v.optional(v.number()), nextAttemptAt: v.optional(v.number()),
    dispatchState: v.optional(v.union(v.literal('prepared'), v.literal('sending'), v.literal('sent'), v.literal('rejected'), v.literal('uncertain'))),
    responseText: v.optional(v.string()), responseModel: v.optional(v.string()), responseCardJson: v.optional(v.string()),
    responseOutcome: v.optional(v.union(v.literal('answered'), v.literal('awaiting_guest'), v.literal('needs_staff'))),
    locale: v.optional(v.string()), propertySlug: v.optional(v.string()), actionHint: v.optional(v.union(v.literal('booking'), v.literal('tour'), v.literal('none'))),
    toolResults: v.optional(v.array(v.object({ key: v.string(), name: v.string(), resultJson: v.string(), pending: v.optional(v.boolean()) }))),
		sessionId: v.optional(v.id('conversations')),
		lineUserId: v.optional(v.string()),
  facebookUserId: v.optional(v.string()), pageId: v.optional(v.string()),
  instagramUserId: v.optional(v.string()), instagramAccountId: v.optional(v.string()),
  whatsappUserId: v.optional(v.string()), phoneNumberId: v.optional(v.string()),
  facebookReplyStatus: v.optional(v.number()), instagramReplyStatus: v.optional(v.number()), whatsappReplyStatus: v.optional(v.number()),
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
			v.literal('failed'),
      v.literal('reconciliation')
		),
		replyMode: v.optional(
			v.union(
				v.literal('ai'),
				v.literal('unknown_fallback'),
				v.literal('postback'),
				v.literal('follow'),
				v.literal('ignored'),
				v.literal('failed')
			)
		),
		lineReplyStatus: v.optional(v.number()),
		userMessageId: v.optional(v.id('messages')),
		assistantMessageId: v.optional(v.id('messages')),
		error: v.optional(v.string()),
		eventTimestamp: v.optional(v.number()),
		processingStartedAt: v.number(),
        /** A provider send may have succeeded; automatic webhook replay is unsafe. */
        deliveryStartedAt: v.optional(v.number()),
		processedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
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
		.index('by_session_and_suggestionKey', ['sessionId', 'suggestionKey']),

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
		sessionId: v.optional(v.id('conversations')),
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
		createdAt: v.number(),
		updatedAt: v.number(),
		resolvedAt: v.optional(v.number()),
		ignoredAt: v.optional(v.number())
	})
		.index('by_createdAt', ['createdAt'])
		.index('by_status_and_createdAt', ['status', 'createdAt'])
		.index('by_status_and_normalizedQuestion', ['status', 'normalizedQuestion'])
		.index('by_status_and_normalizedQuestion_and_propertyId', ['status', 'normalizedQuestion', 'propertyId'])
		.index('by_propertySlug', ['propertySlug'])
		.index('by_propertyId_and_status_and_createdAt', ['propertyId', 'status', 'createdAt'])
		.index('by_sessionId_and_normalizedQuestion', ['sessionId', 'normalizedQuestion'])
		.index('by_sessionId', ['sessionId'])
		.searchIndex('search_userQuestion', { searchField: 'userQuestion', filterFields: ['status'] }),

	// Admin-editable business profile; a single row with key 'default'. Missing fields fall back to lib/siteSettings defaults.
	siteSettings: defineTable({
		key: v.literal('default'),
		bookingRules: v.optional(bookingRulesValidator),
		revision: v.optional(v.number()),
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

	// Marketing release 1: campaigns, short links and coupon catalog (see convex/marketing.ts).

	// Marketing R4: grants bind an explicit email invitation to the authenticated canonical identity.
	marketingGrants: defineTable({
		email: v.string(),
		role: marketingRole,
		inviteExpiresAt: v.optional(v.number()),
		tokenIdentifier: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_email', ['email']).index('by_tokenIdentifier', ['tokenIdentifier']),
	marketingAffiliates: defineTable({
		name: v.string(),
		slug: v.string(),
		campaignId: v.id('marketingCampaigns'),
		canonicalLinkId: v.optional(v.id('marketingLinks')),
		status: affiliateState,
		contactEmail: v.optional(v.string()),
		propertySlugs: v.optional(v.array(v.string())),
		startsOn: v.optional(v.string()),
		endsOn: v.optional(v.string()),
		notes: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_slug', ['slug']).index('by_status', ['status']),
	// Net collections and manual referral approval only. These records never calculate a commission or payout.
	affiliateCredits: defineTable({
		sourceKey: v.string(),
		bookingId: v.optional(v.id('bookings')),
		orderId: v.optional(v.id('orders')),
		snapshot: affiliateSnapshot,
		affiliateId: v.optional(v.id('marketingAffiliates')),
		state: creditState,
		eligibleNet: v.number(),
		approvedNet: v.number(),
		eligible: v.boolean(),
		revision: v.number(),
		reason: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number()
	}).index('by_sourceKey', ['sourceKey'])
		.index('by_affiliateId_and_state', ['affiliateId', 'state'])
		.index('by_state', ['state']),
	// Append-only: one row for each credit revision; decision reasons and amount/reversal changes are retained.
	affiliateCreditChanges: defineTable({
		creditId: v.id('affiliateCredits'),
		revision: v.number(),
		actor: v.string(),
		kind: v.string(),
		reason: v.optional(v.string()),
		state: creditState,
		eligibleNet: v.number(),
		approvedNet: v.number(),
		affiliateId: v.optional(v.id('marketingAffiliates')),
		recordedAt: v.number()
	}).index('by_creditId_and_revision', ['creditId', 'revision']),

	marketingCampaigns: defineTable({
		name: v.string(),
		source: v.string(),
		medium: v.string(),
		status: v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('ended'), v.literal('archived')),
		startsOn: v.optional(v.string()),
		endsOn: v.optional(v.string()),
		budget: v.optional(v.number()),
		notes: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	}).index('by_status', ['status']),

	marketingLinks: defineTable({
		affiliateId: v.optional(v.id('marketingAffiliates')),
		slug: v.string(),
		name: v.string(),
		campaignId: v.id('marketingCampaigns'),
		placement: v.optional(v.string()),
		destination: v.union(
			v.object({ kind: v.literal('home') }),
			v.object({ kind: v.literal('booking'), propertySlug: v.optional(v.string()) }),
			v.object({ kind: v.literal('villa'), propertySlug: v.string() }),
			v.object({ kind: v.literal('experiences') }),
			v.object({ kind: v.literal('chat') })
		),
		locale: v.optional(v.string()),
		couponId: v.optional(v.id('coupons')),
		entry: v.union(v.literal('link'), v.literal('qr')),
		status: v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('archived')),
		opens: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	})
		.index('by_slug', ['slug'])
		.index('by_campaign', ['campaignId', 'status'])
		.index('by_status', ['status'])
		.index('by_couponId', ['couponId'])
		.index('by_affiliateId', ['affiliateId']),

	marketingEvents: defineTable({
		linkId: v.id('marketingLinks'),
		kind: v.literal('open'),
		bot: v.boolean(),
		occurredAt: v.number()
	}).index('by_link_and_time', ['linkId', 'occurredAt']).index('by_occurredAt', ['occurredAt']),

	// Release 3a: one consented browser session (see convex/lib/marketingAttribution.ts). No personal data.
	marketingSessions: defineTable({
		/** Server-minted, kept in the browser only after analytics consent. */
		visitorKey: v.string(),
		linkId: v.optional(v.id('marketingLinks')),
		campaignId: v.optional(v.id('marketingCampaigns')),
		landingPath: v.string(),
		referrerHost: v.optional(v.string()),
		startedAt: v.number()
	})
		.index('by_visitorKey_and_startedAt', ['visitorKey', 'startedAt'])
		.index('by_linkId_and_startedAt', ['linkId', 'startedAt'])
		.index('by_startedAt', ['startedAt']),

	// Release 3b: consented sessions per Bangkok day, link and the campaign the link belonged to then,
	// kept by startSession so the report never reads raw sessions.
	marketingSessionDays: defineTable({
		day: v.string(),
		/** Absent = sessions that arrived without a link. */
		linkId: v.optional(v.id('marketingLinks')),
		campaignId: v.optional(v.id('marketingCampaigns')),
		count: v.number()
	}).index('by_day_and_linkId_and_campaignId', ['day', 'linkId', 'campaignId']),

	// Release 3b: what a campaign cost, entered by staff in integer satang and spread evenly over its days.
	marketingSpend: defineTable({
		campaignId: v.id('marketingCampaigns'),
		amount: v.number(),
		from: v.string(),
		to: v.string(),
		note: v.optional(v.string()),
		/** Soft delete: kept for history, left out of every report. */
		deletedAt: v.optional(v.number()),
		deletedByEmail: v.optional(v.string()),
		createdAt: v.number(),
		createdByEmail: v.string(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	})
		.index('by_campaignId_and_from', ['campaignId', 'from'])
		.index('by_to', ['to']),

	// Release 3b: coupon refusals per Bangkok day. No guest data and never the typed text (unknown codes have no couponId).
	couponRefusalDays: defineTable({
		day: v.string(),
		couponId: v.optional(v.id('coupons')),
		problem: couponRefusalProblemValidator,
		surface: couponRefusalSurfaceValidator,
		count: v.number()
	})
		.index('by_day_and_couponId_and_problem_and_surface', ['day', 'couponId', 'problem', 'surface'])
		.index('by_couponId_and_day', ['couponId', 'day']),

	coupons: defineTable({
		affiliateId: v.optional(v.id('marketingAffiliates')),
		code: v.string(),
		campaignId: v.optional(v.id('marketingCampaigns')),
		status: v.union(v.literal('draft'), v.literal('active'), v.literal('paused'), v.literal('archived')),
		currentVersion: v.number(),
		used: v.number(),
		discountGranted: v.number(),
		// Release 2: slots and discount held by unpaid bookings (see convex/lib/couponRedemptions.ts).
		held: v.optional(v.number()),
		heldDiscount: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
		updatedByEmail: v.string()
	})
		.index('by_code', ['code'])
		.index('by_status', ['status'])
		.index('by_campaignId', ['campaignId'])
		.index('by_affiliateId', ['affiliateId']),

	// One row per coupon use. held -> consumed (first payment) | released (unpaid stay cancelled/expired);
	// consumed -> reversed (stay cancelled after payment; the slot is NOT given back).
	couponRedemptions: defineTable({
		couponId: v.id('coupons'),
		couponVersion: v.number(),
		code: v.string(),
		bookingId: v.optional(v.id('bookings')),
		/** Release 2b: a checkout order's coupon use. Exactly one of bookingId / orderId is set. */
		orderId: v.optional(v.id('orders')),
		state: v.union(v.literal('held'), v.literal('consumed'), v.literal('released'), v.literal('reversed')),
		discount: v.number(),
		// Captured money is always honoured: set when a late payment consumed a slot past the limit or budget.
		overLimit: v.optional(v.boolean()),
		createdAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_bookingId', ['bookingId'])
		.index('by_orderId', ['orderId'])
		.index('by_couponId_and_state', ['couponId', 'state'])
		.index('by_couponId_and_createdAt', ['couponId', 'createdAt']),

	// Immutable: a change to the offer writes a new version; redemptions keep the version they used.
	couponVersions: defineTable({
		couponId: v.id('coupons'),
		version: v.number(),
		benefit: v.union(
			v.object({ kind: v.literal('percent'), percent: v.number() }),
			v.object({ kind: v.literal('fixed'), amount: v.number() })
		),
		scope: v.union(v.literal('accommodation'), v.literal('services'), v.literal('accommodation_and_services')),
		propertySlugs: v.optional(v.array(v.string())),
		bookFrom: v.optional(v.string()),
		bookTo: v.optional(v.string()),
		stayFrom: v.optional(v.string()),
		stayTo: v.optional(v.string()),
		minNights: v.optional(v.number()),
		minEligibleSubtotal: v.optional(v.number()),
		maxSaving: v.optional(v.number()),
		usageLimit: v.optional(v.number()),
		discountBudget: v.optional(v.number()),
		terms: v.optional(v.string()),
		createdAt: v.number(),
		createdByEmail: v.string()
	}).index('by_coupon_and_version', ['couponId', 'version']),
});
