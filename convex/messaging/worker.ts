import { internalAction, internalMutation } from '../auth/model';
import { maintenancePaused } from '../lib/maintenance';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { currentClaim } from './model';
import { LEASE_MS, MAX_ATTEMPTS, nextEvent, reconcile, scheduleNext } from './pipeline';
import { runTurnHandler } from '../concierge/model';
import { profileName } from './channels/profile';
import { buildAdminChatMetadataPatch } from './adminChatMetadata';
import { withMessagingImages } from './channels/images';
import { adapters } from './channels';
import type { SendResult } from './channels/adapter';
import { answerAccepted } from './inboxState';
import { patchSessionAfterMessages } from './adminChatMetadata';
import type { ConciergeReply } from '../concierge/model';
import type { ReplyCard } from '../shared/replyCards';
import { isRateLimitError } from '@convex-dev/rate-limiter';

export const claim = internalMutation({
  args: { eventId: v.id('channelEvents'), token: v.string() },
  handler: async (ctx, { eventId, token }) => {
    if (maintenancePaused()) return null;
    const event = await ctx.db.get(eventId);
    if (!event || !['received', 'processing'].includes(event.status)) return null;
    // The old request-bound pipeline did not persist replay-safe tool results or reply tokens.
    // Preserve its evidence, but never regenerate an unfinished pre-cutover turn.
    if (event.arrivedAt === undefined) {
      await ctx.db.patch(event._id, { status: 'failed', error: 'Unfinished pre-Phase 2 event; review prior booking effects and delivery before replying.', processedAt: Date.now(), updatedAt: Date.now(), claimToken: undefined, leaseExpiresAt: undefined });
      await scheduleNext(ctx, event.sessionId);
      return null;
    }
    if (!event.sessionId) return null;
    if ((await nextEvent(ctx, event.sessionId))?._id !== event._id) return null;
    if (event.status === 'processing' && (event.leaseExpiresAt ?? 0) > Date.now()) return null;
    if (event.deliveryStartedAt !== undefined) {
      await reconcile(ctx, event, 'Delivery may have succeeded before the worker stopped. Check provider history before sending again.');
      return null;
    }
    if ((event.attempts ?? 0) >= MAX_ATTEMPTS) {
      await reconcile(ctx, event, 'Turn retries exhausted. Check booking tools and reply manually.');
      return null;
    }
    if ((event.nextAttemptAt ?? 0) > Date.now()) {
      await scheduleNext(ctx, event.sessionId);
      return null;
    }
    const session = await ctx.db.get(event.sessionId);
    if (!session || session.aiPaused) {
      await ctx.db.patch(event._id, { status: 'ignored', replyMode: 'ignored', processedAt: Date.now(), updatedAt: Date.now() });
      await scheduleNext(ctx, event.sessionId);
      return null;
    }
    const patch = { status: 'processing' as const, claimToken: token, leaseExpiresAt: Date.now() + LEASE_MS, attempts: (event.attempts ?? 0) + 1, updatedAt: Date.now() };
    await ctx.db.patch(event._id, patch);
    // Independent recovery path if the scheduled action crashes and never executes catch/finally.
    await ctx.scheduler.runAfter(LEASE_MS + 1, internal.messaging.worker.run, { eventId });
    return { ...event, ...patch };
  },
});

export const updateProfile = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const event = await currentClaim(ctx, args.eventId, args.claimToken);
    const session = event.sessionId ? await ctx.db.get(event.sessionId) : null;
    if (session && !session.visitorName) await ctx.db.patch(session._id, { visitorName: args.name.slice(0, 200), ...buildAdminChatMetadataPatch({ ...session, visitorName: args.name.slice(0, 200) }) });
  },
});

export const prepareDispatch = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string(), text: v.string(), model: v.string(), cardJson: v.optional(v.string()), outcome: v.optional(v.union(v.literal('answered'), v.literal('awaiting_guest'), v.literal('needs_staff'))) },
  handler: async (ctx, args) => {
    const event = await currentClaim(ctx, args.eventId, args.claimToken);
    if (event.deliveryStartedAt !== undefined) return false;
    const session = event.sessionId ? await ctx.db.get(event.sessionId) : null;
    if (!session || session.aiPaused) return false;
    await ctx.db.patch(event._id, { responseText: args.text, responseModel: args.model, responseCardJson: args.cardJson, responseOutcome: args.outcome,
      dispatchState: 'prepared', updatedAt: Date.now() });
    return true;
  },
});

