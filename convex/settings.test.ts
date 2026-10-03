// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { SITE_DEFAULTS } from './lib/siteSettings';

const modules = import.meta.glob('./**/*.ts');
const DAY = 86_400_000;

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com, second@example.com');
	const t = convexTest(schema, modules);
	return { t, admin: t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' }) };
}

describe('settings get/update', () => {
	it('returns defaults until saved, then merges saved values', async () => {
		const { t, admin } = setup();
		const initial = await admin.query(api.settings.get, {});
		expect(initial.businessName).toBe(SITE_DEFAULTS.businessName);
		expect(initial.checkInTime).toBe('14:00');
		expect(initial.timezone).toBe('Asia/Bangkok');
		expect(initial.ai.maxWords).toBe(150);
		expect(initial.updatedAt).toBeNull();

		await admin.mutation(api.settings.update, {
			business: { businessName: '  Sea Breeze  ', currency: 'usd', checkInTime: '15:00', contactPhone: '' }
		});
		await admin.mutation(api.settings.update, { ai: { maxWords: 80 } });
		await admin.mutation(api.settings.update, { ai: { tone: 'playful' }, email: { fromName: 'Sea Breeze Team' } });

		const saved = await admin.query(api.settings.get, {});
		expect(saved).toMatchObject({
			businessName: 'Sea Breeze',
			currency: 'USD',
			checkInTime: '15:00',
			checkOutTime: '11:00',
			contactPhone: '',
			tagline: SITE_DEFAULTS.tagline,
			ai: { tone: 'playful', maxWords: 80 },
			email: { fromName: 'Sea Breeze Team', footer: SITE_DEFAULTS.email.footer },
			updatedByEmail: 'admin@example.com'
		});
		expect(await t.query(internal.settings.effective, {})).toMatchObject({ businessName: 'Sea Breeze' });
		expect(await t.run(async (ctx) => (await ctx.db.query('siteSettings').collect()).length)).toBe(1);
	});

	it('exposes only non-sensitive fields publicly', async () => {
		const { t, admin } = setup();
		await admin.mutation(api.settings.update, {
			business: { businessName: 'Sea Breeze' },
			ai: { extraInstructions: 'secret prompt' },
			email: { ownerNotificationEmail: 'owner@example.com' }
		});
		const profile = await t.query(api.settings.publicProfile, {});
		expect(profile.businessName).toBe('Sea Breeze');
		expect(profile).not.toHaveProperty('ai');
		expect(profile).not.toHaveProperty('email');
		expect(profile).not.toHaveProperty('updatedByEmail');
	});

	it.each([
		[{ business: { contactEmail: 'not-an-email' } }, 'Enter a valid email address.'],
		[{ business: { checkInTime: '2pm' } }, 'Use 24-hour HH:mm'],
		[{ business: { checkOutTime: '24:00' } }, 'Use 24-hour HH:mm'],
		[{ business: { businessName: '   ' } }, 'Business name is required.'],
		[{ business: { tagline: 'x'.repeat(201) } }, 'Tagline must be 200 characters or fewer.'],
		[{ business: { timezone: 'Mars/Base' } }, 'IANA time zone'],
		[{ business: { currency: 'baht' } }, '3-letter code'],
		[{ business: { lineUrl: 'line.me/x' } }, 'https://'],
		[{ ai: { maxWords: 29 } }, 'Max words must be a whole number from 30 to 400.'],
		[{ ai: { maxWords: 401 } }, 'Max words'],
		[{ ai: { maxWords: 100.5 } }, 'Max words'],
		[{ ai: { extraInstructions: 'x'.repeat(2001) } }, 'Extra instructions must be'],
		[{ email: { ownerNotificationEmail: 'owner@' } }, 'Enter a valid email address.'],
		[{ email: { fromName: 'Evil <x@y.z>' } }, 'Remove < > "']
	])('rejects invalid input %j', async (input, message) => {
		const { admin } = setup();
		await expect(admin.mutation(api.settings.update, input)).rejects.toThrow(message);
	});

	it('requires an admin for get, update, channelHealth, serverConfig and admins', async () => {
		const { t } = setup();
		const other = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
		await expect(t.query(api.settings.get, {})).rejects.toThrow('Not authenticated');
		await expect(other.query(api.settings.get, {})).rejects.toThrow('Not authorized');
		await expect(other.mutation(api.settings.update, { business: { businessName: 'X' } })).rejects.toThrow('Not authorized');
		await expect(other.query(api.settings.channelHealth, {})).rejects.toThrow('Not authorized');
		await expect(other.query(api.settings.serverConfig, {})).rejects.toThrow('Not authorized');
		await expect(other.query(api.settings.admins, {})).rejects.toThrow('Not authorized');
	});

	it('lists admins and reports env presence as booleans', async () => {
		const { admin } = setup();
		vi.stubEnv('RESEND_API_KEY', 're_secret');
		vi.stubEnv('STRIPE_SECRET_KEY', '');
		expect(await admin.query(api.settings.admins, {})).toEqual(['admin@example.com', 'second@example.com']);
		const config = await admin.query(api.settings.serverConfig, {});
		expect(config.RESEND_API_KEY).toBe(true);
		expect(config.STRIPE_SECRET_KEY).toBe(false);
		expect(Object.values(config).every((value) => typeof value === 'boolean')).toBe(true);
	});
});

