import type { QueryCtx } from '../../auth/model';
import type { Id } from '../../_generated/dataModel';
import { readRangeWithinBudget } from '../../lib/readBudget';
import { profitFees } from '../../pos/model';
import { profitVisits } from '../../services/model';
import { addDays } from '../../shared/dates';
import { reportRangeBounds, spendInRange } from '../../shared/marketingReport';
import type { Expense, ProfitFacts } from '../../shared/profitability';
function endOfMonth(month: string) {
  const date = new Date(month + '-01T00:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}
export const latestMonth = (ctx: QueryCtx, month: string) =>
  ctx.db
    .query('serviceFinanceMonths')
    .withIndex('by_month', (q) => q.eq('month', month))
    .order('desc')
    .first();

async function expensesFor(ctx: QueryCtx, from: string, to: string) {
  const expenses: Expense[] = [],
    missingMonths: string[] = [];
  const names = new Map<Id<'marketingCampaigns'>, string>();
  const entries = await readRangeWithinBudget(
    ctx,
    ctx.db.query('marketingSpend').withIndex('by_to', (q) => q.gte('to', from).lte('to', addDays(to, 365))),
  );
  for (let first = from.slice(0, 7) + '-01'; first <= to; ) {
    const month = first.slice(0, 7),
      last = endOfMonth(month);
    const statement = await latestMonth(ctx, month);
    if (!statement) missingMonths.push(month);
    else {
      const fields = [
        ['Overhead', 'overhead'],
        ['Other expenses', 'otherExpenses'],
        ['Income tax', 'tax'],
        ['Other income', 'otherIncome'],
      ] as const;
      for (const [kind, field] of fields) {
        const share = spendInRange({ from: first, to: last, amount: statement[field] }, from, to);
        expenses.push({
          id: statement._id + field,
          day: first,
          ref: month + ' service accounts',
          kind,
          amount: kind === 'Other income' ? share : -share,
        });
      }
    }
    for (const row of entries) {
      if (row.deletedAt !== undefined || statement?.excludedCampaignIds?.includes(row.campaignId)) continue;
      const share = spendInRange(row, from > first ? from : first, to < last ? to : last);
      if (!share) continue;
      if (!names.has(row.campaignId))
        names.set(row.campaignId, (await ctx.db.get(row.campaignId))?.name ?? 'Archived campaign');
      expenses.push({
        id: row._id + month,
        day: row.from > first ? row.from : first,
        ref: names.get(row.campaignId)!,
        kind: statement?.campaignIds.includes(row.campaignId) ? 'Marketing' : 'Unmapped spend',
        amount: -share,
      });
    }
    first = addDays(last);
  }
  return { expenses, missingMonths };
}

export type ReportFacts = ProfitFacts & { excludedCurrency: number; asOf: number };
export async function readServiceFinanceFacts(
  ctx: QueryCtx,
  from: string,
  to: string,
  named: boolean,
): Promise<ReportFacts> {
  const { start, end } = reportRangeBounds(from, to);
  const { lines, customers, excludedCurrency } = await profitVisits(ctx, start, end);
  if (!named) {
    const tokens = new Map(customers.map((c, i) => [c.id, 'Attendee ' + (i + 1)]));
    for (const c of customers) {
      c.id = tokens.get(c.id)!;
      c.name = c.id;
    }
    for (const row of lines) {
      row.customerId = row.customerId ? (tokens.get(row.customerId) ?? null) : null;
      delete row.appointmentId;
      delete row.currentCustomer;
      delete row.actualVersion;
      delete row.linkable;
    }
  }
  lines.push(...(await profitFees(ctx, start, end)));
  return { lines, customers, excludedCurrency, asOf: Date.now(), ...(await expensesFor(ctx, from, to)) };
}
