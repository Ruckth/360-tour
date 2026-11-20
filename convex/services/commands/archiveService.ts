import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { catalogueRevision, recordCatalogueEdit } from '../../commerce/model';
import { countUpcoming } from '../private/administration';
import { prepareServiceEdit } from '../private/serviceEdits';

/** Upcoming appointments stay booked; the count is returned so the UI can say so. */
export const archiveService = adminMutation({
	args: { serviceId: v.id('services'), expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const service = await ctx.db.get(args.serviceId);
		if (!service) throw new Error('Service not found');
		const target = { targetType: 'service', targetId: service._id } as const;
		const revision = catalogueRevision(target, service, args.expectedRevision);
		const upcomingAppointments = await countUpcoming(ctx, { serviceId: args.serviceId });
		const edit = await prepareServiceEdit(ctx, service, { status: 'archived' }, admin.email, 'archived');
		await recordCatalogueEdit(ctx, admin.email, target, revision, edit);
		return { upcomingAppointments };
	}
});
