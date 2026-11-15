import { richCardsEnabled } from './richCardsEnabled';
import { array, eventDigest, graphVersion, object, providerRequest, string, verifyHmac, type ChannelAdapter, type InboundEvent } from './adapter';
import { cardBrowseMessage } from '../../shared/replyCards';
import { richReplyFallback, whatsappReplyMessages, whatsappText } from '../../shared/richMessages';

export const whatsapp: ChannelAdapter = {
  replyWindowMs: 24 * 60 * 60_000,
  verify: (raw, signature) => verifyHmac(raw, signature, process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET, 'hex'),
  async normalize(body) {
    const payload = object(body);
    if (payload.object !== 'whatsapp_business_account') throw new Error('Unsupported webhook object');
    const changes = array(payload.entry).flatMap(entry => array(object(entry).changes));
    const events: InboundEvent[] = [];
    for (const change of changes) {
      const value = object(object(change).value);
      for (const rawMessage of array(value.messages)) {
        const message = object(rawMessage), interactive = object(message.interactive);
        const recipient = string(message.from);
        const contact = array(value.contacts).map(object).find(contact => contact.wa_id === recipient);
        const text = message.type === 'text' ? string(object(message.text).body) : message.type === 'interactive' ? cardBrowseMessage(string(object(interactive.type === 'button_reply' ? interactive.button_reply : interactive.list_reply).id)) : undefined;
        const seconds = Number(message.timestamp);
        events.push({ eventKey: string(message.id) ? `message:${message.id}` : await eventDigest(message), eventType: text ? 'message' : 'unsupported',
          recipient, accountId: string(object(value.metadata).phone_number_id), profileName: string(object(contact?.profile).name),
          messageText: text, eventTimestamp: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
        });
      }
      // Delivery receipts contain no guest turn and are acknowledged without a send.
    }
    return events;
  },
  async send({ event, text, card, transport }) {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const account = event.accountId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !account || !event.recipient) return { state: 'rejected', reason: 'WhatsApp replies are not configured' };
    const url = `https://graph.facebook.com/${graphVersion(process.env.WHATSAPP_GRAPH_API_VERSION)}/${encodeURIComponent(account)}/messages`;
    const messages = richCardsEnabled('whatsapp') ? whatsappReplyMessages(text, card) : [whatsappText(richReplyFallback(text, card))];
    let accepted = false;
    for (const content of messages) {
      const result = await providerRequest(url, token, { messaging_product: 'whatsapp', to: event.recipient, ...content }, transport);
      if (result.state !== 'sent') {
        // A known invalid card can fall back only when no earlier message was accepted.
        if (!accepted && result.state === 'rejected' && result.invalidPayload && content.type === 'interactive') {
          return await providerRequest(url, token, { messaging_product: 'whatsapp', to: event.recipient, ...whatsappText(richReplyFallback(text, card)) }, transport);
        }
        return accepted ? { state: 'uncertain', reason: 'WhatsApp accepted part of the reply; check before resending' } : result;
      }
      accepted = true;
    }
    return { state: 'sent', status: 200 };
  },
};
