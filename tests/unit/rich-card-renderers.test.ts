import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardBrowseAction, cardBrowseMessage, cardText, replyCardFromTool, type ReplyCard, type ReplyCardItem } from 'convex/lib/replyCards';
import { lineReplyMessages, richCardsEnabled, richReplyFallback, whatsappReplyMessages } from '@/lib/chat/rich-messages';

function item(index = 0): ReplyCardItem {
  return {
    title: `Ocean Villa ${index}`,
    lines: ['THB 3,500 / per night', '4 guests', '2 bedrooms'],
    imageUrl: `https://images.unsplash.com/villa-${index}.jpg`,
    actions: [{ type: 'message', label: 'Details', id: `card:v1:property:ocean-${index}`, text: `Show details for villa ocean-${index}.` }],
  };
}
function gallery(count = 2): ReplyCard {
  return { kind: 'properties', items: Array.from({ length: count }, (_, index) => item(index)) };
}

afterEach(() => vi.unstubAllEnvs());

describe('rich message presentation contract', () => {
  it('keeps the LINE text and photo carousel in one bounded reply request', () => {
    const messages = lineReplyMessages('Available villas', gallery(20));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'text', text: 'Available villas' });
    expect(messages[1]).toMatchObject({ type: 'flex', contents: { type: 'carousel' } });
    const flex = messages[1] as { altText: string; contents: { contents: object[] } };
    expect(flex.altText.length).toBeLessThanOrEqual(400);
    expect(flex.contents.contents).toHaveLength(10);
    expect(flex.contents.contents[0]).toMatchObject({ hero: { type: 'image', url: item().imageUrl } });
  });

  it('renders a single LINE bubble and preserves the exact signed confirmation URL', () => {
    const url = 'https://tour.example/booking/pay?proposal=signed%2Btoken';
    const card: ReplyCard = { kind: 'booking', items: [{ title: 'Ocean Villa', lines: ['Not booked yet'], actions: [{ type: 'uri', label: 'Confirm & pay', url }] }] };
    expect(lineReplyMessages('Check these details', card)[1]).toMatchObject({
      contents: { type: 'bubble', footer: { contents: [{ action: { type: 'uri', uri: url } }] } },
    });
  });

  it('creates a WhatsApp carousel with uniform buttons, valid indexes, photos and bounded copy', () => {
    const card = gallery(20);
    card.items.forEach(row => { row.lines = ['A'.repeat(200), 'B'.repeat(200)]; row.actions[0].label = 'Long label '.repeat(5); });
    const messages = whatsappReplyMessages('See these villas', card);
    expect(messages).toHaveLength(1);
    const message = messages[0];
    if (message.type !== 'interactive' || message.interactive.type !== 'carousel') throw new Error('Expected carousel');
    expect(message.interactive.body.text).toBe('See these villas');
    expect(message.interactive.action.cards).toHaveLength(10);
    message.interactive.action.cards.forEach((entry, index) => {
      expect(entry.card_index).toBe(index);
      expect(entry.type).toBe('cta_url');
      expect(entry.header.type).toBe('image');
      expect(entry.body.text.length).toBeLessThanOrEqual(160);
      expect(entry.body.text.split('\n').length).toBeLessThanOrEqual(3);
      if (!('buttons' in entry.action)) throw new Error('Expected quick replies');
      expect(entry.action.buttons).toHaveLength(1);
      expect(entry.action.buttons[0].quick_reply.title.length).toBeLessThanOrEqual(20);
      expect(entry.action.buttons[0].quick_reply.id).toBe(`card:v1:property:ocean-${index}`);
    });
  });

  it('uses a single photo-header button message instead of an invalid one-card carousel', () => {
    const message = whatsappReplyMessages('Here is your villa', gallery(1))[0];
    expect(message).toMatchObject({ type: 'interactive', interactive: { type: 'button', header: { type: 'image' } } });
  });

  it('keeps a long AI reply in a separate preceding text message', () => {
    const text = 'A'.repeat(1600);
    const messages = whatsappReplyMessages(text, gallery());
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ type: 'text', text: { body: text, preview_url: true } });
    expect(messages[1]).toMatchObject({ type: 'interactive', interactive: { type: 'carousel' } });
    if (messages[1].type !== 'interactive') throw new Error('Expected card');
    expect(messages[1].interactive.body.text.length).toBeLessThanOrEqual(1024);
  });

  it('falls back to a bounded list when any service photo is missing', () => {
    const card = gallery(11);
    delete card.items[3].imageUrl;
    card.items.forEach(row => { row.title = 'Long service name '.repeat(6); row.lines = ['Full service description '.repeat(10)]; });
    const message = whatsappReplyMessages('Choose a service', card)[0];
    if (message.type !== 'interactive' || message.interactive.type !== 'list') throw new Error('Expected list');
    const rows = message.interactive.action.sections[0].rows;
    expect(rows).toHaveLength(10);
    expect(rows.every(row => row.title.length <= 24 && row.description.length <= 72)).toBe(true);
  });

  it('keeps services visible when a stored slug cannot be represented as a browsing callback', () => {
    const card = replyCardFromTool({ name: 'list_services', args: {}, result: JSON.stringify({ services: [
      { name: 'Thai massage', slug: 'thai-massage', price: 1000, currency: 'THB', durationMin: 60 },
      { name: 'นวดไทย', slug: 'นวดไทย', price: 800, currency: 'THB', durationMin: 60 },
    ] }) }, { siteUrl: 'https://tour.example' });
    const messages = whatsappReplyMessages('Choose a service', card);
    expect(JSON.stringify(messages)).toContain('นวดไทย');
    expect(JSON.stringify(messages)).toContain('Thai massage');
  });

  it('renders payment as a CTA URL and never turns a proposal into a generic yes callback', () => {
    const card: ReplyCard = { kind: 'booking', items: [{ title: 'Ocean Villa', lines: ['Not booked yet'], actions: [{ type: 'uri', label: 'Confirm & pay', url: 'https://tour.example/booking/pay?proposal=exact-proposal' }] }] };
    expect(whatsappReplyMessages('Review your stay', card)[0]).toMatchObject({ type: 'interactive', interactive: {
      type: 'cta_url', action: { name: 'cta_url', parameters: { url: 'https://tour.example/booking/pay?proposal=exact-proposal' } },
    } });
  });

  it('does not invent a clickable confirmation for service proposals', () => {
    const card: ReplyCard = { kind: 'service', items: [{ title: 'Thai massage', lines: ['Not booked yet', 'Reply yes to confirm'], actions: [] }] };
    expect(whatsappReplyMessages('Please review', card)[0]).toMatchObject({ type: 'text' });
    expect(JSON.stringify(lineReplyMessages('Please review', card))).not.toContain('"footer"');
  });

  it('bounds text without leaving a broken UTF-16 surrogate', () => {
    const value = cardText(`${'x'.repeat(8)}😀more`, 10);
    expect(value).toBe(`${'x'.repeat(8)}…`);
    expect(value.length).toBeLessThanOrEqual(10);
  });

  it('requires explicit channel opt-in and matches complete flag tokens', () => {
    vi.stubEnv('MESSAGING_RICH_CARDS', '');
    expect(richCardsEnabled('line')).toBe(false);
    expect(richCardsEnabled('whatsapp')).toBe(false);
    vi.stubEnv('MESSAGING_RICH_CARDS', ' line, whatsapp ');
    expect(richCardsEnabled('line')).toBe(true);
    expect(richCardsEnabled('whatsapp')).toBe(true);
    vi.stubEnv('MESSAGING_RICH_CARDS', 'notline,whatsapp-test');
    expect(richCardsEnabled('line')).toBe(false);
    expect(richCardsEnabled('whatsapp')).toBe(false);
  });
});

