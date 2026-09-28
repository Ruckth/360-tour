import { internalMutation } from './_generated/server';
import { v } from 'convex/values';
import {
	buildAdminChatMetadataPatch,
	getAdminChatMessageCount
} from './lib/adminChatMetadata';
import { recomputeSocialProof } from './lib/socialProof';

// One-shot backfill: copies legacy chatSessions.messages arrays into the
// dedicated chatMessages table, then clears the legacy field on each session.
// Run via `npx convex run migrations:backfillChatMessages` once after deploy.
// Once verified, the `messages` field can be removed from the chatSessions schema.
export const backfillChatMessages = internalMutation({
	args: {},
	handler: async (ctx) => {
		const sessions = await ctx.db.query('chatSessions').take(5000);

		let migratedSessions = 0;
		let migratedMessages = 0;

		for (const session of sessions) {
			const legacy = session.messages;
			if (!legacy || legacy.length === 0) continue;

			for (const msg of legacy) {
				await ctx.db.insert('chatMessages', {
					sessionId: session._id,
					role: msg.role,
					content: msg.content,
					timestamp: msg.timestamp
				});
				migratedMessages++;
			}

			await ctx.db.patch(session._id, { messages: undefined });
			migratedSessions++;
		}

		return { migratedSessions, migratedMessages };
	}
});

// Bounded metadata backfill for the admin chat list. Run repeatedly with the
// returned cursor until `isDone` is true.
export const backfillChatSessionAdminMetadata = internalMutation({
	args: {
		cursor: v.optional(v.union(v.string(), v.null())),
		limit: v.optional(v.number()),
		messageScanLimit: v.optional(v.number()),
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const limit = Math.min(Math.max(Math.floor(args.limit ?? 25), 1), 100);
		const messageScanLimit = Math.min(
			Math.max(Math.floor(args.messageScanLimit ?? 500), 1),
			1000
		);
		const page = await ctx.db
			.query('chatSessions')
			.paginate({ numItems: limit, cursor: args.cursor ?? null });

		let scannedSessions = 0;
		let patchedSessions = 0;

		for (const session of page.page) {
			scannedSessions++;
			const storedMessages = await ctx.db
				.query('chatMessages')
				.withIndex('by_session', (q) => q.eq('sessionId', session._id))
				.order('desc')
				.take(messageScanLimit);

			const legacyMessages = session.messages ?? [];
			const latestLegacyMessageAt = legacyMessages.reduce<number | undefined>(
				(latest, message) =>
					typeof latest === 'number' ? Math.max(latest, message.timestamp) : message.timestamp,
				undefined
			);
			const latestStoredMessageAt = storedMessages[0]?.timestamp;
			const latestMessageAt =
				typeof latestStoredMessageAt === 'number' && typeof latestLegacyMessageAt === 'number'
					? Math.max(latestStoredMessageAt, latestLegacyMessageAt)
					: latestStoredMessageAt ?? latestLegacyMessageAt;
			const scannedMessageCount = storedMessages.length + legacyMessages.length;
			const messageCount =
				storedMessages.length >= messageScanLimit
					? Math.max(scannedMessageCount, getAdminChatMessageCount(session))
					: scannedMessageCount;
			const patch = {
				...buildAdminChatMetadataPatch(session, {
					messageCount,
					latestMessageAt,
				}),
				messageCount,
				latestMessageAt,
			};

			if (!args.dryRun) {
				await ctx.db.patch(session._id, patch);
				patchedSessions++;
			}
		}

		return {
			scannedSessions,
			patchedSessions,
			continueCursor: page.isDone ? null : page.continueCursor,
			isDone: page.isDone
		};
	}
});

// One-shot: rebuild every villa's rating summary from its real reviews, dropping the
// invented seed figures (e.g. "127 reviews"). Safe to re-run.
// Run via `npx convex run migrations:recomputeAllSocialProof` once after deploy.
export const recomputeAllSocialProof = internalMutation({
	args: {},
	handler: async (ctx) => {
		const properties = await ctx.db.query('properties').take(200);
		for (const property of properties) await recomputeSocialProof(ctx, property._id);
		return { villas: properties.length };
	}
});
