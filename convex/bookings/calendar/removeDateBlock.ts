import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { releaseDateBlockRows } from '../private/availabilityWrites';
import { appendRecordHistory } from '../../settings/model';
import { assertDateBlockUnchanged, dateBlockArgs, dateBlockSnapshot } from '../private/stays';

export const removeDateBlock = adminMutation({
	args: { blockId: v.id('dateBlocks'), expected: v.optional(v.object(dateBlockArgs)) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const before = await ctx.db.get(args.blockId);
		if (!before) return;
		assertDateBlockUnchanged(before, args.expected);
		await releaseDateBlockRows(ctx, args.blockId);
		await ctx.db.delete(args.blockId);
		await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: args.blockId, actor: admin.email, kind: 'removed', effectiveAt: Date.parse(`${before.start}T00:00:00+07:00`), before: dateBlockSnapshot(before) });
	}
});
