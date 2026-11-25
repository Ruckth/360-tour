// @vitest-environment edge-runtime
import { asTestOwner, seedTestBranch } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { requireStaff } from './auth/private/staffAccess';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

it.each([true, false, undefined])('checks owner email verification (%s) requiring explicit verification', async emailVerified => {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, { email: 'Owner@Example.com', tokenIdentifier: 'issuer|owner', ...(emailVerified === undefined ? {} : { emailVerified }) });
  expect(await owner.query(internal.auth.staffAccess.currentInternal, {})).toMatchObject({
    role: emailVerified !== true ? null : 'owner',
    capabilities: { manageTeam: emailVerified === true, checkout: emailVerified === true },
    pendingInvitation: null,
  });
  const invite = owner.mutation(api.auth.staffAccess.setGrant, { email: 'staff@example.com', role: 'manager', branchIds: [await owner.run(ctx => seedTestBranch(ctx))] });
  if (emailVerified !== true) await expect(invite).rejects.toThrow('Not authorized');
  else await invite;
});

it.each([false, undefined].flatMap(emailVerified => (['manager', 'cashier'] as const).map(role => ({ emailVerified, role }))))('rejects unverified staff invite claims and existing grants, and allows verification (%s)', async ({ emailVerified, role }) => {
  const t = convexTest(schema, modules);
  const owner = await asTestOwner(t, { email: 'owner@example.com', emailVerified: true, tokenIdentifier: 'issuer|owner' });
  const grantId = await owner.mutation(api.auth.staffAccess.setGrant, { email: 'staff@example.com', role, branchIds: [await owner.run(ctx => seedTestBranch(ctx))] });
  const identity = { email: 'Staff@Example.com', tokenIdentifier: 'issuer|staff' };
  const unverified = t.withIdentity({ ...identity, ...(emailVerified === undefined ? {} : { emailVerified }) });
  const denied = { role: null, capabilities: { checkout: false, operations: false, manageTeam: false }, pendingInvitation: null };
  expect(await unverified.query(api.auth.staffAccess.myAccess, {})).toMatchObject(denied);
  const before = await t.run(ctx => ctx.db.get(grantId!));
  await expect(unverified.mutation(api.auth.staffAccess.claimInvite, {})).rejects.toThrow('Verify your email');
  expect(await t.run(ctx => ctx.db.get(grantId!))).toEqual(before);

  const verified = t.withIdentity({ ...identity, emailVerified: true });
  expect(await verified.query(api.auth.staffAccess.myAccess, {})).toMatchObject({ role: null, pendingInvitation: { role } });
  await verified.mutation(api.auth.staffAccess.claimInvite, {});
  expect(await verified.query(api.auth.staffAccess.myAccess, {})).toMatchObject({ role, capabilities: { checkout: true, operations: role === 'manager' }, pendingInvitation: null });
  expect(await verified.run(ctx => requireStaff(ctx, 'checkout'))).toMatchObject({ role });
  expect(await unverified.query(api.auth.staffAccess.myAccess, {})).toMatchObject(denied);
  await expect(unverified.run(ctx => requireStaff(ctx, 'checkout'))).rejects.toThrow('Not authorized');
  await expect(unverified.mutation(api.auth.staffAccess.claimInvite, {})).rejects.toThrow('Verify your email');
});
