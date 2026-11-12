import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { deleteStoredFile, pendingAvatarUpload } from '../../lib/adminPhotos';

/** Drops an upload whose save failed or was cancelled. Does nothing once the photo is attached. */
export const discardStaffAvatarUpload = adminMutation({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		const pending = await pendingAvatarUpload(ctx, args.storageId);
		if (!pending) return null;
		await ctx.db.delete(pending._id);
		await deleteStoredFile(ctx, args.storageId);
		return null;
	}
});
