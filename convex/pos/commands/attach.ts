import { staffMutation } from '../../auth/model';
import { executeAttach } from '../private/lineCommands';
import { attachArgs } from '../private/orderModel';

export const attach = staffMutation({
  capability: 'checkout', args: attachArgs.fields, handler: async (ctx, args) => executeAttach(ctx, args, ctx.staff) });