export const beginDispatch = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string() },
  handler: async (ctx, args) => {
    const event = await currentClaim(ctx, args.eventId, args.claimToken);
    const session = event.sessionId ? await ctx.db.get(event.sessionId) : null;
    if (!session || session.aiPaused || event.deliveryStartedAt !== undefined || event.dispatchState !== 'prepared') return false;
    if (event.channel !== 'web') {
      const window = adapters[event.channel].replyWindowMs;
      // LINE must attempt reply even when locally old; only a provider expiry rejection permits push.
      if (event.channel !== 'line' && (!event.eventTimestamp || event.eventTimestamp > Date.now() + 5 * 60_000 || Date.now() - event.eventTimestamp >= window)) {
        await reconcile(ctx, event, 'The channel reply window expired. Staff must use an approved follow-up.');
        return false;
      }
    }
    await ctx.db.patch(event._id, { dispatchState: 'sending', deliveryStartedAt: Date.now(), updatedAt: Date.now() });
    return true;
  },
});

/** Recheck ownership and maintenance before EVERY external request, including LINE fallback and multipart cards. */
export const authorizeDispatch = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string() },
  handler: async (ctx, args) => {
    const event = await currentClaim(ctx, args.eventId, args.claimToken);
    const session = event.sessionId ? await ctx.db.get(event.sessionId) : null;
    if (!session || session.aiPaused || event.dispatchState !== 'sending') return false;
    await ctx.db.patch(event._id, { leaseExpiresAt: Date.now() + LEASE_MS });
    await ctx.scheduler.runAfter(LEASE_MS + 1, internal.messaging.worker.run, { eventId: event._id });
    return true;
  },
});

export const commitTurn = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string() },
  handler: async (ctx, args) => {
    const event = await currentClaim(ctx, args.eventId, args.claimToken);
    if (!event.sessionId || !event.responseText) throw new Error('Missing prepared reply');
    const session = await ctx.db.get(event.sessionId);
    // A social send already accepted remains recorded even when staff take over during network I/O.
    if (!session || (event.channel === 'web' && session.aiPaused)) return false;
    const messageId = event.assistantMessageId ?? await ctx.db.insert('messages', { sessionId: event.sessionId, role: 'assistant', content: event.responseText,
      replyToMessageId: event.userMessageId, ...(event.actionHint ? { action: event.actionHint } : {}), timestamp: Date.now() });
    if (!event.assistantMessageId) await patchSessionAfterMessages(ctx, event.sessionId, { addedMessages: 1, latestMessageAt: Date.now(), lastSeenAt: Date.now() });
    await ctx.db.patch(event._id, { status: 'replied', dispatchState: 'sent', replyMode: event.responseModel === 'follow' ? 'follow' : event.responseModel === 'unknown_fallback' ? 'unknown_fallback' : 'ai', assistantMessageId: messageId, processedAt: Date.now(), updatedAt: Date.now(), claimToken: undefined, leaseExpiresAt: undefined });
    await answerAccepted(ctx, { sessionId: event.sessionId, replyToMessageId: event.userMessageId, messageId, source: 'ai', outcome: event.responseOutcome ?? 'answered' });
    await scheduleNext(ctx, event.sessionId);
    return true;
  },
});

export const fail = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string(), uncertain: v.optional(v.boolean()), rejected: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    if (maintenancePaused()) return;
    const event = await ctx.db.get(args.eventId);
    if (!event || event.status !== 'processing' || event.claimToken !== args.claimToken) return;
    if (args.rejected && (event.attempts ?? 0) < MAX_ATTEMPTS) {
      const delay = 1000 * 2 ** (event.attempts ?? 1);
      await ctx.db.patch(event._id, { status: 'received', dispatchState: 'prepared', deliveryStartedAt: undefined,
        claimToken: undefined, leaseExpiresAt: undefined, nextAttemptAt: Date.now() + delay, updatedAt: Date.now(), error: 'Provider explicitly rejected delivery; retry scheduled' });
      await ctx.scheduler.runAfter(delay, internal.messaging.worker.run, { eventId: event._id });
      return;
    }
    if (event.deliveryStartedAt !== undefined || args.uncertain || args.rejected) {
      await reconcile(ctx, event, args.rejected ? 'Provider rejected this reply. Check configuration and reply manually.' : 'Delivery may have succeeded. Check provider history before sending again.');
      if (args.rejected) await ctx.db.patch(event._id, { dispatchState: 'rejected' });
    } else {
      const delay = 1000 * 2 ** (event.attempts ?? 1);
      await ctx.db.patch(event._id, { status: 'received', nextAttemptAt: Date.now() + delay, claimToken: undefined, leaseExpiresAt: undefined, error: 'Turn interrupted before delivery; retry scheduled', updatedAt: Date.now() });
      await ctx.scheduler.runAfter(delay, internal.messaging.worker.run, { eventId: event._id });
    }
  },
});

