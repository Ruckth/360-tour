import type { QueryCtx } from '../../_generated/server';
import type { Doc, Id } from '../../_generated/dataModel';
import { readBudget, ReadBudgetExceeded, readRangeWithinBudget } from '../../lib/readBudget';
import { lineNet } from '../../shared/orderMath';
import { revenueRemaining } from '../../shared/serviceVat';
import { profitReceiptReader } from './profitReceipt';
import { resortTodayIso } from '../../shared/time';
import type { ProfitLine } from '../../shared/profitability';

/** Fee rows are separate from delivered appointments, including when both appear on one receipt. */
export async function profitFees(ctx: QueryCtx, start: number, end: number): Promise<ProfitLine[]> {
  const receipts = profitReceiptReader(ctx);
  const byPaid = (status: 'paid' | 'void') =>
    readRangeWithinBudget(
      ctx,
      ctx.db
        .query('orders')
        .withIndex('by_status_and_paidAt', (q) => q.eq('status', status).gte('paidAt', start).lt('paidAt', end)),
    );
  const budget = readBudget(ctx);
  const lines: ProfitLine[] = [];
  const feeLines = new Map<Id<'orderLines'>, Doc<'orderLines'>>();
  const feeGroups = new Map<Id<'orders'>, Doc<'orderLines'>[]>();
  // A complete sparse fee probe avoids reading every paid service receipt in the period.
  const probeLimit = 501;
  if (!budget.range()) throw new ReadBudgetExceeded();
  const probe = await ctx.db.query('orderLines')
    .withIndex('by_feeAppointmentId', (q) => q.gt('feeAppointmentId', undefined)).take(probeLimit);
  for (const line of probe) if (!budget.document(line)) throw new ReadBudgetExceeded();
  const sparse = probe.length < probeLimit;
  const orders = new Map<Id<'orders'>, Doc<'orders'>>();
  if (sparse) {
    for (const line of probe) {
      if (!line.fee) continue;
      feeLines.set(line._id, line);
      const group = feeGroups.get(line.orderId) ?? [];
      group.push(line);
      feeGroups.set(line.orderId, group);
    }
    for (const orderId of feeGroups.keys()) {
      if (!budget.range()) throw new ReadBudgetExceeded();
      const order = await ctx.db.get(orderId);
      if (!order) continue;
      if (!budget.document(order)) throw new ReadBudgetExceeded();
      orders.set(order._id, order);
    }
  } else {
    const [paid, voided, corrected] = await Promise.all([
      byPaid('paid'),
      byPaid('void'),
      readRangeWithinBudget(
        ctx,
        ctx.db.query('orders').withIndex('by_paymentEffectiveAt', (q) =>
          q.gte('paymentEffectiveAt', start).lt('paymentEffectiveAt', end),
        ),
      ),
    ]);
    for (const order of [...paid, ...voided, ...corrected]) orders.set(order._id, order);
  }
  const refunds = await readRangeWithinBudget(
    ctx,
    ctx.db.query('orderRefunds').withIndex('by_businessDate', (q) =>
      q.gte('businessDate', resortTodayIso(start)).lte('businessDate', resortTodayIso(end - 1)),
    ),
  );
  function entry(
    line: Doc<'orderLines'>,
    order: Doc<'orders'>,
    id: string,
    day: string,
    revenue: number,
    refund: boolean,
  ) {
    if (!line.fee || order.voidUnreceived || order.currency !== 'THB' || !['paid', 'void'].includes(order.status))
      return;
    lines.push({
      id,
      day,
      ref: 'Order #' + order.orderNumber,
      kind: refund ? 'Refund' : 'Fee',
      service: 'Cancellation and no-show fees',
      serviceId: 'fees',
      source: 'pos',
      customerId: null,
      cost: { staff: 0, materials: 0, tools: 0 },
      revenue,
    });
  }
  for (const order of orders.values()) {
    const at = order.paymentEffectiveAt ?? order.paidAt;
    if (at === undefined || at < start || at >= end || order.voidUnreceived) continue;
    const extras =
      sparse
        ? (feeGroups.get(order._id) ?? [])
        : await readRangeWithinBudget(
            ctx,
            ctx.db
              .query('orderLines')
              .withIndex('by_orderId_and_kind', (q) => q.eq('orderId', order._id).eq('kind', 'extra')),
          );
    for (const line of extras) {
      if (!line.fee) continue;
      feeLines.set(line._id, line);
      const gross = line.saleSnapshot?.paidShare ?? lineNet(line);
      entry(line, order, line._id, resortTodayIso(at), gross - (await receipts.tax(line)), false);
    }
  }
  const refundedLines = new Set(refunds.map((row) => row.lineId));
  for (const id of refundedLines) {
    if (!budget.range()) throw new ReadBudgetExceeded();
    const line = feeLines.get(id) ?? (await ctx.db.get(id));
    if (!line || !budget.document(line)) {
      budget.assert();
      continue;
    }
    if (!line.fee) continue;
    if (!budget.range()) throw new ReadBudgetExceeded();
    const order = orders.get(line.orderId) ?? (await ctx.db.get(line.orderId));
    if (!order || !budget.document(order)) {
      budget.assert();
      continue;
    }
    const history = await readRangeWithinBudget(
      ctx,
      ctx.db.query('orderRefunds').withIndex('by_lineId', (q) => q.eq('lineId', id)),
    );
    history.sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a._creationTime - b._creationTime);
    let balance = line.saleSnapshot?.paidShare ?? lineNet(line);
    const gross = balance,
      vat = await receipts.tax(line);
    const net = (value: number) => revenueRemaining(value, gross, vat);
    for (const row of history) {
      const amount = net(balance - row.amount) - net(balance);
      balance -= row.amount;
      if (row.businessDate >= resortTodayIso(start) && row.businessDate <= resortTodayIso(end - 1))
        entry(line, order, row._id, row.businessDate, amount, true);
    }
  }
  return lines;
}
