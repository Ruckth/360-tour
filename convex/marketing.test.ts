// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const rules = { benefit: { kind: 'percent' as const, percent: 2000 }, scope: 'accommodation' as const, minNights: 2, maxSaving: 300000 };
const quote = { code: 'dcnt-f1-20 ', propertySlug: 'mossbell', checkIn: '2026-11-10', checkOut: '2026-11-12' };
async function setup() {
  const t = convexTest(schema, modules);
  const admin = t.withIdentity({ email: 'Admin@example.com', tokenIdentifier: 'admin' });
  const propertyId = await t.run(ctx => ctx.db.insert('properties', {
    slug: 'mossbell', name: 'Mossbell', tagline: '', description: '', pricePerNight: 450000, currency: 'THB',
    maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 1500, status: 'active',
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
    await admin.mutation(api.marketing.saveCampaign, { campaignId, name: 'Updated', source: 'line', medium: 'messaging', budget: 10000, startsOn: '2026-11-01' });
    await admin.mutation(api.marketing.saveCampaign, { campaignId, name: 'Updated', source: 'line', medium: 'messaging' });
    expect((await t.run(ctx => ctx.db.get(campaignId)))?.budget).toBeUndefined();
  });
  it('uses transactional slug uniqueness and validates references and locale', async () => {
    const { t, admin, campaignId, couponId, propertyId, link } = await setup();
    const linkId = await admin.mutation(api.marketing.saveLink, link);
    expect(await admin.query(api.marketing.checkSlug, { slug: 'f1' })).toMatchObject({ ok: false, reason: 'taken' });
    expect(await admin.query(api.marketing.checkSlug, { slug: 'f1', linkId })).toEqual({ ok: true, slug: 'f1' });
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toMatchObject({ data: { code: 'slug_taken' } });
    await admin.mutation(api.marketing.saveLink, { ...link, linkId, slug: 'r/anna' });
    expect(await admin.query(api.marketing.checkSlug, { slug: 'f1' })).toMatchObject({ ok: true });
    for (const slug of ['rooms', 'booking', 'en', 'zh-CN', 'r', '_next', 'offers']) {
      expect(await admin.query(api.marketing.checkSlug, { slug })).toMatchObject({ ok: false, reason: 'reserved' });
      await expect(admin.mutation(api.marketing.saveLink, { ...link, slug })).rejects.toMatchObject({ data: { code: 'slug_reserved' } });
    }
    await expect(admin.mutation(api.marketing.saveLink, { ...link, locale: '//evil' })).rejects.toMatchObject({ data: { code: 'invalid_locale' } });
    await expect(admin.mutation(api.marketing.saveLink, { ...link, destination: { kind: 'villa', propertySlug: 'missing' } })).rejects.toMatchObject({ data: { code: 'property_not_found' } });
    await t.run(ctx => ctx.db.delete(propertyId));
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toMatchObject({ data: { code: 'property_not_found' } });
    await t.run(ctx => ctx.db.delete(couponId));
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toMatchObject({ data: { code: 'coupon_not_found' } });
    await t.run(ctx => ctx.db.delete(campaignId));
    await expect(admin.mutation(api.marketing.saveLink, link)).rejects.toMatchObject({ data: { code: 'campaign_not_found' } });
  });
  it('resolves all destinations, locale prefixes and offer lifecycle safely', async () => {
    const { t, admin, campaignId, couponId, link } = await setup();
    expect(await t.query(api.marketing.resolveLink, { slug: 'unknown' })).toBeNull();
    await admin.mutation(api.marketing.setCampaignStatus, { campaignId, status: 'active' });
    const linkId = await admin.mutation(api.marketing.saveLink, link);
    expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toBeNull(); // new links start as drafts
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
    expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toMatchObject({ path: '/booking?property=mossbell&mk=f1', status: 'active', offerRemoved: false });
    await expect(admin.mutation(api.marketing.saveLink, { ...link, linkId, slug: 'f2' })).rejects.toMatchObject({ data: { code: 'slug_locked' } });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
    expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toMatchObject({ path: '/booking?property=mossbell&mk=f1&coupon=DCNT-F1-20', couponCode: 'DCNT-F1-20' });
    for (const status of ['paused', 'archived'] as const) {
      await admin.mutation(api.marketing.setLinkStatus, { linkId, status });
      expect(await t.query(api.marketing.resolveLink, { slug: 'f1' })).toEqual({ path: '/booking?property=mossbell&mk=f1', status, offerRemoved: true });
    }
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'paused' });
    const annaId = await admin.mutation(api.marketing.saveLink, { ...link, slug: 'r/anna', locale: 'th' });
    await admin.mutation(api.marketing.setLinkStatus, { linkId: annaId, status: 'active' });
    for (const [destination, path] of [
      [{ kind: 'home' }, '/th?mk=r%2Fanna'], [{ kind: 'booking' }, '/th/booking?mk=r%2Fanna'],
      [{ kind: 'villa', propertySlug: 'mossbell' }, '/th/rooms/mossbell?mk=r%2Fanna'],
      [{ kind: 'experiences' }, '/th/experiences?mk=r%2Fanna'], [{ kind: 'chat' }, '/th/chat?mk=r%2Fanna'],
    ] as const) {
      await admin.mutation(api.marketing.saveLink, { ...link, linkId: annaId, slug: 'r/anna', locale: 'th', destination });
      expect((await t.query(api.marketing.resolveLink, { slug: 'r/anna' }))?.path).toBe(path);
    }
  });
  it('records bot and paused opens, counting only active human opens, within 120 requests per minute', async () => {
    const { t, admin, campaignId, link } = await setup();
    await admin.mutation(api.marketing.setCampaignStatus, { campaignId, status: 'active' });
    const linkId = await admin.mutation(api.marketing.saveLink, link);
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
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
    expect(await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'DCNT-F1-20', ...rules, benefit: { percent: 2000, kind: 'percent' } })).toEqual({ couponId, version: 1 });
    const next = await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'DCNT-F1-20', ...rules, minNights: 3, terms: 'New terms' });
    expect(next.version).toBe(2);
    const detail = await admin.query(api.marketing.getCoupon, { couponId });
    expect(detail).toMatchObject({ status: 'draft', used: 0, discountGranted: 0, currentVersion: 2, updatedByEmail: 'Admin@example.com', versions: [{ version: 2, minNights: 3 }, { version: 1, minNights: 2 }] });
    await expect(admin.mutation(api.marketing.saveCoupon, { code: 'dcnt-f1-20', ...rules })).rejects.toMatchObject({ data: { code: 'coupon_code_taken' } });
    await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'RENAMED', ...rules, minNights: 3, terms: 'New terms' });
    await t.run(ctx => ctx.db.patch(couponId, { used: 1 }));
    await expect(admin.mutation(api.marketing.saveCoupon, { couponId, code: 'CHANGED', ...rules })).rejects.toMatchObject({ data: { code: 'coupon_code_locked' } });
  });
  it.each([
    { code: 'a' }, { benefit: { kind: 'percent' as const, percent: 10100 } },
    { benefit: { kind: 'percent' as const, percent: 50 } }, { benefit: { kind: 'fixed' as const, amount: 0 } },
    { minNights: 0 }, { usageLimit: 1.5 }, { discountBudget: -100 }, { maxSaving: Infinity },
    { minEligibleSubtotal: 0 }, { bookFrom: '2026-11-31' },
    { bookFrom: '2026-12-01', bookTo: '2026-11-01' }, { stayFrom: '2026-12-01', stayTo: '2026-11-01' },
  ])('rejects invalid rules %j', async overrides => {
    const { admin } = await setup();
    await expect(admin.mutation(api.marketing.saveCoupon, { code: 'NEW-CODE', ...rules, ...overrides })).rejects.toThrow();
  });
  it('uses Bangkok today, tests drafts and paused coupons, exposes only OfferResult publicly', async () => {
    const { t, admin, couponId } = await setup();
    await admin.mutation(api.marketing.saveCoupon, { couponId, code: 'DCNT-F1-20', ...rules, bookFrom: '2026-11-07', bookTo: '2026-11-07' });
    expect(await admin.query(api.marketing.testQuote, quote)).toMatchObject({ couponStatus: 'applied', total: 720000 });
    expect(await t.query(api.marketing.previewCoupon, quote)).toMatchObject({ couponStatus: 'invalid', problem: { code: 'not_active' }, total: 765000 });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'paused' });
    expect((await admin.query(api.marketing.testQuote, quote)).couponStatus).toBe('applied');
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
    const result = await t.query(api.marketing.previewCoupon, { ...quote, services: [{ label: 'Spa', amount: 180000 }] });
    expect(result).toMatchObject({ subtotal: 1080000, total: 900000 });
    expect(Object.keys(result).sort()).toEqual(['allocation', 'applied', 'capped', 'couponDiscount', 'couponStatus', 'directDiscount', 'discount', 'subtotal', 'total'].sort());
    expect(await t.query(api.marketing.previewCoupon, { ...quote, code: 'UNKNOWN' })).toMatchObject({ couponStatus: 'invalid', problem: { code: 'not_found' }, total: 765000 });
    expect((await t.query(api.marketing.previewCoupon, { ...quote, code: '' })).couponStatus).toBe('none');
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'archived' });
    expect((await admin.query(api.marketing.testQuote, quote)).problem).toEqual({ code: 'not_active' });
    await expect(t.query(api.marketing.previewCoupon, { ...quote, checkOut: quote.checkIn })).rejects.toMatchObject({ data: { code: 'invalid_stay_dates' } });
    await expect(t.query(api.marketing.previewCoupon, { ...quote, services: [{ label: 'Bad', amount: -100 }] })).rejects.toMatchObject({ data: { code: 'invalid_service_amount' } });
  });
});


