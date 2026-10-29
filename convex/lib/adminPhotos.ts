import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

export const pendingAvatarUpload = (ctx: QueryCtx, storageId: Id<'_storage'>) =>
	ctx.db.query('staffAvatarUploads').withIndex('by_storageId', (q) => q.eq('storageId', storageId)).unique();

export async function deleteStoredFile(ctx: MutationCtx, storageId: Id<'_storage'>) {
	if (await ctx.db.system.get(storageId)) await ctx.storage.delete(storageId);
}

/** Turns a pending upload into the photo of the staff member or service being saved, and returns its URL. */
export async function attachPhotoUpload(ctx: MutationCtx, storageId: Id<'_storage'>) {
	const pending = await pendingAvatarUpload(ctx, storageId);
	const url = pending && (await ctx.storage.getUrl(storageId));
	if (!pending || !url) throw new Error('Photo upload not found. Choose the photo again.');
	await ctx.db.delete(pending._id);
	return url;
}

/** Called after detaching the owner, in the same transaction. Legacy clients can reuse any photo URL. */
export async function deleteUnreferencedPhoto(ctx: MutationCtx, storageId: Id<'_storage'>, url: string | undefined, detachedStaffId?: Id<'staff'>) {
	if (url) {
		const references = await ctx.db.query('staff').withIndex('by_avatarUrl', (q) => q.eq('avatarUrl', url)).take(2);
		if (references.some((staff) => staff._id !== detachedStaffId)) return;
	}
	await deleteStoredFile(ctx, storageId);
}
