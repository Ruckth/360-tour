import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime

import type { PaginationResult } from 'convex/server';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { STALE_APPOINTMENT } from './lib/appointmentChanges';
import { canCorrectAppointmentTime, canReschedule } from './lib/appointmentWindow';
import { boundedIntegrityRows, createAppointmentRecord, localDateTimeUtc } from './lib/serviceSlots';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const at = (date: string, time = '10:00') => localDateTimeUtc(date, time);
const now = at('2026-11-01', '09:00');
const past = at('2020-01-02'); // No arbitrary historical age cap.
const future = at('2026-11-02');

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const staffId = await admin.mutation(api.services.commands.createStaff.createStaff, {
    name: 'Mali', role: 'Therapist', color: '#abc',
    workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: []
  });
  const serviceId = await admin.mutation(api.services.commands.createService.createService, {
    slug: 'massage', name: 'Thai massage', description: '', category: 'Wellness', durationMin: 60, bufferMin: 15, price: 120000, currency: 'THB', staffIds: [staffId]
  });
  const book = async (start = past, extra: { historicalReason?: string } = {}) => (await admin.mutation(api.services.commands.createAppointment.createAppointment, {
    staffId, serviceId, start, guestName: 'Ann', guestPhone: '', ...extra
  })).appointmentId;
  const get = async (id: Id<'appointments'>) => (await t.run(ctx => ctx.db.get(id)))!;
  const history = async (id: Id<'appointments'>) => t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'appointment').eq('entityId', id)).take(100));
  return { t, admin, staffId, serviceId, book, get, history };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('admin appointment corrections', () => {
  it('accepts old actual service time only through the explicit authenticated admin policy and logs creation without secrets', async () => {
    const { t, admin, staffId, serviceId, book, get, history } = await setup();
    const publicInput = { serviceId, staffId, start: past, guestName: 'Ann', guestPhone: '+66123', source: 'web' as const };
    await expect(t.run(ctx => createAppointmentRecord(ctx, publicInput))).rejects.toThrow('future');
    // Source labels alone must never opt public/chat callers into history.
    await expect(t.run(ctx => createAppointmentRecord(ctx, { ...publicInput, source: 'admin' }))).rejects.toThrow('future');
    await expect(t.run(ctx => createAppointmentRecord(ctx, publicInput, { kind: 'admin_historical' }))).rejects.toThrow('Not authenticated');
    const id = await book();
    expect(await get(id)).toMatchObject({ start: past, status: 'completed', paymentStatus: 'unpaid', staffNameSnapshot: 'Mali', serviceNameSnapshot: 'Thai massage', createdBy: 'admin@example.com', price: 120000 });
    const [creation] = await history(id);
    expect(creation).toMatchObject({ kind: 'created', actor: 'admin@example.com', recordedAt: now, effectiveAt: past, after: { status: 'completed', paymentStatus: 'unpaid' } });
    expect(JSON.stringify(creation)).not.toContain((await get(id)).accessToken);
    const page = await admin.query(api.services.admin.listAppointmentHistoryPage, { appointmentId: id, paginationOpts: { numItems: 10, cursor: null } });
    expect(page.page[0].changes).toEqual(expect.arrayContaining([{ field: 'created', from: null, to: (await get(id)).confirmationCode }, { field: 'status', from: null, to: 'completed' }, { field: 'paymentStatus', from: null, to: 'unpaid' }]));
  });

  it('uses service end rather than start or turnaround for the completed default, while public/future remain booked', async () => {
    const { t, admin, serviceId, staffId, book, get, history } = await setup();
    // Service ended five minutes ago, but its fifteen-minute turnaround has not ended.
    vi.setSystemTime(at('2026-11-01', '11:05'));
    const ended = await book(at('2026-11-01', '10:00'));
    expect(await get(ended)).toMatchObject({ status: 'completed', paymentStatus: 'unpaid', blockedUntil: at('2026-11-01', '11:15') });
    expect((await history(ended))[0]).toMatchObject({ after: { status: 'completed', paymentStatus: 'unpaid' } });
    vi.setSystemTime(at('2026-11-01', '14:05'));
    const running = await book(at('2026-11-01', '13:30'));
    expect(await get(running)).toMatchObject({ status: 'booked', paymentStatus: 'unpaid' });
    vi.setSystemTime(at('2026-11-01', '17:00'));
    const justEnded = await book(at('2026-11-01', '16:00'));
    expect((await get(justEnded)).status).toBe('booked'); // "before now" is strict.
    const upcoming = await book(future);
    expect((await get(upcoming)).status).toBe('booked');
    const publicEntry = await t.run(ctx => createAppointmentRecord(ctx, { serviceId, staffId, start: future + 2 * 3600000, guestName: 'Public', guestPhone: '+66123', source: 'web' }));
    expect((await get(publicEntry.appointmentId)).status).toBe('booked');
    const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { appointmentId: ended });
    const order = (await admin.query(api.pos.orders.getOrder, { orderId }))!;
    expect(order.order.due).toBe(120000);
    await admin.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, expectedRevision: order.order.revision, expectedDue: 120000, idempotencyKey: 'completed-unpaid-collect', tenders: [{ method: 'cash', amount: 120000 }] });
    expect(await get(ended)).toMatchObject({ status: 'completed', paymentStatus: 'paid', amountPaid: 120000 });
  });

  it('accepts archived historical sources with descriptive snapshots and roster warnings, while future use remains protected', async () => {
    const { t, admin, staffId, serviceId, book, get, history } = await setup();
    await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId });
    await admin.mutation(api.services.commands.archiveService.archiveService, { serviceId });
    const id = await book();
    expect(await get(id)).toMatchObject({ staffId, serviceId, staffNameSnapshot: 'Mali', serviceNameSnapshot: 'Thai massage' });
    expect(JSON.stringify(await history(id))).toContain('archived');
    await expect(book(future)).rejects.toThrow('Service unavailable');
    const slots = await admin.query(api.services.admin.findOpenSlots, { serviceId, staffId, date: '2020-01-02' });
    expect(slots.some(slot => slot.start === past)).toBe(true);
    await t.run(ctx => ctx.db.patch(staffId, { workingHours: [], breaks: [] }));
    const review = await admin.query(api.services.admin.previewAppointmentTime, { serviceId, staffId, start: past + 2 * 3600000 });
    expect(review.warnings.join(' ')).toContain('roster');
    expect(review.needsReason).toBe(false);
  });

  it('requires a reason for a deliberate historical overlap, records the exception and rolls back rejected entries', async () => {
    const { t, book, history } = await setup();
    const id = await book();
    await expect(book()).rejects.toThrow('Explain the historical appointment overlap');
    expect(await t.run(ctx => ctx.db.query('appointments').take(10))).toHaveLength(1);
    expect(await history(id)).toHaveLength(1);
    const overlapping = await book(past, { historicalReason: 'Duplicate-time source diary corrected after checking the therapist' });
    expect((await history(overlapping))[0]).toMatchObject({ reason: expect.stringContaining('source diary') });
  });

  it('records the actual whole-minute historical time, while public and future starts keep their grid rules', async () => {
    const { t, admin, staffId, serviceId, book, get } = await setup();
    const actual = past + 7 * 60000;
    const id = await book(actual);
    expect((await get(id)).start).toBe(actual);
    await expect(t.run(ctx => createAppointmentRecord(ctx, { serviceId, staffId, start: actual, guestName: 'Ann', guestPhone: '+66123', source: 'web' }))).rejects.toThrow('future');
    await expect(book(future + 7 * 60000)).rejects.toThrow('15-minute');
    expect(await admin.query(api.services.admin.previewAppointmentTime, { serviceId, staffId, start: future + 7 * 60000 })).toMatchObject({ problem: expect.stringContaining('15-minute') });
  });

  it('preserves issued receipt, tender and line snapshots when a paid appointment time is corrected', async () => {
    const { t, admin, staffId, book, get } = await setup();
    const id = await book();
    const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { appointmentId: id });
    const view = (await admin.query(api.pos.orders.getOrder, { orderId }))!;
    await admin.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, expectedRevision: view.order.revision, expectedDue: 120000, idempotencyKey: 'historical-receipt-001', tenders: [{ method: 'cash', amount: 120000 }] });
    const readFinancialFacts = () => t.run(async ctx => ({
      order: await ctx.db.get(orderId), lines: await ctx.db.query('orderLines').withIndex('by_orderId', q => q.eq('orderId', orderId)).take(100),
      payments: await ctx.db.query('orderPayments').take(100)
    }));
    const facts = await readFinancialFacts();
    expect(facts.order?.status).toBe('paid');
    expect(facts.payments).toHaveLength(1);
    await admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { appointmentId: id, expectedRevision: (await get(id)).revision ?? 0, staffId, start: at('2020-01-03') });
    expect(await readFinancialFacts()).toEqual(facts);
    expect((await get(id)).paymentStatus).toBe('paid');
  });

  it('corrects completed paid service time with a revision guard and preserves payment terms and issued facts', async () => {
    const { t, admin, book, staffId, serviceId, get, history } = await setup();
    const id = await book();
    await admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId: id, expectedRevision: 0, effectiveAt: past + 3600000 });
    expect((await get(id)).status).toBe('completed');
    await admin.mutation(api.services.commands.updateService.updateService, { serviceId, price: 999900, durationMin: 90 });
    const before = await get(id);
    const orders = await t.run(ctx => ctx.db.query('orders').take(100));
    const move = { appointmentId: id, staffId, start: at('2020-01-03'), expectedRevision: 1 };
    await admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, move);
    expect(await get(id)).toMatchObject({ start: move.start, end: move.start + 3600000, price: before.price, currency: before.currency, paymentStatus: 'paid', paidAt: past + 3600000, status: 'completed', revision: 2 });
    expect(await t.run(ctx => ctx.db.query('orders').take(100))).toEqual(orders);
    const changes = await history(id);
    await expect(admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { ...move, start: at('2020-01-04') })).rejects.toThrow(STALE_APPOINTMENT);
    expect(await history(id)).toEqual(changes);
    expect(canCorrectAppointmentTime(before, now)).toBe(true);
    expect(canReschedule(before, now)).toBe(false);
  });

  it.each(['completed', 'cancelled', 'no_show', 'in_service'] as const)('corrects a mistaken %s with reason, actor, effective time and stale-write protection', async status => {
    const { t, admin, book, get, history } = await setup();
    const id = await book();
    // Fixture represents a preexisting legacy status and cancellation metadata.
    await t.run(ctx => ctx.db.patch(id, { status, cancelledAt: past, cancelledBy: 'old@example.com', cancellationReason: 'Legacy' }));
    const correction = { appointmentId: id, expectedRevision: 0, status: 'arrived' as const, effectiveAt: past };
    await expect(admin.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, correction)).rejects.toThrow('Explain why');
    await admin.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, { ...correction, reason: 'Wrong button selected' });
    expect(await get(id)).toMatchObject({ status: 'arrived', revision: 1 });
    expect((await get(id)).cancelledAt).toBeUndefined();
    expect((await history(id)).slice(-1)[0]).toMatchObject({ kind: 'status', reason: 'Wrong button selected', actor: 'admin@example.com', effectiveAt: past, recordedAt: now, before: expect.objectContaining({ status }), after: expect.objectContaining({ status: 'arrived' }) });
    await expect(admin.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, { ...correction, reason: 'Old revision', status: 'booked' })).rejects.toThrow(STALE_APPOINTMENT);
  });

  it('rejects a conflicting future reopen and leaves status, revision and history untouched', async () => {
    const { admin, book, get, history } = await setup();
    const id = await book(future);
    await admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, { appointmentId: id, expectedRevision: 0 });
    await book(future);
    const before = await get(id);
    const logs = await history(id);
    await expect(admin.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, { appointmentId: id, expectedRevision: 1, status: 'booked', reason: 'Cancelled wrong guest', effectiveAt: now })).rejects.toThrow('That time was just taken');
    expect(await get(id)).toEqual(before);
    expect(await history(id)).toEqual(logs);
  });

  it('never uses a historical reason to override current/future occupancy, and corrects arrived service times', async () => {
    const { admin, staffId, book, get } = await setup();
    const id = await book(future);
    await expect(book(future, { historicalReason: 'Attempted future override' })).rejects.toThrow('That time was just taken');
    await admin.mutation(api.services.commands.updateAppointmentStatus.updateAppointmentStatus, { appointmentId: id, status: 'arrived', expectedRevision: 0 });
    await admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, { appointmentId: id, staffId, expectedRevision: 1, start: future + 2 * 3600000 });
    expect(await get(id)).toMatchObject({ status: 'arrived', start: future + 2 * 3600000, revision: 2 });
    vi.setSystemTime(at('2026-11-01', '10:30'));
    const started = at('2026-11-01', '10:00');
    await book(started);
    await expect(book(started, { historicalReason: 'Attempted in-progress override' })).rejects.toThrow('That time was just taken');
  });

  it('keeps pending reschedule failure atomic after availability changes and allows recovery with the same reviewed revision', async () => {
    const { admin, staffId, book, get, history } = await setup();
    const id = await book(future);
    const competitor = await book(future + 2 * 3600000);
    const before = await get(id);
    const logs = await history(id);
    const move = { appointmentId: id, expectedRevision: 0, staffId, start: future + 2 * 3600000 };
    await expect(admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, move)).rejects.toThrow('That time was just taken');
    expect(await get(id)).toEqual(before);
    expect(await history(id)).toEqual(logs);
    await admin.mutation(api.services.commands.cancelAppointment.cancelAppointment, { appointmentId: competitor, expectedRevision: 0 });
    await admin.mutation(api.services.commands.rescheduleAppointment.rescheduleAppointment, move);
    expect(await get(id)).toMatchObject({ start: move.start, revision: 1 });
  });

  it('logs payment actor/effective date, cleans stale unpaid refund metadata, and refuses refunded to paid', async () => {
    const { t, admin, book, get, history } = await setup();
    const id = await book();
    await t.run(ctx => ctx.db.patch(id, { refundedAt: past - 1 }));
    await admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId: id, expectedRevision: 0, effectiveAt: past });
    expect(await get(id)).toMatchObject({ paidAt: past, paidBy: 'admin@example.com', paymentStatus: 'paid' });
    expect((await get(id)).refundedAt).toBeUndefined();
    expect((await history(id)).slice(-1)[0]).toMatchObject({ effectiveAt: past, actor: 'admin@example.com', kind: 'payment' });
    await admin.mutation(api.services.commands.refundAppointment.refundAppointment, { appointmentId: id, expectedRevision: 1 });
    const refunded = await get(id);
    await expect(admin.mutation(api.services.commands.markAppointmentPaid.markAppointmentPaid, { appointmentId: id, expectedRevision: 2 })).rejects.toThrow('Only unpaid');
    expect(await get(id)).toEqual(refunded);
  });

  it('pages every history entry beyond 50 and does not invent original legacy creation evidence', async () => {
    const { t, admin, book, get } = await setup();
    const id = await book();
    for (let revision = 0; revision < 57; revision++) await admin.mutation(api.services.commands.updateAppointmentDetails.updateAppointmentDetails, { appointmentId: id, expectedRevision: revision, guestName: `Guest ${revision}`, guestPhone: '' });
    const found: Doc<'appointmentChanges'>[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result: PaginationResult<Doc<'appointmentChanges'>> = await admin.query(api.services.admin.listAppointmentHistoryPage, { appointmentId: id, paginationOpts: { numItems: 11, cursor } });
      found.push(...result.page);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(found).toHaveLength(58);
    expect(new Set(found.map(row => row._id)).size).toBe(58);
    expect(found[found.length - 1]?.changes.some(change => change.field === 'created')).toBe(true);
    const original = await get(id);
    const legacy = await t.run(ctx => insertFixture(ctx, 'appointments', { serviceId: original.serviceId, staffId: original.staffId, start: past, end: past + 3600000, blockedUntil: past + 3600000, guestName: '', guestPhone: '', source: 'admin', status: 'cancelled', paymentStatus: 'unpaid', price: 10000, currency: 'THB', confirmationCode: 'OLD', accessToken: 'never-log-this', createdAt: past }));
    expect((await admin.query(api.services.admin.listAppointmentHistoryPage, { appointmentId: legacy, paginationOpts: { numItems: 10, cursor: null } })).page).toEqual([]);
    await expect(admin.query(api.services.admin.listAppointmentHistoryPage, { appointmentId: id, paginationOpts: { numItems: 101, cursor: null } })).rejects.toThrow('Page size');
  });

  it('pages ended time off with explicit past/all ranges, audits edits/removal and restores archived service assignments', async () => {
    const { t, admin, staffId, serviceId } = await setup();
    const [created] = await admin.mutation(api.services.commands.addTimeOff.addTimeOff, { staffId, start: past, end: past + 3600000, label: 'Sick day' });
    const id = created.timeOffId!;
    await admin.mutation(api.services.commands.updateTimeOff.updateTimeOff, { timeOffId: id, start: past, end: past + 7200000, label: 'Sick leave', expected: { start: past, end: past + 3600000, label: 'Sick day' } });
    const query = { staffId, range: 'past' as const, paginationOpts: { numItems: 1, cursor: null } };
    expect((await admin.query(api.services.admin.listTimeOffPage, query)).page).toMatchObject([{ label: 'Sick leave' }]);
    expect((await admin.query(api.services.admin.listTimeOffPage, { ...query, range: 'upcoming' })).page).toEqual([]);
    await admin.mutation(api.services.commands.removeTimeOff.removeTimeOff, { timeOffId: id });
    const logs = await t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', 'timeOff').eq('entityId', id)).take(100));
    expect(logs.map(row => row.kind)).toEqual(['created', 'updated', 'removed']);
    await admin.mutation(api.services.commands.archiveStaff.archiveStaff, { staffId });
    expect((await t.run(ctx => ctx.db.get(serviceId)))?.staffIds).toEqual([]);
    await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, status: 'active' });
    expect((await t.run(ctx => ctx.db.get(serviceId)))?.staffIds).toEqual([staffId]);
  });

  it('rejects unauthenticated corrections and fails overflowing integrity reads instead of silently truncating', async () => {
    const { t, book } = await setup();
    const id = await book();
    await expect(t.mutation(api.services.commands.correctAppointmentStatus.correctAppointmentStatus, { appointmentId: id, expectedRevision: 0, status: 'completed', effectiveAt: now })).rejects.toThrow('Not authenticated');
    async function* rows() { yield 1; yield 2; yield 3; }
    const read = async () => { const found = []; for await (const row of boundedIntegrityRows(rows(), 2)) found.push(row); return found; };
    await expect(read()).rejects.toThrow('Too many records');
  });
});
