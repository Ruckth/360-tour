import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { adminQuery, staffQuery } from '../auth/model';
import { appointmentMoney } from '../lib/appointmentFinance';
import { stayMoney } from '../lib/stayMoney';
import { couponVersion } from '../marketing/model';
import { orderLineLinks } from '../lib/lineLinks';
import { orderPaymentRecord } from '../lib/orderLifecycle';
import { orderLines } from '../lib/orderLines';
import { activeOrderFor, isOpenOrder, orderState, ordersForSource } from '../lib/orderLinks';
import { MAX_ORDER_REFUNDS, lineNet, orderTitle, orderTotals, roundMoney } from '../lib/orderMath';
import { isWalkInLine, orderRefundTotal, orderRefundView, orderRefunds } from '../lib/orderRefunds';
import { type OrderPromotionView } from '../lib/posCoupons';
import { canReadCheckoutOrder } from '../lib/staffAccess';
import { MAX_STAY_ROWS } from '../lib/stayCorrections';
import { customerCard } from './private/customerModel';
import { discardedInfo, restoreConflicts } from './private/lifecycleModel';
import { ORDERS_PAGE_MAX, appointmentAttachable, appointmentRef, bookingClosed, customerName, discardedField, isSourceRow, linePhoto, oneSource, orderReads, orderSourceRefs, remaining, sourceArgs, sourceIssue, sourceRows, stayRef } from './private/orderModel';

