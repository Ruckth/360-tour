import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { isDocumentedLiveRefund, markBookingPaid, recordStayPayment } from './bookings';
import { CUSTOMER_POS_INTEGRATION_ENABLED, assertCustomerCanLink, assertCustomerReviewed, customerCard } from './customers';
import { requireAdmin } from './lib/adminAuth';
import { STALE_APPOINTMENT, recordAppointmentChange } from './lib/appointmentChanges';
import { appointmentMoney } from './lib/appointmentFinance';
import {
	MAX_QTY,
	MERGES_QTY,
	NOTE_MAX,
	assertBillSize,
	assertDiscount,
	assertPrice,
	assertPriceOverride,
	assertTenders,
	billTotals,
	bookingBalance,
	bookingChargeTotal,
	formatReceiptNumber,
	lineNet,
	orderTitle,
	round2
} from './lib/billMath';
import {
	RECEIPT_COUNTER,
	activeOrderFor,
	insertOrder,
	isOpenOrder,
	nextCounter,
	linkedOpenOrder,
	openOrderCharging,
	orderState,
	ordersForSource,
	type OrderSource
} from './lib/orderLinks';
import { appointmentLookupFields, resortLocalParts } from './lib/serviceSlots';
import { evaluateOrderCoupon, posCouponMessage, type OrderPromotionView, type PosCouponProblem, type OrderCouponResult } from './lib/posCoupons';
import { couponVersion, consumeOrderCoupon, syncOrderCouponRedemption } from './lib/couponRedemptions';
import { normalizeCouponCode } from './lib/offers';
import { resortTodayIso } from './lib/dates';
import { STALE_BOOKING, appendBookingHistory, assertNoLiveCheckout, attemptKey, bookingRevision, cleanReason, effectiveTime, stayMoney, writeBooking } from './lib/bookingMoney';
import { correctedTender } from './lib/financeValidators';
import { appendRecordHistory } from './lib/recordHistory';
import { MAX_STAY_ROWS, orderStayPayment, stayPaymentReversalPatch } from './lib/stayCorrections';
import { MAX_LINES, orderLines } from './lib/orderLines';
import { activeLineLink, activeSourceLink, orderLineLinks } from './lib/lineLinks';
import { changeSchedule, scheduleFromStartAt } from './lib/serviceSchedule';
import { DISCARDED_ORDER, FEE_LABEL, assertFeeAmount, feeBlocker, feePriceBlocker, liveFees, otherFeeMessage, orderPaymentRecord, type FeeKind } from './lib/orderLifecycle';

/**
 * Staff POS orders. An order is the persistent commercial record: a permanent order number,
 * its items, payments and receipt. It is a server draft (so it can be saved and reopened on any
 * device) until settleOrder pays it in one transaction: payments, the receipt number and the
 * charged bookings and appointments are written together, or not at all.
 *
 * Orders live in the `bills` table (and their rows in `billLines`) so ids, payments and audit
 * history from before orders had numbers stay valid. See lib/orderLinks.ts for how orders relate
 * to bookings and appointments, and customers.ts for the optional customer link.
 */

const FREQUENT_SCAN = 300;
const FREQUENT_COUNT = 8;
const ORDERS_PAGE_MAX = 50;
const ATTACH_SCAN = 20;
/** Unpaid appointments from before the lookup fields that Add booking still matches directly. */
const LEGACY_LOOKUP_SCAN = 500;
const CURRENCY = 'THB';

const discountValidator = v.object({ type: v.union(v.literal('amount'), v.literal('percent')), value: v.number() });
const tenderValidator = v.object({
	method: v.union(v.literal('cash'), v.literal('promptpay'), v.literal('card'), v.literal('transfer')),
	amount: v.number(),
	received: v.optional(v.number())
});
const itemValidator = v.union(
	v.object({ kind: v.literal('service'), serviceId: v.id('services') }),
	v.object({ kind: v.literal('room'), propertyId: v.id('properties') }),
	v.object({ kind: v.literal('extra'), name: v.string(), price: v.number() })
);
const sourceArgs = { bookingId: v.optional(v.id('bookings')), appointmentId: v.optional(v.id('serviceAppointments')) };

type ReadCtx = QueryCtx | MutationCtx;
type Order = Doc<'bills'>;
type Line = Doc<'billLines'>;
type LineFields = Omit<Line, '_id' | '_creationTime' | 'billId' | 'createdAt'>;
type JoinTable = 'bookings' | 'properties' | 'serviceAppointments' | 'services';
/** Source joins as plain reads: what every mutation uses, so nothing read before a write is reused after it. */
function directReads(ctx: ReadCtx) {
	const get = <T extends JoinTable>(table: T) => (id: Id<T>) => ctx.db.get(table, id);
	return { booking: get('bookings'), property: get('properties'), appointment: get('serviceAppointments'), service: get('services') };
}
type OrderReads = ReturnType<typeof directReads>;
/** Query-only: one getOrder invocation shares each join's promise, including missing docs. */
function orderReads(ctx: QueryCtx): OrderReads {
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

const FEE_FIXED = 'A fee row keeps the amount it was added with. Remove it and add the fee again with the right amount.';
const ATTACHED_PRICE = 'A stay is charged at its booked price. Set a custom price on the booking (Edit booking → Custom price), then update the row.';
const ONLINE_CHECKOUT = 'Online checkout is in progress. Wait for it to finish or expire before taking payment at the desk.';

/** Orders are in baht; a price in another currency is refused rather than read as baht. */
function assertBaht(currency: string, what: string) {
	if (currency !== CURRENCY) throw new ConvexError(`${what} is priced in ${currency}. Checkout takes ${CURRENCY} only.`);
}

function oneSource(args: { bookingId?: Id<'bookings'>; appointmentId?: Id<'serviceAppointments'> }): OrderSource {
	if (Boolean(args.bookingId) === Boolean(args.appointmentId)) throw new ConvexError('Choose one booking or appointment');
	return args.bookingId ? { bookingId: args.bookingId } : { appointmentId: args.appointmentId! };
}

/** The order to change, created on first use. Paid and void orders never change. */
async function editableOrder(ctx: MutationCtx, orderId: Id<'bills'> | undefined, actor: string): Promise<Order> {
	if (!orderId) return await insertOrder(ctx, actor);
	const order = await ctx.db.get(orderId);
	if (!order) throw new ConvexError('Order not found');
	if (order.status === 'paid') throw new ConvexError('This order is already paid');
	if (order.status === 'void') throw new ConvexError('This order was voided');
	if (order.status === 'discarded') throw new ConvexError(DISCARDED_ORDER);
	// Legacy held orders become ordinary unpaid drafts when touched.
	if (order.status === 'held') {
		await ctx.db.patch(order._id, { status: 'draft' });
		return { ...order, status: 'draft' };
	}
	return order;
}

async function editableLine(ctx: MutationCtx, lineId: Id<'billLines'>, actor: string) {
	const line = await ctx.db.get(lineId);
	if (!line) throw new ConvexError('Item not found');
	const order = await editableOrder(ctx, line.billId, actor);
	return { line, order };
}

function orderCouponUnavailable(problem: PosCouponProblem, couponCode?: string): never {
	throw new ConvexError({ code: 'coupon_unavailable', message: posCouponMessage(problem), problem, ...(couponCode ? { couponCode } : {}) });
}

/**
 * Frozen benefit and eligibility, live status and counters, and the real business date; drafts
 * reserve nothing. The usage limit and budget always come from the current version: they are how
 * a marketer stops a promotion, so lowering them stops open orders too.
 */
async function quoteOrderCoupon(ctx: ReadCtx, lines: Line[], couponId: Id<'coupons'>, version: number): Promise<OrderCouponResult> {
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
async function writeCouponShares(ctx: MutationCtx, lines: Line[], result: OrderCouponResult | null) {
	const shares = new Map(result?.ok ? result.allocation.map(share => [share.lineId, share.discount]) : []);
	for (const line of lines) {
		const couponDiscount = shares.get(line._id);
		if (line.couponDiscount !== couponDiscount) await ctx.db.patch(line._id, { couponDiscount });
		line.couponDiscount = couponDiscount;
	}
}

/** Keeps the order's item count, total and due in step with its lines, and marks it changed. */
async function refreshOrder(ctx: MutationCtx, orderId: Id<'bills'>) {
	const [order, lines] = await Promise.all([ctx.db.get(orderId), orderLines(ctx, orderId)]);
	if (!order || !isOpenOrder(order)) throw new Error('Only an unpaid order can be refreshed');
	if (order.promotion) {
		const result = await quoteOrderCoupon(ctx, lines, order.promotion.couponId, order.promotion.couponVersion);
		await writeCouponShares(ctx, lines, result);
		// The code can be renamed before its first use; show the one the coupon has now.
		const code = (await ctx.db.get(order.promotion.couponId))?.code ?? order.promotion.code;
		await ctx.db.patch(orderId, { promotion: { ...order.promotion, code, discount: result.ok ? result.discount : 0, problem: result.ok ? undefined : result.problem } });
	}
	const totals = billTotals(lines);
	assertBillSize(totals);
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

async function assertRoom(ctx: MutationCtx, orderId: Id<'bills'>) {
	if ((await orderLines(ctx, orderId)).length >= MAX_LINES) throw new ConvexError(`An order holds at most ${MAX_LINES} items`);
}

function cleanText(value: string | undefined, label: string, max = 200) {
	const trimmed = value?.trim();
	if (trimmed && trimmed.length > max) throw new ConvexError(`${label} must be at most ${max} characters`);
	return trimmed || undefined;
}

/** What a row was, for order history: every business field, nothing derived. */
function lineSnapshot(line: LineFields | Line) {
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
 * (payment, void, price overrides, source updates) stay in billAudit and billCorrections.
 */
async function logOrder(ctx: MutationCtx, orderId: Id<'bills'>, actor: string, kind: string, change: { before?: unknown; after?: unknown; reason?: string }) {
	await appendRecordHistory(ctx, {
		entityType: 'order', entityId: orderId, actor, kind,
		...(change.reason ? { reason: change.reason } : {}),
		...(change.before !== undefined ? { before: change.before } : {}),
		...(change.after !== undefined ? { after: change.after } : {})
	});
}

function appointmentAttachable(appointment: Doc<'serviceAppointments'>) {
	return appointment.paymentStatus === 'unpaid' && appointment.status !== 'cancelled' && appointment.status !== 'no_show';
}

function bookingCheckoutBlock(booking: Doc<'bookings'>) {
	return booking.paymentStatus !== 'paid' && (booking.stripeCheckoutExpiresAt ?? 0) > Date.now() ? ONLINE_CHECKOUT : null;
}

/**
 * Why a stay can't be charged at all, or null. A live stay a provider refund marked refunded with
 * explicit amounts (bookings.ts isDocumentedLiveRefund) stays open: it can still collect what it
 * owes beyond the waived provider charge. A legacy refunded flag or failed payment needs a reopen.
 */
function bookingClosedReason(booking: Doc<'bookings'>) {
	if (booking.status === 'cancelled') return 'This booking was cancelled';
	if (booking.paymentStatus === 'failed') return 'This booking’s payment failed; reopen it first';
	if (booking.paymentStatus === 'refunded' && !isDocumentedLiveRefund(booking)) return 'This booking was marked refunded without refund amounts; reopen it first';
	return null;
}

const bookingClosed = (booking: Doc<'bookings'>) => bookingClosedReason(booking) !== null;

/** Open to charges and still owing something (net of refunds and waived provider charges). */
function bookingPayable(booking: Doc<'bookings'>) {
	return !bookingClosed(booking) && bookingBalance(booking).owed > 0;
}

async function bookingLine(ctx: ReadCtx, booking: Doc<'bookings'>, reads: OrderReads = directReads(ctx)) {
	const property = await reads.property(booking.propertyId);
	const { paid } = bookingBalance(booking);
	return {
		kind: 'booking' as const,
		bookingId: booking._id,
		name: `Stay · ${property?.name ?? 'Villa'}`,
		detail: `${booking.checkIn} → ${booking.checkOut} · ${booking.nights} ${booking.nights === 1 ? 'night' : 'nights'}${booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}${booking.providerRefundWaived ? ` · ${booking.providerRefundWaived} ${booking.currency} refunded charge waived` : ''}`,
		unitPrice: bookingChargeTotal(booking),
		currency: booking.currency,
		qty: 1,
		...(paid > 0 ? { deposit: paid } : {})
	};
}

async function appointmentLine(ctx: ReadCtx, appointment: Doc<'serviceAppointments'>) {
	const service = await ctx.db.get(appointment.serviceId);
	const { date, time } = resortLocalParts(appointment.start);
	return {
		kind: 'appointment' as const,
		appointmentId: appointment._id,
		serviceId: appointment.serviceId,
		name: service?.name ?? 'Appointment',
		detail: `${date} ${time} · ${appointment.confirmationCode}`,
		unitPrice: appointment.price,
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
async function sourceIssue(ctx: ReadCtx, line: Line, reads: OrderReads = directReads(ctx)): Promise<SourceIssue | null> {
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
		const blocked = feeBlocker(appointment, line.fee.kind) ?? feePriceBlocker(line.unitPrice, appointment) ?? otherFeeMessage((await liveFees(ctx, appointment._id, line.billId))[0]);
		if (blocked) return { kind: 'settled', message: `${blocked} Remove the fee from the order.` };
	}
	return null;
}

const isSourceRow = (line: Line) => Boolean(line.bookingId || line.appointmentId || line.feeAppointmentId);

/**
 * Makes an order with no booking of its own the order of the stay (or standalone appointment)
 * first charged on it, so opening that booking later finds this order. Skipped if that booking
 * already has another open order of its own, usually the empty one created with it: that order
 * stays the booking's (for later extras), and this one still lists the booking because it charges
 * it (see orderSourceRefs).
 */
async function linkFirstSource(ctx: MutationCtx, order: Order, source: OrderSource, appointment?: Doc<'serviceAppointments'>) {
	if (order.bookingId || order.appointmentId) return;
	const bookingId = 'bookingId' in source ? source.bookingId : appointment?.bookingId;
	const link: OrderSource = bookingId ? { bookingId } : source;
	const other = await linkedOpenOrder(ctx, link);
	if (other && other._id !== order._id) return;
	await ctx.db.patch(order._id, { ...('bookingId' in link ? { bookingId: link.bookingId } : { appointmentId: link.appointmentId }), implicitSourceLink: true });
}

/** Charges a booking or appointment on the order. Customer and guest details are left alone. */
async function attachTo(ctx: MutationCtx, order: Order, source: OrderSource, actor: string) {
	await assertRoom(ctx, order._id);
	let line: LineFields;
	let appointment: Doc<'serviceAppointments'> | undefined;
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
	const lineId = await ctx.db.insert('billLines', { billId: order._id, ...line, createdAt: Date.now() });
	await linkFirstSource(ctx, order, source, appointment);
	await refreshOrder(ctx, order._id);
	await logOrder(ctx, order._id, actor, 'source_attached', { after: { ...lineSnapshot(line), lineId } });
}

/** The newest paid order for a source, which a later charge on it follows. */
async function lastPaidOrder(ctx: ReadCtx, source: OrderSource) {
	return (await ordersForSource(ctx, source)).find((order) => order.status === 'paid');
}

/**
 * A booking an order is for, as checkout, the orders list and the receipt show it. `linked` is
 * true for the order's own booking (`bills.bookingId` / `appointmentId`) and false for one it
 * only charges on a row.
 */
type SourceRef = {
	kind: 'booking' | 'appointment';
	id: string;
	reference: string;
	guestName: string | undefined;
	guestPhone: string | undefined;
	guestEmail: string | undefined;
	name: string;
	linked: boolean;
};

async function stayRef(ctx: ReadCtx, bookingId: Id<'bookings'>, linked: boolean, reads: OrderReads = directReads(ctx)): Promise<SourceRef> {
	const booking = await reads.booking(bookingId);
	if (!booking) return { kind: 'booking', id: bookingId, reference: 'Deleted booking', guestName: undefined, guestPhone: undefined, guestEmail: undefined, name: 'Stay', linked };
	const property = await reads.property(booking.propertyId);
	return {
		kind: 'booking', id: booking._id, reference: booking.confirmationCode ?? `${booking.checkIn} → ${booking.checkOut}`,
		guestName: booking.guestName, guestPhone: booking.guestPhone || undefined, guestEmail: booking.guestEmail, name: `Stay · ${property?.name ?? 'Villa'}`, linked
	};
}

async function appointmentRef(ctx: ReadCtx, appointmentId: Id<'serviceAppointments'>, linked: boolean, found?: Doc<'serviceAppointments'> | null, reads: OrderReads = directReads(ctx)): Promise<SourceRef> {
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
 * 1. its own booking (`bills.bookingId` or `appointmentId`), if it has one;
 * 2. then each other stay charged on its rows, in row order;
 * 3. then each charged appointment, unless its stay is already listed (it is part of that booking).
 * The first is what checkout shows as the order's booking. A sale that charges a stay whose own
 * (empty) order was made with the booking therefore shows that stay, without moving the booking's
 * order. Paid rows never change, so a receipt keeps the same references.
 */
async function orderSourceRefs(ctx: ReadCtx, order: Order, lines: Array<Pick<Line, 'bookingId' | 'appointmentId'>>, reads: OrderReads = directReads(ctx)): Promise<SourceRef[]> {
	const refs: SourceRef[] = [];
	const stays = new Set<Id<'bookings'>>();
	const appointments = new Set<Id<'serviceAppointments'>>();
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
async function sourceRows(ctx: ReadCtx, orderId: Id<'bills'>) {
	const [stays, appointments] = await Promise.all([
		ctx.db.query('billLines').withIndex('by_billId_and_kind', (q) => q.eq('billId', orderId).eq('kind', 'booking')).take(MAX_LINES),
		ctx.db.query('billLines').withIndex('by_billId_and_kind', (q) => q.eq('billId', orderId).eq('kind', 'appointment')).take(MAX_LINES)
	]);
	return [...stays, ...appointments].sort((a, b) => a._creationTime - b._creationTime);
}

/** Who the order is for, as listed: the linked customer, else the name on its receipt or legacy record. */
async function customerName(ctx: ReadCtx, order: Order) {
	if (order.amendedCustomer !== undefined) return order.amendedCustomer?.name;
	if (order.customerSnapshot) return order.customerSnapshot.name;
	if (order.customerId) return (await ctx.db.get(order.customerId))?.name ?? 'Deleted customer';
	return order.guestName;
}

/**
 * What remains to pay: 0 once paid or voided. A row saved before `due` existed (until
 * migrations:backfillOrders reaches it) is worked out from its rows, so a deposit already paid on
 * a stay is not listed as owed again.
 */
async function remaining(ctx: ReadCtx, order: Order) {
	if (!isOpenOrder(order)) return 0;
	return order.due ?? billTotals(await orderLines(ctx, order._id)).due;
}

/** A villa's first image, its photo in the catalog; undefined when it has none. */
function villaPhoto(property: Doc<'properties'> | null): string | undefined {
	return property?.images[0];
}

/**
 * The photo shown beside an order row: its service's, its room's, or the booked villa's first image.
 * Display only, read as the catalog is now; it is never copied onto the row or its receipt.
 */
async function linePhoto(ctx: ReadCtx, line: Line, reads: OrderReads = directReads(ctx)) {
	if (line.serviceId) return (await reads.service(line.serviceId))?.imageUrl;
	const propertyId = line.propertyId ?? (line.bookingId ? (await reads.booking(line.bookingId))?.propertyId : undefined);
	return propertyId ? villaPhoto(await reads.property(propertyId)) : undefined;
}

/** Stable catalog dependencies stay separate from frequently edited order lines. */
async function catalogItems(ctx: QueryCtx) {
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

async function catalogRanking(ctx: QueryCtx) {
	const recent = await ctx.db.query('billLines').order('desc').take(FREQUENT_SCAN);
	// Count rows, not quantities. Stable sort preserves newest-first encounter order on ties.
	const counts = new Map<string, number>();
	for (const line of recent) {
		if (line.fee) continue;
		const key = line.kind === 'service' ? `service:${line.serviceId}` : line.kind === 'room' ? `room:${line.propertyId}` : line.kind === 'extra' ? `extra:${line.name}` : null;
		if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, FREQUENT_COUNT).map(([key]) => key);
}

export const stableCatalog = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return catalogItems(ctx);
	}
});

export const recentCatalogRanking = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return catalogRanking(ctx);
	}
});

/** Compatibility endpoint; both subscription paths share the same extraction and ranking. */
export const catalog = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const [items, frequent] = await Promise.all([catalogItems(ctx), catalogRanking(ctx)]);
		return { ...items, frequent };
	}
});

