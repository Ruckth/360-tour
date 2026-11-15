

/**
 * What the guest-facing customer display may show of an order. Everything is whitelisted here:
 * no ids, staff, notes, audit fields, contact details or tenders. Totals come from orderMath, the
 * same functions the checkout uses, so the display always agrees with the till.
 */

export type DisplayLine = {
	name: string;
	detail: string | null;
	qty: number;
	/** The catalog price the row was added at. */
	unitPrice: number;
	/** What each unit costs after a price override (equal to unitPrice without one). */
	price: number;
	/** Every discount on the row, its coupon share included. */
	discount: number;
	/** R2b: the row's share of the order coupon (part of `discount`). */
	couponDiscount: number;
	total: number;
	deposit: number;
};

/** R2b: the order's coupon as the guest may see it: the code and what it saves. */
export type DisplayCoupon = { code: string; saving: number };

export type Shared = { businessName: string; customerFirstName: string | null; orderNumber: number | null; currency: string };

export type DisplayOrderState =
	| { state: 'idle'; businessName: string }
	| (Shared & {
			state: 'order';
			lines: DisplayLine[];
			subtotal: number;
			discount: number;
			/** R2b: null without a coupon, or while it doesn't apply. */
			coupon: DisplayCoupon | null;
			deposit: number;
			total: number;
			/** The 7% VAT included in the total, as the checkout and receipt show it. */
			vat: number;
			due: number;
			/** Last activity: the order's last change or its last publish. The display idles a draft left untouched too long. */
			activeAt: number;
	  })
	| (Shared & { state: 'paid'; total: number; vat: number; amountPaid: number; receiptNumber: number | null; paidAt: number; coupon: DisplayCoupon | null });

export type DisplayState = { state: 'unpaired' } | { state: 'pending'; code: string } | DisplayOrderState;

export type DisplayDriver = 'here' | 'elsewhere' | 'none';
