// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from '@/components/checkout/backend';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';
import { OrderHistory } from '@/components/checkout/OrderHistory';
import { FinancialHistory } from '@/components/checkout/FinancialHistory';
import type { Doc, Id } from 'convex/_generated/dataModel';

let root: Root;
const first = 'fxbill000002' as OrderId, second = 'fxbill000003' as OrderId;
const hooks = ['useOrderHistory', 'useCorrectionHistory', 'useAuditHistory', 'useBookingRefundHistory', 'useAppointmentRefundHistory', 'useOrderRefundHistory'] as const;
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

it('subscribes only on first expansion, retains all ledger cursors while closed, and resets on every order switch', async () => {
  const corrections: Doc<'orderCorrections'>[] = [first, second].flatMap(orderId => Array.from({ length: 61 }, (_, i) => ({
    _id: `${orderId}-${i}` as Id<'orderCorrections'>, _creationTime: i, orderId, sequence: i + 1, kind: 'amended', reason: `${orderId} reason ${i}`, actor: 'cashier', recordedAt: i, idempotencyKey: `${orderId}-${i}`,
  })));
  const base = createFixtureBackend({ financialHistory: { corrections } });
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
    useOrderRefundHistory: instrument('useOrderRefundHistory', base.useOrderRefundHistory),
  };
  await show(backend);
  for (const hook of hooks) expect(calls[hook]).not.toHaveBeenCalled();
  await toggle('Order history', true);
  expect(calls.useOrderHistory).toHaveBeenCalledOnce();
  for (const hook of hooks.slice(1)) expect(calls[hook]).not.toHaveBeenCalled();
  await toggle('Browse all financial history', true);
  expect(mounts).toHaveBeenCalledTimes(6);
  await click('Load older payment amendments');
  const rows = () => document.querySelectorAll('[aria-label="All payment amendments"] li');
  expect(rows()).toHaveLength(40);
  await toggle('Browse all financial history', false); await toggle('Order history', false);
  expect(unmounts).not.toHaveBeenCalled();
  await toggle('Browse all financial history', true); await toggle('Order history', true);
  expect(rows()).toHaveLength(40); expect(mounts).toHaveBeenCalledTimes(6);
  await click('Load older payment amendments'); await click('Load older payment amendments');
  expect(rows()).toHaveLength(61);
  const priorCalls = hooks.map(h => calls[h].mock.calls.length);
  await show(backend, second);
  expect(unmounts).toHaveBeenCalledTimes(6);
  expect(document.querySelectorAll('details[open]')).toHaveLength(0);
  expect(hooks.map(h => calls[h].mock.calls.length)).toEqual(priorCalls);
  await toggle('Browse all financial history', true);
  expect(rows()).toHaveLength(20); expect(document.body.textContent).toContain(second);
  expect(document.body.textContent).not.toContain(`${first} reason`);
  await show(backend, first);
  expect(rows()).toHaveLength(0);
  await toggle('Browse all financial history', true);
  expect(rows()).toHaveLength(20);
});

it('keeps a failed continuation and its retry boundary through collapse/reopen, then clears it for a new order', async () => {
  const base = createFixtureBackend();
  let fail = false;
  const loadMore = vi.fn();
  const backend: CheckoutBackend = { ...base, useOrderHistory: id => {
    const [page, setPage] = useState(1);
    if (fail && id === first) throw new Error('Continuation failed');
    return { results: [], status: 'CanLoadMore', loadMore: n => { loadMore(n, page); fail = true; setPage(page + 1); } };
  } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await show(backend); await toggle('Order history', true);
  await click('Load older order changes');
  expect(loadMore).toHaveBeenCalledExactlyOnceWith(20, 1);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load order history");
  fail = false;
  await toggle('Order history', false); await toggle('Order history', true);
  expect(document.querySelector('[role="alert"]')).toBeTruthy();
  await click('Try again');
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await click('Load older order changes');
  await show(backend, second);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  await toggle('Order history', true);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
