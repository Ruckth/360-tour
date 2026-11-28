// @vitest-environment edge-runtime
import { asTestOwner } from '../testing/staff.test-support';
import { convexTest } from 'convex-test';
import { expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { convexToJson, jsonToConvex, type JSONValue } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import schema from '../schema';
import { emptyFilters } from '../shared/profitability';
import { resortMidnight } from '../shared/time';
import type { FunctionArgs } from 'convex/server';
import { readServiceFinanceFacts } from './private/serviceFinanceFacts';
import { ReadBudget, readBudget } from '../lib/readBudget';
import { profitVisitPage, profitVisits, recordAppointmentChange } from '../services/model';
import { serviceReceiptShares } from '../shared/serviceVat';

const modules = import.meta.glob('/convex/**/*.ts');
const finance = api.marketing.profitability;
const email = 'finance-test@example.com';
const nov = resortMidnight('2026-11-02');
const day = 86_400_000;
const baseScope = {
  from: '2026-11-01',
  to: '2026-11-30',
  overview: emptyFilters,
  additional: emptyFilters,
  search: '',
  category: '',
  descending: true,
};
const base = { ...baseScope, page: 0 };
const month = {
  month: '2026-11',
  overhead: 100_000,
  otherExpenses: 0,
  tax: 0,
  otherIncome: 0,
  expected: null,
  campaignIds: [],
};
async function setup() {
  const t = convexTest(schema, modules),
    user = await asTestOwner(t, { email, emailVerified: true, tokenIdentifier: 'owner' });
  const ids = await t.run(async (ctx) => {
    const staffId = await ctx.db.insert('staff', {
      name: 'Mali',
      role: 'Therapist',
      color: '#444',
      status: 'active',
      workingHours: [],
      breaks: [],
      createdAt: nov,
      updatedAt: nov,
    });
    const serviceId = await ctx.db.insert('services', {
      slug: 'a',
      name: 'Service A',
      description: '',
      category: 'Spa',
      durationMin: 60,
      bufferMin: 0,
      price: 10_700_000,
      currency: 'THB',
      staffIds: [staffId],
      status: 'active',
      createdAt: nov,
      updatedAt: nov,
    });
    const attendeeId = await ctx.db.insert('customers', {
      name: 'Customer One',
      createdBy: email,
      createdAt: nov,
      updatedAt: nov,
    });
    return { staffId, serviceId, attendeeId };
  });
  const query = (overrides: Partial<FunctionArgs<typeof finance.report>> = {}) =>
    user.query(finance.report, { ...base, ...overrides });
  return { t, user, ids, query };
}
async function deliver(
  ctx: MutationCtx,
  ids: { staffId: Id<'staff'>; serviceId: Id<'services'>; attendeeId?: Id<'customers'> },
  at = nov,
  price = 10_700_000,
  extra: Partial<Doc<'appointments'>> = {},
) {
  return ctx.db.insert('appointments', {
    ...ids,
    amountPaid: price,
    amountRefunded: 0,
    serviceNameSnapshot: 'Service A',
    staffNameSnapshot: 'Mali',
    start: at - 3600000,
    end: at,
    blockedUntil: at,
    guestName: 'Guest',
    guestPhone: '',
    guestPhoneDigits: '',
    source: 'admin',
    status: 'completed',
    paymentStatus: 'paid',
    price,
    currency: 'THB',
    paidAt: at,
    confirmationCode: 'SVC-' + at,
    accessToken: 'private',
    createdAt: at,
    ...extra,
  });
}
it('reconciles all five cards to recorded expenses, campaign spend and distinct customer history', async () => {
  const { t, user, ids, query } = await setup();
  const campaignId = await t.run(async (ctx) => {
    await deliver(ctx, ids);
    return ctx.db.insert('marketingCampaigns', {
      name: 'Search',
      source: 'google',
      medium: 'cpc',
      status: 'active',
      createdAt: nov,
      updatedAt: nov,
      updatedByEmail: email,
    });
  });
  const pending = await query();
  expect(pending.summary).toMatchObject({
    revenue: 10_000_000,
    missingCount: 1,
    gross: null,
    net: null,
    cac: null,
  });
  await user.mutation(finance.recordCosts, {
    serviceId: ids.serviceId,
    from: base.from,
    staff: 2_500_000,
    materials: 1_500_000,
    tools: 1_000_000,
    expected: null,
  });
  await user.mutation(api.marketing.report.saveSpend, {
    campaignId,
    from: base.from,
    to: base.to,
    amount: 200_000,
  });
  await user.mutation(finance.recordMonth, { ...month, campaignIds: [campaignId] });
  const { summary } = await query();
  expect(summary).toMatchObject({
    revenue: 10_000_000,
    gross: 5_000_000,
    net: 4_700_000,
    ltv: 10_000_000,
    cac: 200_000,
    newCount: 1,
    customerCount: 1,
  });
  for (const metric of ['revenue', 'gross', 'net', 'ltv', 'cac'] as const) {
    const detail = (await query({ metric })).detail!;
    expect(detail.sum).toBe(summary[metric]);
    expect(detail.people).toBe(metric === 'ltv' || metric === 'cac' ? 1 : 0);
  }
  const narrower = await query({ metric: 'gross', category: 'Materials' });
  expect(narrower.detail).toMatchObject({ count: 1, sum: -1_500_000 });
  expect(narrower.detail?.rows[0].ref).toContain('SVC');
});
it('preserves historical rates, refund timing and the October lifetime cutoff', async () => {
  const { t, user, ids, query } = await setup();
  await t.run(async (ctx) => {
    const visit = await deliver(ctx, ids, nov - 5 * day, 107_000, { amountRefunded: 53_500 });
    await ctx.db.insert('appointmentRefunds', {
      appointmentId: visit,
      amount: 53_500,
      currency: 'THB',
      method: 'cash',
      reason: 'Return',
      effectiveAt: nov,
      recordedAt: nov,
      recordedBy: email,
      idempotencyKey: 'refund',
      netBefore: 107_000,
      netAfter: 53_500,
    });
    await deliver(ctx, ids, nov + day, 214_000);
  });
  const first = await user.mutation(finance.recordCosts, {
    serviceId: ids.serviceId,
    from: '2026-10-01',
    expected: null,
    staff: 5_000,
    materials: 0,
    tools: 0,
  });
  const november = await user.mutation(finance.recordCosts, {
    serviceId: ids.serviceId,
    from: '2026-11-01',
    expected: first,
    reason: 'November costs',
    staff: 20_000,
    materials: 0,
    tools: 0,
  });
  expect(november).not.toBe(first);
  const october = await query({ from: '2026-10-01', to: '2026-10-31' });
  expect(october.summary).toMatchObject({ ltv: 100_000, revenue: 100_000, gross: 95_000, newCount: 1 });
  const later = await query();
  expect(later.summary).toMatchObject({ ltv: 250_000, revenue: 150_000, gross: 130_000, newCount: 0, cac: null });
  await expect(
    user.mutation(finance.recordCosts, {
      serviceId: ids.serviceId,
      from: '2026-11-01',
      expected: first,
      staff: 99,
      materials: 0,
      tools: 0,
    }),
  ).rejects.toThrow('changed');
});
it('applies inherited AND local OR rules and excludes anonymous sales from the ratio denominator', async () => {
  const { t, ids, query } = await setup();
  await t.run(async (ctx) => {
    await deliver(ctx, ids);
    await deliver(ctx, { staffId: ids.staffId, serviceId: ids.serviceId }, nov + day, 10_700, { source: 'web' });
  });
  const scoped = await query({
    metric: 'revenue',
    overview: {
      join: 'or',
      rules: [
        { field: 'source', operator: 'is', value: 'web' },
        { field: 'source', operator: 'is', value: 'line' },
      ],
    },
    additional: { join: 'and', rules: [{ field: 'revenue', operator: 'at most', value: 10_000 }] },
  });
  expect(scoped.summary).toMatchObject({
    count: 1,
    customerCount: 0,
    anonymous: 1,
    revenue: 10_000,
    ltv: null,
    net: null,
  });
  expect(scoped.detail).toMatchObject({ count: 1, sum: 10_000 });
});
it('denies anonymous and viewer writes, and refuses stale monthly edits', async () => {
  const { t, user, query } = await setup();
  await expect(t.query(finance.report, base)).rejects.toThrow();
  const viewerEmail = 'viewer@example.com';
  await t.run((ctx) =>
    ctx.db.insert('marketingGrants', {
      email: viewerEmail,
      tokenIdentifier: 'viewer',
      role: 'viewer',
      createdAt: nov,
      updatedAt: nov,
      updatedByEmail: email,
    }),
  );
  const viewer = t.withIdentity({ email: viewerEmail, emailVerified: true, tokenIdentifier: 'viewer' });
  await expect(viewer.query(finance.report, base)).rejects.toThrow();
  await expect(viewer.query(finance.financeInputs, { month: '2026-11', from: base.from })).rejects.toThrow();
  await expect(viewer.mutation(finance.recordMonth, month)).rejects.toThrow();
  const id = await user.mutation(finance.recordMonth, month);
  expect(await user.mutation(finance.recordMonth, month)).toBe(id);
  await expect(user.mutation(finance.recordMonth, { ...month, tax: 1 })).rejects.toThrow('changed');
  await expect(query({ from: '2026-01-01' })).rejects.toThrow('92');
});
it('keeps a 92-day report with 100 customers and 1000 deliveries within the shared read budget', async () => {
  const { t, user, ids, query } = await setup();
  await t.run(async (ctx) => {
    for (let c = 0; c < 100; c++) {
      const attendeeId = await ctx.db.insert('customers', {
        name: 'Test ' + c,
        createdAt: nov,
        createdBy: email,
        updatedAt: nov,
      });
      for (let n = 0; n < 10; n++) await deliver(ctx, { ...ids, attendeeId }, nov + n * day, 10_700);
    }
  });
  const data = await t.run(async (ctx) => {
    const result = await profitVisits(ctx, nov - 30 * day, nov + 62 * day);
    const { documents, ranges, bytes } = readBudget(ctx);
    return { count: result.lines.length, documents, ranges, bytes };
  });
  expect(data.count).toBe(1000);
  expect(data.ranges).toBeLessThan(125);
  expect(data.documents).toBeLessThan(2200);
  expect(data.bytes).toBeLessThan(4_000_000);
  await t.run(async (ctx) => {
    for (let i = 0; i < 600; i++)
      await ctx.db.insert('orders', {
        orderNumber: i,
        paidAt: nov,
        status: 'paid',
        hasItems: true,
        due: 0,
        total: 10700,
        itemCount: 1,
        currency: 'THB',
        revision: 1,
        createdBy: email,
        createdAt: nov,
        updatedAt: nov,
      });
  });
  const start = performance.now();
  const metrics = await t.run(async (ctx) => {
    const facts = await readServiceFinanceFacts(ctx, '2026-10-01', '2026-12-31', true);
    const { documents, ranges, bytes } = readBudget(ctx);
    return { rows: facts.lines.length, documents, ranges, bytes };
  });
  const openMs = Math.round(performance.now() - start);
  expect(metrics.ranges).toBeLessThan(140);
  expect(metrics.documents).toBeLessThan(3000);
  expect(metrics.bytes).toBeLessThan(3_000_000);
  const viewId = await user.mutation(api.marketing.profitViews.openView, {
    from: base.from,
    to: base.to,
    refresh: false,
  });
  const times = [];
  for (let page = 0; page < 10; page++) {
    const begin = performance.now();
    await query({ viewId, metric: 'revenue', page });
    times.push(performance.now() - begin);
  }
  const p95 = Math.ceil(times.sort((a, b) => a - b)[9]);
  console.info('Profitability fixture', JSON.stringify({ ...metrics, openMs, warmPageP95Ms: p95 }));
  expect(p95).toBeLessThan(1500);
  const result = await query({ viewId, metric: 'revenue', page: 2 });
  expect(result.detail).toMatchObject({ page: 2, count: 1000, sum: 10_000_000 });
  expect(result.detail?.rows).toHaveLength(25);
  expect(JSON.stringify(result).length).toBeLessThan(25_000);
});
it('holds a refund out of gross profit until its original delivery has finance costs', async () => {
  const { t, user, ids, query } = await setup();
  const id = await t.run((ctx) =>
    deliver(ctx, ids, nov - day * 5, 10700, { amountRefunded: 5350, refundedAt: nov }),
  );
  expect((await query()).summary).toMatchObject({ revenue: -5000, gross: null, net: null, missingCount: 1 });
  await user.mutation(finance.recordVisitCosts, {
    appointmentId: id,
    version: 0,
    staff: 3500,
    materials: 0,
    tools: 0,
    reason: 'Verified payroll',
  });
  expect((await query()).summary).toMatchObject({ revenue: -5000, gross: -5000, missingCount: 0 });
  await expect(
    user.mutation(finance.recordVisitCosts, {
      appointmentId: id,
      version: 0,
      staff: 1,
      materials: 0,
      tools: 0,
      reason: 'Stale change',
    }),
  ).rejects.toThrow('changed');
});
it('freezes the cost version on completion and preserves an open view across finance revisions', async () => {
  const { t, user, ids, query } = await setup();
  const rates = { serviceId: ids.serviceId, from: base.from, staff: 1000, materials: 100, tools: 50 };
  const version = await user.mutation(finance.recordCosts, { ...rates, expected: null });
  const id = await t.run(async (ctx) => {
    const id = await deliver(ctx, ids, nov, 10700, { status: 'booked' });
    const visit = (await ctx.db.get(id))!;
    await recordAppointmentChange(ctx, visit, { status: 'completed' }, { actor: email, kind: 'status' });
    return id;
  });
  expect((await query()).summary.gross).toBe(8850);
  const viewId = await user.mutation(api.marketing.profitViews.openView, {
    from: base.from,
    to: base.to,
    refresh: false,
  });
  await user.mutation(finance.recordCosts, {
    ...rates,
    expected: version,
    staff: 2000,
    reason: 'New estimated rate',
  });
  expect((await query()).summary.gross).toBe(8850);
  await user.mutation(finance.recordVisitCosts, {
    appointmentId: id,
    version: 0,
    staff: 2000,
    materials: 100,
    tools: 50,
    reason: 'Verified payroll',
  });
  const grossScope = { ...baseScope, viewId, metric: 'gross' as const };
  const preparedViewId = await user.mutation(finance.prepareTransactions, grossScope);
  expect((await query({ ...grossScope, preparedViewId, exportRows: true })).detail?.sum).toBe(8850);
  expect((await query({ metric: 'gross' })).detail?.sum).toBe(7850);
  await expect(query({ viewId, to: '2026-11-15' })).rejects.toThrow('expired');
  await t.run((ctx) => ctx.db.patch(viewId, { expiresAt: 0 }));
  await expect(query({ viewId })).rejects.toThrow('expired');
});
it('shows all unclassified spend and requires an explicit service or outside-business classification', async () => {
  const { t, user, ids, query } = await setup();
  const campaign = await t.run(async (ctx) => {
    await deliver(ctx, ids, nov, 10700, { actualCosts: { staff: 100, materials: 0, tools: 0, version: 1 } });
    return ctx.db.insert('marketingCampaigns', {
      name: 'Unmapped search',
      source: 'search',
      medium: 'paid',
      status: 'active',
      createdAt: nov,
      updatedAt: nov,
      updatedByEmail: email,
    });
  });
  await user.mutation(api.marketing.report.saveSpend, {
    campaignId: campaign,
    from: base.from,
    to: base.to,
    amount: 200,
  });
  const revision = await user.mutation(finance.recordMonth, { ...month, overhead: 0 });
  const report = await query({ metric: 'cac' });
  expect(report.summary).toMatchObject({ unmappedSpend: 200, cac: null, net: null });
  expect(report.detail?.rows).toContainEqual(expect.objectContaining({ category: 'Unmapped spend', amount: 200 }));
  await user.mutation(finance.recordMonth, {
    ...month,
    overhead: 0,
    expected: revision,
    excludedCampaignIds: [campaign],
    reason: 'Hotel-only campaign',
  });
  expect((await query()).summary).toMatchObject({ unmappedSpend: 0, cac: 0, net: 9900 });
});
it('protects names, entry, profile changes, exports and snapshots on direct calls', async () => {
  const { t, user, ids } = await setup();
  const id = await t.run((ctx) => deliver(ctx, ids));
  const range = { from: base.from, to: base.to, refresh: false };
  const namedView = await user.mutation(api.marketing.profitViews.openView, range);
  const manager = t.withIdentity({
    email: 'manager@company.test',
    tokenIdentifier: 'manager',
    emailVerified: true,
  });
  await t.run((ctx) =>
    ctx.db.insert('marketingGrants', {
      email: 'manager@company.test',
      role: 'manager',
      tokenIdentifier: 'manager',
      createdAt: nov,
      updatedAt: nov,
      updatedByEmail: email,
    }),
  );
  const privateView = await manager.mutation(api.marketing.profitViews.openView, range);
  const detail = await manager.query(finance.report, { ...base, viewId: privateView, metric: 'ltv' });
  expect(JSON.stringify(detail)).not.toContain('Customer One');
  expect(detail.detail?.rows[0].ref).toBe('Attendee 1');
  const managerRows = await manager.query(finance.report, { ...base, viewId: privateView, metric: 'revenue' });
  expect(managerRows.detail?.rows[0]).toMatchObject({ id: 'record-1', ref: 'Record 1', customer: 'Attendee 1' });
  expect(JSON.stringify(managerRows)).not.toContain(id);
  expect(JSON.stringify(managerRows)).not.toContain('SVC-' + nov);
  const financeRows = await user.query(finance.report, { ...base, viewId: namedView, metric: 'revenue' });
  expect(financeRows.detail?.rows[0]).toMatchObject({ id, ref: 'SVC-' + nov });
  await expect(manager.query(finance.report, { ...base, viewId: namedView })).rejects.toThrow('access');
  await expect(manager.query(finance.report, { ...base, viewId: privateView, exportRows: true })).rejects.toThrow(
    'export',
  );
  await expect(manager.query(finance.financeInputs, { month: month.month, from: base.from })).rejects.toThrow();
  await expect(manager.query(finance.findCustomers, { name: 'Customer' })).rejects.toThrow();
  await expect(manager.mutation(finance.recordMonth, month)).rejects.toThrow();
  await expect(
    manager.mutation(finance.identifyCustomer, { appointmentId: id, expected: null, customerId: ids.attendeeId }),
  ).rejects.toThrow();
  await expect(
    manager.mutation(finance.recordVisitCosts, {
      appointmentId: id,
      version: 0,
      staff: 0,
      materials: 0,
      tools: 0,
      reason: 'test',
    }),
  ).rejects.toThrow();
});
it('supports any-of values within an AND rule group and allocates receipt VAT to the satang', async () => {
  const { t, ids, query } = await setup();
  await t.run(async (ctx) => {
    await deliver(ctx, ids);
    await deliver(ctx, ids, nov + day, 10700, { source: 'line' });
  });
  const report = await query({
    overview: {
      join: 'and',
      rules: [
        { field: 'source', operator: 'is', value: ['admin', 'web'] },
        { field: 'service', operator: 'is', value: [ids.serviceId] },
      ],
    },
  });
  expect(report.summary.count).toBe(1);
  expect(serviceReceiptShares([8, 8, 0])).toEqual([1, 0, 0]);
});
it('preserves ratios before a merge and combines lifetime history after its effective day', async () => {
  const { t, ids, query } = await setup();
  await t.run(async (ctx) => {
    const source = await ctx.db.insert('customers', {
      name: 'Merged attendee',
      createdBy: email,
      createdAt: nov,
      updatedAt: nov,
      mergedInto: ids.attendeeId,
      mergedAt: nov + day * 34,
    });
    await deliver(ctx, ids, nov, 10700);
    await deliver(ctx, { ...ids, attendeeId: source }, nov + day, 21400);
    await deliver(ctx, ids, nov + day * 38, 10700);
  });
  expect((await query()).summary).toMatchObject({ customerCount: 2, ltv: 15000, newCount: 2 });
  expect((await query({ from: '2026-12-01', to: '2026-12-31' })).summary).toMatchObject({
    customerCount: 1,
    ltv: 40000,
    newCount: 0,
  });
});
it('permits November net when a zero-value settlement belongs to an uncosted October delivery', async () => {
  const { t, user, ids, query } = await setup();
  await t.run((ctx) => deliver(ctx, ids, nov - day * 5, 10700, { paidAt: nov }));
  await user.mutation(finance.recordMonth, { ...month, overhead: 0 });
  expect((await query()).summary).toMatchObject({ gross: 0, net: 0, missingCount: 0, newCount: 1 });
});
it('lets a finance grant enter accounts and export without an operations role', async () => {
  const { t, ids } = await setup();
  const email = 'accounts@company.test',
    tokenIdentifier = 'accounts';
  const financeUser = t.withIdentity({ email, emailVerified: true, tokenIdentifier });
  const visit = await t.run(async (ctx) => {
    await ctx.db.insert('marketingGrants', {
      email,
      tokenIdentifier,
      role: 'finance',
      createdAt: nov,
      updatedAt: nov,
      updatedByEmail: email,
    });
    return deliver(ctx, ids, nov, 10700);
  });
  expect((await financeUser.query(api.auth.staffAccess.myAccess, {})).role).toBeNull();
  const inputs = await financeUser.query(finance.financeInputs, { month: month.month, from: base.from });
  expect(inputs.services.map((service) => service.id)).toContain(ids.serviceId);
  await financeUser.mutation(finance.recordCosts, {
    serviceId: ids.serviceId,
    from: base.from,
    staff: 10,
    materials: 0,
    tools: 0,
    expected: null,
  });
  await financeUser.mutation(finance.recordVisitCosts, {
    appointmentId: visit,
    version: 0,
    staff: 20,
    materials: 0,
    tools: 0,
    reason: 'Payroll record',
  });
  await financeUser.mutation(finance.recordMonth, { ...month, overhead: 35 });
  const viewId = await financeUser.mutation(api.marketing.profitViews.openView, {
    from: base.from,
    to: base.to,
    refresh: false,
  });
  const scope = { ...baseScope, viewId, metric: 'net' as const };
  const preparedViewId = await financeUser.mutation(finance.prepareTransactions, scope);
  const result = await financeUser.query(finance.report, {
    ...scope, page: 0, preparedViewId, exportRows: true, includeCustomer: true,
  });
  expect(result.summary.net).toBe(9945);
  expect(result.detail?.sum).toBe(9945);
  expect(result.detail?.rows.some((r) => r.customer === 'Customer One')).toBe(true);
});

it('exports matching evidence without identifying customers unless finance opts in', async () => {
  const { t, user, ids, query } = await setup();
  await t.run((ctx) => deliver(ctx, ids));
  const viewId = await user.mutation(api.marketing.profitViews.openView, {
    from: base.from,
    to: base.to,
    refresh: false,
  });
  const args = {
    viewId,
    metric: 'ltv' as const,
    category: 'Lifetime revenue',
    search: 'Customer One',
  };
  const supporting = await query(args);
  const preparedViewId = await user.mutation(finance.prepareTransactions, { ...baseScope, ...args });
  const operational = await query({ ...args, preparedViewId, exportRows: true });
  const identifiable = await query({
    ...args,
    preparedViewId,
    exportRows: true,
    includeCustomer: true,
  });
  expect(operational.asOf).toBe(supporting.asOf);
  expect(operational.detail).toMatchObject({
    count: 1,
    sum: supporting.detail?.sum,
  });
  expect(operational.detail?.rows[0]).toMatchObject({
    ref: '',
    customer: '',
    amount: supporting.detail?.sum,
  });
  expect(identifiable.detail?.rows[0]).toMatchObject({
    ref: 'Customer One',
    customer: 'Customer One',
  });
});

it('locates the schedule before and after the effective date for the selected service', async () => {
  const { user, ids } = await setup();
  const args = { serviceId: ids.serviceId, staff: 100, materials: 0, tools: 0 };
  const first = await user.mutation(finance.recordCosts, {
    ...args,
    from: '2026-11-01',
    expected: null,
  });
  await user.mutation(finance.recordCosts, {
    ...args,
    from: '2026-11-20',
    expected: first,
    reason: 'Upcoming',
  });
  const scope = {
    from: '2026-11-08',
    month: '2026-11',
    serviceId: ids.serviceId,
  };
  expect(await user.query(finance.financeInputs, scope)).toMatchObject({
    schedule: { from: '2026-11-01' },
    nextScheduleFrom: '2026-11-20',
  });
  await user.mutation(finance.recordCosts, {
    ...args,
    from: scope.from,
    expected: first,
    reason: 'Correction',
  });
  expect(await user.query(finance.financeInputs, scope)).toMatchObject({
    schedule: { from: scope.from },
    nextScheduleFrom: '2026-11-20',
  });
});

async function seedMaturePagingReport() {
  const { t, ids } = await setup();
  const identity = {
    email: 'report-paging@example.com',
    emailVerified: true,
    tokenIdentifier: 'profit-paging',
  };
  const financeUser = t.withIdentity(identity);
  const { from, to } = { from: '2026-09-01', to: '2026-12-01' };
  const grant = await t.run((ctx) => ctx.db.insert('marketingGrants', {
    email: identity.email, tokenIdentifier: identity.tokenIdentifier, role: 'finance',
    updatedByEmail: email, createdAt: nov, updatedAt: nov,
  }));
  const historical: Id<'customers'>[] = [];
  {
    for (let offset = 0; offset < 4_001; offset += 250)
      historical.push(...await t.run(async (ctx) => {
        const batch = [];
        for (let index = offset; index < Math.min(offset + 250, 4_001); index++)
          batch.push(await ctx.db.insert('customers', {
            name: 'Earlier unrelated attendee ' + index, createdAt: nov - 170 * day, updatedAt: nov - 170 * day, createdBy: email,
          }));
        return batch;
      }));
  }
  const attendees: Id<'customers'>[] = [];
  for (let offset = 0; offset < 2001; offset += 250) {
    attendees.push(...await t.run(async (ctx) => {
      const batch = [];
      for (let index = offset; index < Math.min(offset + 250, 2001); index++) {
        batch.push(await ctx.db.insert('customers', {
          name: 'Named attendee ' + index, createdAt: nov, updatedAt: nov, createdBy: email,
        }));
      }
      return batch;
    }));
  }
  {
    const periodStart = resortMidnight(from);
    for (let offset = 0; offset < historical.length; offset += 250)
      await t.run(async (ctx) => {
        for (let index = offset; index < Math.min(offset + 250, historical.length); index++) {
          const at = periodStart - (index % 120 + 1) * day;
          await deliver(ctx, { ...ids, attendeeId: index % 2 ? historical[index] : attendees[index % attendees.length] },
            at, 107, { confirmationCode: 'OLD-' + index, receiptVatShare: 7,
              ...(index === 0 && { paidAt: periodStart }),
            });
        }
      });
  }
  const lines: { id: Id<'appointments'>; day: string; ref: string; customer: string }[] = [];
  for (let offset = 0; offset < 10_000; offset += 250) {
    lines.push(...await t.run(async (ctx) => {
      const batch = [];
      for (let index = offset; index < offset + 250; index++) {
        const at = resortMidnight(from) + (index % 92) * day;
        const legacyReceipt = index % 200 === 0;
        const id = await deliver(ctx, { ...ids, attendeeId: attendees[index % attendees.length] }, at, 107, {
          confirmationCode: 'PERF-' + index,
          paidBy: email,
          receiptVatShare: legacyReceipt ? undefined : 7,
        });
        {
          const orderId = await ctx.db.insert('orders', {
            status: 'paid', orderNumber: index + 1, currency: 'THB', itemCount: 1, total: 107, due: 0,
            hasItems: true, revision: 0, paidAt: at, createdAt: at, updatedAt: at, createdBy: email,
          });
          await ctx.db.insert('orderLines', {
            orderId, kind: 'service', serviceId: ids.serviceId, appointmentId: id,
            name: 'Service A', unitPrice: 107, catalogUnitPrice: 107, qty: 1, currency: 'THB', createdAt: at,
          });
        }
        batch.push({
          id, day: new Date(at + 7 * 3600_000).toISOString().slice(0, 10),
          ref: 'PERF-' + index, customer: 'Named attendee ' + (index % attendees.length),
        });
      }
      return batch;
    }));
  }
  return { t, financeUser, grant, from, to, lines };
}

it('assembles a mature 10,000-visit source with all financial history at one pinned timestamp', async () => {
  const { t, financeUser, from, to, grant, lines } = await seedMaturePagingReport();
  const readCounts = await t.run(async (ctx) => {
    await expect(readServiceFinanceFacts(ctx, from, to, true)).rejects.toThrow('reads too much data');
    const { bytes, documents, ranges } = readBudget(ctx);
    return { bytes, documents, ranges };
  });
  console.info('Mature source needs bounded pages', readCounts);

  const calls: { ts: string; batch: string }[] = [];
  const origin = 'http://127.0.0.1:4270';
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubEnv('CONVEX_CLOUD_URL', origin);
  vi.stubGlobal('fetch', async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
    expect(url.origin).toBe(origin);
    if (url.pathname === '/api/query_ts') return Response.json({ ts: 'pinned-finance-test' });
    expect(url.pathname).toBe('/api/query_at_ts');
    const body = JSON.parse(String(options?.body)) as { args: [JSONValue]; ts: string; path: string };
    expect(body.path).toBe('marketing/profitViews:sourceBatch');
    const args = jsonToConvex(body.args[0]) as FunctionArgs<typeof api.marketing.profitViews.sourceBatch>;
    calls.push({ ts: body.ts, batch: args.batch });
    const result = await t.query(api.marketing.profitViews.sourceBatch, args);
    return Response.json({ status: 'success', value: convexToJson(result) });
  });
  try {
    const viewId = await financeUser.mutation(api.marketing.profitViews.openView, { from, to, refresh: true });
    const job = await t.run(async (ctx) => {
      const tasks = await ctx.db.system.query('_scheduled_functions').take(10);
      return tasks.find((task) => task.name === 'marketing/profitViews:buildLargeSource');
    });
    expect(job).toBeDefined();
    const input = job!.args[0] as FunctionArgs<typeof internal.marketing.profitViews.buildLargeSource>;
    expect(input.id).toBe(viewId);
    await expect(financeUser.query(api.marketing.profitViews.sourceStatus, { id: viewId })).resolves.toBe('building');
    await expect(t.query(api.marketing.profitViews.sourceBatch, { id: viewId, key: 'x'.repeat(72), batch: 'visits', lane: 0, cursor: null }))
      .rejects.toThrow('access expired');
    const buildStart = performance.now();
    await t.action(internal.marketing.profitViews.buildLargeSource, input);
    const buildMs = performance.now() - buildStart;
    expect(calls[0]?.batch).toBe('extras');
    expect(calls.filter((call) => call.batch === 'visits').length).toBeGreaterThan(1);
    expect(new Set(calls.map((call) => call.ts))).toEqual(new Set(['pinned-finance-test']));
    expect(await financeUser.query(api.marketing.profitViews.sourceStatus, { id: viewId })).toBe('ready');
    await expect(t.query(api.marketing.profitViews.sourceBatch, { ...input, batch: 'visits', lane: 0, cursor: null }))
      .rejects.toThrow('access expired');

    const scope = { ...baseScope, from, to, viewId, metric: 'revenue' as const };
    const preparedViewId = await financeUser.mutation(finance.prepareTransactions, scope);
    const page = (number: number) => financeUser.query(finance.report, { ...scope, preparedViewId, page: number });
    const durations = [];
    const chronological = [...lines].sort((a, b) => b.day.localeCompare(a.day) || b.id.localeCompare(a.id));
    let maxBytes = 0;
    const documentReads = vi.spyOn(ReadBudget.prototype, 'document');
    try {
      for (let number = 0; number < 30; number++) {
        const start = performance.now();
        const result = await page(number);
        durations.push(performance.now() - start);
        maxBytes = Math.max(maxBytes, new TextEncoder().encode(JSON.stringify(result)).length);
        expect(result.summary).toMatchObject({
          revenue: 1_000_000, lifetime: 1_200_100, customerCount: 2001, newCount: 1, ltv: 600,
        });
        expect(result.detail).toMatchObject({ page: number, count: 10_001, sum: 1_000_000 });
        expect(result.detail?.rows.map((row) => row.id))
          .toEqual(chronological.slice(number * 25, (number + 1) * 25).map((row) => row.id));
      }
      const payloads = documentReads.mock.calls.map(([doc]) => doc as Doc<'serviceProfitViewChunks'>);
      expect(payloads).toHaveLength(60);
      const evidenceRowCounts = payloads.filter((part) => part.sequence >= 0)
        .map((part) => (JSON.parse(part.payload) as unknown[]).length);
      expect(evidenceRowCounts).toHaveLength(30);
      expect(Math.max(...evidenceRowCounts)).toBeLessThanOrEqual(125);
    } finally {
      documentReads.mockRestore();
    }
    const p95 = durations.sort((a, b) => a - b)[28]!;
    expect(p95).toBeLessThanOrEqual(400);
    expect(maxBytes).toBeLessThanOrEqual(128 * 1024);
    console.info('Mature profitability snapshot through pinned HTTP protocol test transport', {
      buildMs, sourcePages: calls.length - 1, p95, maxBytes, evidenceRowsPerPage: 25,
    });
    const exportPage = (number: number, includeCustomer?: boolean) =>
      financeUser.query(finance.report, { ...scope, preparedViewId, page: number, exportRows: true, includeCustomer });
    const clamped = await page(500);
    expect(clamped.detail).toMatchObject({ page: 400, count: 10_001 });
    const last = clamped.detail!.rows[0];
    const operational = await exportPage(400);
    const identifiable = await exportPage(400, true);
    expect(operational.detail?.rows).toEqual([expect.objectContaining({ ref: '', customer: '', id: 'export-10001' })]);
    expect(identifiable.detail?.rows).toEqual([expect.objectContaining({
      ref: last.ref, customer: last.customer, id: 'export-10001',
    })]);
    await expect(exportPage(401)).rejects.toThrow('Invalid export page.');
    await t.run((ctx) => ctx.db.patch(grant, { role: 'manager' }));
    await expect(financeUser.query(api.marketing.profitViews.sourceStatus, { id: viewId })).resolves.toBe('expired');
    await expect(page(0)).rejects.toThrow('access');
    await expect(exportPage(1)).rejects.toThrow('export');
    await expect(exportPage(1, true)).rejects.toThrow('export');
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  }
}, 150_000);

