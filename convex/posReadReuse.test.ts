// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import type { RegisteredQuery } from 'convex/server';
import type { QueryCtx } from './_generated/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { getOrder, stableCatalog, recentCatalogRanking, catalog } from './pos';
import schema from './schema';
// Convex hides _handler from its public declaration; the test invokes it with a real local DB
// so reads can be counted without substituting database behavior.
function handler<A extends Record<string, unknown>, R>(fn: RegisteredQuery<'public', A, R>): (ctx: QueryCtx, args: A) => R {
  return Reflect.get(fn, '_handler');
}
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => vi.stubEnv('ADMIN_EMAILS', 'reads@example.com'));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
async function fixture() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'reads@example.com', tokenIdentifier: 'reads' });
  const ids = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', { slug: 'villa', name: 'Villa', tagline: 'Pool', description: '', pricePerNight: 100, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 30, images: ['/villa.jpg'], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' });
    const bookingId = await ctx.db.insert('bookings', { propertyId, guestName: 'Guest', guestPhone: '0800000000', checkIn: '2026-11-01', checkOut: '2026-11-02', guests: 1, nights: 1, subtotal: 100, discountAmount: 0, total: 100, currency: 'THB', amountPaid: 0, paymentStatus: 'pending', status: 'confirmed', confirmationCode: 'READS', createdAt: 1 });
    const staffId = await ctx.db.insert('staff', { name: 'Current therapist', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: 1, updatedAt: 1 });
    const serviceId = await ctx.db.insert('services', { slug: 'massage', name: 'Massage', description: '', category: 'Wellness', durationMin: 60, bufferMin: 0, price: 100, currency: 'THB', staffIds: [staffId], imageUrl: '/service.jpg', status: 'active', createdAt: 1, updatedAt: 1 });
    const appointmentId = await ctx.db.insert('serviceAppointments', { serviceId, staffId, start: 1, end: 2, blockedUntil: 2, guestName: 'Guest', guestPhone: '0800000000', source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 100, currency: 'THB', confirmationCode: 'APPT', accessToken: 'test-only', createdAt: 1 });
    return { propertyId, bookingId, staffId, serviceId, appointmentId };
  });
  const read = (orderId: Id<'bills'>) => admin.run(async ctx => {
    const gets = vi.spyOn(ctx.db, 'get'), queries = vi.spyOn(ctx.db, 'query');
    const result = await handler(getOrder)(ctx, { orderId });
    const calls = { gets: gets.mock.calls.map(args => args[args.length - 1]), queries: queries.mock.calls.map(args => args[0]) };
    gets.mockRestore(); queries.mockRestore();
    return { result, ...calls };
  });
  return { t, admin, read, ...ids };
}

it('reads a linked stay and property once, including nulls, and observes later edits without changing money', async () => {
  const { t, admin, read, propertyId, bookingId } = await fixture();
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
  const initial = await read(orderId);
  expect(initial.gets).toEqual([orderId, bookingId, propertyId]);
  expect(initial.queries).toHaveLength(6);
  expect(initial.result?.lines[0]).toMatchObject({ imageUrl: '/villa.jpg', sourceIssue: null });
  await t.run(ctx => ctx.db.patch(propertyId, { name: 'Renamed villa', images: ['/new.jpg'] }));
  const renamed = await read(orderId);
  expect(renamed.result?.source?.name).toBe('Stay · Renamed villa');
  expect(renamed.result?.lines[0]).toMatchObject({ imageUrl: '/new.jpg', sourceIssue: { kind: 'changed' } });
  expect(renamed.result?.totals).toEqual(initial.result?.totals);
  await t.run(ctx => ctx.db.delete(propertyId));
  const missingProperty = await read(orderId);
  expect(missingProperty.gets).toEqual([orderId, bookingId, propertyId]);
  expect(missingProperty.result?.source?.name).toBe('Stay · Villa');
  expect(missingProperty.result?.lines[0].imageUrl).toBeUndefined();
  await t.run(ctx => ctx.db.delete(bookingId));
  const missingBooking = await read(orderId);
  expect(missingBooking.gets).toEqual([orderId, bookingId]);
  expect(missingBooking.result?.source?.reference).toBe('Deleted booking');
  expect(missingBooking.result?.lines[0].sourceIssue?.kind).toBe('gone');
  expect(missingBooking.result?.totals).toEqual(initial.result?.totals);
});

