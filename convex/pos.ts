import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { markBookingPaid } from './bookings';
import { customerCard } from './customers';
import { requireAdmin } from './lib/adminAuth';
import { recordAppointmentChange } from './lib/appointmentChanges';
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
	bookingPayable,
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

const MAX_LINES = 100;
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
/** Why a booking or appointment row can't be paid as it stands. `changed` can be updated in place; `settled` and `gone` rows must go. */
export type SourceIssue = { kind: 'changed' | 'settled' | 'gone' | 'online'; message: string };

const ATTACHED_PRICE = 'A stay is charged at its booked price. Change the price on the booking itself, then update the row.';
const ONLINE_CHECKOUT = 'Online checkout is in progress. Wait for it to finish or expire before taking payment at the desk.';

/** Orders are in baht; a price in another currency is refused rather than read as baht. */
function assertBaht(currency: string, what: string) {
	if (currency !== CURRENCY) throw new Error(`${what} is priced in ${currency}. Checkout takes ${CURRENCY} only.`);
}

function oneSource(args: { bookingId?: Id<'bookings'>; appointmentId?: Id<'serviceAppointments'> }): OrderSource {
	if (Boolean(args.bookingId) === Boolean(args.appointmentId)) throw new Error('Choose one booking or appointment');
	return args.bookingId ? { bookingId: args.bookingId } : { appointmentId: args.appointmentId! };
}

async function orderLines(ctx: ReadCtx, orderId: Id<'bills'>) {
	return await ctx.db.query('billLines').withIndex('by_billId', (q) => q.eq('billId', orderId)).take(MAX_LINES);
}

/** The order to change, created on first use. Paid and void orders never change. */
async function editableOrder(ctx: MutationCtx, orderId: Id<'bills'> | undefined, actor: string): Promise<Order> {
	if (!orderId) return await insertOrder(ctx, actor);
	const order = await ctx.db.get(orderId);
	if (!order) throw new Error('Order not found');
	if (order.status === 'paid') throw new Error('This order is already paid');
	if (order.status === 'void') throw new Error('This order was voided');
	// Legacy held orders become ordinary unpaid drafts when touched.
	if (order.status === 'held') {
		await ctx.db.patch(order._id, { status: 'draft' });
		return { ...order, status: 'draft' };
	}
	return order;
}

async function editableLine(ctx: MutationCtx, lineId: Id<'billLines'>, actor: string) {
	const line = await ctx.db.get(lineId);
	if (!line) throw new Error('Item not found');
	const order = await editableOrder(ctx, line.billId, actor);
	return { line, order };
}

/** Keeps the order's item count, total and due in step with its lines, and marks it changed. */
async function refreshOrder(ctx: MutationCtx, orderId: Id<'bills'>) {
	const [order, lines] = await Promise.all([ctx.db.get(orderId), orderLines(ctx, orderId)]);
	const totals = billTotals(lines);
	assertBillSize(totals);
	await ctx.db.patch(orderId, {
		itemCount: lines.reduce((n, line) => n + line.qty, 0),
		total: totals.total,
		due: totals.due,
		hasItems: lines.length > 0,
		revision: order!.revision + 1,
		updatedAt: Date.now()
	});
}

async function assertRoom(ctx: MutationCtx, orderId: Id<'bills'>) {
	if ((await orderLines(ctx, orderId)).length >= MAX_LINES) throw new Error(`An order holds at most ${MAX_LINES} items`);
}

function cleanText(value: string | undefined, label: string, max = 200) {
	const trimmed = value?.trim();
	if (trimmed && trimmed.length > max) throw new Error(`${label} must be at most ${max} characters`);
	return trimmed || undefined;
}

function appointmentAttachable(appointment: Doc<'serviceAppointments'>) {
	return appointment.paymentStatus === 'unpaid' && appointment.status !== 'cancelled' && appointment.status !== 'no_show';
}

