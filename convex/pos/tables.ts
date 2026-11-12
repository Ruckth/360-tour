import { storedApprovalPayload, approvalStatus } from '../lib/staffTypes';
import { affiliateSnapshot } from '../lib/affiliateTypes';
import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { correctedTender, receiptCustomer, storedRefundMethod } from '../lib/financeValidators';
import { posCouponProblemValidator } from '../lib/posCoupons';

// Owned by pos; assembled only by convex/schema.ts.
export const posTables = {
 staffApprovalRequests: defineTable({
  orderId: v.id('orders'), lineId: v.optional(v.id('orderLines')), kind: v.union(v.literal('discount'), v.literal('customPrice'), v.literal('voidPaidSale'), v.literal('paymentFix'), v.literal('refund')),
  payload: storedApprovalPayload, reason: v.string(), requesterEmail: v.string(), requesterTokenIdentifier: v.string(),
  requesterAccessFingerprint: v.string(), orderFingerprint: v.string(), orderRevision: v.number(), rulesRevision: v.number(), rulesFingerprint: v.optional(v.string()),
  status: approvalStatus, createdAt: v.number(), expiresAt: v.number(), resolvedAt: v.optional(v.number()),
  approverEmail: v.optional(v.string()), approverTokenIdentifier: v.optional(v.string()), resolutionReason: v.optional(v.string()),
  totalBefore: v.number(), totalAfter: v.number(), amount: v.number(), percent: v.optional(v.number())
 }).index('by_orderId_and_status', ['orderId', 'status']).index('by_orderId_and_createdAt', ['orderId', 'createdAt']).index('by_status_and_createdAt', ['status', 'createdAt']),


	/**
	 * An order (convex/pos/): the persistent commercial record with a permanent order number,
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
		.index('by_expiresAt', ['expiresAt'])
};
