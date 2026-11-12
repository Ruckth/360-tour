import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { writeDateBlockRows } from '../../lib/availabilityWrites';
import { assertStayDates, assertStayFree } from '../../lib/bookingWrites';
import { appendRecordHistory } from '../../settings/model';
import { blockReason, MAX_BLOCKED_NIGHTS_PER_CALL } from '../model';

/** One block per villa over the same nights. Villas with a conflict are reported and skipped; the rest are blocked. */
export const addDateBlocks = adminMutation({
	args: { propertyIds: v.array(v.id('properties')), start: v.string(), end: v.string(), reason: v.string() },
	handler: async (ctx, { propertyIds, start, end, ...args }) => {
		const admin = ctx.admin;
		if (propertyIds.length === 0) throw new Error('Pick at least one villa.');
		if (propertyIds.length > 100) throw new Error('Pick at most 100 villas.');
		// Date and reason problems apply to every villa, so they fail the whole request.
		const nights = assertStayDates(start, end, { allowPastCheckIn: true });
		if (new Set(propertyIds).size * nights > MAX_BLOCKED_NIGHTS_PER_CALL) {
			throw new Error(`Block at most ${MAX_BLOCKED_NIGHTS_PER_CALL} villa nights at a time. Pick fewer villas or a shorter range.`);
		}
		const reason = blockReason(args.reason);
		const results: Array<{ propertyId: Id<'properties'>; blockId: Id<'dateBlocks'> | null; error: string | null }> = [];
		for (const propertyId of new Set(propertyIds)) {
			try {
				// Reads only, so a conflict leaves nothing half-written for this villa.
				if (!(await ctx.db.get(propertyId))) throw new Error('Property not found');
				await assertStayFree(ctx, propertyId, start, end);
			} catch (err) {
				results.push({ propertyId, blockId: null, error: err instanceof Error ? err.message : 'Could not block these dates.' });
				continue;
			}
			const blockId = await ctx.db.insert('dateBlocks', { propertyId, start, end, reason, createdAt: Date.now() });
			await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
			await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'created', effectiveAt: Date.parse(`${start}T00:00:00+07:00`), after: { propertyId, start, end, reason } });
			results.push({ propertyId, blockId, error: null });
		}
		return results;
	}
});
