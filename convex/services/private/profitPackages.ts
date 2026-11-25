import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../auth/model';
import { readBudget, readRangeWithinBudget, ReadBudgetExceeded } from '../../lib/readBudget';
import { profitReceiptReader } from '../../pos/model';
import { apportionMoney } from '../../shared/commerce/allocation';
import { incrementalShare } from '../../shared/commerce/returns';
import { includedServiceVat } from '../../shared/serviceVat';

type UseId = Id<'sessionUses'>;
type Event = { id: string; at: number; revenue: number; kind: 'Refund' | 'Settlement' };
export async function packageTimeline(
  ctx: QueryCtx,
  visit: Doc<'appointments'>,
  receipts: ReturnType<typeof profitReceiptReader>,
) {
  if (!visit.coverage && !visit.restoredCoverageAt && !(visit.attendeeId && visit.financialRevision)) return null;
  const uses = new Map<UseId, number | null>();
  if (visit.coverage) uses.set(visit.coverage.useId, null);
  if (visit.restoredCoverageAt || (visit.attendeeId && visit.financialRevision)) {
    // The return quotes are immutable and retain every restored use, even when the same visit
    // is redeemed and restored repeatedly. The appointment only stores its currently active use.
    const lines = await readRangeWithinBudget(
      ctx,
      ctx.db.query('orderLines').withIndex('by_appointmentId', (q) => q.eq('appointmentId', visit._id)),
    );
    for (const orderId of new Set(lines.map((l) => l.orderId))) {
      const returns = await readRangeWithinBudget(
        ctx,
        ctx.db
          .query('orderReturns')
          .withIndex('by_orderId_and_status', (q) => q.eq('orderId', orderId).eq('status', 'completed')),
      );
      for (const item of returns)
        for (const quote of item.visitReturns ?? []) {
          if (quote.appointmentId === visit._id && quote.restore && item.completedAt !== undefined)
            uses.set(quote.restore.useId, item.completedAt);
        }
    }
  }
  if (!uses.size) return null;
  const budget = readBudget(ctx);
  async function get<T extends 'sessionUses' | 'sessionGrants' | 'orderLines'>(id: Id<T>) {
    if (!budget.range()) throw new ReadBudgetExceeded();
    const row = await ctx.db.get(id);
    if (!row) throw new Error('Review the package sale for ' + visit.confirmationCode);
    if (!budget.document(row)) throw new ReadBudgetExceeded();
    return row;
  }
  const entries = [];
  for (const [id, restoredAt] of uses) {
    const use = await get(id);
    if (use.kind !== 'use' || !use.bucket) throw new Error('Review the package use for ' + visit.confirmationCode);
    const grant = await get(use.grantId),
      original = await get(grant.lineId);
    const contents = original.saleSnapshot?.contents ?? [],
      index = contents.findIndex((p) => p.contentKey === grant.contentKey);
    const part = contents[index];
    if (!part) throw new Error('Missing package sale allocation for ' + visit.confirmationCode);
    const receiptShare = part.vatBase
      ? apportionMoney(
          await receipts.tax(original),
          contents.map((p) => p.vatBase),
        )[index]
      : 0;
    const tax =
      part.vatProfile === 'standard' && !part.vatBase ? includedServiceVat(part.paidShare) : receiptShare;
    const revenue =
      use.bucket === 'goodwill'
        ? 0
        : incrementalShare(part.paidShare - tax, {
            unitsSold: part.units,
            unitsBefore: part.units - use.before.paid,
            unitsThrough: part.units - use.after.paid,
          }).amount;
    entries.push({ id, createdAt: use.createdAt, creation: use._creationTime, revenue, restoredAt });
  }
  entries.sort((a, b) => a.createdAt - b.createdAt || a.creation - b.creation || a.id.localeCompare(b.id));
  const events: Event[] = [];
  for (const [i, item] of entries.entries()) {
    if (i > 0)
      events.push({
        id: 'redeem-' + item.id,
        at: Math.max(visit.end, item.createdAt),
        revenue: item.revenue,
        kind: 'Settlement',
      });
    if (item.restoredAt !== null)
      events.push({
        id: 'restore-' + item.id,
        at: Math.max(visit.end, item.restoredAt),
        revenue: -item.revenue,
        kind: 'Refund',
      });
  }
  const last = entries[entries.length - 1],
    first = entries[0];
  if (
    last.restoredAt !== null &&
    !visit.coverage &&
    visit.paidAt !== undefined &&
    visit.paidAt >= last.restoredAt &&
    visit.amountPaid > 0
  ) {
    const tax = (await receipts.visitTax(visit)) ?? includedServiceVat(visit.amountPaid);
    events.push({
      id: 'recollection-' + visit._id,
      at: visit.paidAt,
      revenue: visit.amountPaid - tax,
      kind: 'Settlement',
    });
  }
  return { earned: first.revenue, paidAt: first.revenue > 0 ? first.createdAt : undefined, events };
}