describe('marketing audit regressions', () => {
  it.each(['villa', 'booking'] as const)('requires a public %s destination on publish and active edits', async kind => {
    const { t, admin, propertyId, link } = await setup();
    const destination = { kind, propertySlug: 'mossbell' };
    const linkId = await admin.mutation(api.marketing.saveLink, { ...link, destination });
    for (const status of ['draft', 'archived'] as const) {
      await t.run(ctx => ctx.db.patch(propertyId, { status }));
      await expect(admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' }))
        .rejects.toThrow('villa_not_public');
      expect((await t.run(ctx => ctx.db.get(linkId)))?.status).toBe('draft');
    }
    await t.run(ctx => ctx.db.patch(propertyId, { status: 'active' }));
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
    await t.run(ctx => ctx.db.patch(propertyId, { status: 'draft' }));
    await expect(admin.mutation(api.marketing.saveLink, { ...link, linkId, destination }))
      .rejects.toThrow('villa_not_public');
    // Switching away from the non-public villa is allowed.
    await admin.mutation(api.marketing.saveLink, { ...link, linkId, destination: { kind: 'booking' } });
    await t.run(ctx => ctx.db.delete(propertyId));
    await expect(admin.mutation(api.marketing.saveLink, { ...link, linkId, destination }))
      .rejects.toThrow('villa_not_public');
  });

  it.each(['active', 'paused', 'archived'] as const)('never unlocks a link slug by returning from %s to draft', async status => {
    const { t, admin, link } = await setup();
    const linkId = await admin.mutation(api.marketing.saveLink, link);
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status });
    await expect(admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'draft' }))
      .rejects.toThrow('invalid_transition');
    await expect(admin.mutation(api.marketing.saveLink, { ...link, linkId, slug: 'renamed' }))
      .rejects.toThrow('locked');
    expect(await t.query(api.marketing.resolveLink, { slug: link.slug })).not.toBeNull();
  });

  it.each(['draft', 'active', 'paused'] as const)('prevents archived coupons returning to %s', async status => {
    const { t, admin, couponId } = await setup();
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'archived' });
    await expect(admin.mutation(api.marketing.setCouponStatus, { couponId, status }))
      .rejects.toThrow('invalid_transition');
    expect((await t.run(ctx => ctx.db.get(couponId)))?.status).toBe('archived');
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'archived' });
  });

  it('keeps campaigns on their forward lifecycle and unarchives only to ended', async () => {
    const { admin, campaignId } = await setup();
    for (const status of ['draft', 'active', 'paused', 'active', 'ended', 'archived', 'ended', 'archived'] as const) {
      await admin.mutation(api.marketing.setCampaignStatus, { campaignId, status });
      if (status !== 'draft') {
        await expect(admin.mutation(api.marketing.setCampaignStatus, { campaignId, status: 'draft' }))
          .rejects.toThrow('invalid_transition');
      }
      if (status === 'ended' || status === 'archived') {
        for (const target of ['active', 'paused'] as const) {
          await expect(admin.mutation(api.marketing.setCampaignStatus, { campaignId, status: target }))
            .rejects.toThrow('invalid_transition');
        }
      }
    }
  });

  it.each(['links', 'coupons'] as const)('marks campaign counts as lower bounds when %s hit the cap', async children => {
    const { t, admin, campaignId, link } = await setup();
    expect(await admin.query(api.marketing.listCampaigns, {})).toMatchObject([{ countsCapped: false }]);
    await t.run(async ctx => {
      for (let i = children === 'coupons' ? 1 : 0; i < 499; i++) {
        if (children === 'links') await ctx.db.insert('marketingLinks', {
          ...link, slug: `cap-${i}`, status: 'active', opens: 2, createdAt: 0, updatedAt: 0, updatedByEmail: '',
        });
        else {
          await ctx.db.insert('coupons', {
            code: `CAP-${i}`, campaignId, status: 'draft', currentVersion: 1, used: 0, discountGranted: 0,
            createdAt: 0, updatedAt: 0, updatedByEmail: '',
          });
        }
      }
    });
    expect(await admin.query(api.marketing.listCampaigns, {})).toMatchObject([{ countsCapped: false }]);
    for (let i = 499; i <= 500; i++) {
      await t.run(async ctx => {
        if (children === 'links') await ctx.db.insert('marketingLinks', {
          ...link, slug: `cap-${i}`, status: 'active', opens: 2, createdAt: 0, updatedAt: 0, updatedByEmail: '',
        });
        else await ctx.db.insert('coupons', {
          code: `CAP-${i}`, campaignId, status: 'draft', currentVersion: 1, used: 0, discountGranted: 0,
          createdAt: 0, updatedAt: 0, updatedByEmail: '',
        });
      });
      expect(await admin.query(api.marketing.listCampaigns, {})).toMatchObject([{
        countsCapped: true, ...(children === 'links' ? { linkCount: 500, opens: 1000 } : { couponCount: 500 }),
      }]);
    }
  });

  it('omits internal campaign names from public resolution, including draft campaigns', async () => {
    const { t, admin, link } = await setup();
    const linkId = await admin.mutation(api.marketing.saveLink, { ...link, locale: 'en' });
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
    expect(await t.query(api.marketing.resolveLink, { slug: link.slug })).toEqual({
      path: '/en/booking?property=mossbell&mk=f1', status: 'active', offerRemoved: false,
    });
  });

  it('returns null for malformed, wrong-table and deleted coupon ids while preserving auth', async () => {
    const { t, admin, campaignId, couponId } = await setup();
    await t.run(ctx => ctx.db.delete(couponId));
    for (const id of ['abc', '', campaignId, couponId]) {
      expect(await admin.query(api.marketing.getCoupon, { couponId: id })).toBeNull();
      await expect(t.query(api.marketing.getCoupon, { couponId: id })).rejects.toThrow('Not authenticated');
    }
  });

  it.each([-1, 0.6, NaN, Infinity, 1e308, 1_000_000_001, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe service amount %s in public and admin quotes', async amount => {
    const { t, admin } = await setup();
    const args = { ...quote, services: [{ label: 'Bad', amount }] };
    await expect(t.query(api.marketing.previewCoupon, args)).rejects.toThrow('invalid_service_amount');
    await expect(admin.query(api.marketing.testQuote, args)).rejects.toThrow('invalid_service_amount');
  });

  it('bounds service count at 50 and accepts zero and maximum satang prices', async () => {
    const { t } = await setup();
    const services = Array.from({ length: 50 }, (_, i) => ({ label: `Service ${i}`, amount: i ? 100000000 : 0 }));
    const result = await t.query(api.marketing.previewCoupon, { ...quote, services });
    expect(Number.isFinite(result.total)).toBe(true);
    expect(result.allocation.every((line, i) => line.discount <= (i ? services[i - 1].amount : 900000))).toBe(true);
    await expect(t.query(api.marketing.previewCoupon, { ...quote, services: [...services, { label: 'Extra', amount: 0 }] }))
      .rejects.toThrow('too_many_services');
  });

  it('rejects quotes above the subtotal ceiling in both quote handlers', async () => {
    const { t, admin, propertyId } = await setup();
    await t.run(ctx => ctx.db.patch(propertyId, { pricePerNight: 5000000000 }));
    await expect(t.query(api.marketing.previewCoupon, quote)).rejects.toThrow('invalid_quote_total');
    await expect(admin.query(api.marketing.testQuote, quote)).rejects.toThrow('invalid_quote_total');
  });

  it('exposes actionable structured validation errors in production responses', async () => {
    const { admin } = await setup();
    const cases = [
      [() => admin.mutation(api.marketing.saveCampaign, { name: '', source: 'fb', medium: 'social' }), 'missing_campaign_fields'],
      [() => admin.mutation(api.marketing.saveCampaign, { name: 'x', source: 'fb', medium: 'social', budget: -100 }), 'invalid_budget'],
      [() => admin.mutation(api.marketing.saveCoupon, { ...rules, code: 'AB' }), 'invalid_coupon_code'],
      [() => admin.mutation(api.marketing.saveCoupon, { ...rules, code: 'NEW', usageLimit: 0 }), 'invalid_coupon_limits'],
      [() => admin.mutation(api.marketing.saveCoupon, { ...rules, code: 'NEW', bookFrom: 'bad' }), 'invalid_date_range'],
      [() => admin.mutation(api.marketing.saveCoupon, { ...rules, code: 'NEW', benefit: { kind: 'percent', percent: 10100 } }), 'invalid_coupon_benefit'],
      [() => admin.query(api.marketing.testQuote, { ...quote, checkOut: quote.checkIn }), 'invalid_stay_dates'],
    ] as const;
    for (const [call, code] of cases) {
      await expect(call()).rejects.toMatchObject({ data: { code, message: expect.any(String) } });
    }
  });
});


