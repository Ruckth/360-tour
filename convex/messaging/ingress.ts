import { internalMutation, httpAction, type ActionCtx } from '../auth/model';
import { maintenancePaused } from '../lib/maintenance';
import { internal } from '../_generated/api';
import { v } from 'convex/values';
import { adapters } from './channels';
import { inboundValidator, socialChannel, type SocialChannel } from './channels/adapter';
import { buildAdminSearchText } from './adminChatMetadata';
import { currentClaim } from './model';
import { recordGuest, scheduleNext } from './pipeline';
import { consumeChatAdmission } from './chatAdmission';

/** One transaction accepts the entire signed delivery, deduplicates and schedules BEFORE HTTP 200. */
export const accept = internalMutation({
  args: { channel: socialChannel, events: v.array(inboundValidator) },
  handler: async (ctx, { channel, events }) => {
    if (maintenancePaused()) throw new Error('Maintenance');
    let accepted = 0;
    for (const event of events) {
      const existing = await ctx.db.query('channelEvents').withIndex('by_channel_and_eventKey', q => q.eq('channel', channel).eq('eventKey', event.eventKey)).unique();
      if (existing) continue;
      const now = Date.now();
      const usable = !!event.recipient && event.eventType !== 'unsupported' && (event.eventType === 'follow' || !!event.messageText);
      let sessionId;
      if (usable) {
        const visitorId = `${channel}:${event.recipient}`;
        const session = (await ctx.db.query('conversations').withIndex('by_visitor', q => q.eq('visitorId', visitorId)).order('desc').take(10)).find(row => row.channel === channel);
        sessionId = session?._id ?? await ctx.db.insert('conversations', {
          channel, visitorId, visitorContactApp: channel, visitorContactHandle: event.recipient,
          ...(channel === 'whatsapp' ? { visitorPhone: event.recipient } : {}), ...(event.profileName ? { visitorName: event.profileName?.trim() } : {}),
          lastSeenAt: now, createdAt: now, messageCount: 0, adminSortAt: now, adminSearchText: buildAdminSearchText({ channel, visitorId, visitorName: event.profileName?.trim() }),
        });
      }
      let userMessageId;
      if (sessionId && event.messageText) userMessageId = await recordGuest(ctx, sessionId, event.messageText.slice(0, 2000), event.eventTimestamp ?? now);
      const eventId = await ctx.db.insert('channelEvents', { channel, ...event, ...(sessionId ? { sessionId } : {}), ...(userMessageId ? { userMessageId } : {}),
        arrivedAt: now, status: usable ? 'received' : 'ignored', processingStartedAt: now, createdAt: now, updatedAt: now, attempts: 0, nextAttemptAt: now,
      });
      if (usable) {
        // Social ingress must remain durable even when admission is exhausted. The worker records that failure for staff.
        await ctx.scheduler.runAfter(0, internal.messaging.worker.run, { eventId });
      }
      accepted++;
    }
    return { accepted };
  },
});

export async function handleWebhook(channel: SocialChannel, ctx: Pick<ActionCtx, 'runMutation'>, request: Request) {
    if (request.method === 'GET') {
      if (channel === 'line') return Response.json({ ok: true, webhook: '/line/webhook' });
      const params = new URL(request.url).searchParams;
      const token = process.env[`${channel.toUpperCase()}_VERIFY_TOKEN`];
      return token && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === token && params.has('hub.challenge')
        ? new Response(params.get('hub.challenge')) : new Response('Forbidden', { status: 403 });
    }
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 500_000) return new Response('Payload too large', { status: 413 });
    const adapter = adapters[channel];
    if (!await adapter.verify(raw, request.headers.get(channel === 'line' ? 'x-line-signature' : 'x-hub-signature-256'))) return new Response('Invalid signature', { status: 401 });
    let body: unknown;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { return new Response('Invalid JSON', { status: 400 }); }
    let events;
    try { events = await adapter.normalize(body); } catch { return new Response('Unsupported webhook object', { status: 404 }); }
    if (events.length > 100) return new Response('Too many events', { status: 413 });
    try {
      const result = await ctx.runMutation(internal.messaging.ingress.accept, { channel, events });
      return Response.json({ ok: true, processed: result.accepted });
    } catch {
      // Do not log raw payloads, provider secrets, reply tokens or guest content.
      return new Response('Could not persist delivery', { status: 503 });
    }
}
export function webhook(channel: SocialChannel) {
  return httpAction((ctx, request) => handleWebhook(channel, ctx, request));
}

export const admit = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string() },
  handler: async (ctx, args) => {
    const event = await currentClaim(ctx, args.eventId, args.claimToken);
    if (event.sessionId && !event.admittedAt) {
      await consumeChatAdmission(ctx, event.sessionId);
      await ctx.db.patch(event._id, { admittedAt: Date.now() });
    }
  },
});

/** Called only after admit rolls back a rate-limit refusal; never consumes a retry. */
export const rejectAdmission = internalMutation({
  args: { eventId: v.id('channelEvents'), claimToken: v.string() },
  handler: async (ctx, args) => {
    const event = await currentClaim(ctx, args.eventId, args.claimToken);
    const error = 'Chat admission rate limit reached. This message was not processed; later messages can resume when capacity returns.';
    await ctx.db.patch(event._id, { status: 'failed', error, processedAt: Date.now(), updatedAt: Date.now(), claimToken: undefined, leaseExpiresAt: undefined });
    const session = event.sessionId ? await ctx.db.get(event.sessionId) : null;
    if (session && session.latestGuestMessageId === event.userMessageId && session.inboxReason === 'answering') {
      // Surface the unanswered message and retire its answer timeout without setting
      // aiPaused. A later guest message can be answered normally after the window resets.
      await ctx.db.patch(session._id, { inboxState: 'needs_staff', inboxReason: 'send_failed', inboxSendError: error });
    }
    await scheduleNext(ctx, event.sessionId);
  },
});
