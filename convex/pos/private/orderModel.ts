import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { isDocumentedLiveRefund } from '../../bookings/model';
import { attemptKey } from '../../lib/bookingMoney';
import { couponVersion } from '../../lib/couponRedemptions';
import { resortTodayIso } from '../../lib/dates';
import { correctedTender } from '../../lib/financeValidators';
import { DISCARDED_ORDER, feeBlocker, feePriceBlocker, liveFees, otherFeeMessage } from '../../lib/orderLifecycle';
import { MAX_LINES, orderLines } from '../../lib/orderLines';
import { insertOrder, isOpenOrder, linkedOpenOrder, openOrderCharging, ordersForSource, type OrderSource } from '../../lib/orderLinks';
import { assertOrderSize, bookingBalance, bookingChargeTotal, orderTitle, orderTotals } from '../../lib/orderMath';
import { evaluateOrderCoupon, posCouponMessage, type OrderCouponResult, type PosCouponProblem } from '../../lib/posCoupons';
import { appendRecordHistory } from '../../lib/recordHistory';
import { resortLocalParts } from '../../lib/serviceSlots';
import { assertCashierDiscount, type StaffActor } from '../../lib/staffAccess';
import { lineDiscountValidator } from '../../lib/staffTypes';

/**
 * Staff POS orders. An order is the persistent commercial record: a permanent order number,
 * its items, payments and receipt. It is a server draft (so it can be saved and reopened on any
 * device) until settleOrder pays it in one transaction: payments, the receipt number and the
 * charged bookings and appointments are written together, or not at all.
 *
 * Orders live in the `orders` table (and their rows in `orderLines`) so ids, payments and audit
 * history from before orders had numbers stay valid. See lib/orderLinks.ts for how orders relate
 * to bookings and appointments, and customers.ts for the optional customer link.
 */

export const FREQUENT_SCAN = 300;

export const FREQUENT_COUNT = 8;

export const ORDERS_PAGE_MAX = 50;

export const ATTACH_SCAN = 20;

/** Unpaid appointments from before the lookup fields that Add booking still matches directly. */
export const PAYABLE_LOOKUP_SCAN = 500;

export const CURRENCY = 'THB';

export const discountValidator = lineDiscountValidator;

