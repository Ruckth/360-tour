import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { maintenancePaused } from '../lib/maintenance';

export const cleanRateLimits = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (maintenancePaused()) return 0;
    const rows = await ctx.db.query('rateLimits').withIndex('by_expiresAt', q => q.lt('expiresAt', Date.now())).take(100);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 100) await ctx.scheduler.runAfter(0, internal.messaging.maintenance.cleanRateLimits, {});
  },
});