export const getOrder = query({
	// Deep links are untrusted strings. Normalize after auth so a bad link is recoverable,
	// rather than failing argument validation before checkout can render its recovery controls.
	args: { orderId: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const orderId = ctx.db.normalizeId('bills', args.orderId);
		if (!orderId) return null;
		const order = await ctx.db.get(orderId);
		if (!order) return null;
		const open = isOpenOrder(order);
		const [lines, payments, audit, customer, parent, refunds, corrections, appointmentRefunds, links] = await Promise.all([
			orderLines(ctx, order._id),
			ctx.db.query('billPayments').withIndex('by_billId', (q) => q.eq('billId', order._id)).take(10),
			ctx.db.query('billAudit').withIndex('by_billId_and_at', (q) => q.eq('billId', order._id)).order('desc').take(50),
			order.customerId ? ctx.db.get(order.customerId) : null,
			order.parentOrderId ? ctx.db.get(order.parentOrderId) : null,
			ctx.db.query('bookingRefunds').withIndex('by_billId', (q) => q.eq('billId', order._id)).take(MAX_STAY_ROWS),
			ctx.db.query('billCorrections').withIndex('by_billId_and_sequence', (q) => q.eq('billId', order._id)).order('desc').take(20),
			ctx.db.query('appointmentRefunds').withIndex('by_billId', q => q.eq('billId', order._id)).order('desc').take(MAX_STAY_ROWS),
			isOpenOrder(order) ? [] : orderLineLinks(ctx, order._id)
		]);
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
			rows.push({
				...line,
				net: lineNet(line),
				imageUrl: photoKey ? await photos.get(photoKey) : undefined,
				// A paid row keeps the name it was issued with; an open row shows the therapist's current name.
				staffName: line.staffId ? (open ? undefined : line.staffName) ?? staffNames.get(line.staffId) ?? 'Former staff member' : undefined,
				// History is not re-checked: a paid row stays as it was paid.
				sourceIssue: open && isSourceRow(line) ? await sourceIssue(ctx, line, reads) : null,
				/** R2b: a booking row's own promotion (the stay was priced with it; checkout never discounts it again). */
				stayCoupon: stay?.promotion && !stay.priceOverride ? { code: stay.promotion.code, discount: stay.promotion.discount } : null
			});
		}
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
			/** A name copied onto an order before customers existed. Shown, never turned into a customer. */
			legacyGuest: !order.customerId && order.guestName ? { name: order.guestName, phone: order.guestPhone, email: order.guestEmail } : null,
			/** The order's booking as shown in its header: its own, else the first it charges (see orderSourceRefs). */
			source: sources[0] ?? null,
			/** Every booking the order is for, its own first. */
			sources,
			parentOrder: parent ? { _id: parent._id, title: orderTitle(parent.orderNumber) } : null,
			lines: rows,
			/** R2b: the order's coupon; the split is on each row's `couponDiscount`, the total in `totals.coupon`. */
			promotion,
			/** As recorded when the receipt was issued; never changed (see `paymentRecord` for corrections). */
			payments,
			audit,
			totals: billTotals(lines),
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

type DiscardedInfo = { at: number; by: string | null; reason: string | null };

/** Discarded orders only: when, by whom and why. Absent (or null in fixtures) on other rows. */
function discardedField(order: Order): { discarded?: DiscardedInfo | null } {
	return order.status === 'discarded'
		? { discarded: { at: order.discardedAt ?? order.updatedAt, by: order.discardedBy ?? null, reason: order.discardReason ?? null } }
		: {};
}

/**
 * Orders with items, newest change first, for the Orders list: unpaid, paid, voided or discarded.
 * Unpaid never includes discarded orders; `discarded` lists them newest discard first.
 */
export const listOrders = query({
	args: { filter: v.union(v.literal('unpaid'), v.literal('paid'), v.literal('void'), v.literal('discarded')), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const numItems = Math.min(Math.max(args.paginationOpts.numItems, 1), ORDERS_PAGE_MAX);
		const page = await ctx.db
			.query('bills')
			.withIndex('by_hasItems_and_status_and_updatedAt', (q) => {
				const withItems = q.eq('hasItems', true);
				// Unpaid is draft plus legacy held (until migrations:backfillOrders): held rows list first, then drafts.
				return args.filter === 'unpaid' ? withItems.gte('status', 'draft').lte('status', 'held') : withItems.eq('status', args.filter);
			})
			.order('desc')
			.paginate({ ...args.paginationOpts, numItems });
		const orders = page.page;
		const rows = [];
		for (const order of orders) {
			const sources = await orderSourceRefs(ctx, order, await sourceRows(ctx, order._id));
			rows.push({
				_id: order._id,
				orderNumber: order.orderNumber,
				title: orderTitle(order.orderNumber),
				state: orderState(order),
				itemCount: order.itemCount,
				total: order.total,
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
export const findOrderByNumber = query({
	args: { orderNumber: v.number() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!Number.isSafeInteger(args.orderNumber) || args.orderNumber < 1) return null;
		const order = await ctx.db.query('bills').withIndex('by_orderNumber', (q) => q.eq('orderNumber', args.orderNumber)).first();
		return order?._id ?? null;
	}
});

/**
 * A booking's or appointment's orders for its detail screen: where checkout continues (the open
 * order, if any), recent orders and what is owed on the source itself.
 */
export const ordersForBooking = query({
	args: sourceArgs,
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
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
				refunded: round2(refunds.filter((refund) => refund.billId === order._id).reduce((sum, refund) => sum + refund.amount, 0)),
				corrected: (order.correctionRevision ?? 0) > 0,
				voidUnreceived: order.voidUnreceived ?? false
			});
		}
		return {
			balance: { total, paid: round2(paid), owed: Math.max(round2(owed), 0), refunded, credit },
			/** Recorded refunds on the stay, newest first (none for appointments here; see adminServices). */
			refunds: refunds.slice(0, 10).map((refund) => ({
				_id: refund._id, amount: refund.amount, method: refund.method, reason: refund.reason, effectiveAt: refund.effectiveAt, billId: refund.billId ?? null
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

/** Unpaid appointments saved before guestPhoneDigits/guestEmailNormalized existed. Empty once backfilled. */
function legacyUnpaidAppointments(ctx: ReadCtx) {
	return ctx.db
		.query('serviceAppointments')
		.withIndex('by_guestPhoneDigits_and_paymentStatus', (q) => q.eq('guestPhoneDigits', undefined).eq('paymentStatus', 'unpaid'));
}

/** Contacts searched by both the results and their completeness indicator. */
async function attachContacts(ctx: ReadCtx, args: { orderId?: Id<'bills'>; query?: string }) {
	const order = args.orderId ? await ctx.db.get(args.orderId) : null;
	const customer = order?.customerId ? await ctx.db.get(order.customerId) : null;
	const phones = new Set<string>();
	const emails = new Set<string>();
	if (customer?.phoneDigits && customer.phoneDigits.length >= 4) phones.add(customer.phoneDigits);
	if (customer?.emailNormalized) emails.add(customer.emailNormalized);
	const text = args.query?.trim() ?? '';
	if (text.length >= 2) {
		const digits = text.replace(/\D/g, '');
		if (digits.length >= 4) phones.add(digits);
		if (text.includes('@')) emails.add(text.toLowerCase());
	}
	return { phones, emails, text };
}

/**
 * A contact's newest 20 records need not be its newest 20 payable stays. Read at most 500
 * records, keeping payable matches; a capped scan is reported beside the results. Status alone
 * is insufficient: a paid stay can owe more after an extension, and a documented provider
 * refund can leave other nights collectible.
 */
async function payableBookingMatches(query: AsyncIterable<Doc<'bookings'>>) {
	const rows: Doc<'bookings'>[] = [];
	let scanned = 0;
	for await (const booking of query) {
		if (++scanned > LEGACY_LOOKUP_SCAN) return { rows, complete: false };
		if (bookingPayable(booking)) rows.push(booking);
		if (rows.length >= ATTACH_SCAN) return { rows, complete: true };
	}
	return { rows, complete: true };
}

async function contactBookings(ctx: ReadCtx, contacts: Awaited<ReturnType<typeof attachContacts>>) {
	const searches: Array<ReturnType<typeof payableBookingMatches>> = [];
	if (contacts.text.length >= 2) {
		// Raw phone preserves lookups for stays saved before normalized contacts existed.
		searches.push(payableBookingMatches(ctx.db.query('bookings').withIndex('by_guestPhone', (q) => q.eq('guestPhone', contacts.text)).order('desc')));
	}
	for (const digits of contacts.phones) {
		searches.push(payableBookingMatches(ctx.db.query('bookings').withIndex('by_guestPhoneDigits', (q) => q.eq('guestPhoneDigits', digits)).order('desc')));
	}
	for (const email of contacts.emails) {
		searches.push(payableBookingMatches(ctx.db.query('bookings').withIndex('by_guestEmailNormalized', (q) => q.eq('guestEmailNormalized', email)).order('desc')));
	}
	const results = await Promise.all(searches);
	return { rows: results.flatMap((result) => result.rows), complete: results.every((result) => result.complete) };
}

/** Whether this contact lookup reached its result limit/exhausted its bounded scans. */
export const attachLookupStatus = query({
	args: { orderId: v.optional(v.id('bills')), query: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const [waiting, bookings] = await Promise.all([
			legacyUnpaidAppointments(ctx).take(LEGACY_LOOKUP_SCAN + 1),
			contactBookings(ctx, await attachContacts(ctx, args))
		]);
		return { complete: waiting.length <= LEGACY_LOOKUP_SCAN && bookings.complete, ...(!bookings.complete ? { bookingsIncomplete: true } : {}) };
	}
});

/**
 * Unpaid stays and appointments staff can add to an order: the order's own booking (and its
 * appointments), the linked customer's bookings and appointments by exact phone digits or email,
 * and anything matching `query` (booking or appointment reference, phone digits in any
 * formatting, email in any case, or guest name). Nothing is added automatically.
 */
export const listAttachable = query({
	args: { orderId: v.optional(v.id('bills')), query: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const { bookings, appointments } = await findSources(ctx, args);
		const onOrder = async (source: OrderSource) => {
			const other = await openOrderCharging(ctx, source);
			return other ? { _id: other._id, title: orderTitle(other.orderNumber) } : null;
		};
		const rows = [];
		for (const booking of bookings.values()) {
			if (!bookingPayable(booking)) continue;
			const property = await ctx.db.get(booking.propertyId);
			rows.push({
				kind: 'booking' as const,
				id: booking._id as string,
				name: `Stay · ${property?.name ?? 'Villa'}`,
				detail: `${booking.checkIn} → ${booking.checkOut}${booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}`,
				guestName: booking.guestName,
				price: bookingChargeTotal(booking),
				currency: booking.currency,
				deposit: bookingBalance(booking).paid,
				unavailableReason: bookingCheckoutBlock(booking),
				onOrder: await onOrder({ bookingId: booking._id })
			});
		}
		for (const appointment of appointments.values()) {
			if (!appointmentAttachable(appointment)) continue;
			const service = await ctx.db.get(appointment.serviceId);
			const { date, time } = resortLocalParts(appointment.start);
			rows.push({
				kind: 'appointment' as const,
				id: appointment._id as string,
				name: service?.name ?? 'Appointment',
				detail: `${date} ${time} · ${appointment.confirmationCode}`,
				guestName: appointment.guestName,
				price: appointment.price,
				currency: appointment.currency,
				deposit: 0,
				unavailableReason: null,
				onOrder: await onOrder({ appointmentId: appointment._id })
			});
		}
		return rows;
	}
});

/**
 * Stays and appointments matching an order and a search, as Add booking finds them (see
 * listAttachable): the order's own booking, its customer's contacts and `query`. Unfiltered: callers
 * decide which can be charged or linked.
 */
async function findSources(ctx: ReadCtx, args: { orderId?: Id<'bills'>; query?: string }) {
	const order = args.orderId ? await ctx.db.get(args.orderId) : null;
	const bookings = new Map<Id<'bookings'>, Doc<'bookings'>>();
	const appointments = new Map<Id<'serviceAppointments'>, Doc<'serviceAppointments'>>();
	const addBookings = (rows: Doc<'bookings'>[]) => rows.forEach((row) => bookings.set(row._id, row));
	const addAppointments = (rows: Doc<'serviceAppointments'>[]) => rows.forEach((row) => appointments.set(row._id, row));

	if (order?.bookingId) {
		const booking = await ctx.db.get(order.bookingId);
		if (booking) addBookings([booking]);
	}
	if (order?.appointmentId) {
		const appointment = await ctx.db.get(order.appointmentId);
		if (appointment) addAppointments([appointment]);
	}
	const searches: Array<Promise<Doc<'bookings'>[] | Doc<'serviceAppointments'>[]>> = [];
	const contacts = await attachContacts(ctx, args);
	const { phones, emails, text } = contacts;
	addBookings((await contactBookings(ctx, contacts)).rows);
	if (text.length >= 2) {
		const code = text.toUpperCase();
		searches.push(
			ctx.db.query('bookings').withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', code)).take(5),
			ctx.db.query('serviceAppointments').withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', code)).take(5),
			ctx.db.query('bookings').withSearchIndex('search_guestName', (q) => q.search('guestName', text)).take(ATTACH_SCAN),
			ctx.db.query('serviceAppointments').withSearchIndex('search_guestName', (q) => q.search('guestName', text)).take(ATTACH_SCAN)
		);
	}
	for (const digits of phones) {
		searches.push(
			// Only unpaid appointments can be added, so the read is limited to those, not to the latest few.
			ctx.db.query('serviceAppointments').withIndex('by_guestPhoneDigits_and_paymentStatus', (q) => q.eq('guestPhoneDigits', digits).eq('paymentStatus', 'unpaid')).take(ATTACH_SCAN)
		);
	}
	for (const email of emails) {
		searches.push(
			ctx.db.query('serviceAppointments').withIndex('by_guestEmailNormalized_and_paymentStatus', (q) => q.eq('guestEmailNormalized', email).eq('paymentStatus', 'unpaid')).take(ATTACH_SCAN)
		);
	}
	if (phones.size || emails.size) {
		// Appointments saved before the lookup fields existed (until
		// migrations:backfillAppointmentGuestLookup) are matched here; attachLookupStatus says
		// when there are more than this reads.
		searches.push(
			legacyUnpaidAppointments(ctx).take(LEGACY_LOOKUP_SCAN).then((rows) =>
				rows.filter((row) => {
					const lookup = appointmentLookupFields(row);
					return phones.has(lookup.guestPhoneDigits) || (lookup.guestEmailNormalized !== undefined && emails.has(lookup.guestEmailNormalized));
				})
			)
		);
	}
	for (const rows of await Promise.all(searches)) {
		for (const row of rows) {
			if ('propertyId' in row) bookings.set(row._id, row);
			else appointments.set(row._id, row);
		}
	}
	// A stay's appointments come with it (they usually go on the stay's order).
	for (const booking of [...bookings.values()].slice(0, 10)) {
		addAppointments(await ctx.db.query('serviceAppointments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).take(ATTACH_SCAN));
	}
	return { bookings, appointments };
}

/**
 * Opening a booking or appointment at checkout (`?booking=` / `?appointment=`). Reuses the open
 * order already charging it or linked to it, so repeated opens and two devices land on the same
 * order. Otherwise creates the booking's order (following its last paid order, if any) and
 * charges what is still owed. An appointment that is part of a stay goes on the stay's order.
 */
async function openSourceOrder(ctx: MutationCtx, source: OrderSource, actor: string) {
	const charging = await openOrderCharging(ctx, source);
	if (charging) return { orderId: charging._id };

	if ('bookingId' in source) {
		const booking = await ctx.db.get(source.bookingId);
		if (!booking) throw new ConvexError('Booking not found');
		const closed = bookingClosedReason(booking);
		if (closed) throw new ConvexError(`${closed}, so there is nothing to charge`);
		// The booking's order (usually created with the booking). Opening it charges what the stay
		// still owes, unless another open order already does (checked above).
		const linked = await linkedOpenOrder(ctx, source);
		if (linked) {
			const order = await editableOrder(ctx, linked._id, actor);
			if (bookingPayable(booking)) await attachTo(ctx, order, source, actor);
			return { orderId: order._id };
		}
		const order = await insertOrder(ctx, actor, { bookingId: booking._id, parentOrderId: (await lastPaidOrder(ctx, source))?._id });
		if (bookingPayable(booking)) await attachTo(ctx, order, source, actor);
		return { orderId: order._id };
	}

	const appointment = await ctx.db.get(source.appointmentId);
	if (!appointment) throw new ConvexError('Appointment not found');
	if (appointment.status === 'cancelled' || appointment.status === 'no_show' || appointment.paymentStatus === 'refunded') {
		throw new ConvexError('This appointment has nothing left to pay');
	}
	const stay: OrderSource | null = appointment.bookingId ? { bookingId: appointment.bookingId } : null;
	let order = stay ? await activeOrderFor(ctx, stay) : await linkedOpenOrder(ctx, source);
	if (!order) {
		const parentOrderId = (await lastPaidOrder(ctx, stay ?? source))?._id;
		order = await insertOrder(ctx, actor, stay ? { bookingId: appointment.bookingId, parentOrderId } : { appointmentId: appointment._id, parentOrderId });
	} else {
		order = await editableOrder(ctx, order._id, actor);
	}
	if (appointmentAttachable(appointment)) await attachTo(ctx, order, source, actor);
	return { orderId: order._id };
}

export const openOrderFor = mutation({
	args: sourceArgs,
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		return await openSourceOrder(ctx, oneSource(args), admin.email);
	}
});

/** URL source IDs are untrusted; preserve the typed action above for internal UI callers. */
export const openOrderForLink = mutation({
	args: { bookingId: v.optional(v.string()), appointmentId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		if (Boolean(args.bookingId) === Boolean(args.appointmentId)) throw new ConvexError('Choose one booking or appointment');
		const bookingId = args.bookingId ? ctx.db.normalizeId('bookings', args.bookingId) : null;
		const appointmentId = args.appointmentId ? ctx.db.normalizeId('serviceAppointments', args.appointmentId) : null;
		if (args.bookingId && !bookingId) throw new ConvexError('Booking not found. Start a new order or choose one from Orders.');
		if (args.appointmentId && !appointmentId) throw new ConvexError('Appointment not found. Start a new order or choose one from Orders.');
		const source = oneSource({ bookingId: bookingId ?? undefined, appointmentId: appointmentId ?? undefined });
		return await openSourceOrder(ctx, source, admin.email);
	}
});

export const addItem = mutation({
	args: { orderId: v.optional(v.id('bills')), item: itemValidator },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		const { item } = args;
		let line: LineFields;
		if (item.kind === 'service') {
			const service = await ctx.db.get(item.serviceId);
			if (!service || service.status !== 'active') throw new ConvexError('This service is no longer offered');
			assertBaht(service.currency, service.name);
			// Not scheduled until staff set a date or time (lib/serviceSchedule.ts); never "now".
			line = { kind: 'service', serviceId: service._id, name: service.name, detail: `${service.durationMin} min`, unitPrice: service.price, currency: CURRENCY, qty: 1, schedule: {} };
		} else if (item.kind === 'room') {
			const property = await ctx.db.get(item.propertyId);
			if (!property || property.status !== 'active') throw new ConvexError('This villa is not available');
			assertBaht(property.currency, property.name);
			line = { kind: 'room', propertyId: property._id, name: property.name, detail: 'per night', unitPrice: property.pricePerNight, currency: CURRENCY, qty: 1 };
		} else {
			const name = cleanText(item.name, 'Item name', 80);
			if (!name) throw new ConvexError('Name the item');
			assertPrice(item.price);
			line = { kind: 'extra', name, unitPrice: round2(item.price), currency: CURRENCY, qty: 1 };
		}

		// Nights and extras stack into one row unless that row has its own price or discount.
		if (MERGES_QTY[line.kind]) {
			const same = (await orderLines(ctx, order._id)).find((l) =>
				l.kind === line.kind && !l.fee && !l.priceOverride && !l.discount && l.unitPrice === line.unitPrice &&
				(line.kind === 'room' ? l.propertyId === line.propertyId : l.name === line.name)
			);
			if (same && same.qty < MAX_QTY) {
				await ctx.db.patch(same._id, { qty: same.qty + 1 });
				await refreshOrder(ctx, order._id);
				await logOrder(ctx, order._id, admin.email, 'line_updated', { before: lineSnapshot(same), after: lineSnapshot({ ...same, qty: same.qty + 1 }) });
				return { orderId: order._id, lineId: same._id };
			}
		}
		await assertRoom(ctx, order._id);
		const lineId = await ctx.db.insert('billLines', { billId: order._id, ...line, createdAt: Date.now() });
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'line_added', { after: { ...lineSnapshot(line), lineId } });
		return { orderId: order._id, lineId };
	}
});

/** Adds a stay or appointment to the order (a new order if none is given). */
export const attach = mutation({
	args: { orderId: v.optional(v.id('bills')), ...sourceArgs },
	handler: async (ctx, { orderId, ...target }) => {
		const admin = await requireAdmin(ctx);
		const source = oneSource(target);
		const order = await editableOrder(ctx, orderId, admin.email);
		await attachTo(ctx, order, source, admin.email);
		return { orderId: order._id };
	}
});

/**
 * Therapist (null = any), service date and time, quantity and discount (null = none) for one row.
 * `serviceDate` ("YYYY-MM-DD") and `serviceTime` ("HH:MM", resort time) are independent and
 * optional: null or '' clears one, and a cleared part is unset, never "now". Changing either moves
 * a legacy row off `startAt`, keeping its other part. `startAt` (null = now) is the legacy form,
 * kept for older clients; it replaces the row's date and time.
 * The quantity moves by `qtyChange` (kept within 1–99), so quick taps on two devices add up.
 */
export const updateLine = mutation({
	args: {
		lineId: v.id('billLines'),
		staffId: v.optional(v.union(v.id('staff'), v.null())),
		startAt: v.optional(v.union(v.number(), v.null())),
		serviceDate: v.optional(v.union(v.string(), v.null())),
		serviceTime: v.optional(v.union(v.string(), v.null())),
		qtyChange: v.optional(v.number()),
		discount: v.optional(v.union(discountValidator, v.null()))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		if (line.fee && (args.qtyChange !== undefined || args.discount)) throw new ConvexError(FEE_FIXED);
		const patch: Partial<Line> = {};
		if (args.staffId !== undefined) {
			if (line.kind !== 'service') throw new ConvexError('Only service rows take a therapist here');
			if (args.staffId) {
				const service = line.serviceId ? await ctx.db.get(line.serviceId) : null;
				const person = await ctx.db.get(args.staffId);
				if (!person || person.status !== 'active') throw new ConvexError('Staff member not found');
				if (!service?.staffIds.includes(args.staffId)) throw new ConvexError(`${person.name} doesn't offer this service`);
			}
			patch.staffId = args.staffId ?? undefined;
		}
		const scheduling = args.serviceDate !== undefined || args.serviceTime !== undefined;
		if (scheduling && args.startAt !== undefined) throw new ConvexError('Set the service date and time, or a start time, not both');
		if (args.startAt !== undefined) {
			if (line.kind !== 'service') throw new ConvexError('Only service rows take a start time here');
			if (args.startAt !== null && !Number.isSafeInteger(args.startAt)) throw new ConvexError('Invalid start time');
			patch.startAt = args.startAt ?? undefined;
			patch.schedule = undefined;
		}
		if (scheduling) {
			if (line.kind !== 'service') throw new ConvexError('Only service rows take a date and time here');
			const current = line.schedule ?? (line.startAt !== undefined ? scheduleFromStartAt(line.startAt) : {});
			const next = changeSchedule(current, { date: args.serviceDate, time: args.serviceTime });
			if ('problem' in next) throw new ConvexError(next.problem);
			patch.schedule = next.schedule;
			patch.startAt = undefined;
		}
		if (args.qtyChange !== undefined) {
			if (!MERGES_QTY[line.kind]) throw new ConvexError('Add another row instead: each service is its own row');
			if (!Number.isInteger(args.qtyChange) || Math.abs(args.qtyChange) > MAX_QTY) throw new ConvexError('Invalid quantity change');
			patch.qty = Math.min(Math.max(line.qty + args.qtyChange, 1), MAX_QTY);
		}
		if (args.discount !== undefined) {
			if (line.kind === 'booking' && args.discount) throw new ConvexError(ATTACHED_PRICE);
			if (args.discount) assertDiscount(args.discount);
			patch.discount = args.discount && args.discount.value > 0 ? args.discount : undefined;
		}
		await ctx.db.patch(line._id, patch);
		await refreshOrder(ctx, order._id);
		const before = lineSnapshot(line);
		const after = lineSnapshot({ ...line, ...patch });
		if (JSON.stringify(before) !== JSON.stringify(after)) await logOrder(ctx, order._id, admin.email, 'line_updated', { before, after });
	}
});

/** One-off price for a row. Setting a price needs a note; every change is kept in billAudit. */
export const overrideLinePrice = mutation({
	args: { lineId: v.id('billLines'), price: v.union(v.number(), v.null()), note: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		if (line.kind === 'booking' && args.price !== null) throw new ConvexError(ATTACHED_PRICE);
		if (line.fee && args.price !== null) throw new ConvexError(FEE_FIXED);
		const fromPrice = line.priceOverride?.price ?? line.unitPrice;
		let note: string | undefined;
		if (args.price === null) {
			if (!line.priceOverride) return;
			note = cleanText(args.note, 'Note', NOTE_MAX);
			await ctx.db.patch(line._id, { priceOverride: undefined });
		} else {
			note = assertPriceOverride(args.price, args.note);
			await ctx.db.patch(line._id, { priceOverride: { price: round2(args.price), note, by: admin.email, at: Date.now() } });
		}
		await ctx.db.insert('billAudit', {
			billId: order._id, lineId: line._id, at: Date.now(), actor: admin.email, kind: 'price_override',
			fromPrice, toPrice: args.price === null ? line.unitPrice : round2(args.price), note
		});
		await refreshOrder(ctx, order._id);
	}
});

export const removeLine = mutation({
	args: { lineId: v.id('billLines') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		await ctx.db.delete(line._id);
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'line_removed', { before: lineSnapshot(line) });
		if (line.fee && line.feeAppointmentId) {
			await appendRecordHistory(ctx, {
				entityType: 'appointment', entityId: line.feeAppointmentId, actor: admin.email, kind: 'fee_removed',
				before: { feeKind: line.fee.kind, amount: line.unitPrice, billId: order._id }
			});
		}
	}
});

/**
 * Marketing release 2b. Applies one coupon to an unpaid order, replacing any coupon already on it.
 * `code` is typed or read from a pasted link (lib/posCoupons parseCouponInput); `slug` is a scanned
 * short link, resolved here to its active coupon. The order's current coupon version is frozen on
 * `bills.promotion`; the split lands on billLines.couponDiscount and the revision changes, so any
 * payment reviewed before has to be reviewed again. Nothing is held: settleOrder consumes the use.
 * When it can't apply, throws ConvexError { code: 'coupon_unavailable', message, problem:
 * PosCouponProblem } and writes nothing. Applying the code already on the order re-checks it.
 */
export const applyOrderCoupon = mutation({
	args: { orderId: v.id('bills'), code: v.optional(v.string()), slug: v.optional(v.string()) },
	handler: async (ctx, args): Promise<{ code: string; discount: number; revision: number }> => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if ((args.code !== undefined) === (args.slug !== undefined)) throw new ConvexError('Choose one coupon code or link');
		let coupon: Doc<'coupons'> | null;
		let viaLinkId: Id<'marketingLinks'> | undefined;
		if (args.slug !== undefined) {
			const link = await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', args.slug!)).unique();
			viaLinkId = link?._id;
			coupon = link?.couponId ? await ctx.db.get(link.couponId) : null;
			if (link?.status !== 'active' || coupon?.status !== 'active') orderCouponUnavailable({ code: 'link_without_offer' }, coupon?.code);
		} else {
			coupon = await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', normalizeCouponCode(args.code!))).unique();
		}
		if (!coupon) orderCouponUnavailable({ code: 'not_found' });
		const lines = await orderLines(ctx, order._id);
		const result = await quoteOrderCoupon(ctx, lines, coupon._id, coupon.currentVersion);
		if (!result.ok) orderCouponUnavailable(result.problem, coupon.code);
		await ctx.db.patch(order._id, { promotion: { couponId: coupon._id, couponVersion: coupon.currentVersion, code: coupon.code, discount: result.discount, appliedAt: Date.now(), appliedBy: admin.email, ...(viaLinkId ? { viaLinkId } : {}) } });
		await writeCouponShares(ctx, lines, result);
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'coupon_applied', {
			...(order.promotion ? { before: { code: order.promotion.code } } : {}),
			after: { code: coupon.code, couponVersion: coupon.currentVersion, discount: result.discount }
		});
		return { code: coupon.code, discount: result.discount, revision: order.revision + 1 };
	}
});

/** Removes the order's coupon and every row's share of it. A no-op when the order has none. */
export const removeOrderCoupon = mutation({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args): Promise<{ revision: number }> => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.promotion) return { revision: order.revision };
		await ctx.db.patch(order._id, { promotion: undefined });
		await writeCouponShares(ctx, await orderLines(ctx, order._id), null);
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'coupon_removed', { before: { code: order.promotion.code, discount: order.promotion.discount } });
		return { revision: order.revision + 1 };
	}
});

/**
 * Checks the order's coupon again with its frozen version: after payment refused it, or once a
 * problem may be gone (a paused coupon resumed, a limit raised). The split and the revision follow,
 * so staff review any new total before paying. Use applyOrderCoupon to adopt the current version.
 */
export const recheckOrderCoupon = mutation({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args): Promise<{ revision: number; discount: number; problem: PosCouponProblem | null }> => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.promotion) throw new ConvexError('This order has no coupon');
		await refreshOrder(ctx, order._id);
		const updated = (await ctx.db.get(order._id))!;
		return { revision: updated.revision, discount: updated.promotion?.discount ?? 0, problem: updated.promotion?.problem ?? null };
	}
});

