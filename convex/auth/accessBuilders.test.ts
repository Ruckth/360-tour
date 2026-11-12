// @vitest-environment edge-runtime
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { makeFunctionReference, type FunctionType } from 'convex/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import schema from '../schema';
import { api, internal } from '../_generated/api';
import { hashGuestToken } from '../lib/guestToken';
import { sha256 } from '../lib/displayTokens';
import {
  publicQuery, publicMutation, publicAction,
  guestQuery, guestMutation, deviceQuery, deviceMutation,
  authenticatedQuery, authenticatedMutation, authenticatedAction,
  adminQuery, adminMutation, adminAction, staffQuery, staffMutation, staffAction,
  marketingQuery, marketingMutation,
} from './model';

// Test-only registrations: not deployed and not added to the public function inventory.
const probes = {
  publicQuery: publicQuery({ reason: 'Anonymous test read', args: {}, handler: () => 'public' }),
  publicMutation: publicMutation({ reason: 'Anonymous test write', args: {}, handler: () => 'public' }),
  publicAction: publicAction({ reason: 'Anonymous test action', args: {}, handler: () => 'public' }),
  missingReason: publicQuery({ reason: ' ', args: {}, handler: () => 'unreachable' }),
  guestQuery: guestQuery({ args: {}, handler: ctx => ctx.guestSession._id }),
  guestMutation: guestMutation({ args: {}, handler: ctx => ctx.guestSession._id }),
  deviceQuery: deviceQuery({ args: {}, handler: ctx => ctx.device?.status ?? null }),
  deviceMutation: deviceMutation({ args: {}, handler: ctx => ctx.device?.status ?? null }),
  authenticatedQuery: authenticatedQuery({ args: {}, handler: ctx => ctx.identity.tokenIdentifier }),
  authenticatedMutation: authenticatedMutation({ args: {}, handler: ctx => ctx.identity.tokenIdentifier }),
  authenticatedAction: authenticatedAction({ args: {}, handler: ctx => ctx.identity.tokenIdentifier }),
  adminQuery: adminQuery({ args: {}, handler: ctx => ctx.admin.email }),
  adminMutation: adminMutation({ args: {}, handler: ctx => ctx.admin.email }),
  adminAction: adminAction({ args: {}, handler: ctx => ctx.admin.email }),
  staffQuery: staffQuery({ capability: 'checkout', args: {}, handler: ctx => ctx.staff.role }),
  staffMutation: staffMutation({ capability: 'checkout', args: {}, handler: ctx => ctx.staff.role }),
  staffAction: staffAction({ capability: 'checkout', args: {}, handler: ctx => ctx.staff.role }),
  ownerQuery: staffQuery({ capability: 'manageTeam', args: {}, handler: ctx => ctx.staff.role }),
  marketingQuery: marketingQuery({ permission: 'view', args: {}, handler: ctx => ctx.marketing.role }),
  marketingMutation: marketingMutation({ permission: 'publish', args: {}, handler: ctx => ctx.marketing.role }),
};
function setup() {
  const t = convexTest(schema, { ...import.meta.glob('../**/*.ts'), '../accessProbes.ts': async () => probes });
  const signed = (role: string) => t.withIdentity({ email: `${role}@example.com`, tokenIdentifier: `issuer|${role}` });
  return { t, signed };
}
function invoke(client: Pick<ReturnType<typeof setup>['t'], 'query' | 'mutation' | 'action'>, kind: FunctionType, name: string, args: Record<string, unknown>) {
  switch (kind) {
    case 'query': return client.query(makeFunctionReference<'query'>(`accessProbes:${name}`), args);
    case 'mutation': return client.mutation(makeFunctionReference<'mutation'>(`accessProbes:${name}`), args);
    case 'action': return client.action(makeFunctionReference<'action'>(`accessProbes:${name}`), args);
  }
}
const ref = <T extends FunctionType>(name: string) => makeFunctionReference<T>(`accessProbes:${name}`);
beforeEach(() => vi.stubEnv('ADMIN_EMAILS', 'owner@example.com'));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('requires explicit public reasons and permits anonymous query, mutation and action handlers', async () => {
  const { t } = setup();
  expect(await t.query(ref<'query'>('publicQuery'), {})).toBe('public');
  expect(await t.mutation(ref<'mutation'>('publicMutation'), {})).toBe('public');
  expect(await t.action(ref<'action'>('publicAction'), {})).toBe('public');
  await expect(t.query(ref<'query'>('missingReason'), {})).rejects.toThrow('Public access requires a reason');
});

