// @vitest-environment happy-dom
import { act, Component, createElement, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from '@/components/checkout/backend';
import { CheckoutView } from '@/components/checkout/CheckoutView';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';

let root: Root;
class PageBoundary extends Component<{ children?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? createElement('p', { 'data-testid': 'page-error' }, 'This view could not load') : this.props.children; }
}
const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function render(backend: CheckoutBackend, orderId: OrderId) {
  await act(async () => root.render(createElement(PageBoundary, {}, createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId, onOrderChange: () => {}, onPaid: () => {} })))));
}
async function setup() {
  const backend = createFixtureBackend();
  const adding = backend.useActions().addItem({ item: { kind: 'extra', name: 'Audit item', price: 100 } });
  await vi.advanceTimersByTimeAsync(200);
  return { backend, orderId: (await adding).orderId };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks();
});

describe('Independent checkout error recovery', () => {
  it.each(['customer', 'booking'] as const)('keeps checkout usable when the %s search query fails', async kind => {
    const { backend, orderId } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed: CheckoutBackend = kind === 'customer'
      ? { ...backend, useCustomerSearch: query => { if (query.trim().length >= 2) throw new Error('Search unavailable'); return []; } }
      : { ...backend, useAttachable: ({ query }) => { if (query.trim().length >= 2) throw new Error('Search unavailable'); return []; } };
    await render(failed, orderId);
    await act(async () => button(kind === 'customer' ? 'Add customer' : 'Add booking').click());
    await act(async () => type(document.querySelector<HTMLInputElement>(`input[aria-label="Search ${kind === 'customer' ? 'customers' : 'bookings'}"]`)!, 'Guest'));
    // A query error should be recoverable inside its dialog, like Orders, without losing the order UI.
    expect(document.querySelector('[data-testid="page-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe('Order #1043');
    expect(button('Try again')).toBeTruthy();
  });

  it('retains entered customer details for retry after create fails', async () => {
    const { backend, orderId } = await setup();
    vi.spyOn(backend.useActions(), 'createCustomer').mockRejectedValueOnce(new Error('Customer could not save'));
    await render(backend, orderId);
    await act(async () => button('Add customer').click());
    await act(async () => button('New customer').click());
    await act(async () => type(document.querySelector<HTMLInputElement>('#customer-name')!, 'Recovery payer'));
    await act(async () => type(document.querySelector<HTMLInputElement>('#customer-phone')!, '0812345678'));
    await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Customer could not save');
    expect(document.querySelector<HTMLInputElement>('#customer-name')?.value).toBe('Recovery payer');
    expect(document.querySelector<HTMLInputElement>('#customer-phone')?.value).toBe('0812345678');
  });

  it('keeps an Orders query error inside the dialog and retries without losing checkout', async () => {
    const { backend, orderId } = await setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let failed = true;
    const recoverable: CheckoutBackend = { ...backend, useOrders: () => {
      if (failed) throw new Error('Orders unavailable');
      return { results: [], status: 'Exhausted', loadMore: () => {} };
    } };
    await render(recoverable, orderId);
    await act(async () => button('Orders').click());
    expect(document.querySelector('[data-testid="page-error"]')).toBeNull();
    expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe('Order #1043');
    expect(document.body.textContent).toContain("Couldn't load orders");
    failed = false;
    await act(async () => button('Try again').click());
    expect(document.body.textContent).toContain('No unpaid orders.');
  });

  it('announces initial Orders loading and requests the next page once when tapped', async () => {
    const { backend, orderId } = await setup();
    const loadMore = vi.fn();
    let loaded = false;
    const paginated: CheckoutBackend = { ...backend, useOrders: () => ({
      results: loaded ? [{ _id: orderId, title: 'Order #1043', orderNumber: 1043, state: 'unpaid', itemCount: 1, total: 100, due: 100, currency: 'THB', updatedAt: Date.now(), receiptNumber: undefined, customerName: undefined, bookingReference: 'QA-MOCK-SOURCE', otherBookings: 0 }] : [],
      status: loaded ? 'CanLoadMore' : 'LoadingFirstPage', loadMore,
    }) };
    await render(paginated, orderId);
    await act(async () => button('Orders').click());
    expect(document.querySelector('[aria-label="Loading orders"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain('No unpaid orders.');
    loaded = true;
    await render(paginated, orderId);
    await act(async () => button('Load more').click());
    expect(loadMore).toHaveBeenCalledExactlyOnceWith(20);
  });

  it('shows a query loading state and keeps customer separate from booking', async () => {
    const { backend, orderId } = await setup();
    const pending: CheckoutBackend = { ...backend, useCustomerSearch: query => query.length >= 2 ? undefined : [] };
    await render(pending, orderId);
    await act(async () => button('Add customer').click());
    await act(async () => type(document.querySelector<HTMLInputElement>('[aria-label="Search customers"]')!, 'Anna'));
    expect(document.querySelector('[aria-label="Searching"]')).toBeTruthy();
    expect(document.body.textContent).toContain('No booking');
    expect(document.body.textContent).not.toContain('No customer matches');
  });
});
