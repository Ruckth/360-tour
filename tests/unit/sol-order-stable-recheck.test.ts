// @vitest-environment happy-dom
// Independent stable-candidate checks of customer recovery and writes across order switches.
import { act, createElement, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutBackendProvider, type CheckoutBackend, type CustomerId, type OrderId } from '@/components/checkout/backend';
import { CheckoutView } from '@/components/checkout/CheckoutView';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';

let root: Root;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
const click = (text: string) => act(async () => button(text).click());
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(500); });
const submit = () => act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
const type = (id: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement>(id)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const changes = vi.fn();
async function show(backend: CheckoutBackend, orderId: OrderId) {
  await act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId, onOrderChange: changes, onPaid: () => {} }))));
}
function NavigableCheckout({ backend, initialOrder }: { backend: CheckoutBackend; initialOrder: OrderId }) {
  const [orderId, setOrderId] = useState<OrderId | null>(initialOrder);
  return createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId, onOrderChange: (id) => { changes(id); setOrderId(id); }, onPaid: () => {} }));
}
async function setup() {
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const one = actions.addItem({ item: { kind: 'extra', name: 'First sale', price: 100 } });
  await settle();
  const a = (await one).orderId;
  const two = actions.addItem({ item: { kind: 'extra', name: 'Second sale', price: 200 } });
  await settle();
  const b = (await two).orderId;
  return { backend, actions, a, b };
}
async function form(name: string) {
  await click('Add customer');
  await click('New customer');
  await type('#customer-name', name);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  changes.mockReset();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('retries a rejected create with every value retained and links the same order', async () => {
  const { backend, actions, a } = await setup();
  const create = vi.spyOn(actions, 'createCustomer').mockRejectedValueOnce(new Error('Offline'));
  const link = vi.spyOn(actions, 'linkCustomer');
  await show(backend, a);
  await form('Independent payer');
  await type('#customer-phone', '0812345678');
  await type('#customer-email', 'retry@example.com');
  await submit(); await settle();
  expect(document.querySelector<HTMLInputElement>('#customer-name')?.value).toBe('Independent payer');
  expect(document.querySelector<HTMLInputElement>('#customer-phone')?.value).toBe('0812345678');
  expect(document.querySelector<HTMLInputElement>('#customer-email')?.value).toBe('retry@example.com');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Offline');
  await submit(); await settle();
  expect(create).toHaveBeenCalledTimes(2);
  expect(link).toHaveBeenCalledTimes(1);
  expect(link.mock.calls[0][0].orderId).toBe(a);
  expect(document.querySelector('[aria-label^="Customer:"]')?.textContent).toBe('Independent payer');
});

it('keeps a pending customer write on its original order after an order switch', async () => {
  const { backend, actions, a, b } = await setup();
  const pending = deferred<CustomerId>();
  const customerId = 'fxcust000002' as CustomerId;
  vi.spyOn(actions, 'createCustomer').mockReturnValueOnce(pending.promise);
  const link = vi.spyOn(actions, 'linkCustomer');
  await show(backend, a);
  await form('Original payer');
  await submit();
  await click('Close');
  await show(backend, b);
  await act(async () => pending.resolve(customerId));
  await settle();
  expect(link.mock.calls[0][0]).toEqual({ orderId: a, customerId });
  expect(changes).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe('Order #1044');
  expect(document.querySelector('[aria-label^="Customer:"]')).toBeNull();
  await show(backend, a);
  expect(document.querySelector('[aria-label^="Customer:"]')).not.toBeNull();
});

it('does not close a new order customer draft when an earlier order customer write finishes', async () => {
  const { backend, actions, a, b } = await setup();
  const pending = deferred<CustomerId>();
  vi.spyOn(actions, 'createCustomer').mockReturnValueOnce(pending.promise);
  const link = vi.spyOn(actions, 'linkCustomer');
  await act(async () => root.render(createElement(NavigableCheckout, { backend, initialOrder: a })));
  await form('Original payer');
  await submit();
  await click('Close');
  await click('Orders');
  await act(async () => {
    const other = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Unpaid orders"] button')].find(el => el.textContent?.includes('Order #1044'))!;
    expect(other).toBeTruthy();
    other.click();
  });
  expect(changes).toHaveBeenLastCalledWith(b);
  await form('Second order draft');
  await type('#customer-phone', '0891112222');
  expect(document.querySelector<HTMLInputElement>('#customer-name')?.value).toBe('Second order draft');
  await act(async () => pending.resolve('fxcust000002' as CustomerId));
  await settle();
  expect(link.mock.calls[0][0].orderId).toBe(a);
  expect(document.querySelector('[data-testid="order-title"]')?.textContent).toBe('Order #1044');
  expect(document.querySelector<HTMLInputElement>('#customer-name')?.value).toBe('Second order draft');
  expect(document.querySelector<HTMLInputElement>('#customer-phone')?.value).toBe('0891112222');
});


it('preserves a reopened customer draft on the same order when an earlier write finishes', async () => {
  const { backend, actions, a } = await setup();
  const pending = deferred<CustomerId>();
  vi.spyOn(actions, 'createCustomer').mockReturnValueOnce(pending.promise);
  await show(backend, a);
  await form('Original payer');
  await submit();
  await click('Close');
  await form('Reopened draft');
  await type('#customer-phone', '0891112222');
  await act(async () => pending.resolve('fxcust000002' as CustomerId));
  await settle();
  expect(document.querySelector<HTMLInputElement>('#customer-name')?.value).toBe('Reopened draft');
  expect(document.querySelector<HTMLInputElement>('#customer-phone')?.value).toBe('0891112222');
});
