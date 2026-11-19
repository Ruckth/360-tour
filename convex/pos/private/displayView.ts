import type { Doc } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { lineCouponDiscount, lineDiscount, lineNet, linePrice } from '../../shared/orderMath';
import { getEffectiveSettings } from '../../settings/model';
import type { DisplayCoupon, DisplayOrderState, Shared } from '../../shared/displayTypes';
import { isOpenOrder } from './orderLinks';
import { orderLines } from './orderLines';
import { lineGoodwillDiscount, readOrderProjection, receiptTotals, voucherCodeMask } from './orderLifecycle';
import { COMMERCE_LIMITS } from '../../shared/commerce/caps';

async function issuedVoucherMasks(ctx: QueryCtx, lines: readonly Doc<'orderLines'>[]) {
	const ids = new Set(lines.flatMap(line => line.saleSnapshot?.contents.flatMap(content => content.voucherId ? [content.voucherId] : []) ?? []));
	const masks = await Promise.all([...ids].slice(0, COMMERCE_LIMITS.sale.voucherIssuances).map(async voucherId => {
		const voucher = await readOrderProjection(ctx, () => ctx.db.get(voucherId));
		const source = voucher?.source;
		if (!voucher || !source || source.kind === 'refund_credit' || !lines.some(line => line._id === source.lineId)) return null;
		return voucherCodeMask(ctx, voucher);
	}));
	return masks.filter(mask => mask !== null);
}

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
export async function displayOrderState(ctx: QueryCtx, till: Doc<'tills'> | null): Promise<DisplayOrderState & { goodwillDiscount?: number; voucherCodeMasks?: string[] }> {
	const { businessName } = await getEffectiveSettings(ctx);
	const order = till?.orderId ? await ctx.db.get(till.orderId) : null;
	if (!order || !(isOpenOrder(order) || order.status === 'paid')) return { state: 'idle', businessName };
	// An open order is shown only under its checkout's live lease (convex/pos/displays.ts), checked here
	// too, not only by the scheduled expiry. Orders published before leases have none.
	if (order.status !== 'paid' && !(till && (await holdsLiveLease(ctx, till)))) return { state: 'idle', businessName };
	const lines = await orderLines(ctx, order._id);
	if (!lines.length) return { state: 'idle', businessName };

	const totals = receiptTotals(order, lines);
	const coupon: DisplayCoupon | null = order.promotion && !order.promotion.problem && totals.coupon > 0 ? { code: order.promotion.code, saving: totals.coupon } : null;
	const shared: Shared = { businessName, customerFirstName: await customerFirstName(ctx, order), orderNumber: order.orderNumber ?? null, currency: order.currency };
	const goodwill = totals.goodwillDiscount ? { goodwillDiscount: totals.goodwillDiscount } : {};
	if (order.status === 'paid') {
		// What the guest paid at the counter: the total less deposits paid before checkout.
		const voucherCodeMasks = await issuedVoucherMasks(ctx, lines);
		return { ...shared, ...goodwill, state: 'paid', total: totals.total, vat: totals.vat, amountPaid: totals.due,
			receiptNumber: order.receiptNumber ?? null, paidAt: order.paidAt ?? order.updatedAt, coupon,
			...(voucherCodeMasks.length ? { voucherCodeMasks } : {}) };
	}
	return {
		...shared,
		state: 'order',
		...goodwill,
		lines: lines.map((line) => {
			const discount = lineGoodwillDiscount(line);
			return {
				name: line.kind === 'voucher' ? 'Gift voucher' : line.saleSnapshot?.label ?? line.name,
				detail: line.kind === 'voucher' || line.kind === 'package' || line.kind === 'product' ? null : line.detail ?? null,
				qty: line.qty,
				unitPrice: line.unitPrice,
				price: linePrice(line),
				discount: lineDiscount(line) + discount,
				couponDiscount: lineCouponDiscount(line),
				total: lineNet(line) - discount,
				deposit: line.deposit ?? 0
			};
		}),
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
