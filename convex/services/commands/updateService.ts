import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { catalogueRevision, recordCatalogueEdit } from '../../commerce/model';
import { deleteUnreferencedPhoto } from '../private/photos';
import { attachServiceImage, required, serviceStatus, validateService, validateStaffIds } from '../private/administration';
import { prepareServiceEdit } from '../private/serviceEdits';

export const updateService = adminMutation({
	args: { serviceId: v.id('services'), slug: v.optional(v.string()), name: v.optional(v.string()), description: v.optional(v.string()), category: v.optional(v.string()), durationMin: v.optional(v.number()), bufferMin: v.optional(v.number()), price: v.optional(v.number()), currency: v.optional(v.string()), staffIds: v.optional(v.array(v.id('staff'))), status: v.optional(serviceStatus),
		// An uploaded photo to attach, or null to remove the photo. Omitted keeps the current one.
		imageStorageId: v.optional(v.union(v.id('_storage'), v.null())), expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const service = await ctx.db.get(args.serviceId);
		if (!service) throw new Error('Service not found');
		const { serviceId, imageStorageId, expectedRevision, ...changes } = args;
		const target = { targetType: 'service', targetId: serviceId } as const;
		const revision = catalogueRevision(target, service, expectedRevision);
		const slug = changes.slug !== undefined ? required(changes.slug, 'Slug').toLowerCase() : service.slug;
		const duplicate = await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug)).first();
		if (duplicate && duplicate._id !== serviceId) throw new Error('Service slug already exists');
		validateService({ durationMin: changes.durationMin ?? service.durationMin, bufferMin: changes.bufferMin ?? service.bufferMin, price: changes.price ?? service.price });
		if (changes.staffIds) await validateStaffIds(ctx, changes.staffIds);
		if (changes.status === 'active' && service.status !== 'active') {
			const staff = await Promise.all((changes.staffIds ?? service.staffIds).map((id) => ctx.db.get(id)));
			if (!staff.some((person) => person?.status === 'active')) throw new Error('Assign at least one active staff member before restoring this service');
		}
		let photo: { imageUrl?: string; imageStorageId?: Id<'_storage'> } | null = null;
		if (imageStorageId === null) photo = { imageUrl: undefined, imageStorageId: undefined };
		else if (imageStorageId !== undefined && imageStorageId !== service.imageStorageId) photo = await attachServiceImage(ctx, imageStorageId);
		const edit = await prepareServiceEdit(ctx, service, {
			...changes, slug, ...photo,
			...(changes.name !== undefined ? { name: required(changes.name, 'Name') } : {}),
			...(changes.category !== undefined ? { category: required(changes.category, 'Category') } : {}),
			...(changes.currency !== undefined ? { currency: required(changes.currency, 'Currency') } : {}),
			...(changes.description !== undefined ? { description: changes.description.trim() } : {}),
		}, admin.email);
		await recordCatalogueEdit(ctx, admin.email, target, revision, edit);
		// Last, and in this transaction: a failed save rolls the delete back and keeps the old photo.
		if (photo && service.imageStorageId) await deleteUnreferencedPhoto(ctx, service.imageStorageId, service.imageUrl);
	}
});