function bookingCheckoutBlock(booking: Doc<'bookings'>) {
	return booking.paymentStatus !== 'paid' && (booking.stripeCheckoutExpiresAt ?? 0) > Date.now() ? ONLINE_CHECKOUT : null;
}

function bookingClosed(booking: Doc<'bookings'>) {
	return booking.status === 'cancelled' || booking.paymentStatus === 'refunded' || booking.paymentStatus === 'failed';
}

async function bookingLine(ctx: ReadCtx, booking: Doc<'bookings'>) {
	const property = await ctx.db.get(booking.propertyId);
	const { paid } = bookingBalance(booking);
	return {
		kind: 'booking' as const,
		bookingId: booking._id,
		name: `Stay · ${property?.name ?? 'Villa'}`,
		detail: `${booking.checkIn} → ${booking.checkOut} · ${booking.nights} ${booking.nights === 1 ? 'night' : 'nights'}${booking.confirmationCode ? ` · ${booking.confirmationCode}` : ''}`,
		unitPrice: booking.total,
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
async function sourceIssue(ctx: ReadCtx, line: Line): Promise<SourceIssue | null> {
	if (line.bookingId) {
		const booking = await ctx.db.get(line.bookingId);
		if (!booking) return { kind: 'gone', message: 'This booking no longer exists. Remove it from the order.' };
		if (bookingClosed(booking)) return { kind: 'settled', message: 'This booking was cancelled. Remove it from the order.' };
		if (!bookingPayable(booking)) return { kind: 'settled', message: 'This stay was paid since it was added. Remove it from the order.' };
		const blocked = bookingCheckoutBlock(booking);
		if (blocked) return { kind: 'online', message: blocked };
		const fresh = await bookingLine(ctx, booking);
		if (
			fresh.currency !== line.currency || fresh.name !== line.name || fresh.detail !== line.detail ||
			fresh.unitPrice !== line.unitPrice || (fresh.deposit ?? 0) !== (line.deposit ?? 0)
		) {
			return { kind: 'changed', message: 'The booking changed since it was added (villa, dates, price or deposit). Update the row and review the total.' };
		}
	}
	if (line.appointmentId) {
		const appointment = await ctx.db.get(line.appointmentId);
		if (!appointment) return { kind: 'gone', message: 'This appointment no longer exists. Remove it from the order.' };
		if (!appointmentAttachable(appointment)) return { kind: 'settled', message: 'This appointment was paid or cancelled since it was added. Remove it from the order.' };
		if (
			appointment.currency !== line.currency || appointment.price !== line.unitPrice || appointment.serviceId !== line.serviceId ||
			appointment.staffId !== line.staffId || appointment.start !== line.startAt
		) {
			return { kind: 'changed', message: 'The appointment changed since it was added (service, therapist, time or price). Update the row and review the total.' };
		}
	}
	return null;
}

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
	await ctx.db.patch(order._id, 'bookingId' in link ? { bookingId: link.bookingId } : { appointmentId: link.appointmentId });
}

/** Charges a booking or appointment on the order. Customer and guest details are left alone. */
async function attachTo(ctx: MutationCtx, order: Order, source: OrderSource) {
	await assertRoom(ctx, order._id);
	let line: LineFields;
	let appointment: Doc<'serviceAppointments'> | undefined;
	const other = await openOrderCharging(ctx, source);
	const what = 'bookingId' in source ? 'This booking' : 'This appointment';
	if (other) throw new Error(other._id === order._id ? `${what} is already on this order` : `${what} is already on ${orderTitle(other.orderNumber)}`);
	if ('bookingId' in source) {
		const booking = await ctx.db.get(source.bookingId);
		if (!booking) throw new Error('Booking not found');
		if (!bookingPayable(booking)) throw new Error('This booking has nothing left to pay');
		const blocked = bookingCheckoutBlock(booking);
		if (blocked) throw new Error(blocked);
		assertBaht(booking.currency, 'This booking');
		line = await bookingLine(ctx, booking);
	} else {
		appointment = (await ctx.db.get(source.appointmentId)) ?? undefined;
		if (!appointment) throw new Error('Appointment not found');
		if (!appointmentAttachable(appointment)) throw new Error('This appointment has nothing left to pay');
		assertBaht(appointment.currency, 'This appointment');
		line = await appointmentLine(ctx, appointment);
	}
	await ctx.db.insert('billLines', { billId: order._id, ...line, createdAt: Date.now() });
	await linkFirstSource(ctx, order, source, appointment);
	await refreshOrder(ctx, order._id);
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

async function stayRef(ctx: ReadCtx, bookingId: Id<'bookings'>, linked: boolean): Promise<SourceRef> {
	const booking = await ctx.db.get(bookingId);
	if (!booking) return { kind: 'booking', id: bookingId, reference: 'Deleted booking', guestName: undefined, guestPhone: undefined, guestEmail: undefined, name: 'Stay', linked };
	const property = await ctx.db.get(booking.propertyId);
	return {
		kind: 'booking', id: booking._id, reference: booking.confirmationCode ?? `${booking.checkIn} → ${booking.checkOut}`,
		guestName: booking.guestName, guestPhone: booking.guestPhone || undefined, guestEmail: booking.guestEmail, name: `Stay · ${property?.name ?? 'Villa'}`, linked
	};
}

async function appointmentRef(ctx: ReadCtx, appointmentId: Id<'serviceAppointments'>, linked: boolean, found?: Doc<'serviceAppointments'> | null): Promise<SourceRef> {
	const appointment = found === undefined ? await ctx.db.get(appointmentId) : found;
	if (!appointment) return { kind: 'appointment', id: appointmentId, reference: 'Deleted appointment', guestName: undefined, guestPhone: undefined, guestEmail: undefined, name: 'Appointment', linked };
	const service = await ctx.db.get(appointment.serviceId);
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
async function orderSourceRefs(ctx: ReadCtx, order: Order, lines: Array<Pick<Line, 'bookingId' | 'appointmentId'>>): Promise<SourceRef[]> {
	const refs: SourceRef[] = [];
	const stays = new Set<Id<'bookings'>>();
	const appointments = new Set<Id<'serviceAppointments'>>();
	if (order.bookingId) {
		stays.add(order.bookingId);
		refs.push(await stayRef(ctx, order.bookingId, true));
	} else if (order.appointmentId) {
		appointments.add(order.appointmentId);
		refs.push(await appointmentRef(ctx, order.appointmentId, true));
	}
	for (const { bookingId } of lines) {
		if (!bookingId || stays.has(bookingId)) continue;
		stays.add(bookingId);
		refs.push(await stayRef(ctx, bookingId, false));
	}
	for (const { appointmentId } of lines) {
		if (!appointmentId || appointments.has(appointmentId)) continue;
		appointments.add(appointmentId);
		const appointment = await ctx.db.get(appointmentId);
		if (appointment?.bookingId && stays.has(appointment.bookingId)) continue;
		refs.push(await appointmentRef(ctx, appointmentId, false, appointment));
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

export const catalog = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const [services, properties, staff, recent] = await Promise.all([
			ctx.db.query('services').withIndex('by_status', (q) => q.eq('status', 'active')).take(200),
			ctx.db.query('properties').withIndex('by_status', (q) => q.eq('status', 'active')).take(100),
			ctx.db.query('staff').withIndex('by_status', (q) => q.eq('status', 'active')).take(200),
			ctx.db.query('billLines').order('desc').take(FREQUENT_SCAN)
		]);
		// Most often rung up lately, for the Frequent tab.
		const counts = new Map<string, number>();
		for (const line of recent) {
			const key = line.kind === 'service' ? `service:${line.serviceId}` : line.kind === 'room' ? `room:${line.propertyId}` : line.kind === 'extra' ? `extra:${line.name}` : null;
			if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		// Only baht prices can go on an order (see assertBaht).
		return {
			services: services.filter((s) => s.currency === CURRENCY).map((s) => ({ _id: s._id, name: s.name, category: s.category, description: s.description, durationMin: s.durationMin, price: s.price, currency: s.currency, staffIds: s.staffIds })),
			rooms: properties.filter((p) => p.currency === CURRENCY).map((p) => ({ _id: p._id, name: p.name, tagline: p.tagline, price: p.pricePerNight, currency: p.currency, maxGuests: p.maxGuests })),
			/** No extras catalog exists yet; the Extras tab offers custom items. */
			extras: [] as Array<{ name: string; price: number; category: string }>,
			staff: staff.map((s) => ({ _id: s._id, name: s.name, color: s.color })),
			frequent: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, FREQUENT_COUNT).map(([key]) => key)
		};
	}
});

export const getOrder = query({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const order = await ctx.db.get(args.orderId);
		if (!order) return null;
		const open = isOpenOrder(order);
		const [lines, payments, audit, customer, parent] = await Promise.all([
			orderLines(ctx, order._id),
			ctx.db.query('billPayments').withIndex('by_billId', (q) => q.eq('billId', order._id)).take(10),
			ctx.db.query('billAudit').withIndex('by_billId_and_at', (q) => q.eq('billId', order._id)).order('desc').take(50),
			order.customerId ? ctx.db.get(order.customerId) : null,
			order.parentOrderId ? ctx.db.get(order.parentOrderId) : null
		]);
		const sources = await orderSourceRefs(ctx, order, lines);
		const staffNames = new Map<Id<'staff'>, string>();
		for (const id of new Set(lines.flatMap((line) => (line.staffId ? [line.staffId] : [])))) {
			const person = await ctx.db.get(id);
			if (person) staffNames.set(id, person.name);
		}
		const rows = [];
		for (const line of lines) {
			rows.push({
				...line,
				net: lineNet(line),
				// A paid row keeps the name it was issued with; an open row shows the therapist's current name.
				staffName: line.staffId ? (open ? undefined : line.staffName) ?? staffNames.get(line.staffId) ?? 'Former staff member' : undefined,
				// History is not re-checked: a paid row stays as it was paid.
				sourceIssue: open && (line.bookingId || line.appointmentId) ? await sourceIssue(ctx, line) : null
			});
		}
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
			payments,
			audit,
			totals: billTotals(lines)
		};
	}
});

