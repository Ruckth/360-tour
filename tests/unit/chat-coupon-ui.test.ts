// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IntlProvider } from '@/platform/intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import { evaluateOffer } from 'convex/shared/offers';
import { ChatBookingCard } from '@/components/chat/ChatBookingCard';
import { ProposalPayClient } from '@/components/booking/ProposalPayClient';
import { extractChatBookingContext } from '@/lib/chat/booking-intent';

const mock = vi.hoisted(() => ({ client: null as unknown, query: vi.fn(), mutation: vi.fn(), action: vi.fn(), preview: {} as unknown }));
vi.mock('convex/react', async (importOriginal) => ({ ...await importOriginal<typeof import('convex/react')>(), useConvex: () => mock.client }));
vi.mock('@/lib/marketing/capture', () => ({ captureForBooking: () => ({}) }));
vi.mock('@/components/booking/useCouponPreview', () => ({ useCouponPreview: () => ({ preview: mock.preview }) }));
vi.mock('@/components/booking/BookingDatePicker', () => ({ BookingRangePicker: () => null }));
vi.mock('@/components/property/PropertyImage', () => ({ PropertyImage: () => null }));
const offer = evaluateOffer({ lines: [{ id: 'stay', kind: 'accommodation', propertySlug: 'pool-villa', checkIn: '2027-01-10', checkOut: '2027-01-12', nights: 2, amount: 2000000 }], directDiscountPercent: 1500, today: '2026-11-11', coupon: { code: 'GUEST20', version: 1, status: 'active', benefit: { kind: 'percent', percent: 2000 }, scope: 'accommodation', used: 0, discountGranted: 0 } });
let root: Root;
const intl: ComponentProps<typeof IntlProvider> = { locale: 'en', messages, timeZone: 'Asia/Bangkok', children: null };
async function show(component: React.ReactElement) { await act(async () => root.render(createElement(IntlProvider, intl, component))); }
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button ${label}`);
  await act(async () => button.click());
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  mock.client = null;
  mock.preview = { status: 'ready', result: offer };
  window.location.href = 'https://resort.example/booking/pay?proposal=original';
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });
it('shows the server coupon saving and carries the guest code into booking checkout', async () => {
  const context = extractChatBookingContext({ latestUserMessage: 'Book pool-villa 2027-01-10 to 2027-01-12 coupon GUEST20', activePropertySlug: 'pool-villa' });
  expect(context.couponCode).toBe('GUEST20');
  expect(extractChatBookingContext({ latestUserMessage: 'book a villa', latestAssistantMessage: 'coupon INVENTED' }).couponCode).toBeUndefined();
  await show(createElement(ChatBookingCard, { context }));
  expect(document.body.textContent).toContain('GUEST20 applied. You save ฿4,000.');
  expect(document.body.textContent).toContain('16,000');
  await click('Book');
  expect(new URL(window.location.href).searchParams.get('coupon')).toBe('GUEST20');
});
it('displays a refusal and waits for a second explicit review before starting payment', async () => {
  const summary = { property: 'Pool Villa', checkIn: '2027-01-10', checkOut: '2027-01-12', guests: 2, nights: 2, total: 1600000, currency: 'THB', unpaidHoldMinutes: 30, cancellationPolicy: '', holdExpiresAt: null,
    coupon: { code: 'GUEST20', status: 'applied', discount: 400000 } };
  mock.query.mockResolvedValue(summary);
  mock.mutation.mockResolvedValueOnce({ needsReview: true, quote: { ...summary, total: 1700000, confirmToken: 'new-review', coupon: { code: 'GUEST20', status: 'invalid', discount: 0, problem: { code: 'sold_out' } } } });
  mock.mutation.mockResolvedValueOnce({ needsReview: false, bookingId: 'booking', accessToken: 'secret' });
  mock.action.mockRejectedValue(new Error('Stop after verified payment call'));
  mock.client = { query: mock.query, mutation: mock.mutation, action: mock.action };
  await show(createElement(ProposalPayClient, { token: 'original' }));
  await click('Confirm and pay');
  expect(mock.action).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('17,000');
  expect(document.body.textContent).toContain('fully used');
  await click('Confirm and pay');
  expect(mock.mutation.mock.calls[1][1]).toMatchObject({ token: 'new-review' });
  expect(mock.action).toHaveBeenCalledTimes(1);
});
it('G23: chat villa prices use each villa’s configured direct discount, matching the booking quote', async () => {
  const { calculateDirectQuote } = await import('convex/shared/pricing');
  const row = (slug: string, directDiscountPercent: number) => ({ _id: slug, slug, name: slug, tagline: '', description: '', pricePerNight: 1000000, maxGuests: 4, bedrooms: 1, bathrooms: 1, area: 50, images: [], amenities: [], tourRoomIds: [], currency: 'THB', directDiscountPercent });
  const rows = [row('ten-percent', 1000), row('no-discount', 0), row('default-fifteen', 1500)];
  mock.preview = { status: 'idle' };
  mock.client = { query: async (_ref: unknown, args: unknown) => (args && typeof args === 'object' && !('propertySlug' in args) ? rows : []), mutation: mock.mutation, action: mock.action };
  await show(createElement(ChatBookingCard, { context: { propertySlug: 'ten-percent' } as never }));
  const price = (slug: string) => document.querySelector(`[data-testid="chat-villa-price-${slug}"]`)?.firstChild?.textContent;
  const thb = (baht: number) => new Intl.NumberFormat('en', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 }).format(baht);
  expect(price('ten-percent')).toBe(thb(9000));
  expect(price('no-discount')).toBe(thb(10000));
  expect(price('default-fifteen')).toBe(thb(8500));
  for (const item of rows) expect(price(item.slug)).toBe(thb(calculateDirectQuote(item, 1).directTotal / 100));
});