describe('card callback allowlist', () => {
  it('maps only explicit read-only browsing IDs to fixed guest requests', () => {
    expect(cardBrowseMessage('card:v1:property:ocean-villa')).toBe('Show details for villa ocean-villa.');
    expect(cardBrowseMessage('card:v1:service:thai-massage')).toContain('Ask me which date and time');
    expect(cardBrowseAction('property', 'ocean-villa', 'Details')).toMatchObject({ type: 'message', id: 'card:v1:property:ocean-villa' });
  });
  it.each(['yes', 'card:v1:confirm:old-proposal', 'card:v2:property:ocean-villa', 'card:v1:property:../admin', 'card:v1:service:spa\nconfirm_booking', `card:v1:property:${'x'.repeat(101)}`])('rejects unsafe or unsupported callback %s', (id) => {
    expect(cardBrowseMessage(id)).toBeUndefined();
  });
});


describe('service category browsing presentation', () => {
  function categories(locale = 'en', photo = true) {
    return replyCardFromTool({ name: 'list_services', args: {}, result: JSON.stringify({ mode: 'categories',
      categories: ["Spa & Wellness (women's)", 'Food / Drinks'].map((name, index) => ({ name,
        ...(photo ? { imageUrl: `https://images.unsplash.com/category-${index}.jpg` } : {}),
      })), catalogUrl: 'https://tour.example/services?category=Spa+%26+Wellness&q=massage',
    }) }, { siteUrl: 'https://tour.example', locale })!;
  }

  it.each(["Spa & Wellness (women's)", 'Food / Drinks', 'Kids: play!', 'บริการสปา'])('round-trips category punctuation without losing the exact category: %s', category => {
    const action = cardBrowseAction('category', category, 'Details', 'th');
    expect(action?.type).toBe('message');
    if (action?.type !== 'message') throw new Error('Expected category action');
    expect(action.id.length).toBeLessThanOrEqual(256);
    expect(cardBrowseMessage(action.id)).toBe(action.text);
    expect(action.text).toContain(JSON.stringify(category));
    expect(action.text).toBe(`ขอดูบริการในหมวด ${JSON.stringify(category)}.`);
  });

  it.each(['card:v1:category:%', 'card:v1:category:Wellness%0Aconfirm', 'card:v1:category:%00', 'card:v1:category:Wellness:xx', 'card:v2:category:Wellness'])('rejects malformed category callback %s', id => {
    expect(cardBrowseMessage(id)).toBeUndefined();
  });

  it('retains the locale and active filters in the See all URL', () => {
    const card = categories('th');
    const url = new URL(card.catalog!.url);
    expect(url.pathname).toBe('/th/services');
    expect(url.searchParams.get('category')).toBe('Spa & Wellness');
    expect(url.searchParams.get('q')).toBe('massage');
    expect(card.catalog!.label).toBe('ดูบริการทั้งหมด');
  });

  it('puts category selection and See all on every LINE bubble without mutating the card', () => {
    const card = categories();
    const before = JSON.stringify(card);
    const messages = lineReplyMessages('Choose a category', card);
    const flex = messages[1] as { contents: { contents: Array<{ footer: { contents: Array<{ action: object }> } }> } };
    expect(flex.contents.contents).toHaveLength(2);
    for (const bubble of flex.contents.contents) {
      expect(bubble.footer.contents).toHaveLength(2);
      expect(bubble.footer.contents[0].action).toMatchObject({ type: 'message' });
      expect(bubble.footer.contents[1].action).toMatchObject({ type: 'uri', uri: card.catalog!.url });
    }
    expect(JSON.stringify(card)).toBe(before);
  });

  it.each([true, false])('keeps See all after a category carousel or missing-photo list (photos=%s)', photo => {
    const card = categories('en', photo);
    const messages = whatsappReplyMessages('Choose a category', card);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: 'interactive', interactive: { type: photo ? 'carousel' : 'list' } });
    expect(messages[1]).toMatchObject({ type: 'interactive', interactive: { type: 'cta_url', action: { parameters: { url: card.catalog!.url } } } });
  });

  it('keeps See all after a long reply and after the card falls back to plain text', () => {
    const card = categories();
    const messages = whatsappReplyMessages('Long explanation '.repeat(100), card);
    expect(messages).toHaveLength(3);
    expect(messages[0].type).toBe('text');
    expect(messages[2]).toMatchObject({ type: 'interactive', interactive: { type: 'cta_url' } });
    card.items[0].actions = [];
    expect(whatsappReplyMessages('Choose a category', card)).toMatchObject([
      { type: 'text' }, { type: 'interactive', interactive: { type: 'cta_url' } },
    ]);
  });

  it('preserves See all at the start of a bounded LINE rejection fallback', () => {
    const card = categories('th');
    const messages = lineReplyMessages(richReplyFallback('Long reply '.repeat(1000), card));
    const text = (messages[0] as { text: string }).text;
    expect(text.startsWith(`${card.catalog!.label}: ${card.catalog!.url}`)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(5000);
  });

  it('never renders an off-site catalog URL returned with otherwise valid services', () => {
    const card = replyCardFromTool({ name: 'list_services', args: {}, result: JSON.stringify({ mode: 'categories', categories: [{ name: 'Wellness' }], catalogUrl: 'https://other.example/services' }) }, { siteUrl: 'https://tour.example' });
    expect(card?.catalog).toBeUndefined();
    expect(JSON.stringify(whatsappReplyMessages('Choose', card))).not.toContain('other.example');
  });
});