describe('settings.channelHealth', () => {
	it('summarises webhook events and iCal sources per channel', async () => {
		const { t, admin } = setup();
		const now = Date.now();
		await t.run(async (ctx) => {
			const base = { eventType: 'message' as const, processingStartedAt: now };
			const line = (status: 'replied' | 'failed' | 'received', createdAt: number, extra = {}) =>
				ctx.db.insert('lineWebhookEvents', { ...base, eventKey: `${status}-${createdAt}`, status, createdAt, updatedAt: createdAt, ...extra });
			await line('replied', now - 3 * DAY, { processedAt: now - 3 * DAY + 500 });
			await line('failed', now - 2 * 3_600_000, { error: 'LINE 500' });
			await line('failed', now - 3 * DAY, { error: 'older' });
			await line('failed', now - 10 * DAY, { error: 'too old' });
			await line('received', now - 60_000);
			const propertyId = await ctx.db.insert('properties', {
				slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB',
				maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [],
				directDiscountPercent: 10, status: 'active'
			});
			await ctx.db.insert('icalSources', {
				propertyId, platform: 'airbnb', icalUrl: 'https://example.com/a.ics', lastSyncedAt: now - 1000, lastSyncError: 'Feed returned 404'
			});
		});

		const health = await admin.query(api.settings.channelHealth, {});
		const line = health.channels.find((channel) => channel.channel === 'line');
		expect(line).toMatchObject({
			lastEventAt: now - 60_000,
			lastRepliedAt: now - 3 * DAY + 500,
			failed24h: 1,
			failed7d: 2,
			failedCapped: false,
			latestError: { message: 'LINE 500' }
		});
		expect(health.channels.map((channel) => channel.channel)).toEqual(['line', 'facebook', 'instagram', 'whatsapp']);
		expect(health.channels.find((channel) => channel.channel === 'whatsapp')).toMatchObject({
			lastEventAt: null, lastRepliedAt: null, failed24h: 0, failed7d: 0, latestError: null
		});
		expect(health.ical).toEqual([
			expect.objectContaining({ propertyName: 'Pool Villa', platform: 'airbnb', lastSyncError: 'Feed returned 404' })
		]);
	});
});

describe('setup checklist', () => {
	it('reports env keys, villa readiness, iCal sync, saved profile and replied channels', async () => {
		const { t, admin } = setup();
		expect(await admin.query(api.settings.setupChecklist, {})).toEqual({
			aiKey: false, email: false, stripe: false, serverSecret: false, villaReady: false, icalSynced: false, profileSaved: false,
			channelsReplied: { line: false, facebook: false, instagram: false, whatsapp: false }
		});

		vi.stubEnv('AI_API_KEY', 'k');
		vi.stubEnv('RESEND_API_KEY', 'k');
		vi.stubEnv('STRIPE_SECRET_KEY', 'k');
		const now = Date.now();
		await t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', {
				slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 100, currency: 'THB',
				maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: ['https://example.com/a.webp'], amenities: [], tourRoomIds: [],
				directDiscountPercent: 0, status: 'active'
			});
			await ctx.db.insert('icalSources', { propertyId, platform: 'airbnb', icalUrl: 'https://example.com/a.ics', lastSyncedAt: now });
			await ctx.db.insert('lineWebhookEvents', {
				eventKey: 'e1', eventType: 'message', status: 'replied', createdAt: now, updatedAt: now, processingStartedAt: now
			});
		});
		await admin.mutation(api.settings.update, { business: { businessName: 'Sea Breeze' } });
		expect(await admin.query(api.settings.setupChecklist, {})).toMatchObject({
			aiKey: true, email: false, stripe: false, villaReady: true, icalSynced: true, profileSaved: true,
			channelsReplied: { line: true, facebook: false }
		});
		await expect(t.query(api.settings.setupChecklist, {})).rejects.toThrow();
	});

	it('sends a test email to the owner address, or explains what is missing', async () => {
		const { t, admin } = setup();
		expect(await admin.action(api.emails.sendTestEmail, {})).toMatchObject({ ok: false, to: 'admin@example.com' });

		vi.stubEnv('RESEND_API_KEY', 're_test');
		vi.stubEnv('EMAIL_FROM', 'bookings@example.com');
		vi.stubEnv('OWNER_NOTIFICATION_EMAIL', 'owner@example.com');
		const sent: Array<{ to: string; subject: string }> = [];
		vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
			sent.push(JSON.parse(String(init?.body ?? '{}')));
			return new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}));
		expect(await admin.action(api.emails.sendTestEmail, {})).toMatchObject({ ok: true, to: 'owner@example.com' });
		expect(sent).toEqual([expect.objectContaining({ to: 'owner@example.com' })]);
		await expect(t.action(api.emails.sendTestEmail, {})).rejects.toThrow();
	});
});