/** Orders with items, newest change first, for the Orders list: unpaid, paid or voided. */
export const listOrders = query({
	args: { filter: v.union(v.literal('unpaid'), v.literal('paid'), v.literal('void')), paginationOpts: paginationOptsValidator },
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
				otherBookings: Math.max(sources.length - 1, 0)
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
		if ('bookingId' in source) {
			const booking = await ctx.db.get(source.bookingId);
			if (!booking) return null;
			({ owed, paid } = bookingBalance(booking));
			total = booking.total;
			if (bookingClosed(booking)) owed = 0;
		} else {
			const appointment = await ctx.db.get(source.appointmentId);
			if (!appointment) return null;
			total = appointment.price;
			paid = appointment.paymentStatus === 'paid' ? appointment.price : 0;
			owed = appointmentAttachable(appointment) ? appointment.price : 0;
			// An appointment that is part of a stay continues on the stay's open order.
			if (!active && appointment.bookingId) active = await activeOrderFor(ctx, { bookingId: appointment.bookingId });
		}
		// Empty unpaid orders (such as the one made with the booking, when its stay was charged on
		// another order) are left out, as in the orders list; the active one is returned above.
		const orders = (await ordersForSource(ctx, source, 6)).filter((order) => order.hasItems || !isOpenOrder(order)).slice(0, 5);
		const history = [];
		for (const order of orders) {
			history.push({
				_id: order._id,
				title: orderTitle(order.orderNumber),
				state: orderState(order),
				total: order.total,
				due: await remaining(ctx, order),
				receiptNumber: order.receiptNumber,
				updatedAt: order.updatedAt
			});
		}
		return {
			balance: { total, paid: round2(paid), owed: Math.max(round2(owed), 0) },
			activeOrder: active ? { _id: active._id, title: orderTitle(active.orderNumber), total: active.total, due: await remaining(ctx, active) } : null,
			orders: history
		};
	}
});