export const getOrder = staffQuery({
  capability: 'checkout',
	// Deep links are untrusted strings. Normalize after auth so a bad link is recoverable,
	// rather than failing argument validation before checkout can render its recovery controls.
	args: { orderId: v.string() },
	handler: async (ctx, args) => {
		const actor = ctx.staff;
		const orderId = ctx.db.normalizeId('orders', args.orderId);
		if (!orderId) return null;
		const order = await ctx.db.get(orderId);
		if (!order || !canReadCheckoutOrder(actor, order)) return null;
		const open = isOpenOrder(order);
		const [lines, payments, audit, customer, parent, refunds, corrections, appointmentRefunds, links, posRefunds] = await Promise.all([
			orderLines(ctx, order._id),
			ctx.db.query('orderPayments').withIndex('by_orderId', (q) => q.eq('orderId', order._id)).take(10),
			ctx.db.query('orderAudit').withIndex('by_orderId_and_at', (q) => q.eq('orderId', order._id)).order('desc').take(50),
			order.customerId ? ctx.db.get(order.customerId) : null,
			order.parentOrderId ? ctx.db.get(order.parentOrderId) : null,
			ctx.db.query('bookingRefunds').withIndex('by_orderId', (q) => q.eq('orderId', order._id)).take(MAX_STAY_ROWS),
			ctx.db.query('orderCorrections').withIndex('by_orderId_and_sequence', (q) => q.eq('orderId', order._id)).order('desc').take(20),
			ctx.db.query('appointmentRefunds').withIndex('by_orderId', q => q.eq('orderId', order._id)).order('desc').take(MAX_STAY_ROWS),
			isOpenOrder(order) ? [] : orderLineLinks(ctx, order._id),
			order.status === 'paid' || order.status === 'void' ? orderRefunds(ctx, order._id, true) : []
		]);
		const refundHistoryTruncated = posRefunds.length > MAX_ORDER_REFUNDS;
		const refundedByLine = new Map<Id<'orderLines'>, number>();
		for (const refund of posRefunds) refundedByLine.set(refund.lineId, (refundedByLine.get(refund.lineId) ?? 0) + refund.amount);
		const refundedAmountSatang = posRefunds.reduce((sum, row) => sum + row.amount, 0);
		const reads = orderReads(ctx);
		const sources = await orderSourceRefs(ctx, order, lines, reads);
		const linkRows = [];
		for (const link of [...links].sort((a, b) => b.linkedAt - a.linkedAt)) {
			const target = link.appointmentId ? await appointmentRef(ctx, link.appointmentId, false, undefined, reads) : await stayRef(ctx, link.bookingId!, false, reads);
			linkRows.push({
				_id: link._id, lineId: link.lineId, kind: link.kind, status: link.status, amount: link.amount, currency: link.currency,
				effectiveAt: link.effectiveAt, reason: link.reason, linkedAt: link.linkedAt, linkedBy: link.linkedBy, sequence: link.sequence,
				unlinkedAt: link.unlinkedAt ?? null, unlinkedBy: link.unlinkedBy ?? null, unlinkReason: link.unlinkReason ?? null,
				target: { id: target.id, reference: target.reference, name: target.name, guestName: target.guestName ?? null }
			});
		}
		const settled = order.status === 'paid' || order.status === 'void';
		const staffNames = new Map<Id<'staff'>, string>();
		for (const id of new Set(lines.flatMap((line) => (line.staffId && (!settled || line.staffName == null) ? [line.staffId] : [])))) {
			const person = await ctx.db.get(id);
			if (person) staffNames.set(id, person.name);
		}
		const photos = new Map<string, Promise<string | undefined>>();
		const rows = [];
		for (const line of lines) {
			const photoKey = line.serviceId ?? line.propertyId ?? line.bookingId;
			if (photoKey && !photos.has(photoKey)) photos.set(photoKey, linePhoto(ctx, line, reads));
			const stay = line.bookingId ? await reads.booking(line.bookingId) : null;
			// Optional at the type boundary so existing offline checkout adapters remain compatible.
			const refundAmounts: { refundedAmountSatang?: number; remainingRefundableSatang?: number } = {
				refundedAmountSatang: refundedByLine.get(line._id) ?? 0,
				remainingRefundableSatang: !refundHistoryTruncated && posRefunds.length < MAX_ORDER_REFUNDS && order.status === 'paid' && order.paidAt !== undefined && isWalkInLine(line) && !links.some(link => link.lineId === line._id && link.status === 'active')
					? Math.max(0, lineNet(line) - (refundedByLine.get(line._id) ?? 0)) : 0,
			};
			rows.push({
				...line,
				net: lineNet(line),
				...refundAmounts,
				imageUrl: photoKey ? await photos.get(photoKey) : undefined,
				// A paid row keeps the name it was issued with; an open row shows the therapist's current name.
				staffName: line.staffId ? (open ? undefined : line.staffName) ?? staffNames.get(line.staffId) ?? 'Former staff member' : undefined,
				// History is not re-checked: a paid row stays as it was paid.
				sourceIssue: open && isSourceRow(line) ? await sourceIssue(ctx, line, reads) : null,
				/** R2b: a booking row's own promotion (the stay was priced with it; checkout never discounts it again). */
				stayCoupon: stay?.promotion && !stay.priceOverride ? { code: stay.promotion.code, discount: stay.promotion.discount } : null
			});
		}
		const refundSummary: { posRefunds?: ReturnType<typeof orderRefundView>[]; refundedAmountSatang?: number; fullyRefunded?: boolean; refundHistoryTruncated?: boolean } = {
			refundHistoryTruncated,
			posRefunds: posRefunds.slice(-50).reverse().map(orderRefundView), refundedAmountSatang,
			fullyRefunded: !refundHistoryTruncated && order.status === 'paid' && refundedAmountSatang > 0 && refundedAmountSatang === orderTotals(lines).total,
		};
		const promotion: OrderPromotionView | null = order.promotion ? {
			code: order.promotion.code, couponVersion: order.promotion.couponVersion, discount: order.promotion.discount,
			problem: order.promotion.problem ?? null,
			terms: (await couponVersion(ctx, order.promotion.couponId, order.promotion.couponVersion)).terms ?? null
		} : null;
		return {
			order: { ...order, title: orderTitle(order.orderNumber), state: orderState(order) },
			/** The linked profile as it is now. */
			customer: customer ? customerCard(customer) : order.customerId ? { _id: order.customerId, name: 'Deleted customer', phone: undefined, email: undefined } : null,
			/** Who the receipt names: frozen at payment, never the live profile. */
			receiptCustomer: order.customerSnapshot ?? null,
			/** The order's booking as shown in its header: its own, else the first it charges (see orderSourceRefs). */
			source: sources[0] ?? null,
			/** Every booking the order is for, its own first. */
			sources,
			parentOrder: parent ? { _id: parent._id, title: orderTitle(parent.orderNumber) } : null,
			lines: rows,
			...refundSummary,
			/** R2b: the order's coupon; the split is on each row's `couponDiscount`, the total in `totals.coupon`. */
			promotion,
			/** As recorded when the receipt was issued; never changed (see `paymentRecord` for corrections). */
			payments,
			audit,
			totals: orderTotals(lines),
			/**
			 * The payment as it stands after corrections (pos.amendOrderPayment), for the receipt screen.
			 * `correctionRevision` is what a correction must send back.
			 */
			paymentRecord: {
				...orderPaymentRecord(order, payments),
				tendersAmended: order.amendedTenders !== undefined,
				customerAmended: order.amendedCustomer !== undefined,
				correctionRevision: order.correctionRevision ?? 0,
				voidUnreceived: order.voidUnreceived ?? false
			},
			/** Audited corrections, newest first. */
			corrections,
			/**
			 * Paid rows applied to an appointment or stay after payment (pos.linkPaidLine), newest first,
			 * with links since undone. The receipt and its rows never change; scheduling is tracked here.
			 */
			links: linkRows,
			/** Set while the order is discarded (pos.discardOrder): who, when and why. Restore with pos.restoreOrder. */
			discarded: order.status === 'discarded'
				? { at: order.discardedAt ?? order.updatedAt, by: order.discardedBy ?? null, reason: order.discardReason ?? null }
				: null,
			/** Recent linked refunds; complete paginated histories are in orderHistoryPages. Receipt stays as issued. */
			refunds: [...refunds.map((refund) => ({
				sourceType: 'booking' as const,
				_id: refund._id, bookingId: refund.bookingId, amount: refund.amount, currency: refund.currency, method: refund.method,
				reason: refund.reason, effectiveAt: refund.effectiveAt, recordedAt: refund.recordedAt, recordedBy: refund.recordedBy
			})), ...appointmentRefunds.map(refund => ({
				sourceType: 'appointment' as const,
				_id: refund._id, appointmentId: refund.appointmentId, amount: refund.amount, currency: refund.currency, method: refund.method,
				reason: refund.reason, effectiveAt: refund.effectiveAt, recordedAt: refund.recordedAt, recordedBy: refund.recordedBy
			}))].sort((a, b) => b.recordedAt - a.recordedAt)
		};
	}
});

