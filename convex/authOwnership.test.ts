// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

it('removes every root auth registration independently of authentication or argument validation', async () => {
  const t = convexTest(schema, modules);
  const clients = [t, t.withIdentity({ email: 'Owner@Example.com', tokenIdentifier: 'issuer|owner' })];
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  for (const client of clients) {
    for (const [module, endpoint] of [['users', 'current'], ['staffAccess', 'myAccess'], ['staffAccess', 'currentInternal'], ['staffAccess', 'listPeople'], ['lib/adminAuth', 'requireAdmin'], ['lib/adminAuth', 'requireOwner'], ['lib/staffAccess', 'requireStaff'], ['lib/staffAccess', 'staffAccess']]) {
      await expect(client.query(makeFunctionReference<'query'>([module, endpoint].join(':')), {}))
        .rejects.toThrow('Could not find module for:');
    }
    for (const [module, endpoint] of [['users', 'store'], ['staffAccess', 'claimInvite'], ['staffAccess', 'setGrant'], ['staffAccess', 'updateInvitation']]) {
      // Empty args deliberately omit required grant fields. Missing-module errors prove
      // retirement, whereas validation/authentication errors would conceal a live endpoint.
      await expect(client.mutation(makeFunctionReference<'mutation'>([module, endpoint].join(':')), {}))
        .rejects.toThrow('Could not find module for:');
    }
  }
});

it('keeps nonstaff user profiles keyed by tokenIdentifier and retains legacy clerkId on updates', async () => {
  const t = convexTest(schema, modules);
  const first = t.withIdentity({ subject: 'legacy-subject', tokenIdentifier: 'issuer-a|person', email: 'Person@Example.com', name: 'First', pictureUrl: 'https://example.com/first.png' });
  await expect(t.mutation(api.auth.users.store, {})).rejects.toThrow('Not authenticated');
  expect(await t.query(api.auth.users.current, {})).toBeNull();
  const id = await first.mutation(api.auth.users.store, {});
  expect(await first.query(api.auth.users.current, {})).toMatchObject({ _id: id, clerkId: 'legacy-subject', tokenIdentifier: 'issuer-a|person', email: 'Person@Example.com', name: 'First' });
  expect(await first.query(api.auth.staffAccess.myAccess, {})).toMatchObject({ role: null, capabilities: { checkout: false, operations: false, manageTeam: false } });
  const unchanged = await first.query(api.auth.users.current, {});
  expect(await first.mutation(api.auth.users.store, {})).toBe(id);
  expect(await first.query(api.auth.users.current, {})).toEqual(unchanged);
  const updated = t.withIdentity({ subject: 'new-subject', tokenIdentifier: 'issuer-a|person', email: 'Changed@Example.com' });
  expect(await updated.mutation(api.auth.users.store, {})).toBe(id);
  const row = await updated.query(api.auth.users.current, {});
  expect(row).toMatchObject({ clerkId: 'legacy-subject', tokenIdentifier: 'issuer-a|person', email: 'Changed@Example.com' });
  expect(row).not.toHaveProperty('name');
  expect(row).not.toHaveProperty('imageUrl');
  const otherIssuer = t.withIdentity({ subject: 'legacy-subject', tokenIdentifier: 'issuer-b|person', email: 'Changed@Example.com' });
  expect(await otherIssuer.query(api.auth.users.current, {})).toBeNull();
  expect(await otherIssuer.mutation(api.auth.users.store, {})).not.toBe(id);
  expect(await t.run(ctx => ctx.db.query('users').collect())).toHaveLength(2);
});

it('exposes the relocated internal identity query without granting anonymous staff authority', async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(internal.auth.staffAccess.currentInternal, {})).toMatchObject({ email: null, tokenIdentifier: null, role: null });
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const owner = t.withIdentity({ email: 'Owner@Example.com', tokenIdentifier: 'issuer|owner' });
  expect(await owner.query(internal.auth.staffAccess.currentInternal, {})).toMatchObject({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner', role: 'owner' });
});
