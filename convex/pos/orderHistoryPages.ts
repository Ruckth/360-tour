import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { Id } from '../_generated/dataModel';
import { type QueryCtx, staffQuery } from '../auth/model';
import { orderRefundView } from '../lib/orderRefunds';
import { canReadCheckoutOrder, requireStaff } from '../lib/staffAccess';

const args = { orderId: v.id('orders'), paginationOpts: paginationOptsValidator };

async function authorize(ctx: QueryCtx, orderId: Id<'orders'>, numItems: number) {
  const actor = await requireStaff(ctx, 'checkout');
  if (actor.role === 'cashier' && !canReadCheckoutOrder(actor, await ctx.db.get(orderId))) throw new ConvexError('Order not found');
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new Error('Page size must be 1–50');
}

/** Independent cursors preserve each ledger's ordering and original documents. */
export const corrections = staffQuery({
  capability: 'checkout', args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  return await ctx.db.query('orderCorrections').withIndex('by_orderId_and_sequence', q => q.eq('orderId', input.orderId)).order('desc').paginate(input.paginationOpts);
} });

export const audit = staffQuery({
  capability: 'checkout', args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  return await ctx.db.query('orderAudit').withIndex('by_orderId_and_at', q => q.eq('orderId', input.orderId)).order('desc').paginate(input.paginationOpts);
} });

export const bookingRefunds = staffQuery({
  capability: 'checkout', args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  const page = await ctx.db.query('bookingRefunds').withIndex('by_orderId', q => q.eq('orderId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(row => ({ sourceType: 'booking' as const, ...row })) };
} });

export const appointmentRefunds = staffQuery({
  capability: 'checkout', args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  const page = await ctx.db.query('appointmentRefunds').withIndex('by_orderId', q => q.eq('orderId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(row => ({ sourceType: 'appointment' as const, ...row })) };
} });

/** POS refund amounts are integer satang; source ledgers above use major currency units. */
export const orderRefunds = staffQuery({
  capability: 'checkout', args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  const page = await ctx.db.query('orderRefunds').withIndex('by_orderId', q => q.eq('orderId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(orderRefundView) };
} });
