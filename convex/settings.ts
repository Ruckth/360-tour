import { v } from 'convex/values';
import { internalQuery, mutation, query, type QueryCtx } from './_generated/server';
import { adminEmails, requireAdmin } from './lib/adminAuth';
import {
	getEffectiveSettings,
	getSiteSettingsRow,
	validateSettingsInput,
	type EffectiveSettings
} from './lib/siteSettings';

const text = v.optional(v.string());

export const get = query({
	args: {},
	handler: async (ctx): Promise<EffectiveSettings> => {
		await requireAdmin(ctx);
		return await getEffectiveSettings(ctx);
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
			checkOutTime: s.checkOutTime
		};
	}
});

export const update = mutation({
	args: {
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
		const admin = await requireAdmin(ctx);
		const { business, ai, email, errors } = validateSettingsInput(args);
		const firstError = Object.values(errors)[0];
		if (firstError) throw new Error(firstError);

		const row = await getSiteSettingsRow(ctx);
		const fields = {
			...business,
			...(ai ? { ai: { ...row?.ai, ...ai } } : {}),
			...(email ? { email: { ...row?.email, ...email } } : {}),
			updatedAt: Date.now(),
			updatedByEmail: admin.email
		};
		if (row) await ctx.db.patch(row._id, fields);
		else await ctx.db.insert('siteSettings', { key: 'default', ...fields });
		return null;
	}
});

const DAY_MS = 86_400_000;
const FAILED_SCAN_LIMIT = 500;
const CHANNEL_TABLES = {
	line: 'lineWebhookEvents',
	facebook: 'facebookWebhookEvents',
	instagram: 'instagramWebhookEvents',
	whatsapp: 'whatsappWebhookEvents'
} as const;

export type ChannelKey = keyof typeof CHANNEL_TABLES;

async function channelStats(ctx: QueryCtx, table: (typeof CHANNEL_TABLES)[ChannelKey], now: number) {
	const byStatus = (status: 'replied' | 'failed') =>
		ctx.db.query(table).withIndex('by_status_and_created_at', (q) => q.eq('status', status));
	const latest = await ctx.db.query(table).order('desc').first();
	const replied = await byStatus('replied').order('desc').first();
	const latestFailure = await byStatus('failed').order('desc').first();
	// Bounded: counts stop at FAILED_SCAN_LIMIT (the UI shows "500+").
	const failedWeek = await ctx.db
		.query(table)
		.withIndex('by_status_and_created_at', (q) => q.eq('status', 'failed').gte('createdAt', now - 7 * DAY_MS))
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
				...(await channelStats(ctx, CHANNEL_TABLES[channel], now))
			}))
		);
		const sources = await ctx.db.query('icalSources').take(100);
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
			CONVEX_SERVER_SECRET: set('CONVEX_SERVER_SECRET')
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
