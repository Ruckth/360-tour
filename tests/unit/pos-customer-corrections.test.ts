// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutBackendProvider, type CheckoutBackend, type CustomerId, type OrderId } from '@/components/checkout/backend';
import { CheckoutView } from '@/components/checkout/CheckoutView';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';

let root: Root;
const customerId = 'fxcust000002' as CustomerId;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!;
const click = (text: string) => act(async () => { const found = button(text); expect(found, text).toBeTruthy(); found.click(); });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(500); });
const submit = () => act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
const type = (selector: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(el, selector).toBeTruthy();
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
async function show(backend: CheckoutBackend, orderId: OrderId) {
  await act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId, onOrderChange: () => {}, onPaid: () => {} }))));
}
async function setup() {
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const sale = actions.addItem({ item: { kind: 'extra', name: 'Water', price: 10000 } });
  await settle(); const { orderId } = await sale;
  const linking = actions.linkCustomer({ orderId, customerId }); await settle(); await linking;
  return { backend, actions, orderId };
}
async function openDetails() {
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="Customer:"]')!.click());
  await click('View / edit');
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount()); document.body.innerHTML = '';
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

it('opens the linked profile, retains edits on save error, retries without duplicates and shows history', async () => {
  const { backend, actions, orderId } = await setup();
  const save = vi.spyOn(actions, 'updateCustomer').mockRejectedValueOnce(new Error('Offline; reconnect to save'));
  const create = vi.spyOn(actions, 'createCustomer');
  await show(backend, orderId); await openDetails(); await click('Edit details');
  await type('#customer-edit-name', 'Somchai Corrected'); await type('#customer-edit-email', 'corrected@example.com');
  await type('#customer-edit-notes', 'Use this email'); await submit(); await settle();
  expect(document.querySelector<HTMLInputElement>('#customer-edit-name')?.value).toBe('Somchai Corrected');
  expect(document.querySelector<HTMLInputElement>('#customer-edit-email')?.value).toBe('corrected@example.com');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Offline');
  await submit(); await settle();
  expect(save).toHaveBeenCalledTimes(2); expect(create).not.toHaveBeenCalled();
  expect(save.mock.calls[1][0]).toMatchObject({ customerId, expectedRevision: 0, name: 'Somchai Corrected', notes: 'Use this email' });
  expect(document.querySelector('[aria-label="Customer history"]')?.textContent).toContain('Somchai Corrected');
  expect(document.body.textContent).toContain('Customer saved.');
  await click('Back to customers');
  expect(document.querySelector('[aria-label^="Customer:"]')?.textContent).toBe('Somchai Corrected');
});

it('does not overwrite a concurrent profile change or erase the local dirty draft', async () => {
  const { backend, actions, orderId } = await setup();
  await show(backend, orderId); await openDetails(); await click('Edit details');
  await type('#customer-edit-name', 'Local correction');
  const remote = actions.updateCustomer({ customerId, name: 'Changed by another cashier', expectedRevision: 0 });
  await settle(); await remote;
  expect(document.querySelector<HTMLInputElement>('#customer-edit-name')?.value).toBe('Local correction');
  await submit(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('changed');
  expect(document.querySelector<HTMLInputElement>('#customer-edit-name')?.value).toBe('Local correction');
});

it('prevents closing the customer sheet during a pending correction', async () => {
  const { backend, actions, orderId } = await setup();
  let resolve!: (value: null) => void;
  vi.spyOn(actions, 'updateCustomer').mockReturnValueOnce(new Promise<null>(r => { resolve = r; }));
  await show(backend, orderId); await openDetails(); await click('Edit details');
  await type('#customer-edit-name', 'Correction'); await submit();
  expect(button('Saving…')?.disabled).toBe(true);
  await click('Close');
  expect(document.querySelector<HTMLInputElement>('#customer-edit-name')?.value).toBe('Correction');
  await act(async () => resolve(null));
  expect(document.body.textContent).toContain('Customer saved.');
});

it('archives without a reason prompt and provides explicit archived access and restore', async () => {
  const { backend, actions, orderId } = await setup();
  const archive = vi.spyOn(actions, 'setCustomerArchived');
  await show(backend, orderId); await openDetails(); await click('Archive customer'); await settle();
  expect(archive).toHaveBeenCalledWith({ customerId, expectedRevision: 0, archived: true });
  expect(document.querySelector('textarea')).toBeNull();
  expect(document.body.textContent).toContain('Customer archived.');
  await click('Back to customers');
  expect(document.querySelector('[aria-label="Customers"]')?.textContent).not.toContain('Somchai');
  await click('Show archived customers');
  expect(document.querySelector('[aria-label="Customers"]')?.textContent).toContain('Somchai');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="View or edit Somchai Prasert"]')!.click());
  await click('Restore customer'); await settle();
  expect(archive).toHaveBeenLastCalledWith({ customerId, expectedRevision: 1, archived: false });
  await click('Back to customers'); await click('Show active customers');
  expect(document.querySelector('[aria-label="Customers"]')?.textContent).toContain('Somchai');
});

