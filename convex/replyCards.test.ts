import { describe, expect, it } from 'vitest';
import { cardBrowseMessage, replyCardFromTool } from './shared/replyCards';
import { lineReplyMessages, richReplyFallback, whatsappReplyMessages } from './shared/richMessages';

const options = { siteUrl: 'https://resort.example', locale: 'en' };
const make = (name: string, result: unknown) => replyCardFromTool({ name, args: {}, result: JSON.stringify(result) }, options);

describe('tool-grounded reply cards', () => {
  it.each([['en', 'min'], ['th', 'นาที']])('shows all six duration choices in %s', (locale, unit) => {
    const optionsList = Array.from({ length: 6 }, (_, i) => ({ durationMin: 30 + 15 * i, price: 800 + 100 * i }));
    const services = [{ name: 'Thai massage', slug: 'thai-massage', options: optionsList, currency: 'THB' }];
    const card = replyCardFromTool({ name: 'list_services', args: {}, result: JSON.stringify({ services, catalogUrl: '/services' }) }, { ...options, locale });
    expect(card?.items[0].lines).toHaveLength(6);
    expect(card?.items[0].lines[0]).toBe(`30 ${unit} · THB 800`);
    const actions = card?.items[0].actions ?? [];
    expect(actions.map(action => action.label)).toEqual(optionsList.map(option => `${option.durationMin} ${unit}`));
    const flex = lineReplyMessages('Choose', card)[1] as { type: string; contents: { footer: { contents: Array<{ type: string; action: unknown }> } } };
    expect(flex.type).toBe('flex');
    const buttons = flex.contents.footer.contents;
    expect(buttons).toHaveLength(7);
    expect(buttons[6].type).toBe('button');
    expect(buttons[6].action).toEqual({ type: 'uri', label: card?.catalog?.label, uri: card?.catalog?.url });
    const whatsapp = whatsappReplyMessages('Choose', card)[0];
    if (whatsapp.type !== 'interactive' || whatsapp.interactive.type !== 'list') throw new Error('Expected a WhatsApp list');
    expect(whatsapp.interactive.action.button).toBe(card?.catalog?.label);
    const rows = whatsapp.interactive.action.sections[0].rows;
    expect(rows).toHaveLength(6);
    for (const [index, action] of actions.entries()) {
      if (action.type !== 'message') throw new Error('Expected a browsing action');
      expect(cardBrowseMessage(action.id)).toBe(action.text);
      expect(action.text).toContain(action.label);
      expect(buttons[index].type).toBe('button');
      expect(buttons[index].action).toEqual({ type: 'message', label: action.label, text: action.text });
      expect(rows[index]).toMatchObject({ id: action.id, title: action.label });
    }
  });

  it('keeps Thai duration IDs within the WhatsApp limit and preserves row prices and text choices', () => {
    const slug = 'นวดไทย'.repeat(3) + 'ดี';
    const name = 'Thai massage with a very long description in its name at the resort spa today';
    const services = [{ name, slug, currency: 'THB', options: [{ durationMin: 60, price: 800 }, { durationMin: 90, price: 1100 }] }];
    const card = replyCardFromTool({ name: 'list_services', args: {}, result: JSON.stringify({ services }) }, { ...options, locale: 'th' });
    const message = whatsappReplyMessages('Choose', card, 'th')[0];
    if (message.type !== 'interactive' || message.interactive.type !== 'list') throw new Error('Expected a WhatsApp list');
    expect(message.interactive.action.button).toBe('เลือก');
    const rows = message.interactive.action.sections[0].rows;
    expect(rows).toHaveLength(2);
    const fallback = richReplyFallback('Choose', card);
    for (const [index, { durationMin }] of services[0].options.entries()) {
      const row = rows[index];
      expect(row.id.length).toBeLessThanOrEqual(200);
      expect(cardBrowseMessage(row.id)).toBe(`สนใจบริการ ${slug} · ${durationMin} นาที.`);
      const terms = index === 0 ? '60 นาที · THB 800' : '90 นาที · THB 1,100';
      expect(row.description).toMatch(`… · ${terms}`);
      expect(row.description.length).toBeLessThanOrEqual(72);
      expect(fallback).toContain(terms);
    }
  });

  it('adds duration choices to text fallback and leaves single-duration services to the reply text', () => {
    const card = make('list_services', { services: [
      { name: 'Massage', slug: 'massage/spa', currency: 'THB', options: [{ durationMin: 60, price: 800 }, { durationMin: 90, price: 1100 }] },
      { name: 'Facial', slug: 'facial', price: 900, durationMin: 45, currency: 'THB', options: [{ durationMin: 45, price: 900 }] },
    ] });
    expect(richReplyFallback('Enjoy a 45-minute Facial.', card))
      .toBe('Massage\n60 min · THB 800\n90 min · THB 1,100\n\nEnjoy a 45-minute Facial.');
  });

  it('uses the full WhatsApp body on the first list and a short body on later chunks', () => {
    const options = Array.from({ length: 6 }, (_, i) => ({ durationMin: 30 + 15 * i, price: 800 + 100 * i }));
    const card = make('list_services', { services: [
      { name: 'Massage', slug: 'massage', currency: 'THB', options },
      { name: 'Facial', slug: 'facial', currency: 'THB', options },
    ] });
    const text = 'Choose a service and duration for your visit.';
    const messages = whatsappReplyMessages(text, card);
    expect(messages).toHaveLength(2);
    const [first, second] = messages.map(message => {
      if (message.type !== 'interactive' || message.interactive.type !== 'list') throw new Error('Expected a WhatsApp list');
      return message.interactive;
    });
    expect(first.body.text).toBe(text);
    expect(second.body.text).toBe('More options');
    expect(first.action.button).toBe('Choose');
    expect(second.action.button).toBe('Choose');
    expect(first.action.sections[0].rows).toHaveLength(10);
    expect(second.action.sections[0].rows).toHaveLength(2);
    expect([...first.action.sections[0].rows, ...second.action.sections[0].rows].map(row => row.id))
      .toEqual(card?.items.flatMap(item => item.actions.flatMap(action => action.type === 'message' ? [action.id] : [])));
  });

  it('sends text when a legacy WhatsApp list row would exceed the ID limit', () => {
    const card = make('list_services', { services: [
      { name: 'Massage', slug: 'นวดไทย'.repeat(4), price: 800, durationMin: 60, currency: 'THB' },
      { name: 'Facial', slug: 'facial', price: 900, durationMin: 45, currency: 'THB' },
    ] });
    expect(whatsappReplyMessages('Choose', card)).toEqual([{ type: 'text', text: {
      preview_url: true, body: 'Choose',
    } }]);
  });

  it('uses live property prices, capacity, and photos', () => {
    expect(make('list_properties', { currency: 'THB', properties: [{ name: 'Pool villa', slug: 'pool-villa', directPrice: 4500, maxGuests: 4, bedrooms: 2, imageUrl: '/photos/pool.jpg' }] }))
      .toMatchObject({ kind: 'properties', items: [{ title: 'Pool villa', lines: ['THB 4,500 / per night', '4 guests', '2 bedrooms'], imageUrl: 'https://resort.example/photos/pool.jpg',
        actions: [{ type: 'message', id: 'card:v1:property:pool-villa' }, { type: 'uri', url: 'https://resort.example/rooms/pool-villa' }] }] });
  });

  it.each(['http://images.unsplash.com/photo', 'https://private.internal/photo', '//other.example/photo', '/\\127.0.0.1/photo', '/\\private.internal/photo', 'https://user:pass@images.unsplash.com/photo', 'javascript:alert(1)'])('omits unsafe images: %s', imageUrl => {
    const card = make('get_property_details', { name: 'Villa', slug: 'villa', imageUrl });
    expect(card?.items[0].imageUrl).toBeUndefined();
  });

  it('keeps the signed proposal URL exact and never turns confirmation into a generic callback', () => {
    const confirmUrl = 'https://resort.example/booking/pay?proposal=session.id.expiry.signature';
    const card = make('prepare_booking', { property: 'Pool villa', guests: 2, checkIn: '2027-01-01', checkOut: '2027-01-03', total: 9000, currency: 'THB', confirmUrl });
    expect(card?.items[0].lines).toContain('Not booked yet');
    expect(card?.items[0].actions).toEqual([{ type: 'uri', label: 'Confirm & pay', url: confirmUrl }]);
    expect(cardBrowseMessage('card:v1:confirm:proposal')).toBeUndefined();
  });

  it('omits external payment URLs and never offers payment for a paid booking', () => {
    const booking = { property: 'Villa', guests: 2, checkIn: '2027-01-01', checkOut: '2027-01-03', total: 9000, currency: 'THB' };
    expect(make('prepare_booking', booking)?.items[0].actions).toEqual([]);
    expect(make('prepare_booking', { ...booking, confirmUrl: 'https://other.example/pay' })?.items[0].actions).toEqual([]);
    expect(make('confirm_booking', { ...booking, status: 'paid', paymentUrl: 'https://resort.example/booking/pay?token=old' })?.items[0].actions).toEqual([]);
    expect(make('confirm_booking', { ...booking, status: 'paid' })?.items[0].lines).toContain('Paid');
  });

  it('does not expose guest contact details or an unbound service confirmation button', () => {
    const card = make('prepare_service_booking', { service: 'Massage', date: '2027-01-01', time: '10:00', price: 1500, currency: 'THB', guestPhone: '+6612345678', guestName: 'Private Guest' });
    expect(card?.items[0].actions).toEqual([]);
    expect(card?.items[0].lines).toContain('Reply yes to confirm');
    expect(JSON.stringify(card)).not.toContain('Private');
    expect(JSON.stringify(card)).not.toContain('+661');
  });

  it.each([{ error: 'Expired' }, { ok: false }, {}, { total: -1, currency: 'THB' }, { total: 123, currency: '???' }])('never produces a booking card from a failed or incomplete result', result => {
    expect(make('prepare_booking', result)).toBeUndefined();
  });

  it('bounds the number of cards and only accepts read-only callback identifiers', () => {
    const services = Array.from({ length: 100 }, (_, n) => ({ name: `Service ${n}`, slug: `service-${n}`, price: n, currency: 'THB' }));
    expect(make('list_services', { services })?.items).toHaveLength(10);
    expect(cardBrowseMessage('card:v1:service:massage')).toContain('Ask me which date and time');
    expect(cardBrowseMessage('card:v1:service:massage:en')).toBeUndefined();
    expect(cardBrowseMessage('card:v1:service:massage:90')).toBeUndefined();
    expect(cardBrowseMessage('card:v1:service:massage:th:90')).toBeUndefined();
    expect(cardBrowseMessage('card:v1:service:massage\nyes')).toBeUndefined();
    expect(cardBrowseMessage('card:v1:property:../../etc')).toBeUndefined();
  });

  it('preserves Thai browsing language and Unicode service slugs', () => {
    const card = replyCardFromTool({ name: 'list_services', args: {}, result: JSON.stringify({ services: [{ name: 'นวดไทย', slug: 'นวดไทย', price: 800, currency: 'THB' }] }) }, { ...options, locale: 'th' });
    const action = card?.items[0].actions[0];
    expect(action?.type).toBe('message');
    if (action?.type !== 'message') throw new Error('Missing browse action');
    expect(action.id.length).toBeLessThanOrEqual(256);
    expect(cardBrowseMessage(action.id)).toBe('สนใจบริการ นวดไทย.');
    expect(cardBrowseMessage(action.id)).toBe(action.text);
  });
});
