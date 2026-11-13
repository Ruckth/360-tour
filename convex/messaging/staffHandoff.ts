import { v } from 'convex/values';
import { internalMutation } from '../auth/model';
import { currentClaim, durableTurnValidator } from './claims';
import { queueStaffAlert } from './staffRequests';

export const alertStaffForHandoff = internalMutation({
  args: { durableTurn: v.optional(durableTurnValidator), sessionId: v.id('conversations'), lastMessage: v.string(), replyToMessageId: v.optional(v.id('messages')) },
  handler: async (ctx, args) => {
    if (args.durableTurn) { const event = await currentClaim(ctx, args.durableTurn.eventId, args.durableTurn.claimToken); if (event.sessionId !== args.sessionId) throw new Error('Turn conversation mismatch'); }
    return await queueStaffAlert(ctx, args.sessionId, args.lastMessage, args.replyToMessageId);
  }
});