it('opens the editor directly from a search result and recovers a paginated search failure', async () => {
  const { backend, orderId } = await setup();
  let down = true;
  const flaky: CheckoutBackend = { ...backend, useCustomerPage: (query, archived) => { if (down && query.length >= 2) throw new Error('Disconnected'); return backend.useCustomerPage(query, archived); } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await show(flaky, orderId);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="Customer:"]')!.click());
  await type('[aria-label="Search customers"]', 'Anna');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't search customers");
  down = false; await click('Try again');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="View or edit Anna Schmidt"]')!.click());
  await click('Edit details');
  expect(document.querySelector<HTMLInputElement>('#customer-edit-name')?.value).toBe('Anna Schmidt');
});

it('enables deliberate duplicate merging with destination/reason review and visible completion', async () => {
  const { backend, actions, orderId } = await setup();
  const merge = vi.spyOn(actions, 'mergeCustomers');
  await show(backend, orderId); await openDetails(); await click('Merge duplicate…');
  expect(document.body.textContent).toContain('Names and contact matches do not prove');
  expect(button('Merge into kept customer')).toBeUndefined();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Anna Schmidt · +49'))!.click());
  await type('#customer-merge-reason', 'Confirmed duplicate');
  expect(button('Merge into kept customer').disabled).toBe(false);
  expect(document.body.textContent).toContain('issued receipts stay unchanged');
  await submit(); await settle();
  expect(merge).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain('Merge completed · 2 order references moved.');
  expect(button('Open kept customer')).toBeTruthy();
});

it('uses both reviewed revisions and reuses the merge attempt key after a failed submission', async () => {
  const { backend, actions, orderId } = await setup();
  const integrated: CheckoutBackend = { ...backend, useCustomer: (id) => { const profile = backend.useCustomer(id); return profile ? { ...profile, mergeEnabled: true } : profile; } };
  const merge = vi.spyOn(actions, 'mergeCustomers').mockRejectedValueOnce(new Error('Connection dropped')).mockRejectedValueOnce(new Error('Still offline'));
  await show(integrated, orderId); await openDetails(); await click('Merge duplicate…');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Anna Schmidt · +49'))!.click());
  expect(button('Merge into kept customer').disabled).toBe(true);
  await type('#customer-merge-reason', 'Verified same person by phone'); await submit(); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Connection dropped');
  expect(document.querySelector<HTMLTextAreaElement>('#customer-merge-reason')?.value).toBe('Verified same person by phone');
  await submit(); await settle();
  expect(merge).toHaveBeenCalledTimes(2);
  expect(merge.mock.calls[0][0]).toEqual(merge.mock.calls[1][0]);
  expect(merge.mock.calls[0][0]).toMatchObject({ sourceId: customerId, destinationId: 'fxcust000001', sourceRevision: 0, destinationRevision: 0, reason: 'Verified same person by phone' });
});

it('keeps pagination accessible even when an archive-filtered search page is empty', async () => {
  const { backend, orderId } = await setup();
  const loadMore = vi.fn();
  const paginated: CheckoutBackend = { ...backend, useCustomerPage: () => ({ results: [], status: 'CanLoadMore', loadMore }) };
  await show(paginated, orderId);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="Customer:"]')!.click());
  expect(document.body.textContent).not.toContain('No active customers.');
  await click('Load more customers');
  expect(loadMore).toHaveBeenCalledWith(20);
});

it('offers independent full order and history pagination in customer details', async () => {
  const { backend, orderId } = await setup();
  const moreOrders = vi.fn(); const moreHistory = vi.fn();
  const paginated: CheckoutBackend = { ...backend,
    useCustomerOrders: (id) => ({ ...backend.useCustomerOrders(id), status: 'CanLoadMore', loadMore: moreOrders }),
    useCustomerHistory: (id) => ({ ...backend.useCustomerHistory(id), status: 'CanLoadMore', loadMore: moreHistory })
  };
  await show(paginated, orderId); await openDetails();
  await click('Load more customer orders'); await click('Load more customer history');
  expect(moreOrders).toHaveBeenCalledWith(20); expect(moreHistory).toHaveBeenCalledWith(20);
});

it('shows bounded large-merge progress and an active resume action that safely races scheduled continuation', async () => {
  const { backend, actions, orderId } = await setup();
  for (let i = 0; i < 204; i++) {
    const adding = actions.addItem({ item: { kind: 'extra', name: `History ${i}`, price: 100 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    const added = await adding;
    const linking = actions.linkCustomer({ orderId: added.orderId, customerId });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); }); await linking;
  }
  const resume = vi.spyOn(actions, 'resumeCustomerMerge');
  await show(backend, orderId); await openDetails(); await click('Merge duplicate…');
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Anna Schmidt · +49'))!.click());
  await type('#customer-merge-reason', 'Verified duplicate with retained large history'); await submit();
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(document.body.textContent).toContain('Merge in progress · 100 order references moved.');
  expect(button('Resume merge').disabled).toBe(false);
  await click('Resume merge');
  await settle();
  expect(resume).toHaveBeenCalledOnce();
  expect(document.body.textContent).toContain('Merge completed · 206 order references moved.');
  expect(button('Resume merge')).toBeUndefined();
});
