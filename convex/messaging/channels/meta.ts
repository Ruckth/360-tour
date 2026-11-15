import { array, eventDigest, graphVersion, number, object, providerRequest, string, verifyHmac, type ChannelAdapter, type InboundEvent } from './adapter';
import { richReplyFallback } from '../../shared/richMessages';

export function meta(channel: 'facebook' | 'instagram', graphHost: 'graph.facebook.com' | 'graph.instagram.com'): ChannelAdapter {
  const prefix = channel.toUpperCase();
  return {
    replyWindowMs: 24 * 60 * 60_000,
    verify: (raw, signature) => verifyHmac(raw, signature, process.env[`${prefix}_APP_SECRET`] || process.env.META_APP_SECRET, 'hex'),
    async normalize(body) {
      const payload = object(body);
      if (payload.object !== (channel === 'facebook' ? 'page' : 'instagram')) throw new Error('Unsupported webhook object');
      const events = array(payload.entry).flatMap(entry => array(object(entry).messaging));
      return await Promise.all(events.map(async value => {
        const event = object(value), message = object(event.message), postback = object(event.postback);
        const kind = message.is_echo || event.delivery || event.read ? 'unsupported' : string(message.text) ? 'message' : string(postback.payload) ? 'postback' : 'unsupported';
        return { eventKey: string(message.mid) ? `message:${message.mid}` : await eventDigest(event),
          eventType: kind, recipient: string(object(event.sender).id), accountId: string(object(event.recipient).id),
          messageText: kind === 'message' ? string(message.text) : kind === 'postback' ? string(postback.payload) : undefined,
          postbackData: string(postback.payload), eventTimestamp: number(event.timestamp),
        } satisfies InboundEvent;
      }));
    },
    async send({ event, text, card, transport }) {
      const token = process.env[`${prefix}_ACCESS_TOKEN`];
      if (!token || !event.recipient) return { state: 'rejected', reason: `${channel} replies are not configured` };
      return await providerRequest(`https://${graphHost}/${graphVersion(process.env[`${prefix}_GRAPH_API_VERSION`])}/me/messages`, token, {
        ...(channel === 'facebook' ? { messaging_type: 'RESPONSE' } : {}), recipient: { id: event.recipient }, message: { text: richReplyFallback(text, card).slice(0, 2000) },
      }, transport);
    },
  };
}
