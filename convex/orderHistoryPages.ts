import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { canReadCheckoutOrder, requireStaff } from './lib/staffAccess';

import { billRefundView } from './lib/billRefunds';

const args = { orderId: v.id('bills'), paginationOpts: paginationOptsValidator };
async function authorize(ctx: QueryCtx, orderId: Id<'bills'>, numItems: number) {
  const actor = await requireStaff(ctx, 'checkout');
  if (actor.role === 'cashier' && !canReadCheckoutOrder(actor, await ctx.db.get(orderId))) throw new ConvexError('Order not found');
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new Error('Page size must be 1–50');
}
/** Independent cursors preserve each ledger's ordering and original documents. */
export const corrections = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  return await ctx.db.query('billCorrections').withIndex('by_billId_and_sequence', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
} });
export const audit = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  return await ctx.db.query('billAudit').withIndex('by_billId_and_at', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
} });
export const bookingRefunds = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  const page = await ctx.db.query('bookingRefunds').withIndex('by_billId', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(row => ({ sourceType: 'booking' as const, ...row })) };
} });
export const appointmentRefunds = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  const page = await ctx.db.query('appointmentRefunds').withIndex('by_billId', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(row => ({ sourceType: 'appointment' as const, ...row })) };
} });

/** POS refund amounts are integer satang; source ledgers above use major currency units. */
export const billRefunds = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.orderId, input.paginationOpts.numItems);
  const page = await ctx.db.query('billRefunds').withIndex('by_orderId', q => q.eq('orderId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(billRefundView) };
} });
