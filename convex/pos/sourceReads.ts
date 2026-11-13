import { ConvexError, v } from 'convex/values';
import { staffQuery } from '../auth/model';
import { appointmentMoney } from '../services/model';
import { bookingRevision } from '../lib/bookingMoney';
import { openOrderCharging, type OrderSource } from './private/orderLinks';
import { bookingBalance, bookingChargeTotal, lineNet, orderTitle } from '../shared/orderMath';
import { resortLocalParts } from '../shared/resortLocalParts';
import { canReadCheckoutOrder, requireCashierAction } from '../auth/model';
import { ATTACH_SCAN, LINK_TARGET, appointmentAttachable, bookingCheckoutBlock, bookingClosed, bookingPayable } from './private/orderModel';
import { appointmentLinkProblem, bookingLinkProblem } from './private/paidLinkModel';
import { attachContacts, contactBookings, findSources } from './private/sourceModel';

/** Whether this contact lookup reached its result limit/exhausted its bounded scans. */
export const attachLookupStatus = staffQuery({
  capability: 'checkout',
	args: { orderId: v.optional(v.id('orders')), query: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const bookings = await contactBookings(ctx, await attachContacts(ctx, args));
		return { complete: bookings.complete, ...(!bookings.complete ? { bookingsIncomplete: true } : {}) };
	}
});

/**
 * Unpaid stays and appointments staff can add to an order: the order's own booking (and its
 * appointments), the linked customer's bookings and appointments by exact phone digits or email,
 * and anything matching `query` (booking or appointment reference, phone digits in any
 * formatting, email in any case, or guest name). Nothing is added automatically.
 */
export const listAttachable = staffQuery({
  capability: 'checkout',
	args: { orderId: v.optional(v.id('orders')), query: v.optional(v.string()) },
	handler: async (ctx, args) => {
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
 * Appointments (for a service row) or stays (for a room row) a paid row can be linked to, found as
 * Add booking finds them (the order's customer, its own booking, `query`), each with the reason it
 * can't take this row, or null. Read-only; linkPaidLine checks everything again.
 */
export const linkCandidates = staffQuery({
  capability: 'checkout',
	args: { orderId: v.id('orders'), lineId: v.id('orderLines'), query: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const actor = ctx.staff;
		await requireCashierAction(ctx, actor, 'paymentFix');
		const order = await ctx.db.get(args.orderId);
		if (actor.role === 'cashier' && !canReadCheckoutOrder(actor, order)) throw new ConvexError('Order not found');
		const line = await ctx.db.get(args.lineId);
		if (!order || order.status !== 'paid' || !line || line.orderId !== order._id || !LINK_TARGET[line.kind] || line.fee) return null;
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
