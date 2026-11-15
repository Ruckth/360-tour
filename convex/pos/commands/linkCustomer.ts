import { v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { assertCustomerCanLink } from '../private/customerModel';
import { editableOrder } from '../private/orderModel';

/**
 * Links a customer to the order (a new order if none is given). The booking's guest is left as
 * it is: the payer and the guest can be different people. Bumps the revision, so a payment
 * reviewed before the change must be reviewed again.
 */
export const linkCustomer = staffMutation({
  capability: 'checkout',
	args: { orderId: v.optional(v.id('orders')), customerId: v.id('customers') },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		// Refuses missing, archived and merged-away profiles (customers.ts contract); never redirects a merged id.
		const customer = assertCustomerCanLink(await ctx.db.get(args.customerId));
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (order.customerId === customer._id) return { orderId: order._id };
		const now = Date.now();
		await ctx.db.patch(order._id, { customerId: customer._id, revision: order.revision + 1, updatedAt: now });
		await ctx.db.insert('orderAudit', { orderId: order._id, at: now, actor: admin.email, kind: 'customer_linked', customerId: customer._id, note: customer.name });
		return { orderId: order._id };
	}
});
