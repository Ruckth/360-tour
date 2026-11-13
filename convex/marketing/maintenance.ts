import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { maintenancePaused } from '../lib/maintenance';
import { RAW_MARKETING_RETENTION_MS } from '../lib/marketingPolicy';
import { ATTRIBUTION_WINDOW_MS } from '../shared/marketingAttribution';

if (RAW_MARKETING_RETENTION_MS <= ATTRIBUTION_WINDOW_MS) {
  throw new Error('Raw marketing retention must exceed the attribution window');
}

export const MARKETING_CLEANUP_BATCH_SIZE = 100;

/** Delete only raw rows. Aggregates, counters and frozen sale/credit snapshots are permanent. */
export const cleanRawMarketing = internalMutation({
  args: { cutoff: v.optional(v.number()) },
  handler: async (ctx, args): Promise<number> => {
    if (maintenancePaused()) return 0;
    const cutoff = args.cutoff ?? Date.now() - RAW_MARKETING_RETENTION_MS;
    // Deletion advances the indexed page; no offset/cursor can skip deleted rows.
    const sessions = await ctx.db.query('marketingSessions')
      .withIndex('by_startedAt', q => q.lt('startedAt', cutoff))
      .take(MARKETING_CLEANUP_BATCH_SIZE);
    const events = await ctx.db.query('marketingEvents')
      .withIndex('by_occurredAt', q => q.lt('occurredAt', cutoff))
      .take(MARKETING_CLEANUP_BATCH_SIZE);
    for (const row of [...sessions, ...events]) await ctx.db.delete(row._id);
    if (sessions.length === MARKETING_CLEANUP_BATCH_SIZE || events.length === MARKETING_CLEANUP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.marketing.maintenance.cleanRawMarketing, { cutoff });
    }
    return sessions.length + events.length;
  },
});
