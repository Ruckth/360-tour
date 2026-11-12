import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { appendRecordHistory } from '../../lib/recordHistory';
import { timeOffSnapshot } from '../model';

export const removeTimeOff = adminMutation({
	args: { timeOffId: v.id('staffTimeOff') },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const row = await ctx.db.get(args.timeOffId);
		if (!row) throw new Error('Time off not found');
		await ctx.db.delete(args.timeOffId);
		await appendRecordHistory(ctx, { entityType: 'timeOff', entityId: row._id, actor: admin.email, kind: 'removed', effectiveAt: row.start, before: timeOffSnapshot(row) });
	}
});
