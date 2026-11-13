import { v } from 'convex/values';

/** The appointment history payload, retained on its single canonical record. */
export const appointmentAudit = v.object({
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
	});
