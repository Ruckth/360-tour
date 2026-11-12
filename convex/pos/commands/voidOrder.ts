import { staffMutation } from '../../auth/model';
import { executeVoidOrder } from '../private/lineCommands';
import { voidOrderArgs } from '../private/orderModel';

export const voidOrder = staffMutation({
  capability: 'checkout',
 args: voidOrderArgs.fields,
 handler: async (ctx, args) => executeVoidOrder(ctx, args, ctx.staff),
});
