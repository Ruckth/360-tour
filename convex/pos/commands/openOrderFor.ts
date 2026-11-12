import { staffMutation } from '../../auth/model';
import { oneSource, sourceArgs } from '../private/orderModel';
import { openSourceOrder } from '../private/sourceModel';

export const openOrderFor = staffMutation({
  capability: 'checkout',
	args: sourceArgs,
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		return await openSourceOrder(ctx, oneSource(args), admin);
	}
});
