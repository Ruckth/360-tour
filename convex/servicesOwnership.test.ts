// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { appointmentHistory, cancelAppointmentRecord, createAppointmentRecord, localDateTimeUtc, recordAppointmentChange } from './services/model';

const modules = import.meta.glob('./**/*.ts');
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('keeps model creation, linked order and both audits atomic in the caller transaction', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
  vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'owner' });
  const staffId = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Mali', role: 'Therapist', color: '#abc',
    workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] });
  const serviceId = await admin.mutation(api.services.commands.createService.createService, { slug: 'massage', name: 'Massage', description: '',
    category: 'Wellness', durationMin: 60, bufferMin: 15, price: 120000, currency: 'THB', staffIds: [staffId] });
  const input = { serviceId, staffId, start: localDateTimeUtc('2026-11-02', '09:00'), guestName: 'Guest', guestPhone: '+66812345678', source: 'web' as const };
  const snapshot = () => t.run(async ctx => ({ appointments: await ctx.db.query('appointments').collect(), orders: await ctx.db.query('orders').collect(),
    changes: await ctx.db.query('appointmentChanges').collect(), history: await ctx.db.query('recordChanges').collect() }));
  const before = await snapshot();
  await expect(t.run(async ctx => { await createAppointmentRecord(ctx, input); throw new Error('outer transaction aborted'); })).rejects.toThrow('outer transaction aborted');
  expect(await snapshot()).toEqual(before);
  const { appointmentId } = await t.run(ctx => createAppointmentRecord(ctx, input));
  await t.run(async ctx => {
    const appointment = (await ctx.db.get(appointmentId))!;
    await recordAppointmentChange(ctx, appointment, { notes: 'Model edit' }, { actor: 'test', kind: 'details' });
    await cancelAppointmentRecord(ctx, (await ctx.db.get(appointmentId))!, { actor: 'test' });
  });
  const after = await snapshot();
  expect(after.orders).toHaveLength(1);
  expect(after.orders[0].appointmentId).toBe(appointmentId);
  expect(after.appointments[0]).toMatchObject({ revision: 2, notes: 'Model edit', status: 'cancelled', price: 120000 });
  expect(after.changes).toHaveLength(3);
  expect(after.history.filter(row => row.entityType === 'appointment' && row.entityId === appointmentId)).toHaveLength(3);
  expect(await t.run(ctx => appointmentHistory(ctx, appointmentId))).toHaveLength(3);
});

it('has no old ctx-helper modules or compatibility endpoints, independently of arguments and identity', async () => {
  const t = convexTest(schema, modules);
  for (const client of [t, t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'owner' })]) {
    for (const [module, name] of Object.entries({ serviceCatalog: 'serviceQuery', serviceSlots: 'createAppointmentRecord', rosterHistory: 'writeWeeklyPattern',
      appointmentChanges: 'recordAppointmentChange', appointmentFinance: 'recordAppointmentRefund' })) {
      await expect(client.mutation(makeFunctionReference<'mutation'>(`lib/${module}:${name}`), {})).rejects.toThrow(`Could not find module for: "lib/${module}"`);
    }
  }
});
