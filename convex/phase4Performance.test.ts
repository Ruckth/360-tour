// @vitest-environment edge-runtime
import { makeFunctionReference } from 'convex/server';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { create } from './catalog/adminReviews';
import { initializeReviewStats } from './catalog/reviewStats';
import { releaseBookingDates } from './bookings/private/availabilityWrites';
import { acceptTestEvent } from './testing/turn.test-support';
import { inboxProjection } from './messaging/inboxProjection';
import { insertFixture } from './testing/completeFixture.test-support';
import schema from './schema';
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => { vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
const property = { slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 20, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active' as const };
const review = { authorName: 'Guest', authorCity: '', authorCountry: '', rating: 4, title: '', body: 'Great stay', date: '2030-01-01', verified: true };

it('updates exact review totals with bounded reads, edits, concurrent creates, final deletion and rollback', async () => {
  const t = convexTest(schema, modules), admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const propertyId = await t.run(ctx => ctx.db.insert('properties', property));
  const ids = await Promise.all([1, 2, 5].map(rating => admin.mutation(api.catalog.adminReviews.create, { propertyId, ...review, rating })));
  const stats = () => t.run(ctx => ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', propertyId)).unique());
  expect(await stats()).toMatchObject({ ratingTotal: 8, totalReviews: 3, overallRating: 2.67 });
  await admin.mutation(api.catalog.adminReviews.update, { reviewId: ids[0], ...review, rating: 5 });
  expect(await stats()).toMatchObject({ ratingTotal: 12, totalReviews: 3, overallRating: 4 });
  // Exercise initialization from a rounded stored average: the exact source sum must win.
  await t.run(async ctx => { const row = (await ctx.db.query('reviewStats').first())!; await ctx.db.patch(row._id, { ratingTotal: undefined }); });
  await t.run(ctx => initializeReviewStats(ctx, propertyId));
  expect(await stats()).toMatchObject({ ratingTotal: 12, totalReviews: 3 });
  const before = await stats();
  await expect(admin.run(async ctx => {
    await Reflect.get(create, '_handler')(ctx, { propertyId, ...review });
    throw new Error('rollback probe');
  })).rejects.toThrow('rollback probe');
  expect(await stats()).toEqual(before);
  await t.run(async ctx => {
    const current = (await ctx.db.query('reviewStats').first())!;
    for (let i = 0; i < 1000; i++) await ctx.db.insert('reviews', { propertyId, authorAvatarUrl: '', ...review });
    await ctx.db.patch(current._id, { ratingTotal: 4012, totalReviews: 1003, overallRating: Math.round(4012 / 1003 * 100) / 100 });
  });
  const reads = await admin.run(async ctx => {
    const before = await ctx.meta.getTransactionMetrics();
    await Reflect.get(create, '_handler')(ctx, { propertyId, ...review });
    return (await ctx.meta.getTransactionMetrics()).documentsRead.used - before.documentsRead.used;
  });
  expect(reads).toBe(3);
  // Each writer serializes on the same exact aggregate; repeat remove is a no-op.
  for (const id of ids) await admin.mutation(api.catalog.adminReviews.remove, { reviewId: id });
  await admin.mutation(api.catalog.adminReviews.remove, { reviewId: ids[0] });
  expect(await stats()).toMatchObject({ ratingTotal: 4004, totalReviews: 1001, overallRating: 4 });
  const other = await t.run(ctx => ctx.db.insert('properties', { ...property, slug: 'other' }));
  const only = await admin.mutation(api.catalog.adminReviews.create, { propertyId: other, ...review });
  await admin.mutation(api.catalog.adminReviews.remove, { reviewId: only });
  expect(await t.run(ctx => ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', other)).unique())).toBeNull();
});

it('releases only booking-owned availability rows, with bounded reads and atomic rollback', async () => {
  const t = convexTest(schema, modules);
  const bookingId = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', property);
    const id = await insertFixture(ctx, 'bookings', { propertyId, guestName: 'Guest', guestPhone: '', checkIn: '2030-01-01', checkOut: '2030-01-03', guests: 1, nights: 2, subtotal: 20000, discountAmount: 0, total: 20000, currency: 'THB', status: 'confirmed', paymentStatus: 'pending', createdAt: 1 });
    for (let i = 0; i < 300; i++) await ctx.db.insert('availability', { propertyId, date: '2030-01-01', source: 'airbnb', status: 'blocked' });
    for (const date of ['2030-01-01', '2030-01-02']) await ctx.db.insert('availability', { propertyId, date, bookingId: id, source: 'direct', status: 'booked' });
    return id;
  });
  const release = () => t.run(async ctx => {
    const booking = (await ctx.db.get(bookingId))!;
    const before = await ctx.meta.getTransactionMetrics();
    await releaseBookingDates(ctx, booking);
    return (await ctx.meta.getTransactionMetrics()).documentsRead.used - before.documentsRead.used;
  });
  await expect(t.run(async ctx => { await releaseBookingDates(ctx, (await ctx.db.get(bookingId))!); throw new Error('rollback'); })).rejects.toThrow('rollback');
  expect(await release()).toBe(4);
  expect(await release()).toBe(0);
  expect(await t.run(ctx => ctx.db.query('availability').collect())).toHaveLength(300);
});

it('keeps inbox snapshots exact through durable retries, failure, profile changes, staff reply and newer ingress', async () => {
  const t = convexTest(schema, modules), admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const accepted = await acceptTestEvent(t, 'line', { eventKey: 'one', recipient: 'phase4-guest', eventType: 'message', messageText: 'Hello' });
  const sessionId = accepted.sessionId!;
  const check = () => t.run(async ctx => {
    const session = (await ctx.db.get(sessionId))!;
    expect(session).toMatchObject(await inboxProjection(ctx, session));
  });
  await check();
  await t.mutation(internal.messaging.worker.claim, { eventId: accepted.eventId, token: 'claim' });
  await check();
  await t.mutation(internal.messaging.worker.updateProfile, { eventId: accepted.eventId, claimToken: 'claim', name: 'Guest Name' });
  await check();
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: accepted.eventId, claimToken: 'claim', text: 'Hello there', model: 'test' });
  await t.mutation(internal.messaging.worker.beginDispatch, { eventId: accepted.eventId, claimToken: 'claim' });
  await check();
  await t.mutation(internal.messaging.worker.fail, { eventId: accepted.eventId, claimToken: 'claim', rejected: true });
  await check();
  vi.advanceTimersByTime(10000);
  await t.mutation(internal.messaging.worker.claim, { eventId: accepted.eventId, token: 'retry' });
  await t.mutation(internal.messaging.worker.beginDispatch, { eventId: accepted.eventId, claimToken: 'retry' });
  await t.mutation(internal.messaging.worker.fail, { eventId: accepted.eventId, claimToken: 'retry', uncertain: true });
  await check();
  const newer = await acceptTestEvent(t, 'line', { eventKey: 'two', recipient: 'phase4-guest', eventType: 'message', messageText: 'Another question' });
  expect(newer.sessionId).toBe(sessionId);
  await check();
  await admin.mutation(api.messaging.adminReply.claim, { sessionId, requestId: 'staff', content: 'We can help' });
  await check();
  await admin.mutation(api.messaging.adminReply.complete, { requestId: 'staff' });
  await check();
  const listed = await admin.query(api.messaging.adminChat.listSessions, { status: 'all', empty: 'non_empty' });
  expect(listed.sessions[0].latestMessage?.content).toBe('We can help');
  expect(listed.sessions[0].latestLineEvent?._id).toBe(newer.eventId);
});

it('refuses oversized uninitialized aggregates atomically and verifies small-table dry runs', async () => {
  const t = convexTest(schema, modules), admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const propertyId = await t.run(async ctx => {
    const id = await ctx.db.insert('properties', property);
    for (let i = 0; i < 1001; i++) await ctx.db.insert('reviews', { propertyId: id, authorAvatarUrl: '', ...review });
    return id;
  });
  await expect(admin.mutation(api.catalog.adminReviews.create, { propertyId, ...review })).rejects.toThrow('bounded initialization');
  expect(await t.run(ctx => ctx.db.query('reviewStats').first())).toBeNull();
  expect(await t.run(ctx => ctx.db.query('reviews').collect())).toHaveLength(1001);
  const small = await t.run(ctx => ctx.db.insert('properties', { ...property, slug: 'small' }));
  await admin.mutation(api.catalog.adminReviews.create, { propertyId: small, ...review });
  const aggregate = await t.run(ctx => ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', small)).unique());
  await t.run(ctx => ctx.db.patch(aggregate!._id, { ratingTotal: undefined }));
  const initialize = makeFunctionReference<'mutation', { propertyId: typeof small; dryRun: boolean }>('catalog/reviewMaintenance:initialize');
  expect(await t.mutation(initialize, { propertyId: small, dryRun: true })).toEqual({ checked: 1, changed: true, ratingTotal: 4, totalReviews: 1 });
  expect(await t.run(ctx => ctx.db.get(aggregate!._id))).not.toHaveProperty('ratingTotal');
  await t.mutation(initialize, { propertyId: small, dryRun: false });
  expect(await t.mutation(initialize, { propertyId: small, dryRun: true })).toMatchObject({ changed: false });
});

it('keeps the durable Web delivery head exact through preparation and accepted completion', async () => {
  const t = convexTest(schema, modules);
  const { sessionId, guestToken } = await t.mutation(api.messaging.chat.createSession, { channel: 'web' });
  const { eventId } = await t.mutation(api.messaging.chat.sendMessage, { sessionId, guestToken, clientMessageId: crypto.randomUUID(), content: 'Hello' });
  const check = () => t.run(async ctx => {
    const session = (await ctx.db.get(sessionId))!;
    expect(session).toMatchObject(await inboxProjection(ctx, session));
    expect(session.lastDeliveryStatus?._id).toBe(eventId);
  });
  await check();
  await t.mutation(internal.messaging.worker.claim, { eventId, token: 'web-claim' });
  await check();
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId, claimToken: 'web-claim', text: 'Welcome', model: 'test', outcome: 'answered' });
  await check();
  await t.mutation(internal.messaging.worker.commitTurn, { eventId, claimToken: 'web-claim' });
  await check();
  const session = await t.run(ctx => ctx.db.get(sessionId));
  expect(session).toMatchObject({ inboxState: 'done', lastDeliveryStatus: { status: 'replied', dispatchState: 'sent' }, lastMessagePreview: { content: 'Welcome' } });
});
