import { v, ConvexError } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { staffMutation } from '../../auth/model';
import { readStayAppointments, MAX_STAY_APPOINTMENTS } from '../../services/model';
import { paymentGet } from '../private/paymentAttempt';
import { openShopOrder } from '../private/stayPaymentRouting';
import { openOrderCharging } from '../private/orderLinks';
import { openSourceOrder } from '../private/sourceModel';
import { editableOrder, attachTo, appointmentAttachable } from '../private/orderModel';

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
		const opened = await openSourceOrder(ctx, { bookingId }, actor);
		const added: Id<'appointments'>[] = [];
		const skipped: Array<{ appointmentId: Id<'appointments'>; reason: string }> = [];
    if ('roomOrderId' in opened) {
      const route = { roomOrderId: opened.roomOrderId, shopOrderId: opened.shopOrderId };
      let shop = await openShopOrder(ctx, bookingId, route, actor.email, false);
      for (const appointment of appointments) {
        const source = { appointmentId: appointment._id };
        if (await openOrderCharging(ctx, source)) continue;
        if (!appointmentAttachable(appointment)) {
          skipped.push({ ...source, reason: 'This appointment has nothing left to pay' });
          continue;
        }
        shop ??= await openShopOrder(ctx, bookingId, route, actor.email, true);
        if (!shop || shop.activeAttemptId) {
          skipped.push({ ...source, reason: 'Resolve the payment in progress before attaching this visit.' });
          continue;
        }
        const reason = await attachTo(ctx, shop, source, actor, true);
        if (reason) skipped.push({ ...source, reason });
        else added.push(appointment._id);
      }
      const room = opened.orderId === route.roomOrderId ? await paymentGet(ctx, route.roomOrderId) : null;
      return { ...opened, orderId: room?.status === 'draft' ? room._id : shop?._id ?? opened.orderId,
        shopOrderId: shop?._id ?? route.shopOrderId, added, skipped };
    }
    const current = await paymentGet(ctx, opened.orderId);
    if (current?.activeAttemptId) return { orderId: opened.orderId, added, skipped };
    const order = await editableOrder(ctx, opened.orderId, actor);
		for (const appointment of appointments) {
			const reason = await attachTo(ctx, order, { appointmentId: appointment._id }, actor, true);
			if (reason) skipped.push({ appointmentId: appointment._id, reason });
			else added.push(appointment._id);
		}
		return { orderId: opened.orderId, added, skipped };
	}
});
