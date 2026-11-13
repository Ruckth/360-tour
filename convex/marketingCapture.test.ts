// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { createBookingRecord } from './lib/bookingWrites';
import { isVisitorKey, MAX_SESSIONS_READ, type MarketingCapture } from './shared/marketingAttribution';
import { resolveMarketingAttribution } from './marketing/attribution';

const modules = import.meta.glob('./**/*.ts');
const now = Date.parse('2026-11-07T10:00:00Z');
const day = 86_400_000;
const visitorKey = 'mv_' + '1'.repeat(32);
const email = 'admin@example.com';
const campaign = { name: 'November', source: 'facebook', medium: 'social' };
const stay = { propertySlug: 'mossbell', guestName: 'Mia', guestPhone: '+66811112222', checkIn: '2026-11-10', checkOut: '2026-11-12', guests: 2 };
const rules = { code: 'NOV20', benefit: { kind: 'percent' as const, percent: 2000 }, scope: 'accommodation' as const };

beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', email);
  vi.stubEnv('SITE_URL', 'https://book.example.com');
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email, tokenIdentifier: 'admin' });
  await t.run(ctx => ctx.db.insert('properties', {
    slug: 'mossbell', name: 'Mossbell', tagline: '', description: '', pricePerNight: 450000, currency: 'THB',
    maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 1500, status: 'active'
  }));
  const campaignId = await admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, campaign);
  const link = { slug: 'f1', name: 'Post', campaignId, destination: { kind: 'booking' as const }, entry: 'link' as const };
  const linkId = await admin.mutation(api.marketing.commands.saveLink.saveLink, link);
  await admin.mutation(api.marketing.commands.setLinkStatus.setLinkStatus, { linkId, status: 'active' });
  const start = (capture: MarketingCapture = {}) => t.mutation(api.marketing.public.startSession, { landingPath: '/booking', ...capture });
  const booking = async (marketing?: MarketingCapture) => {
    const { bookingId } = await t.mutation(api.bookings.bookings.create, { ...stay, guestEmail: 'mia@example.com', marketing });
    return (await t.run(ctx => ctx.db.get(bookingId)))!;
  };
  const session = (startedAt: number, linked = true) => t.run(ctx => ctx.db.insert('marketingSessions', {
    visitorKey, startedAt, landingPath: '/booking', ...(linked ? { linkId, campaignId } : {})
  }));
  const resolve = (capture: MarketingCapture) => t.run(async ctx => (await resolveMarketingAttribution(ctx, capture, now)) ?? null);
  return { t, admin, campaignId, linkId, link, start, booking, session, resolve };
}

