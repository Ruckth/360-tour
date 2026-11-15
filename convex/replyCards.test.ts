import { describe, expect, it } from 'vitest';
import { cardBrowseMessage, replyCardFromTool } from './shared/replyCards';

const options = { siteUrl: 'https://resort.example', locale: 'en' };
const make = (name: string, result: unknown) => replyCardFromTool({ name, args: {}, result: JSON.stringify(result) }, options);

describe('tool-grounded reply cards', () => {
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