/**
 * Brings a booking or appointment row in line with its source after the stay or appointment
 * changed (new dates, price, deposit, therapist or time), or removes it if it was paid or
 * cancelled elsewhere meanwhile. The order's revision changes, so any payment begun on the old
 * row has to be reviewed again.
 */
export const updateSourceLine = mutation({
	args: { lineId: v.id('billLines') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		if (!isSourceRow(line)) throw new ConvexError('Only booking, appointment and fee rows follow their source');
		const issue = await sourceIssue(ctx, line);
		if (!issue) return { result: 'current' as const };
		if (issue.kind === 'online') throw new ConvexError(issue.message);
		// A fee row is never "updated": its appointment either still takes the fee or the row goes.
		if (line.fee && issue.kind === 'changed') return { result: 'current' as const };
		const at = Date.now();
		if (issue.kind === 'settled' || issue.kind === 'gone') {
			await ctx.db.delete(line._id);
			await ctx.db.insert('billAudit', { billId: order._id, lineId: line._id, at, actor: admin.email, kind: 'source_removed', fromPrice: line.unitPrice, note: `${line.name}: ${issue.message}` });
			await refreshOrder(ctx, order._id);
			return { result: 'removed' as const };
		}
		let fresh: LineFields;
		if (line.bookingId) {
			const booking = (await ctx.db.get(line.bookingId))!;
			assertBaht(booking.currency, 'This booking');
			fresh = await bookingLine(ctx, booking);
		} else {
			const appointment = (await ctx.db.get(line.appointmentId!))!;
			assertBaht(appointment.currency, 'This appointment');
			fresh = await appointmentLine(ctx, appointment);
		}
		// A deposit that is gone (e.g. a refunded online payment) is cleared, not kept from the old row.
		await ctx.db.patch(line._id, { ...fresh, deposit: fresh.deposit });
		await ctx.db.insert('billAudit', { billId: order._id, lineId: line._id, at, actor: admin.email, kind: 'source_updated', fromPrice: line.unitPrice, toPrice: fresh.unitPrice, note: fresh.detail });
		await refreshOrder(ctx, order._id);
		return { result: 'updated' as const };
	}
});

