import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { logService } from '../model';

/** Saves the services × staff matrix in one go. Refuses if an active service would be left with no one. */
export const setServiceStaffMatrix = adminMutation({
	args: { assignments: v.array(v.object({ serviceId: v.id('services'), staffIds: v.array(v.id('staff')) })) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		if (args.assignments.length > 200) throw new Error('Save at most 200 services at once');
		if (new Set(args.assignments.map((row) => row.serviceId)).size !== args.assignments.length) throw new Error('Each service can appear only once');
		const staffCache = new Map<Id<'staff'>, Doc<'staff'> | null>();
		const services: Array<{ service: Doc<'services'>; staffIds: Id<'staff'>[] }> = [];
		const unstaffed: string[] = [];
		for (const row of args.assignments) {
			if (row.staffIds.length > 200) throw new Error('Assign at most 200 staff to one service');
			const service = await ctx.db.get(row.serviceId);
			if (!service) throw new Error('Service not found');
			if (new Set(row.staffIds).size !== row.staffIds.length) throw new Error(`Choose distinct staff members for ${service.name}`);
			for (const id of row.staffIds) {
				if (!staffCache.has(id)) staffCache.set(id, await ctx.db.get(id));
				const person = staffCache.get(id);
				if (!person) throw new Error('Staff member not found');
				if (person.status !== 'active') throw new Error(`${person.name} is archived. Restore them first or choose someone else`);
			}
			if (service.status === 'active' && !row.staffIds.length) unstaffed.push(service.name);
			services.push({ service, staffIds: row.staffIds });
		}
		if (unstaffed.length) throw new Error(`${unstaffed.join(', ')} would have no staff. Assign at least one person to each active service`);
		let updated = 0;
		for (const { service, staffIds } of services) {
			const same = staffIds.length === service.staffIds.length && staffIds.every((id) => service.staffIds.includes(id));
			if (same) continue;
			await ctx.db.patch(service._id, { staffIds, updatedAt: Date.now() });
			await logService(ctx, service, (await ctx.db.get(service._id))!, admin.email, 'assignments');
			updated++;
		}
		return { updated };
	}
});
