import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { readBudget, readRangeWithinBudget, ReadBudgetExceeded } from '../../lib/readBudget';

// Small cohorts use attendee indexes. For large cohorts with short histories, one bounded probe
// replaces hundreds of empty range reads. If the probe fills, revert to targeted history.
export async function periodCustomerHistory(
  ctx: QueryCtx,
  ids: Set<Id<'customers'>>,
  before: number,
  people: Map<Id<'customers'>, Doc<'customers'>>,
) {
  const visits = new Map<Id<'appointments'>, Doc<'appointments'>>();
  async function visitHistory(id: Id<'customers'>) {
    const [attendee, verified] = await Promise.all([
      readRangeWithinBudget(
        ctx,
        ctx.db
          .query('appointments')
          .withIndex('by_attendeeId_and_status_and_end', (q) =>
            q.eq('attendeeId', id).eq('status', 'completed').lt('end', before),
          ),
      ),
      readRangeWithinBudget(
        ctx,
        ctx.db
          .query('appointments')
          .withIndex('by_reportCustomerId_and_status_and_end', (q) =>
            q.eq('reportCustomerId', id).eq('status', 'completed').lt('end', before),
          ),
      ),
    ]);
    for (const row of [...attendee, ...verified.filter((v) => !v.attendeeId)]) visits.set(row._id, row);
  }
  const aliases = new Set(ids);
  if (ids.size >= 64) {
    const merged = await readRangeWithinBudget(
      ctx,
      ctx.db.query('customers').withIndex('by_mergedInto', (q) => q.gt('mergedInto', undefined)),
    );
    const children = new Map<Id<'customers'>, Id<'customers'>[]>();
    for (const row of merged) {
      if (!row.mergedInto) continue;
      people.set(row._id, row);
      const group = children.get(row.mergedInto) ?? [];
      group.push(row._id);
      children.set(row.mergedInto, group);
    }
    for (const id of aliases) for (const source of children.get(id) ?? []) aliases.add(source);
    const limit = Math.min(1000, 2 * ids.size);
    const budget = readBudget(ctx);
    if (!budget.range()) throw new ReadBudgetExceeded();
    const past = await ctx.db
      .query('appointments')
      .withIndex('by_status_and_end', (q) => q.eq('status', 'completed').lt('end', before))
      .take(limit);
    for (const row of past) if (!budget.document(row)) throw new ReadBudgetExceeded();
    if (past.length < limit)
      return past.filter((row) => {
        const person = row.attendeeId ?? row.reportCustomerId;
        return person && aliases.has(person);
      });
    for (const id of aliases) await visitHistory(id);
  } else {
    for (const id of aliases) {
      const merged = await readRangeWithinBudget(
        ctx,
        ctx.db.query('customers').withIndex('by_mergedInto', (q) => q.eq('mergedInto', id)),
      );
      for (const row of merged) {
        people.set(row._id, row);
        aliases.add(row._id);
      }
      await visitHistory(id);
    }
  }
  return [...visits.values()];
}
