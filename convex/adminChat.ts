import { query } from './_generated/server';
import { v } from 'convex/values';
import { requireAdmin } from './lib/adminAuth';
import { isChatSessionActive } from './lib/chatPresence';

export const listSessions = query({
	args: {
		status: v.optional(v.union(v.literal('all'), v.literal('active'), v.literal('inactive'))),
		propertySlug: v.optional(v.string()),
		limit: v.optional(v.number()),
		cursor: v.optional(v.number()),
		now: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const now = args.now ?? Date.now();
		const limit = Math.min(Math.max(args.limit ?? 30, 1), 50);
		const scanLimit = Math.min(limit * 4, 200);
		const rows = await ctx.db
			.query('chatSessions')
			.withIndex('by_last_seen', (q) =>
				args.cursor ? q.lt('lastSeenAt', args.cursor) : q
			)
			.order('desc')
			.take(scanLimit);

		const filtered = rows.filter((session) => {
			if (args.propertySlug && session.propertySlug !== args.propertySlug) return false;
			const active = isChatSessionActive(session, now);
			if (args.status === 'active') return active;
			if (args.status === 'inactive') return !active;
			return true;
		});

		const selected = filtered.slice(0, limit);
		const sessions = await Promise.all(
			selected.map(async (session) => {
				const [latestMessage, latestLineEvent, property] = await Promise.all([
					ctx.db
						.query('chatMessages')
						.withIndex('by_session', (q) => q.eq('sessionId', session._id))
						.order('desc')
						.first(),
					session.channel === 'line'
						? ctx.db
								.query('lineWebhookEvents')
								.withIndex('by_session', (q) => q.eq('sessionId', session._id))
								.order('desc')
								.first()
						: null,
					session.propertyId ? ctx.db.get(session.propertyId) : null
				]);

				return {
					...session,
					propertyName: property?.name,
					latestMessage,
					latestLineEvent,
					isActive: isChatSessionActive(session, now)
				};
			})
		);

		const lastScanned = rows[rows.length - 1];
		return {
			sessions,
			nextCursor: rows.length === scanLimit ? lastScanned?.lastSeenAt : null
		};
	}
});

export const getTranscript = query({
	args: { sessionId: v.id('chatSessions'), now: v.optional(v.number()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const now = args.now ?? Date.now();
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const [messages, lineEvents, property] = await Promise.all([
			ctx.db
				.query('chatMessages')
				.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
				.order('asc')
				.take(500),
			session.channel === 'line'
				? ctx.db
						.query('lineWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.propertyId ? ctx.db.get(session.propertyId) : null
		]);

		return {
			session: {
				...session,
				propertyName: property?.name,
				isActive: isChatSessionActive(session, now)
			},
			messages,
			lineEvents
		};
	}
});
