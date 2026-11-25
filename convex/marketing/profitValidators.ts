import { v } from 'convex/values';

const amount = v.union(v.number(), v.null());
const costs = v.object({ staff: v.number(), materials: v.number(), tools: v.number() });
const total = {
  count: v.number(),
  revenue: v.number(),
  gross: amount,
  missingCount: v.number(),
  coveredRevenue: v.number(),
  costs,
};
const row = v.object({
  id: v.string(),
  day: v.string(),
  ref: v.string(),
  category: v.string(),
  service: v.string(),
  customer: v.string(),
  amount,
  basis: v.optional(v.string()),
  appointmentId: v.optional(v.id('appointments')),
  currentCustomer: v.optional(v.union(v.id('customers'), v.null())),
  costEntry: v.optional(
    v.object({ appointmentId: v.id('appointments'), version: v.number(), costs: v.union(costs, v.null()) }),
  ),
});
export const profitReportResult = v.object({
  asOf: v.number(),
  summary: v.object({
    ...total,
    net: amount,
    ltv: amount,
    cac: amount,
    customerCount: v.number(),
    newCount: v.number(),
    lifetime: v.number(),
    spend: v.number(),
    unmappedSpend: v.number(),
    anonymous: v.number(),
  }),
  breakdown: v.array(v.object({ id: v.string(), name: v.string(), ...total })),
  expenses: v.array(v.object({ kind: v.string(), amount: v.number() })),
  excludedCurrency: v.number(),
  missingMonths: v.array(v.string()),
  services: v.array(v.object({ id: v.string(), name: v.string() })),
  sources: v.array(v.string()),
  detail: v.union(
    v.null(),
    v.object({
      value: amount,
      categories: v.array(v.string()),
      sum: v.number(),
      people: v.number(),
      displayedRatio: amount,
      count: v.number(),
      page: v.number(),
      pageSize: v.number(),
      rows: v.array(row),
    }),
  ),
});