/** Unpaid appointments saved before guestPhoneDigits/guestEmailNormalized existed. Empty once backfilled. */
function legacyUnpaidAppointments(ctx: ReadCtx) {
	return ctx.db
		.query('serviceAppointments')
		.withIndex('by_guestPhoneDigits_and_paymentStatus', (q) => q.eq('guestPhoneDigits', undefined).eq('paymentStatus', 'unpaid'));
}

/**
 * Whether Add booking's phone and email search covers every unpaid appointment. False only
 * during the rollout, while more than LEGACY_LOOKUP_SCAN unpaid appointments still wait for
 * migrations:backfillAppointmentGuestLookup; checkout then says to search by reference or name.
 */
export const attachLookupStatus = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const waiting = await legacyUnpaidAppointments(ctx).take(LEGACY_LOOKUP_SCAN + 1);
		return { complete: waiting.length <= LEGACY_LOOKUP_SCAN };
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
		const customer = order?.customerId ? await ctx.db.get(order.customerId) : null;
		const searches: Array<Promise<Doc<'bookings'>[] | Doc<'serviceAppointments'>[]>> = [];
		// Exact contacts to look up: the linked customer's, and a typed phone or email.
		const phones = new Set<string>();
		const emails = new Set<string>();
		if (customer?.phoneDigits && customer.phoneDigits.length >= 4) phones.add(customer.phoneDigits);
		if (customer?.emailNormalized) emails.add(customer.emailNormalized);
		const text = args.query?.trim() ?? '';
		if (text.length >= 2) {
			const digits = text.replace(/\D/g, '');
			const email = text.toLowerCase();
			const code = text.toUpperCase();
			searches.push(
				ctx.db.query('bookings').withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', code)).take(5),
				ctx.db.query('serviceAppointments').withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', code)).take(5),
				ctx.db.query('bookings').withSearchIndex('search_guestName', (q) => q.search('guestName', text)).take(ATTACH_SCAN),
				ctx.db.query('serviceAppointments').withSearchIndex('search_guestName', (q) => q.search('guestName', text)).take(ATTACH_SCAN),
				// Raw phone as typed: also finds stays saved before guestPhoneDigits existed.
				ctx.db.query('bookings').withIndex('by_guestPhone', (q) => q.eq('guestPhone', text)).order('desc').take(ATTACH_SCAN)
			);
			if (digits.length >= 4) phones.add(digits);
			if (email.includes('@')) emails.add(email);
		}
		for (const digits of phones) {
			searches.push(
				ctx.db.query('bookings').withIndex('by_guestPhoneDigits', (q) => q.eq('guestPhoneDigits', digits)).order('desc').take(ATTACH_SCAN),
				// Only unpaid appointments can be added, so the read is limited to those, not to the latest few.
				ctx.db.query('serviceAppointments').withIndex('by_guestPhoneDigits_and_paymentStatus', (q) => q.eq('guestPhoneDigits', digits).eq('paymentStatus', 'unpaid')).take(ATTACH_SCAN)
			);
		}
		for (const email of emails) {
			searches.push(
				ctx.db.query('bookings').withIndex('by_guestEmailNormalized', (q) => q.eq('guestEmailNormalized', email)).order('desc').take(ATTACH_SCAN),
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
				price: booking.total,
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
 * Opening a booking or appointment at checkout (`?booking=` / `?appointment=`). Reuses the open
 * order already charging it or linked to it, so repeated opens and two devices land on the same
 * order. Otherwise creates the booking's order (following its last paid order, if any) and
 * charges what is still owed. An appointment that is part of a stay goes on the stay's order.
 */
export const openOrderFor = mutation({
	args: sourceArgs,
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const source = oneSource(args);
		const charging = await openOrderCharging(ctx, source);
		if (charging) return { orderId: charging._id };

		if ('bookingId' in source) {
			const booking = await ctx.db.get(source.bookingId);
			if (!booking) throw new Error('Booking not found');
			if (bookingClosed(booking)) throw new Error('This booking was cancelled, so there is nothing to charge');
			// The booking's order (usually created with the booking). Opening it charges what the stay
			// still owes, unless another open order already does (checked above).
			const linked = await linkedOpenOrder(ctx, source);
			if (linked) {
				const order = await editableOrder(ctx, linked._id, admin.email);
				if (bookingPayable(booking)) await attachTo(ctx, order, source);
				return { orderId: order._id };
			}
			const order = await insertOrder(ctx, admin.email, { bookingId: booking._id, parentOrderId: (await lastPaidOrder(ctx, source))?._id });
			if (bookingPayable(booking)) await attachTo(ctx, order, source);
			return { orderId: order._id };
		}

		const appointment = await ctx.db.get(source.appointmentId);
		if (!appointment) throw new Error('Appointment not found');
		if (appointment.status === 'cancelled' || appointment.status === 'no_show' || appointment.paymentStatus === 'refunded') {
			throw new Error('This appointment has nothing left to pay');
		}
		const stay: OrderSource | null = appointment.bookingId ? { bookingId: appointment.bookingId } : null;
		let order = stay ? await activeOrderFor(ctx, stay) : await linkedOpenOrder(ctx, source);
		if (!order) {
			const parentOrderId = (await lastPaidOrder(ctx, stay ?? source))?._id;
			order = await insertOrder(ctx, admin.email, stay ? { bookingId: appointment.bookingId, parentOrderId } : { appointmentId: appointment._id, parentOrderId });
		} else {
			order = await editableOrder(ctx, order._id, admin.email);
		}
		if (appointmentAttachable(appointment)) await attachTo(ctx, order, source);
		return { orderId: order._id };
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
			if (!service || service.status !== 'active') throw new Error('This service is no longer offered');
			assertBaht(service.currency, service.name);
			line = { kind: 'service', serviceId: service._id, name: service.name, detail: `${service.durationMin} min`, unitPrice: service.price, currency: CURRENCY, qty: 1 };
		} else if (item.kind === 'room') {
			const property = await ctx.db.get(item.propertyId);
			if (!property || property.status !== 'active') throw new Error('This villa is not available');
			assertBaht(property.currency, property.name);
			line = { kind: 'room', propertyId: property._id, name: property.name, detail: 'per night', unitPrice: property.pricePerNight, currency: CURRENCY, qty: 1 };
		} else {
			const name = cleanText(item.name, 'Item name', 80);
			if (!name) throw new Error('Name the item');
			assertPrice(item.price);
			line = { kind: 'extra', name, unitPrice: round2(item.price), currency: CURRENCY, qty: 1 };
		}

		// Nights and extras stack into one row unless that row has its own price or discount.
		if (MERGES_QTY[line.kind]) {
			const same = (await orderLines(ctx, order._id)).find((l) =>
				l.kind === line.kind && !l.priceOverride && !l.discount && l.unitPrice === line.unitPrice &&
				(line.kind === 'room' ? l.propertyId === line.propertyId : l.name === line.name)
			);
			if (same && same.qty < MAX_QTY) {
				await ctx.db.patch(same._id, { qty: same.qty + 1 });
				await refreshOrder(ctx, order._id);
				return { orderId: order._id, lineId: same._id };
			}
		}
		await assertRoom(ctx, order._id);
		const lineId = await ctx.db.insert('billLines', { billId: order._id, ...line, createdAt: Date.now() });
		await refreshOrder(ctx, order._id);
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
		await attachTo(ctx, order, source);
		return { orderId: order._id };
	}
});

