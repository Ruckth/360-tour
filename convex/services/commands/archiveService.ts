import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { countUpcoming, logService } from '../private/administration';

/** Upcoming appointments stay booked; the count is returned so the UI can say so. */
export const archiveService = adminMutation({
	args: { serviceId: v.id('services') },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const service = await ctx.db.get(args.serviceId);
		if (!service) throw new Error('Service not found');
		const upcomingAppointments = await countUpcoming(ctx, { serviceId: args.serviceId });
		await ctx.db.patch(args.serviceId, { status: 'archived', updatedAt: Date.now() });
		await logService(ctx, service, (await ctx.db.get(args.serviceId))!, admin.email, 'archived');
		return { upcomingAppointments };
	}
});
