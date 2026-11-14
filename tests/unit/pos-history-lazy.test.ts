// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from '@/components/checkout/backend';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';
import { OrderHistory, OrderHistoryList } from '@/components/checkout/OrderHistory';
import { HistoryDetails } from '@/components/checkout/HistoryDetails';
import { FinancialHistory } from '@/components/checkout/FinancialHistory';
import type { Doc, Id } from 'convex/_generated/dataModel';

let root: Root;
const first = 'fxbill000002' as OrderId, second = 'fxbill000001' as OrderId;
const hooks = ['useOrderHistory', 'useCorrectionHistory', 'useAuditHistory', 'useBookingRefundHistory', 'useAppointmentRefundHistory', 'useBillRefundHistory'] as const;
const toggle = async (title: string, open: boolean) => act(async () => {
  const details = [...document.querySelectorAll('details')].find(d => d.querySelector('summary')?.textContent === title)!;
  details.open = open;
  details.dispatchEvent(new Event('toggle'));
});
const click = async (label: string) => act(async () => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
  expect(button).toBeTruthy(); button.click();
});
const show = async (backend: CheckoutBackend, orderId = first) => act(async () => root.render(createElement(CheckoutBackendProvider,
  { backend } as ComponentProps<typeof CheckoutBackendProvider>,
  createElement(OrderHistory, { orderId }), createElement(FinancialHistory, { orderId }))));
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); root = createRoot(document.body.appendChild(document.createElement('div'))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('checks item-history availability while keeping financial ledgers lazy, retains cursors while closed, and resets on every order switch', async () => {
  const corrections: Doc<'billCorrections'>[] = [first, second].flatMap(billId => Array.from({ length: 61 }, (_, i) => ({
    _id: `${billId}-${i}` as Id<'billCorrections'>, _creationTime: i, billId, sequence: i + 1, kind: 'amended', reason: `${billId} reason ${i}`, actor: 'cashier', recordedAt: i, idempotencyKey: `${billId}-${i}`,
  })));
  const base = createFixtureBackend({ financialHistory: { corrections } });
  for (const orderId of [first, second]) await base.useActions().addItem({ orderId, item: { kind: "extra", name: "History item", price: 10 } });
  const calls = Object.fromEntries(hooks.map(h => [h, vi.fn()]));
  const mounts = vi.fn(), unmounts = vi.fn();
  function instrument<T>(hook: typeof hooks[number], usePage: (id: OrderId) => T) {
    return (id: OrderId) => {
      calls[hook](id);
      useEffect(() => { mounts(hook, id); return () => { unmounts(hook, id); }; }, [id]);
      return usePage(id);
    };
  }
  const backend: CheckoutBackend = { ...base,
    useOrderHistory: instrument('useOrderHistory', base.useOrderHistory),
    useCorrectionHistory: instrument('useCorrectionHistory', base.useCorrectionHistory),
    useAuditHistory: instrument('useAuditHistory', base.useAuditHistory),
    useBookingRefundHistory: instrument('useBookingRefundHistory', base.useBookingRefundHistory),
    useAppointmentRefundHistory: instrument('useAppointmentRefundHistory', base.useAppointmentRefundHistory),
    useBillRefundHistory: instrument('useBillRefundHistory', base.useBillRefundHistory),
  };
  await show(backend);
  expect(calls.useOrderHistory).toHaveBeenCalledOnce();
  for (const hook of hooks.slice(1)) expect(calls[hook]).not.toHaveBeenCalled();
  await toggle('History', true);
  expect(calls.useOrderHistory).toHaveBeenCalledOnce();
  for (const hook of hooks.slice(1)) expect(calls[hook]).not.toHaveBeenCalled();
  await toggle('History · all ledgers', true);
  expect(mounts).toHaveBeenCalledTimes(6);
  await click('Load older payment corrections');
  const rows = () => document.querySelectorAll('[aria-label="Payment corrections"] li');
  expect(rows()).toHaveLength(40);
  await toggle('History · all ledgers', false); await toggle('History', false);
  expect(unmounts).not.toHaveBeenCalled();
  await toggle('History · all ledgers', true); await toggle('History', true);
  expect(rows()).toHaveLength(40); expect(mounts).toHaveBeenCalledTimes(6);
  await click('Load older payment corrections'); await click('Load older payment corrections');
  expect(rows()).toHaveLength(61);
  const priorCalls = hooks.map(h => calls[h].mock.calls.length);
  await show(backend, second);
  expect(unmounts).toHaveBeenCalledTimes(6);
  expect(document.querySelectorAll('details[open]')).toHaveLength(0);
  expect(hooks.slice(1).map(h => calls[h].mock.calls.length)).toEqual(priorCalls.slice(1));
  expect(calls.useOrderHistory).toHaveBeenLastCalledWith(second);
  await toggle('History · all ledgers', true);
  expect(rows()).toHaveLength(20); expect(document.body.textContent).toContain(second);
  expect(document.body.textContent).not.toContain(`${first} reason`);
  await show(backend, first);
  expect(rows()).toHaveLength(0);
  await toggle('History · all ledgers', true);
  expect(rows()).toHaveLength(20);
});

it('keeps a receipt item-history failed continuation and its retry boundary through collapse/reopen, then clears it for a new order', async () => {
  const base = createFixtureBackend();
  let fail = false;
  const loadMore = vi.fn();
  const backend: CheckoutBackend = { ...base, useOrderHistory: id => {
    const [page, setPage] = useState(1);
    if (fail && id === first) throw new Error('Continuation failed');
    return { results: [], status: 'CanLoadMore', loadMore: n => { loadMore(n, page); fail = true; setPage(page + 1); } };
  } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Receipt history keeps its disclosure even when a paged query fails.
  const showReceiptHistory = async (orderId = first) => act(async () => root.render(createElement(CheckoutBackendProvider,
    { backend } as ComponentProps<typeof CheckoutBackendProvider>,
    createElement(HistoryDetails, { orderId, title: 'History' } as ComponentProps<typeof HistoryDetails>, createElement(OrderHistoryList, { orderId })))));
  await showReceiptHistory(); await toggle('History', true);
  await click('Load older order changes');
  expect(loadMore).toHaveBeenCalledExactlyOnceWith(20, 1);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load order history");
  fail = false;
  await toggle('History', false); await toggle('History', true);
  expect(document.querySelector('[role="alert"]')).toBeTruthy();
  await click('Try again');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await click('Load older order changes');
  await showReceiptHistory(second);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await toggle('History', true);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});


it('hides item History until the first recorded change arrives, then shows its real contents', async () => {
  const backend = createFixtureBackend();
  await show(backend);
  const itemHistory = () => [...document.querySelectorAll('summary')].find(el => el.textContent === 'History');
  expect(itemHistory()).toBeUndefined();
  await act(async () => { await backend.useActions().addItem({ orderId: first, item: { kind: 'extra', name: 'New history item', price: 10 } }); });
  expect(itemHistory()).toBeTruthy();
  await toggle('History', true);
  expect(document.querySelector('[aria-label="Order history"]')?.textContent).toContain('New history item');
});
