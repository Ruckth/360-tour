import { affiliateSnapshot } from '../lib/affiliateTypes';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { bookingPriceOverride, stayPaymentOrigin, storedPaymentMethod, storedRefundMethod } from '../lib/financeValidators';
import { marketingAttributionValidator } from '../shared/marketingAttribution';

// Owned by bookings; assembled only by convex/schema.ts.
export const bookingsTables = {
 bookingCreateAttempts: defineTable({
  key: v.string(), actor: v.string(), bookingId: v.id('bookings'), fingerprint: v.string(), recordedAt: v.number()
 }).index('by_key', ['key']),


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
		.index('by_property_date', ['propertyId', 'date'])
};
