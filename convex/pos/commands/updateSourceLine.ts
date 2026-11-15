import { staffMutation } from '../../auth/model';
import { executeUpdateSourceLine } from '../private/lineCommands';
import { updateSourceLineArgs } from '../private/orderModel';

export const updateSourceLine = staffMutation({
  capability: 'checkout',
 args: updateSourceLineArgs.fields,
 handler: async (ctx, args) => executeUpdateSourceLine(ctx, args, ctx.staff),
});
