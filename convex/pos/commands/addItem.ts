import { staffMutation } from '../../auth/model';
import { executeAddItem } from '../private/lineCommands';
import { addItemArgs } from '../private/orderModel';

export const addItem = staffMutation({
  capability: 'checkout',
 args: addItemArgs.fields,
 handler: async (ctx, args) => executeAddItem(ctx, args, ctx.staff),
});