export const tenderValidator = v.object({
	method: v.union(v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer')),
	amount: v.number(),
	received: v.optional(v.number())
});

export const itemValidator = v.union(
	v.object({ kind: v.literal('service'), serviceId: v.id('services') }),
	v.object({ kind: v.literal('room'), propertyId: v.id('properties') }),
	v.object({ kind: v.literal('extra'), name: v.string(), price: v.number() })
);

export const sourceArgs = { bookingId: v.optional(v.id('bookings')), appointmentId: v.optional(v.id('appointments')) };

export type ReadCtx = QueryCtx | MutationCtx;

export type Order = Doc<'orders'>;

export type Line = Doc<'orderLines'>;

export type LineFields = Omit<Line, '_id' | '_creationTime' | 'orderId' | 'createdAt' | 'catalogUnitPrice'> & { catalogUnitPrice?: number };

export type JoinTable = 'bookings' | 'properties' | 'appointments' | 'services';

/** Source joins as plain reads: what every mutation uses, so nothing read before a write is reused after it. */
export function directReads(ctx: ReadCtx) {
	const get = <T extends JoinTable>(table: T) => (id: Id<T>) => ctx.db.get(table, id);
	return { booking: get('bookings'), property: get('properties'), appointment: get('appointments'), service: get('services') };
}

export type OrderReads = ReturnType<typeof directReads>;

/** Query-only: one getOrder invocation shares each join's promise, including missing docs. */
export function orderReads(ctx: QueryCtx): OrderReads {
	const direct = directReads(ctx);
	function reuse<T extends JoinTable>(read: (id: Id<T>) => Promise<Doc<T> | null>) {
		const pending = new Map<Id<T>, Promise<Doc<T> | null>>();
		return (id: Id<T>) => {
			let result = pending.get(id);
			if (!result) pending.set(id, (result = read(id)));
			return result;
		};
	}
	return { booking: reuse(direct.booking), property: reuse(direct.property), appointment: reuse(direct.appointment), service: reuse(direct.service) };
}

/** Why a booking or appointment row can't be paid as it stands. `changed` can be updated in place; `settled` and `gone` rows must go. */
export type SourceIssue = { kind: 'changed' | 'settled' | 'gone' | 'online'; message: string };

export const FEE_FIXED = 'A fee row keeps the amount it was added with. Remove it and add the fee again with the right amount.';

export const ATTACHED_PRICE = 'A stay is charged at its booked price. Set a custom price on the booking (Edit booking → Custom price), then update the row.';

export const ONLINE_CHECKOUT = 'Online checkout is in progress. Wait for it to finish or expire before taking payment at the desk.';

/** Orders are in baht; a price in another currency is refused rather than read as baht. */
export function assertBaht(currency: string, what: string) {
	if (currency !== CURRENCY) throw new ConvexError(`${what} is priced in ${currency}. Checkout takes ${CURRENCY} only.`);
}

export function oneSource(args: { bookingId?: Id<'bookings'>; appointmentId?: Id<'appointments'> }): OrderSource {
	if (Boolean(args.bookingId) === Boolean(args.appointmentId)) throw new ConvexError('Choose one booking or appointment');
	return args.bookingId ? { bookingId: args.bookingId } : { appointmentId: args.appointmentId! };
}

/** The order to change, created on first use. Paid and void orders never change. */
export async function editableOrder(ctx: MutationCtx, orderId: Id<'orders'> | undefined, actor: string): Promise<Order> {
	if (!orderId) return await insertOrder(ctx, actor);
	const order = await ctx.db.get(orderId);
	if (!order) throw new ConvexError('Order not found');
	if (order.status === 'paid') throw new ConvexError('This order is already paid');
	if (order.status === 'void') throw new ConvexError('This order was voided');
	if (order.status === 'discarded') throw new ConvexError(DISCARDED_ORDER);
	return order;
}

export async function editableLine(ctx: MutationCtx, lineId: Id<'orderLines'>, actor: string) {
	const line = await ctx.db.get(lineId);
	if (!line) throw new ConvexError('Item not found');
	const order = await editableOrder(ctx, line.orderId, actor);
	return { line, order };
}

export function orderCouponUnavailable(problem: PosCouponProblem, couponCode?: string): never {
	throw new ConvexError({ code: 'coupon_unavailable', message: posCouponMessage(problem), problem, ...(couponCode ? { couponCode } : {}) });
}

/**
 * Frozen benefit and eligibility, live status and counters, and the real business date; drafts
 * reserve nothing. The usage limit and budget always come from the current version: they are how
 * a marketer stops a promotion, so lowering them stops open orders too.
 */
export async function quoteOrderCoupon(ctx: ReadCtx, lines: Array<Pick<Line, 'kind' | 'unitPrice' | 'qty' | 'discount' | 'priceOverride' | 'couponDiscount' | 'bookingId' | 'fee'> & { _id: string }>, couponId: Id<'coupons'>, version: number): Promise<OrderCouponResult> {
	const coupon = await ctx.db.get(couponId);
	if (!coupon) return { ok: false, problem: { code: 'not_found' } };
	const rules = await couponVersion(ctx, couponId, version);
	const limits = coupon.currentVersion === version ? rules : await couponVersion(ctx, couponId, coupon.currentVersion);
	let usedOnAttachedStay = false;
	for (const bookingId of new Set(lines.flatMap(line => line.bookingId ? [line.bookingId] : []))) {
		if ((await ctx.db.get(bookingId))?.promotion?.couponId === couponId) usedOnAttachedStay = true;
	}
	return evaluateOrderCoupon({
		lines: lines.map(line => ({ ...line, id: line._id })), today: resortTodayIso(), usedOnAttachedStay,
		coupon: { ...rules, usageLimit: limits.usageLimit, discountBudget: limits.discountBudget, code: coupon.code, version, status: coupon.status,
			used: coupon.used, held: coupon.held, discountGranted: coupon.discountGranted, heldDiscount: coupon.heldDiscount }
	});
}

/** Only changed shares are written; absent shares stay absent on excluded rows. */
export async function writeCouponShares(ctx: MutationCtx, lines: Line[], result: OrderCouponResult | null) {
	const shares = new Map(result?.ok ? result.allocation.map(share => [share.lineId, share.discount]) : []);
	for (const line of lines) {
		const couponDiscount = shares.get(line._id);
		if (line.couponDiscount !== couponDiscount) await ctx.db.patch(line._id, { couponDiscount });
		line.couponDiscount = couponDiscount;
	}
}

/** Keeps the order's item count, total and due in step with its lines, and marks it changed. */
export async function refreshOrder(ctx: MutationCtx, orderId: Id<'orders'>) {
	const [order, lines] = await Promise.all([ctx.db.get(orderId), orderLines(ctx, orderId)]);
	if (!order || !isOpenOrder(order)) throw new Error('Only an unpaid order can be refreshed');
	if (order.promotion) {
		const result = await quoteOrderCoupon(ctx, lines, order.promotion.couponId, order.promotion.couponVersion);
		await writeCouponShares(ctx, lines, result);
		// The code can be renamed before its first use; show the one the coupon has now.
		const code = (await ctx.db.get(order.promotion.couponId))?.code ?? order.promotion.code;
		await ctx.db.patch(orderId, { promotion: { ...order.promotion, code, discount: result.ok ? result.discount : 0, problem: result.ok ? undefined : result.problem } });
	}
	const totals = orderTotals(lines);
	assertOrderSize(totals);
	// An explicit booking-owned order keeps its identity when emptied. A link acquired only
	// by attaching a row lasts as long as at least one row still belongs to that source.
	let releaseSource = order?.implicitSourceLink === true;
	if (releaseSource) {
		for (const line of lines) {
			if (order!.bookingId && line.bookingId === order!.bookingId) { releaseSource = false; break; }
			const appointmentId = line.appointmentId ?? line.feeAppointmentId;
			if (!appointmentId) continue;
			if (order!.appointmentId === appointmentId) { releaseSource = false; break; }
			if (order!.bookingId && (await ctx.db.get(appointmentId))?.bookingId === order!.bookingId) { releaseSource = false; break; }
		}
	}
	await ctx.db.patch(orderId, {
		...(releaseSource ? { bookingId: undefined, appointmentId: undefined, implicitSourceLink: undefined } : {}),
		itemCount: lines.reduce((n, line) => n + line.qty, 0),
		total: totals.total,
		due: totals.due,
		hasItems: lines.length > 0,
		revision: order!.revision + 1,
		updatedAt: Date.now()
	});
}

export async function assertRoom(ctx: MutationCtx, orderId: Id<'orders'>) {
	if ((await orderLines(ctx, orderId)).length >= MAX_LINES) throw new ConvexError(`An order holds at most ${MAX_LINES} items`);
}

export function cleanText(value: string | undefined, label: string, max = 200) {
	const trimmed = value?.trim();
	if (trimmed && trimmed.length > max) throw new ConvexError(`${label} must be at most ${max} characters`);
	return trimmed || undefined;
}

/** What a row was, for order history: every business field, nothing derived. */
export function lineSnapshot(line: LineFields | Line) {
	const fields = {
		kind: line.kind, name: line.name, detail: line.detail, unitPrice: line.unitPrice, currency: line.currency, qty: line.qty,
		discount: line.discount, priceOverride: line.priceOverride ? { price: line.priceOverride.price, note: line.priceOverride.note } : undefined,
		staffId: line.staffId, startAt: line.startAt, serviceDate: line.schedule?.date, serviceTime: line.schedule?.time,
		serviceId: line.serviceId, propertyId: line.propertyId,
		bookingId: line.bookingId, appointmentId: line.appointmentId, deposit: line.deposit,
		feeAppointmentId: line.feeAppointmentId, feeKind: line.fee?.kind,
		...('_id' in line ? { lineId: line._id } : {})
	};
	return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/**
 * Ordinary order edits (rows added, changed, removed, cleared) in the shared history
 * (recordChanges, entity type `order`), in the same transaction as the edit. Money events
 * (payment, void, price overrides, source updates) stay in orderAudit and orderCorrections.
 */
export async function logOrder(ctx: MutationCtx, orderId: Id<'orders'>, actor: string, kind: string, change: { before?: unknown; after?: unknown; reason?: string }) {
	await appendRecordHistory(ctx, {
		entityType: 'order', entityId: orderId, actor, kind,
		...(change.reason ? { reason: change.reason } : {}),
		...(change.before !== undefined ? { before: change.before } : {}),
		...(change.after !== undefined ? { after: change.after } : {})
	});
}

export function appointmentAttachable(appointment: Doc<'appointments'>) {
	return appointment.paymentStatus === 'unpaid' && appointment.status !== 'cancelled' && appointment.status !== 'no_show';
}

export function bookingCheckoutBlock(booking: Doc<'bookings'>) {
	return booking.paymentStatus !== 'paid' && (booking.stripeCheckoutExpiresAt ?? 0) > Date.now() ? ONLINE_CHECKOUT : null;
}

export function bookingClosedReason(booking: Doc<'bookings'>) {
	if (booking.status === 'cancelled') return 'This booking was cancelled';
	if (booking.paymentStatus === 'failed') return 'This booking’s payment failed; reopen it first';
	if (booking.paymentStatus === 'refunded' && !isDocumentedLiveRefund(booking)) return 'This booking was marked refunded without refund amounts; reopen it first';
	return null;
}

export const bookingClosed = (booking: Doc<'bookings'>) => bookingClosedReason(booking) !== null;

/** Open to charges and still owing something (net of refunds and waived provider charges). */
export function bookingPayable(booking: Doc<'bookings'>) {
	return !bookingClosed(booking) && bookingBalance(booking).owed > 0;
}

export async function bookingLine(ctx: ReadCtx, booking: Doc<'bookings'>, reads: OrderReads = directReads(ctx)) {
	const property = await reads.property(booking.propertyId);
	const { paid } = bookingBalance(booking);
	return {
		kind: 'booking' as const,
		bookingId: booking._id,
		name: `Stay · ${property?.name ?? 'Villa'}`,
		detail: `${booking.checkIn} → ${booking.checkOut} · ${booking.nights} ${booking.nights === 1 ? 'night' : 'nights'}${booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}${booking.providerRefundWaived ? ` · ${booking.providerRefundWaived / 100} ${booking.currency} refunded charge waived` : ''}`,
		unitPrice: bookingChargeTotal(booking),
		// Booking overrides are authorized by operations (Owner/Manager); checkout starts at that agreed charge.
		catalogUnitPrice: bookingChargeTotal(booking),
		currency: booking.currency,
		qty: 1,
		...(paid > 0 ? { deposit: paid } : {})
	};
}

export async function appointmentLine(ctx: ReadCtx, appointment: Doc<'appointments'>) {
	const service = await ctx.db.get(appointment.serviceId);
	const { date, time } = resortLocalParts(appointment.start);
	return {
		kind: 'appointment' as const,
		appointmentId: appointment._id,
		serviceId: appointment.serviceId,
		name: service?.name ?? 'Appointment',
		detail: `${date} ${time} · ${appointment.confirmationCode}`,
		unitPrice: appointment.price,
		catalogUnitPrice: appointment.price,
		currency: appointment.currency,
		qty: 1,
		staffId: appointment.staffId,
		startAt: appointment.start
	};
}

/**
 * Whether a booking or appointment row still matches its source. Rows are a snapshot taken when
 * they were added; payment is refused until a changed row is updated (or a settled one removed),
 * so a stay edited, paid online or cancelled meanwhile is never charged stale or twice.
 */
export async function sourceIssue(ctx: ReadCtx, line: Line, reads: OrderReads = directReads(ctx)): Promise<SourceIssue | null> {
	if (line.bookingId) {
		const booking = await reads.booking(line.bookingId);
		if (!booking) return { kind: 'gone', message: 'This booking no longer exists. Remove it from the order.' };
		const closed = bookingClosedReason(booking);
		if (closed) return { kind: 'settled', message: `${closed}. Remove it from the order.` };
		if (!bookingPayable(booking)) return { kind: 'settled', message: 'This stay was paid since it was added. Remove it from the order.' };
		const blocked = bookingCheckoutBlock(booking);
		if (blocked) return { kind: 'online', message: blocked };
		const fresh = await bookingLine(ctx, booking, reads);
		if (
			fresh.currency !== line.currency || fresh.name !== line.name || fresh.detail !== line.detail ||
			fresh.unitPrice !== line.unitPrice || (fresh.deposit ?? 0) !== (line.deposit ?? 0)
		) {
			return { kind: 'changed', message: 'The booking changed since it was added (villa, dates, price or deposit). Update the row and review the total.' };
		}
	}
	if (line.appointmentId) {
		const appointment = await reads.appointment(line.appointmentId);
		if (!appointment) return { kind: 'gone', message: 'This appointment no longer exists. Remove it from the order.' };
		if (!appointmentAttachable(appointment)) return { kind: 'settled', message: 'This appointment was paid or cancelled since it was added. Remove it from the order.' };
		if (
			appointment.currency !== line.currency || appointment.price !== line.unitPrice || appointment.serviceId !== line.serviceId ||
			appointment.staffId !== line.staffId || appointment.start !== line.startAt
		) {
			return { kind: 'changed', message: 'The appointment changed since it was added (service, therapist, time or price). Update the row and review the total.' };
		}
	}
	if (line.feeAppointmentId && line.fee) {
		const appointment = await reads.appointment(line.feeAppointmentId);
		if (!appointment) return { kind: 'gone', message: 'The appointment this fee is for no longer exists. Remove the fee from the order.' };
		const blocked = feeBlocker(appointment, line.fee.kind) ?? feePriceBlocker(line.unitPrice, appointment) ?? otherFeeMessage((await liveFees(ctx, appointment._id, line.orderId))[0]);
		if (blocked) return { kind: 'settled', message: `${blocked} Remove the fee from the order.` };
	}
	return null;
}

export const isSourceRow = (line: Line) => Boolean(line.bookingId || line.appointmentId || line.feeAppointmentId);

/**
 * Makes an order with no booking of its own the order of the stay (or standalone appointment)
 * first charged on it, so opening that booking later finds this order. Skipped if that booking
 * already has another open order of its own, usually the empty one created with it: that order
 * stays the booking's (for later extras), and this one still lists the booking because it charges
 * it (see orderSourceRefs).
 */
export async function linkFirstSource(ctx: MutationCtx, order: Order, source: OrderSource, appointment?: Doc<'appointments'>) {
	if (order.bookingId || order.appointmentId) return;
	const bookingId = 'bookingId' in source ? source.bookingId : appointment?.bookingId;
	const link: OrderSource = bookingId ? { bookingId } : source;
	const other = await linkedOpenOrder(ctx, link);
	if (other && other._id !== order._id) return;
	await ctx.db.patch(order._id, { ...('bookingId' in link ? { bookingId: link.bookingId } : { appointmentId: link.appointmentId }), implicitSourceLink: true });
}

/** Charges a booking or appointment on the order. Customer and guest details are left alone. */
export async function attachTo(ctx: MutationCtx, order: Order, source: OrderSource, actor: StaffActor) {
	await assertRoom(ctx, order._id);
	let line: LineFields;
	let appointment: Doc<'appointments'> | undefined;
	const other = await openOrderCharging(ctx, source);
	const what = 'bookingId' in source ? 'This booking' : 'This appointment';
	if (other) throw new ConvexError(other._id === order._id ? `${what} is already on this order` : `${what} is already on ${orderTitle(other.orderNumber)}`);
	if ('bookingId' in source) {
		const booking = await ctx.db.get(source.bookingId);
		if (!booking) throw new ConvexError('Booking not found');
		if (!bookingPayable(booking)) throw new ConvexError('This booking has nothing left to pay');
		const blocked = bookingCheckoutBlock(booking);
		if (blocked) throw new ConvexError(blocked);
		assertBaht(booking.currency, 'This booking');
		line = await bookingLine(ctx, booking);
	} else {
		appointment = (await ctx.db.get(source.appointmentId)) ?? undefined;
		if (!appointment) throw new ConvexError('Appointment not found');
		if (!appointmentAttachable(appointment)) throw new ConvexError('This appointment has nothing left to pay');
		assertBaht(appointment.currency, 'This appointment');
		line = await appointmentLine(ctx, appointment);
	}
	// Only this new source line is subject to the cashier ceiling; approved existing rows stay usable.
	await assertCashierDiscount(ctx, actor, line);
	const lineId = await ctx.db.insert('orderLines', { orderId: order._id, ...line, catalogUnitPrice: line.catalogUnitPrice ?? line.unitPrice, createdAt: Date.now() });
	await linkFirstSource(ctx, order, source, appointment);
	await refreshOrder(ctx, order._id);
	await logOrder(ctx, order._id, actor.email, 'source_attached', { after: { ...lineSnapshot(line), lineId } });
}

/** The newest paid order for a source, which a later charge on it follows. */
export async function lastPaidOrder(ctx: ReadCtx, source: OrderSource) {
	return (await ordersForSource(ctx, source)).find((order) => order.status === 'paid');
}

/**
 * A booking an order is for, as checkout, the orders list and the receipt show it. `linked` is
 * true for the order's own booking (`orders.bookingId` / `appointmentId`) and false for one it
 * only charges on a row.
 */
export type SourceRef = {
	kind: 'booking' | 'appointment';
	id: string;
	reference: string;
	guestName: string | undefined;
	guestPhone: string | undefined;
	guestEmail: string | undefined;
	name: string;
	linked: boolean;
};

export async function stayRef(ctx: ReadCtx, bookingId: Id<'bookings'>, linked: boolean, reads: OrderReads = directReads(ctx)): Promise<SourceRef> {
	const booking = await reads.booking(bookingId);
	if (!booking) return { kind: 'booking', id: bookingId, reference: 'Deleted booking', guestName: undefined, guestPhone: undefined, guestEmail: undefined, name: 'Stay', linked };
	const property = await reads.property(booking.propertyId);
	return {
		kind: 'booking', id: booking._id, reference: booking.confirmationCode ?? `${booking.checkIn} → ${booking.checkOut}`,
		guestName: booking.guestName, guestPhone: booking.guestPhone || undefined, guestEmail: booking.guestEmail, name: `Stay · ${property?.name ?? 'Villa'}`, linked
	};
}

export async function appointmentRef(ctx: ReadCtx, appointmentId: Id<'appointments'>, linked: boolean, found?: Doc<'appointments'> | null, reads: OrderReads = directReads(ctx)): Promise<SourceRef> {
	const appointment = found === undefined ? await reads.appointment(appointmentId) : found;
	if (!appointment) return { kind: 'appointment', id: appointmentId, reference: 'Deleted appointment', guestName: undefined, guestPhone: undefined, guestEmail: undefined, name: 'Appointment', linked };
	const service = await reads.service(appointment.serviceId);
	return {
		kind: 'appointment', id: appointment._id, reference: appointment.confirmationCode,
		guestName: appointment.guestName || undefined, guestPhone: appointment.guestPhone || undefined, guestEmail: appointment.guestEmail, name: service?.name ?? 'Appointment', linked
	};
}

/**
 * The bookings an order is for, from what is actually linked and charged, never guessed:
 * 1. its own booking (`orders.bookingId` or `appointmentId`), if it has one;
 * 2. then each other stay charged on its rows, in row order;
 * 3. then each charged appointment, unless its stay is already listed (it is part of that booking).
 * The first is what checkout shows as the order's booking. A sale that charges a stay whose own
 * (empty) order was made with the booking therefore shows that stay, without moving the booking's
 * order. Paid rows never change, so a receipt keeps the same references.
 */
export async function orderSourceRefs(ctx: ReadCtx, order: Order, lines: Array<Pick<Line, 'bookingId' | 'appointmentId'>>, reads: OrderReads = directReads(ctx)): Promise<SourceRef[]> {
	const refs: SourceRef[] = [];
	const stays = new Set<Id<'bookings'>>();
	const appointments = new Set<Id<'appointments'>>();
	if (order.bookingId) {
		stays.add(order.bookingId);
		refs.push(await stayRef(ctx, order.bookingId, true, reads));
	} else if (order.appointmentId) {
		appointments.add(order.appointmentId);
		refs.push(await appointmentRef(ctx, order.appointmentId, true, undefined, reads));
	}
	for (const { bookingId } of lines) {
		if (!bookingId || stays.has(bookingId)) continue;
		stays.add(bookingId);
		refs.push(await stayRef(ctx, bookingId, false, reads));
	}
	for (const { appointmentId } of lines) {
		if (!appointmentId || appointments.has(appointmentId)) continue;
		appointments.add(appointmentId);
		const appointment = await reads.appointment(appointmentId);
		if (appointment?.bookingId && stays.has(appointment.bookingId)) continue;
		refs.push(await appointmentRef(ctx, appointmentId, false, appointment, reads));
	}
	return refs;
}

/** An order's stay and appointment rows, without reading its other rows. */
export async function sourceRows(ctx: ReadCtx, orderId: Id<'orders'>) {
	const [stays, appointments] = await Promise.all([
		ctx.db.query('orderLines').withIndex('by_orderId_and_kind', (q) => q.eq('orderId', orderId).eq('kind', 'booking')).take(MAX_LINES),
		ctx.db.query('orderLines').withIndex('by_orderId_and_kind', (q) => q.eq('orderId', orderId).eq('kind', 'appointment')).take(MAX_LINES)
	]);
	return [...stays, ...appointments].sort((a, b) => a._creationTime - b._creationTime);
}

export async function customerName(ctx: ReadCtx, order: Order) {
	if (order.amendedCustomer !== undefined) return order.amendedCustomer?.name;
	if (order.customerSnapshot) return order.customerSnapshot.name;
	if (order.customerId) return (await ctx.db.get(order.customerId))?.name ?? 'Deleted customer';
	return undefined;
}

export async function remaining(ctx: ReadCtx, order: Order) {
	if (!isOpenOrder(order)) return 0;
	return order.due;
}

/** A villa's first image, its photo in the catalog; undefined when it has none. */
export function villaPhoto(property: Doc<'properties'> | null): string | undefined {
	return property?.images[0];
}

/**
 * The photo shown beside an order row: its service's, its room's, or the booked villa's first image.
 * Display only, read as the catalog is now; it is never copied onto the row or its receipt.
 */
export async function linePhoto(ctx: ReadCtx, line: Line, reads: OrderReads = directReads(ctx)) {
	if (line.serviceId) return (await reads.service(line.serviceId))?.imageUrl;
	const propertyId = line.propertyId ?? (line.bookingId ? (await reads.booking(line.bookingId))?.propertyId : undefined);
	return propertyId ? villaPhoto(await reads.property(propertyId)) : undefined;
}

/** Stable catalog dependencies stay separate from frequently edited order lines. */
export async function catalogItems(ctx: QueryCtx) {
	const [services, properties, staff] = await Promise.all([
		ctx.db.query('services').withIndex('by_status', (q) => q.eq('status', 'active')).take(200),
		ctx.db.query('properties').withIndex('by_status', (q) => q.eq('status', 'active')).take(100),
		ctx.db.query('staff').withIndex('by_status', (q) => q.eq('status', 'active')).take(200)
	]);
	// Only baht prices can go on an order (see assertBaht).
	return {
		services: services.filter((s) => s.currency === CURRENCY).map((s) => ({ _id: s._id, name: s.name, category: s.category, description: s.description, durationMin: s.durationMin, price: s.price, currency: s.currency, staffIds: s.staffIds, imageUrl: s.imageUrl })),
		rooms: properties.filter((p) => p.currency === CURRENCY).map((p) => ({ _id: p._id, name: p.name, tagline: p.tagline, price: p.pricePerNight, currency: p.currency, maxGuests: p.maxGuests, imageUrl: villaPhoto(p) })),
		/** No extras catalog exists yet; the Extras tab offers custom items. */
		extras: [] as Array<{ name: string; price: number; category: string }>,
		staff: staff.map((s) => ({ _id: s._id, name: s.name, color: s.color }))
	};
}

export async function catalogRanking(ctx: QueryCtx) {
	const recent = await ctx.db.query('orderLines').order('desc').take(FREQUENT_SCAN);
	// Count rows, not quantities. Stable sort preserves newest-first encounter order on ties.
	const counts = new Map<string, number>();
	for (const line of recent) {
		if (line.fee) continue;
		const key = line.kind === 'service' ? `service:${line.serviceId}` : line.kind === 'room' ? `room:${line.propertyId}` : line.kind === 'extra' ? `extra:${line.name}` : null;
		if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, FREQUENT_COUNT).map(([key]) => key);
}

export type DiscardedInfo = { at: number; by: string | null; reason: string | null };

/** Discarded orders only: when, by whom and why. Absent (or null in fixtures) on other rows. */
export function discardedField(order: Order): { discarded?: DiscardedInfo | null } {
	return order.status === 'discarded'
		? { discarded: { at: order.discardedAt ?? order.updatedAt, by: order.discardedBy ?? null, reason: order.discardReason ?? null } }
		: {};
}

export const addItemArgs = v.object({ orderId: v.optional(v.id('orders')), item: itemValidator });

/** Adds a stay or appointment to the order (a new order if none is given). */
export const attachArgs = v.object({ orderId: v.optional(v.id('orders')), ...sourceArgs });

export const updateLineArgs = v.object({
		lineId: v.id('orderLines'),
		staffId: v.optional(v.union(v.id('staff'), v.null())),
		serviceDate: v.optional(v.union(v.string(), v.null())),
		serviceTime: v.optional(v.union(v.string(), v.null())),
		qtyChange: v.optional(v.number()),
		discount: v.optional(v.union(discountValidator, v.null()))
	});

/** One-off price for a row. Setting a price needs a note; every change is kept in orderAudit. */
export const overrideLinePriceArgs = v.object({ lineId: v.id('orderLines'), price: v.union(v.number(), v.null()), note: v.string() });

/**
 * Brings a booking or appointment row in line with its source after the stay or appointment
 * changed (new dates, price, deposit, therapist or time), or removes it if it was paid or
 * cancelled elsewhere meanwhile. The order's revision changes, so any payment begun on the old
 * row has to be reviewed again.
 */
export const updateSourceLineArgs = v.object({ lineId: v.id('orderLines') });

/**
 * Voids a paid order. The record, its order and receipt numbers, payments and audit trail stay;
 * charged bookings and appointments keep their paid status, because the money was received (record
 * a refund on them if it is returned). For a payment recorded by mistake when no money changed
 * hands, use voidUnreceivedOrder instead.
 */
export const voidOrderArgs = v.object({ orderId: v.id('orders'), reason: v.string() });

export const correctionArgs = { orderId: v.id('orders'), expectedCorrectionRevision: v.number(), idempotencyKey: v.string(), reason: v.string() };

export async function correctionReplay(ctx: MutationCtx, orderId: Id<'orders'>, idempotencyKey: string, kind: Doc<'orderCorrections'>['kind']) {
	const key = attemptKey(idempotencyKey);
	const existing = await ctx.db.query('orderCorrections').withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', key)).first();
	if (existing && (existing.orderId !== orderId || existing.kind !== kind)) throw new ConvexError('This correction attempt was already used for something else. Start again.');
	return { key, existing };
}

export function assertCorrectionRevision(order: Order, expected: number) {
	if (expected !== (order.correctionRevision ?? 0)) throw new ConvexError('This receipt was corrected since you opened it. Review it and try again.');
}

export const cleanTender = (tender: { method: Doc<'orderPayments'>['method']; amount: number; received?: number }) => ({
	method: tender.method, amount: tender.amount, ...(tender.received !== undefined ? { received: tender.received } : {})
});

/**
 * Corrects a paid order's payment record: how it was paid (tenders, same total), the business date
 * it was received, or who the receipt is for. The issued receipt, its number, its original payments
 * and `customerSnapshot` are never changed; the correction is a orderCorrections row with before and
 * after, and getOrder returns both. Deposits paid online are not tenders and can't be touched here.
 * A new effective date also moves the stays' payment records and appointments' `paidAt`.
 */
export const amendOrderPaymentArgs = v.object({
		...correctionArgs,
		tenders: v.optional(v.array(correctedTender)),
		effectiveAt: v.optional(v.number()),
		/** The corrected payer, with the profile revision staff reviewed; null = no named customer. */
		customer: v.optional(v.object({ customerId: v.union(v.null(), v.id('customers')), expectedCustomerRevision: v.optional(v.number()) }))
	});

export const MISSING_PAYMENT_EVIDENCE = (name: string) =>
	`This order has no recorded stay payment proving what it took for ${name}. Correct its tenders instead, or record a refund on the booking if money was returned.`;

/**
 * Voids a paid order whose payment was recorded by mistake: no money was ever received. Unlike
 * voidOrder, it reopens what the order charged, exactly by what this order took: each stay loses
 * this order's itemised payment (an earlier online deposit stays), each appointment goes back to
 * unpaid at its price before checkout. It refuses, writing nothing, when any part can't be proved:
 * a stay paid before payments were itemised, money already refunded, or an appointment changed
 * since. The receipt number is never reused.
 */
export const voidUnreceivedOrderArgs = v.object(correctionArgs);

// ---------------------------------------------------------------------------------------------
// Discarding and restoring unpaid orders
// ---------------------------------------------------------------------------------------------

export const lifecycleArgs = { orderId: v.id('orders'), expectedRevision: v.number(), idempotencyKey: v.string() };

// ---------------------------------------------------------------------------------------------
// Linking a paid row to its appointment or stay later
// ---------------------------------------------------------------------------------------------

/** Which source a paid row can be applied to: a service row to an appointment of that service, a room row to a stay in that villa. */
export const LINK_TARGET: Partial<Record<Line['kind'], 'appointment' | 'booking'>> = { service: 'appointment', room: 'booking' };

/**
 * Applies a paid service row to its appointment, or a paid room row to its stay, after payment.
 * No money moves and the issued receipt, its rows, tenders, total and issue date never change: the
 * link is a orderLineLinks row and a numbered `linked` correction. The target is recorded as paid by
 * this order exactly as checkout would have done: the appointment becomes paid at what the row was
 * charged (its price before is kept for an unlink); the stay gets a `pos` payment row for the
 * row's amount with this order's `orderId` (part of what it owes is allowed, more is refused). The
 * money's date is the order's payment date.
 *
 * Refused, with nothing written, unless the order is paid, the row is a service (or room) row with
 * no active link, and the appointment (stay) is for the same service (villa), still owes it, has no
 * active link, is on no open order and is still at `expectedTargetRevision`. `expectedCorrectionRevision`
 * is the order's correction revision staff reviewed. Retrying `idempotencyKey` returns the first result.
 */
export const linkPaidLineArgs = v.object({
		...correctionArgs,
		lineId: v.id('orderLines'),
		appointmentId: v.optional(v.id('appointments')),
		bookingId: v.optional(v.id('bookings')),
		expectedTargetRevision: v.number(),
		notifyGuest: v.optional(v.boolean())
	});

/**
 * Undoes a link (linkPaidLine) with a reason: reverses exactly what it applied (see linkReversal)
 * and keeps the link as `unlinked`, with an `unlinked` correction. The receipt never changes; the
 * row can be linked again. Refused, writing nothing, if the reversal can't be proved.
 */
export const unlinkPaidLineArgs = v.object({ ...correctionArgs, linkId: v.id('orderLineLinks') });
