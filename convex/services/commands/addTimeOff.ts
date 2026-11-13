import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { appendRecordHistory } from '../../settings/model';
import { assertTimeOffRange, required, timeOffConflicts } from '../private/administration';

/**
 * Adds the same time off for one or more staff. People with booked appointments in the way
 * are skipped and reported with those appointments; everyone else is saved.
 */
export const addTimeOff = adminMutation({
	args: { staffId: v.optional(v.id('staff')), staffIds: v.optional(v.array(v.id('staff'))), start: v.number(), end: v.number(), label: v.string() },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const staffIds = [...new Set([...(args.staffId ? [args.staffId] : []), ...(args.staffIds ?? [])])];
		if (!staffIds.length) throw new Error('Choose at least one staff member');
		if (staffIds.length > 200) throw new Error('Choose at most 200 staff members');
		assertTimeOffRange(args.start, args.end);
		const label = required(args.label, 'Label');
		const people = await Promise.all(staffIds.map((id) => ctx.db.get(id)));
		if (people.some((person) => !person)) throw new Error('Staff member not found');
		const results: Array<{ staffId: Id<'staff'>; name: string; timeOffId?: Id<'staffTimeOff'>; conflicts: Array<{ appointmentId: Id<'appointments'>; start: number }> }> = [];
		for (const person of people as Doc<'staff'>[]) {
			const conflicts = await timeOffConflicts(ctx, person._id, args.start, args.end);
			const timeOffId = conflicts.length
				? undefined
				: await ctx.db.insert('staffTimeOff', { staffId: person._id, start: args.start, end: args.end, label, createdByAdminEmail: admin.email });
			if (timeOffId) await appendRecordHistory(ctx, { entityType: 'timeOff', entityId: timeOffId, actor: admin.email, kind: 'created', effectiveAt: args.start, after: { staffId: person._id, staffName: person.name, start: args.start, end: args.end, label } });
			results.push({ staffId: person._id, name: person.name, ...(timeOffId ? { timeOffId } : {}), conflicts });
		}
		return results;
	}
});