it('exports each matching source row across all pages in both privacy modes', async () => {
  const { t, user, ids, query } = await setup();
  await t.run(async (ctx) => {
    for (let index = 0; index < 81; index++)
      await deliver(ctx, ids, nov + index, 107, { confirmationCode: 'PAY-' + index });
    await deliver(ctx, ids, nov, 107, { confirmationCode: 'Outside search' });
  });
  const viewId = await user.mutation(api.marketing.profitViews.openView, {
    from: base.from, to: base.to, refresh: false,
  });
  const scope = {
    from: base.from, to: base.to, viewId, overview: emptyFilters, additional: emptyFilters,
    metric: 'revenue' as const, search: 'PAY-', category: 'Service', descending: true,
  };
  const preparedViewId = await user.mutation(finance.prepareTransactions, scope);
  for (const includeCustomer of [undefined, true]) {
    const rows = [];
    for (let page = 0; page < 4; page++) {
      const result = await query({ ...scope, preparedViewId, page, exportRows: true, includeCustomer });
      expect(result.detail).toMatchObject({ count: 81, sum: 8100, page });
      rows.push(...result.detail!.rows);
    }
    expect(rows).toHaveLength(81);
    expect(rows.reduce((total, row) => total + (row.amount ?? 0), 0)).toBe(8100);
    expect(new Set(rows.map((row) => row.id)).size).toBe(81);
    expect(new Set(rows.map((row) => row.customer))).toEqual(new Set([includeCustomer ? 'Customer One' : '']));
    expect(rows.filter((row) => Boolean(row.ref))).toHaveLength(includeCustomer ? 81 : 0);
    expect(rows.every((row) => !row.appointmentId && !row.costEntry)).toBe(true);
  }
});

