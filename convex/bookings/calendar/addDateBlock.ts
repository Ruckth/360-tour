import { adminMutation } from '../../auth/model';
import { writeDateBlockRows } from '../../lib/availabilityWrites';
import { appendRecordHistory } from '../../lib/recordHistory';
import { dateBlockArgs, validateDateBlock } from '../model';

export const addDateBlock = adminMutation({
	args: dateBlockArgs,
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const reason = await validateDateBlock(ctx, args);
		const blockId = await ctx.db.insert('dateBlocks', { ...args, reason, createdAt: Date.now() });
		await writeDateBlockRows(ctx, (await ctx.db.get(blockId))!);
		await appendRecordHistory(ctx, { entityType: 'dateBlock', entityId: blockId, actor: admin.email, kind: 'created', effectiveAt: Date.parse(`${args.start}T00:00:00+07:00`), after: { ...args, reason } });
		return blockId;
	}
});