/**
 * Links a customer to the order (a new order if none is given). The booking's guest is left as
 * it is: the payer and the guest can be different people. Bumps the revision, so a payment
 * reviewed before the change must be reviewed again.
 */
export const linkCustomer = mutation({
	args: { orderId: v.optional(v.id('bills')), customerId: v.id('customers') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		// Refuses missing, archived and merged-away profiles (customers.ts contract); never redirects a merged id.
		const customer = assertCustomerCanLink(await ctx.db.get(args.customerId));
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (order.customerId === customer._id) return { orderId: order._id };
		const now = Date.now();
		await ctx.db.patch(order._id, { customerId: customer._id, revision: order.revision + 1, updatedAt: now });
		await ctx.db.insert('billAudit', { billId: order._id, at: now, actor: admin.email, kind: 'customer_linked', customerId: customer._id, note: customer.name });
		return { orderId: order._id };
	}
});

export const unlinkCustomer = mutation({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.customerId) return { orderId: order._id };
		const now = Date.now();
		await ctx.db.patch(order._id, { customerId: undefined, revision: order.revision + 1, updatedAt: now });
		await ctx.db.insert('billAudit', { billId: order._id, at: now, actor: admin.email, kind: 'customer_unlinked', customerId: order.customerId });
		return { orderId: order._id };
	}
});

