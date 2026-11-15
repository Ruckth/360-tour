import { staffMutation } from '../../auth/model';
import { linkPaidLineArgs } from '../private/orderModel';
import { executeLinkPaidLine } from '../private/paidLinks';

export const linkPaidLine = staffMutation({
  capability: 'checkout',
 args: linkPaidLineArgs.fields,
 handler: async (ctx, args) => executeLinkPaidLine(ctx, args, ctx.staff),
});
