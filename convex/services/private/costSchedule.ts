import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { resortTodayIso } from '../../shared/time';

export async function deliveryCostVersion(ctx: QueryCtx, serviceId: Id<'services'>, end: number) {
  const row = await ctx.db
    .query('serviceCostSchedules')
    .withIndex('by_serviceId_and_from', (q) => q.eq('serviceId', serviceId).lte('from', resortTodayIso(end)))
    .order('desc')
    .first();
  return row ? { costScheduleId: row._id } : {};
}
