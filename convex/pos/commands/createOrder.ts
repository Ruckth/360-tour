import { staffMutation } from '../../auth/model';
import { insertOrder } from '../../lib/orderLinks';

/** Allocate an empty order when the first item needs approval. No charge is created. */
export const createOrder = staffMutation({
  capability: 'checkout', args: {}, handler: async ctx => {
 const actor = ctx.staff;
 const order = await insertOrder(ctx, actor.email);
 return { orderId: order._id };
} });
