import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { activeOrderFor, insertOrder, linkedOpenOrder, openOrderCharging, type OrderSource } from '../../lib/orderLinks';
import { type StaffActor } from '../../lib/staffAccess';
import { ATTACH_SCAN, PAYABLE_LOOKUP_SCAN, ReadCtx, appointmentAttachable, attachTo, bookingClosedReason, bookingPayable, editableOrder, lastPaidOrder } from './orderModel';

/** Contacts searched by both the results and their completeness indicator. */
export async function attachContacts(ctx: ReadCtx, args: { orderId?: Id<'orders'>; query?: string }) {
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
export async function payableBookingMatches(query: AsyncIterable<Doc<'bookings'>>) {
	const rows: Doc<'bookings'>[] = [];
	let scanned = 0;
	for await (const booking of query) {
		if (++scanned > PAYABLE_LOOKUP_SCAN) return { rows, complete: false };
		if (bookingPayable(booking)) rows.push(booking);
		if (rows.length >= ATTACH_SCAN) return { rows, complete: true };
	}
	return { rows, complete: true };
}

export async function contactBookings(ctx: ReadCtx, contacts: Awaited<ReturnType<typeof attachContacts>>) {
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

/**
 * Stays and appointments matching an order and a search, as Add booking finds them (see
 * listAttachable): the order's own booking, its customer's contacts and `query`. Unfiltered: callers
 * decide which can be charged or linked.
 */
export async function findSources(ctx: ReadCtx, args: { orderId?: Id<'orders'>; query?: string }) {
	const order = args.orderId ? await ctx.db.get(args.orderId) : null;
	const bookings = new Map<Id<'bookings'>, Doc<'bookings'>>();
	const appointments = new Map<Id<'appointments'>, Doc<'appointments'>>();
	const addBookings = (rows: Doc<'bookings'>[]) => rows.forEach((row) => bookings.set(row._id, row));
	const addAppointments = (rows: Doc<'appointments'>[]) => rows.forEach((row) => appointments.set(row._id, row));

	if (order?.bookingId) {
		const booking = await ctx.db.get(order.bookingId);
		if (booking) addBookings([booking]);
	}
	if (order?.appointmentId) {
		const appointment = await ctx.db.get(order.appointmentId);
		if (appointment) addAppointments([appointment]);
	}
	const searches: Array<Promise<Doc<'bookings'>[] | Doc<'appointments'>[]>> = [];
	const contacts = await attachContacts(ctx, args);
	const { phones, emails, text } = contacts;
	addBookings((await contactBookings(ctx, contacts)).rows);
	if (text.length >= 2) {
		const code = text.toUpperCase();
		searches.push(
			ctx.db.query('bookings').withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', code)).take(5),
			ctx.db.query('appointments').withIndex('by_confirmationCode', (q) => q.eq('confirmationCode', code)).take(5),
			ctx.db.query('bookings').withSearchIndex('search_guestName', (q) => q.search('guestName', text)).take(ATTACH_SCAN),
			ctx.db.query('appointments').withSearchIndex('search_guestName', (q) => q.search('guestName', text)).take(ATTACH_SCAN)
		);
	}
	for (const digits of phones) {
		searches.push(
			// Only unpaid appointments can be added, so the read is limited to those, not to the latest few.
			ctx.db.query('appointments').withIndex('by_guestPhoneDigits_and_paymentStatus', (q) => q.eq('guestPhoneDigits', digits).eq('paymentStatus', 'unpaid')).take(ATTACH_SCAN)
		);
	}
	for (const email of emails) {
		searches.push(
			ctx.db.query('appointments').withIndex('by_guestEmailNormalized_and_paymentStatus', (q) => q.eq('guestEmailNormalized', email).eq('paymentStatus', 'unpaid')).take(ATTACH_SCAN)
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
		addAppointments(await ctx.db.query('appointments').withIndex('by_booking', (q) => q.eq('bookingId', booking._id)).take(ATTACH_SCAN));
	}
	return { bookings, appointments };
}

/**
 * Opening a booking or appointment at checkout (`?booking=` / `?appointment=`). Reuses the open
 * order already charging it or linked to it, so repeated opens and two devices land on the same
 * order. Otherwise creates the booking's order (following its last paid order, if any) and
 * charges what is still owed. An appointment that is part of a stay goes on the stay's order.
 */
export async function openSourceOrder(ctx: MutationCtx, source: OrderSource, actor: StaffActor) {
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
			const order = await editableOrder(ctx, linked._id, actor.email);
			if (bookingPayable(booking)) await attachTo(ctx, order, source, actor);
			return { orderId: order._id };
		}
		const order = await insertOrder(ctx, actor.email, { bookingId: booking._id, parentOrderId: (await lastPaidOrder(ctx, source))?._id });
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
		order = await insertOrder(ctx, actor.email, stay ? { bookingId: appointment.bookingId, parentOrderId } : { appointmentId: appointment._id, parentOrderId });
	} else {
		order = await editableOrder(ctx, order._id, actor.email);
	}
	if (appointmentAttachable(appointment)) await attachTo(ctx, order, source, actor);
	return { orderId: order._id };
}
