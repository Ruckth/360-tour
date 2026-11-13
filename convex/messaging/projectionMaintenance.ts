import { v } from 'convex/values';
import { internalMutation } from '../auth/model';
import { inboxProjection } from './inboxProjection';

/** Small-table shortcut: one atomic, bounded repair, with an explicit dry run. Never scheduled. */
export const initializeInbox = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.object({ checked: v.number(), changed: v.number(), complete: v.boolean() }),
  handler: async (ctx, { dryRun }) => {
    const rows = await ctx.db.query('conversations').take(101);
    if (rows.length > 100) throw new Error('Inbox initialization requires a paginated rollout above 100 conversations.');
    let changed = 0;
    for (const row of rows) {
      const fields = await inboxProjection(ctx, row);
      if (Object.entries(fields).some(([key, value]) => JSON.stringify(Reflect.get(row, key)) !== JSON.stringify(value))) {
        changed++;
        if (!dryRun) await ctx.db.patch(row._id, fields);
      }
    }
    return { checked: rows.length, changed, complete: changed === 0 || !dryRun };
  },
});