it('admits signed-in nonstaff to authenticated builders and derives action identity server-side', async () => {
  const { t, signed } = setup();
  for (const kind of ['query', 'mutation', 'action'] as const) {
    await expect(invoke(t, kind, `authenticated${kind[0].toUpperCase()}${kind.slice(1)}`, {})).rejects.toThrow('Not authenticated');
    expect(await invoke(signed('visitor'), kind, `authenticated${kind[0].toUpperCase()}${kind.slice(1)}`, {})).toBe('issuer|visitor');
  }
  await signed('visitor').mutation(api.users.store, {});
  expect(await signed('visitor').query(api.users.current, {})).toMatchObject({ tokenIdentifier: 'issuer|visitor' });
  expect(await t.query(api.users.current, {})).toBeNull();
});

it('uses authoritative staff and operations policies for all three function kinds, including action grant revocation', async () => {
  const { t, signed } = setup();
  for (const role of ['manager', 'cashier'] as const) await t.run(ctx => ctx.db.insert('staffGrants', {
    role, email: `${role}@example.com`, tokenIdentifier: `issuer|${role}`, createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'owner@example.com',
  }));
  for (const kind of ['query', 'mutation', 'action'] as const) {
    const suffix = kind[0].toUpperCase() + kind.slice(1);
    await expect(invoke(t, kind, `admin${suffix}`, {})).rejects.toThrow('Not authenticated');
    await expect(invoke(signed('visitor'), kind, `admin${suffix}`, {})).rejects.toThrow('Not authorized');
    await expect(invoke(signed('cashier'), kind, `admin${suffix}`, {})).rejects.toThrow('Not authorized');
    expect(await invoke(signed('manager'), kind, `admin${suffix}`, {})).toBe('manager@example.com');
    expect(await invoke(signed('owner'), kind, `admin${suffix}`, {})).toBe('owner@example.com');
    expect(await invoke(signed('cashier'), kind, `staff${suffix}`, {})).toBe('cashier');
    await expect(invoke(signed('visitor'), kind, `staff${suffix}`, {})).rejects.toThrow('Not authorized');
  }
  await expect(signed('manager').query(ref<'query'>('ownerQuery'), {})).rejects.toThrow('Not authorized');
  expect(await signed('owner').query(ref<'query'>('ownerQuery'), {})).toBe('owner');
  await t.run(async ctx => {
    const grant = await ctx.db.query('staffGrants').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', 'issuer|manager')).unique();
    await ctx.db.delete(grant!._id);
  });
  await expect(signed('manager').action(ref<'action'>('adminAction'), {})).rejects.toThrow('Not authorized');
});

it('preserves independent marketing access without granting staff authority', async () => {
  const { t, signed } = setup();
  await t.run(ctx => ctx.db.insert('marketingGrants', { email: 'marketer@example.com', tokenIdentifier: 'issuer|marketer', role: 'marketer', createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'owner@example.com' }));
  expect(await signed('marketer').query(ref<'query'>('marketingQuery'), {})).toBe('marketer');
  await expect(signed('marketer').mutation(ref<'mutation'>('marketingMutation'), {})).rejects.toThrow('Not authorized');
  await expect(signed('marketer').action(ref<'action'>('staffAction'), {})).rejects.toThrow('Not authorized');
});