it('keeps partial-month expenses and midnight deliveries inside their Bangkok evidence window', async () => {
  const { t, user, ids, query } = await setup();
  await user.mutation(finance.recordMonth, { ...month, overhead: 30_000 });
  const from = '2026-11-10';
  const to = '2026-11-11';
  const boundary = resortMidnight(from);
  await t.run(async (ctx) => {
    await deliver(ctx, ids, boundary - 1, 10700, { actualCosts: { staff: 0, materials: 0, tools: 0, version: 1 } });
    await deliver(ctx, ids, boundary, 10700, { actualCosts: { staff: 0, materials: 0, tools: 0, version: 1 } });
  });
  const net = await query({ from, to, metric: 'net' });
  expect(net.summary.net).toBe(8000);
  expect(net.detail?.sum).toBe(8000);
  expect(net.detail?.rows.find((row) => row.category === 'Overhead')).toMatchObject({ day: from, amount: -2000 });
  expect(net.detail?.rows.filter((row) => row.category === 'Service')).toMatchObject([{ day: from, amount: 10000 }]);
});

it('keeps at most three prepared scopes per source and drains multi-batch scopes before rollback', async () => {
  const { t, user, ids, query } = await setup();
  const expiry = internal.marketing.profitViews.expireView;
  const drain = internal.marketing.profitViews.drainPreparedViews;
  vi.useFakeTimers();
  try {
    await t.run(async (ctx) => {
      for (let i = 0; i < 810; i++) await deliver(ctx, ids, nov, 107, { confirmationCode: 'Scope ' + i });
    });
    const viewId = await user.mutation(api.marketing.profitViews.openView, {
      from: base.from, to: base.to, refresh: false,
    });
    const scope = {
      from: base.from, to: base.to, overview: emptyFilters, additional: emptyFilters, descending: true,
      search: '', category: '', viewId, metric: 'revenue' as const,
    };
    const first = await user.mutation(finance.prepareTransactions, scope);
    await user.mutation(finance.prepareTransactions, { ...scope, category: 'Service' });
    await user.mutation(finance.prepareTransactions, { ...scope, search: 'Scope' });
    const last = await user.mutation(finance.prepareTransactions, { ...scope, descending: false });
    await expect(query({ ...scope, preparedViewId: first })).rejects.toThrow('expired');
    expect((await query({ ...scope, descending: false, preparedViewId: last })).detail?.count).toBe(810);
    const chunks = (id: Id<'serviceProfitViews'>) => t.run(async (ctx) =>
      (await ctx.db.query('serviceProfitViewChunks')
        .withIndex('by_view', (q) => q.eq('viewId', id)).take(100)).length,
    );
    expect(await chunks(first)).toBeGreaterThan(32);
    await t.mutation(expiry, { id: first });
    expect(await chunks(first)).toBeGreaterThan(0);
    await t.mutation(expiry, { id: first });
    expect(await chunks(first)).toBe(0);

    await expect(t.mutation(drain, {})).rejects.toThrow('Pause profitability preparation');
    vi.stubEnv('PROFIT_PREPARATION_PAUSED', '1');
    await expect(user.mutation(finance.prepareTransactions, scope)).rejects.toThrow('paused');
    let complete = false;
    for (let pass = 0; !complete && pass < 10; pass++) complete = await t.mutation(drain, {});
    expect(complete).toBe(true);
    expect(await chunks(last)).toBe(0);
    expect(await chunks(viewId)).toBeGreaterThan(0);
    await expect(query({ ...scope, descending: false, preparedViewId: last })).rejects.toThrow('expired');
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await chunks(viewId)).toBe(0);
  } finally {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  }
}, 45_000);

