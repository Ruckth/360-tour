import { internalAction, internalQuery, maintenancePaused, type ActionCtx } from '../auth/model';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { generateConciergeReply, withReplyOutcome, type ConciergeReply } from '../chatAi';
import { committedReply, proposalReply, toolFailureReply } from './copy';
import { humanToolResult } from '../lib/chatTools';
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
      const writes = [...event.toolResults].reverse();
      for (const write of writes) {
        const result = JSON.parse(humanToolResult(JSON.parse(write.resultJson))) as Record<string, unknown>;
        const response = committedReply(write.name, result, event.messageText ?? '') ?? proposalReply(write.name, result, event.messageText ?? '');
        if (response) return { response, model: 'tool_recovery', outcome: write.name.startsWith('prepare_') ? 'awaiting_guest' : 'answered' };
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
