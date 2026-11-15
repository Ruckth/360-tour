import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { seedScenario } from './scenarios';

/** CLI: pnpm exec convex run maintenance/seed:seedAll '{"scenario":"demo-resort"}' */
export const seedAll = internalMutation({
  args: { scenario: v.optional(v.union(v.literal('empty'), v.literal('demo-resort'), v.literal('busy-weekend'))) },
  handler: (ctx, args) => seedScenario(ctx, args.scenario ?? 'demo-resort'),
});
