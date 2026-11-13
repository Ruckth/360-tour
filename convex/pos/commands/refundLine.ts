import { v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { executeOrderRefund } from '../private/orderRefunds';
import { orderRefundFields } from '../../lib/staffTypes';

/** Record a walk-in line return in satang; money is handed back outside the app. */
export const refundLine = staffMutation({
  capability: 'checkout',
 args: { orderId: v.id('orders'), reason: v.string(), ...orderRefundFields },
 handler: async (ctx, args) => executeOrderRefund(ctx, args, ctx.staff),
});
