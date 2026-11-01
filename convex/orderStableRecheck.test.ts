// @vitest-environment edge-runtime
// Independent checks of new lookup writes, legacy cap and batched migration boundaries.
import migrationsTest from '@convex-dev/migrations/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import { seedAiEvalData } from './seeds/aiEvalData';
import { seedStaffServicesData } from './seeds/staffServices';
import schema from './schema';
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', 'stable@example.com');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T01:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('writes contact lookup fields through both real appointment seed paths', async () => {
  const t = convexTest(schema, modules);
  const seeded = await t.run(seedStaffServicesData);
  const evalSeeded = await t.run(seedAiEvalData);
  expect(seeded.appointmentsCreated).toBeGreaterThan(0);
  expect(evalSeeded.occupiedAppointments).toBeGreaterThan(0);
  const rows = await t.run(ctx => ctx.db.query('serviceAppointments').collect());
  expect(rows).toHaveLength(seeded.appointmentsCreated + evalSeeded.occupiedAppointments);
  for (const row of rows) {
    expect(row.guestPhoneDigits).toBe(row.guestPhone.replace(/\D/g, ''));
    expect(row.guestEmailNormalized).toBe(row.guestEmail?.trim().toLowerCase() || undefined);
  }
});

it('limits legacy contact fallback to 500, announces incompleteness, and finds the omitted row after batched backfill', async () => {
  const t = convexTest(schema, modules);
  migrationsTest.register(t);
  const admin = t.withIdentity({ email: 'stable@example.com', tokenIdentifier: 'stable' });
  const target = await t.run(async ctx => {
    const staffId = await ctx.db.insert('staff', { name: 'Tester', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: 1, updatedAt: 1 });
    const serviceId = await ctx.db.insert('services', { slug: 'stable', name: 'Stable service', description: '', category: 'Wellness', durationMin: 60, bufferMin: 0, price: 100, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: 1, updatedAt: 1 });
    let last;
    for (let i = 0; i < 501; i++) last = await ctx.db.insert('serviceAppointments', { serviceId, staffId, start: 1, end: 2, blockedUntil: 2, guestName: `Legacy ${i}`, guestPhone: i === 500 ? '+66 (81) 777-4444' : '0800000000', guestEmail: i === 500 ? 'LAST@Example.com' : undefined, source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 100, currency: 'THB', confirmationCode: `SVC-STABLE-${i}`, accessToken: 'local-test', createdAt: 1 });
    return last!;
  });
  expect(await admin.query(api.pos.attachLookupStatus, {})).toEqual({ complete: false });
  expect((await admin.query(api.pos.listAttachable, { query: 'last@example.com' })).map(r => r.id)).not.toContain(target);
  expect((await admin.query(api.pos.listAttachable, { query: 'SVC-STABLE-500' })).map(r => r.id)).toContain(target);
  const before = await t.run(ctx => ctx.db.query('serviceAppointments').collect());
  await t.mutation(internal.migrations.run, { fn: 'migrations:backfillAppointmentGuestLookup' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await t.query(components.migrations.lib.getStatus, { names: ['migrations:backfillAppointmentGuestLookup'] }))[0]).toMatchObject({ state: 'success' });
  expect(await admin.query(api.pos.attachLookupStatus, {})).toEqual({ complete: true });
  for (const query of ['last@example.com', '66817774444']) expect((await admin.query(api.pos.listAttachable, { query })).map(r => r.id)).toContain(target);
  const after = await t.run(ctx => ctx.db.query('serviceAppointments').collect());
  for (const row of after) {
    const { guestPhoneDigits, guestEmailNormalized, ...original } = row;
    expect(original).toEqual(before.find(old => old._id === row._id));
    expect(guestPhoneDigits).toBe(row.guestPhone.replace(/\D/g, ''));
    expect(guestEmailNormalized).toBe(row.guestEmail?.toLowerCase());
  }
});