describe('settings in the AI prompt', () => {
	it('uses saved business name, policy, times, tone and word limit, and per-villa discounts', async () => {
		const { t, admin } = setup();
		vi.stubEnv('AI_API_KEY', 'test-key');
		vi.stubEnv('AI_API_BASE_URL', 'https://ai.example.test/v1');
		await admin.mutation(api.settings.update, {
			business: { businessName: 'Sea Breeze', cancellationPolicy: 'Free cancellation up to 7 days before arrival.', checkInTime: '15:00' },
			ai: { tone: 'cheerful and brief', maxWords: 90, extraInstructions: 'Always mention the sunset bar.' }
		});
		await t.run(async (ctx) => {
			await ctx.db.insert('properties', {
				slug: 'villa', name: 'Pool Villa', tagline: 'Pool', description: '', pricePerNight: 100, currency: 'THB',
				maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [],
				directDiscountPercent: 12, status: 'active'
			});
		});
		// Web chat routes straight to the concierge (no retired question-bank matching).
		const prompts: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
			prompts.push(JSON.parse(String(init?.body ?? '{}')).messages?.[0]?.content ?? '');
			return new Response(JSON.stringify({ choices: [{ message: { content: 'Hello!' } }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}));
		const sessionId = await t.run(async (ctx) =>
			await ctx.db.insert('chatSessions', { channel: 'web', visitorId: 'v1', lastSeenAt: Date.now(), createdAt: Date.now() })
		);

		await t.action(api.chatAi.respond, { sessionId, userMessage: 'Can I check live availability?' });
		const prompt = prompts.find((content) => content.includes('BUSINESS PROFILE')) ?? '';
		expect(prompt).toContain('Sea Breeze');
		expect(prompt).not.toContain('Auralis Cove Retreat');
		expect(prompt).toContain('Free cancellation up to 7 days before arrival.');
		expect(prompt).not.toContain('48 hours');
		// Prices and direct discounts come from the live tools, never baked into the prompt.
		expect(prompt).not.toContain('15%');
		expect(prompt).not.toContain('12%');
		expect(prompt).toContain('Prices and direct discounts must come from current tools');
		expect(prompt).toContain('Check-in from 15:00, check-out by 11:00');
		expect(prompt).toContain('Tone: cheerful and brief');
		expect(prompt).toContain('under 90 words');
		expect(prompt).toContain('Always mention the sunset bar.');
	});
});

describe('settings in emails', () => {
	it('uses the sender name, owner email and footer from settings with the EMAIL_FROM address', async () => {
		const { admin, t } = setup();
		vi.stubEnv('RESEND_API_KEY', 're_test');
		vi.stubEnv('EMAIL_FROM', 'Old Name <bookings@example.com>');
		vi.stubEnv('OWNER_NOTIFICATION_EMAIL', 'env-owner@example.com');
		await admin.mutation(api.settings.update, {
			email: { fromName: 'Sea Breeze Team', ownerNotificationEmail: 'owner@example.com', footer: 'See you soon' }
		});
		const sent: Array<{ from: string; to: string | string[]; html: string }> = [];
		vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
			sent.push(JSON.parse(String(init?.body ?? '{}')));
			return new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}));
		const booking = {
			guestName: 'Guest', guestEmail: 'guest@example.com', propertyName: 'Pool Villa', checkIn: '2026-10-01',
			checkOut: '2026-10-03', nights: 2, guests: 2, total: 200, currency: 'THB'
		};

		await t.action(internal.emails.sendOwnerNotification, { ...booking, guestPhone: '123' });
		await t.action(internal.emails.sendBookingConfirmation, booking);

		expect(sent[0]).toMatchObject({ from: '"Sea Breeze Team" <bookings@example.com>', to: 'owner@example.com' });
		expect(sent[1].from).toBe('"Sea Breeze Team" <bookings@example.com>');
		expect(sent[1].html).toContain('See you soon');
		expect(sent[1].html).not.toContain('Spin & Stay');
	});
});
