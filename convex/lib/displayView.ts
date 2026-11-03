import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { billTotals, lineDiscount, lineNet, linePrice } from './billMath';
import { isOpenOrder } from './orderLinks';
import { orderLines } from './orderLines';
import { getEffectiveSettings } from './siteSettings';

/**
 * What the guest-facing customer display may show of an order. Everything is whitelisted here:
 * no ids, staff, notes, audit fields, contact details or tenders. Totals come from billMath, the
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
	discount: number;
	total: number;
	deposit: number;
};

type Shared = { businessName: string; customerFirstName: string | null; orderNumber: number | null; currency: string };

export type DisplayOrderState =
	| { state: 'idle'; businessName: string }
	| (Shared & {
			state: 'order';
			lines: DisplayLine[];
			subtotal: number;
			discount: number;
			deposit: number;
			total: number;
			/** The 7% VAT included in the total, as the checkout and receipt show it. */
			vat: number;
			due: number;
			/** Last activity: the order's last change or its last publish. The display idles a draft left untouched too long. */
			activeAt: number;
	  })
	| (Shared & { state: 'paid'; total: number; vat: number; amountPaid: number; receiptNumber: number | null; paidAt: number });

/** "Anna Lee" → "Anna". The display never shows more of a customer's name. */
export function firstName(name: string | undefined): string | null {
	return name?.trim().split(/\s+/)[0] || null;
}

/** A paid order thanks whoever its receipt was issued to; an open one greets its linked customer. */
async function customerFirstName(ctx: QueryCtx, order: Doc<'bills'>) {
	if (order.status === 'paid') return firstName(order.customerSnapshot?.name);
	return order.customerId ? firstName((await ctx.db.get(order.customerId))?.name) : null;
}

/** What the display shows for the till's published order. */
export async function displayOrderState(ctx: QueryCtx, till: Doc<'tills'> | null): Promise<DisplayOrderState> {
	const { businessName } = await getEffectiveSettings(ctx);
	const order = till?.orderId ? await ctx.db.get(till.orderId) : null;
	if (!order || !(isOpenOrder(order) || order.status === 'paid')) return { state: 'idle', businessName };
	const lines = await orderLines(ctx, order._id);
	if (!lines.length) return { state: 'idle', businessName };

	const totals = billTotals(lines);
	const shared: Shared = { businessName, customerFirstName: await customerFirstName(ctx, order), orderNumber: order.orderNumber ?? null, currency: order.currency };
	if (order.status === 'paid') {
		// What the guest paid at the counter: the total less deposits paid before checkout.
		return { ...shared, state: 'paid', total: totals.total, vat: totals.vat, amountPaid: totals.due, receiptNumber: order.receiptNumber ?? null, paidAt: order.paidAt ?? order.updatedAt };
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
			total: lineNet(line),
			deposit: line.deposit ?? 0
		})),
		subtotal: totals.subtotal,
		discount: totals.discount,
		deposit: totals.deposit,
		total: totals.total,
		vat: totals.vat,
		due: totals.due,
		activeAt: Math.max(order.updatedAt, till?.publishedAt ?? 0)
	};
}
