// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const rules = { benefit: { kind: 'percent' as const, percent: 20 }, scope: 'accommodation' as const, minNights: 2, maxSaving: 3000 };
const quote = { code: 'dcnt-f1-20 ', propertySlug: 'mossbell', checkIn: '2026-11-10', checkOut: '2026-11-12' };
async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'Admin@example.com', tokenIdentifier: 'admin' });
  const propertyId = await t.run(ctx => ctx.db.insert('properties', {
    slug: 'mossbell', name: 'Mossbell', tagline: '', description: '', pricePerNight: 4500, currency: 'THB',
    maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 15, status: 'active',
  }));
  const campaignId = await admin.mutation(api.marketing.saveCampaign, { name: 'November escape', source: 'facebook', medium: 'social' });
  const { couponId } = await admin.mutation(api.marketing.saveCoupon, { ...rules, code: 'DCNT-F1-20', campaignId });
  const link = { slug: 'f1', name: 'November post', campaignId, destination: { kind: 'booking' as const, propertySlug: 'mossbell' }, entry: 'link' as const, couponId };
  return { t, admin, campaignId, couponId, propertyId, link };
}
beforeEach(() => {
  vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
  vi.useFakeTimers();
  // UTC date is Nov 6, Bangkok date is Nov 7.
  vi.setSystemTime(new Date('2026-11-06T18:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('marketing admin access', () => {
  it('requires admin for every admin query and mutation', async () => {
    const { t, campaignId, couponId, link } = await setup();
    const linkId = await t.run(ctx => ctx.db.insert('marketingLinks', { ...link, status: 'active', opens: 0, createdAt: 0, updatedAt: 0, updatedByEmail: '' }));
    const calls = [
      () => t.query(api.marketing.listCampaigns, {}),
      () => t.query(api.marketing.listLinks, {}),
      () => t.query(api.marketing.listCoupons, {}),
      () => t.query(api.marketing.getCoupon, { couponId }),
      () => t.query(api.marketing.checkSlug, { slug: 'f' }),
      () => t.query(api.marketing.testQuote, quote),
      () => t.mutation(api.marketing.saveCampaign, { name: 'x', source: 'x', medium: 'x' }),
      () => t.mutation(api.marketing.setCampaignStatus, { campaignId, status: 'active' }),
      () => t.mutation(api.marketing.saveLink, link),
      () => t.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' }),
      () => t.mutation(api.marketing.saveCoupon, { ...rules, code: 'NEW' }),
      () => t.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' }),
    ];
    for (const call of calls) await expect(call()).rejects.toThrow('Not authenticated');
    await expect(t.withIdentity({ email: 'guest@example.com' }).query(api.marketing.listCampaigns, {})).rejects.toThrow('Not authorized');
  });
});

describe('campaigns, links and resolution', () => {
  it('enriches indexed lists and details, preserves status, clears optional fields', async () => {
    const { t, admin, campaignId, couponId, link } = await setup();
    const linkId = await admin.mutation(api.marketing.saveLink, { ...link, placement: 'post', locale: 'th' });
    expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toBeNull();
    await admin.mutation(api.marketing.setCampaignStatus, { campaignId, status: 'active' });
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
    await t.mutation(api.marketing.recordOpen, { slug: 'f1', bot: false });
    expect(await admin.query(api.marketing.listCampaigns, { status: 'active' })).toMatchObject([{ linkCount: 1, couponCount: 1, opens: 1 }]);
    expect(await admin.query(api.marketing.listLinks, { campaignId, status: 'active' })).toMatchObject([{ campaignName: 'November escape', couponCode: 'DCNT-F1-20', shortUrlPath: '/f1', opens: 1 }]);
    expect(await admin.query(api.marketing.listLinks, { status: 'paused' })).toEqual([]);
    expect(await admin.query(api.marketing.listCoupons, { status: 'draft' })).toMatchObject([{ campaignName: 'November escape', rules: { version: 1 } }]);
    expect(await admin.query(api.marketing.getCoupon, { couponId })).toMatchObject({ versions: [{ version: 1 }], links: [{ shortUrlPath: '/f1' }] });
    const withoutCoupon = { ...link, couponId: undefined };
    await admin.mutation(api.marketing.saveLink, { ...withoutCoupon, linkId });
    const saved = await t.run(ctx => ctx.db.get(linkId));
    expect(saved).toMatchObject({ status: 'active', opens: 1, updatedByEmail: 'Admin@example.com', updatedAt: Date.now() });
    expect(saved?.couponId).toBeUndefined();
    expect(saved?.locale).toBeUndefined();
    expect(saved?.placement).toBeUndefined();
    await admin.mutation(api.marketing.saveCampaign, { campaignId, name: 'Updated', source: 'line', medium: 'messaging', budget: 100, startsOn: '2026-11-01' });
    await admin.mutation(api.marketing.saveCampaign, { campaignId, name: 'Updated', source: 'line', medium: 'messaging' });
    expect((await t.run(ctx => ctx.db.get(campaignId)))?.budget).toBeUndefined();
  });
  it('uses transactional slug uniqueness and validates references and locale', async () => {
    const { t, admin, campaignId, couponId, propertyId, link } = await setup();
    const linkId = await admin.mutation(api.marketing.saveLink, link);
    expect(await admin.query(api.marketing.checkSlug, { slug: 'f1' })).toMatchObject({ ok: false, reason: 'taken' });
    expect(await admin.query(api.marketing.checkSlug, { slug: 'f1', linkId })).toEqual({ ok: true, slug: 'f1' });
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toThrow('Slug taken');
    await admin.mutation(api.marketing.saveLink, { ...link, linkId, slug: 'r/anna' });
    expect(await admin.query(api.marketing.checkSlug, { slug: 'f1' })).toMatchObject({ ok: true });
    for (const slug of ['rooms', 'booking', 'en', 'zh-CN', 'r', '_next', 'offers']) {
      expect(await admin.query(api.marketing.checkSlug, { slug })).toMatchObject({ ok: false, reason: 'reserved' });
      await expect(admin.mutation(api.marketing.saveLink, { ...link, slug })).rejects.toThrow('Slug reserved');
    }
    await expect(admin.mutation(api.marketing.saveLink, { ...link, locale: '//evil' })).rejects.toThrow('Invalid locale');
    await expect(admin.mutation(api.marketing.saveLink, { ...link, destination: { kind: 'villa', propertySlug: 'missing' } })).rejects.toThrow('Property not found');
    await t.run(ctx => ctx.db.delete(propertyId));
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toThrow('Property not found');
    await t.run(ctx => ctx.db.delete(couponId));
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toThrow('Coupon not found');
    await t.run(ctx => ctx.db.delete(campaignId));
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toThrow('Campaign not found');
  });
  it('resolves all destinations, locale prefixes and offer lifecycle safely', async () => {
    const { t, admin, campaignId, couponId, link } = await setup();
    expect(await t.query(api.marketing.resolveLink, { slug: 'unknown' })).toBeNull();
    await admin.mutation(api.marketing.setCampaignStatus, { campaignId, status: 'active' });
    const linkId = await admin.mutation(api.marketing.saveLink, link);
    expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toMatchObject({ path: '/booking?property=mossbell&mk=f1', status: 'active', offerRemoved: false });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
    expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toMatchObject({ path: '/booking?property=mossbell&mk=f1&coupon=DCNT-F1-20', couponCode: 'DCNT-F1-20' });
    for (const status of ['paused', 'archived'] as const) {
      await admin.mutation(api.marketing.setLinkStatus, { linkId, status });
      expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toEqual({ path: '/booking?property=mossbell&mk=f1', status, offerRemoved: true, campaignName: 'November escape' });
    }
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'paused' });
    for (const [destination, path] of [
      [{ kind: 'home' }, '/th?mk=r%2Fanna'], [{ kind: 'booking' }, '/th/booking?mk=r%2Fanna'],
      [{ kind: 'villa', propertySlug: 'mossbell' }, '/th/rooms/mossbell?mk=r%2Fanna'],
      [{ kind: 'experiences' }, '/th/experiences?mk=r%2Fanna'], [{ kind: 'chat' }, '/th/chat?mk=r%2Fanna'],
    ] as const) {
      await admin.mutation(api.marketing.saveLink, { ...link, linkId, slug: 'r/anna', locale: 'th', destination });
      expect((await t.query(api.marketing.resolveLink, { slug: 'r/anna' }))?.path).toBe(path);
    }
  });
  it('records bot and paused opens, counting only active human opens, within 120 requests per minute', async () => {
    const { t, admin, campaignId, link } = await setup();
    await admin.mutation(api.marketing.setCampaignStatus, { campaignId, status: 'active' });
    const linkId = await admin.mutation(api.marketing.saveLink, link);
    await t.mutation(api.marketing.recordOpen, { slug: 'f1', bot: true });
    for (let i = 0; i < 121; i++) await t.mutation(api.marketing.recordOpen, { slug: 'f1', bot: false });
    expect((await t.run(ctx => ctx.db.get(linkId)))?.opens).toBe(119);
    expect(await t.run(ctx => ctx.db.query('marketingEvents').withIndex('by_link_and_time', q => q.eq('linkId', linkId)).take(500))).toHaveLength(120);
    vi.advanceTimersByTime(60_000);
    await t.mutation(api.marketing.recordOpen, { slug: 'f1', bot: false });
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'paused' });
    await t.mutation(api.marketing.recordOpen, { slug: 'f1', bot: false });
    expect((await t.run(ctx => ctx.db.get(linkId)))?.opens).toBe(120);
    await t.mutation(api.marketing.recordOpen, { slug: 'missing', bot: false });
  });
});