it('enforces web-session guest tokens before reads and writes, including foreign and social credentials', async () => {
  const { t } = setup();
  const guest = await t.mutation(api.chat.createSession, { channel: 'web' });
  const other = await t.mutation(api.chat.createSession, { channel: 'web' });
  const social = await t.run(ctx => ctx.db.insert('conversations', { channel: 'line', createdAt: Date.now(), guestTokenHash: '' }));
  const tokenHash = await hashGuestToken(guest.guestToken);
  await t.run(ctx => ctx.db.patch(social, { guestTokenHash: tokenHash }));
  for (const kind of ['query', 'mutation'] as const) {
    const target = kind === 'query' ? 'guestQuery' : 'guestMutation';
    expect(await invoke(t, kind, target, guest)).toBe(guest.sessionId);
    for (const args of [{ sessionId: guest.sessionId }, { ...guest, guestToken: other.guestToken }, { ...guest, sessionId: social }]) {
      await expect(invoke(t, kind, target, args)).rejects.toThrow('INVALID_GUEST_TOKEN');
    }
  }
});

it('resolves device tokens with the existing pending, active, revoked and invalid contract', async () => {
  const { t } = setup();
  const tokenHash = await sha256('device-secret');
  const display = await t.run(async ctx => {
    const tillId = await ctx.db.insert('tills', { key: 'default' });
    return ctx.db.insert('displays', { tillId, tokenHash, name: 'Test', status: 'pending', createdAt: Date.now() });
  });
  for (const status of ['pending', 'active', 'revoked'] as const) {
    await t.run(ctx => ctx.db.patch(display, { status }));
    for (const kind of ['query', 'mutation'] as const) {
      const target = kind === 'query' ? 'deviceQuery' : 'deviceMutation';
      expect(await invoke(t, kind, target, { token: 'device-secret' })).toBe(status === 'revoked' ? null : status);
      expect(await invoke(t, kind, target, { token: 'wrong' })).toBeNull();
      expect(await invoke(t, kind, target, { token: 'x'.repeat(129) })).toBeNull();
    }
  }
});

it('runs maintenance before every public trust policy and handler, while internal functions stay usable', async () => {
  const { t } = setup();
  const guest = await t.mutation(api.chat.createSession, { channel: 'web' });
  vi.stubEnv('ARCH_RESET_PAUSED', '1');
  for (const name of Object.keys(probes).filter(name => name !== 'missingReason')) {
    const kind = name.endsWith('Mutation') ? 'mutation' : name.endsWith('Action') ? 'action' : 'query';
    const args = name.startsWith('guest') ? guest : name.startsWith('device') ? { token: 'invalid' } : {};
    await expect(invoke(t, kind, (name), args)).rejects.toThrow('MAINTENANCE');
  }
  expect(await t.query(internal.staffAccess.currentInternal, {})).toMatchObject({ role: null });
  for (const path of ['/stripe/webhook', '/line/webhook', '/facebook/webhook', '/instagram/webhook', '/whatsapp/webhook']) {
    expect((await t.fetch(path, { method: 'POST', body: '{}' })).status).toBe(503);
  }
});

it('preserves public booking record capabilities without granting nonstaff fallback access', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T03:00:00Z'));
  const { t, signed } = setup();
  const propertyId = await signed('owner').mutation(api.catalog.adminProperties.create, { name: 'Access villa', slug: 'access-villa' });
  await t.run(ctx => ctx.db.patch(propertyId, { status: 'active', pricePerNight: 100000 }));
  const stay = { propertySlug: 'access-villa', guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '0812345678', checkIn: '2099-01-10', checkOut: '2099-01-12', guests: 2 };
  const first = await t.mutation(api.bookings.bookings.create, stay);
  const second = await t.mutation(api.bookings.bookings.create, { ...stay, checkIn: '2099-02-10', checkOut: '2099-02-12' });
  expect(await t.query(api.bookings.bookings.getById, { id: first.bookingId, accessToken: first.accessToken })).toMatchObject({ total: 200000 });
  await expect(t.query(api.bookings.bookings.getById, { id: first.bookingId, accessToken: second.accessToken })).rejects.toThrow('Booking access denied');
  await expect(signed('visitor').query(api.bookings.bookings.getById, { id: first.bookingId })).rejects.toThrow('Not authorized');
  expect(await signed('visitor').query(api.bookings.bookings.getById, { id: first.bookingId, accessToken: first.accessToken })).toMatchObject({ total: 200000 });
  expect(await signed('owner').query(api.bookings.bookings.getById, { id: first.bookingId })).toMatchObject({ total: 200000 });
});
