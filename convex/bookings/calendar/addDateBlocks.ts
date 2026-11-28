import { resortMidnight } from '../../shared/time';
import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import { adminMutation, adminQuery } from '../../auth/model';
import { writeDateBlockRows } from '../private/availabilityWrites';
import { assertStayDates, assertStayFree } from '../private/bookingWrites';
import { appendRecordHistory } from '../../settings/model';
import { blockReason, MAX_BLOCKED_NIGHTS_PER_CALL } from '../private/stays';

/** Shared request checks: date problems apply to every villa, so they fail the whole request. */
function assertBlockRequest(propertyIds: Id<'properties'>[], start: string, end: string): Id<'properties'>[] {
	if (propertyIds.length === 0) throw new Error('Pick at least one villa.');
	if (propertyIds.length > 100) throw new Error('Pick at most 100 villas.');
	const nights = assertStayDates(start, end, { allowPastCheckIn: true });
	const unique = [...new Set(propertyIds)];
	if (unique.length * nights > MAX_BLOCKED_NIGHTS_PER_CALL) {
		throw new Error(`Block at most ${MAX_BLOCKED_NIGHTS_PER_CALL} villa nights at a time. Pick fewer villas or a shorter range.`);
	}
	return unique;
}

/** Reads only: the reason this villa cannot take the block, or null when it can. */
async function villaBlockConflict(ctx: QueryCtx, propertyId: Id<'properties'>, start: string, end: string): Promise<string | null> {
	try {
		if (!(await ctx.db.get(propertyId))) throw new Error('Property not found');
		await assertStayFree(ctx, propertyId, start, end);
		return null;
	} catch (err) {
		return err instanceof Error ? err.message : 'Could not block these dates.';
	}
}

/** Preview of addDateBlocks for the same villas and range: which villas can be blocked, without writing. */
export const previewDateBlocks = adminQuery({
	args: { propertyIds: v.array(v.id('properties')), start: v.string(), end: v.string() },
	handler: async (ctx, { propertyIds, start, end }) => {
		const unique = assertBlockRequest(propertyIds, start, end);
		const results: Array<{ propertyId: Id<'properties'>; error: string | null }> = [];
		for (const propertyId of unique) results.push({ propertyId, error: await villaBlockConflict(ctx, propertyId, start, end) });
		return results;
	}
});

/** One block per villa over the same nights. Villas with a conflict are reported and skipped; the rest are blocked. */
export const addDateBlocks = adminMutation({
	args: { propertyIds: v.array(v.id('properties')), start: v.string(), end: v.string(), reason: v.string() },
	handler: async (ctx, { propertyIds, start, end, ...args }) => {
		const admin = ctx.admin;
		const unique = assertBlockRequest(propertyIds, start, end);
		const reason = blockReason(args.reason);
		const results: Array<{ propertyId: Id<'properties'>; blockId: Id<'dateBlocks'> | null; error: string | null }> = [];
		for (const propertyId of unique) {
			// Revalidated in this transaction, so a conflict that appeared after the preview is still refused.
			const error = await villaBlockConflict(ctx, propertyId, start, end);
			if (error) {
				results.push({ propertyId, blockId: null, error });
				continue;
			}
			const blockId = await ctx.db.insert('dateBlocks', { propertyId, start, end, reason, createdAt: Date.now() });
			await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
			await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'created', effectiveAt: resortMidnight(start), after: { propertyId, start, end, reason } });
			results.push({ propertyId, blockId, error: null });
		}
		return results;
	}
});