/**
 * Save & close: every edit is already on the server, so this only moves the order to the top of
 * Unpaid orders. Nothing about the order changes (not its revision), so a payment open on
 * another device is not disturbed.
 */
export const saveOrder = mutation({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.hasItems) throw new ConvexError('Add an item before saving the order');
		await ctx.db.patch(order._id, { updatedAt: Date.now() });
	}
});

/** Removes every row. The number, explicit source ownership, customer and audit trail stay. */
export const clearOrder = mutation({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		const lines = await orderLines(ctx, order._id);
		for (const line of lines) await ctx.db.delete(line._id);
		await ctx.db.patch(order._id, { promotion: undefined });
		await ctx.db.insert('billAudit', { billId: order._id, at: Date.now(), actor: admin.email, kind: 'cleared' });
		await refreshOrder(ctx, order._id);
		// The removed rows, so the history shows what was cleared (restoring them is the discard/restore task).
		if (lines.length) await logOrder(ctx, order._id, admin.email, 'cleared', { before: { lines: lines.map(lineSnapshot) } });
	}
});

/**
 * Pays the order. `idempotencyKey` identifies one payment attempt: retrying it after a dropped
 * connection returns the first result instead of charging twice. `expectedDue` and
 * `expectedRevision` are what staff reviewed; if the order changed since (items, prices or its
 * customer), nothing is written.
 *
 * `effectiveAt` is the business date the money was received (default now; any past date, never the
 * future). It is kept on the payments, on each stay's payment record and on each appointment's
 * `paidAt`; the receipt's issue time (`paidAt` on the order) is always now. `notifyGuest` decides
 * whether a charged stay's confirmation is emailed (default: not for stays that started before
 * today). `expectedCustomerRevision` is the linked customer's profile revision staff reviewed
 * (customers.ts assertCustomerReviewed); it refuses a payment reviewed before a profile correction
 * or merge, and becomes required when customers.ts turns on CUSTOMER_POS_INTEGRATION_ENABLED.
 */
export const settleOrder = mutation({
	args: {
		orderId: v.id('bills'), idempotencyKey: v.string(), expectedDue: v.number(), expectedRevision: v.number(), tenders: v.array(tenderValidator),
		effectiveAt: v.optional(v.number()),
		notifyGuest: v.optional(v.boolean()),
		expectedCustomerRevision: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const key = args.idempotencyKey.trim();
		if (key.length < 8 || key.length > 100) throw new ConvexError('Invalid payment attempt');
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (!isOpenOrder(order)) {
			if (order.settleKey === key && order.receiptNumber !== undefined) return { receiptNumber: order.receiptNumber, replayed: true };
			throw new ConvexError(order.status === 'void' ? 'This order was voided' : order.status === 'discarded' ? DISCARDED_ORDER : 'This order is already paid');
		}
		const lines = await orderLines(ctx, order._id);
		if (!lines.length) throw new ConvexError('Add an item first');
		if (order.promotion) {
			// Always a fresh check: a stored problem may be gone (a paused coupon resumed), and the
			// stored shares then differ, so staff review the new saving before paying.
			const result = await quoteOrderCoupon(ctx, lines, order.promotion.couponId, order.promotion.couponVersion);
			if (!result.ok) orderCouponUnavailable(result.problem);
			const shares = new Map(result.allocation.map(share => [share.lineId, share.discount]));
			if (result.discount !== order.promotion.discount || lines.some(line => (line.couponDiscount ?? 0) !== (shares.get(line._id) ?? 0))) {
				throw new ConvexError({ code: 'coupon_changed', message: `The coupon now saves ฿${result.discount.toLocaleString('en-US', { maximumFractionDigits: 2 })}. Check the coupon again before taking payment.`, discount: result.discount });
			}
		}
		const totals = billTotals(lines);
		if (totals.due !== round2(args.expectedDue) || order.revision !== args.expectedRevision) throw new ConvexError('The order changed. Check the total and pay again.');
		assertTenders(args.tenders, totals.due);
		const customer = order.customerId ? await ctx.db.get(order.customerId) : null;
		if (order.customerId) {
			// Missing or merged customers always refuse. The reviewed customer revision is required once
			// customers.ts enables POS integration; until then a caller that omits it is protected by the
			// order revision bump customers.ts makes on every identity edit.
			assertCustomerReviewed(customer, args.expectedCustomerRevision ?? (CUSTOMER_POS_INTEGRATION_ENABLED ? undefined : (customer?.revision ?? 0)));
		}

		const now = Date.now();
		const effectiveAt = effectiveTime(args.effectiveAt, now);
		if (order.promotion) await consumeOrderCoupon(ctx, order._id, order.promotion);
		for (const line of lines) {
			if (!isSourceRow(line)) continue;
			const issue = await sourceIssue(ctx, line);
			if (issue) throw new ConvexError(issue.kind === 'changed' ? `${line.name} changed since it was added. Update the row and review the total.` : `${line.name}: ${issue.message}`);
			if (line.bookingId) {
				// Charged at the booked price, so what the stay still owed is what this order collected for it.
				if (line.discount || line.priceOverride) throw new ConvexError(ATTACHED_PRICE);
				await markBookingPaid(ctx, line.bookingId, 'pos', { actor: admin.email, effectiveAt, billId: order._id, notifyGuest: args.notifyGuest });
			}
			if (line.appointmentId) {
				const appointment = (await ctx.db.get(line.appointmentId))!;
				// The appointment keeps what was charged for it, after any discount or price change here.
				await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid', price: lineNet(line), amountPaid: lineNet(line), amountRefunded: 0, paidAt: effectiveAt, paidBy: admin.email }, { actor: admin.email, kind: 'payment', reason: 'Paid at checkout', effectiveAt });
			}
		}
		// The receipt prints each therapist's name as it is now; a later rename doesn't rewrite it.
		for (const line of lines) {
			if (!line.staffId) continue;
			const person = await ctx.db.get(line.staffId);
			await ctx.db.patch(line._id, { staffName: person?.name ?? 'Former staff member' });
		}
		for (const tender of args.tenders) {
			await ctx.db.insert('billPayments', { billId: order._id, ...tender, idempotencyKey: key, createdBy: admin.email, createdAt: now, effectiveAt });
		}
		const receiptNumber = await nextCounter(ctx, RECEIPT_COUNTER);
		// The receipt names who it was issued to as they were then; later profile edits don't change it.
		const customerSnapshot = customer
			? { name: customer.name, phone: customer.phone, email: customer.email }
			: order.guestName ? { name: order.guestName, phone: order.guestPhone, email: order.guestEmail } : undefined;
		await ctx.db.patch(order._id, {
			status: 'paid', receiptNumber, settleKey: key, total: totals.total, due: 0, customerSnapshot, paidAt: now, paidBy: admin.email, updatedAt: now,
			paymentEffectiveAt: effectiveAt, ...(customer ? { customerRevisionAtPayment: customer.revision ?? 0 } : {})
		});
		await ctx.db.insert('billAudit', { billId: order._id, at: now, actor: admin.email, kind: 'paid', toPrice: totals.due });
		// A fee is noted on its appointment's history; the appointment itself (status, payment) is unchanged.
		for (const line of lines) {
			if (!line.fee || !line.feeAppointmentId) continue;
			await appendRecordHistory(ctx, {
				entityType: 'appointment', entityId: line.feeAppointmentId, actor: admin.email, kind: 'fee_charged', effectiveAt,
				...(line.fee.reason ? { reason: line.fee.reason } : {}),
				after: { feeKind: line.fee.kind, amount: lineNet(line), currency: line.currency, billId: order._id, receiptNumber }
			});
		}
		return { receiptNumber, replayed: false };
	}
});

/**
 * Voids a paid order. The record, its order and receipt numbers, payments and audit trail stay;
 * charged bookings and appointments keep their paid status, because the money was received (record
 * a refund on them if it is returned). For a payment recorded by mistake when no money changed
 * hands, use voidUnreceivedOrder instead.
 */
export const voidOrder = mutation({
	args: { orderId: v.id('bills'), reason: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const reason = cleanText(args.reason, 'Reason', NOTE_MAX);
		if (!reason) throw new ConvexError('Give a reason for the void');
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order can be voided');
		const now = Date.now();
		await syncOrderCouponRedemption(ctx, order._id, 'reversed');
		await ctx.db.patch(order._id, { status: 'void', voidedAt: now, voidedBy: admin.email, voidReason: reason, updatedAt: now });
		await ctx.db.insert('billAudit', { billId: order._id, at: now, actor: admin.email, kind: 'void', note: reason });
		// Stays charged at checkout or linked later; their payments are kept.
		const stays = [...(await sourceRows(ctx, order._id)), ...(await orderLineLinks(ctx, order._id, 'active'))].flatMap((row) => (row.bookingId ? [row.bookingId] : []));
		for (const bookingId of new Set(stays)) {
			if (await ctx.db.get(bookingId)) {
				await appendBookingHistory(ctx, bookingId, {
					actor: admin.email, kind: 'order_voided', reason,
					after: { billId: order._id, receiptNumber: order.receiptNumber ?? null, paymentKept: true }
				});
			}
		}
	}
});

const correctionArgs = { orderId: v.id('bills'), expectedCorrectionRevision: v.number(), idempotencyKey: v.string(), reason: v.string() };

async function correctionReplay(ctx: MutationCtx, orderId: Id<'bills'>, idempotencyKey: string, kind: Doc<'billCorrections'>['kind']) {
	const key = attemptKey(idempotencyKey);
	const existing = await ctx.db.query('billCorrections').withIndex('by_idempotencyKey', (q) => q.eq('idempotencyKey', key)).first();
	if (existing && (existing.billId !== orderId || existing.kind !== kind)) throw new ConvexError('This correction attempt was already used for something else. Start again.');
	return { key, existing };
}

function assertCorrectionRevision(order: Order, expected: number) {
	if (expected !== (order.correctionRevision ?? 0)) throw new ConvexError('This receipt was corrected since you opened it. Review it and try again.');
}

const cleanTender = (tender: { method: Doc<'billPayments'>['method']; amount: number; received?: number }) => ({
	method: tender.method, amount: tender.amount, ...(tender.received !== undefined ? { received: tender.received } : {})
});

/**
 * Corrects a paid order's payment record: how it was paid (tenders, same total), the business date
 * it was received, or who the receipt is for. The issued receipt, its number, its original payments
 * and `customerSnapshot` are never changed; the correction is a billCorrections row with before and
 * after, and getOrder returns both. Deposits paid online are not tenders and can't be touched here.
 * A new effective date also moves the stays' payment records and appointments' `paidAt`.
 */
