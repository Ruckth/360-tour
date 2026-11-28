import type { QueryCtx } from '../_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import { canAccessCheckoutOrderBranch, canReadCheckoutOrder, staffQuery } from '../auth/model';
import { appointmentMoney } from '../services/model';
import { stayMoney } from '../shared/stayMoney';
import { couponVersion } from '../marketing/model';
import { orderLineLinks } from './private/lineLinks';
import { correctionPreviewBlocker, externalOrderPayments, isCommerceReceipt, lineGoodwillDiscount, openOrderReturn, orderPaymentRecord, readOrderProjection, receiptTotals, voucherCodeMask, voucherOrderPayments } from './private/orderLifecycle';
import { orderLines } from './private/orderLines';
import { activeOrderFor, orderState, ordersForSource } from './private/orderLinks';
import { isOpenOrder } from './private/orderLinks';
import { MAX_ORDER_REFUNDS, lineNet, orderTitle, roundMoney } from '../shared/orderMath';
import { isWalkInLine, orderRefundTotal, orderRefundView, orderRefunds } from './private/orderRefunds';
import { COMMERCE_LIMITS } from '../shared/commerce/caps';
import { type OrderPromotionView } from '../shared/posCoupons';
import { MAX_STAY_ROWS } from '../bookings/model';
import { customerCard } from './private/customerModel';
import { discardedInfo, restoreConflicts } from './private/lifecycleModel';
import { ORDERS_PAGE_MAX, appointmentAttachable, appointmentRef, bookingClosed, customerName, discardedField, isSourceRow, lineDuration, linePhoto, oneSource, orderReads, orderSourceRefs, remaining, sourceArgs, sourceIssue, sourceRows, stayRef } from './private/orderModel';

import { publicReturnClaim } from './private/returnModel';
import { receiptVisitReturnParts } from './private/returnPlan';

const RECEIPT_REFUNDS = 50;

async function readPaymentAttempt(ctx: QueryCtx, order: Doc<'orders'>) {
	const { activeAttemptId } = order;
	if (!activeAttemptId) return null;
	const attempt = await readOrderProjection(ctx, () => ctx.db.get(activeAttemptId));
	if (!attempt || attempt.orderId !== order._id) return null;
	const { _id, status, legs, owner, tillId, tillLabel, ownerDisplayName, ownerRevision, parentAttemptId, refusal, resolution, updatedAt } = attempt;
	return { _id, status, legs, owner, tillId, tillLabel, ownerDisplayName, ownerRevision, parentAttemptId, refusal, resolution, updatedAt, due: attempt.reviewedRequest.due };
}

async function readHandovers(ctx: QueryCtx, order: Doc<'orders'>, lines: readonly Doc<'orderLines'>[]) {
	if (!lines.some(line => line.kind === 'product' || line.kind === 'package')) return [];
	const forOrder = (orderId: Id<'orders'>) => readOrderProjection(ctx, () => ctx.db.query('handovers')
		.withIndex('by_orderId_and_status', q => q.eq('orderId', orderId)).take(COMMERCE_LIMITS.sale.rows));
	const [current, recollection] = await Promise.all([
    forOrder(order._id),
    order.parentOrderId ? readOrderProjection(ctx, () => ctx.db.query('handovers')
      .withIndex('by_successorOrderId_and_status', q => q.eq('successorOrderId', order._id)).take(COMMERCE_LIMITS.sale.rows)) : [],
  ]);
  return [...new Map([...current, ...recollection].map(row => [row._id, row])).values()];
}

function handoverView(handover: Doc<'handovers'>) {
	const { _id, kind, orderId, lineId, bookingId, variantId, unitPrice, quantity, withGuest,
		backSellable, backDamaged, unpaid, paid, contents, status, pendingReturnId, successorOrderId,
		successorLineId, originalMovementId, movementIds, revision } = handover;
	return {
		_id, kind, orderId, lineId, bookingId, variantId, unitPrice, quantity, withGuest,
		backSellable, backDamaged, unpaid, paid, contents, status, pendingReturnId, successorOrderId,
		successorLineId, originalMovementId, movementIds, revision,
		editHistory: { targetType: 'handover' as const, targetId: _id },
	};
}