describe('marketing destination and pricing follow-up regressions', () => {
  it.each(['villa', 'booking'] as const)('falls back safely if a published %s destination is later unpublished', async kind => {
    const { t, admin, couponId, propertyId, link } = await setup();
    const linkId = await admin.mutation(api.marketing.saveLink, { ...link, locale: 'en', destination: { kind, propertySlug: 'mossbell' } });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
    await admin.mutation(api.marketing.setLinkStatus, { linkId, status: 'active' });
    for (const status of ['draft', 'archived'] as const) {
      await t.run(ctx => ctx.db.patch(propertyId, { status }));
      expect(await t.query(api.marketing.resolveLink, { slug: link.slug })).toEqual({
        path: '/en/booking?mk=f1', status: 'active', offerRemoved: true,
      });
    }
    await t.run(ctx => ctx.db.delete(propertyId));
    expect(await t.query(api.marketing.resolveLink, { slug: link.slug })).toEqual({
      path: '/en/booking?mk=f1', status: 'active', offerRemoved: true,
    });
  });
  it('reports fractional accommodation pricing with an actionable error before invoking the satang engine', async () => {
    const { t, propertyId } = await setup();
    await t.run(ctx => ctx.db.patch(propertyId, { pricePerNight: 0.6, directDiscountPercent: 10000 }));
    await expect(t.query(api.marketing.previewCoupon, { ...quote, checkOut: '2026-11-11' }))
      .rejects.toThrow('invalid_accommodation_amount');
  });
});