/**
 * Orders with items, newest change first, for the Orders list: unpaid, paid, voided or discarded.
 * Unpaid never includes discarded orders; `discarded` lists them newest discard first.
 */
export const listOrders = adminQuery({
	args: { filter: v.union(v.literal('unpaid'), v.literal('paid'), v.literal('void'), v.literal('discarded')), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const numItems = Math.min(Math.max(args.paginationOpts.numItems, 1), ORDERS_PAGE_MAX);
		const page = await ctx.db
			.query('orders')
			.withIndex('by_hasItems_and_status_and_updatedAt', (q) => {
				const withItems = q.eq('hasItems', true);

				return args.filter === 'unpaid' ? withItems.eq('status', 'draft') : withItems.eq('status', args.filter);
			})
			.order('desc')
			.paginate({ ...args.paginationOpts, numItems });
		const orders = page.page;
		const rows = [];
		for (const order of orders) {
			const sources = await orderSourceRefs(ctx, order, await sourceRows(ctx, order._id));
			const refundAmounts: { refundedAmountSatang?: number } = { refundedAmountSatang: await orderRefundTotal(ctx, order._id) };
			rows.push({
				_id: order._id,
				orderNumber: order.orderNumber,
				title: orderTitle(order.orderNumber),
				state: orderState(order),
				itemCount: order.itemCount,
				total: order.total,
				...refundAmounts,
				due: await remaining(ctx, order),
				currency: order.currency,
				updatedAt: order.updatedAt,
				receiptNumber: order.receiptNumber,
				customerName: await customerName(ctx, order),
				/** The order's booking, as in its header (see orderSourceRefs). */
				bookingReference: sources[0]?.reference,
				/** How many more bookings it is for. */
				otherBookings: Math.max(sources.length - 1, 0),
				...discardedField(order)
			});
		}
		return { ...page, page: rows };
	}
});