it('reuses appointment/service joins and sees edited or deleted appointment, service and staff on subsequent queries', async () => {
  const { t, admin, read, appointmentId, serviceId, staffId } = await fixture();
  const { orderId } = await admin.mutation(api.pos.openOrderFor, { appointmentId });
  const initial = await read(orderId);
  expect(initial.gets).toEqual([orderId, appointmentId, serviceId, staffId]);
  expect(initial.result?.lines[0]).toMatchObject({ imageUrl: '/service.jpg', staffName: 'Current therapist', sourceIssue: null });
  await t.run(async ctx => {
    await ctx.db.patch(serviceId, { name: 'New service', imageUrl: '/new-service.jpg' });
    await ctx.db.patch(staffId, { name: 'Renamed therapist' });
    await ctx.db.patch(appointmentId, { price: 200 });
  });
  const edited = await read(orderId);
  expect(edited.result?.source?.name).toBe('New service');
  expect(edited.result?.lines[0]).toMatchObject({ imageUrl: '/new-service.jpg', staffName: 'Renamed therapist', sourceIssue: { kind: 'changed' } });
  expect(edited.result?.totals).toEqual(initial.result?.totals);
  await t.run(async ctx => { await ctx.db.delete(serviceId); await ctx.db.delete(staffId); });
  const deleted = await read(orderId);
  expect(deleted.gets.filter(id => id === serviceId)).toHaveLength(1);
  expect(deleted.result?.source?.name).toBe('Appointment');
  expect(deleted.result?.lines[0]).toMatchObject({ staffName: 'Former staff member' });
  expect(deleted.result?.lines[0].imageUrl).toBeUndefined();
  await t.run(ctx => ctx.db.delete(appointmentId));
  const missing = await read(orderId);
  expect(missing.gets.filter(id => id === appointmentId)).toHaveLength(1);
  expect(missing.result?.source?.reference).toBe('Deleted appointment');
  expect(missing.result?.lines[0].sourceIssue?.kind).toBe('gone');
});

it('keeps one photo lookup for 100 rows, skips fully frozen settled staff, and resolves mixed legacy and open rows live', async () => {
  const { t, admin, read, serviceId, staffId } = await fixture();
  const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
  const lineIds = await t.run(async ctx => {
    await ctx.db.patch(orderId, { status: 'paid' });
    const line = (await ctx.db.query('billLines').withIndex('by_billId', q => q.eq('billId', orderId)).first())!;
    await ctx.db.patch(line._id, { staffId, staffName: 'Frozen therapist' });
    const ids = [line._id];
    for (let i = 1; i < 100; i++) ids.push(await ctx.db.insert('billLines', { billId: orderId, kind: 'service', serviceId, staffId, staffName: 'Frozen therapist', name: 'Massage', unitPrice: 100, qty: 1, currency: 'THB', createdAt: i }));
    return ids;
  });
  const frozen = await read(orderId);
  expect(frozen.gets).toEqual([orderId, serviceId]);
  expect(frozen.result?.lines).toHaveLength(100);
  expect(frozen.result?.lines.every(l => l.staffName === 'Frozen therapist' && l.imageUrl === '/service.jpg')).toBe(true);
  await t.run(ctx => ctx.db.patch(lineIds[0], { staffName: undefined }));
  const mixed = await read(orderId);
  expect(mixed.gets.filter(id => id === staffId)).toHaveLength(1);
  expect(mixed.result?.lines[0].staffName).toBe('Current therapist');
  expect(mixed.result?.lines.slice(1).every(l => l.staffName === 'Frozen therapist')).toBe(true);
  await t.run(async ctx => { await ctx.db.patch(orderId, { status: 'draft' }); await ctx.db.patch(staffId, { name: 'Live edit' }); });
  const open = await read(orderId);
  expect(open.gets.filter(id => id === staffId)).toHaveLength(1);
  expect(open.result?.lines.every(l => l.staffName === 'Live edit')).toBe(true);
  expect(open.result?.totals).toEqual(frozen.result?.totals);
  await t.run(ctx => ctx.db.patch(orderId, { status: 'discarded' }));
  expect((await read(orderId)).gets.filter(id => id === staffId)).toHaveLength(1);
});

