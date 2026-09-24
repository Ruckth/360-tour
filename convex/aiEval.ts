import { v } from 'convex/values';
import { internalMutation } from './_generated/server';
import { cancelAiEvalBookings, cleanupAiEvalData, seedAiEvalData } from './seeds/aiEvalData';

// AI-EVAL test data for exercising the AI concierge. Internal: run via the CLI only.
//   npx convex run --prod aiEval:seed
//   npx convex run --prod aiEval:cancelTestBookings
//   npx convex run --prod aiEval:cleanup '{"confirm":"AI-EVAL"}'

export const seed = internalMutation({
	args: {},
	handler: async (ctx) => await seedAiEvalData(ctx)
});

export const cancelTestBookings = internalMutation({
	args: {},
	handler: async (ctx) => await cancelAiEvalBookings(ctx)
});

export const cleanup = internalMutation({
	args: { confirm: v.literal('AI-EVAL') },
	handler: async (ctx) => await cleanupAiEvalData(ctx)
});