/** The order with this number, for "go to order #". */
export const findOrderByNumber = staffQuery({
  capability: 'checkout',
	args: { orderNumber: v.number() },
	handler: async (ctx, args) => {
		const actor = ctx.staff;
		if (!Number.isSafeInteger(args.orderNumber) || args.orderNumber < 1) return null;
		const order = await ctx.db.query('orders').withIndex('by_orderNumber', (q) => q.eq('orderNumber', args.orderNumber)).first();
		return order && canReadCheckoutOrder(actor, order) ? order._id : null;
	}
});

/**
 * A booking's or appointment's orders for its detail screen: where checkout continues (the open
 * order, if any), recent orders and what is owed on the source itself.
 */
export const ordersForBooking = adminQuery({
	args: sourceArgs,
	handler: async (ctx, args) => {
		const source = oneSource(args);
		let active = await activeOrderFor(ctx, source);
		let owed = 0;
		let total = 0;
		let paid = 0;
		let refunded = 0;
		let credit = 0;
		let refunds: Array<Doc<'bookingRefunds'> | Doc<'appointmentRefunds'>> = [];
		if ('bookingId' in source) {
			const booking = await ctx.db.get(source.bookingId);
			if (!booking) return null;
			// Net of recorded refunds: a refunded stay shows nothing paid, a shortened one its credit.
			const money = stayMoney(booking);
			({ owed, credit, refunded } = money);
			paid = money.net;
			total = booking.total;
			if (bookingClosed(booking)) owed = 0;
			refunds = await ctx.db.query('bookingRefunds').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id)).order('desc').take(MAX_STAY_ROWS + 1);
		} else {
			const appointment = await ctx.db.get(source.appointmentId);
			if (!appointment) return null;
			total = appointment.price;
			const money = appointmentMoney(appointment);
			paid = money.net;
			refunded = money.refunded;
			owed = appointmentAttachable(appointment) ? money.owed : 0;
			refunds = await ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', appointment._id)).order('desc').take(MAX_STAY_ROWS + 1);
			// An appointment that is part of a stay continues on the stay's open order.
			if (!active && appointment.bookingId) active = await activeOrderFor(ctx, { bookingId: appointment.bookingId });
		}
		if (refunds.length > MAX_STAY_ROWS) throw new ConvexError('Full refund history needs review before showing per-order balances.');
		// Empty unpaid orders (such as the one made with the booking, when its stay was charged on
		// another order) are left out, as in the orders list; the active one is returned above.
		const recent = await ordersForSource(ctx, source, 6);
		// Discarded orders charge nothing, so they are listed apart rather than as open or settled history.
		const discarded = recent.filter((order) => order.status === 'discarded');
		const orders = recent.filter((order) => order.status !== 'discarded' && (order.hasItems || !isOpenOrder(order))).slice(0, 5);
		const history = [];
		for (const order of orders) {
			history.push({
				_id: order._id,
				title: orderTitle(order.orderNumber),
				state: orderState(order) as 'unpaid' | 'paid' | 'void',
				total: order.total,
				due: await remaining(ctx, order),
				receiptNumber: order.receiptNumber,
				updatedAt: order.updatedAt,
				/** Refunds recorded on this stay against money this order took. The receipt itself is unchanged. */
				refunded: roundMoney(refunds.filter((refund) => refund.orderId === order._id).reduce((sum, refund) => sum + refund.amount, 0)),
				corrected: (order.correctionRevision ?? 0) > 0,
				voidUnreceived: order.voidUnreceived ?? false
			});
		}
		return {
			balance: { total, paid: roundMoney(paid), owed: Math.max(roundMoney(owed), 0), refunded, credit },
			/** Recorded refunds on the stay, newest first (none for appointments here; see adminServices). */
			refunds: refunds.slice(0, 10).map((refund) => ({
				_id: refund._id, amount: refund.amount, method: refund.method, reason: refund.reason, effectiveAt: refund.effectiveAt, orderId: refund.orderId ?? null
			})),
			activeOrder: active ? { _id: active._id, title: orderTitle(active.orderNumber), total: active.total, due: await remaining(ctx, active) } : null,
			orders: history,
			/** Discarded orders for this source (they charge nothing until restored), newest first. */
			discardedOrders: discarded.map((order) => ({
				_id: order._id, title: orderTitle(order.orderNumber), total: order.total, discardedAt: order.discardedAt ?? order.updatedAt, discardReason: order.discardReason ?? null
			}))
		};
	}
});