export const amendOrderPayment = mutation({
	args: {
		...correctionArgs,
		tenders: v.optional(v.array(correctedTender)),
		effectiveAt: v.optional(v.number()),
		/** The corrected payer, with the profile revision staff reviewed; null = no named customer. */
		customer: v.optional(v.object({ customerId: v.union(v.null(), v.id('customers')), expectedCustomerRevision: v.optional(v.number()) }))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'amended');
		if (existing) return { sequence: existing.sequence, replayed: true };
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order’s payment can be corrected.');
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason for the correction')!;
		const payments = await ctx.db.query('billPayments').withIndex('by_billId', (q) => q.eq('billId', order._id)).take(10);
		const paidTotal = round2(payments.reduce((sum, payment) => sum + payment.amount, 0));
		const now = Date.now();
		const patch: Partial<Order> = {};
		const correction: Partial<Doc<'billCorrections'>> = {};

		if (args.tenders) {
			if (paidTotal === 0) throw new ConvexError('Nothing was paid on this order, so there are no tenders to correct.');
			assertTenders(args.tenders, paidTotal);
			const before = order.amendedTenders ?? payments.map(cleanTender);
			const after = args.tenders.map(cleanTender);
			if (JSON.stringify(before) !== JSON.stringify(after)) {
				patch.amendedTenders = after;
				correction.tendersBefore = before;
				correction.tendersAfter = after;
			}
		}
		const previousEffective = order.paymentEffectiveAt ?? order.paidAt ?? now;
		let newEffective: number | undefined;
		if (args.effectiveAt !== undefined) {
			const at = effectiveTime(args.effectiveAt, now);
			if (at !== previousEffective) {
				newEffective = at;
				patch.paymentEffectiveAt = at;
				correction.effectiveAtBefore = previousEffective;
				correction.effectiveAtAfter = at;
			}
		}
		if (args.customer) {
			const before = order.amendedCustomer !== undefined ? order.amendedCustomer : (order.customerSnapshot ?? null);
			let after: Doc<'bills'>['amendedCustomer'] = null;
			if (args.customer.customerId) {
				const customer = assertCustomerCanLink(await ctx.db.get(args.customer.customerId));
				assertCustomerReviewed(customer, args.customer.expectedCustomerRevision);
				after = { name: customer.name, ...(customer.phone ? { phone: customer.phone } : {}), ...(customer.email ? { email: customer.email } : {}) };
			}
			const idBefore = order.customerId ?? null;
			const idAfter = args.customer.customerId;
			if (idBefore !== idAfter || JSON.stringify(before) !== JSON.stringify(after)) {
				patch.amendedCustomer = after;
				patch.customerId = idAfter ?? undefined;
				Object.assign(correction, { customerBefore: before, customerAfter: after, customerIdBefore: idBefore, customerIdAfter: idAfter });
			}
		}
		if (!Object.keys(patch).length) throw new ConvexError('Nothing changed.');

		const sequence = (order.correctionRevision ?? 0) + 1;
		await ctx.db.insert('billCorrections', { billId: order._id, sequence, kind: 'amended', reason, actor: admin.email, recordedAt: now, idempotencyKey: key, ...correction });
		await ctx.db.patch(order._id, { ...patch, correctionRevision: sequence });

		// Linked records follow: each stay's history, and the business date on stays and appointments.
		for (const row of await sourceRows(ctx, order._id)) {
			if (row.bookingId) {
				const booking = await ctx.db.get(row.bookingId);
				if (!booking) continue;
				const payment = await orderStayPayment(ctx, order._id, booking._id);
				const details = { billId: order._id, sequence, tendersChanged: Boolean(patch.amendedTenders), customerChanged: 'amendedCustomer' in patch };
				if (newEffective !== undefined && payment && payment.status === 'recorded') {
					await ctx.db.patch(payment._id, { effectiveAt: newEffective, amendedAt: now, amendedBy: admin.email });
					await writeBooking(ctx, booking, booking.paidAt === payment.effectiveAt ? { paidAt: newEffective } : {}, {
						actor: admin.email, kind: 'payment_amended', reason, effectiveAt: newEffective,
						details: { ...details, paymentId: payment._id, before: { effectiveAt: payment.effectiveAt }, after: { effectiveAt: newEffective } }
					});
				} else {
					await appendBookingHistory(ctx, booking._id, { actor: admin.email, kind: 'order_payment_amended', reason, after: details });
				}
			}
			if (row.appointmentId && newEffective !== undefined) {
				const appointment = await ctx.db.get(row.appointmentId);
				if (appointment?.paymentStatus === 'paid' && appointment.paidAt === previousEffective) {
					await recordAppointmentChange(ctx, appointment, { paidAt: newEffective }, { actor: admin.email, kind: 'payment', reason, effectiveAt: newEffective });
				}
			}
		}
		// Rows linked after payment follow the same way: their money has the order's date.
		for (const link of await orderLineLinks(ctx, order._id, 'active')) {
			if (newEffective !== undefined) await ctx.db.patch(link._id, { effectiveAt: newEffective });
			if (link.bookingId) {
				const booking = await ctx.db.get(link.bookingId);
				if (!booking) continue;
				const payment = link.bookingPaymentId ? await ctx.db.get(link.bookingPaymentId) : null;
				const details = { billId: order._id, sequence, linkId: link._id, tendersChanged: Boolean(patch.amendedTenders), customerChanged: 'amendedCustomer' in patch };
				if (newEffective !== undefined && payment?.status === 'recorded') {
					await ctx.db.patch(payment._id, { effectiveAt: newEffective, amendedAt: now, amendedBy: admin.email });
					await writeBooking(ctx, booking, booking.paidAt === payment.effectiveAt ? { paidAt: newEffective } : {}, {
						actor: admin.email, kind: 'payment_amended', reason, effectiveAt: newEffective,
						details: { ...details, paymentId: payment._id, before: { effectiveAt: payment.effectiveAt }, after: { effectiveAt: newEffective } }
					});
				} else {
					await appendBookingHistory(ctx, booking._id, { actor: admin.email, kind: 'order_payment_amended', reason, after: details });
				}
			}
			if (link.appointmentId && newEffective !== undefined) {
				const appointment = await ctx.db.get(link.appointmentId);
				if (appointment?.paymentStatus === 'paid' && appointment.paidAt === previousEffective) {
					await recordAppointmentChange(ctx, appointment, { paidAt: newEffective }, { actor: admin.email, kind: 'payment', reason, effectiveAt: newEffective });
				}
			}
		}
		return { sequence, replayed: false };
	}
});

const LEGACY_UNPROVEN = (name: string) =>
	`This order was paid before stay payments were itemised, so the app can't prove how much of it was for ${name}. Correct its tenders instead, or record a refund on the booking if money was returned.`;

/**
 * Voids a paid order whose payment was recorded by mistake: no money was ever received. Unlike
 * voidOrder, it reopens what the order charged, exactly by what this order took: each stay loses
 * this order's itemised payment (an earlier online deposit stays), each appointment goes back to
 * unpaid at its price before checkout. It refuses, writing nothing, when any part can't be proved:
 * a stay paid before payments were itemised, money already refunded, or an appointment changed
 * since. The receipt number is never reused.
 */
export const voidUnreceivedOrder = mutation({
	args: correctionArgs,
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'void_unreceived');
		if (existing) return { replayed: true };
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order can be voided');
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason')!;

		// Prove every reversal before writing anything.
		if (await ctx.db.query('appointmentRefunds').withIndex('by_billId', q => q.eq('billId', order._id)).first())
			throw new ConvexError('Part of this order was refunded, so money was received.');
		const stays: Array<{ booking: Doc<'bookings'>; payment: Doc<'bookingPayments'> }> = [];
		const appointments: Array<{ appointment: Doc<'serviceAppointments'>; line: Line }> = [];
		for (const row of await sourceRows(ctx, order._id)) {
			if (row.bookingId) {
				const booking = await ctx.db.get(row.bookingId);
				if (!booking) throw new ConvexError(`${row.name} was deleted, so its payment can't be reversed.`);
				// Reopening a balance under a live online checkout would make its completion unrecordable.
				assertNoLiveCheckout(booking);
				const payment = await orderStayPayment(ctx, order._id, booking._id);
				if (!payment) throw new ConvexError(LEGACY_UNPROVEN(row.name));
				if (payment.status !== 'recorded') throw new ConvexError(`${row.name}: this payment was already reversed.`);
				if (payment.refunded > 0) throw new ConvexError(`Part of what this order took for ${row.name} was refunded, so money was received.`);
				const money = stayMoney(booking);
				if (round2(money.gross - payment.amount) < money.refunded) throw new ConvexError(`Refunds on ${row.name} would exceed what is left paid.`);
				stays.push({ booking, payment });
			}
			if (row.appointmentId) {
				const appointment = await ctx.db.get(row.appointmentId);
				if (!appointment) throw new ConvexError(`${row.name} was deleted, so its payment can't be reversed.`);
				if (appointmentMoney(appointment).refunded > 0 || await ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', appointment._id)).first())
					throw new ConvexError(`Part of ${row.name} was refunded, so money was received.`);
				if (appointment.paymentStatus !== 'paid' || appointment.price !== lineNet(row)) {
					throw new ConvexError(`${row.name} changed since it was paid here (refunded, repriced or paid again), so its payment can't be reversed automatically.`);
				}
				appointments.push({ appointment, line: row });
			}
		}
		// Rows linked after payment applied this order's money too; each is reversed exactly, or nothing is.
		const linked: Array<{ link: Doc<'billLineLinks'>; reverse: Awaited<ReturnType<typeof linkReversal>> }> = [];
		for (const link of await orderLineLinks(ctx, order._id, 'active')) {
			const line = await ctx.db.get(link.lineId);
			linked.push({ link, reverse: await linkReversal(ctx, link, line?.name ?? 'A linked row') });
		}

		const now = Date.now();
		await syncOrderCouponRedemption(ctx, order._id, 'released');
		const sequence = (order.correctionRevision ?? 0) + 1;
		await ctx.db.patch(order._id, {
			status: 'void', voidedAt: now, voidedBy: admin.email, voidReason: reason, voidUnreceived: true, correctionRevision: sequence, updatedAt: now
		});
		await ctx.db.insert('billCorrections', { billId: order._id, sequence, kind: 'void_unreceived', reason, actor: admin.email, recordedAt: now, idempotencyKey: key });
		await ctx.db.insert('billAudit', { billId: order._id, at: now, actor: admin.email, kind: 'void', note: `Recorded in error, no money received: ${reason}` });
		for (const { booking, payment } of stays) {
			await ctx.db.patch(payment._id, { status: 'cancelled', cancelledAt: now, cancelledBy: admin.email, cancelReason: reason });
			const money = stayMoney(booking);
			const gross = round2(money.gross - payment.amount);
			await writeBooking(ctx, booking, await stayPaymentReversalPatch(ctx, booking, gross),
				{ actor: admin.email, kind: 'payment_cancelled', reason, details: { paymentId: payment._id, billId: order._id, amount: payment.amount } });
		}
		for (const { appointment, line } of appointments) {
			await recordAppointmentChange(ctx, appointment, { paymentStatus: 'unpaid', price: line.unitPrice, amountPaid: 0, amountRefunded: 0, paidAt: undefined, paidBy: undefined }, {
				actor: admin.email, kind: 'payment', reason: `${orderTitle(order.orderNumber)} voided as recorded in error: ${reason}`
			});
		}
		for (const { link, reverse } of linked) {
			await reverse(admin.email, `${orderTitle(order.orderNumber)} voided as recorded in error: ${reason}`);
			await ctx.db.patch(link._id, { status: 'unlinked', unlinkedAt: now, unlinkedBy: admin.email, unlinkReason: `Order voided as recorded in error: ${reason}`, unlinkSequence: sequence });
		}
		return { replayed: false };
	}
});

