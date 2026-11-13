import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { deleteUnreferencedPhoto } from '../../lib/adminPhotos';
import { initializeWeeklyPattern, writeWeeklyPattern } from '../private/rosterHistory';
import { APPOINTMENT_LOOKBACK, blocksTime, boundedIntegrityRows, staffBusyRanges } from '../private/serviceSlots';
import { archiveStaffRecord, attachAvatarUpload, hour, logService, logStaff, required, rest, staffStatus, validateHours } from '../private/administration';

export const updateStaff = adminMutation({
	// `avatarStorageId`: an uploaded photo to attach, or null to remove the photo. `avatarUrl` sets an external URL.
	args: { staffId: v.id('staff'), name: v.optional(v.string()), role: v.optional(v.string()), avatarUrl: v.optional(v.string()), avatarStorageId: v.optional(v.union(v.id('_storage'), v.null())), color: v.optional(v.string()), status: v.optional(staffStatus), workingHours: v.optional(v.array(hour)), breaks: v.optional(v.array(rest)) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const { staffId, avatarStorageId, avatarUrl, ...changes } = args;
		await initializeWeeklyPattern(ctx, staffId, admin.email);
		if (changes.status === 'archived' && staff.status !== 'archived') await archiveStaffRecord(ctx, staff, admin.email);
		validateHours(changes.workingHours ?? staff.workingHours);
		validateHours(changes.breaks ?? staff.breaks);
		if (changes.workingHours || changes.breaks) {
			// Install the proposed version before availability validation; failure rolls back version, log and profile together.
			await writeWeeklyPattern(ctx, staff, { workingHours: changes.workingHours ?? staff.workingHours, breaks: changes.breaks ?? staff.breaks }, admin.email);
			// New hours must still cover every upcoming appointment.
			const next = { ...staff, ...changes };
			const now = Date.now();
			for await (const appointment of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', staffId).gte('start', now - APPOINTMENT_LOOKBACK)
			))) {
				if (appointment.blockedUntil <= now || !blocksTime(appointment)) continue;
				if ((await staffBusyRanges(ctx, next, appointment.start, appointment.blockedUntil, appointment._id)).length) {
					throw new Error('Reassign or cancel the appointments outside the new hours first');
				}
			}
		}
		if (avatarStorageId !== undefined && avatarUrl !== undefined) throw new Error('Send either a photo upload or a photo URL');
		// Omitting both keeps the current photo, as does re-sending what is already saved.
		let photo: { avatarUrl?: string; avatarStorageId?: Id<'_storage'> } | null = null;
		if (avatarStorageId === null) photo = { avatarUrl: undefined, avatarStorageId: undefined };
		else if (avatarStorageId !== undefined) {
			if (avatarStorageId !== staff.avatarStorageId) photo = await attachAvatarUpload(ctx, avatarStorageId);
		} else if (avatarUrl !== undefined && (avatarUrl.trim() || undefined) !== staff.avatarUrl) {
			// A blank photo URL clears the photo.
			photo = { avatarUrl: avatarUrl.trim() || undefined, avatarStorageId: undefined };
		}
		await ctx.db.patch(staffId, {
			...changes,
			...(changes.name !== undefined ? { name: required(changes.name, 'Name') } : {}),
			...(changes.role !== undefined ? { role: required(changes.role, 'Role') } : {}),
			...(changes.color !== undefined ? { color: required(changes.color, 'Color') } : {}),
			...photo,
			updatedAt: Date.now()
		});
		if (staff.status === 'archived' && changes.status === 'active') {
			for (const serviceId of staff.archivedServiceIds ?? []) {
				const service = await ctx.db.get(serviceId);
				if (!service || service.staffIds.includes(staffId)) continue;
				if (service.staffIds.length >= 200) throw new Error('Too many service assignments to restore safely');
				await ctx.db.patch(serviceId, { staffIds: [...service.staffIds, staffId], updatedAt: Date.now() });
				await logService(ctx, service, (await ctx.db.get(serviceId))!, admin.email, 'staff_restored');
			}
			await ctx.db.patch(staffId, { archivedServiceIds: undefined });
		}
		await logStaff(ctx, staff, (await ctx.db.get(staffId))!, admin.email, 'updated');
		// Last, and in this transaction: a failed save rolls the delete back and keeps the old photo.
		if (photo && staff.avatarStorageId) {
			await deleteUnreferencedPhoto(ctx, staff.avatarStorageId, staff.avatarUrl, staffId);
		}
	}
});
