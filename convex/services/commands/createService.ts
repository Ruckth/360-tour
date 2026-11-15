import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { attachServiceImage, logService, required, validateService, validateStaffIds } from '../private/administration';

export const createService = adminMutation({
	args: { slug: v.string(), name: v.string(), description: v.string(), category: v.string(), durationMin: v.number(), bufferMin: v.number(), price: v.number(), currency: v.string(), staffIds: v.array(v.id('staff')), imageStorageId: v.optional(v.id('_storage')) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const slug = required(args.slug, 'Slug').toLowerCase();
		if (await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug)).first()) throw new Error('Service slug already exists');
		validateService(args);
		await validateStaffIds(ctx, args.staffIds);
		const now = Date.now();
		const id = await ctx.db.insert('services', {
			...args, slug, name: required(args.name, 'Name'), description: args.description.trim(),
			category: required(args.category, 'Category'), currency: required(args.currency, 'Currency'),
			...(args.imageStorageId ? await attachServiceImage(ctx, args.imageStorageId) : {}),
			status: 'active', createdAt: now, updatedAt: now
		});
		await logService(ctx, null, (await ctx.db.get(id))!, admin.email, 'created');
		return id;
	}
});