/**
 * Therapist (null = any), start time (null = now), quantity and discount (null = none) for one row.
 * The quantity moves by `qtyChange` (kept within 1–99), so quick taps on two devices add up.
 */
export const updateLine = mutation({
	args: {
		lineId: v.id('billLines'),
		staffId: v.optional(v.union(v.id('staff'), v.null())),
		startAt: v.optional(v.union(v.number(), v.null())),
		qtyChange: v.optional(v.number()),
		discount: v.optional(v.union(discountValidator, v.null()))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		const patch: Partial<Line> = {};
		if (args.staffId !== undefined) {
			if (line.kind !== 'service') throw new Error('Only service rows take a therapist here');
			if (args.staffId) {
				const service = line.serviceId ? await ctx.db.get(line.serviceId) : null;
				const person = await ctx.db.get(args.staffId);
				if (!person || person.status !== 'active') throw new Error('Staff member not found');
				if (!service?.staffIds.includes(args.staffId)) throw new Error(`${person.name} doesn't offer this service`);
			}
			patch.staffId = args.staffId ?? undefined;
		}
		if (args.startAt !== undefined) {
			if (line.kind !== 'service') throw new Error('Only service rows take a start time here');
			if (args.startAt !== null && !Number.isSafeInteger(args.startAt)) throw new Error('Invalid start time');
			patch.startAt = args.startAt ?? undefined;
		}
		if (args.qtyChange !== undefined) {
			if (!MERGES_QTY[line.kind]) throw new Error('Add another row instead: each service is its own row');
			if (!Number.isInteger(args.qtyChange) || Math.abs(args.qtyChange) > MAX_QTY) throw new Error('Invalid quantity change');
			patch.qty = Math.min(Math.max(line.qty + args.qtyChange, 1), MAX_QTY);
		}
		if (args.discount !== undefined) {
			if (line.kind === 'booking' && args.discount) throw new Error(ATTACHED_PRICE);
			if (args.discount) assertDiscount(args.discount);
			patch.discount = args.discount && args.discount.value > 0 ? args.discount : undefined;
		}
		await ctx.db.patch(line._id, patch);
		await refreshOrder(ctx, order._id);
	}
});