describe('consented marketing sessions', () => {
  it.each([undefined, 'bad', 'mv_123'])('mints a visitor key for %s and reuses the minted key', async key => {
    const s = await setup();
    const first = await s.start({ visitorKey: key });
    expect(isVisitorKey(first.visitorKey)).toBe(true);
    expect(first.sessionId).not.toBeNull();
    const second = await s.start({ visitorKey: first.visitorKey });
    expect(second.visitorKey).toBe(first.visitorKey);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it.each(['active', 'paused', 'archived', 'draft', 'unknown'] as const)('captures only non-draft known links (%s)', async status => {
    const s = await setup();
    if (status !== 'unknown') await s.t.run(ctx => ctx.db.patch(s.linkId, { status }));
    const { sessionId } = await s.start({ visitorKey, slug: status === 'unknown' ? 'unknown' : 'f1' });
    const row = await s.t.run(ctx => ctx.db.get(sessionId!));
    expect(row?.visitorKey).toBe(visitorKey);
    if (status === 'draft' || status === 'unknown') {
      expect(row).not.toHaveProperty('linkId');
      expect(row).not.toHaveProperty('campaignId');
    } else expect(row).toMatchObject({ linkId: s.linkId, campaignId: s.campaignId });
  });

  it('sanitises paths and hosts, including the configured own host', async () => {
    const s = await setup();
    for (const [landingPath, referrerHost, path, host] of [
      ['/booking?secret=1#top', ' WWW.Facebook.com ', '/booking', 'facebook.com'],
      ['//evil.example', 'www.book.example.com', '/', undefined],
      ['https://evil.example', 'https://facebook.com/path', '/', undefined],
      ['/book\ning', 'not a host', '/booking', undefined],
    ] as const) {
      const { sessionId } = await s.t.mutation(api.marketing.public.startSession, { landingPath, referrerHost });
      const row = await s.t.run(ctx => ctx.db.get(sessionId!));
      expect(row?.landingPath).toBe(path);
      expect(row?.referrerHost).toBe(host);
    }
  });

  it('drops the 31st session per hour and resets after the window', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) expect((await s.start({ visitorKey })).sessionId).not.toBeNull();
    expect(await s.start({ visitorKey, slug: 'f1' })).toEqual({ visitorKey, sessionId: null });
    expect(await s.t.run(ctx => ctx.db.query('marketingSessions').take(100))).toHaveLength(30);
    vi.mocked(Date.now).mockReturnValue(now + 3_600_000);
    expect((await s.start({ visitorKey })).sessionId).not.toBeNull();
  });

  it('drops sessions when the global hourly budget is exhausted', async () => {
    const s = await setup();
    await s.t.run(ctx => ctx.db.insert('rateLimits', { key: 'marketing-session:global', count: 5000, expiresAt: now + 3_600_000 }));
    expect(await s.start({ visitorKey, slug: 'f1' })).toEqual({ visitorKey, sessionId: null });
    expect(await s.t.run(ctx => ctx.db.query('marketingSessions').take(1))).toEqual([]);
    expect(await s.t.run(ctx => ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', `marketing-session:${visitorKey}`)).unique())).toBeNull();
    expect((await s.t.run(ctx => ctx.db.get(s.linkId)))?.opens).toBe(0);
  });
});

describe('booking attribution', () => {
  it('stamps first and last linked sessions, ignores 31-day-old sessions and keeps the link through a later direct visit', async () => {
    const s = await setup();
    await s.session(now - 31 * day);
    const first = await s.session(now - 20 * day);
    const campaignId = await s.admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { name: 'Lobby', source: 'print', medium: 'qr' });
    const linkId = await s.admin.mutation(api.marketing.commands.saveLink.saveLink, { ...s.link, slug: 'q1', campaignId, entry: 'qr' });
    await s.admin.mutation(api.marketing.commands.setLinkStatus.setLinkStatus, { linkId, status: 'paused' });
    const last = await s.t.run(ctx => ctx.db.insert('marketingSessions', { visitorKey, linkId, campaignId, landingPath: '/', startedAt: now - 5 * day }));
    const direct = await s.session(now - day, false);
    const booking = await s.booking({ visitorKey, slug: 'f1' });
    expect(booking.marketingAttribution).toMatchObject({ evidence: 'tracked', sessionId: direct,
      first: { slug: 'f1', sessionId: first, campaignName: 'November' }, last: { slug: 'q1', sessionId: last, campaignName: 'Lobby' } });
    await s.admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { campaignId, name: 'Renamed', source: 'new', medium: 'new' });
    expect((await s.t.run(ctx => ctx.db.get(booking._id)))?.marketingAttribution).toEqual(booking.marketingAttribution);
  });

  it.each([{ slug: 'f1' }, { visitorKey: 'malformed', slug: 'f1' }])('stamps current_link with %j', async capture => {
    const s = await setup();
    const result = (await s.booking(capture)).marketingAttribution;
    expect(result).toMatchObject({ evidence: 'current_link', last: { slug: 'f1', campaignName: 'November' } });
    expect(result).not.toHaveProperty('sessionId');
    expect(result?.last).not.toHaveProperty('touchedAt');
  });

  it.each([undefined, { slug: 'unknown' }, { visitorKey: 'malformed' }, { visitorKey }])('omits unknown attribution (%j)', async capture => {
    const s = await setup();
    expect(await s.booking(capture)).not.toHaveProperty('marketingAttribution');
  });

  it('never attributes admin bookings even with valid sessions and slug', async () => {
    const s = await setup();
    await s.session(now - day);
    const { bookingId } = await s.t.run(ctx => createBookingRecord(ctx, { ...stay, source: 'admin', marketing: { visitorKey, slug: 'f1' } }));
    expect(await s.t.run(ctx => ctx.db.get(bookingId))).not.toHaveProperty('marketingAttribution');
  });

  it('records direct tracked visits, and falls back to the tab link if every session is unlinked', async () => {
    const s = await setup();
    const sessionId = await s.session(now - day, false);
    expect(await s.resolve({ visitorKey })).toEqual({ model: 'last_touch_30d@1', evidence: 'tracked', sessionId, session: { startedAt: now - day }, capturedAt: now });
    expect(await s.resolve({ visitorKey, slug: 'f1' })).toMatchObject({ evidence: 'tracked', first: { slug: 'f1' }, last: { slug: 'f1' } });
  });

  it.each(['link', 'campaign'] as const)('treats a deleted %s as an unlinked session', async missing => {
    const s = await setup();
    const sessionId = await s.session(now - day);
    await s.t.run(ctx => ctx.db.delete(missing === 'link' ? s.linkId : s.campaignId));
    // The frozen cohort keeps the recorded ids; reports simply find no live link or campaign for them.
    expect(await s.resolve({ visitorKey, slug: 'f1' })).toEqual({ model: 'last_touch_30d@1', evidence: 'tracked', sessionId, session: { startedAt: now - day, linkId: s.linkId, campaignId: s.campaignId }, capturedAt: now });
  });

  it('uses the session campaign even after its link moves to another campaign', async () => {
    const s = await setup();
    await s.session(now - day);
    const campaignId = await s.admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { name: 'Other', source: 'print', medium: 'qr' });
    await s.admin.mutation(api.marketing.commands.saveLink.saveLink, { ...s.link, linkId: s.linkId, campaignId });
    expect(await s.resolve({ visitorKey })).toMatchObject({ last: { campaignId: s.campaignId, campaignName: 'November' } });
    expect(await s.resolve({ slug: 'f1' })).toMatchObject({ last: { campaignId, campaignName: 'Other' } });
  });

  it('reads only the newest bounded sessions and excludes future sessions before limiting', async () => {
    const s = await setup();
    await s.session(now - day);
    for (let i = 0; i < MAX_SESSIONS_READ; i++) await s.session(now - i, false);
    await s.session(now + day);
    const result = await s.resolve({ visitorKey });
    expect(result).toMatchObject({ evidence: 'tracked' });
    expect(result).not.toHaveProperty('last');
  });

  it('ignores draft tab links and out-of-window sessions', async () => {
    const s = await setup();
    await s.session(now - 31 * day);
    await s.t.run(ctx => ctx.db.patch(s.linkId, { status: 'draft' }));
    expect(await s.resolve({ visitorKey, slug: 'f1' })).toBeNull();
  });
});

