// @vitest-environment edge-runtime
import { asTestOwner, testMarketingGrantVersion } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
it.each(['manager', 'marketer', 'finance', 'viewer'] as const)('allows %s report reads, limits spend writes, and keeps operational data admin-only', async role => {
  const t = convexTest(schema, modules);
  const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
  const member = t.withIdentity({ emailVerified: true, email: 'member@example.com', tokenIdentifier: 'member' });
  const campaignId = await admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { name: 'Campaign', source: 'print', medium: 'qr' });
  await admin.mutation(api.marketing.access.setGrant, { expectedGrant: null, email: 'member@example.com', role });
  const range = { from: '2026-11-09', to: '2026-11-09', basis: 'cash' as const };
  await expect(member.query(api.marketing.report.getReport, range)).rejects.toThrow('Not authorized');
  await member.mutation(api.marketing.access.claimInvite, {});
  expect((await member.query(api.marketing.report.getReport, range)).sales).toEqual([]);
  expect(await member.query(api.marketing.report.listSpend, { campaignId })).toEqual([]);
  await expect(member.query(api.catalog.properties.adminList, {})).rejects.toThrow('Not authorized');
  const spend = { campaignId, amount: 50000, from: range.from, to: range.to };
  if (role === 'manager' || role === 'finance') {
    const id = await member.mutation(api.marketing.report.saveSpend, spend);
    expect(await member.query(api.marketing.report.listSpend, { campaignId })).toMatchObject([{ id, amount: 50000 }]);
    await member.mutation(api.marketing.report.deleteSpend, { id });
    expect(await member.query(api.marketing.report.listSpend, { campaignId })).toEqual([]);
  } else {
    await expect(member.mutation(api.marketing.report.saveSpend, spend)).rejects.toThrow('Not authorized');
    expect(await admin.query(api.marketing.report.listSpend, { campaignId })).toEqual([]);
  }
  await admin.mutation(api.marketing.access.setGrant, { expectedGrant: await testMarketingGrantVersion(admin, 'member@example.com'), email: 'member@example.com', role: null });
  await expect(member.query(api.marketing.report.getReport, range)).rejects.toThrow('Not authorized');
});
