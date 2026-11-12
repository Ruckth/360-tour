import { v } from 'convex/values';
import { internalQuery, mutation, query, type QueryCtx } from './auth/model';
import { appendRecordHistory } from './lib/recordHistory';
import { settingsSnapshot } from './lib/configurationHistory';
import {
	bookingRulesValidator,
	BOOKING_RULE_RANGES,
	resolveBookingRules,
	BUSINESS_FIELDS,
	mergeSiteSettings,
	type BookingRules,
	type SettingsInput
} from './lib/siteSettings';
import { adminEmails, requireAdmin, requireOwner } from './lib/adminAuth';
import {
	getEffectiveSettings,
	getSiteSettingsRow,
	validateSettingsInput,
	type EffectiveSettings
} from './lib/siteSettings';

const text = v.optional(v.string());

export const get = query({
	args: {},
	handler: async (ctx): Promise<EffectiveSettings & { revision: number }> => {
		await requireAdmin(ctx);
		const row = await getSiteSettingsRow(ctx);
		return { ...mergeSiteSettings(row), revision: row?.revision ?? 0 };
	}
});

/** Settings for server-side code (actions such as emails and the AI concierge). */
export const effective = internalQuery({
	args: {},
	handler: async (ctx): Promise<EffectiveSettings> => await getEffectiveSettings(ctx)
});

/** Non-sensitive profile fields; safe for any visitor. */
export const publicProfile = query({
	args: {},
	handler: async (ctx) => {
		const s = await getEffectiveSettings(ctx);
		return {
			businessName: s.businessName,
			tagline: s.tagline,
			contactEmail: s.contactEmail,
			contactPhone: s.contactPhone,
			whatsapp: s.whatsapp,
			lineId: s.lineId,
			lineUrl: s.lineUrl,
			address: s.address,
			currency: s.currency,
			timezone: s.timezone,
			checkInTime: s.checkInTime,
			checkOutTime: s.checkOutTime,
			bookingRules: s.bookingRules
		};
	}
});

export const update = mutation({
	args: {
		expectedRevision: v.optional(v.number()),
		bookingRules: v.optional(bookingRulesValidator),
		business: v.optional(
			v.object({
				businessName: text,
				tagline: text,
				contactEmail: text,
				contactPhone: text,
				whatsapp: text,
				lineId: text,
				lineUrl: text,
				address: text,
				currency: text,
				timezone: text,
				checkInTime: text,
				checkOutTime: text,
				cancellationPolicy: text
			})
		),
		ai: v.optional(v.object({ tone: text, extraInstructions: text, maxWords: v.optional(v.number()) })),
		email: v.optional(v.object({ fromName: text, ownerNotificationEmail: text, footer: text }))
	},
	handler: async (ctx, args) => {
		const admin = await requireOwner(ctx);
		const { business, ai, email, bookingRules, errors } = validateSettingsInput(args);
		const firstError = Object.values(errors)[0];
		if (firstError) throw new Error(firstError);

		const row = await getSiteSettingsRow(ctx);
		if (args.expectedRevision !== undefined && args.expectedRevision !== (row?.revision ?? 0)) throw new Error('Settings changed. Review the latest configuration and try again.');
		const before = mergeSiteSettings(row);
		const fields = {
			revision: (row?.revision ?? 0) + 1,
			...business,
			...(bookingRules ? { bookingRules: { ...row?.bookingRules, ...bookingRules } } : {}),
			...(ai ? { ai: { ...row?.ai, ...ai } } : {}),
			...(email ? { email: { ...row?.email, ...email } } : {}),
			updatedAt: Date.now(),
			updatedByEmail: admin.email
		};
		if (row) await ctx.db.patch(row._id, fields);
		else await ctx.db.insert('siteSettings', { key: 'default', ...fields });
		await appendRecordHistory(ctx, { entityType: 'settings', entityId: 'default', actor: admin.email, kind: 'updated', before: settingsSnapshot(before), after: settingsSnapshot(await getEffectiveSettings(ctx)),
		 ...(ai?.extraInstructions !== undefined && ai.extraInstructions !== before.ai.extraInstructions ? { reason: 'AI instructions changed; instruction text is excluded from history.' } : {}) });
		return null;
	}
});

