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
import { inboxBackfillPatch } from './lib/inboxBackfill';
import { orderBackfillPatch, orderBackfillPlan, unfrozenStaffNames } from './lib/orderBackfill';
import { appointmentLookupFields } from './lib/serviceSlots';
import { internalQuery } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';

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

export const previewInboxLifecycle = internalQuery({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const page = await ctx.db.query('chatSessions').order('desc').paginate({ ...args.paginationOpts, numItems: Math.min(20, args.paginationOpts.numItems) });
		const proposed = await Promise.all(page.page.map(async session => ({ sessionId: session._id, before: session.adminStatus ?? 'open', patch: await inboxBackfillPatch(ctx, session) })));
		return { proposed, continueCursor: page.continueCursor, isDone: page.isDone };
	}
});

export const backfillInboxLifecycle = migrations.define({
	table: 'chatSessions', batchSize: 10,
	migrateOne: async (ctx, session) => await inboxBackfillPatch(ctx, session) ?? undefined
});

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
 * Fills serviceAppointments.guestPhoneDigits / guestEmailNormalized on appointments written
 * before those fields, so checkout's Add booking finds them by phone digits or email through the
 * index. New and edited appointments already write them. Until this finishes, Add booking also
 * checks up to LEGACY_LOOKUP_SCAN older unpaid appointments directly, and says so when there are more
 * (pos.attachLookupStatus).
 *
 *   npx convex run migrations:run '{"fn": "migrations:backfillAppointmentGuestLookup", "dryRun": true}'
 *   npx convex run migrations:run '{"fn": "migrations:backfillAppointmentGuestLookup"}'
 */
export const backfillAppointmentGuestLookup = migrations.define({
	table: 'serviceAppointments',
	batchSize: 100,
	migrateOne: (_ctx, appointment) => {
		const fields = appointmentLookupFields(appointment);
		if (appointment.guestPhoneDigits === fields.guestPhoneDigits && appointment.guestEmailNormalized === fields.guestEmailNormalized) return;
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

/**
 * Order identity for bills written before orders (see lib/orderBackfill.ts): order numbers in
 * creation order, held → draft, `due`, unambiguous booking links, frozen receipt names, and
 * frozen therapist names on paid rows (added as `staffName` + `staffNameBackfilledAt`; the rest of
 * each row is untouched). Payments, receipt numbers and audit entries are untouched. Idempotent.
 *
 *   npx convex run migrations:previewOrderBackfill '{"paginationOpts": {"numItems": 20, "cursor": null}}'
 *   npx convex run migrations:run '{"fn": "migrations:backfillOrders", "dryRun": true}'
 *   npx convex run migrations:run '{"fn": "migrations:backfillOrders"}'
 *   npx convex run migrations:verifyOrderBackfill '{"paginationOpts": {"numItems": 100, "cursor": null}}'
 */
export const backfillOrders = migrations.define({
	table: 'bills',
	// ≤ 101 line reads, a few source reads and one counter write per row.
	batchSize: 20,
	migrateOne: async (ctx, order) => await orderBackfillPatch(ctx, order)
});

/** What backfillOrders would change, page by page, without writing (order numbers show as "next"). */
export const previewOrderBackfill = internalQuery({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const page = await ctx.db.query('bills').paginate({ ...args.paginationOpts, numItems: Math.min(50, args.paginationOpts.numItems) });
		const proposed = [];
		for (const order of page.page) {
			const plan = await orderBackfillPlan(ctx, order);
			if (!plan.needsNumber && !Object.keys(plan.patch).length && !plan.lineStaffNames.length && !plan.notes.length) continue;
			proposed.push({
				orderId: order._id, status: order.status, receiptNumber: order.receiptNumber, orderNumber: plan.needsNumber ? 'next' : order.orderNumber,
				patch: plan.patch,
				/** Rows that get `staffName` (the therapist's current name) added; nothing else on them changes. */
				lineStaffNames: plan.lineStaffNames,
				notes: plan.notes
			});
		}
		return { proposed, continueCursor: page.continueCursor, isDone: page.isDone };
	}
});

/**
 * Checks a page of bills after backfillOrders: every row numbered with a unique number at or
 * below the counter, none still held, `due` set, and every paid or void therapist row with a
 * frozen name unless its staff record is gone (`therapistUnknown`, reported, not a problem).
 * `staffNamesBackfilled` counts rows whose name was copied by the migration rather than at payment.
 * Page through until isDone; `problems` should be empty.
 */
export const verifyOrderBackfill = internalQuery({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const counter = (await ctx.db.query('billCounters').withIndex('by_key', (q) => q.eq('key', 'order')).unique())?.value ?? 0;
		const page = await ctx.db.query('bills').paginate({ ...args.paginationOpts, numItems: Math.min(50, args.paginationOpts.numItems) });
		const problems: Array<{ orderId: string; problem: string }> = [];
		let unlinkedWithSources = 0;
		let therapistUnknown = 0;
		let staffNamesBackfilled = 0;
		for (const order of page.page) {
			const settled = order.status === 'paid' || order.status === 'void';
			const lines = settled || (!order.bookingId && !order.appointmentId)
				? await ctx.db.query('billLines').withIndex('by_billId', (q) => q.eq('billId', order._id)).take(101)
				: [];
			if (settled) {
				const { names, unknown } = await unfrozenStaffNames(ctx, lines);
				therapistUnknown += unknown;
				staffNamesBackfilled += lines.filter((line) => line.staffNameBackfilledAt !== undefined).length;
				if (names.length) problems.push({ orderId: order._id, problem: `${names.length} paid therapist row(s) without a frozen name` });
			}
			if (order.orderNumber === undefined) problems.push({ orderId: order._id, problem: 'no order number' });
			else {
				const same = await ctx.db.query('bills').withIndex('by_orderNumber', (q) => q.eq('orderNumber', order.orderNumber)).take(2);
				if (same.length > 1) problems.push({ orderId: order._id, problem: `order number ${order.orderNumber} is not unique` });
				if (order.orderNumber > counter) problems.push({ orderId: order._id, problem: `order number ${order.orderNumber} is above the counter (${counter})` });
			}
			if (order.status === 'held') problems.push({ orderId: order._id, problem: 'still held' });
			if (order.due === undefined) problems.push({ orderId: order._id, problem: 'no due' });
			if ((order.status === 'paid' || order.status === 'void') && order.receiptNumber === undefined) problems.push({ orderId: order._id, problem: 'paid without a receipt number' });
			if (!order.bookingId && !order.appointmentId && lines.some((line) => line.bookingId || line.appointmentId)) unlinkedWithSources++;
		}
		return {
			checked: page.page.length, counter, problems, unlinkedWithSources, therapistUnknown, staffNamesBackfilled,
			continueCursor: page.continueCursor, isDone: page.isDone
		};
	}
});

/** The backfills this rollout needs, in order. Rerunning skips ones already done. */
export const runQueryOptimizationBackfills = migrations.runner([
	internal.migrations.backfillCuratedQuestionVariants,
	internal.migrations.backfillBookingGuestLookup
]);
