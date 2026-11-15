import { resortMidnight } from '../../shared/time';
import { adminMutation } from '../../auth/model';
import { writeDateBlockRows } from '../private/availabilityWrites';
import { appendRecordHistory } from '../../settings/model';
import { dateBlockArgs, validateDateBlock } from '../private/stays';

export const addDateBlock = adminMutation({
	args: dateBlockArgs,
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const reason = await validateDateBlock(ctx, args);
		const blockId = await ctx.db.insert('dateBlocks', { ...args, reason, createdAt: Date.now() });
		await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
		await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'created', effectiveAt: resortMidnight(args.start), after: { ...args, reason } });
		return blockId;
	}
});
