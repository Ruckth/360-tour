import { staffMutation } from '../../auth/model';
import { executeOverrideLinePrice } from '../private/lineCommands';
import { overrideLinePriceArgs } from '../private/orderModel';

export const overrideLinePrice = staffMutation({
  capability: 'checkout',
 args: overrideLinePriceArgs.fields,
 handler: async (ctx, args) => executeOverrideLinePrice(ctx, args, ctx.staff),
});
