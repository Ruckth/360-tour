import { internalAction, internalQuery, maintenancePaused, type ActionCtx } from '../auth/model';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { generateConciergeReply, withReplyOutcome, type ConciergeReply } from './generation';
import { committedReply, proposalReply, toolFailureReply } from './copy';
import { presentStoredToolResult, storedProposalIsCurrent } from './tools/presentation';
import { localizedGreetingReply, detectReplyLocale, parseLineLocaleFromPostback } from './copy';

export const load = internalQuery({
  args: { eventId: v.id('channelEvents'), claimToken: v.string() },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId);
    if (maintenancePaused() || !event || event.status !== 'processing' || event.claimToken !== args.claimToken || (event.leaseExpiresAt ?? 0) <= Date.now()) throw new Error('Stale turn');
    const session = event.sessionId ? await ctx.db.get(event.sessionId) : null;
    if (!session || session.aiPaused) throw new Error('AI paused');
    return { event, session };
  },
});
/** The one internal generation entry point for both web and every social channel. */
export async function runTurnHandler(ctx: ActionCtx, args: { eventId: import('../_generated/dataModel').Id<'channelEvents'>; claimToken: string }): Promise<ConciergeReply> {
    const { event, session } = await ctx.runQuery(internal.concierge.runTurn.load, args);
    const locale = event.locale ?? parseLineLocaleFromPostback(event.postbackData) ?? detectReplyLocale(event.messageText);
    // Recover committed tool facts without asking a model to choose/replay booking writes.
    if (event.toolResults?.length) {
      // The last write/intent is authoritative. A failed or unfinished replacement must never
      // fall through to an older successful proposal whose live quote was invalidated.
      const write = event.toolResults[event.toolResults.length - 1];
      if (!write.pending && storedProposalIsCurrent(write, session)) {
        const result = JSON.parse(presentStoredToolResult(write, process.env.SITE_URL ?? 'https://tour.helpgueststay.com')) as Record<string, unknown>;
        const committed = committedReply(write.name, result, event.messageText ?? '');
        if (committed) return { response: committed, model: 'tool_recovery', outcome: 'answered' };
        const proposal = proposalReply(write.name, result, event.messageText ?? '');
        if (proposal) return { response: proposal, model: 'tool_recovery', outcome: 'awaiting_guest' };
      }
      return { response: toolFailureReply(event.messageText ?? ''), model: 'tool_recovery', outcome: 'needs_staff' };
    }
    if (event.eventType === 'follow') return { response: localizedGreetingReply(locale), model: 'follow', outcome: 'answered' };
    return withReplyOutcome(await generateConciergeReply(ctx, {
      sessionId: session._id, userMessage: event.messageText ?? '', replyToMessageId: event.userMessageId,
      propertySlug: event.propertySlug, locale, channel: session.channel, siteUrl: process.env.SITE_URL ?? 'https://tour.helpgueststay.com',
      bookingFlow: session.channel !== 'web', turnId: event.eventKey, durableTurn: args,
    }, session));
}

export const runTurn = internalAction({
  args: { eventId: v.id('channelEvents'), claimToken: v.string() },
  handler: runTurnHandler,
});
