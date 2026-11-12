import { v } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import { adminAction } from '../../auth/model';
import { avatarUploadProblem } from '../../lib/imageUploads';

export const uploadStaffAvatar = adminAction({
	args: { bytes: v.bytes(), contentType: v.string() },
	handler: async (ctx, args): Promise<Id<'_storage'>> => {
		const problem = avatarUploadProblem(args.contentType, args.bytes.byteLength);
		if (problem) throw new Error(problem);
		const storageId = await ctx.storage.store(new Blob([args.bytes], { type: args.contentType }));
		try {
			await ctx.runMutation(internal.services.commands.registerStaffAvatarUpload.registerStaffAvatarUpload, { storageId });
			return storageId;
		} catch (error) {
			await ctx.storage.delete(storageId);
			throw error;
		}
	}
});
