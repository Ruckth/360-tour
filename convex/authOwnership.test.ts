// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

it('removes every root auth registration independently of authentication or argument validation', async () => {
  const t = convexTest(schema, modules);
  const clients = [t, t.withIdentity({ email: 'Owner@Example.com', emailVerified: true, tokenIdentifier: 'issuer|owner' })];
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

it('exposes the relocated internal identity query without granting anonymous staff authority', async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(internal.auth.staffAccess.currentInternal, {})).toMatchObject({ email: null, tokenIdentifier: null, role: null });
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const owner = t.withIdentity({ email: 'Owner@Example.com', emailVerified: true, tokenIdentifier: 'issuer|owner' });
  expect(await owner.query(internal.auth.staffAccess.currentInternal, {})).toMatchObject({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner', role: 'owner' });
});
