import { v } from 'convex/values';
import { internalMutation } from './auth/model';
import { consumeChatAdmission } from './lib/chatAdmission';

export const consumeChatLimit = internalMutation({
  args: { sessionId: v.id('conversations') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error('Session not found');
    await consumeChatAdmission(ctx, args.sessionId);
  }
});