/** Restore a selected safe snapshot as a new validated revision. Never touches AI instructions/provider configuration. */
export const restore = mutation({
	args: {
		historyId: v.id('recordChanges'),
		expectedRevision: v.number(),
		side: v.union(v.literal('before'), v.literal('after'))
	},
	handler: async (ctx, args) => {
		const admin = await requireOwner(ctx);
		const row = await getSiteSettingsRow(ctx);
		if (args.expectedRevision !== (row?.revision ?? 0))
			throw new Error('Settings changed. Review the latest configuration and try again.');
		const event = await ctx.db.get(args.historyId);
		if (!event || event.entityType !== 'settings' || event.entityId !== 'default')
			throw new Error('Settings history not found');
		const saved: unknown = event[args.side];
		if (!saved || typeof saved !== 'object') throw new Error('This entry has no restorable configuration');
		const source = saved as Record<string, unknown>;
		const business: Record<string, string> = {};
		for (const field of BUSINESS_FIELDS) {
			if (typeof source[field] !== 'string') throw new Error('Incomplete settings snapshot');
			business[field] = source[field];
		}

		const ai = source.ai as Record<string, unknown> | undefined;
		const email = source.email as Record<string, unknown> | undefined;
		if (
			!ai ||
			typeof ai.tone !== 'string' ||
			typeof ai.maxWords !== 'number' ||
			!email ||
			['fromName', 'ownerNotificationEmail', 'footer'].some((key) => typeof email[key] !== 'string')
		)
			throw new Error('Incomplete settings snapshot');
		const rules: Partial<BookingRules> = {};
		if (source.bookingRules && typeof source.bookingRules === 'object') {
			const savedRules = source.bookingRules as Record<string, unknown>;
			for (const key of Object.keys(BOOKING_RULE_RANGES) as (keyof typeof BOOKING_RULE_RANGES)[]) {
				if (typeof savedRules[key] !== 'number') throw new Error('Incomplete booking rules snapshot');
				rules[key] = savedRules[key];
			}
			if (typeof savedRules.sameDayCutoff !== 'string') throw new Error('Incomplete booking rules snapshot');
			rules.sameDayCutoff = savedRules.sameDayCutoff;
		}
		const input: SettingsInput = {
			// History predating booking rules restores their built-in defaults.
			bookingRules: source.bookingRules ? rules : resolveBookingRules(null),
			business,
			ai: { tone: ai.tone, maxWords: ai.maxWords },
			email: {
				fromName: email.fromName as string,
				ownerNotificationEmail: email.ownerNotificationEmail as string,
				footer: email.footer as string
			}
		};
		const clean = validateSettingsInput(input);
		const problem = Object.values(clean.errors)[0];
		if (problem) throw new Error(problem);
		const before = settingsSnapshot(mergeSiteSettings(row));
		const fields = {
			...clean.business,
			bookingRules: clean.bookingRules,
			ai: { ...row?.ai, ...clean.ai },
			email: { ...row?.email, ...clean.email },
			revision: (row?.revision ?? 0) + 1,
			updatedAt: Date.now(),
			updatedByEmail: admin.email
		};
		if (row) await ctx.db.patch(row._id, fields);
		else await ctx.db.insert('siteSettings', { key: 'default', ...fields });
		await appendRecordHistory(ctx, {
			entityType: 'settings',
			entityId: 'default',
			actor: admin.email,
			kind: 'restored',
			before,
			after: settingsSnapshot(await getEffectiveSettings(ctx)),
			reason: 'Restored safe configuration from a history entry; AI instructions are retained.'
		});
		return { ...(await getEffectiveSettings(ctx)), revision: fields.revision };
	}
});

const DAY_MS = 86_400_000;
const FAILED_SCAN_LIMIT = 500;
const CHANNEL_TABLES = {
	line: 'channelEvents',
	facebook: 'channelEvents',
	instagram: 'channelEvents',
	whatsapp: 'channelEvents'
} as const;

export type ChannelKey = keyof typeof CHANNEL_TABLES;

async function channelStats(ctx: QueryCtx, channel: ChannelKey, now: number) {
	const byStatus = (status: 'replied' | 'failed') =>
		ctx.db.query('channelEvents').withIndex('by_channel_and_status_and_createdAt', (q) => q.eq('channel', channel).eq('status', status));
	const latest = await ctx.db.query('channelEvents').withIndex('by_channel_and_createdAt', q => q.eq('channel', channel)).order('desc').first();
	const replied = await byStatus('replied').order('desc').first();
	const latestFailure = await byStatus('failed').order('desc').first();
	// Bounded: counts stop at FAILED_SCAN_LIMIT (the UI shows "500+").
	const failedWeek = await ctx.db
		.query('channelEvents')
		.withIndex('by_channel_and_status_and_createdAt', (q) => q.eq('channel', channel).eq('status', 'failed').gte('createdAt', now - 7 * DAY_MS))
		.order('desc')
		.take(FAILED_SCAN_LIMIT);
	return {
		lastEventAt: latest?.createdAt ?? null,
		lastRepliedAt: replied ? (replied.processedAt ?? replied.updatedAt) : null,
		failed24h: failedWeek.filter((event) => event.createdAt >= now - DAY_MS).length,
		failed7d: failedWeek.length,
		failedCapped: failedWeek.length === FAILED_SCAN_LIMIT,
		latestError: latestFailure
			? { at: latestFailure.createdAt, message: latestFailure.error ?? 'No error message recorded' }
			: null
	};
}

