import { defineTable } from 'convex/server';
import { v } from 'convex/values';
import { storedPaymentMethod, storedRefundMethod } from '../lib/financeValidators';

// Owned by services; assembled only by convex/schema.ts.
export const servicesTables = {
 appointmentFeeAttempts: defineTable({
  key: v.string(), actor: v.string(), fingerprint: v.string(), orderId: v.id('orders'), lineId: v.id('orderLines')
 }).index('by_key', ['key']),


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
		.index('by_kind_and_at', ['kind', 'at'])
};
