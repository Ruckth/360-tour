import { describe, expect, it } from 'vitest';
import type { Id, TableNames } from '../_generated/dataModel';
import {
	ATTRIBUTION_WINDOW_MS, buildAttribution, cleanLandingPath, cleanReferrerHost, isVisitorKey, newVisitorKey,
	touchFromLink, type MarketingTouch, type SessionTouch
} from './marketingAttribution';

const id = <T extends TableNames>(value: string) => value as Id<T>;
const now = Date.UTC(2026, 10, 8, 10);
const day = 24 * 60 * 60 * 1000;
const campaign = { name: 'Campaign 1', source: 'facebook', medium: 'paid_social' };
const f1 = touchFromLink({ _id: id('l_f1'), slug: 'f1', campaignId: id('c_1'), entry: 'link', placement: 'Story' }, campaign);
const q1 = touchFromLink({ _id: id('l_q1'), slug: 'q1', campaignId: id('c_2'), entry: 'qr' }, { name: 'Lobby card', source: 'print', medium: 'qr' });
const session = (name: string, daysAgo: number, touch?: MarketingTouch): SessionTouch => {
	const startedAt = now - daysAgo * day;
	const sessionId = id<'marketingSessions'>(name);
	return { sessionId, startedAt, ...(touch ? { touch: { ...touch, sessionId, touchedAt: startedAt } } : {}) };
};

describe('buildAttribution', () => {
	it('keeps the last link through a later direct visit, and the first link separately', () => {
		const result = buildAttribution({ sessions: [session('s3', 1), session('s1', 20, q1), session('s2', 5, f1)], now });
		expect(result).toMatchObject({ evidence: 'tracked', sessionId: 's3', last: { slug: 'f1', sessionId: 's2' }, first: { slug: 'q1', sessionId: 's1' } });
		expect(result?.last?.touchedAt).toBe(now - 5 * day);
	});

	it('ignores sessions older than 30 days and from the future', () => {
		const old = { ...session('old', 0, q1), startedAt: now - ATTRIBUTION_WINDOW_MS - 1 };
		const result = buildAttribution({ sessions: [old, session('late', -1, f1), session('today', 0)], now });
		expect(result).toEqual({ model: 'last_touch_30d@1', evidence: 'tracked', sessionId: 'today', capturedAt: now });
	});

	it('counts a session exactly 30 days old', () => {
		const edge = { ...session('edge', 0, q1), startedAt: now - ATTRIBUTION_WINDOW_MS };
		expect(buildAttribution({ sessions: [edge], now })?.last?.slug).toBe('q1');
	});

	it('uses the tab link when no consented session arrived through a link', () => {
		expect(buildAttribution({ sessions: [session('s1', 2)], currentLink: f1, now })).toMatchObject({ evidence: 'tracked', sessionId: 's1', last: f1, first: f1 });
	});

	it('falls back to the tab link before consent, with no session or time', () => {
		const result = buildAttribution({ sessions: [], currentLink: f1, now });
		expect(result).toEqual({ model: 'last_touch_30d@1', evidence: 'current_link', last: f1, capturedAt: now });
		expect(result?.last).not.toHaveProperty('touchedAt');
	});

	it('returns nothing without sessions or a link', () => {
		expect(buildAttribution({ sessions: [], now })).toBeUndefined();
	});
});

describe('touchFromLink', () => {
	it('freezes campaign name, source and medium and omits an empty placement', () => {
		expect(f1).toEqual({ linkId: 'l_f1', slug: 'f1', campaignId: 'c_1', campaignName: 'Campaign 1', source: 'facebook', medium: 'paid_social', entry: 'link', placement: 'Story' });
		expect(q1).not.toHaveProperty('placement');
	});
});

describe('input cleaning', () => {
	it('accepts only server-shaped visitor keys', () => {
		const key = newVisitorKey();
		expect(isVisitorKey(key)).toBe(true);
		expect(key).not.toBe(newVisitorKey());
		for (const bad of [undefined, '', 'mv_123', 'MV_' + '0'.repeat(32), 'mv_' + 'g'.repeat(32), key + 'x']) expect(isVisitorKey(bad)).toBe(false);
	});

	it.each([
		['/th/rooms/mossbell?mk=f1&coupon=X#top', '/th/rooms/mossbell'],
		['https://evil.example/x', '/'],
		['//evil.example', '/'],
		['/booking\n', '/booking'],
		['/' + 'a'.repeat(300), '/' + 'a'.repeat(199)],
	])('landing path %s', (raw, expected) => expect(cleanLandingPath(raw)).toBe(expected));

	it.each([
		['www.Facebook.com', 'facebook.com'],
		['l.instagram.com', 'l.instagram.com'],
		['book.auralis.example', undefined],
		['localhost', undefined],
		['not a host', undefined],
		[undefined, undefined],
	])('referrer host %s', (raw, expected) => expect(cleanReferrerHost(raw, 'book.auralis.example')).toBe(expected));
});
