import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { maintenancePaused } from '../auth/model';
import { STAFF_AVATAR_UPLOAD_TTL_MS } from './model';

/** Staff and service photo uploads that were never attached (failed or abandoned saves). Attached photos have no row here. */
export const cleanStaffAvatarUploads = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (maintenancePaused()) return 0;
    const rows = await ctx.db.query('staffAvatarUploads').withIndex('by_createdAt', q => q.lt('createdAt', Date.now() - STAFF_AVATAR_UPLOAD_TTL_MS)).take(100);
    for (const row of rows) {
      if (await ctx.db.system.get(row.storageId)) await ctx.storage.delete(row.storageId);
      await ctx.db.delete(row._id);
    }
    if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.services.maintenance.cleanStaffAvatarUploads, {});
  },
});
