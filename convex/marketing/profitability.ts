import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { ConvexError, v, type Infer } from 'convex/values';
import { marketingMutation, marketingQuery, type QueryCtx } from '../auth/model';
import { ReadBudgetExceeded, readBudget, readRangeWithinBudget } from '../lib/readBudget';
import { profitReportResult } from './profitValidators';
import { latestMonth, readServiceFinanceFacts } from './private/serviceFinanceFacts';
import { readView, requireView, retireView } from './private/profitViews';
import { recordAppointmentChange } from '../services/model';
import { isIsoDate } from '../shared/dates';
import { assertMoney, roundRatio } from '../shared/money';
import { MAX_REPORT_DAYS, reportDayCount } from '../shared/marketingReport';
import {
  calculateProfit,
  matchesProfitRules,
  profitEvidence,
  profitFilters,
  profitTotals,
  validateProfitFilters,
  type ProfitLine,
} from '../shared/profitability';

function financeReason(value: string | undefined, revision: boolean) {
  const reason = value?.trim() ?? '';
  if (reason.length > 300 || (revision && !reason))
    throw new ConvexError('Enter a short reason for this finance revision.');
  return reason || 'Initial finance entry';
}
const costs = { staff: v.number(), materials: v.number(), tools: v.number() };
const monthly = {
  overhead: v.number(),
  otherExpenses: v.number(),
  tax: v.number(),
  otherIncome: v.number(),
};
const metric = v.union(
  v.literal('revenue'),
  v.literal('gross'),
  v.literal('net'),
  v.literal('ltv'),
  v.literal('cac'),
);
function validateMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month) || !isIsoDate(month + '-01'))
    throw new ConvexError('Choose a calendar month.');
}
export const financeInputs = marketingQuery({
  permission: 'serviceFinance',
  args: {
    month: v.string(),
    serviceId: v.optional(v.id('services')),
    from: v.string(),
  },
  handler: async (ctx, args) => {
    validateMonth(args.month);
    if (!isIsoDate(args.from)) throw new ConvexError('Choose a valid effective date.');
    const [services, campaigns, statement, schedule, nextSchedule] = await Promise.all([
      readRangeWithinBudget(ctx, ctx.db.query('services').withIndex('by_status')),
      readRangeWithinBudget(ctx, ctx.db.query('marketingCampaigns').withIndex('by_status')),
      latestMonth(ctx, args.month),
      args.serviceId
        ? ctx.db
            .query('serviceCostSchedules')
            .withIndex('by_serviceId_and_from', (q) =>
              q.eq('serviceId', args.serviceId!).lte('from', args.from),
            )
            .order('desc')
            .first()
        : null,
      args.serviceId
        ? ctx.db
            .query('serviceCostSchedules')
            .withIndex('by_serviceId_and_from', (q) =>
              q.eq('serviceId', args.serviceId!).gt('from', args.from),
            )
            .first()
        : null,
    ]);
    return {
      services: services.map((s) => ({ id: s._id, name: s.name })),
      campaigns: campaigns.map((c) => ({ id: c._id, name: c.name })),
      statement,
      schedule,
      nextScheduleFrom: nextSchedule?.from ?? null,
    };
  },
});
export const recordCosts = marketingMutation({
  permission: 'serviceFinance',
  args: {
    serviceId: v.id('services'),
    from: v.string(),
    expected: v.union(v.null(), v.id('serviceCostSchedules')),
    expectedNextFrom: v.optional(v.union(v.null(), v.string())),
    reason: v.optional(v.string()),
    ...costs,
  },
  handler: async (ctx, { serviceId, from, expected, expectedNextFrom, staff, materials, tools, reason }) => {
    if (!isIsoDate(from) || !(await ctx.db.get(serviceId)))
      throw new ConvexError('Select a service and valid effective date.');
    for (const value of [staff, materials, tools]) assertMoney(value, 'Cost', { allowZero: true });
    const current = await ctx.db
      .query('serviceCostSchedules')
      .withIndex('by_serviceId_and_from', (q) => q.eq('serviceId', serviceId).lte('from', from))
      .order('desc')
      .first();
    if (
      current?.from === from &&
      current.staff === staff &&
      current.tools === tools &&
      current.materials === materials
    )
      return current._id;
    if ((current?._id ?? null) !== expected)
      throw new ConvexError('The cost schedule changed. Review the current values and save again.');
    if (expectedNextFrom !== undefined) {
      const next = await ctx.db.query('serviceCostSchedules')
        .withIndex('by_serviceId_and_from', (q) => q.eq('serviceId', serviceId).gt('from', from)).first();
      if ((next?.from ?? null) !== expectedNextFrom)
        throw new ConvexError('The next effective date changed. Review the schedule and save again.');
    }
    return ctx.db.insert('serviceCostSchedules', {
      serviceId,
      from,
      reason: financeReason(reason, !!current),
      staff,
      materials,
      tools,
      actor: ctx.marketing.email,
      recordedAt: Date.now(),
    });
  },
});
export const recordMonth = marketingMutation({
  permission: 'serviceFinance',
  args: {
    month: v.string(),
    expected: v.union(v.null(), v.id('serviceFinanceMonths')),
    campaignIds: v.array(v.id('marketingCampaigns')),
    excludedCampaignIds: v.optional(v.array(v.id('marketingCampaigns'))),
    reason: v.optional(v.string()),
    ...monthly,
  },
  handler: async (ctx, { month, expected, campaignIds, reason, excludedCampaignIds = [], ...amounts }) => {
    validateMonth(month);
    for (const value of Object.values(amounts)) assertMoney(value, 'Monthly amount', { allowZero: true });
    const classified = [...campaignIds, ...excludedCampaignIds];
    if (classified.length > 200 || new Set(classified).size !== classified.length)
      throw new ConvexError('Choose up to 200 distinct campaigns.');
    for (const id of classified)
      if (!(await ctx.db.get(id))) throw new ConvexError('Campaign no longer exists.');
    const current = await latestMonth(ctx, month);
    const ids = [...campaignIds].sort();
    if (
      current &&
      (current.excludedCampaignIds ?? []).join() === [...excludedCampaignIds].sort().join() &&
      current.campaignIds.join() === ids.join() &&
      current.overhead === amounts.overhead &&
      current.tax === amounts.tax &&
      current.otherIncome === amounts.otherIncome &&
      current.otherExpenses === amounts.otherExpenses
    )
      return current._id;
    if ((current?._id ?? null) !== expected)
      throw new ConvexError('This month changed. Review the current figures and save again.');
    return ctx.db.insert('serviceFinanceMonths', {
      month,
      ...amounts,
      campaignIds: ids,
      excludedCampaignIds: [...excludedCampaignIds].sort(),
      reason: financeReason(reason, !!current),
      actor: ctx.marketing.email,
      recordedAt: Date.now(),
    });
  },
});

