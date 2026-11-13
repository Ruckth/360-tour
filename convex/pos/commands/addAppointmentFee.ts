import { ConvexError, v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { attemptKey, cleanReason } from '../../shared/bookingMoney';
import { FEE_LABEL, assertFeeAmount, feeBlocker, liveFees, otherFeeMessage, type FeeKind } from '../private/orderLifecycle';
import { isOpenOrder } from '../private/orderLinks';
import { assertPrice } from '../../shared/orderMath';
import { appendRecordHistory } from '../../settings/model';
import { resortLocalParts } from '../../shared/time';
import { CURRENCY, LineFields, assertRoom, editableOrder, lineSnapshot, logOrder, refreshOrder } from '../private/orderModel';

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
export const addAppointmentFee = adminMutation({
	args: {
		expectedRevision: v.optional(v.number()),
		idempotencyKey: v.optional(v.string()),
		orderId: v.optional(v.id('orders')),
		appointmentId: v.id('appointments'),
		kind: v.union(v.literal('no_show'), v.literal('late_cancellation')),
		amount: v.number(),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
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
		const lineId = await ctx.db.insert('orderLines', { orderId: order._id, ...line, catalogUnitPrice: line.catalogUnitPrice ?? line.unitPrice, createdAt: now });
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'fee_added', { reason, after: { ...lineSnapshot(line), lineId } });
		await appendRecordHistory(ctx, {
			entityType: 'appointment', entityId: appointment._id, actor: admin.email, kind: 'fee_added',
			...(reason ? { reason } : {}),
			after: { feeKind: kind, amount: args.amount, currency: CURRENCY, orderId: order._id, appointmentStatus: appointment.status, paymentStatus: appointment.paymentStatus }
		});
		if (key) await ctx.db.insert('appointmentFeeAttempts', { key, actor: admin.email, fingerprint, orderId: order._id, lineId });
		return { orderId: order._id, lineId, replayed: false };
	}
});
