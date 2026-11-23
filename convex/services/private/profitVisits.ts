import type { Doc, Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { ReadBudgetExceeded, readBudget, readRangeWithinBudget } from '../../lib/readBudget';
import { incrementalShare } from '../../shared/commerce/returns';
import { roundRatio } from '../../shared/money';
import type { CustomerHistory, DirectCosts, ProfitLine } from '../../shared/profitability';
import { resortTodayIso } from '../../shared/time';

type Visit = Doc<'appointments'>;
const zeroCosts = { staff: 0, materials: 0, tools: 0 };
const exVat = (inclusive: number) => inclusive - roundRatio(BigInt(inclusive) * 7n, 107);

// Share single gets and index ranges across the period and the histories of its active customers.
export async function profitVisits(ctx: QueryCtx, start: number, end: number) {
  const budget = readBudget(ctx);
  async function get<T extends 'appointments' | 'sessionUses' | 'sessionGrants' | 'orderLines' | 'customers'>(
    id: Id<T>,
  ) {
    if (!budget.range()) throw new ReadBudgetExceeded();
    const doc = await ctx.db.get(id);
    if (doc && !budget.document(doc)) throw new ReadBudgetExceeded();
    return doc;
  }
  const visits = new Map<Id<'appointments'>, Visit>();
  const [delivered, adjustments, legacyRefunds] = await Promise.all([
    readRangeWithinBudget(
      ctx,
      ctx.db
        .query('appointments')
        .withIndex('by_status_and_end', (q) => q.eq('status', 'completed').gte('end', start).lt('end', end)),
    ),
    readRangeWithinBudget(
      ctx,
      ctx.db
        .query('appointmentRefunds')
        .withIndex('by_effectiveAt', (q) => q.gte('effectiveAt', start).lt('effectiveAt', end)),
    ),
    readRangeWithinBudget(
      ctx,
      ctx.db
        .query('appointments')
        .withIndex('by_refundedAt', (q) => q.gte('refundedAt', start).lt('refundedAt', end)),
    ),
  ]);
  for (const visit of legacyRefunds)
    if (visit.status === 'completed' && visit.end < end) visits.set(visit._id, visit);
  for (const visit of delivered) visits.set(visit._id, visit);
  for (const refund of adjustments) {
    if (visits.has(refund.appointmentId)) continue;
    const visit = await get(refund.appointmentId);
    if (visit && visit.status === 'completed' && visit.end < end) visits.set(visit._id, visit);
  }

  const people = new Map<Id<'customers'>, Doc<'customers'>>();
  async function person(id: Id<'customers'>) {
    const cached = people.get(id);
    if (cached) return cached;
    const doc = await get(id);
    if (!doc) throw new Error('A linked attendee is missing. Review the customer record.');
    people.set(id, doc);
    return doc;
  }
  async function canonical(id: Id<'customers'>) {
    const seen = new Set<Id<'customers'>>();
    let doc = await person(id);
    while (doc.mergedInto) {
      if (seen.has(doc._id)) throw new Error('Review the customer merge history.');
      seen.add(doc._id);
      doc = await person(doc.mergedInto);
    }
    return doc;
  }

  // Only the attendee identifies a service customer. A payer or a matching name can belong to someone else.
  const customerIds = new Set<Id<'customers'>>();
  for (const visit of visits.values()) {
    const attendee = visit.attendeeId ?? visit.reportCustomerId;
    if (attendee && visit.currency === 'THB') customerIds.add((await canonical(attendee))._id);
  }
  const histories = new Map<string, CustomerHistory>();
  for (const id of customerIds) {
    histories.set(id, { id, name: (await person(id)).name, lifetime: 0, firstDay: null });
    const aliases = new Set([id]);
    for (const alias of aliases) {
      const merged = await readRangeWithinBudget(
        ctx,
        ctx.db.query('customers').withIndex('by_mergedInto', (q) => q.eq('mergedInto', alias)),
      );
      for (const source of merged) {
        people.set(source._id, source);
        aliases.add(source._id);
      }
      const history = await readRangeWithinBudget(
        ctx,
        ctx.db
          .query('appointments')
          .withIndex('by_attendeeId_and_status_and_end', (q) =>
            q.eq('attendeeId', alias).eq('status', 'completed').lt('end', end),
          ),
      );
      const verified = await readRangeWithinBudget(
        ctx,
        ctx.db
          .query('appointments')
          .withIndex('by_reportCustomerId_and_status_and_end', (q) =>
            q.eq('reportCustomerId', alias).eq('status', 'completed').lt('end', end),
          ),
      );
      for (const visit of [...history, ...verified.filter((v) => !v.attendeeId)]) visits.set(visit._id, visit);
    }
  }
  const schedules = new Map<string, Doc<'serviceCostSchedules'>[]>();
  async function directCosts(visit: Visit, day: string): Promise<DirectCosts | null> {
    let rules = schedules.get(visit.serviceId);
    if (!rules) {
      rules = await readRangeWithinBudget(
        ctx,
        ctx.db
          .query('serviceCostSchedules')
          .withIndex('by_serviceId_and_from', (q) =>
            q.eq('serviceId', visit.serviceId).lte('from', resortTodayIso(end - 1)),
          )
          .order('desc'),
      );
      schedules.set(visit.serviceId, rules);
    }
    const rule = rules.find((item) => item.from <= day);
    return rule ? { staff: rule.staff, materials: rule.materials, tools: rule.tools } : null;
  }
  const lines: ProfitLine[] = [];
  let excludedCurrency = 0;
  for (const visit of visits.values()) {
    if (visit.currency !== 'THB') {
      if (visit.end >= start) excludedCurrency++;
      continue;
    }
    const day = resortTodayIso(visit.end);
    let earned = exVat(visit.price);
    let paidAt = visit.amountPaid > 0 ? visit.paidAt : undefined;
    if (visit.coverage) {
      const use = await get(visit.coverage.useId);
      const grant = await get(visit.coverage.grantId);
      if (!grant || !use || use.grantId !== grant._id || !use.bucket)
        throw new Error('Review the package use for ' + visit.confirmationCode);
      const original = await get(grant.lineId);
      const part = original?.saleSnapshot?.contents.find((item) => item.contentKey === grant.contentKey);
      if (!part) throw new Error('Missing package sale allocation for ' + visit.confirmationCode);
      const value = part.vatProfile === 'standard' ? exVat(part.paidShare) : part.paidShare;
      // Difference of cumulative shares allocates every satang once over paid units.
      earned =
        use.bucket === 'goodwill'
          ? 0
          : incrementalShare(value, {
              unitsSold: part.units,
              unitsBefore: part.units - use.before.paid,
              unitsThrough: part.units - use.after.paid,
            }).amount;
      paidAt = earned > 0 ? use.createdAt : undefined;
    }
    const attendee = visit.attendeeId ?? visit.reportCustomerId;
    const customerId = attendee ? (await canonical(attendee))._id : null;
    const history = customerId ? histories.get(customerId) : undefined;
    const base = {
      ref: visit.confirmationCode,
      service: visit.serviceNameSnapshot,
      serviceId: visit.serviceId,
      source: visit.source,
      customerId,
    };
    if (history) {
      history.lifetime += earned;
      if (paidAt !== undefined && paidAt < end && earned > 0) {
        const first = resortTodayIso(Math.max(visit.end, paidAt));
        if (!history.firstDay || first < history.firstDay) history.firstDay = first;
      }
    }
    if (visit.end >= start)
      lines.push({
        ...base,
        id: visit._id,
        appointmentId: visit._id,
        currentCustomer: visit.reportCustomerId ?? null,
        linkable: !visit.attendeeId,
        day,
        kind: 'Service',
        revenue: earned,
        cost: await directCosts(visit, day),
      });
    if (visit.amountRefunded <= 0) continue;
    const refunds = await readRangeWithinBudget(
      ctx,
      ctx.db
        .query('appointmentRefunds')
        .withIndex('by_appointmentId_and_recordedAt', (q) => q.eq('appointmentId', visit._id)),
    );
    const events = refunds.map((row) => ({ id: String(row._id), at: row.effectiveAt, amount: row.amount }));
    const legacy = visit.amountRefunded - events.reduce((sum, row) => sum + row.amount, 0);
    if (legacy > 0) events.push({ id: 'legacy-' + visit._id, at: visit.refundedAt ?? visit.end, amount: legacy });
    events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    let balance = visit.price;
    for (const event of events) {
      const at = Math.max(visit.end, event.at);
      if (at >= end) continue;
      const revenue = exVat(balance - event.amount) - exVat(balance);
      balance -= event.amount;
      if (history) history.lifetime += revenue;
      if (at >= start)
        lines.push({ ...base, id: event.id, day: resortTodayIso(at), kind: 'Refund', cost: zeroCosts, revenue });
    }
  }
  return { lines, customers: [...histories.values()], excludedCurrency };
}