const reportScope = {
  from: v.string(),
  to: v.string(),
  overview: profitFilters,
  additional: profitFilters,
  metric: v.optional(metric),
  search: v.string(),
  category: v.string(),
  descending: v.boolean(),
};
const reportArgs = {
  ...reportScope,
  viewId: v.optional(v.id('serviceProfitViews')),
  preparedViewId: v.optional(v.id('serviceProfitViews')),
  page: v.number(),
  exportRows: v.optional(v.boolean()),
  includeCustomer: v.optional(v.boolean()),
};
type Scope = Infer<ReturnType<typeof v.object<typeof reportScope>>>;
type ReportArgs = Infer<ReturnType<typeof v.object<typeof reportArgs>>>;
type ReportResult = Infer<typeof profitReportResult>;
const pageSize = 25;
const responseLimit = 125 * 1024;
const encoder = new TextEncoder();

async function scopeHash(args: Scope) {
  const payload = JSON.stringify([
    args.overview,
    args.additional,
    args.metric,
    args.search,
    args.category,
    args.descending,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(payload));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateScope(args: Scope) {
  const { from, to, overview, additional, search, category } = args;
  const days = reportDayCount(from, to);
  if (!days || days > MAX_REPORT_DAYS) throw new ConvexError('Select between 1 and 92 Bangkok days.');
  if (search.length > 120 || category.length > 80) throw new ConvexError('Invalid transaction filter.');
  validateProfitFilters(overview);
  validateProfitFilters(additional);
}

async function buildReport(
  ctx: QueryCtx,
  args: ReportArgs,
  named: boolean,
  prepare = false,
): Promise<ReportResult> {
  const { from, to, overview, additional, search, category } = args;
  try {
    const facts = args.viewId
      ? await readView(ctx, args.viewId, from, to, named)
      : await readServiceFinanceFacts(ctx, from, to, named);
    const { lines, excludedCurrency } = facts;
    const base = lines.filter((row) => matchesProfitRules(row, overview));
    const narrowed = overview.rules.length > 0;
    const totals = calculateProfit(facts, base, from, to, narrowed);
    const {
      count,
      revenue,
      gross,
      net,
      ltv,
      cac,
      missingCount,
      coveredRevenue,
      costs,
      customerCount,
      newCount,
      lifetime,
      spend,
      anonymous,
    } = totals;
    const summary = {
      unmappedSpend: totals.unmappedSpend,
      count,
      revenue,
      gross,
      net,
      ltv,
      cac,
      missingCount,
      coveredRevenue,
      costs,
      customerCount,
      newCount,
      lifetime,
      spend,
      anonymous,
    };
    const groups = new Map<string, ProfitLine[]>();
    const services = new Map<string, string>();
    for (const row of lines) services.set(row.serviceId, row.service);
    if (!prepare)
      for (const row of base) {
        const group = groups.get(row.serviceId) ?? [];
        group.push(row);
        groups.set(row.serviceId, group);
      }
    const breakdown = [...groups]
      .map(([id, rows]) => ({
        id,
        name: services.get(id)!,
        ...profitTotals(rows),
      }))
      .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
    const common = {
      asOf: facts.asOf,
      summary,
      breakdown,
      expenses:
        narrowed || prepare
          ? []
          : [...new Set(facts.expenses.map((e) => e.kind))].map((kind) => ({
              kind,
              amount: facts.expenses.filter((e) => e.kind === kind).reduce((sum, e) => sum + e.amount, 0),
            })),
      excludedCurrency,
      missingMonths: facts.missingMonths,
      services: [...services].map(([id, name]) => ({ id, name })),
      sources: [...new Set(lines.map((row) => row.source))].sort(),
    };
    if (!args.metric) return { ...common, detail: null };
    const slice =
      additional.rules.length > 0 ? base.filter((row) => matchesProfitRules(row, additional)) : base;
    const restricted = narrowed || additional.rules.length > 0;
    const filtered =
      additional.rules.length > 0 ? calculateProfit(facts, slice, from, to, restricted) : totals;
    const evidence = profitEvidence(args.metric, facts, slice, filtered, restricted);
    const query = search.trim().toLowerCase();
    const rows = evidence.filter(
      (r) =>
        (!category || r.category === category) &&
        (!query || [r.ref, r.service, r.category, r.customer].some((s) => s.toLowerCase().includes(query))),
    );
    rows.sort(
      (a, b) => (a.day.localeCompare(b.day) || a.id.localeCompare(b.id)) * (args.descending ? -1 : 1),
    );
    const sum = rows.reduce((n, row) => n + (row.amount ?? 0), 0);
    const people = rows.filter(
      (row) => row.category === 'New customer' || row.category === 'Lifetime revenue',
    ).length;
    const displayedRatio =
      args.metric === 'ltv' && people
        ? roundRatio(sum, people)
        : args.metric === 'cac' && !query && !category
          ? filtered.cac
          : null;
    const page = Math.min(args.page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
    return {
      ...common,
      detail: {
        value: filtered[args.metric],
        categories: [...new Set(evidence.map((r) => r.category))].sort(),
        sum,
        people,
        displayedRatio,
        count: rows.length,
        page,
        pageSize,
        rows: prepare ? rows : rows.slice(page * pageSize, (page + 1) * pageSize),
      },
    };
  } catch (error) {
    if (error instanceof ReadBudgetExceeded)
      throw new ConvexError('This report exceeds the safe read limit. Choose a shorter period.');
    throw error;
  }
}

export const prepareTransactions = marketingMutation({
  permission: 'spend',
  args: { ...reportScope, viewId: v.id('serviceProfitViews') },
  returns: v.id('serviceProfitViews'),
  handler: async (ctx, args): Promise<Id<'serviceProfitViews'>> => {
    validateScope(args);
    if (!args.metric) throw new ConvexError('Select a transaction metric.');
    if (process.env.PROFIT_PREPARATION_PAUSED === '1') throw new ConvexError('Transaction preparation is temporarily paused.');
    const { from, to, viewId } = args;
    const named = ctx.marketing.capabilities.serviceFinance;
    const source = await requireView(ctx, viewId, from, to, named);
    if (source.parentViewId) throw new ConvexError('Refresh the report to reopen this view.');
    const scope = await scopeHash(args);
    const existing = await ctx.db
      .query('serviceProfitViews')
      .withIndex('by_parent_scope', (q) => q.eq('parentViewId', viewId).eq('scope', scope))
      .order('desc').first();
    if (existing && existing.expiresAt > Date.now()) return existing._id;

    const result = await buildReport(ctx, { ...args, page: 0 }, named, true);
    if (!result.detail) throw new ConvexError('Choose a transaction metric.');
    const { rows, ...detail } = result.detail;
    const meta = JSON.stringify({ ...result, detail });
    const metaBytes = encoder.encode(meta).length;
    let totalBytes = metaBytes;
    const pages = [];
    for (let start = 0; start < rows.length; start += pageSize) {
      const payload = JSON.stringify(rows.slice(start, start + pageSize));
      const size = encoder.encode(payload).length;
      if (metaBytes + size > responseLimit)
        throw new ConvexError('Transaction page exceeds the response limit. Choose a narrower scope.');
      totalBytes += size;
      pages.push(payload);
    }
    if (metaBytes > responseLimit || totalBytes > 8_000_000 || pages.length > 1000)
      throw new ConvexError('Choose a shorter period or add filters before opening these transactions.');

    const active = await ctx.db.query('serviceProfitViews').withIndex('by_parent_expiry', (q) =>
      q.eq('parentViewId', viewId).gt('expiresAt', Date.now()),
    ).take(3);
    if (active.length === 3) await retireView(ctx, active[0]);
    const id = await ctx.db.insert('serviceProfitViews', {
      owner: source.owner,
      from,
      to,
      named,
      expiresAt: source.expiresAt,
      parentViewId: viewId,
      scope,
    });
    await ctx.db.insert('serviceProfitViewChunks', {
      viewId: id,
      sequence: -1,
      payload: meta,
    });
    for (const [sequence, payload] of pages.entries()) {
      await ctx.db.insert('serviceProfitViewChunks', {
        viewId: id,
        sequence,
        payload,
      });
    }
    await ctx.scheduler.runAt(source.expiresAt, internal.marketing.profitViews.expireView, { id });
    return id;
  },
});

export const report = marketingQuery({
  returns: profitReportResult,
  permission: 'spend',
  args: reportArgs,
  handler: async (ctx, args) => {
    validateScope(args);
    if (!Number.isSafeInteger(args.page) || args.page < 0)
      throw new ConvexError('Invalid transaction filter.');
    const named = ctx.marketing.capabilities.serviceFinance;
    if ((args.exportRows || args.includeCustomer) && !named)
      throw new ConvexError('Finance access is required to export.');
    if (args.exportRows && !args.preparedViewId)
      throw new ConvexError('Prepare supporting records before exporting.');
    if (!args.preparedViewId) return buildReport(ctx, args, named);

    const view = await requireView(ctx, args.preparedViewId, args.from, args.to, named);
    if (!args.viewId || view.parentViewId !== args.viewId || view.scope !== (await scopeHash(args)))
      throw new ConvexError('This report view expired or access changed. Refresh the report.');
    if (args.exportRows) await requireView(ctx, args.viewId, args.from, args.to, named);
    const budget = readBudget(ctx);
    const chunk = async (sequence: number) => {
      if (!budget.range()) throw new ReadBudgetExceeded();
      const row = await ctx.db.query('serviceProfitViewChunks')
        .withIndex('by_view', (q) => q.eq('viewId', view._id).eq('sequence', sequence)).unique();
      if (row && !budget.document(row)) throw new ReadBudgetExceeded();
      return row;
    };
    const metadata = await chunk(-1);
    if (!metadata) throw new ConvexError('This report view expired. Refresh the report.');
    type Metadata = Omit<ReportResult, 'detail'> & {
      detail: Omit<NonNullable<ReportResult['detail']>, 'rows'>;
    };
    const result = JSON.parse(metadata.payload) as Metadata;
    const page = Math.min(args.page, Math.max(0, Math.ceil(result.detail.count / pageSize) - 1));
    if (args.exportRows && page !== args.page) throw new ConvexError('Invalid export page.');
    const part = result.detail.count ? await chunk(page) : null;
    if (result.detail.count && !part) throw new ConvexError('This report view expired. Refresh the report.');
    const rows = part ? (JSON.parse(part.payload) as NonNullable<ReportResult['detail']>['rows']) : [];
    const visibleRows: typeof rows = args.exportRows
      ? rows.map((row, index) => ({
          id: 'export-' + (page * pageSize + index + 1),
          day: row.day,
          ref: args.includeCustomer ? row.ref : '',
          customer: args.includeCustomer ? row.customer : '',
          category: row.category,
          service: row.service,
          ...(row.basis ? { basis: row.basis } : {}),
          amount: row.amount,
        }))
      : rows;
    return { ...result, detail: { ...result.detail, page, rows: visibleRows } };
  },
});

export const findCustomers = marketingQuery({
  permission: 'serviceFinance',
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const query = name.trim();
    if (query.length < 2 || query.length > 100) return [];
    const matches = await ctx.db
      .query('customers')
      .withSearchIndex('search_name', (q) => q.search('name', query).eq('archivedAt', undefined))
      .take(15);
    return matches
      .filter((c) => !c.mergedInto)
      .map((c) => ({
        id: c._id,
        name: c.name,
        phoneEnding: c.phoneDigits?.slice(-4) ?? '',
      }));
  },
});
export const identifyCustomer = marketingMutation({
  permission: 'serviceFinance',
  args: {
    appointmentId: v.id('appointments'),
    expected: v.union(v.null(), v.id('customers')),
    customerId: v.union(v.null(), v.id('customers')),
  },
  returns: v.null(),
  handler: async (ctx, { appointmentId, customerId, expected }) => {
    const visit = await ctx.db.get(appointmentId);
    if (!visit || visit.status !== 'completed' || visit.attendeeId)
      throw new ConvexError('This visit cannot be assigned a reporting customer.');
    if ((visit.reportCustomerId ?? null) === customerId) return null;
    if ((visit.reportCustomerId ?? null) !== expected)
      throw new ConvexError('The reporting customer changed. Refresh and review the visit.');
    const customer = customerId ? await ctx.db.get(customerId) : null;
    if (customerId && (!customer || customer.archivedAt !== undefined || customer.mergedInto))
      throw new ConvexError('Choose an active customer.');
    await recordAppointmentChange(
      ctx,
      visit,
      { reportCustomerId: customerId ?? undefined },
      {
        actor: ctx.marketing.email,
        kind: 'details',
        effectiveAt: visit.end,
        reason: 'Finance verified the attendee effective on the delivery date',
      },
    );
    return null;
  },
});

export const recordVisitCosts = marketingMutation({
  permission: 'serviceFinance',
  args: {
    appointmentId: v.id('appointments'),
    version: v.number(),
    reason: v.string(),
    ...costs,
  },
  returns: v.null(),
  handler: async (ctx, { appointmentId, version, reason, staff, materials, tools }) => {
    const visit = await ctx.db.get(appointmentId);
    if (visit?.status !== 'completed') throw new ConvexError('Choose a completed visit.');
    const note = financeReason(reason, true);
    const amounts = { staff, materials, tools };
    for (const n of Object.values(amounts)) assertMoney(n, 'Cost', { allowZero: true });
    const prior = visit.actualCosts;
    if (prior && prior.staff === staff && prior.materials === materials && prior.tools === tools) return null;
    if ((prior?.version ?? 0) !== version)
      throw new ConvexError('Visit costs changed. Refresh and review the entry.');
    await recordAppointmentChange(
      ctx,
      visit,
      { actualCosts: { ...amounts, version: version + 1 } },
      {
        actor: ctx.marketing.email,
        kind: 'details',
        reason: note,
        details: (['staff', 'materials', 'tools'] as const).map((k) => ({
          field: k + 'Cost',
          from: prior?.[k] ?? null,
          to: amounts[k],
        })),
      },
    );
    return null;
  },
});
