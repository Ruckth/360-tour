import { richCardsEnabled } from './richCardsEnabled';
import { array, eventDigest, number, object, providerRequest, string, verifyHmac, type ChannelAdapter, type InboundEvent } from './adapter';
import { buildLineQuickReplyItems, parseLineLocaleFromPostback, questionFromLinePostback } from '../../concierge/model';
import { lineReplyMessages, richReplyFallback } from '../../shared/richMessages';

export const line: ChannelAdapter = {
  replyWindowMs: 60_000,
  verify: (raw, signature) => verifyHmac(raw, signature, process.env.LINE_CHANNEL_SECRET, 'base64'),
  async normalize(body) {
    return await Promise.all(array(object(body).events).map(async value => {
      const event = object(value), message = object(event.message), source = object(event.source);
      const postbackData = string(object(event.postback).data);
      const kind = event.type === 'message' && message.type === 'text' ? 'message' : event.type === 'follow' ? 'follow' : event.type === 'postback' ? 'postback' : 'unsupported';
      return {
        eventKey: string(event.webhookEventId) ?? (string(message.id) ? `message:${message.id}` : await eventDigest({ source, type: event.type, timestamp: event.timestamp, message, postback: event.postback })),
        eventType: kind, ...(source.type === 'user' && string(source.userId) ? { recipient: string(source.userId) } : {}),
        sourceType: string(source.type), replyToken: string(event.replyToken), eventTimestamp: number(event.timestamp), postbackData,
        messageText: kind === 'message' ? string(message.text) : kind === 'postback' ? questionFromLinePostback(postbackData) : undefined,
      } satisfies InboundEvent;
    }));
  },
  async send({ event, text, card, locale, transport = fetch }) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token || !event.replyToken) return { state: 'rejected', reason: 'LINE reply is not configured or has no reply token' };
    const rich = richCardsEnabled('line');
    const messages = lineReplyMessages(rich ? text : richReplyFallback(text, card), rich ? card : undefined, buildLineQuickReplyItems(locale ?? parseLineLocaleFromPostback(event.postbackData)));
    try {
      const response = await transport('https://api.line.me/v2/bot/message/reply', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ replyToken: event.replyToken, messages }), signal: AbortSignal.timeout(15_000) });
      if (response.ok) return { state: 'sent', status: response.status };
      const body = await response.text();
      // LINE documents "Invalid reply token" for BOTH expiry and reuse. That response
      // cannot safely authorize a push. Keep explicit-expiry handling defensive only;
      // it is not a documented promise that the live API distinguishes expiration.
      // https://developers.line.biz/en/reference/messaging-api/nojs/#error-messages
      if (response.status === 400 && /(?:reply token[^\n]*expired|expired[^\n]*reply token)/i.test(body) && event.recipient) {
        return await providerRequest('https://api.line.me/v2/bot/message/push', token, { to: event.recipient, messages }, transport);
      }
      return { state: response.status >= 500 || /invalid reply token/i.test(body) ? 'uncertain' : 'rejected', status: response.status, reason: 'LINE did not confirm delivery' };
    } catch { return { state: 'uncertain', reason: 'LINE reply may have been delivered; check before sending again' }; }
  },
};
