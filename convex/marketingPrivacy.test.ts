// @vitest-environment edge-runtime
import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
it.each(['viewer', 'marketer', 'finance', 'manager', 'admin'] as const)('protects live partner notes and credit history for %s', async role => {
  const t = convexTest(schema, modules);
  const admin = await asTestOwner(t, { emailVerified: true, email: 'private-actor@example.com', tokenIdentifier: 'admin' });
  const reader = role === 'admin' ? admin : t.withIdentity({ emailVerified: true, email: 'reader@example.com', tokenIdentifier: 'reader' });
  const full = ['admin', 'finance', 'manager'].includes(role);
  if (role !== 'admin') await t.run(ctx => ctx.db.insert('marketingGrants', {
    email: 'reader@example.com', tokenIdentifier: 'reader', role, createdAt: 1, updatedAt: 1, updatedByEmail: 'private-actor@example.com'
  }));
  const campaignId = await admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { name: 'Partner campaign', source: 'partner', medium: 'affiliate' });
  const affiliateId = await admin.mutation(api.marketing.commands.saveAffiliate.saveAffiliate, {
    name: 'Partner', slug: 'private-partner', campaignId, contactEmail: 'private-partner@example.com', notes: 'Guest private-guest@example.com +66811112222'
  });
  const creditId = await t.run(async ctx => {
    const id = await ctx.db.insert('affiliateCredits', {
      sourceKey: 'privacy-test', snapshot: { capturedAt: 1, candidates: [{ affiliateId, name: 'Partner', slug: 'private-partner', origin: 'link', eligible: true, contactEmail: 'private-partner@example.com' }], flags: [] },
      affiliateId, state: 'pending', eligibleNet: 10000, approvedNet: 0, eligible: true, revision: 1, createdAt: 1, updatedAt: 1, reason: 'Guest private-guest@example.com'
    });
    await ctx.db.insert('affiliateCreditChanges', { creditId: id, revision: 1, actor: 'private-actor@example.com', kind: 'created', reason: 'Guest private-guest@example.com', state: 'pending', eligibleNet: 10000, approvedNet: 0, affiliateId, recordedAt: 1 });
    return id;
  });
  const partners = await reader.query(api.marketing.affiliates.listAffiliates, {});
  const detail = await reader.query(api.marketing.affiliates.getCredit, { creditId });
  const credits = await reader.query(api.marketing.affiliates.listCredits, {});
  if (full) {
    expect(partners.rows[0]).toMatchObject({ contactEmail: 'private-partner@example.com', notes: 'Guest private-guest@example.com +66811112222', updatedByEmail: 'private-actor@example.com' });
    expect(detail?.history[0]).toMatchObject({ actor: 'private-actor@example.com', reason: 'Guest private-guest@example.com' });
  } else {
    for (const result of [partners, detail, credits]) {
      const json = JSON.stringify(result);
      expect(json).not.toContain('private-partner@example.com');
      expect(json).not.toContain('private-guest@example.com');
      expect(json).not.toContain('private-actor@example.com');
      expect(json).not.toContain('+66811112222');
    }
    expect(detail?.history[0]).toMatchObject({ actor: 'Staff', reason: null, reasonHidden: true });
  }
});
