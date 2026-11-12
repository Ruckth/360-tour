import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { orderTotals, lineCouponDiscount, lineDiscount, lineNet, linePrice } from './orderMath';
import { isOpenOrder } from './orderLinks';
import { orderLines } from './orderLines';
import { getEffectiveSettings } from '../settings/model';

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

type Shared = { businessName: string; customerFirstName: string | null; orderNumber: number | null; currency: string };

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

/** "Anna Lee" → "Anna". The display never shows more of a customer's name. */
export function firstName(name: string | undefined): string | null {
	return name?.trim().split(/\s+/)[0] || null;
}

/**
 * Whether the till's lease is still running. A query's `Date.now()` doesn't re-run it as time
 * passes, so a live subscription relies on expireLease's write; this covers every fresh read.
 */
async function holdsLiveLease(ctx: QueryCtx, till: Doc<'tills'>) {
	if (!till.leaseId) return false;
	const lease = await ctx.db.query('displayDriverLeases').withIndex('by_tillId', (q) => q.eq('tillId', till._id)).unique();
	return lease?.leaseId === till.leaseId && lease.expiresAt > Date.now();
}

/** A paid order thanks whoever its receipt was issued to; an open one greets its linked customer. */
async function customerFirstName(ctx: QueryCtx, order: Doc<'orders'>) {
	if (order.status === 'paid') return firstName(order.customerSnapshot?.name);
	return order.customerId ? firstName((await ctx.db.get(order.customerId))?.name) : null;
}

/** What the display shows for the till's published order. */
export async function displayOrderState(ctx: QueryCtx, till: Doc<'tills'> | null): Promise<DisplayOrderState> {
	const { businessName } = await getEffectiveSettings(ctx);
	const order = till?.orderId ? await ctx.db.get(till.orderId) : null;
	if (!order || !(isOpenOrder(order) || order.status === 'paid')) return { state: 'idle', businessName };
	// An open order is shown only under its checkout's live lease (convex/pos/displays.ts), checked here
	// too, not only by the scheduled expiry. Orders published before leases have none.
	if (order.status !== 'paid' && !(till && (await holdsLiveLease(ctx, till)))) return { state: 'idle', businessName };
	const lines = await orderLines(ctx, order._id);
	if (!lines.length) return { state: 'idle', businessName };

	const totals = orderTotals(lines);
	const coupon: DisplayCoupon | null = order.promotion && !order.promotion.problem && totals.coupon > 0 ? { code: order.promotion.code, saving: totals.coupon } : null;
	const shared: Shared = { businessName, customerFirstName: await customerFirstName(ctx, order), orderNumber: order.orderNumber ?? null, currency: order.currency };
	if (order.status === 'paid') {
		// What the guest paid at the counter: the total less deposits paid before checkout.
		return { ...shared, state: 'paid', total: totals.total, vat: totals.vat, amountPaid: totals.due, receiptNumber: order.receiptNumber ?? null, paidAt: order.paidAt ?? order.updatedAt, coupon };
	}
	return {
		...shared,
		state: 'order',
		lines: lines.map((line) => ({
			name: line.name,
			detail: line.detail ?? null,
			qty: line.qty,
			unitPrice: line.unitPrice,
			price: linePrice(line),
			discount: lineDiscount(line),
			couponDiscount: lineCouponDiscount(line),
			total: lineNet(line),
			deposit: line.deposit ?? 0
		})),
		subtotal: totals.subtotal,
		discount: totals.discount,
		coupon,
		deposit: totals.deposit,
		total: totals.total,
		vat: totals.vat,
		due: totals.due,
		activeAt: Math.max(order.updatedAt, till?.publishedAt ?? 0)
	};
}
