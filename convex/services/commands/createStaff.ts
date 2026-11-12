import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { initializeWeeklyPattern } from '../../lib/rosterHistory';
import { attachAvatarUpload, hour, logStaff, required, rest, validateHours } from '../model';

export const createStaff = adminMutation({
	args: { name: v.string(), role: v.string(), avatarUrl: v.optional(v.string()), avatarStorageId: v.optional(v.id('_storage')), color: v.string(), workingHours: v.array(hour), breaks: v.array(rest) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		if (args.avatarStorageId !== undefined && args.avatarUrl !== undefined) throw new Error('Send either a photo upload or a photo URL');
		validateHours(args.workingHours);
		validateHours(args.breaks);
		const now = Date.now();
		const id = await ctx.db.insert('staff', {
			...args, name: required(args.name, 'Name'), role: required(args.role, 'Role'), color: required(args.color, 'Color'),
			...(args.avatarStorageId ? await attachAvatarUpload(ctx, args.avatarStorageId) : {}),
			status: 'active', createdAt: now, updatedAt: now
		});
		await initializeWeeklyPattern(ctx, id, admin.email);
		await logStaff(ctx, null, (await ctx.db.get(id))!, admin.email, 'created');
		return id;
	}
});
