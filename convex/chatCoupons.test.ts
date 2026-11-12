import { generateTestReply, respondTest } from './testing/turn.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { fixtureGuestToken, fixtureGuestTokenHash } from "./testing/fixtures.test-support";
import { expect, it, vi, afterEach } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
const modules = import.meta.glob('./**/*.ts');
const stay = { propertySlug: 'coupon-villa', checkIn: '2027-01-10', checkOut: '2027-01-12', guests: 2, guestName: 'Guest', guestPhone: '66811112222' };
async function setup(channel: 'web' | 'whatsapp' = 'web') {
  const t = convexTest(schema, modules);
  const data = await t.run(async ctx => {
    const propertyId = await ctx.db.insert('properties', { slug: stay.propertySlug, name: 'Coupon Villa', tagline: '', description: '', pricePerNight: 1000000, directDiscountPercent: 1500, currency: 'THB', maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], status: 'active' });
    const sessionId = await ctx.db.insert('conversations', { guestTokenHash: fixtureGuestTokenHash, channel, visitorPhone: stay.guestPhone, createdAt: Date.now() });
    const couponId = await ctx.db.insert('coupons', { code: 'GUEST20', status: 'active', currentVersion: 1, used: 0, discountGranted: 0, createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'staff@example.com' });
    const versionId = await ctx.db.insert('couponVersions', { couponId, version: 1, benefit: { kind: 'percent', percent: 2000 }, scope: 'accommodation', createdAt: Date.now(), createdByEmail: 'staff@example.com' });
    await ctx.db.insert('messages', { sessionId, role: 'user', content: 'Please use coupon GUEST20', timestamp: Date.now() });
    return { propertyId, sessionId, couponId, versionId };
  });
  return { t, ...data };
}
it('quotes the guest coupon through the offer engine without stacking, and confirms exactly once', async () => {
  const { t, sessionId, couponId } = await setup();
  const quote = await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'guest20' });
  expect(quote).toMatchObject({ total: 1600000, discountAmount: 400000, coupon: { code: 'GUEST20', status: 'applied', discount: 400000, version: 1 } });
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toEqual([]);
  const first = await t.mutation(api.bookings.bookings.confirmProposal, { token: quote.confirmToken });
  if (first.needsReview) throw new Error('Expected confirmation');
  const again = await t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId });
  expect(again).toMatchObject({ bookingId: first.bookingId, alreadyConfirmed: true, total: 1600000 });
  expect(await t.run(ctx => ctx.db.get(couponId))).toMatchObject({ held: 1, heldDiscount: 400000, used: 0 });
  expect(await t.run(ctx => ctx.db.query('couponRedemptions').collect())).toHaveLength(1);
});
it('rejects a model-invented code even when it exists in the catalog', async () => {
  const { t, sessionId } = await setup();
  await t.run(async ctx => { for (const row of await ctx.db.query('messages').collect()) await ctx.db.delete(row._id); });
  await expect(t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' })).rejects.toThrow('supplied');
});
it.each(['expired', 'full', 'version', 'price', 'budget'] as const)('returns a new quote for review when %s changes before yes, creating nothing', async change => {
  const { t, sessionId, couponId, versionId, propertyId } = await setup('whatsapp');
  const quote = await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' });
  await t.run(async ctx => {
    if (change === 'expired') await ctx.db.patch(versionId, { bookTo: '2026-01-01' });
    if (change === 'full') { await ctx.db.patch(versionId, { usageLimit: 1 }); await ctx.db.patch(couponId, { used: 1 }); }
    if (change === 'budget') await ctx.db.patch(versionId, { discountBudget: 350000 });
    if (change === 'price') await ctx.db.patch(propertyId, { pricePerNight: 1200000 });
    if (change === 'version') {
      await ctx.db.insert('couponVersions', { couponId, version: 2, benefit: { kind: 'percent', percent: 2500 }, scope: 'accommodation', createdAt: Date.now(), createdByEmail: 'staff@example.com' });
      await ctx.db.patch(couponId, { currentVersion: 2 });
    }
  });
  const changed = await t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId });
  expect(changed).toMatchObject({ needsReview: true });
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toEqual([]);
  expect(await t.run(ctx => ctx.db.query('couponRedemptions').collect())).toEqual([]);
  await expect(t.mutation(api.bookings.bookings.confirmProposal, { token: quote.confirmToken })).rejects.toThrow('expired');
  if (!changed.needsReview) throw new Error('Expected review');
  const confirmed = await t.mutation(api.bookings.bookings.confirmProposal, { token: changed.quote.confirmToken });
  expect(confirmed).toMatchObject({ total: change === 'price' ? 1920000 : change === 'version' ? 1500000 : change === 'budget' ? 1650000 : 1700000 });
});
it('shows unknown and weaker codes as refused or direct-price proposals', async () => {
  const { t, sessionId, versionId } = await setup();
  await t.mutation(internal.chat.acceptGuestMessage, { sessionId, content: 'coupon UNKNOWN' });
  const missing = await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'UNKNOWN' });
  expect(missing).toMatchObject({ total: 1700000, coupon: { status: 'invalid', problem: { code: 'not_found' } } });
  await t.run(ctx => ctx.db.patch(versionId, { benefit: { kind: 'percent', percent: 1000 } }));
  await t.mutation(internal.chat.acceptGuestMessage, { sessionId, content: 'Use coupon GUEST20 instead' });
  const weaker = await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' });
  expect(weaker).toMatchObject({ total: 1700000, coupon: { status: 'coupon_worse', discount: 200000 } });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function modelTool(name: string, args: Record<string, unknown>) {
  vi.stubEnv('AI_API_KEY', 'test-key');
  vi.stubEnv('AI_API_BASE_URL', 'https://ai.example.test/v1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: null,
    tool_calls: [{ id: 'coupon-tool', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}
it('web responds with an authoritative coupon preview and carries the code into a booking link', async () => {
  const { t, sessionId } = await setup();
  modelTool('preview_coupon', { couponCode: 'GUEST20', propertySlug: stay.propertySlug, checkIn: stay.checkIn, checkOut: stay.checkOut, guests: 2 });
  const reply = await respondTest(t, { guestToken: fixtureGuestToken, sessionId, userMessage: 'Quote coupon GUEST20 for my dates', locale: 'en' });
  expect(reply.response).toContain('save THB 4,000');
  expect(reply.response).toContain('THB 16,000');
  expect(reply.response).toContain('coupon=GUEST20');
  expect(reply.response).not.toContain('THB 13,600');
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toEqual([]);
});
it('messaging yes returns a new plain text summary after coupon expiry, with no completion claim', async () => {
  const { t, sessionId, versionId } = await setup('whatsapp');
  modelTool('prepare_booking', { ...stay, couponCode: 'GUEST20' });
  const initial = await generateTestReply(t, { sessionId, userMessage: 'Please book with GUEST20', channel: 'whatsapp', bookingFlow: true, siteUrl: 'https://resort.example' });
  expect(initial.response).toContain('coupon=GUEST20');
  expect(initial.response).toContain('save THB 4,000');
  await t.run(ctx => ctx.db.patch(versionId, { bookTo: '2026-01-01' }));
  modelTool('confirm_booking', {});
  const changed = await generateTestReply(t, { sessionId, userMessage: 'yes', channel: 'whatsapp', bookingFlow: true, siteUrl: 'https://resort.example' });
  expect(changed.response).toContain('Offer expired');
  expect(changed.response).toContain('THB 17,000');
  expect(changed.response).toContain('nothing is booked yet');
  expect(changed.response).toContain('Reply yes');
  expect(changed.response).not.toMatch(/booking card|buttons below|booking created/i);
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toEqual([]);
  const final = await generateTestReply(t, { sessionId, userMessage: 'yes', channel: 'whatsapp', bookingFlow: true });
  expect(final.response).toContain('payment is pending');
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('couponRedemptions').collect())).toHaveLength(0);
});
it('the last coupon slot cannot be held by a second reviewed quote', async () => {
  const { t, sessionId, versionId, couponId } = await setup();
  await t.run(ctx => ctx.db.patch(versionId, { usageLimit: 1 }));
  const { sessionId: secondSessionId } = await t.mutation(api.chat.createSession, { channel: 'web' });
  await t.mutation(internal.chat.acceptGuestMessage, { sessionId: secondSessionId, content: 'coupon GUEST20' });
  await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' });
  await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId: secondSessionId, ...stay, checkIn: '2027-01-20', checkOut: '2027-01-22', couponCode: 'GUEST20' });
  await t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId });
  const second = await t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId: secondSessionId });
  expect(second).toMatchObject({ needsReview: true, quote: { total: 1700000, coupon: { status: 'invalid', problem: { code: 'sold_out' } } } });
  expect(await t.run(ctx => ctx.db.get(couponId))).toMatchObject({ held: 1 });
  expect(await t.run(ctx => ctx.db.query('couponRedemptions').collect())).toHaveLength(1);
});
it('does not deliver a model-invented coupon offer without a verified tool result', async () => {
  const { t, sessionId } = await setup();
  vi.stubEnv('AI_API_KEY', 'test-key');
  vi.stubEnv('AI_API_BASE_URL', 'https://ai.example.test/v1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'Use coupon INVENTED90 to save 90% on any villa!' } }] }), { status: 200 })));
  const reply = await respondTest(t, { guestToken: fixtureGuestToken, sessionId, userMessage: 'Do you have a coupon for me?' });
  expect(reply.response).not.toContain('INVENTED90');
  expect(reply.response).toContain('check the current eligibility');
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toEqual([]);
});
it('a confirmed proposal reads the booking saving after staff corrections and hides it for a custom price', async () => {
  const { t, sessionId } = await setup();
  const quote = await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' });
  const confirmed = await t.mutation(api.bookings.bookings.confirmProposal, { token: quote.confirmToken });
  if (confirmed.needsReview) throw new Error('Expected confirmation');
  await t.run(async ctx => {
    const booking = await ctx.db.get(confirmed.bookingId);
    await ctx.db.patch(confirmed.bookingId, { total: 1650000, discountAmount: 350000, promotion: { ...booking!.promotion!, discount: 350000 } });
  });
  expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: quote.confirmToken })).toMatchObject({ total: 1650000, coupon: { discount: 350000 } });
  await t.run(ctx => ctx.db.patch(confirmed.bookingId, { priceOverride: { total: 1600000, quotedTotal: 1650000, reason: 'Agreed price', by: 'staff@example.com', at: Date.now() }, total: 1600000 }));
  expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: quote.confirmToken })).not.toHaveProperty('coupon');
  expect(await t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId })).not.toHaveProperty('coupon');
});
it('a fully covered stay cannot create an unpaid online booking or coupon hold', async () => {
  const { t, sessionId, versionId, couponId } = await setup();
  await t.run(ctx => ctx.db.patch(versionId, { benefit: { kind: 'percent', percent: 10000 } }));
  const quote = await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' });
  expect(quote.total).toBe(0);
  await expect(t.mutation(api.bookings.bookings.confirmProposal, { token: quote.confirmToken })).rejects.toThrow('covers the whole stay');
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toEqual([]);
  expect(await t.run(ctx => ctx.db.query('couponRedemptions').collect())).toEqual([]);
  expect((await t.run(ctx => ctx.db.get(couponId)))?.held ?? 0).toBe(0);
});
it('messaging confirmation and retries retain the frozen coupon saving in text and booking cards', async () => {
  const { t, sessionId, couponId } = await setup('whatsapp');
  modelTool('prepare_booking', { ...stay, couponCode: 'GUEST20' });
  await generateTestReply(t, { sessionId, userMessage: 'Please book with GUEST20', channel: 'whatsapp', bookingFlow: true });
  modelTool('confirm_booking', {});
  const confirmed = await generateTestReply(t, { sessionId, userMessage: 'yes', channel: 'whatsapp', bookingFlow: true });
  expect(confirmed.response).toContain('GUEST20: save THB 4,000');
  expect(confirmed.card?.items[0].lines.join(' ')).toContain('GUEST20: save THB 4,000');
  // A retry describes the committed booking; subsequent catalog changes cannot erase its saving.
  await t.run(ctx => ctx.db.patch(couponId, { status: 'paused' }));
  const repeated = await generateTestReply(t, { sessionId, userMessage: 'yes', channel: 'whatsapp', bookingFlow: true });
  expect(repeated.response).toContain('GUEST20: save THB 4,000');
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('couponRedemptions').collect())).toHaveLength(1);
});
it('does not accept CODE as guest evidence from a coupon-code question', async () => {
  const { t, sessionId, couponId } = await setup();
  await t.run(async ctx => {
    await ctx.db.patch(couponId, { code: 'CODE' });
    for (const row of await ctx.db.query('messages').collect()) await ctx.db.delete(row._id);
    await ctx.db.insert('messages', { sessionId, role: 'user', content: 'Do you have a coupon code?', timestamp: Date.now() });
  });
  await expect(t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'CODE' })).rejects.toThrow('supplied');
});
it('rejects a withdrawn or replaced guest code instead of reusing historical evidence', async () => {
  const { t, sessionId } = await setup();
  await t.mutation(internal.chat.acceptGuestMessage, { sessionId, content: 'Remove the coupon' });
  await expect(t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' })).rejects.toThrow('supplied');
  await t.run(async ctx => {
    const couponId = await ctx.db.insert('coupons', { code: 'GUEST30', status: 'active', currentVersion: 1, used: 0, discountGranted: 0, createdAt: Date.now(), updatedAt: Date.now(), updatedByEmail: 'staff@example.com' });
    await ctx.db.insert('couponVersions', { couponId, version: 1, benefit: { kind: 'percent', percent: 3000 }, scope: 'accommodation', createdAt: Date.now(), createdByEmail: 'staff@example.com' });
  });
  await t.mutation(internal.chat.acceptGuestMessage, { sessionId, content: 'Please use coupon GUEST30 instead' });
  await expect(t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' })).rejects.toThrow('supplied');
  expect(await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST30' })).toMatchObject({ total: 1400000, coupon: { code: 'GUEST30' } });
});

it('replaces an outstanding coupon proposal after withdrawal before creating anything', async () => {
  const { t, sessionId } = await setup();
  const original = await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay, couponCode: 'GUEST20' });
  await t.mutation(internal.chat.acceptGuestMessage, { sessionId, content: 'Remove the coupon' });
  const changed = await t.mutation(api.bookings.bookings.confirmProposal, { token: original.confirmToken });
  expect(changed).toMatchObject({ needsReview: true, quote: { total: 1700000 } });
  if (!changed.needsReview) throw new Error('Expected review');
  expect(changed.quote).not.toHaveProperty('coupon');
  expect(await t.run(ctx => ctx.db.query('bookings').collect())).toEqual([]);
  const confirmed = await t.mutation(api.bookings.bookings.confirmProposal, { token: changed.quote.confirmToken });
  expect(confirmed).toMatchObject({ total: 1700000 });
  expect(await t.run(ctx => ctx.db.query('couponRedemptions').collect())).toEqual([]);
});
