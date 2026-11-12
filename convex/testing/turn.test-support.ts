import type { TestConvexForDataModel } from 'convex-test';
import type { DataModel, Id } from '../_generated/dataModel';
import { api, internal } from '../_generated/api';
import { generateConciergeReply, withReplyOutcome, type GenerateConciergeReplyArgs } from '../concierge/model';
/** Existing pure generation suites exercise the same helper now called by internal runTurn. */
export async function generateTestReply(t: TestConvexForDataModel<DataModel>, args: GenerateConciergeReplyArgs) {
  const session = await t.query(internal.messaging.chat.getSessionInternal, { sessionId: args.sessionId });
  if (!session || session.aiPaused) throw new Error('AI replies are paused');
  return await t.action(async ctx => withReplyOutcome(await generateConciergeReply(ctx, { ...args, channel: session.channel }, session)));
}
/** Web integration suites use genuine guest admission, claim, generation and atomic commit. */
export async function respondTest(t: TestConvexForDataModel<DataModel>, args: Omit<GenerateConciergeReplyArgs, 'channel'> & { guestToken?: string; actionHint?: 'booking' | 'tour' | 'none'; marketing?: { slug?: string } }) {
  const queued = await t.mutation(api.messaging.chat.sendMessage, { sessionId: args.sessionId, guestToken: args.guestToken ?? '', clientMessageId: crypto.randomUUID(), content: args.userMessage, locale: args.locale, propertySlug: args.propertySlug, actionHint: args.actionHint, marketing: args.marketing });
  const claimToken = crypto.randomUUID();
  const claim = await t.mutation(internal.messaging.worker.claim, { eventId: queued.eventId, token: claimToken });
  if (!claim) return { response: '', model: 'ai_paused', aiPaused: true };
  const result = await t.action(internal.concierge.runTurn.runTurn, { eventId: queued.eventId, claimToken });
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: queued.eventId, claimToken, text: result.response, model: result.model, outcome: result.outcome });
  await t.mutation(internal.messaging.worker.commitTurn, { eventId: queued.eventId, claimToken });
  return { ...result, aiPaused: false };
}
export async function acceptTestEvent(t: TestConvexForDataModel<DataModel>, channel: 'line' | 'facebook' | 'instagram' | 'whatsapp', event: { eventKey: string; recipient?: string; accountId?: string; profileName?: string; eventType: 'message' | 'unsupported'; messageText?: string; sourceType?: string; eventTimestamp?: number }) {
  await t.mutation(internal.messaging.ingress.accept, { channel, events: [{ ...event, messageText: event.messageText ?? 'Hello' }] });
  const row = await t.run(ctx => ctx.db.query('channelEvents').withIndex('by_channel_and_eventKey', q => q.eq('channel', channel).eq('eventKey', event.eventKey)).unique());
  if (!row) throw new Error('Event not stored');
  return { eventId: row._id, sessionId: row.sessionId };
}
export async function completeTestEvent(t: TestConvexForDataModel<DataModel>, eventId: Id<'channelEvents'>, text: string) {
  const claimToken = crypto.randomUUID();
  await t.mutation(internal.messaging.worker.claim, { eventId, token: claimToken });
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId, claimToken, text, model: 'test', outcome: 'answered' });
  return await t.mutation(internal.messaging.worker.commitTurn, { eventId, claimToken });
}
