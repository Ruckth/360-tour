// @vitest-environment edge-runtime
// Checks complete fixture records written through both real appointment seed paths.
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { seedAiEvalData } from './maintenance/seeds/aiEvalData';
import { seedStaffServicesData } from './maintenance/seeds/staffServices';
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
  const rows = await t.run(ctx => ctx.db.query('appointments').collect());
  expect(rows).toHaveLength(seeded.appointmentsCreated + evalSeeded.occupiedAppointments);
  for (const row of rows) {
    expect(row.price).toBe((await t.run(ctx => ctx.db.get(row.serviceId)))!.price);
    expect(Number.isSafeInteger(row.price)).toBe(true);
    expect(row.guestPhoneDigits).toBe(row.guestPhone.replace(/\D/g, ''));
    expect(row.guestEmailNormalized).toBe(row.guestEmail?.trim().toLowerCase() || undefined);
  }
});
