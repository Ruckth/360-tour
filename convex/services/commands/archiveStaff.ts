import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { archiveStaffRecord, logStaff } from '../private/administration';

export const archiveStaff = adminMutation({
	args: { staffId: v.id('staff') },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const result = await archiveStaffRecord(ctx, staff, admin.email);
		const archived = (await ctx.db.get(staff._id))!;
		await logStaff(ctx, staff, archived, admin.email, 'archived');
		return { ...result, archivedAt: archived.updatedAt };
	}
});