/** An order's history of ordinary edits (rows added, changed, removed, cleared), newest first. */
export const orderHistory = query({
	args: { orderId: v.id('bills'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const { numItems } = args.paginationOpts;
		if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new ConvexError('Page size must be 1–50');
		return await ctx.db
			.query('recordChanges')
			.withIndex('by_entityType_and_entityId_and_recordedAt', (q) => q.eq('entityType', 'order').eq('entityId', args.orderId))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

// ---------------------------------------------------------------------------------------------
// Discarding and restoring unpaid orders
// ---------------------------------------------------------------------------------------------

const lifecycleArgs = { orderId: v.id('bills'), expectedRevision: v.number(), idempotencyKey: v.string() };

/** Who, when and why an order was discarded, as the lists and the order screen show it. */
type RestoreConflict = {
	kind: 'charged_elsewhere' | 'changed' | 'settled' | 'gone' | 'online' | 'link_shared' | 'customer';
	/** Blocking conflicts stop a restore unless `removeConflictingRows` takes those rows off. */
	blocking: boolean;
	lineId: Id<'billLines'> | null;
	name: string;
	message: string;
	order: { _id: Id<'bills'>; title: string } | null;
};

/**
 * What restoring this discarded order would meet, row by row, without changing anything.
 * - Blocking: a stay, appointment or fee it carries is now on another open order. Restoring that
 *   row would put one source on two open orders (a second chargeable copy), so it is refused or,
 *   when asked, the row is taken off.
 * - Not blocking: the source changed, was paid, cancelled or deleted, or has an online checkout
 *   running. The row comes back exactly as it was (its source is never overwritten) and is flagged,
 *   so payment is refused until staff update or remove it, as for any open order.
 * - Not blocking: another open order is also linked to the same booking, or the linked customer was
 *   archived, merged or deleted.
 */
async function restoreConflicts(ctx: ReadCtx, order: Order, lines: Line[]): Promise<RestoreConflict[]> {
	const out: RestoreConflict[] = [];
	for (const line of lines) {
		if (!isSourceRow(line)) continue;
		let other: Order | null = null;
		if (line.bookingId) other = await openOrderCharging(ctx, { bookingId: line.bookingId }, order._id);
		else if (line.appointmentId) other = await openOrderCharging(ctx, { appointmentId: line.appointmentId }, order._id);
		else if (line.feeAppointmentId) other = (await liveFees(ctx, line.feeAppointmentId, order._id)).find((fee) => isOpenOrder(fee.order))?.order ?? null;
		if (other) {
			out.push({
				kind: 'charged_elsewhere', blocking: true, lineId: line._id, name: line.name,
				message: `${line.name} is now on ${orderTitle(other.orderNumber)}.`, order: { _id: other._id, title: orderTitle(other.orderNumber) }
			});
			continue;
		}
		const issue = await sourceIssue(ctx, line);
		if (issue) out.push({ kind: issue.kind, blocking: false, lineId: line._id, name: line.name, message: issue.message, order: null });
	}
	const link: OrderSource | null = order.bookingId ? { bookingId: order.bookingId } : order.appointmentId ? { appointmentId: order.appointmentId } : null;
	if (link) {
		const other = await linkedOpenOrder(ctx, link);
		if (other && other._id !== order._id) {
			out.push({
				kind: 'link_shared', blocking: false, lineId: null, name: 'bookingId' in link ? 'Booking' : 'Appointment',
				message: `${orderTitle(other.orderNumber)} is also open for this booking. Both stay linked; nothing is charged twice.`,
				order: { _id: other._id, title: orderTitle(other.orderNumber) }
			});
		}
	}
	if (order.customerId) {
		const customer = await ctx.db.get(order.customerId);
		const message = !customer
			? 'The linked customer no longer exists. Link another customer or remove the link before paying.'
			: customer.mergedInto
				? 'The linked customer was merged into another profile. Review the customer before paying.'
				: customer.archivedAt
					? 'The linked customer is archived. The link stays; restore the profile or change the customer if needed.'
					: null;
		if (message) out.push({ kind: 'customer', blocking: false, lineId: null, name: customer?.name ?? 'Customer', message, order: null });
	}
	return out;
}

const discardedInfo = (order: Order) => ({ at: order.discardedAt ?? order.updatedAt, by: order.discardedBy ?? null, reason: order.discardReason ?? null });

/**
 * Discards an unpaid order staff no longer want: it leaves Unpaid orders and appears under
 * Discarded. Everything is kept: its number, rows, booking links, customer and history. While
 * discarded it can't be changed or paid, and it no longer holds its stays, appointments or fees,
 * so they can be charged on another order or recorded as paid elsewhere. The bookings and
 * appointments themselves are not touched (nothing is cancelled).
 *
 * `expectedRevision` is the order revision staff saw; `idempotencyKey` makes a retry after a lost
 * response return `replayed: true`. Paid and void orders refuse (void a paid order instead). An
 * empty order refuses: it is not listed, so there is nothing to discard.
 */
export const discardOrder = mutation({
	args: { ...lifecycleArgs, reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const key = attemptKey(args.idempotencyKey);
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status === 'discarded') {
			if (order.lifecycleKey === key) return { replayed: true };
			throw new ConvexError('This order is already discarded.');
		}
		if (order.status === 'paid') throw new ConvexError('A paid order can’t be discarded. Void it instead.');
		if (order.status === 'void') throw new ConvexError('This order was voided');
		if (order.revision !== args.expectedRevision) throw new ConvexError('The order changed since you opened it. Review it and try again.');
		const reason = cleanReason(args.reason, 'Reason', false);
		const lines = await orderLines(ctx, order._id);
		if (!lines.length) throw new ConvexError('This order has no items, so it isn’t listed and there is nothing to discard.');
		if (await ctx.db.query('billPayments').withIndex('by_billId', (q) => q.eq('billId', order._id)).first()) {
			throw new ConvexError('This order has payments recorded, so it can’t be discarded.');
		}
		const now = Date.now();
		await ctx.db.patch(order._id, {
			status: 'discarded', discardedAt: now, discardedBy: admin.email, discardReason: reason, lifecycleKey: key,
			revision: order.revision + 1, updatedAt: now
		});
		await logOrder(ctx, order._id, admin.email, 'discarded', {
			reason,
			before: {
				status: order.status, revision: order.revision, bookingId: order.bookingId, appointmentId: order.appointmentId, customerId: order.customerId,
				itemCount: order.itemCount, total: order.total, due: order.due, lines: lines.map(lineSnapshot)
			},
			after: { status: 'discarded' }
		});
		return { replayed: false };
	}
});

/** What restoring a discarded order would meet (see restoreConflicts). Read-only. */
export const restoreCheck = query({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
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

/**
 * Makes a discarded order an unpaid order again, with its rows, links and customer as they were.
 * Nothing is re-priced: a row whose stay or appointment changed meanwhile comes back flagged and
 * must be updated before payment (the source's new terms are never overwritten). If a row's stay,
 * appointment or fee is now on another open order, the restore refuses and lists them, unless
 * `removeConflictingRows` is true, which restores without those rows (each removal is logged with
 * the row). It refuses when no row would be left. Returns the rows taken off and the warnings.
 */
export const restoreOrder = mutation({
	args: { ...lifecycleArgs, removeConflictingRows: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const key = attemptKey(args.idempotencyKey);
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status !== 'discarded') {
			if (isOpenOrder(order) && order.lifecycleKey === key) return { replayed: true, removed: [], warnings: [] };
			throw new ConvexError(isOpenOrder(order) ? 'This order is not discarded.' : order.status === 'paid' ? 'This order is already paid' : 'This order was voided');
		}
		if (order.revision !== args.expectedRevision) throw new ConvexError('The order changed since you opened it. Review it and try again.');
		const lines = await orderLines(ctx, order._id);
		const conflicts = await restoreConflicts(ctx, order, lines);
		const blocking = conflicts.filter((conflict) => conflict.blocking);
		if (blocking.length && !args.removeConflictingRows) {
			throw new ConvexError(`Not restored: ${blocking.map((conflict) => conflict.message).join(' ')} Restore without ${blocking.length === 1 ? 'that row' : 'those rows'}, or leave the order discarded.`);
		}
		if (blocking.length >= lines.length) throw new ConvexError('Not restored: every item on this order is now on another order.');

		const removed = [];
		for (const conflict of blocking) {
			const line = lines.find((row) => row._id === conflict.lineId)!;
			await ctx.db.delete(line._id);
			await logOrder(ctx, order._id, admin.email, 'line_removed', { reason: `Taken off when restoring: ${conflict.message}`, before: lineSnapshot(line) });
			removed.push({ lineId: line._id, name: line.name, reason: conflict.message });
		}
		const before = discardedInfo(order);
		await ctx.db.patch(order._id, { status: 'draft', discardedAt: undefined, discardedBy: undefined, discardReason: undefined, lifecycleKey: key });
		// Totals follow the rows that came back; the revision moves, so a payment reviewed earlier is refused.
		await refreshOrder(ctx, order._id);
		const warnings = conflicts.filter((conflict) => !conflict.blocking);
		await logOrder(ctx, order._id, admin.email, 'restored', {
			before: { status: 'discarded', discardedAt: before.at, discardedBy: before.by, discardReason: before.reason },
			after: { status: 'draft', removed: removed.map(({ lineId, name }) => ({ lineId, name })), warnings: warnings.map(({ kind, name, message }) => ({ kind, name, message })) }
		});
		return { replayed: false, removed, warnings };
	}
});

// ---------------------------------------------------------------------------------------------
// No-show and late-cancellation fees
// ---------------------------------------------------------------------------------------------

/**
 * Adds a no-show fee (appointment marked no-show) or a late-cancellation fee (appointment
 * cancelled) to an order (a new order if none is given). The row is an `extra` named for the
 * fee and the service ("No-show fee · Thai massage"), with the appointment's time and reference
 * and "service not given" on its second line, so the receipt never reads as the service itself.
 *
 * The appointment is referred to, not charged: its status stays no-show or cancelled and its
 * payment stays unpaid. One fee per appointment counts at a time: refused while another is on an
 * open order or was paid (plain void still retains money). The amount must be more than zero,
 * whole satang and at most the appointment's price. The fee keeps its amount (no discount, price
 * change or quantity); remove it and add it again to change it. Settlement refuses the fee if the
 * appointment's status was corrected, it was paid, or another fee was charged meanwhile.
 * Repeating the same fee on the same order returns that row (`replayed: true`).
 */
export const addAppointmentFee = mutation({
	args: {
		expectedRevision: v.optional(v.number()),
		idempotencyKey: v.optional(v.string()),
		orderId: v.optional(v.id('bills')),
		appointmentId: v.id('serviceAppointments'),
		kind: v.union(v.literal('no_show'), v.literal('late_cancellation')),
		amount: v.number(),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		if ((args.expectedRevision === undefined) !== (args.idempotencyKey === undefined)) throw new ConvexError('Review the appointment and retry with its revision and attempt key.');
		const key = args.idempotencyKey === undefined ? undefined : attemptKey(args.idempotencyKey);
		const fingerprint = JSON.stringify([args.orderId, args.appointmentId, args.kind, args.amount, args.reason]);
		if (key) {
			const prior = await ctx.db.query('appointmentFeeAttempts').withIndex('by_key', q => q.eq('key', key)).unique();
			if (prior) {
				if (prior.actor !== admin.email || prior.fingerprint !== fingerprint) throw new ConvexError('Fee attempt was already used with different details.');
				return { orderId: prior.orderId, lineId: prior.lineId, replayed: true };
			}
		}
		const kind: FeeKind = args.kind;
		const appointment = await ctx.db.get(args.appointmentId);
		if (args.expectedRevision !== undefined && (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== (appointment?.revision ?? 0))) throw new ConvexError('This appointment changed. Review it before adding a fee.');
		const blocked = feeBlocker(appointment, kind);
		if (blocked || !appointment) throw new ConvexError(blocked ?? 'Appointment not found');
		assertPrice(args.amount);
		assertFeeAmount(args.amount, appointment);
		const reason = cleanReason(args.reason, 'Note', false);
		const others = await liveFees(ctx, appointment._id);
		const same = others.find((fee) => fee.order._id === args.orderId && isOpenOrder(fee.order) && fee.line.fee?.kind === kind && fee.line.unitPrice === args.amount);
		if (same) {
			if (key) await ctx.db.insert('appointmentFeeAttempts', { key, actor: admin.email, fingerprint, orderId: same.order._id, lineId: same.line._id });
			return { orderId: same.order._id, lineId: same.line._id, replayed: true };
		}
		const taken = otherFeeMessage(others[0]);
		if (taken) throw new ConvexError(taken);

		const order = await editableOrder(ctx, args.orderId, admin.email);
		await assertRoom(ctx, order._id);
		const serviceName = appointment.serviceNameSnapshot ?? (await ctx.db.get(appointment.serviceId))?.name ?? 'Appointment';
		const { date, time } = resortLocalParts(appointment.start);
		const now = Date.now();
		const line: LineFields = {
			kind: 'extra',
			name: `${FEE_LABEL[kind]} · ${serviceName}`,
			detail: `${date} ${time} · ${appointment.confirmationCode} · ${kind === 'no_show' ? 'no-show' : 'cancelled late'}, service not given`,
			unitPrice: args.amount,
			currency: CURRENCY,
			qty: 1,
			fee: { kind, ...(reason ? { reason } : {}), by: admin.email, at: now },
			feeAppointmentId: appointment._id
		};
		const lineId = await ctx.db.insert('billLines', { billId: order._id, ...line, createdAt: now });
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'fee_added', { reason, after: { ...lineSnapshot(line), lineId } });
		await appendRecordHistory(ctx, {
			entityType: 'appointment', entityId: appointment._id, actor: admin.email, kind: 'fee_added',
			...(reason ? { reason } : {}),
			after: { feeKind: kind, amount: args.amount, currency: CURRENCY, billId: order._id, appointmentStatus: appointment.status, paymentStatus: appointment.paymentStatus }
		});
		if (key) await ctx.db.insert('appointmentFeeAttempts', { key, actor: admin.email, fingerprint, orderId: order._id, lineId });
		return { orderId: order._id, lineId, replayed: false };
	}
});

/** Fee rows for an appointment (any order state), newest first, for its detail sheet. */
export const appointmentFees = query({
	args: { appointmentId: v.id('serviceAppointments') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const rows = await ctx.db.query('billLines').withIndex('by_feeAppointmentId', (q) => q.eq('feeAppointmentId', args.appointmentId)).order('desc').take(20);
		const fees = [];
		for (const line of rows) {
			const order = await ctx.db.get(line.billId);
			if (!order || !line.fee) continue;
			fees.push({
				lineId: line._id, kind: line.fee.kind, amount: lineNet(line), currency: line.currency, reason: line.fee.reason ?? null, by: line.fee.by, at: line.fee.at,
				order: { _id: order._id, title: orderTitle(order.orderNumber), state: orderState(order), receiptNumber: order.receiptNumber ?? null }
			});
		}
		return fees;
	}
});

// ---------------------------------------------------------------------------------------------
// Linking a paid row to its appointment or stay later
// ---------------------------------------------------------------------------------------------

/** Which source a paid row can be applied to: a service row to an appointment of that service, a room row to a stay in that villa. */
const LINK_TARGET: Partial<Record<Line['kind'], 'appointment' | 'booking'>> = { service: 'appointment', room: 'booking' };

/** The paid row to link, or why it can't be. */
function linkableRow(order: Order, line: Line | null) {
	if (!line || line.billId !== order._id) throw new ConvexError('Item not found on this order');
	const target = LINK_TARGET[line.kind];
	if (!target || line.fee) throw new ConvexError('Only a paid service or room row can be linked to an appointment or stay');
	const amount = lineNet(line);
	if (amount <= 0) throw new ConvexError('Nothing was charged for this row, so there is no payment to apply');
	return { target, amount };
}

/** Why this appointment can't take this paid service row, or null. Nothing is written. */
async function appointmentLinkProblem(ctx: ReadCtx, line: Line, appointment: Doc<'serviceAppointments'>) {
	if (!appointmentAttachable(appointment)) return 'This appointment is already paid, cancelled or a no-show.';
	if (appointment.serviceId !== line.serviceId) return 'This is a different service. Only an appointment for the same service can take this payment.';
	if (appointment.currency !== CURRENCY) return `This appointment is priced in ${appointment.currency}.`;
	if (await activeSourceLink(ctx, { appointmentId: appointment._id })) return 'This appointment is already linked to another paid row.';
	const open = await openOrderCharging(ctx, { appointmentId: appointment._id });
	if (open) return `This appointment is on ${orderTitle(open.orderNumber)}, which is still open. Take the payment there, or remove it from that order first.`;
	return null;
}

/** Why this stay can't take this paid room row, or null. Nothing is written. */
async function bookingLinkProblem(ctx: ReadCtx, order: Order, line: Line, booking: Doc<'bookings'>, amount: number) {
	const closed = bookingClosedReason(booking);
	if (closed) return `${closed}.`;
	const online = bookingCheckoutBlock(booking);
	if (online) return online;
	if (booking.propertyId !== line.propertyId) return 'This stay is in a different villa. Only a stay in the same villa can take this payment.';
	if (booking.currency !== CURRENCY) return `This stay is priced in ${booking.currency}.`;
	if (await activeSourceLink(ctx, { bookingId: booking._id })) return 'This stay is already linked to another paid row.';
	const open = await openOrderCharging(ctx, { bookingId: booking._id });
	if (open) return `This stay is on ${orderTitle(open.orderNumber)}, which is still open. Take the payment there, or remove it from that order first.`;
	if ((await sourceRows(ctx, order._id)).some((row) => row.bookingId === booking._id)) return 'This order already paid for this stay at checkout.';
	const { owed } = bookingBalance(booking);
	if (owed <= 0) return 'Nothing is left to pay on this stay.';
	if (amount > owed) return `This stay owes ${owed.toLocaleString('en-US')} ${booking.currency}, less than this row's ${amount.toLocaleString('en-US')}. Correct the stay's price first, or link a smaller charge.`;
	if (amount < owed && booking.paymentStatus !== 'pending' && booking.paymentStatus !== 'paid') return 'This stay can only be paid in full here. Reopen it first.';
	return null;
}

/**
 * Appointments (for a service row) or stays (for a room row) a paid row can be linked to, found as
 * Add booking finds them (the order's customer, its own booking, `query`), each with the reason it
 * can't take this row, or null. Read-only; linkPaidLine checks everything again.
 */
export const linkCandidates = query({
	args: { orderId: v.id('bills'), lineId: v.id('billLines'), query: v.optional(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const order = await ctx.db.get(args.orderId);
		const line = await ctx.db.get(args.lineId);
		if (!order || order.status !== 'paid' || !line || line.billId !== order._id || !LINK_TARGET[line.kind] || line.fee) return null;
		const amount = lineNet(line);
		const { bookings, appointments } = await findSources(ctx, { orderId: order._id, query: args.query });
		const rows: Array<{
			kind: 'appointment' | 'booking'; id: string; name: string; detail: string; guestName: string; price: number; owed: number;
			currency: string; date: string | null; revision: number; problem: string | null;
		}> = [];
		if (LINK_TARGET[line.kind] === 'appointment') {
			for (const appointment of appointments.values()) {
				if (appointment.paymentStatus === 'refunded') continue;
				const service = await ctx.db.get(appointment.serviceId);
				const { date, time } = resortLocalParts(appointment.start);
				rows.push({
					kind: 'appointment', id: appointment._id, name: service?.name ?? 'Appointment', detail: `${date} ${time} · ${appointment.confirmationCode}`,
					guestName: appointment.guestName, price: appointment.price, owed: appointmentMoney(appointment).owed, currency: appointment.currency,
					date, revision: appointment.revision ?? 0, problem: await appointmentLinkProblem(ctx, line, appointment)
				});
			}
		} else {
			for (const booking of bookings.values()) {
				if (bookingClosed(booking)) continue;
				const property = await ctx.db.get(booking.propertyId);
				rows.push({
					kind: 'booking', id: booking._id, name: `Stay · ${property?.name ?? 'Villa'}`,
					detail: `${booking.checkIn} → ${booking.checkOut}${booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}`,
					guestName: booking.guestName, price: bookingChargeTotal(booking), owed: Math.max(bookingBalance(booking).owed, 0), currency: booking.currency,
					date: booking.checkIn, revision: bookingRevision(booking), problem: await bookingLinkProblem(ctx, order, line, booking, amount)
				});
			}
		}
		// Linkable ones first; the rest show why not.
		return rows.sort((a, b) => Number(a.problem !== null) - Number(b.problem !== null)).slice(0, ATTACH_SCAN);
	}
});

/**
 * Applies a paid service row to its appointment, or a paid room row to its stay, after payment.
 * No money moves and the issued receipt, its rows, tenders, total and issue date never change: the
 * link is a billLineLinks row and a numbered `linked` correction. The target is recorded as paid by
 * this order exactly as checkout would have done: the appointment becomes paid at what the row was
 * charged (its price before is kept for an unlink); the stay gets a `pos` payment row for the
 * row's amount with this order's `billId` (part of what it owes is allowed, more is refused). The
 * money's date is the order's payment date.
 *
 * Refused, with nothing written, unless the order is paid, the row is a service (or room) row with
 * no active link, and the appointment (stay) is for the same service (villa), still owes it, has no
 * active link, is on no open order and is still at `expectedTargetRevision`. `expectedCorrectionRevision`
 * is the order's correction revision staff reviewed. Retrying `idempotencyKey` returns the first result.
 */
export const linkPaidLine = mutation({
	args: {
		...correctionArgs,
		lineId: v.id('billLines'),
		appointmentId: v.optional(v.id('serviceAppointments')),
		bookingId: v.optional(v.id('bookings')),
		expectedTargetRevision: v.number(),
		notifyGuest: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const source = oneSource(args);
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'linked');
		if (existing) {
			const same = existing.lineId === args.lineId && ('bookingId' in source ? existing.bookingId === source.bookingId : existing.appointmentId === source.appointmentId);
			if (!same) throw new ConvexError('This link attempt was already used for something else. Start again.');
			return { sequence: existing.sequence, linkId: existing.linkId!, replayed: true };
		}
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order’s rows can be linked.');
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason for the link')!;
		const line = await ctx.db.get(args.lineId);
		const { target, amount } = linkableRow(order, line);
		if (await activeLineLink(ctx, line!._id)) throw new ConvexError('This row is already linked. Unlink it first.');
		const now = Date.now();
		const effectiveAt = order.paymentEffectiveAt ?? order.paidAt ?? now;
		const sequence = (order.correctionRevision ?? 0) + 1;
		const title = orderTitle(order.orderNumber);
		const note = `Paid on ${title}${order.receiptNumber !== undefined ? ` (receipt ${formatReceiptNumber(order.receiptNumber)})` : ''}, linked later: ${reason}`;
		let link: Omit<Doc<'billLineLinks'>, '_id' | '_creationTime'>;
		const base = {
			billId: order._id, lineId: line!._id, amount, currency: line!.currency, status: 'active' as const, effectiveAt,
			reason, linkedAt: now, linkedBy: admin.email, sequence
		};
		if ('appointmentId' in source) {
			if (target !== 'appointment') throw new ConvexError('A room row is linked to a stay, not an appointment.');
			const appointment = await ctx.db.get(source.appointmentId);
			if (!appointment) throw new ConvexError('Appointment not found');
			if ((appointment.revision ?? 0) !== args.expectedTargetRevision) throw new ConvexError(STALE_APPOINTMENT);
			const problem = await appointmentLinkProblem(ctx, line!, appointment);
			if (problem) throw new ConvexError(problem);
			// The same fields settleOrder writes when the appointment is paid at checkout.
			await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid', price: amount, amountPaid: amount, amountRefunded: 0, paidAt: effectiveAt, paidBy: admin.email },
				{ actor: admin.email, kind: 'payment', reason: note, effectiveAt });
			link = { ...base, kind: 'appointment', appointmentId: appointment._id, appointmentPriceBefore: appointment.price };
		} else {
			if (target !== 'booking') throw new ConvexError('A service row is linked to an appointment, not a stay.');
			const booking = await ctx.db.get(source.bookingId);
			if (!booking) throw new ConvexError('Booking not found');
			if (bookingRevision(booking) !== args.expectedTargetRevision) throw new ConvexError(STALE_BOOKING);
			const problem = await bookingLinkProblem(ctx, order, line!, booking, amount);
			if (problem) throw new ConvexError(problem);
			const { paymentId } = await recordStayPayment(ctx, booking._id, {
				origin: 'pos', method: 'order', actor: admin.email, legacyMethod: 'pos', effectiveAt, billId: order._id, amount, note, notifyGuest: args.notifyGuest
			});
			if (!paymentId) throw new ConvexError('Nothing is left to pay on this stay.');
			link = {
				...base, kind: 'booking', bookingId: booking._id, bookingPaymentId: paymentId, bookingPaymentStatusBefore: booking.paymentStatus,
				...(booking.paidAt !== undefined ? { bookingPaidAtBefore: booking.paidAt } : {})
			};
		}
		const linkId = await ctx.db.insert('billLineLinks', link);
		await ctx.db.insert('billCorrections', {
			billId: order._id, sequence, kind: 'linked', reason, actor: admin.email, recordedAt: now, idempotencyKey: key,
			lineId: line!._id, linkId, amount, ...('appointmentId' in source ? { appointmentId: source.appointmentId } : { bookingId: source.bookingId })
		});
		await ctx.db.patch(order._id, { correctionRevision: sequence });
		return { sequence, linkId, replayed: false };
	}
});

/**
 * Proves an active link can be undone exactly, writing nothing, and returns the reversal to run:
 * the appointment goes back to unpaid at its price before the link; the stay's payment from the
 * link is cancelled and its payment status restored. Refused if any of that money was refunded or
 * the target changed since (repaid, repriced, refunded, or under an online checkout).
 */
async function linkReversal(ctx: MutationCtx, link: Doc<'billLineLinks'>, name: string) {
	if (link.appointmentId) {
		const appointment = await ctx.db.get(link.appointmentId);
		if (!appointment) throw new ConvexError(`${name}: the appointment was deleted, so its payment can't be reversed.`);
		if (appointmentMoney(appointment).refunded > 0 || await ctx.db.query('appointmentRefunds').withIndex('by_appointmentId_and_recordedAt', q => q.eq('appointmentId', appointment._id)).first())
			throw new ConvexError(`${name}: part of the appointment's payment was refunded, so it can't be unlinked.`);
		if (appointment.paymentStatus !== 'paid' || appointment.price !== link.amount || (appointment.amountPaid ?? appointment.price) !== link.amount)
			throw new ConvexError(`${name}: the appointment changed since it was linked (repaid or repriced), so it can't be unlinked automatically.`);
		return async (actor: string, reason: string) => {
			await recordAppointmentChange(ctx, appointment, { paymentStatus: 'unpaid', price: link.appointmentPriceBefore ?? appointment.price, amountPaid: 0, amountRefunded: 0, paidAt: undefined, paidBy: undefined },
				{ actor, kind: 'payment', reason });
		};
	}
	const booking = link.bookingId ? await ctx.db.get(link.bookingId) : null;
	if (!booking) throw new ConvexError(`${name}: the stay was deleted, so its payment can't be reversed.`);
	assertNoLiveCheckout(booking);
	const payment = link.bookingPaymentId ? await ctx.db.get(link.bookingPaymentId) : null;
	if (!payment || payment.status !== 'recorded') throw new ConvexError(`${name}: the stay's payment from this link was already reversed.`);
	if (payment.refunded > 0) throw new ConvexError(`${name}: part of what this link paid on the stay was refunded, so it can't be unlinked.`);
	const money = stayMoney(booking);
	const gross = round2(money.gross - payment.amount);
	if (gross < money.refunded) throw new ConvexError(`${name}: refunds on the stay would exceed what is left paid.`);
	const reversal = await stayPaymentReversalPatch(ctx, booking, gross);
	// A stay that was pending before the link (a deposit, say) goes back to pending, not "paid",
	// unless it was paid again since (then it is a paid stay owing this amount again).
	const paidSince = (await ctx.db.query('bookingPayments').withIndex('by_bookingId_and_recordedAt', (q) => q.eq('bookingId', booking._id).gt('recordedAt', payment.recordedAt)).take(MAX_STAY_ROWS))
		.some((row) => row.status === 'recorded');
	const patch = link.bookingPaymentStatusBefore === 'pending' && reversal.paymentStatus === 'paid' && !paidSince
		? { ...reversal, paymentStatus: 'pending' as const, paidAt: link.bookingPaidAtBefore }
		: reversal;
	return async (actor: string, reason: string) => {
		await ctx.db.patch(payment._id, { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: actor, cancelReason: reason });
		await writeBooking(ctx, booking, patch, { actor, kind: 'payment_cancelled', reason, details: { paymentId: payment._id, billId: link.billId, amount: payment.amount, linkId: link._id } });
	};
}

/**
 * Undoes a link (linkPaidLine) with a reason: reverses exactly what it applied (see linkReversal)
 * and keeps the link as `unlinked`, with an `unlinked` correction. The receipt never changes; the
 * row can be linked again. Refused, writing nothing, if the reversal can't be proved.
 */
export const unlinkPaidLine = mutation({
	args: { ...correctionArgs, linkId: v.id('billLineLinks') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { key, existing } = await correctionReplay(ctx, args.orderId, args.idempotencyKey, 'unlinked');
		if (existing) {
			if (existing.linkId !== args.linkId) throw new ConvexError('This unlink attempt was already used for something else. Start again.');
			return { sequence: existing.sequence, replayed: true };
		}
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status !== 'paid') throw new ConvexError('Only a paid order’s links can be undone.');
		assertCorrectionRevision(order, args.expectedCorrectionRevision);
		const reason = cleanReason(args.reason, 'Reason for the unlink')!;
		const link = await ctx.db.get(args.linkId);
		if (!link || link.billId !== order._id) throw new ConvexError('Link not found on this order');
		if (link.status !== 'active') throw new ConvexError('This link was already undone.');
		const line = await ctx.db.get(link.lineId);
		const reverse = await linkReversal(ctx, link, line?.name ?? 'This row');
		const now = Date.now();
		const sequence = (order.correctionRevision ?? 0) + 1;
		await reverse(admin.email, `Unlinked from ${orderTitle(order.orderNumber)}: ${reason}`);
		await ctx.db.patch(link._id, { status: 'unlinked', unlinkedAt: now, unlinkedBy: admin.email, unlinkReason: reason, unlinkSequence: sequence });
		await ctx.db.insert('billCorrections', {
			billId: order._id, sequence, kind: 'unlinked', reason, actor: admin.email, recordedAt: now, idempotencyKey: key,
			lineId: link.lineId, linkId: link._id, amount: link.amount, ...(link.appointmentId ? { appointmentId: link.appointmentId } : { bookingId: link.bookingId })
		});
		await ctx.db.patch(order._id, { correctionRevision: sequence });
		return { sequence, replayed: false };
	}
});