async function readDraftPackages(ctx: QueryCtx, lines: readonly Doc<'orderLines'>[]) {
	const ids = new Set(lines.flatMap(line =>
		line.kind === 'package' && !line.saleSnapshot && line.packageVersionId ? [line.packageVersionId] : []));
	const versions = await Promise.all([...ids].slice(0, COMMERCE_LIMITS.sale.packageRows).map(
		id => readOrderProjection(ctx, () => ctx.db.get(id)),
	));
	return new Map(versions.flatMap(version => version ? [[version._id, {
		contents: version.contents, estimatedSplit: version.estimatedSplit,
	}] as const] : []));
}

async function readIssuedBenefits(ctx: QueryCtx, lines: readonly Doc<'orderLines'>[]) {
	const contents = lines.flatMap(line => (line.saleSnapshot?.contents ?? []).map(content => ({ lineId: line._id, ...content })));
	const grants = contents.flatMap(({ lineId, contentKey, grantId }) => grantId ? [{ lineId, contentKey, grantId }] : [])
		.slice(0, COMMERCE_LIMITS.sale.sessionGrants);
	const vouchers = contents.flatMap(({ lineId, contentKey, voucherId }) => voucherId ? [{ lineId, contentKey, voucherId }] : [])
		.slice(0, COMMERCE_LIMITS.sale.voucherIssuances);
	const benefits = await Promise.all([
		...grants.map(async ({ lineId, contentKey, grantId }) => {
			const grant = await readOrderProjection(ctx, () => ctx.db.get(grantId));
			if (grant?.lineId !== lineId || grant.contentKey !== contentKey) return null;
			return { lineId, contentKey, issuedExpiresAt: grant.issuedTerms.expiresAt, unusedPaidSessions: grant.paidUnits,
				editHistory: { targetType: 'grant' as const, targetId: grant._id } };
		}),
		...vouchers.map(async ({ lineId, contentKey, voucherId }) => {
			const voucher = await readOrderProjection(ctx, () => ctx.db.get(voucherId));
			if (!voucher || voucher.source.kind === 'refund_credit' || voucher.source.lineId !== lineId) return null;
			if (voucher.source.kind === 'package' && voucher.source.contentKey !== contentKey) return null;
			const codeMask = await voucherCodeMask(ctx, voucher);
			return { lineId, contentKey, issuedExpiresAt: voucher.issuedExpiresAt, ...(codeMask ? { codeMask } : {}),
				editHistory: { targetType: 'voucher' as const, targetId: voucher._id } };
		}),
	]);
	return benefits.filter(benefit => benefit !== null);
}

/** Voucher spends with the voucher's current masked code, so the receipt reads "Gift voucher GV-••••-7PAX". */
async function readVoucherTenders(ctx: QueryCtx, payments: readonly Doc<'orderPayments'>[]) {
	return await Promise.all(payments.flatMap(payment => payment.method === 'voucher' ? [payment] : []).map(async payment => {
		const voucher = await readOrderProjection(ctx, () => ctx.db.get(payment.voucherId));
		const codeMask = voucher ? await voucherCodeMask(ctx, voucher) : null;
		return { ...payment, ...(codeMask ? { codeMask } : {}) };
	}));
}

function returnCreditMask(mask: string | null | undefined) {
	return mask && /^(?:GV-)?••••[- ]?[A-Z0-9]{4}$/i.test(mask) ? mask : null;
}