/** Webhook activity per messaging channel plus iCal sync state. Env presence for the Vercel side comes from /api/admin/config-status. */
export const channelHealth = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const now = Date.now();
		const channels = await Promise.all(
			(Object.keys(CHANNEL_TABLES) as ChannelKey[]).map(async (channel) => ({
				channel,
				...(await channelStats(ctx, channel, now))
			}))
		);
		const sources = (await ctx.db.query('icalSources').take(100)).filter((source) => !source.deletingAt);
		const ical = await Promise.all(
			sources.map(async (source) => ({
				_id: source._id,
				propertyName: (await ctx.db.get(source.propertyId))?.name ?? 'Deleted villa',
				platform: source.platform,
				lastSyncedAt: source.lastSyncedAt ?? null,
				lastSyncError: source.lastSyncError ?? null
			}))
		);
		return { channels, ical };
	}
});

/** Which Convex environment variables are set. Values never leave the server. */
export const serverConfig = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const set = (name: string) => Boolean(process.env[name]?.trim());
		return {
			AI_API_KEY: set('AI_API_KEY'),
			RESEND_API_KEY: set('RESEND_API_KEY'),
			EMAIL_FROM: set('EMAIL_FROM'),
			OWNER_NOTIFICATION_EMAIL: set('OWNER_NOTIFICATION_EMAIL'),
			STRIPE_SECRET_KEY: set('STRIPE_SECRET_KEY'),
			STRIPE_WEBHOOK_SECRET: set('STRIPE_WEBHOOK_SECRET'),
			MESSAGING_IMAGE_SECRET: set('MESSAGING_IMAGE_SECRET')
		};
	}
});

/**
 * Convex-side facts for the setup checklist. Channel env vars live on Convex, so the UI combines
 * `channelsReplied` with /api/admin/config-status.
 */
export const setupChecklist = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const set = (name: string) => Boolean(process.env[name]?.trim());
		const active = await ctx.db
			.query('properties')
			.withIndex('by_status', (q) => q.eq('status', 'active'))
			.take(100);
		const sources = (await ctx.db.query('icalSources').take(100)).filter((source) => !source.deletingAt);
		const replied = async (channel: ChannelKey) =>
			(await ctx.db
				.query('channelEvents')
				.withIndex('by_channel_and_status_and_createdAt', (q) => q.eq('channel', channel).eq('status', 'replied'))
				.first()) !== null;
		const channelsReplied = {} as Record<ChannelKey, boolean>;
		for (const channel of Object.keys(CHANNEL_TABLES) as ChannelKey[]) {
			channelsReplied[channel] = await replied(channel);
		}
		return {
			aiKey: set('AI_API_KEY'),
			email: set('RESEND_API_KEY') && set('EMAIL_FROM'),
			stripe: set('STRIPE_SECRET_KEY') && set('STRIPE_WEBHOOK_SECRET'),
			messagingImageSecret: set('MESSAGING_IMAGE_SECRET'),
			villaReady: active.some((p) => p.images.length > 0 && p.pricePerNight > 0),
			icalSynced: sources.some((s) => s.lastSyncedAt !== undefined && !s.lastSyncError),
			profileSaved: (await getSiteSettingsRow(ctx)) !== null,
			channelsReplied,
      channelConfig: Object.fromEntries((['line','facebook','instagram','whatsapp'] as const).map(channel => {
        const prefix = channel.toUpperCase();
        const names = channel === 'line' ? ['LINE_CHANNEL_SECRET','LINE_CHANNEL_ACCESS_TOKEN'] : [`${prefix}_APP_SECRET|META_APP_SECRET`,`${prefix}_VERIFY_TOKEN`,`${prefix}_ACCESS_TOKEN`];
        const vars = Object.fromEntries(names.map(name => [name.replace('|',' or '), name.split('|').some(set)]));
        return [channel, { configured: Object.values(vars).every(Boolean), vars }];
      })),
		};
	}
});

export const admins = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		return [...adminEmails()].sort();
	}
});
