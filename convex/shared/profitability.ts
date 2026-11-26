import type { Id } from '../_generated/dataModel';
import { ConvexError, type Infer, v } from 'convex/values';
import { roundRatio } from './money';

export const profitMetrics = ['revenue', 'gross', 'net', 'ltv', 'cac'] as const;
export type ProfitMetric = (typeof profitMetrics)[number];
export const metricNames: Record<ProfitMetric, string> = {
  revenue: 'Revenue',
  gross: 'Gross profit',
  net: 'Net profit',
  ltv: 'Revenue LTV',
  cac: 'Acquisition cost',
};
export const filterRule = v.union(
  v.object({
    field: v.union(
      v.literal('service'),
      v.literal('source'),
      v.literal('kind'),
      v.literal('coverage'),
      v.literal('attendee'),
    ),
    operator: v.union(v.literal('is'), v.literal('is not')),
    value: v.union(v.string(), v.array(v.string())),
  }),
  v.object({
    field: v.literal('revenue'),
    operator: v.union(v.literal('at least'), v.literal('at most')),
    value: v.number(),
  }),
);
export const profitFilters = v.object({
  join: v.union(v.literal('and'), v.literal('or')),
  rules: v.array(filterRule),
});
export type ProfitFilters = Infer<typeof profitFilters>;
export type ProfitRule = Infer<typeof filterRule>;
export const emptyFilters: ProfitFilters = { join: 'and', rules: [] };
export type DirectCosts = { staff: number; materials: number; tools: number };
export type ProfitLine = {
  id: string;
  day: string;
  ref: string;
  kind: 'Service' | 'Refund' | 'Fee' | 'Settlement';
  service: string;
  serviceId: string;
  source: string;
  customerId: string | null;
  revenue: number;
  cost: DirectCosts | null;
  appointmentId?: Id<'appointments'>;
  currentCustomer?: Id<'customers'> | null;
  linkable?: boolean;
  actualVersion?: number;
  costBasis?: 'Actual' | 'Scheduled' | 'Historical estimate';
};
export type CustomerHistory = { id: string; name: string; lifetime: number; firstDay: string | null };
export type Expense = {
  id: string;
  day: string;
  ref: string;
  kind: 'Unmapped spend' | 'Marketing' | 'Overhead' | 'Other expenses' | 'Income tax' | 'Other income';
  amount: number;
};
export type ProfitFacts = {
  lines: ProfitLine[];
  customers: CustomerHistory[];
  expenses: Expense[];
  missingMonths: string[];
};
export function validateProfitFilters(filters: ProfitFilters) {
  if (filters.rules.length > 12) throw new ConvexError('Use up to 12 rules per filter group.');
  for (const rule of filters.rules) {
    if (
      Array.isArray(rule.value) &&
      (!rule.value.length ||
        rule.value.length > 50 ||
        rule.value.some((value) => !value.trim() || value.length > 150))
    )
      throw new ConvexError('Choose between one and 50 filter values.');
    if (typeof rule.value === 'string' && (!rule.value.trim() || rule.value.length > 150))
      throw new ConvexError('Choose a filter value.');
    if (typeof rule.value === 'number' && !Number.isSafeInteger(rule.value))
      throw new ConvexError('Enter an amount in baht and satang.');
  }
}
export function matchesProfitRules(row: ProfitLine, group: ProfitFilters) {
  function matches(rule: ProfitRule) {
    if (rule.field === 'revenue')
      return rule.operator === 'at least' ? row.revenue >= rule.value : row.revenue <= rule.value;
    const value =
      rule.field === 'coverage'
        ? row.cost
          ? 'Complete'
          : 'Missing'
        : rule.field === 'service'
          ? row.serviceId
          : rule.field === 'attendee'
            ? row.customerId
              ? 'Identified'
              : 'Unidentified'
            : row[rule.field];
    const included = Array.isArray(rule.value) ? rule.value.includes(value) : rule.value === value;
    return rule.operator === 'is' ? included : !included;
  }
  return !group.rules.length || (group.join === 'and' ? group.rules.every(matches) : group.rules.some(matches));
}
export function costTotal(cost: DirectCosts) {
  return cost.staff + cost.materials + cost.tools;
}

export function profitTotals(lines: readonly ProfitLine[]) {
  let revenue = 0,
    coveredRevenue = 0,
    missingCount = 0;
  const costs = { staff: 0, materials: 0, tools: 0 };
  for (const row of lines) {
    revenue += row.revenue;
    if (!row.cost) {
      missingCount++;
      continue;
    }
    coveredRevenue += row.revenue;
    costs.staff += row.cost.staff;
    costs.materials += row.cost.materials;
    costs.tools += row.cost.tools;
  }
  const gross = lines.length > 0 && missingCount === lines.length ? null : coveredRevenue - costTotal(costs);
  return { revenue, coveredRevenue, costs, gross, missingCount, count: lines.length };
}

