// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { requireStaff } from './auth/private/staffAccess';

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
  const owner = t.withIdentity({ email: 'Owner@Example.com', emailVerified: true, tokenIdentifier: 'issuer|owner' });
  expect(await owner.query(internal.auth.staffAccess.currentInternal, {})).toMatchObject({ email: 'owner@example.com', tokenIdentifier: 'issuer|owner', role: 'owner' });
});

it.each([true, false, undefined])('checks owner email verification (%s) while preserving missing-claim compatibility', async emailVerified => {
  const t = convexTest(schema, modules);
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const owner = t.withIdentity({ email: 'Owner@Example.com', tokenIdentifier: 'issuer|owner', ...(emailVerified === undefined ? {} : { emailVerified }) });
  expect(await owner.query(internal.auth.staffAccess.currentInternal, {})).toMatchObject({
    role: emailVerified === false ? null : 'owner',
    capabilities: { manageTeam: emailVerified !== false, checkout: emailVerified !== false },
    pendingInvitation: null,
  });
  const invite = owner.mutation(api.auth.staffAccess.setGrant, { email: 'staff@example.com', role: 'manager' });
  if (emailVerified === false) await expect(invite).rejects.toThrow('Not authorized');
  else await invite;
});

it.each([true, undefined])('rejects unverified staff invite claims and existing grants, and allows verification (%s)', async emailVerified => {
  const t = convexTest(schema, modules);
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const owner = t.withIdentity({ email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'issuer|owner' });
  const grantId = await owner.mutation(api.auth.staffAccess.setGrant, { email: 'staff@example.com', role: 'manager' });
  const identity = { email: 'Staff@Example.com', tokenIdentifier: 'issuer|staff' };
  const unverified = t.withIdentity({ ...identity, emailVerified: false });
  const denied = { role: null, capabilities: { checkout: false, operations: false, manageTeam: false }, pendingInvitation: null };
  expect(await unverified.query(api.auth.staffAccess.myAccess, {})).toMatchObject(denied);
  const before = await t.run(ctx => ctx.db.get(grantId!));
  await expect(unverified.mutation(api.auth.staffAccess.claimInvite, {})).rejects.toThrow('Verify your email');
  expect(await t.run(ctx => ctx.db.get(grantId!))).toEqual(before);

  const verified = t.withIdentity({ ...identity, ...(emailVerified === undefined ? {} : { emailVerified }) });
  expect(await verified.query(api.auth.staffAccess.myAccess, {})).toMatchObject({ role: null, pendingInvitation: { role: 'manager' } });
  await verified.mutation(api.auth.staffAccess.claimInvite, {});
  expect(await verified.query(api.auth.staffAccess.myAccess, {})).toMatchObject({ role: 'manager', capabilities: { checkout: true, operations: true }, pendingInvitation: null });
  expect(await verified.run(ctx => requireStaff(ctx, 'checkout'))).toMatchObject({ role: 'manager' });
  expect(await unverified.query(api.auth.staffAccess.myAccess, {})).toMatchObject(denied);
  await expect(unverified.run(ctx => requireStaff(ctx, 'checkout'))).rejects.toThrow('Not authorized');
  await expect(unverified.mutation(api.auth.staffAccess.claimInvite, {})).rejects.toThrow('Verify your email');
});
