import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import {
	buildAdminChatMetadataPatch,
	getAdminChatMessageCount
} from './lib/adminChatMetadata';
import { guestLookupFields } from './lib/bookingWrites';
import { syncCuratedVariants } from './lib/curatedVariants';
import { readBudget, readRangeWithinBudget, reserveWrites } from './lib/readBudget';
import { recomputeSocialProof } from './lib/socialProof';

// Data migrations run on the @convex-dev/migrations component: it pages through the table in
// batches, records progress (resume after a failure picks up where it stopped), supports dry runs
// and skips migrations that already finished. Every migrateOne below is idempotent.
//
//   npx convex run migrations:run '{"fn": "migrations:backfillCuratedQuestionVariants", "dryRun": true}'
//   npx convex run migrations:runQueryOptimizationBackfills
//   npx convex run --component migrations lib:getStatus --watch
//
// Batch sizes are chosen so one batch stays inside transaction limits; each migrateOne also
// counts its reads/writes against the transaction's budget (lib/readBudget.ts), so a caller who
// overrides `batchSize` too high gets an explicit error for that batch instead of a limit crash.
export const migrations = new Migrations<DataModel>(components.migrations);

/** Runs any migration by name: `{"fn": "migrations:<name>"}`. */
export const run = migrations.runner();

/** Copies legacy chatSessions.messages arrays into chatMessages, then clears the legacy field. */
export const backfillChatMessages = migrations.define({
	table: 'chatSessions',
	// One session per transaction: an embedded array holds at most 8,192 messages (Convex's array
	// limit), i.e. at most 8,193 writes, which several sessions together could push past 16,000.
	batchSize: 1,
	migrateOne: async (ctx, session) => {
		const legacy = session.messages;
		if (!legacy || legacy.length === 0) return;
		reserveWrites(ctx, legacy.length + 1);
		for (const msg of legacy) {
			await ctx.db.insert('chatMessages', {
				sessionId: session._id,
				role: msg.role,
				content: msg.content,
				timestamp: msg.timestamp
			});
		}
		await ctx.db.patch(session._id, { messages: undefined });
	}
});

const METADATA_MESSAGE_SCAN_LIMIT = 500;

/**
 * Fills messageCount / latestMessageAt / adminSortAt / adminSearchText for the admin chat list.
 * messageCount is exact up to METADATA_MESSAGE_SCAN_LIMIT stored messages; above that it keeps the
 * larger of the scanned and stored counts (a lower bound, logged). The inbox only uses it for
 * empty vs. non-empty, which is exact either way.
 */
export const backfillChatSessionAdminMetadata = migrations.define({
	table: 'chatSessions',
	// ≤ 4 × 501 message reads per batch, well inside the read budget even for long messages.
	batchSize: 4,
	migrateOne: async (ctx, session) => {
		const budget = readBudget(ctx);
		budget.range();
		const storedMessages = await ctx.db
			.query('chatMessages')
			.withIndex('by_session', (q) => q.eq('sessionId', session._id))
			.order('desc')
			.take(METADATA_MESSAGE_SCAN_LIMIT + 1);
		for (const message of storedMessages) budget.document(message);
		budget.assert();

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
		const truncated = storedMessages.length > METADATA_MESSAGE_SCAN_LIMIT;
		const scannedMessageCount = Math.min(storedMessages.length, METADATA_MESSAGE_SCAN_LIMIT) + legacyMessages.length;
		const messageCount = truncated
			? Math.max(scannedMessageCount, getAdminChatMessageCount(session))
			: scannedMessageCount;
		if (truncated) console.warn(`chatSessions ${session._id}: messageCount ${messageCount} is a lower bound`);
		return {
			...buildAdminChatMetadataPatch(session, { messageCount, latestMessageAt }),
			messageCount,
			latestMessageAt
		};
	}
});

/**
 * Rebuilds each villa's rating summary from its real reviews, dropping invented seed figures.
 * One villa per batch; recomputeSocialProof reads that villa's reviews in full, the same read the
 * review editor already does on every change.
 */
export const recomputeAllSocialProof = migrations.define({
	table: 'properties',
	batchSize: 1,
	migrateOne: async (ctx, property) => {
		await recomputeSocialProof(ctx, property._id);
	}
});

/**
 * Fills bookings.guestPhoneDigits / guestEmailNormalized on bookings written before those fields.
 * New and edited bookings already write them; until this finishes, exact search still falls back
 * to the raw-phone index and the scan of recent bookings.
 */
export const backfillBookingGuestLookup = migrations.define({
	table: 'bookings',
	batchSize: 100,
	migrateOne: (_ctx, booking) => {
		const fields = guestLookupFields(booking);
		if (
			booking.guestPhoneDigits === fields.guestPhoneDigits &&
			booking.guestEmailNormalized === fields.guestEmailNormalized
		) {
			return;
		}
		return fields;
	}
});

/**
 * Writes curatedChatQuestionVariants rows for curated questions saved before that table existed,
 * so exact matches on translations stop depending on the score-ordered candidate scan.
 */
export const backfillCuratedQuestionVariants = migrations.define({
	table: 'curatedChatQuestions',
	// ≤ ~15 variant rows read and written per item.
	batchSize: 50,
	migrateOne: async (ctx, question) => {
		// Reads the item's existing rows within budget first, so a bad batch size fails explicitly.
		await readRangeWithinBudget(
			ctx,
			ctx.db.query('curatedChatQuestionVariants').withIndex('by_questionId', (q) => q.eq('questionId', question._id))
		);
		reserveWrites(ctx, 30);
		await syncCuratedVariants(ctx, question);
	}
});

/** The backfills this rollout needs, in order. Rerunning skips ones already done. */
export const runQueryOptimizationBackfills = migrations.runner([
	internal.migrations.backfillCuratedQuestionVariants,
	internal.migrations.backfillBookingGuestLookup
]);