it('projects disjoint visit pages with exact merged history, period refunds and range boundaries', async () => {
  const { t, ids } = await setup();
  const start = nov;
  const end = nov + day;
  await t.run(async (ctx) => {
    const mergedId = await ctx.db.insert('customers', {
      name: 'Merged attendee', mergedInto: ids.attendeeId, mergedAt: start,
      createdBy: email, createdAt: nov, updatedAt: nov,
    });
    for (let index = 0; index < 70; index++) {
      await deliver(ctx, { ...ids, attendeeId: mergedId }, start - day, 107, {
        amountRefunded: index === 0 ? 53 : 0,
        refundedAt: index === 0 ? start : undefined,
      });
    }
    await deliver(ctx, ids, start, 214);
    await deliver(ctx, ids, start, 107, { currency: 'USD' });
    await deliver(ctx, ids, start, 107, { status: 'cancelled' });
    await deliver(ctx, ids, end, 107);
  });
  const full = await t.run((ctx) => profitVisits(ctx, start, end));
  const first = await t.run((ctx) => profitVisitPage(ctx, start, end, null));
  expect(first.cursor).not.toBeNull();
  const last = await t.run((ctx) => profitVisitPage(ctx, start, end, first.cursor));
  expect(last.cursor).toBeNull();
  expect([...first.lines, ...last.lines].sort((a, b) => a.id.localeCompare(b.id))).toEqual(
    full.lines.sort((a, b) => a.id.localeCompare(b.id)),
  );
  expect(full.lines.map((row) => row.kind).sort()).toEqual(['Refund', 'Service']);
  expect(full.excludedCurrency).toBe(1);
  expect(first.excludedCurrency + last.excludedCurrency).toBe(full.excludedCurrency);
  const history = [...first.customers, ...last.customers];
  expect(history.map((customer) => customer.id)).toEqual([ids.attendeeId, ids.attendeeId]);
  expect(full.customers).toEqual([{
    id: ids.attendeeId,
    name: 'Customer One',
    lifetime: history.reduce((sum, customer) => sum + customer.lifetime, 0),
    firstDay: history.flatMap((customer) => customer.firstDay ?? []).sort()[0],
  }]);
});
