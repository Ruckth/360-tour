import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { appendRecordHistory } from '../../settings/model';
import { assertTimeOffFits, required, timeOffSnapshot } from '../model';

export const updateTimeOff = adminMutation({
	args: { timeOffId: v.id('staffTimeOff'), start: v.number(), end: v.number(), label: v.string(), expected: v.optional(v.object({ start: v.number(), end: v.number(), label: v.string() })) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const row = await ctx.db.get(args.timeOffId);
		if (!row) throw new Error('Time off not found');
		if (args.expected && (row.start !== args.expected.start || row.end !== args.expected.end || row.label !== args.expected.label)) throw new Error('This time off changed since you opened it. Review the latest details and try again.');
		await assertTimeOffFits(ctx, row.staffId, args.start, args.end);
		const after = { start: args.start, end: args.end, label: required(args.label, 'Label') };
		await ctx.db.patch(row._id, after);
		await appendRecordHistory(ctx, { entityType: 'timeOff', entityId: row._id, actor: admin.email, kind: 'updated', effectiveAt: args.start, before: timeOffSnapshot(row), after: { staffId: row.staffId, ...after } });
	}
});