async function readReturnVoucherCredits(
	ctx: QueryCtx, credits: Doc<'orderReturns'>['voucherCredits'], tenders: Awaited<ReturnType<typeof readVoucherTenders>>,
) {
	const tenderMasks = new Map(tenders.map(tender => [tender.voucherId, returnCreditMask(tender.codeMask)]));
	const lookedUp = new Map<Id<'vouchers'>, Promise<string | null>>();
	const lookup = (voucherId: Id<'vouchers'>) => {
		const previous = lookedUp.get(voucherId);
		if (previous) return previous;
		if (lookedUp.size >= COMMERCE_LIMITS.sale.distinctFundingVouchers) return null;
		const read = readOrderProjection(ctx, () => ctx.db.get(voucherId))
			.then(async voucher => returnCreditMask(voucher ? await voucherCodeMask(ctx, voucher) : null));
		lookedUp.set(voucherId, read);
		return read;
	};
	return await Promise.all(credits.map(async credit => {
		if (credit.destination?.kind === 'newVoucher') return { ...credit, destination: credit.destination };
		const voucherId = credit.destination?.voucherId ?? credit.voucherId;
		const codeMask = returnCreditMask(credit.destination?.codeMask) ?? tenderMasks.get(voucherId) ?? await lookup(voucherId);
		return { ...credit, destination: { kind: 'existingVoucher' as const, voucherId, codeMask } };
	}));
}

async function readReceiptRefunds(ctx: QueryCtx, order: Doc<'orders'>, settled: boolean, commerce: boolean) {
	if (!settled || commerce) return [];
	// Pre-commerce receipts have no aggregate. Preserve their existing totals and truncation cap.
	return readOrderProjection(ctx, () => orderRefunds(ctx, order._id, true));
}

