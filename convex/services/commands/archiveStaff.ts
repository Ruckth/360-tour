import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { archiveStaffRecord, logStaff } from '../model';

export const archiveStaff = adminMutation({
	args: { staffId: v.id('staff') },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const result = await archiveStaffRecord(ctx, staff, admin.email);
		await logStaff(ctx, staff, (await ctx.db.get(staff._id))!, admin.email, 'archived');
		return result;
	}
});