export function calculateProfit(
  facts: ProfitFacts,
  lines: ProfitLine[],
  from: string,
  to: string,
  narrowed: boolean,
) {
  // A refund is financial activity. Only a positively valued delivery can establish acquisition.
  const ids = new Set(lines.map((row) => row.customerId).filter((id) => id !== null));
  const customers = facts.customers.filter((customer) => ids.has(customer.id));
  const acquired = customers.filter((c) => c.firstDay !== null && c.firstDay >= from && c.firstDay <= to);
  const lifetime = customers.reduce((sum, c) => sum + c.lifetime, 0);
  const total = profitTotals(lines);
  const spend = facts.expenses.filter((row) => row.kind === 'Marketing').reduce((sum, row) => sum - row.amount, 0);
  const unmappedSpend = facts.expenses
    .filter((row) => row.kind === 'Unmapped spend')
    .reduce((sum, row) => sum - row.amount, 0);
  const expensesComplete = facts.missingMonths.length === 0 && unmappedSpend === 0;
  const net =
    !narrowed && total.gross !== null && !total.missingCount && expensesComplete
      ? total.gross + facts.expenses.reduce((sum, row) => sum + row.amount, 0)
      : null;
  const cac = acquired.length && !narrowed && expensesComplete ? roundRatio(spend, acquired.length) : null;
  const ltv = customers.length ? roundRatio(lifetime, customers.length) : null;
  return {
    ...total,
    customers,
    acquired,
    customerCount: customers.length,
    newCount: acquired.length,
    lifetime,
    spend,
    unmappedSpend,
    net,
    ltv,
    cac,
    anonymous: lines.filter((row) => !row.customerId).length,
  };
}
export type EvidenceRow = {
  id: string;
  day: string;
  ref: string;
  category: string;
  basis?: string;
  costEntry?: { appointmentId: Id<'appointments'>; version: number; costs: DirectCosts | null };
  service: string;
  amount: number | null;
  customer: string;
  appointmentId?: Id<'appointments'>;
  currentCustomer?: Id<'customers'> | null;
};
export function profitEvidence(
  metric: ProfitMetric,
  facts: ProfitFacts,
  lines: ProfitLine[],
  result: ReturnType<typeof calculateProfit>,
  narrowed: boolean,
): EvidenceRow[] {
  const names = new Map(result.customers.map((c) => [c.id, c.name]));
  const expenses = facts.expenses
    .filter(
      (e) => metric === 'net' || (metric === 'cac' && (e.kind === 'Marketing' || e.kind === 'Unmapped spend')),
    )
    .map((e) => ({
      id: e.id,
      day: e.day,
      ref: e.ref,
      category: e.kind,
      service: 'All services',
      customer: '',
      amount: metric === 'cac' ? -e.amount : e.amount,
    }));
  if (metric === 'ltv' || metric === 'cac') {
    const customers = metric === 'cac' ? result.acquired : result.customers;
    return [
      ...customers.map((c) => ({
        id: c.id,
        day: c.firstDay ?? '',
        ref: c.name,
        category: metric === 'ltv' ? 'Lifetime revenue' : 'New customer',
        service: '',
        customer: c.name,
        amount: metric === 'ltv' ? c.lifetime : null,
      })),
      ...(narrowed ? [] : expenses),
    ];
  }
  const rows: EvidenceRow[] = [];
  for (const line of lines) {
    const base = {
      day: line.day,
      ...(line.cost && line.costBasis && { basis: line.costBasis }),
      ref: line.ref,
      service: line.service,
      customer: names.get(line.customerId ?? '') ?? '',
    };
    const include = metric === 'revenue' || line.cost !== null;
    rows.push({
      ...base,
      id: line.id,
      ...(line.appointmentId &&
        line.actualVersion !== undefined && {
          costEntry: { appointmentId: line.appointmentId, version: line.actualVersion, costs: line.cost },
        }),
      ...(line.linkable ? { appointmentId: line.appointmentId, currentCustomer: line.currentCustomer } : {}),
      category: include ? line.kind : 'Awaiting cost',
      amount: include ? line.revenue : null,
    });
    if (metric !== 'revenue' && line.cost && line.kind === 'Service') {
      for (const key of ['staff', 'materials', 'tools'] as const) {
        rows.push({
          ...base,
          id: line.id + '-' + key,
          category: key[0].toUpperCase() + key.slice(1),
          amount: -line.cost[key],
        });
      }
    }
  }
  return rows.concat(metric === 'net' && !narrowed ? expenses : []);
}