/** One-off price for a row. Setting a price needs a note; every change is kept in billAudit. */
export const overrideLinePrice = mutation({
	args: { lineId: v.id('billLines'), price: v.union(v.number(), v.null()), note: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const { line, order } = await editableLine(ctx, args.lineId, admin.email);
		if (line.kind === 'booking' && args.price !== null) throw new Error(ATTACHED_PRICE);
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
		if (!line.bookingId && !line.appointmentId) throw new Error('Only booking and appointment rows follow their source');
		const issue = await sourceIssue(ctx, line);
		if (!issue) return { result: 'current' as const };
		if (issue.kind === 'online') throw new Error(issue.message);
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
		const customer = await ctx.db.get(args.customerId);
		if (!customer) throw new Error('Customer not found');
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
		if (!order.hasItems) throw new Error('Add an item before saving the order');
		await ctx.db.patch(order._id, { updatedAt: Date.now() });
	}
});

/** Removes every row. The order, its number, links and audit trail stay. */
export const clearOrder = mutation({
	args: { orderId: v.id('bills') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const order = await editableOrder(ctx, args.orderId, admin.email);
		for (const line of await orderLines(ctx, order._id)) await ctx.db.delete(line._id);
		await ctx.db.insert('billAudit', { billId: order._id, at: Date.now(), actor: admin.email, kind: 'cleared' });
		await refreshOrder(ctx, order._id);
	}
});

