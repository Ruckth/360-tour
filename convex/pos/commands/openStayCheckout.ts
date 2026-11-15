import { v, ConvexError } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { staffMutation } from '../../auth/model';
import { readStayAppointments, MAX_STAY_APPOINTMENTS } from '../../services/model';
import { openSourceOrder } from '../private/sourceModel';
import { editableOrder, attachTo } from '../private/orderModel';

/** Opens the stay and attaches its appointments atomically, using the ordinary checkout guards. */
export const openStayCheckout = staffMutation({
  capability: 'checkout',
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, { bookingId }) => {
		const actor = ctx.staff;
		const appointments = await readStayAppointments(ctx, bookingId);
		if (appointments.length > MAX_STAY_APPOINTMENTS) {
			throw new ConvexError(`This stay has more than ${MAX_STAY_APPOINTMENTS} appointments. Review them in checkout individually.`);
		}
		const { orderId } = await openSourceOrder(ctx, { bookingId }, actor);
		const order = await editableOrder(ctx, orderId, actor.email);
		const added: Id<'appointments'>[] = [];
		const skipped: Array<{ appointmentId: Id<'appointments'>; reason: string }> = [];
		for (const appointment of appointments) {
			const reason = await attachTo(ctx, order, { appointmentId: appointment._id }, actor, true);
			if (reason) skipped.push({ appointmentId: appointment._id, reason });
			else added.push(appointment._id);
		}
		return { orderId, added, skipped };
	}
});

