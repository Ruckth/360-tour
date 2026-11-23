import { ConvexError, v } from 'convex/values';
import { marketingMutation, marketingQuery } from '../auth/model';
import { ReadBudgetExceeded, readRangeWithinBudget } from '../lib/readBudget';
import { profitReportResult } from './profitValidators';
import { latestMonth, readServiceFinanceFacts } from './private/serviceFinanceFacts';
import { readView } from './private/profitViews';
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
const monthly = { overhead: v.number(), otherExpenses: v.number(), tax: v.number(), otherIncome: v.number() };
const metric = v.union(
  v.literal('revenue'),
  v.literal('gross'),
  v.literal('net'),
  v.literal('ltv'),
  v.literal('cac'),
);
function validateMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month) || !isIsoDate(month + '-01')) throw new ConvexError('Choose a calendar month.');
}
export const financeInputs = marketingQuery({
  permission: 'serviceFinance',
  args: { month: v.string(), serviceId: v.optional(v.id('services')), from: v.string() },
  handler: async (ctx, args) => {
    validateMonth(args.month);
    if (!isIsoDate(args.from)) throw new ConvexError('Choose a valid effective date.');
    const [services, campaigns, statement, schedule] = await Promise.all([
      readRangeWithinBudget(ctx, ctx.db.query('services').withIndex('by_status')),
      readRangeWithinBudget(ctx, ctx.db.query('marketingCampaigns').withIndex('by_status')),
      latestMonth(ctx, args.month),
      args.serviceId
        ? ctx.db
            .query('serviceCostSchedules')
            .withIndex('by_serviceId_and_from', (q) => q.eq('serviceId', args.serviceId!).lte('from', args.from))
            .order('desc')
            .first()
        : null,
    ]);
    return {
      services: services.map((s) => ({ id: s._id, name: s.name })),
      campaigns: campaigns.map((c) => ({ id: c._id, name: c.name })),
      statement,
      schedule,
    };
  },
});
export const recordCosts = marketingMutation({
  permission: 'serviceFinance',
  args: {
    serviceId: v.id('services'),
    from: v.string(),
    expected: v.union(v.null(), v.id('serviceCostSchedules')),
    reason: v.optional(v.string()),
    ...costs,
  },
  handler: async (ctx, { serviceId, from, expected, staff, materials, tools, reason }) => {
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
    for (const id of classified) if (!(await ctx.db.get(id))) throw new ConvexError('Campaign no longer exists.');
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

export const report = marketingQuery({
  returns: profitReportResult,
  permission: 'spend',
  args: {
    from: v.string(),
    to: v.string(),
    viewId: v.optional(v.id('serviceProfitViews')),
    overview: profitFilters,
    additional: profitFilters,
    metric: v.optional(metric),
    search: v.string(),
    category: v.string(),
    page: v.number(),
    descending: v.boolean(),
    exportRows: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { from, to, overview, additional, search, category } = args;
    const days = reportDayCount(from, to);
    if (!days || days > MAX_REPORT_DAYS) throw new ConvexError('Select between 1 and 92 Bangkok days.');
    if (!Number.isSafeInteger(args.page) || args.page < 0 || search.length > 120 || category.length > 80)
      throw new ConvexError('Invalid transaction filter.');
    validateProfitFilters(overview);
    validateProfitFilters(additional);
    const named = ctx.marketing.capabilities.serviceFinance;
    if (args.exportRows && !named) throw new ConvexError('Finance access is required to export.');
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
      for (const row of base) {
        const group = groups.get(row.serviceId) ?? [];
        group.push(row);
        groups.set(row.serviceId, group);
      }
      const breakdown = [...groups]
        .map(([id, rows]) => ({ id, name: services.get(id)!, ...profitTotals(rows) }))
        .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
      const common = {
        asOf: facts.asOf,
        summary,
        breakdown,
        expenses: narrowed
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
      const slice = base.filter((row) => matchesProfitRules(row, additional));
      const restricted = narrowed || additional.rules.length > 0;
      const filtered = calculateProfit(facts, slice, from, to, restricted);
      const evidence = profitEvidence(args.metric, facts, slice, filtered, restricted);
      const query = search.trim().toLowerCase();
      const rows = evidence.filter(
        (r) =>
          (!category || r.category === category) &&
          (!query || [r.ref, r.service, r.category, r.customer].some((s) => s.toLowerCase().includes(query))),
      );
      rows.sort((a, b) => (a.day.localeCompare(b.day) || a.id.localeCompare(b.id)) * (args.descending ? -1 : 1));
      if (args.exportRows && JSON.stringify(rows).length * 4 > 2_000_000)
        throw new ConvexError('Choose a shorter period or apply a filter before exporting.');
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
      const pageSize = 25,
        page = Math.min(args.page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
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
          rows: args.exportRows ? rows : rows.slice(page * pageSize, (page + 1) * pageSize),
        },
      };
    } catch (error) {
      if (error instanceof ReadBudgetExceeded)
        throw new ConvexError('This report exceeds the safe read limit. Choose a shorter period.');
      throw error;
    }
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
      .map((c) => ({ id: c._id, name: c.name, phoneEnding: c.phoneDigits?.slice(-4) ?? '' }));
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
  args: { appointmentId: v.id('appointments'), version: v.number(), reason: v.string(), ...costs },
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
