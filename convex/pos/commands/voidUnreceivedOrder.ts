import { staffMutation } from '../../auth/model';
import { voidUnreceivedOrderArgs } from '../private/orderModel';
import { executeVoidUnreceivedOrder } from '../private/paymentCorrections';

export const voidUnreceivedOrder = staffMutation({
  capability: 'checkout',
 args: voidUnreceivedOrderArgs.fields,
 handler: async (ctx, args) => executeVoidUnreceivedOrder(ctx, args, ctx.staff),
});