describe('POS coupon ledger', () => {
  it('lists consumed checkout uses with the order title, formatted receipt and frozen customer name', async () => {
    const { t, admin } = await setup();
    const { couponId } = await admin.mutation(api.marketing.saveCoupon, { code: 'SPA-500', benefit: { kind: 'fixed', amount: 50000 }, scope: 'services' });
    await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
    const staffId = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] });
    const serviceId = await admin.mutation(api.services.commands.createService.createService, { slug: 'spa', name: 'Spa', description: '', category: 'Spa', durationMin: 60, bufferMin: 0, price: 180000, currency: 'THB', staffIds: [staffId] });
    const { orderId } = await admin.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'service', serviceId } });
    const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: 'Anna Lee' });
    await admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId });
    await admin.mutation(api.pos.commands.applyOrderCoupon.applyOrderCoupon, { orderId, code: 'SPA-500' });
    const view = (await admin.query(api.pos.orders.getOrder, { orderId }))!;
    await admin.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, idempotencyKey: 'ledger-pos-pay-001', expectedRevision: view.order.revision, expectedDue: 130000, expectedCustomerRevision: 0, tenders: [{ method: 'cash', amount: 130000 }] });
    const detail = await admin.query(api.marketing.getCoupon, { couponId });
    expect(detail?.redemptions).toMatchObject([{ state: 'consumed', discount: 50000, order: { orderId, title: 'Order #1', receiptNumber: 'R-000001', customerName: 'Anna Lee' } }]);
    expect(detail?.redemptions[0].booking).toBeUndefined();
    await t.run(ctx => ctx.db.patch(customerId, { name: 'Changed later' }));
    expect((await admin.query(api.marketing.getCoupon, { couponId }))?.redemptions[0].order?.customerName).toBe('Anna Lee');
  });
});
