// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { createHarness } from '../testing/harness';
import { LEASE_MS } from './pipeline';

const siteUrl = 'https://resort.example';
const recipient = '66912345678';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-13T06:00:00Z'));
  vi.stubEnv('SITE_URL', siteUrl);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

type Harness = ReturnType<typeof createHarness>;
async function claim(t: Harness, eventKey: string, messageText: string) {
  await t.mutation(internal.messaging.ingress.accept, { channel: 'whatsapp', events: [{ eventKey, eventType: 'message', recipient, messageText, eventTimestamp: Date.now() }] });
  const event = (await t.run(ctx => ctx.db.query('channelEvents').take(20))).find(row => row.eventKey === eventKey)!;
  const claimToken = `${eventKey}-claim`;
  await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: claimToken });
  return { event, args: { eventId: event._id, claimToken } };
}
async function setup() {
  const t = createHarness(convexTest);
  await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
  const property = (await t.run(ctx => ctx.db.query('properties').take(10))).find(row => row.status === 'active')!;
  const turn = await claim(t, 'prepare', 'Book a villa for Test Guest');
  const bookingArgs = { sessionId: turn.event.sessionId!, propertySlug: property.slug, checkIn: '2027-02-01', checkOut: '2027-02-03', guests: 2, guestName: 'Test Guest' };
  return { t, property, ...turn, bookingArgs };
}
function mockModel(calls: Array<{ name: string; args?: Record<string, unknown>; rawArgs?: string }>) {
  vi.stubEnv('AI_API_KEY', 'test-key');
  vi.stubEnv('AI_API_BASE_URL', 'https://ai.example.test/v1');
  vi.stubEnv('AI_SIMPLE_MODEL', 'openai/gpt-6-luna');
  vi.stubEnv('AI_COMPLEX_MODEL', 'openai/gpt-6-luna');
  const transport = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: transport.mock.calls.length === 1
    ? { content: null, tool_calls: calls.map((call, index) => ({ id: `call-${index}`, type: 'function', function: { name: call.name, arguments: call.rawArgs ?? JSON.stringify(call.args ?? {}) } })) }
    : { content: 'Please check with the host.' } }] })));
  vi.stubGlobal('fetch', transport);
  return transport;
}
async function complete(t: Harness, args: { eventId: import('../_generated/dataModel').Id<'channelEvents'>; claimToken: string }) {
  await t.mutation(internal.messaging.worker.prepareDispatch, { ...args, text: 'Reply yes to confirm', model: 'test', outcome: 'awaiting_guest' });
  await t.mutation(internal.messaging.worker.commitTurn, args);
  vi.setSystemTime(Date.now() + 1);
}
async function recover(t: Harness, args: { eventId: import('../_generated/dataModel').Id<'channelEvents'>; claimToken: string }) {
  vi.setSystemTime(Date.now() + LEASE_MS + 1);
  await t.mutation(internal.messaging.worker.claim, { eventId: args.eventId, token: 'recovery' });
  const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  const snapshot = () => t.run(async ctx => {
    const event = await ctx.db.get(args.eventId);
    return { event, session: await ctx.db.get(event!.sessionId!), bookings: await ctx.db.query('bookings').take(20), appointments: await ctx.db.query('appointments').take(20) };
  });
  const before = await snapshot();
  const result = await t.action(internal.concierge.runTurn.runTurn, { eventId: args.eventId, claimToken: 'recovery' });
  expect(transport).not.toHaveBeenCalled();
  expect(await snapshot()).toEqual(before);
  return result;
}

it('prepares changed villa dates twice in one real model response and confirms only after a separate yes', async () => {
  const { t, args, event, bookingArgs } = await setup();
  const transport = mockModel([
    { name: 'prepare_booking', args: bookingArgs },
    { name: 'prepare_booking', args: { ...bookingArgs, checkIn: '2027-02-04', checkOut: '2027-02-07' } },
    { name: 'confirm_booking' },
  ].map(call => ({ ...call, args: call.args ? Object.fromEntries(Object.entries(call.args).filter(([key]) => key !== 'sessionId')) : {} })));
  const reply = await t.action(internal.concierge.runTurn.runTurn, args);
  expect(reply.outcome).toBe('awaiting_guest');
  expect(reply.response).toContain('2027-02-04 → 2027-02-07');
  expect(reply.response).not.toContain('2027-02-01');
  expect(transport).toHaveBeenCalledTimes(1);
  const pending = (await t.run(ctx => ctx.db.get(event.sessionId!)))?.pendingBookingQuote;
  expect(pending).toMatchObject({ checkIn: '2027-02-04', checkOut: '2027-02-07' });
  expect(await t.run(ctx => ctx.db.query('bookings').withIndex('by_chatSession', q => q.eq('chatSessionId', event.sessionId!)).take(10))).toHaveLength(0);
  const recovered = await recover(t, args);
  expect(recovered).toMatchObject({ outcome: 'awaiting_guest', response: reply.response });
  await complete(t, { eventId: args.eventId, claimToken: 'recovery' });
  const yes = await claim(t, 'yes', 'yes');
  mockModel([{ name: 'confirm_booking' }]);
  const confirmed = await t.action(internal.concierge.runTurn.runTurn, yes.args);
  expect(confirmed.response).toContain('payment is pending');
  expect(await t.run(ctx => ctx.db.query('bookings').withIndex('by_chatSession', q => q.eq('chatSessionId', event.sessionId!)).take(10))).toMatchObject([{ checkIn: '2027-02-04', checkOut: '2027-02-07' }]);
});