export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (maintenancePaused()) return;
    const [stale, pending] = await Promise.all([
      ctx.db.query('channelEvents').withIndex('by_status_and_leaseExpiresAt', q => q.eq('status', 'processing').lte('leaseExpiresAt', Date.now())).take(50),
      ctx.db.query('channelEvents').withIndex('by_status_and_nextAttemptAt', q => q.eq('status', 'received').lte('nextAttemptAt', Date.now())).take(50),
    ]);
    for (const event of [...stale, ...pending]) await ctx.scheduler.runAfter(0, internal.messaging.worker.run, { eventId: event._id });
  },
});

export const run = internalAction({
  args: { eventId: v.id('channelEvents') },
  handler: async (ctx, { eventId }) => {
    if (maintenancePaused()) return;
    const claimToken = crypto.randomUUID();
    const event: Doc<'channelEvents'> | null = await ctx.runMutation(internal.messaging.worker.claim, { eventId, token: claimToken });
    if (!event) return;
    try {
      if (event.channel !== 'web' && event.recipient) {
        const session = await ctx.runQuery(internal.messaging.chat.getSessionInternal, { sessionId: event.sessionId! });
        if (!session?.visitorName && !maintenancePaused()) {
          const name = await profileName(event.channel, event.recipient);
          if (name) await ctx.runMutation(internal.messaging.worker.updateProfile, { eventId, claimToken, name });
        }
      }
      if (!event.responseText) {
        if (event.channel !== 'web') {
          try {
            await ctx.runMutation(internal.messaging.ingress.admit, { eventId, claimToken });
          } catch (error) {
            if (!isRateLimitError(error)) throw error;
            // admit's failed transaction rolls back BOTH counters. A budget refusal is
            // terminal for this message, not uncertain delivery or a reason to pause AI.
            await ctx.runMutation(internal.messaging.ingress.rejectAdmission, { eventId, claimToken });
            return;
          }
        }
        const result: ConciergeReply = await runTurnHandler(ctx, { eventId, claimToken });
        if (!await ctx.runMutation(internal.messaging.worker.prepareDispatch, { eventId, claimToken, text: result.response, model: result.model, outcome: result.outcome, ...(result.card ? { cardJson: JSON.stringify(result.card) } : {}) })) return;
        event.responseText = result.response;
        event.responseCardJson = result.card ? JSON.stringify(result.card) : undefined;
      }
      if (maintenancePaused()) return;
      if (event.channel === 'web') {
        await ctx.runMutation(internal.messaging.worker.commitTurn, { eventId, claimToken });
        return;
      }
      if (!await ctx.runMutation(internal.messaging.worker.beginDispatch, { eventId, claimToken })) return;
      const siteUrl = process.env.SITE_URL ?? 'https://tour.helpgueststay.com';
      const card = await withMessagingImages(event.responseCardJson ? JSON.parse(event.responseCardJson) as ReplyCard : undefined, siteUrl);
      const transport: typeof fetch = async (url, init) => {
        if (maintenancePaused() || !await ctx.runMutation(internal.messaging.worker.authorizeDispatch, { eventId, claimToken })) throw new Error('Dispatch stopped');
        return await fetch(url, init);
      };
      const result: SendResult = await adapters[event.channel].send({ event, text: event.responseText!, card, locale: event.locale, siteUrl, transport });
      if (result.state === 'sent') await ctx.runMutation(internal.messaging.worker.commitTurn, { eventId, claimToken });
      else await ctx.runMutation(internal.messaging.worker.fail, { eventId, claimToken, uncertain: result.state === 'uncertain', rejected: result.state === 'rejected' });
    } catch {
      await ctx.runMutation(internal.messaging.worker.fail, { eventId, claimToken });
    }
  },
});
