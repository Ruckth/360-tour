// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import type { FunctionReturnType } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

it.each(['viewer', 'marketer', 'finance', 'manager', 'admin'] as const)('protects all marketing history snapshots and pagination for %s', async role => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const reader = role === 'admin' ? admin : t.withIdentity({ email: 'reader@example.com', tokenIdentifier: 'reader' });
  const full = ['admin', 'finance', 'manager'].includes(role);
  if (role !== 'admin') await t.run(ctx => ctx.db.insert('marketingGrants', {
    email: 'reader@example.com', tokenIdentifier: 'reader', role, createdAt: 1, updatedAt: 1, updatedByEmail: 'admin@example.com'
  }));
  for (const entityType of ['marketingAffiliate', 'marketingCampaign', 'marketingSpend', 'marketingLink', 'coupon']) {
    const values = { status: 'active', amount: 500, contactEmail: 'private@example.com', notes: 'private notes', note: 'private spend note', terms: 'private contact terms', nested: [{ guestName: 'private guest', confirmationCode: 'private code', campaign: 'November' }] };
    await t.run(async ctx => {
      for (let i = 0; i < 3; i++) await ctx.db.insert('recordChanges', {
        entityType, entityId: 'one', kind: 'updated', actor: 'private-actor@example.com', reason: 'private reason',
        before: values, after: values, recordedAt: i, effectiveAt: i
      });
    });
    const stored = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_recordedAt', q => q.eq('entityType', entityType)).collect());
    for (const entityId of [undefined, 'one']) {
      let cursor: string | null = null;
      let seen = 0;
      for (;;) {
        const result: FunctionReturnType<typeof api.recordHistory.list> = await reader.query(api.recordHistory.list, { entityType, ...(entityId ? { entityId } : {}), paginationOpts: { numItems: 2, cursor } });
        seen += result.page.length;
        for (const row of result.page) {
          expect(row.before).toMatchObject({ status: 'active', amount: 500, nested: [{ campaign: 'November' }] });
          if (full) expect(row).toEqual(stored.find(s => s._id === row._id));
          else expect(JSON.stringify(row)).not.toContain('private');
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      expect(seen).toBe(3);
    }
    expect((await admin.query(api.recordHistory.list, { entityType, paginationOpts: { numItems: 100, cursor: null } })).page).toEqual([...stored].reverse());
  }
  // Grants include invited emails. They remain operational-admin-only, even for finance/managers.
  if (role !== 'admin') await expect(reader.query(api.recordHistory.list, { entityType: 'marketingGrant', paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow('Not authorized');
});