export const getOrder = staffQuery({
  capability: 'checkout',
	// Deep links are untrusted strings. Normalize after auth so a bad link is recoverable,
	// rather than failing argument validation before checkout can render its recovery controls.
	args: { orderId: v.string(), view: v.optional(v.literal('checkout')) },
	handler: async (ctx, args) => {
		const actor = ctx.staff;
		const orderId = ctx.db.normalizeId('orders', args.orderId);
		if (!orderId) return null;
		const order = await readOrderProjection(ctx, () => ctx.db.get(orderId));
		if (!order || !canAccessCheckoutOrderBranch(actor, order)) return null;
		const settled = order.status === 'paid' || order.status === 'void';
		const activeReturn = order.status === 'paid' ? await openOrderReturn(ctx, orderId) : null;
		if (!canReadCheckoutOrder(actor, order) && activeReturn?.operator !== actor.tokenIdentifier) return null;
		const open = isOpenOrder(order);
		// The till needs operational data while the order is draft. Preserve the full receipt for
		// existing callers and when a subscribed order becomes paid, void or discarded.
		const receiptHistory = args.view !== 'checkout' || !open;
		const read = <T>(fetch: () => Promise<T>) => readOrderProjection(ctx, fetch);
		const [lines, payments, audit, customer, parent, refunds, corrections, appointmentRefunds, activeLinks, unlinkedHistory, paymentAttempt] = await Promise.all([
			read(() => orderLines(ctx, order._id)),
			read(() => ctx.db.query('orderPayments').withIndex('by_orderId', (q) => q.eq('orderId', order._id)).take(10)),
			receiptHistory ? read(() => ctx.db.query('orderAudit').withIndex('by_orderId_and_at', (q) => q.eq('orderId', order._id)).order('desc').take(50)) : [],
			order.customerId ? read(() => ctx.db.get(order.customerId!)) : null,
			order.parentOrderId ? read(() => ctx.db.get(order.parentOrderId!)) : null,
			receiptHistory ? read(() => ctx.db.query('bookingRefunds').withIndex('by_orderId', (q) => q.eq('orderId', order._id)).take(MAX_STAY_ROWS)) : [],
			receiptHistory ? read(() => ctx.db.query('orderCorrections').withIndex('by_orderId_and_sequence', (q) => q.eq('orderId', order._id)).order('desc').take(20)) : [],
			receiptHistory ? read(() => ctx.db.query('appointmentRefunds').withIndex('by_orderId', q => q.eq('orderId', order._id)).order('desc').take(MAX_STAY_ROWS)) : [],
			open ? [] : read(() => orderLineLinks(ctx, order._id, 'active')),
			open ? [] : read(() => orderLineLinks(ctx, order._id, 'unlinked')),
			readPaymentAttempt(ctx, order),
		]);
		const links = [...activeLinks, ...unlinkedHistory];
		const voucherPayments = voucherOrderPayments(payments);
		const [handovers, issuedBenefits, draftPackages, voucherTenders] = await Promise.all([
			readHandovers(ctx, order, lines),
			readIssuedBenefits(ctx, lines),
			open ? readDraftPackages(ctx, lines) : null,
			readVoucherTenders(ctx, voucherPayments),
		]);
		const returnVoucherCredits = activeReturn ? await readReturnVoucherCredits(ctx, activeReturn.voucherCredits, voucherTenders) : [];
		const unlimitedIssuedBenefits = issuedBenefits.filter(benefit => benefit.issuedExpiresAt === null);
		const totals = receiptTotals(order, lines);
		const commerce = isCommerceReceipt(order, lines, voucherPayments.length > 0);
		const correctionBlocker = settled ? correctionPreviewBlocker(commerce, activeReturn) : null;
		const posRefunds = await readReceiptRefunds(ctx, order, settled, commerce);
		const refundHistoryTruncated = posRefunds.length > MAX_ORDER_REFUNDS;
		const refundedByLine = new Map<Id<'orderLines'>, number>();
		for (const refund of posRefunds) refundedByLine.set(refund.lineId, (refundedByLine.get(refund.lineId) ?? 0) + refund.amount);
		const refundedAmountSatang = commerce ? order.returnedTotal ?? 0 : posRefunds.reduce((sum, row) => sum + row.amount, 0);
		const returnedAmountSatang = lines.reduce((sum, line) => sum + (line.saleSnapshot?.returnedAmount ?? 0), 0);
		// A completed return issued gift slips (a voucher-only return refunds no cash): the receipt reads them back.
		const replacementSlips = commerce && order.status === 'paid' && returnedAmountSatang > 0 && await read(() => ctx.db.query('orderReturns')
			.withIndex('by_orderId_and_hasReplacementSlips', q => q.eq('orderId', order._id).eq('hasReplacementSlips', true)).first()) !== null;
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
		const staffNames = new Map<Id<'staff'>, string>();
		for (const id of new Set(lines.flatMap((line) => (line.staffId && (!settled || line.staffName == null) ? [line.staffId] : [])))) {
			const person = await read(() => ctx.db.get(id));
			if (person) staffNames.set(id, person.name);
		}
		const photos = new Map<string, Promise<string | undefined>>();
		const rows = [];
		for (const line of lines) {
			const photoKey = line.serviceId ?? line.propertyId ?? line.bookingId;
			if (photoKey && !photos.has(photoKey)) photos.set(photoKey, linePhoto(ctx, line, reads));
			const stay = line.bookingId ? await reads.booking(line.bookingId) : null;
			// Optional at the type boundary so existing offline checkout adapters remain compatible.
			const refunded = commerce ? line.saleSnapshot?.returnedAmount ?? 0 : refundedByLine.get(line._id) ?? 0;
			const refundAmounts: { refundedAmountSatang?: number; remainingRefundableSatang?: number } = {
				refundedAmountSatang: refunded,
				remainingRefundableSatang: !commerce && posRefunds.length < MAX_ORDER_REFUNDS && order.status === 'paid' && order.paidAt !== undefined && isWalkInLine(line) && !activeLinks.some(link => link.lineId === line._id)
					? Math.max(0, lineNet(line) - refunded) : 0,
			};
			const goodwillDiscount = lineGoodwillDiscount(line);
			const draftPackage = !line.saleSnapshot && line.packageVersionId ? draftPackages?.get(line.packageVersionId) : undefined;
			const durationMin = lineDuration(line);
			rows.push({
				...line,
				...(durationMin === undefined ? {} : { durationMin }),
				name: line.saleSnapshot?.label ?? line.name,
				net: lineNet(line) - goodwillDiscount,
				...(goodwillDiscount ? { goodwillDiscount } : {}),
				...(draftPackage ? { draftPackage } : {}),
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
			posRefunds: posRefunds.slice(-RECEIPT_REFUNDS).reverse().map(orderRefundView), refundedAmountSatang,
			fullyRefunded: !refundHistoryTruncated && order.status === 'paid' && totals.total > 0 && (commerce ? returnedAmountSatang === totals.total : refundedAmountSatang === totals.total),
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
			...(commerce ? {
				commerce: {
					returnedAmountSatang,
					...(replacementSlips ? { hasReplacementSlips: true as const } : {}),
          ...(order.status === 'paid' && !activeReturn ? { returnableVisitParts: await receiptVisitReturnParts(ctx, lines, activeLinks) } : {}),
					issuedBenefits: issuedBenefits.flatMap(benefit => benefit.issuedExpiresAt === null ? [] : [{ ...benefit, issuedExpiresAt: benefit.issuedExpiresAt }]),
					...(unlimitedIssuedBenefits.length ? { unlimitedIssuedBenefits } : {}),
					handovers: handovers.map(handoverView),
					editHistory: { targetType: 'order' as const, targetId: order._id },
				},
			} : {}),
			...(activeReturn ? { activeReturn: {
				_id: activeReturn._id, status: activeReturn.status, parts: activeReturn.parts, claims: activeReturn.claims.map(publicReturnClaim),
				voucherCredits: returnVoucherCredits, operator: activeReturn.operator, tillId: activeReturn.tillId,
				operatorRevision: activeReturn.operatorRevision, approvalId: activeReturn.approvalId, reason: activeReturn.reason,
				createdAt: activeReturn.createdAt,
			} } : {}),
			...(paymentAttempt ? { paymentAttempt } : {}),
			...(correctionBlocker ? { correctionBlocker } : {}),
			/** R2b: the order's coupon; the split is on each row's `couponDiscount`, the total in `totals.coupon`. */
			promotion,
			/** As recorded when the receipt was issued; never changed (see `paymentRecord` for corrections). */
			payments: externalOrderPayments(payments),
			...(voucherTenders.length ? { voucherPayments: voucherTenders } : {}),
			audit,
			totals,
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
export const listOrders = staffQuery({
	capability: 'operations',
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
			if (canAccessCheckoutOrderBranch(ctx.staff, order)) rows.push(await orderListRow(ctx, order));
		}
		return { ...page, page: rows };
	}
});

/** The order with this number, for "go to order #". */
export const findOrderByNumber = staffQuery({
  capability: 'checkout',
	args: { orderNumber: v.number(), receipt: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const actor = ctx.staff;
		if (!Number.isSafeInteger(args.orderNumber) || args.orderNumber < 1) return null;
		const order = await readOrderProjection(ctx, () => args.receipt
      ? ctx.db.query('orders').withIndex('by_receiptNumber', q => q.eq('receiptNumber', args.orderNumber)).first()
      : ctx.db.query('orders').withIndex('by_orderNumber', q => q.eq('orderNumber', args.orderNumber)).first());
    if (!order || !canAccessCheckoutOrderBranch(actor, order)) return null;
    if (canReadCheckoutOrder(actor, order)) return order._id;
    const active = order.status === 'paid' ? await openOrderReturn(ctx, order._id) : null;
    return active?.operator === actor.tokenIdentifier ? order._id : null;
	}
});

/**
 * A booking's or appointment's orders for its detail screen: where checkout continues (the open
 * order, if any), recent orders and what is owed on the source itself.
 */
export const ordersForBooking = staffQuery({
	capability: 'operations',
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
		if (active && !canAccessCheckoutOrderBranch(ctx.staff, active)) active = null;
		const recentOrders = await ordersForSource(ctx, source, 6);
		const recent = recentOrders.filter(order => canAccessCheckoutOrderBranch(ctx.staff, order));
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
		const knownOrders = new Map(recentOrders.map(order => [order._id, order]));
		const refundRows = await Promise.all(refunds.slice(0, 10).map(async refund => {
			const linked = refund.orderId && !ctx.staff.companyScope
				? knownOrders.get(refund.orderId) ?? await ctx.db.get(refund.orderId)
				: null;
			const orderId = linked && !canAccessCheckoutOrderBranch(ctx.staff, linked) ? null : refund.orderId ?? null;
			return { _id: refund._id, amount: refund.amount, method: refund.method, reason: refund.reason, effectiveAt: refund.effectiveAt, orderId };
		}));
		return {
			balance: { total, paid: roundMoney(paid), owed: Math.max(roundMoney(owed), 0), refunded, credit },
			/** Recorded refunds on the stay, newest first (none for appointments here; see adminServices). */
			refunds: refundRows,
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
		if (!canReadCheckoutOrder(actor, await ctx.db.get(args.orderId))) throw new ConvexError('Order not found');
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
		if (!order || !canAccessCheckoutOrderBranch(ctx.staff, order)) return null;
		if (!ctx.staff.capabilities.orders) return null;
		if (order.status !== 'discarded') return { discarded: null, revision: order.revision, conflicts: [], blocking: 0, rowsLeft: 0 };
		const lines = await orderLines(ctx, order._id);
		const conflicts = await restoreConflicts(ctx, order, lines, ctx.staff);
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
export const appointmentFees = staffQuery({
	capability: 'operations',
	args: { appointmentId: v.id('appointments') },
	handler: async (ctx, args) => {
		const rows = await ctx.db.query('orderLines').withIndex('by_feeAppointmentId', (q) => q.eq('feeAppointmentId', args.appointmentId)).order('desc').take(20);
		const fees = [];
		for (const line of rows) {
			const order = await ctx.db.get(line.orderId);
			if (!order || !line.fee || !canAccessCheckoutOrderBranch(ctx.staff, order)) continue;
			fees.push({
				lineId: line._id, kind: line.fee.kind, amount: lineNet(line), currency: line.currency, reason: line.fee.reason ?? null, by: line.fee.by, at: line.fee.at,
				order: { _id: order._id, title: orderTitle(order.orderNumber), state: orderState(order), receiptNumber: order.receiptNumber ?? null }
			});
		}
		return fees;
	}
});

async function orderListRow(ctx: QueryCtx, order: Doc<"orders">) {
		const sources = await orderSourceRefs(ctx, order, await sourceRows(ctx, order._id));
			const refundAmounts: { refundedAmountSatang?: number } = { refundedAmountSatang: order.returnedTotal ?? await orderRefundTotal(ctx, order._id) };
		const paidAt = order.paymentEffectiveAt ?? order.paidAt;
		const paymentTime: { paidAt?: number } = paidAt === undefined ? {} : { paidAt };
			return {
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
				...paymentTime,
				receiptNumber: order.receiptNumber,
				customerName: await customerName(ctx, order),
				/** The order's booking, as in its header (see orderSourceRefs). */
				bookingReference: sources[0]?.reference,
				/** How many more bookings it is for. */
				otherBookings: Math.max(sources.length - 1, 0),
				...discardedField(order)
			};
}

/** Open orders with items that this checkout actor can recall, in the Orders browser's order. */
export const listOpenOrders = staffQuery({
  capability: 'checkout',
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const actor = ctx.staff;
		const numItems = Math.min(Math.max(args.paginationOpts.numItems, 1), ORDERS_PAGE_MAX);
		const page = await ctx.db.query('orders')
			.withIndex('by_hasItems_and_status_and_updatedAt', q => q.eq('hasItems', true).eq('status', 'draft'))
			.order('desc')
			.paginate({ ...args.paginationOpts, numItems });
		// Paginate before the access check: never scan beyond this bounded page to fill it.
		// The current read rule permits every draft/held order, irrespective of its creator.
		const rows = [];
		for (const order of page.page) {
			if (canReadCheckoutOrder(actor, order)) rows.push(await orderListRow(ctx, order));
		}
		return { ...page, page: rows };
	}
});
