import { cardText, type ReplyCard, type ReplyCardAction, type ReplyCardItem } from './replyCards';
import type { LineQuickReplyItem } from './conciergeCopy';

/** Put capability URLs first so long model prose cannot clip them off a fallback. */
export function richReplyFallback(text: string, card?: ReplyCard): string {
  if (!card) return text;
  const urls = card.items.flatMap(item => item.actions.filter(action => action.type === 'uri').map(action => `${action.label}: ${action.url}`));
  if (card.catalog) urls.push(`${card.catalog.label}: ${card.catalog.url}`);
  return [...urls, text].join('\n\n');
}

function lineAction(action: ReplyCardAction) {
  return action.type === 'uri'
    ? { type: 'uri', label: cardText(action.label, 20), uri: action.url }
    : { type: 'message', label: cardText(action.label, 20), text: action.text };
}

function bubble(item: ReplyCardItem) {
  return {
    type: 'bubble', size: 'mega',
    ...(item.imageUrl ? { hero: { type: 'image', url: item.imageUrl, size: 'full', aspectRatio: '20:13', aspectMode: 'cover' } } : {}),
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: item.title, weight: 'bold', size: 'lg', wrap: true },
      ...item.lines.map(text => ({ type: 'text', text, size: 'sm', color: '#555555', wrap: true })),
    ] },
    ...(item.actions.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents:
      item.actions.map((action, index) => ({ type: 'button', style: index === 0 ? 'primary' : 'link', color: '#16756C', action: lineAction(action) })) } } : {}),
  };
}

/** One reply-token request; all messages are accepted or rejected together. */
export function lineReplyMessages(text: string, card?: ReplyCard, quickReplyItems: LineQuickReplyItem[] = []): object[] {
  const messages: object[] = [{ type: 'text', text: cardText(text || '…', 5000),
    ...(quickReplyItems.length ? { quickReply: { items: quickReplyItems } } : {}) }];
  if (card?.items.length) {
    const items = card.items.slice(0, 10).map(item => card.catalog ? { ...item, actions: [...item.actions.slice(0, 1), { type: 'uri' as const, label: card.catalog.label, url: card.catalog.url }] } : item);
    messages.push({ type: 'flex', altText: cardText(items.map(item => item.title).join(' · '), 400),
      contents: items.length === 1 ? bubble(items[0]) : { type: 'carousel', contents: items.map(bubble) } });
  }
  return messages;
}

type ImageHeader = { type: 'image'; image: { link: string } };
type UrlAction = { name: 'cta_url'; parameters: { display_text: string; url: string } };
type Button = { type: 'reply'; reply: { id: string; title: string } };
type CarouselCard = {
  card_index: number; type: 'cta_url'; header: ImageHeader; body: { text: string };
  action: UrlAction | { buttons: Array<{ type: 'quick_reply'; quick_reply: { id: string; title: string } }> };
};
export type WhatsAppContent =
  | { type: 'text'; text: { preview_url: boolean; body: string } }
  | { type: 'interactive'; interactive:
      | { type: 'carousel'; body: { text: string }; action: { cards: CarouselCard[] } }
      | { type: 'cta_url'; header?: ImageHeader; body: { text: string }; action: UrlAction }
      | { type: 'button'; header?: ImageHeader; body: { text: string }; action: { buttons: Button[] } }
      | { type: 'list'; body: { text: string }; action: { button: string; sections: Array<{ rows: Array<{ id: string; title: string; description: string }> }> } }
    };

export function whatsappText(text: string): WhatsAppContent {
  return { type: 'text', text: { preview_url: true, body: cardText(text || '…', 4096) } };
}
function itemText(item: ReplyCardItem): string { return [item.title, ...item.lines].join('\n'); }
function header(item: ReplyCardItem): ImageHeader | undefined { return item.imageUrl ? { type: 'image', image: { link: item.imageUrl } } : undefined; }
function urlAction(action: Extract<ReplyCardAction, { type: 'uri' }>): UrlAction {
  return { name: 'cta_url', parameters: { display_text: cardText(action.label, 20), url: action.url } };
}

/** Keep the complete AI reply in a preceding text message if it cannot fit the card body. */
function whatsappCardMessages(text: string, card?: ReplyCard): WhatsAppContent[] {
  if (!card?.items.length) return [whatsappText(text)];
  const items = card.items.slice(0, 10);
  const first = items[0];
  const action = first.actions[0];
  const singleBody = `${text}\n\n${itemText(first)}`;
  const bodyText = items.length > 1 ? text : singleBody;
  const preceding = bodyText.length > 1024 ? [whatsappText(text)] : [];
  const body = { text: cardText(bodyText.length > 1024 ? (items.length > 1 ? items.map(item => item.title).join(' · ') : itemText(first)) : bodyText, 1024) };
  if (items.length >= 2 && items.every(item => item.imageUrl && item.actions[0]?.type === action?.type) && action) {
    return [...preceding, { type: 'interactive', interactive: { type: 'carousel', body, action: { cards: items.map((item, index) => {
      const primary = item.actions[0];
      return { card_index: index, type: 'cta_url', header: header(item)!,
        body: { text: cardText(`${item.title}\n${item.lines.join(' · ')}`, 160) },
        action: primary.type === 'uri' ? urlAction(primary) : { buttons: [{ type: 'quick_reply', quick_reply: { id: primary.id, title: cardText(primary.label, 20) } }] },
      };
    }) } } }];
  }
  if (items.length > 1) {
    const rows = items.flatMap(item => {
      const primary = item.actions.find(a => a.type === 'message');
      return primary?.type === 'message' ? [{ id: primary.id, title: cardText(item.title, 24), description: cardText(item.lines.join(' · '), 72) }] : [];
    });
    if (rows.length !== items.length) return [whatsappText([...items.map(itemText), text].join('\n\n'))];
    return [...preceding, { type: 'interactive', interactive: { type: 'list', body,
      action: { button: cardText(action?.label ?? first.title, 20), sections: [{ rows }] } } }];
  }
  const media = header(first);
  if (action?.type === 'uri') return [...preceding, { type: 'interactive', interactive: {
    type: 'cta_url', body, ...(media ? { header: media } : {}), action: urlAction(action),
  } }];
  if (action?.type === 'message') return [...preceding, { type: 'interactive', interactive: {
    type: 'button', body, ...(media ? { header: media } : {}),
    action: { buttons: first.actions.filter(a => a.type === 'message').map(a => ({ type: 'reply', reply: { id: a.id, title: cardText(a.label, 20) } })) },
  } }];
  return [whatsappText(singleBody)];
}

/** A separate catalogue CTA remains visible even when every carousel card uses reply buttons. */
export function whatsappReplyMessages(text: string, card?: ReplyCard): WhatsAppContent[] {
  const messages = whatsappCardMessages(text, card);
  if (card?.catalog) messages.push({ type: 'interactive', interactive: { type: 'cta_url',
    body: { text: card.catalog.label }, action: { name: 'cta_url', parameters: { display_text: cardText(card.catalog.label, 20), url: card.catalog.url } } } });
  return messages;
}
