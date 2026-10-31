// @vitest-environment edge-runtime
// Independent read-side photo regressions. All records exist only in convex-test.
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

it('keeps photo reads safe after deleted service, property and booking sources, without writing financial records', async () => {
  vi.stubEnv('ADMIN_EMAILS', 'audit@example.com');
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'audit@example.com', tokenIdentifier: 'audit' });
  const staffId = await admin.mutation(api.adminServices.createStaff, {
    name: 'Audit therapist', role: 'Therapist', color: '#abc',
    workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [],
  });
  const serviceId = await admin.mutation(api.adminServices.createService, {
    slug: 'audit-service', name: 'Audit service', description: '', category: 'Audit', durationMin: 60,
    bufferMin: 0, price: 100, currency: 'THB', staffIds: [staffId],
  });
  await t.run(ctx => ctx.db.patch(serviceId, { imageUrl: '/initial.jpg' }));
  const { propertyId, bookingId } = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', {
      slug: 'audit-villa', name: 'Audit villa', tagline: '', description: '', pricePerNight: 100,
      currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 30, images: ['/villa.jpg'],
      amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active',
    });
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, guestName: 'Audit guest', guestPhone: '0800000000', checkIn: '2026-10-29', checkOut: '2026-10-30',
      guests: 1, nights: 1, subtotal: 100, discountAmount: 0, total: 100, currency: 'THB',
      amountPaid: 0, paymentStatus: 'pending', status: 'confirmed', confirmationCode: 'AUDIT-PHOTO', createdAt: Date.now(),
    });
    return { propertyId, bookingId };
  });
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
  await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'room', propertyId } });
  for (let i = 0; i < 3; i++) await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId } });
  const read = () => admin.query(api.pos.getOrder, { orderId });
  const stored = () => t.run(async ctx => ({
    order: await ctx.db.get(orderId),
    lines: await ctx.db.query('billLines').collect(),
    audit: await ctx.db.query('billAudit').collect(),
    payments: await ctx.db.query('billPayments').collect(),
  }));
  const before = await stored();
  const initial = await read();
  expect(initial?.lines.filter(l => l.kind === 'service').map(l => l.imageUrl)).toEqual(['/initial.jpg', '/initial.jpg', '/initial.jpg']);
  await t.run(ctx => ctx.db.patch(serviceId, { imageUrl: '/changed.jpg' }));
  expect((await read())?.lines.filter(l => l.kind === 'service').every(l => l.imageUrl === '/changed.jpg')).toBe(true);
  await t.run(async ctx => {
    await ctx.db.delete(serviceId);
    await ctx.db.delete(propertyId);
  });
  const deleted = await read();
  expect(deleted?.lines).toHaveLength(5);
  expect(deleted?.lines.every(l => l.imageUrl === undefined)).toBe(true);
  expect(deleted?.totals).toEqual(initial?.totals);
  await t.run(ctx => ctx.db.delete(bookingId));
  expect((await read())?.lines).toHaveLength(5);
  expect(await stored()).toEqual(before);
  await expect(t.query(api.pos.catalog, {})).rejects.toThrow();
  await expect(t.query(api.pos.getOrder, { orderId })).rejects.toThrow();
});
