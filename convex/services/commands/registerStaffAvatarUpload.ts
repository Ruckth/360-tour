import { v } from 'convex/values';
import { internalMutation } from '../../auth/model';

export const registerStaffAvatarUpload = internalMutation({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		await ctx.db.insert('staffAvatarUploads', { storageId: args.storageId, createdAt: Date.now() });
		return null;
	}
});