it('does not reuse a failed service preparation for a corrected invocation in the same model response', async () => {
  const { t, event, args } = await setup();
  const serviceArgs = { serviceSlug: 'thai-massage', date: '2026-11-14', guestName: 'Test Guest' };
  const transport = mockModel([
    { name: 'prepare_service_booking', args: { ...serviceArgs, time: '03:00' } },
    { name: 'prepare_service_booking', args: { ...serviceArgs, time: '14:00' } },
  ]);
  const reply = await t.action(internal.concierge.runTurn.runTurn, args);
  expect(reply).toMatchObject({ outcome: 'awaiting_guest' });
  expect(reply.response).toContain('2026-11-14 14:00');
  expect(reply.response).toContain('THB 2,400');
  expect(transport).toHaveBeenCalledTimes(1);
  const writes = (await t.run(ctx => ctx.db.get(event._id)))!.toolResults!;
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[0].resultJson)).toHaveProperty('error');
  expect(JSON.parse(writes[1].resultJson)).toMatchObject({ price: 240000 });
  expect((await t.run(ctx => ctx.db.get(event.sessionId!)))?.pendingServiceQuote).toBeDefined();
  expect(await recover(t, args)).toMatchObject({ response: reply.response, outcome: 'awaiting_guest' });
});

it.each(['price', 'coupon'] as const)('recovers a revised-%s confirmation as a new confirmable proposal awaiting a separate yes', async change => {
  const { t, property, args, bookingArgs } = await setup();
  const couponId = change === 'coupon' ? await t.run(async ctx => {
    const id = await ctx.db.insert('coupons', { code: 'GUEST20', status: 'active', currentVersion: 1, used: 0, discountGranted: 0, createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'staff@example.com' });
    await ctx.db.insert('couponVersions', { couponId: id, version: 1, benefit: { kind: 'percent', percent: 2000 }, scope: 'accommodation', createdAt: Date.now(), createdByEmail: 'staff@example.com' });
    await ctx.db.insert('messages', { sessionId: bookingArgs.sessionId, role: 'user', content: 'Please use coupon GUEST20', timestamp: Date.now() });
    return id;
  }) : undefined;
  const original = await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, ...(couponId ? { couponCode: 'GUEST20' } : {}) });
  await complete(t, args);
  await t.run(async ctx => {
    if (couponId) {
      await ctx.db.insert('couponVersions', { couponId, version: 2, benefit: { kind: 'percent', percent: 2500 }, scope: 'accommodation', createdAt: Date.now(), createdByEmail: 'staff@example.com' });
      await ctx.db.patch(couponId, { currentVersion: 2 });
    } else await ctx.db.patch(property._id, { pricePerNight: property.pricePerNight + 12345 });
  });
  const yes = await claim(t, 'yes', 'yes');
  const revised = await t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId: yes.event.sessionId!, durableTool: { ...yes.args, key: 'confirm-call', name: 'confirm_booking' } });
  if (!revised.needsReview) throw new Error('Expected revised price');
  expect(revised.quote.total).not.toBe(original.total);
  const recovered = await recover(t, yes.args);
  expect(recovered).toMatchObject({ model: 'tool_recovery', outcome: 'awaiting_guest' });
  expect(recovered.response).toContain(`Confirm & pay: ${siteUrl}/booking/pay?proposal=${encodeURIComponent(revised.quote.confirmToken)}${couponId ? '&coupon=GUEST20' : ''}`);
  expect(recovered.response).toContain((revised.quote.total / 100).toLocaleString('en-US'));
  expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: revised.quote.confirmToken })).toMatchObject({ checkIn: bookingArgs.checkIn });
  expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: original.confirmToken })).toBeNull();
  const booked = await t.mutation(api.bookings.bookings.confirmProposal, { token: revised.quote.confirmToken });
  expect(booked.needsReview).toBe(false);
});