it('separately authorizes stable catalog and ranking, with disjoint reads, bounded ranking ties and live edits', async () => {
  const { t, admin, propertyId, serviceId } = await fixture();
  const measure = <T>(read: (ctx: QueryCtx, args: Record<string, never>) => Promise<T>) => admin.run(async ctx => {
    const query = vi.spyOn(ctx.db, 'query');
    const result = await read(ctx, {});
    const tables = query.mock.calls.map(args => args[0]); query.mockRestore();
    return { result, tables };
  });
  const stable = await measure(handler(stableCatalog)), empty = await measure(handler(recentCatalogRanking));
  expect(stable.tables).toEqual(['services', 'properties', 'staff']);
  expect(empty).toEqual({ result: [], tables: ['billLines'] });
  const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
  await t.run(async ctx => {
    // Older than the recent-300 cutoff; quantity never contributes to frequency.
    await ctx.db.insert('billLines', { billId: orderId, kind: 'extra', name: 'Outside', qty: 99, unitPrice: 1, currency: 'THB', createdAt: 0 });
    for (let i = 0; i < 300; i++) await ctx.db.insert('billLines', { billId: orderId, kind: 'extra', name: `Tie ${i % 10}`, qty: i % 99 + 1, unitPrice: 1, currency: 'THB', createdAt: i });
  });
  const ranked = await measure(handler(recentCatalogRanking));
  expect(ranked.tables).toEqual(['billLines']);
  expect(ranked.result).toEqual(Array.from({ length: 8 }, (_, i) => `extra:Tie ${9 - i}`));
  expect((await measure(handler(stableCatalog))).result).toEqual(stable.result);
  expect((await measure(handler(catalog))).result).toEqual({ ...stable.result, frequent: ranked.result });
  await t.run(async ctx => {
    await ctx.db.patch(serviceId, { price: 200, imageUrl: '/edited.jpg' });
    await ctx.db.patch(propertyId, { currency: 'USD' });
  });
  const edited = await admin.query(api.pos.stableCatalog, {});
  expect(edited.services[0]).toMatchObject({ price: 200, imageUrl: '/edited.jpg' });
  expect(edited.rooms).toEqual([]);
  expect(await admin.query(api.pos.recentCatalogRanking, {})).toEqual(ranked.result);
  await t.run(ctx => ctx.db.patch(serviceId, { status: 'archived' }));
  expect((await admin.query(api.pos.stableCatalog, {})).services).toEqual([]);
  await expect(t.query(api.pos.stableCatalog, {})).rejects.toThrow('Not authenticated');
  await expect(t.query(api.pos.recentCatalogRanking, {})).rejects.toThrow('Not authenticated');
  await expect(t.withIdentity({ email: 'outsider@example.com' }).query(api.pos.stableCatalog, {})).rejects.toThrow('Not authorized');
  await expect(t.withIdentity({ email: 'outsider@example.com' }).query(api.pos.recentCatalogRanking, {})).rejects.toThrow('Not authorized');
});

it('counts rows rather than quantity, excludes appointment fees and source rows, and filters non-THB catalog entries', async () => {
  const { t, admin, serviceId, propertyId, staffId, appointmentId } = await fixture();
  const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'High quantity', price: 1 } });
  await t.run(async ctx => {
    const original = (await ctx.db.query('billLines').first())!;
    await ctx.db.patch(original._id, { qty: 99 });
    for (let i = 0; i < 2; i++) await ctx.db.insert('billLines', { billId: orderId, kind: 'room', propertyId, name: 'Villa', unitPrice: 1, currency: 'THB', qty: 1, createdAt: i });
    await ctx.db.insert('billLines', { billId: orderId, kind: 'service', serviceId, name: 'Massage', unitPrice: 1, currency: 'THB', qty: 99, createdAt: 3 });
    await ctx.db.insert('billLines', { billId: orderId, kind: 'extra', name: 'Fee', unitPrice: 1, currency: 'THB', qty: 1, feeAppointmentId: appointmentId, fee: { kind: 'no_show', by: 'cashier', at: 1 }, createdAt: 4 });
    await ctx.db.insert('billLines', { billId: orderId, kind: 'appointment', appointmentId, name: 'Appointment', unitPrice: 1, currency: 'THB', qty: 1, createdAt: 5 });
    await ctx.db.patch(serviceId, { currency: 'USD' });
    await ctx.db.patch(staffId, { status: 'archived' });
  });
  const items = await admin.query(api.pos.stableCatalog, {});
  expect(items.services).toEqual([]); expect(items.staff).toEqual([]); expect(items.rooms).toHaveLength(1);
  const frequent = await admin.query(api.pos.recentCatalogRanking, {});
  expect(frequent).toEqual([`room:${propertyId}`, `service:${serviceId}`, 'extra:High quantity']);
  expect(await admin.query(api.pos.catalog, {})).toEqual({ ...items, frequent });
});