/**
 * Pays the order. `idempotencyKey` identifies one payment attempt: retrying it after a dropped
 * connection returns the first result instead of charging twice. `expectedDue` and
 * `expectedRevision` are what staff reviewed; if the order changed since (items, prices or its
 * customer), nothing is written.
 */
export const settleOrder = mutation({
	args: { orderId: v.id('bills'), idempotencyKey: v.string(), expectedDue: v.number(), expectedRevision: v.number(), tenders: v.array(tenderValidator) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const key = args.idempotencyKey.trim();
		if (key.length < 8 || key.length > 100) throw new Error('Invalid payment attempt');
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error('Order not found');
		if (!isOpenOrder(order)) {
			if (order.settleKey === key && order.receiptNumber !== undefined) return { receiptNumber: order.receiptNumber, replayed: true };
			throw new Error(order.status === 'void' ? 'This order was voided' : 'This order is already paid');
		}
		const lines = await orderLines(ctx, order._id);
		if (!lines.length) throw new Error('Add an item first');
		const totals = billTotals(lines);
		if (totals.due !== round2(args.expectedDue) || order.revision !== args.expectedRevision) throw new Error('The order changed. Check the total and pay again.');
		assertTenders(args.tenders, totals.due);
		const customer = order.customerId ? await ctx.db.get(order.customerId) : null;
		if (order.customerId && !customer) throw new Error('The linked customer no longer exists. Link another customer or remove the link.');

		const now = Date.now();
		for (const line of lines) {
			if (!line.bookingId && !line.appointmentId) continue;
			const issue = await sourceIssue(ctx, line);
			if (issue) throw new Error(issue.kind === 'changed' ? `${line.name} changed since it was added. Update the row and review the total.` : `${line.name}: ${issue.message}`);
			if (line.bookingId) {
				// Charged at the booked price, so the booking's total is what it has now been paid.
				if (line.discount || line.priceOverride) throw new Error(ATTACHED_PRICE);
				const booking = (await ctx.db.get(line.bookingId))!;
				await markBookingPaid(ctx, booking._id, 'pos');
				await ctx.db.patch(booking._id, { amountPaid: booking.total });
			}
			if (line.appointmentId) {
				const appointment = (await ctx.db.get(line.appointmentId))!;
				// The appointment keeps what was charged for it, after any discount or price change here.
				await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid', price: lineNet(line) }, { actor: admin.email, kind: 'payment', reason: 'Paid at checkout' });
			}
		}
		// The receipt prints each therapist's name as it is now; a later rename doesn't rewrite it.
		for (const line of lines) {
			if (!line.staffId) continue;
			const person = await ctx.db.get(line.staffId);
			await ctx.db.patch(line._id, { staffName: person?.name ?? 'Former staff member' });
		}
		for (const tender of args.tenders) {
			await ctx.db.insert('billPayments', { billId: order._id, ...tender, idempotencyKey: key, createdBy: admin.email, createdAt: now });
		}
		const receiptNumber = await nextCounter(ctx, RECEIPT_COUNTER);
		// The receipt names who it was issued to as they were then; later profile edits don't change it.
		const customerSnapshot = customer
			? { name: customer.name, phone: customer.phone, email: customer.email }
			: order.guestName ? { name: order.guestName, phone: order.guestPhone, email: order.guestEmail } : undefined;
		await ctx.db.patch(order._id, { status: 'paid', receiptNumber, settleKey: key, total: totals.total, due: 0, customerSnapshot, paidAt: now, paidBy: admin.email, updatedAt: now });
		await ctx.db.insert('billAudit', { billId: order._id, at: now, actor: admin.email, kind: 'paid', toPrice: totals.due });
		return { receiptNumber, replayed: false };
	}
});

/**
 * Voids a paid order. The record, its order and receipt numbers, payments and audit trail stay;
 * charged bookings and appointments keep their paid status (record a refund on them if money is
 * returned).
 */
export const voidOrder = mutation({
	args: { orderId: v.id('bills'), reason: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const reason = cleanText(args.reason, 'Reason', NOTE_MAX);
		if (!reason) throw new Error('Give a reason for the void');
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new Error('Order not found');
		if (order.status !== 'paid') throw new Error('Only a paid order can be voided');
		const now = Date.now();
		await ctx.db.patch(order._id, { status: 'void', voidedAt: now, voidedBy: admin.email, voidReason: reason, updatedAt: now });
		await ctx.db.insert('billAudit', { billId: order._id, at: now, actor: admin.email, kind: 'void', note: reason });
	}
});