describe('web chat capture', () => {
  it('carries the capture through preparation and confirmation into the booking', async () => {
    const s = await setup();
    await s.session(now - day);
    const { sessionId } = await s.t.mutation(api.messaging.chat.createSession, { channel: 'web', marketing: { visitorKey, slug: ' f1 ' } });
    expect((await s.t.run(ctx => ctx.db.get(sessionId)))?.marketingCapture).toEqual({ visitorKey, slug: 'f1' });
    await s.t.mutation(internal.bookings.bookings.prepareChatBooking, { ...stay, sessionId });
    const result = await s.t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId });
    if (result.needsReview) throw new Error("Expected a confirmed booking");
    expect((await s.t.run(ctx => ctx.db.get(result.bookingId)))?.marketingAttribution).toMatchObject({ evidence: 'tracked', last: { slug: 'f1' } });
  });

  it.each([
    [{ visitorKey: 'bad', slug: 'booking' }, undefined],
    [{ visitorKey, slug: 'bad/slug' }, { visitorKey }],
    [{ visitorKey: 'bad', slug: 'f1' }, { slug: 'f1' }],
  ] as const)('keeps only valid capture fields (%j)', async (marketing, expected) => {
    const s = await setup();
    const { sessionId } = await s.t.mutation(api.messaging.chat.createSession, { channel: 'web', marketing });
    const row = await s.t.run(ctx => ctx.db.get(sessionId));
    expect(row?.marketingCapture).toEqual(expected);
    if (!expected) expect(row).not.toHaveProperty('marketingCapture');
  });

  it('refreshes the capture with each guest message, so a later tab or an opt-out is what the booking sees', async () => {
    const s = await setup();
    await s.session(now - day);
    const capture = async (sessionId: Id<'conversations'>) => (await s.t.run(ctx => ctx.db.get(sessionId)))?.marketingCapture;
    const say = (sessionId: Id<'conversations'>, role: 'user' | 'assistant', marketing?: { visitorKey?: string; slug?: string }) =>
      role === 'user'
        ? s.t.mutation(internal.messaging.chat.acceptGuestMessage, { sessionId, content: 'Hi', ...(marketing ? { marketing } : {}) })
        : s.t.mutation(internal.messaging.chat.addAssistantMessageWithSuggestions, { sessionId, content: 'Hi' });
    // Started before consent in a tab that arrived through /f1, then continued in a new tab with nothing.
    const { sessionId: stale } = await s.t.mutation(api.messaging.chat.createSession, { channel: 'web', marketing: { slug: 'f1' } });
    await say(stale, 'user');
    expect(await capture(stale)).toEqual({ slug: 'f1' });
    await say(stale, 'user', {});
    expect(await capture(stale)).toBeUndefined();
    await s.t.mutation(internal.bookings.bookings.prepareChatBooking, { ...stay, sessionId: stale });
    const unattributed = await s.t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId: stale });
    if (unattributed.needsReview) throw new Error("Expected a confirmed booking");
    expect(await s.t.run(ctx => ctx.db.get(unattributed.bookingId))).not.toHaveProperty('marketingAttribution');
    // Consent given after the chat started; assistant messages never change it.
    const { sessionId: later } = await s.t.mutation(api.messaging.chat.createSession, { channel: 'web' });
    await say(later, 'user', { visitorKey, slug: 'bad/slug' });
    await say(later, 'assistant', {});
    expect(await capture(later)).toEqual({ visitorKey });
  });

  it('lets the confirm-and-pay page replace the chat capture', async () => {
    const s = await setup();
    await s.session(now - day);
    const { sessionId } = await s.t.mutation(api.messaging.chat.createSession, { channel: 'web', marketing: { visitorKey } });
    const { confirmToken } = await s.t.mutation(internal.bookings.bookings.prepareChatBooking, { ...stay, sessionId });
    const result = await s.t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken, marketing: {} });
    if (result.needsReview) throw new Error("Expected a confirmed booking");
    expect(await s.t.run(ctx => ctx.db.get(result.bookingId))).not.toHaveProperty('marketingAttribution');
  });

  it('does not attribute a messaging booking even if a legacy session has a capture', async () => {
    const s = await setup();
    const sessionId = await s.t.run(ctx => ctx.db.insert('conversations', { channel: 'whatsapp', visitorPhone: '66811112222', marketingCapture: { slug: 'f1' }, createdAt: now }));
    await s.t.mutation(internal.bookings.bookings.prepareChatBooking, { ...stay, sessionId });
    const result = await s.t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId });
    if (result.needsReview) throw new Error("Expected a confirmed booking");
    expect(await s.t.run(ctx => ctx.db.get(result.bookingId))).not.toHaveProperty('marketingAttribution');
  });
});

