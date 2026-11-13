import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { releaseDateBlockRows, writeDateBlockRows } from '../private/availabilityWrites';
import { stayDates } from '../../lib/dates';
import { appendRecordHistory } from '../../settings/model';
import { assertDateBlockUnchanged, dateBlockArgs, dateBlockSnapshot, validateDateBlock } from '../private/stays';

export const updateDateBlock = adminMutation({
	args: { blockId: v.id('dateBlocks'), ...dateBlockArgs, expected: v.optional(v.object(dateBlockArgs)) },
	handler: async (ctx, { blockId, expected, ...args }) => {
		const admin = ctx.admin;
		const before = await ctx.db.get(blockId);
		if (!before) throw new Error('Block not found');
		assertDateBlockUnchanged(before, expected);
		const heldNights = new Set(args.propertyId === before.propertyId ? stayDates(before.start, before.end) : []);
		await releaseDateBlockRows(ctx, blockId);
		const reason = await validateDateBlock(ctx, args, { rowsCheckedOnWrite: true });
		await ctx.db.patch(blockId, { ...args, reason });
		await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!, heldNights);
		await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'updated', effectiveAt: Date.parse(`${args.start}T00:00:00+07:00`), before: dateBlockSnapshot(before), after: { ...args, reason } });
	}
});
