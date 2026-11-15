import { staffMutation } from '../../auth/model';
import { executeUpdateLine } from '../private/lineCommands';
import { updateLineArgs } from '../private/orderModel';

export const updateLine = staffMutation({
  capability: 'checkout',
 args: updateLineArgs.fields,
 handler: async (ctx, args) => executeUpdateLine(ctx, args, ctx.staff),
});