describe('coupon catalog and quote preview', () => {
  it('normalizes and versions rules immutably, locks used codes and enforces uniqueness', async () => {
    const { t, admin, couponId } = await setup();
    expect(await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'dcnt-f1-20 ', ...rules })).toEqual({ couponId, version: 1 });
    // Benefit field ordering must not create a spurious version.
    expect(await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'DCNT-F1-20', ...rules, benefit: { percent: 20, kind: 'percent' } })).toEqual({ couponId, version: 1 });
    const next = await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'DCNT-F1-20', ...rules, minNights: 3, terms: 'New terms' });
    expect(next.version).toBe(2);
    const detail = await admin.query(api.marketing.getCoupon, { couponId });
    expect(detail).toMatchObject({ status: 'draft', used: 0, discountGranted: 0, currentVersion: 2, updatedByEmail: 'Admin@example.com', versions: [{ version: 2, minNights: 3 }, { version: 1, minNights: 2 }] });
    await expect(admin.mutation(api.marketing.saveCoupon, { code: 'dcnt-f1-20', ...rules })).rejects.toThrow('Coupon code taken');
    await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'RENAMED', ...rules, minNights: 3, terms: 'New terms' });
    await t.run(ctx => ctx.db.patch(couponId, { used: 1 }));
    await expect(admin.mutation(api.marketing.saveCoupon, { couponId, code: 'CHANGED', ...rules })).rejects.toThrow('Cannot change a used coupon code');
  });
  it.each([
    { code: 'a' }, { benefit: { kind: 'percent' as const, percent: 101 } },
    { benefit: { kind: 'percent' as const, percent: 0.5 } }, { benefit: { kind: 'fixed' as const, amount: 0 } },
    { minNights: 0 }, { usageLimit: 1.5 }, { discountBudget: -1 }, { maxSaving: Infinity },
    { minEligibleSubtotal: 0 }, { bookFrom: '2026-11-31' },
    { bookFrom: '2026-12-01', bookTo: '2026-11-01' }, { stayFrom: '2026-12-01', stayTo: '2026-11-01' },
  ])('rejects invalid rules %j', async overrides => {
    const { admin } = await setup();
    await expect(admin.mutation(api.marketing.saveCoupon, { code: 'NEW-CODE', ...rules, ...overrides })).rejects.toThrow();
  });
  it('uses Bangkok today, tests drafts and paused coupons, exposes only OfferResult publicly', async () => {
    const { t, admin, couponId } = await setup();
    await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'DCNT-F1-20', ...rules, bookFrom: '2026-11-07', bookTo: '2026-11-07' });
    expect(await admin.query(api.marketing.testQuote, quote)).toMatchObject({ couponStatus: 'applied', total: 7200 });
    expect(await t.query(api.marketing.previewCoupon, quote)).toMatchObject({ couponStatus: 'invalid', problem: { code: 'not_active' }, total: 7650 });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'paused' });
    expect((await admin.query(api.marketing.testQuote, quote)).couponStatus).toBe('applied');
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
    const result = await t.query(api.marketing.previewCoupon, { ...quote, services: [{ label: 'Spa', amount: 1800 }] });
    expect(result).toMatchObject({ subtotal: 10800, total: 9000 });
    expect(Object.keys(result).sort()).toEqual(['allocation', 'applied', 'capped', 'couponDiscount', 'couponStatus', 'directDiscount', 'discount', 'subtotal', 'total'].sort());
    expect(await t.query(api.marketing.previewCoupon, { ...quote, code: 'UNKNOWN' })).toMatchObject({ couponStatus: 'invalid', problem: { code: 'not_found' }, total: 7650 });
    expect((await t.query(api.marketing.previewCoupon, { ...quote, code: '' })).couponStatus).toBe('none');
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'archived' });
    expect((await admin.query(api.marketing.testQuote, quote)).problem).toEqual({ code: 'not_active' });
    await expect(t.query(api.marketing.previewCoupon, { ...quote, checkOut: quote.checkIn })).rejects.toThrow('Invalid stay dates');
    await expect(t.query(api.marketing.previewCoupon, { ...quote, services: [{ label: 'Bad', amount: -1 }] })).rejects.toThrow('Invalid service amount');
  });
});
