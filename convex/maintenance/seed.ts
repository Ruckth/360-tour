import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { seedScenario } from './scenarios';

/** CLI: bun run convex run maintenance/seed:seedAll '{"scenario":"demo-resort"}' */
export const seedAll = internalMutation({
  args: {
    scenario: v.optional(v.union(v.literal('empty'), v.literal('demo-resort'), v.literal('busy-weekend'), v.literal('two-branch'))),
    demoAccess: v.optional(v.boolean()),
  },
  handler: (ctx, { scenario = 'demo-resort', demoAccess }) => seedScenario(ctx, scenario, demoAccess),
});
