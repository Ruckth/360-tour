// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { requireStaff } from './auth/private/staffAccess';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

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
