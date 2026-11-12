import { staffMutation } from '../../auth/model';
import { unlinkPaidLineArgs } from '../private/orderModel';
import { executeUnlinkPaidLine } from '../private/paidLinks';

export const unlinkPaidLine = staffMutation({
  capability: 'checkout',
 args: unlinkPaidLineArgs.fields,
 handler: async (ctx, args) => executeUnlinkPaidLine(ctx, args, ctx.staff),
});
