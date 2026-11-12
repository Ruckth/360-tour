import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query, type QueryCtx } from './_generated/server';
import { requireStaff } from './lib/staffAccess';

const args = { orderId: v.id('bills'), paginationOpts: paginationOptsValidator };
async function authorize(ctx: QueryCtx, numItems: number) {
  await requireStaff(ctx, 'checkout');
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50) throw new Error('Page size must be 1–50');
}
/** Independent cursors preserve each ledger's ordering and original documents. */
export const corrections = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.paginationOpts.numItems);
  return await ctx.db.query('billCorrections').withIndex('by_billId_and_sequence', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
} });
export const audit = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.paginationOpts.numItems);
  return await ctx.db.query('billAudit').withIndex('by_billId_and_at', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
} });
export const bookingRefunds = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.paginationOpts.numItems);
  const page = await ctx.db.query('bookingRefunds').withIndex('by_billId', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(row => ({ sourceType: 'booking' as const, ...row })) };
} });
export const appointmentRefunds = query({ args, handler: async (ctx, input) => {
  await authorize(ctx, input.paginationOpts.numItems);
  const page = await ctx.db.query('appointmentRefunds').withIndex('by_billId', q => q.eq('billId', input.orderId)).order('desc').paginate(input.paginationOpts);
  return { ...page, page: page.page.map(row => ({ sourceType: 'appointment' as const, ...row })) };
} });