it.each(['before preparation', 'after a thrown villa error'] as const)('recovers safely after invalidation crashes %s', async crash => {
  const { t, args, event, bookingArgs } = await setup();
  const original = await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, durableTool: { ...args, key: 'first', name: 'prepare_booking' } });
  const durableTool = { ...args, key: 'replacement', name: 'prepare_booking' };
  await t.mutation(internal.bookings.bookings.invalidateChatProposal, { sessionId: event.sessionId!, kind: 'villa', deadlineAt: Date.now() + 20000, durableTool });
  if (crash === 'after a thrown villa error') {
    await expect(t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, guests: 9999, durableTool })).rejects.toThrow();
  }
  const writes = (await t.run(ctx => ctx.db.get(event._id)))!.toolResults!;
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ key: 'replacement', pending: true });
  expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: original.confirmToken })).toBeNull();
  const recovered = await recover(t, args);
  expect(recovered).toMatchObject({ model: 'tool_recovery', outcome: 'needs_staff' });
  expect(recovered.response).not.toContain('Villa booking proposal');
  expect((await t.run(ctx => ctx.db.get(event.sessionId!)))?.pendingBookingQuote).toBeUndefined();
});

it.each(['malformed JSON', 'invalid arguments'] as const)('invalidates an old proposal even when a real model replacement has %s', async failure => {
  const { t, args, bookingArgs } = await setup();
  const original = await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, durableTool: { ...args, key: 'first', name: 'prepare_booking' } });
  await complete(t, args);
  const replacement = await claim(t, 'replacement', 'Change my booking details');
  const { sessionId, ...input } = bookingArgs;
  mockModel([{ name: 'prepare_booking', ...(failure === 'malformed JSON' ? { rawArgs: '{' } : { args: { ...input, guests: 0 } }) }]);
  const reply = await t.action(internal.concierge.runTurn.runTurn, replacement.args);
  expect(reply.response).not.toContain('Villa booking proposal');
  expect((await t.run(ctx => ctx.db.get(sessionId)))?.pendingBookingQuote).toBeUndefined();
  expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: original.confirmToken })).toBeNull();
  const recovered = await recover(t, replacement.args);
  expect(recovered).toMatchObject({ model: 'tool_recovery', outcome: 'needs_staff' });
  expect(recovered.response).not.toContain('Confirm & pay');
  expect((await t.run(ctx => ctx.db.get(replacement.event._id)))!.toolResults).toHaveLength(1);
});

it('keeps real preparation retries idempotent and fences stale or superseded invocations before invalidation', async () => {
  const { t, args, event, bookingArgs } = await setup();
  const durableTool = { ...args, key: 'first', name: 'prepare_booking' };
  const invalidation = { sessionId: event.sessionId!, kind: 'villa' as const, deadlineAt: Date.now() + 20000, durableTool };
  await t.mutation(internal.bookings.bookings.invalidateChatProposal, invalidation);
  const first = await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, durableTool });
  const before = await t.run(ctx => ctx.db.get(event.sessionId!));
  await t.mutation(internal.bookings.bookings.invalidateChatProposal, invalidation);
  expect(await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, durableTool })).toEqual(first);
  expect(await t.run(ctx => ctx.db.get(event.sessionId!))).toEqual(before);
  expect((await t.run(ctx => ctx.db.get(event._id)))!.toolResults).toHaveLength(1);
  vi.setSystemTime(Date.now() + LEASE_MS + 1);
  await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: 'second' });
  await expect(t.mutation(internal.bookings.bookings.invalidateChatProposal, { ...invalidation, deadlineAt: Date.now() + 20000 })).rejects.toThrow('STALE_TURN');
  const resumed = { ...durableTool, claimToken: 'second' };
  await t.mutation(internal.bookings.bookings.invalidateChatProposal, { ...invalidation, durableTool: resumed, deadlineAt: Date.now() + 20000 });
  expect(await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, durableTool: resumed })).toEqual(first);
  const replacement = { ...resumed, key: 'replacement' };
  await t.mutation(internal.bookings.bookings.invalidateChatProposal, { ...invalidation, durableTool: replacement, deadlineAt: Date.now() + 20000 });
  const latest = await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, checkOut: '2027-02-04', durableTool: replacement });
  await expect(t.mutation(internal.bookings.bookings.invalidateChatProposal, { ...invalidation, durableTool: resumed, deadlineAt: Date.now() + 20000 })).rejects.toThrow('superseded');
  await expect(t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, durableTool: resumed })).rejects.toThrow('superseded');
  expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: latest.confirmToken })).toMatchObject({ checkOut: '2027-02-04' });
});

