import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { readRangeWithinBudget } from '../../lib/readBudget';
import { lineNet } from '../../shared/orderMath';
import { serviceReceiptShares } from '../../shared/serviceVat';

export function profitReceiptReader(ctx: QueryCtx) {
  const cache = new Map<Id<'orders'>, Map<Id<'orderLines'>, number>>();
  async function tax(line: Doc<'orderLines'>) {
    let table = cache.get(line.orderId);
    if (!table) {
      const rows = await readRangeWithinBudget(
        ctx,
        ctx.db.query('orderLines').withIndex('by_orderId', (q) => q.eq('orderId', line.orderId)),
      );
      const shares = serviceReceiptShares(rows.map((row) => row.saleSnapshot?.vatBase ?? lineNet(row)));
      table = new Map(rows.map((row, index) => [row._id, shares[index]]));
      cache.set(line.orderId, table);
    }
    return table.get(line._id) ?? 0;
  }
  async function visitTax(visit: Doc<'appointments'>) {
    if (visit.receiptVatShare !== undefined) return visit.receiptVatShare;
    if (!visit.paidBy || !visit.amountPaid) return null;
    const direct = await readRangeWithinBudget(
      ctx,
      ctx.db.query('orderLines').withIndex('by_appointmentId', (q) => q.eq('appointmentId', visit._id)),
    );
    for (const line of direct) {
      const order = await ctx.db.get(line.orderId);
      if (
        order &&
        (order.status === 'paid' || (order.status === 'void' && !order.voidUnreceived)) &&
        (order.paymentEffectiveAt ?? order.paidAt) === visit.paidAt &&
        (line.saleSnapshot?.paidShare ?? lineNet(line)) === visit.price
      )
        return tax(line);
    }
    const link = await ctx.db
      .query('orderLineLinks')
      .withIndex('by_appointmentId_and_status', (q) => q.eq('appointmentId', visit._id).eq('status', 'active'))
      .first();
    const line = link ? await ctx.db.get(link.lineId) : null;
    return line ? tax(line) : null;
  }
  return { tax, visitTax };
}