describe('marketing history', () => {
  it('writes one created, updated and status event per entity, with only the changed business fields', async () => {
    const s = await setup();
    const { couponId } = await s.admin.mutation(api.marketing.commands.saveCoupon.saveCoupon, { ...rules, campaignId: s.campaignId });
    const rows = (entityType: string, entityId: string) => s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', entityType).eq('entityId', entityId)).take(20));
    const event = (entityType: string, entityId: string, kind: string, after: unknown, before?: unknown) => ({ entityType, entityId, actor: email, kind, after, ...(before ? { before } : {}), recordedAt: now, effectiveAt: now });
    // Ignore only Convex system fields, so extra business fields fail these exact comparisons.
    const events = async (entityType: string, entityId: string) => (await rows(entityType, entityId)).map(row => ({ entityType: row.entityType, entityId: row.entityId, actor: row.actor, kind: row.kind, after: row.after, ...(row.before === undefined ? {} : { before: row.before }), recordedAt: row.recordedAt, effectiveAt: row.effectiveAt }));
    await s.admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { ...campaign, campaignId: s.campaignId, name: 'Renamed', notes: 'New' });
    await s.admin.mutation(api.marketing.commands.setCampaignStatus.setCampaignStatus, { campaignId: s.campaignId, status: 'active' });
    expect(await events('marketingCampaign', s.campaignId)).toEqual([
      event('marketingCampaign', s.campaignId, 'created', campaign),
      event('marketingCampaign', s.campaignId, 'updated', { name: 'Renamed', notes: 'New' }, { name: campaign.name, notes: null }),
      event('marketingCampaign', s.campaignId, 'status_changed', { status: 'active' }, { status: 'draft' }),
    ]);
    await s.admin.mutation(api.marketing.commands.saveLink.saveLink, { ...s.link, linkId: s.linkId, name: 'Card', placement: 'Lobby' });
    await s.admin.mutation(api.marketing.commands.setLinkStatus.setLinkStatus, { linkId: s.linkId, status: 'paused' });
    expect(await events('marketingLink', s.linkId)).toEqual([
      event('marketingLink', s.linkId, 'created', { slug: 'f1', name: 'Post', campaign: campaign.name, destination: s.link.destination, entry: 'link' }),
      event('marketingLink', s.linkId, 'status_changed', { status: 'active' }, { status: 'draft' }),
      event('marketingLink', s.linkId, 'updated', { name: 'Card', placement: 'Lobby' }, { name: 'Post', placement: null }),
      event('marketingLink', s.linkId, 'status_changed', { status: 'paused' }, { status: 'active' }),
    ]);
    await s.admin.mutation(api.marketing.commands.saveCoupon.saveCoupon, { ...rules, couponId, code: 'NEW20' });
    await s.admin.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'active' });
    expect(await events('coupon', couponId)).toEqual([
      event('coupon', couponId, 'created', { code: rules.code, campaign: campaign.name }),
      event('coupon', couponId, 'version_added', { benefit: rules.benefit, scope: rules.scope, version: 1 }),
      event('coupon', couponId, 'updated', { code: 'NEW20', campaign: null }, { code: rules.code, campaign: 'Renamed' }),
      event('coupon', couponId, 'status_changed', { status: 'active' }, { status: 'draft' }),
    ]);
    const before = await s.t.run(ctx => ctx.db.query('recordChanges').take(100));
    await s.admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { ...campaign, campaignId: s.campaignId, name: 'Renamed', notes: 'New' });
    await s.admin.mutation(api.marketing.commands.saveLink.saveLink, { ...s.link, linkId: s.linkId, name: 'Card', placement: 'Lobby' });
    await s.admin.mutation(api.marketing.commands.saveCoupon.saveCoupon, { ...rules, couponId, code: 'NEW20' });
    await s.admin.mutation(api.marketing.commands.setCampaignStatus.setCampaignStatus, { campaignId: s.campaignId, status: 'active' });
    await s.admin.mutation(api.marketing.commands.setLinkStatus.setLinkStatus, { linkId: s.linkId, status: 'paused' });
    await s.admin.mutation(api.marketing.commands.setCouponStatus.setCouponStatus, { couponId, status: 'active' });
    expect(await s.t.run(ctx => ctx.db.query('recordChanges').take(100))).toEqual(before);
    const changedRules = { benefit: { kind: 'percent' as const, percent: 2500 }, scope: rules.scope };
    await s.admin.mutation(api.marketing.commands.saveCoupon.saveCoupon, { ...changedRules, couponId, code: 'NEW20' });
    const history = await events('coupon', couponId);
    expect(history[history.length - 1]).toEqual(event('coupon', couponId, 'version_added', { ...changedRules, version: 2 }));
    expect(await rows('coupon', couponId)).toHaveLength(5);
  });

  it('records clearing optional campaign and link fields as null', async () => {
    const s = await setup();
    await s.admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { ...campaign, campaignId: s.campaignId, budget: 10000 });
    await s.admin.mutation(api.marketing.commands.saveCampaign.saveCampaign, { ...campaign, campaignId: s.campaignId });
    await s.admin.mutation(api.marketing.commands.saveLink.saveLink, { ...s.link, linkId: s.linkId, placement: 'Lobby' });
    await s.admin.mutation(api.marketing.commands.saveLink.saveLink, { ...s.link, linkId: s.linkId });
    const latest = (entityType: string, entityId: Id<'marketingCampaigns'> | Id<'marketingLinks'>) => s.t.run(ctx => ctx.db.query('recordChanges').withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', entityType).eq('entityId', entityId)).order('desc').first());
    expect(await latest('marketingCampaign', s.campaignId)).toMatchObject({ before: { budget: 10000 }, after: { budget: null } });
    expect(await latest('marketingLink', s.linkId)).toMatchObject({ before: { placement: 'Lobby' }, after: { placement: null } });
  });
});