/** An order's history of ordinary edits (rows added, changed, removed, cleared), newest first. */
export const orderHistory = staffQuery({
  capability: 'checkout',
	args: { orderId: v.id('orders'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const actor = ctx.staff;
		if (actor.role === 'cashier' && !canReadCheckoutOrder(actor, await ctx.db.get(args.orderId))) throw new ConvexError('Order not found');
		const { numItems } = args.paginationOpts;
		if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new ConvexError('Page size must be 1–50');
		return await ctx.db
			.query('recordChanges')
			.withIndex('by_entityType_and_entityId_and_recordedAt', (q) => q.eq('entityType', 'order').eq('entityId', args.orderId))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

/** What restoring a discarded order would meet (see restoreConflicts). Read-only. */
export const restoreCheck = staffQuery({
  capability: 'checkout',
	args: { orderId: v.id('orders') },
	handler: async (ctx, args) => {
		const order = await ctx.db.get(args.orderId);
		if (!order) return null;
		if (order.status !== 'discarded') return { discarded: null, revision: order.revision, conflicts: [], blocking: 0, rowsLeft: 0 };
		const lines = await orderLines(ctx, order._id);
		const conflicts = await restoreConflicts(ctx, order, lines);
		const blocking = conflicts.filter((conflict) => conflict.blocking).length;
		return {
			discarded: discardedInfo(order),
			revision: order.revision,
			conflicts,
			blocking,
			/** Rows that would come back if blocking rows were taken off. 0 = it can't be restored. */
			rowsLeft: lines.length - blocking
		};
	}
});

/** Fee rows for an appointment (any order state), newest first, for its detail sheet. */
export const appointmentFees = adminQuery({
	args: { appointmentId: v.id('appointments') },
	handler: async (ctx, args) => {
		const rows = await ctx.db.query('orderLines').withIndex('by_feeAppointmentId', (q) => q.eq('feeAppointmentId', args.appointmentId)).order('desc').take(20);
		const fees = [];
		for (const line of rows) {
			const order = await ctx.db.get(line.orderId);
			if (!order || !line.fee) continue;
			fees.push({
				lineId: line._id, kind: line.fee.kind, amount: lineNet(line), currency: line.currency, reason: line.fee.reason ?? null, by: line.fee.by, at: line.fee.at,
				order: { _id: order._id, title: orderTitle(order.orderNumber), state: orderState(order), receiptNumber: order.receiptNumber ?? null }
			});
		}
		return fees;
	}
});