it('does not render a stored legacy proposal after its live quote was independently invalidated', async () => {
  const { t, args, event, bookingArgs } = await setup();
  await t.mutation(internal.bookings.bookings.prepareChatBooking, { ...bookingArgs, durableTool: { ...args, key: 'first', name: 'prepare_booking' } });
  await t.mutation(internal.bookings.bookings.invalidateChatProposal, { sessionId: event.sessionId!, kind: 'villa', deadlineAt: Date.now() + 20000, durableTurn: args });
  expect((await t.run(ctx => ctx.db.get(event._id)))!.toolResults).toHaveLength(1);
  const recovered = await recover(t, args);
  expect(recovered).toMatchObject({ outcome: 'needs_staff', model: 'tool_recovery' });
  expect(recovered.response).not.toContain('Confirm & pay');
});

it('never recovers an earlier success after a failed service replacement', async () => {
  const { t, args, event } = await setup();
  const input = { serviceSlug: 'thai-massage', date: '2026-11-14', guestName: 'Test Guest', time: '14:00' };
  await t.mutation(internal.services.serviceBookings.prepareChatServiceBooking, { ...input, sessionId: event.sessionId!, durableTool: { ...args, key: 'first', name: 'prepare_service_booking' } });
  const failure = await t.mutation(internal.services.serviceBookings.prepareChatServiceBooking, { ...input, time: '03:00', sessionId: event.sessionId!, durableTool: { ...args, key: 'replacement', name: 'prepare_service_booking' } });
  expect(failure).toHaveProperty('error');
  expect((await t.run(ctx => ctx.db.get(event.sessionId!)))?.pendingServiceQuote).toBeUndefined();
  const recovered = await recover(t, args);
  expect(recovered).toMatchObject({ model: 'tool_recovery', outcome: 'needs_staff' });
  expect(recovered.response).not.toContain('Service booking proposal');
  expect(recovered.response).not.toContain('14:00');
});

it('presents real service confirmations and both cancellation steps identically live and after crashes', async () => {
  const { t, args, event } = await setup();
  mockModel([{ name: 'prepare_service_booking', args: { serviceSlug: 'thai-massage', date: '2026-11-14', time: '14:00', guestName: 'Test Guest' } }]);
  const proposal = await t.action(internal.concierge.runTurn.runTurn, args);
  expect(proposal.outcome).toBe('awaiting_guest');
  await complete(t, args);
  const yes = await claim(t, 'service-yes', 'yes');
  mockModel([{ name: 'confirm_service_booking' }]);
  const confirmed = await t.action(internal.concierge.runTurn.runTurn, yes.args);
  expect(confirmed.response).toContain('THB 2,400');
  expect(confirmed.response).toContain('Payment is at the resort');
  expect(await recover(t, yes.args)).toMatchObject({ response: confirmed.response, outcome: 'answered' });
  const appointment = (await t.run(ctx => ctx.db.query('appointments').withIndex('by_chatSession', q => q.eq('chatSessionId', event.sessionId!)).take(10)))[0];
  expect(appointment.price).toBe(240000);
  await complete(t, { eventId: yes.args.eventId, claimToken: 'recovery' });
  const cancel = await claim(t, 'cancel', 'Cancel my service booking');
  mockModel([{ name: 'cancel_booking', args: { reference: appointment.confirmationCode } }]);
  const pending = await t.action(internal.concierge.runTurn.runTurn, cancel.args);
  expect(pending).toMatchObject({ outcome: 'awaiting_guest' });
  expect(pending.response).toContain('It has not been cancelled yet');
  expect(await recover(t, cancel.args)).toMatchObject({ response: pending.response, outcome: 'awaiting_guest' });
  await complete(t, { eventId: cancel.args.eventId, claimToken: 'recovery' });
  const cancelYes = await claim(t, 'cancel-yes', 'yes');
  mockModel([{ name: 'cancel_booking', args: { reference: appointment.confirmationCode } }]);
  const cancelled = await t.action(internal.concierge.runTurn.runTurn, cancelYes.args);
  expect(cancelled).toMatchObject({ outcome: 'answered' });
  expect(cancelled.response).toContain('Booking cancelled.');
  expect(await recover(t, cancelYes.args)).toMatchObject({ response: cancelled.response, outcome: 'answered' });
  expect(await t.run(ctx => ctx.db.get(appointment._id))).toMatchObject({ status: 'cancelled' });
});
