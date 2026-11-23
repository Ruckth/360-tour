// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import schema from '../schema';
import { emptyFilters } from '../shared/profitability';
import { resortMidnight } from '../shared/time';
import type { FunctionArgs } from 'convex/server';
import { readBudget } from '../lib/readBudget';
import { profitVisits } from '../services/model';

const modules = import.meta.glob('/convex/**/*.ts');
const finance = api.marketing.profitability;
const email = 'finance-test@example.com';
const nov = resortMidnight('2026-11-02');
const day = 86_400_000;
const base = {
  from: '2026-11-01',
  to: '2026-11-30',
  overview: emptyFilters,
  additional: emptyFilters,
  search: '',
  category: '',
  page: 0,
  descending: true,
};
const month = {
  month: '2026-11',
  overhead: 100_000,
  otherExpenses: 0,
  tax: 0,
  otherIncome: 0,
  expected: null,
  campaignIds: [],
};
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  vi.stubEnv('ADMIN_EMAILS', email);
  const t = convexTest(schema, modules),
    user = t.withIdentity({ email, emailVerified: true, tokenIdentifier: 'owner' });
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
  const { t, ids, query } = await setup();
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
  expect(data.ranges).toBeLessThan(420);
  expect(data.documents).toBeLessThan(2500);
  expect(data.bytes).toBeLessThan(4_000_000);
  const result = await query({ metric: 'revenue', page: 2 });
  expect(result.detail).toMatchObject({ page: 2, count: 1000, sum: 10_000_000 });
  expect(result.detail?.rows).toHaveLength(25);
});
