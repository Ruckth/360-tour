import { v } from 'convex/values';

/**
 * Validators shared by the schema and the booking/order correction functions, so a stored
 * financial record and the argument that created it can't drift apart.
 */


export const MANUAL_PAYMENT_METHODS = ['cash', 'promptpay', 'card', 'transfer', 'other'] as const;
export const manualPaymentMethod = v.union(
	v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer'), v.literal('other')
);
export const storedPaymentMethod = v.union(
	v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer'), v.literal('other'),
	v.literal('unrecorded'), v.literal('stripe'), v.literal('provider'), v.literal('order')
);


export const REFUND_METHODS = ['cash', 'promptpay', 'card', 'transfer', 'stripe', 'other'] as const;
export const refundMethod = v.union(
	v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer'), v.literal('stripe'), v.literal('other')
);
export const storedRefundMethod = v.union(
	v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer'), v.literal('stripe'), v.literal('other'),
	v.literal('unrecorded')
);

/** Where a stay payment came from: entered on the booking, settled on an order, or confirmed by the online provider. */
export const stayPaymentOrigin = v.union(v.literal('manual'), v.literal('pos'), v.literal('online'));

export const tenderMethod = v.union(v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer'));
export const correctedTender = v.object({ method: tenderMethod, amount: v.number(), received: v.optional(v.number()) });
export const receiptCustomer = v.object({ name: v.string(), phone: v.optional(v.string()), email: v.optional(v.string()) });

/** A custom stay price: what the stay is charged instead of the villa rate, and why. */
export const bookingPriceOverride = v.object({
	total: v.number(),
	/** The villa-rate total it replaced, for the history and the booking sheet. */
	quotedTotal: v.number(),
	reason: v.string(),
	by: v.string(),
	at: v.number()
});
