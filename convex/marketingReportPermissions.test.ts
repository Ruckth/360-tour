// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const setGrant = makeFunctionReference<'mutation', { email: string; role: 'manager' | 'marketer' | 'finance' | 'viewer' | null }, null>('marketingAccess:setGrant');
const claimInvite = makeFunctionReference<'mutation', Record<string, never>, null>('marketingAccess:claimInvite');
afterEach(() => vi.unstubAllEnvs());

it.each(['manager', 'marketer', 'finance', 'viewer'] as const)('allows %s report reads, limits spend writes, and keeps operational data admin-only', async role => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const member = t.withIdentity({ email: 'member@example.com', tokenIdentifier: 'member' });
  const campaignId = await admin.mutation(api.marketing.saveCampaign, { name: 'Campaign', source: 'print', medium: 'qr' });
  await admin.mutation(setGrant, { email: 'member@example.com', role });
  const range = { from: '2026-11-09', to: '2026-11-09', basis: 'cash' as const };
  await expect(member.query(api.marketingReport.getReport, range)).rejects.toThrow('Not authorized');
  await member.mutation(claimInvite, {});
  expect((await member.query(api.marketingReport.getReport, range)).sales).toEqual([]);
  expect(await member.query(api.marketingReport.listSpend, { campaignId })).toEqual([]);
  await expect(member.query(api.properties.adminList, {})).rejects.toThrow('Not authorized');
  const spend = { campaignId, amount: 50000, from: range.from, to: range.to };
  if (role === 'manager' || role === 'finance') {
    const id = await member.mutation(api.marketingReport.saveSpend, spend);
    expect(await member.query(api.marketingReport.listSpend, { campaignId })).toMatchObject([{ id, amount: 50000 }]);
    await member.mutation(api.marketingReport.deleteSpend, { id });
    expect(await member.query(api.marketingReport.listSpend, { campaignId })).toEqual([]);
  } else {
    await expect(member.mutation(api.marketingReport.saveSpend, spend)).rejects.toThrow('Not authorized');
    expect(await admin.query(api.marketingReport.listSpend, { campaignId })).toEqual([]);
  }
  await admin.mutation(setGrant, { email: 'member@example.com', role: null });
  await expect(member.query(api.marketingReport.getReport, range)).rejects.toThrow('Not authorized');
});
