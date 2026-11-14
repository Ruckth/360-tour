// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type ComponentProps, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutDraftProvider, useCheckoutDraft, useCheckoutDraftOrder, useCheckoutDraftState, useCheckoutDiscountNotice, useCheckoutPaymentSubmitting } from '@/components/checkout/CheckoutDrafts';
import { CheckoutBackendProvider, type CheckoutBackend, type OrderView } from '@/components/checkout/backend';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';
import { OrderPanel } from '@/components/checkout/OrderPanel';

let root: Root;
let backend: ReturnType<typeof createFixtureBackend>;
let view: OrderView;
let setMounted: Dispatch<SetStateAction<boolean>>;
let setDraft: Dispatch<SetStateAction<string>>;
let notice: ReturnType<typeof useCheckoutDiscountNotice>;
let payment: ReturnType<typeof useCheckoutPaymentSubmitting>;
const orderId = 'fxbill000002' as OrderView['order']['_id'];
let key: string;
function Editor() {
  const [value, set] = useCheckoutDraftState(key, '');
  useEffect(() => { setDraft = set; }, [set]);
  useCheckoutDraft(Boolean(value), () => set(''), key);
  return createElement('p', { 'data-draft': true }, value);
}
function Harness({ panel = false }: { panel?: boolean }) {
  const current = backend.useOrder(orderId)!;
  useCheckoutDraftOrder(orderId, current, backend.useOrderApprovals(orderId));
  const currentNotice = useCheckoutDiscountNotice();
  const currentPayment = useCheckoutPaymentSubmitting();
  const catalog = backend.useCatalog();
  const [mounted, set] = useState(true);
  useEffect(() => {
    view = current; notice = currentNotice; payment = currentPayment; setMounted = set;
  }, [current, currentNotice, currentPayment, set]);
  return panel ? createElement(OrderPanel, { view: current, title: current.order.title, catalog, run: async task => { await task(orderId); return true; }, onPaid: () => {} }) : mounted ? createElement(Editor) : null;
}
const show = async (panel = false) => {
  const providerBackend: CheckoutBackend = backend;
  await act(async () => root.render(createElement(CheckoutBackendProvider,
    { backend: providerBackend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutDraftProvider,
      {} as ComponentProps<typeof CheckoutDraftProvider>, createElement(Harness, { panel })))));
};
function dirty() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  backend = createFixtureBackend();
  key = `${orderId}:fxline000002:price`;
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); });

it('retains keyed drafts across rotation, then removes an invisible draft and rejects late replies after its line disappears', async () => {
  await show();
  key = `${orderId}:${view.lines[0]._id}:price`;
  // Remount with the real line key.
  await act(async () => setMounted(false)); await act(async () => setMounted(true));
  await act(async () => setDraft('1100'));
  await act(async () => setMounted(false));
  expect(dirty()).toBe(true);
  await act(async () => setMounted(true));
  expect(document.querySelector('[data-draft]')?.textContent).toBe('1100');
  const lateReply = setDraft;
  await act(async () => setMounted(false));
  await act(async () => { await backend.useActions().removeLine({ lineId: view.lines[0]._id }); });
  expect(dirty()).toBe(false);
  await act(async () => lateReply('late stale value'));
  await act(async () => setMounted(true));
  expect(document.querySelector('[data-draft]')?.textContent).toBe('');
  expect(dirty()).toBe(false);
});

it.each(['paid', 'discarded'] as const)('cleans invisible drafts and the discount notice when the order is %s elsewhere', async state => {
  await show(); key = `${orderId}:${view.lines[0]._id}:price`;
  await act(async () => setMounted(false)); await act(async () => setMounted(true));
  await act(async () => {
    setDraft('1100');
    notice.setDiscountNotice({ orderId, lineId: view.lines[0]._id, discount: '', message: 'Refused discount', review: true });
  });
  await act(async () => setMounted(false));
  await act(async () => {
    if (state === 'paid') await backend.useActions().settleOrder({ orderId, expectedRevision: view.order.revision, expectedDue: view.totals.due, expectedCustomerRevision: view.customer && "revision" in view.customer ? view.customer.revision : undefined, idempotencyKey: 'draft-cleanup-paid', tenders: [{ method: 'cash', amount: view.totals.due }] });
    else await backend.useActions().discardOrder({ orderId, expectedRevision: view.order.revision, idempotencyKey: 'draft-cleanup-discard' });
  });
  expect(dirty()).toBe(false);
  expect(notice.discountNotice).toBeNull();
});

it('clears a notice after its line disappears or its discount changes', async () => {
  await show();
  const lineId = view.lines[0]._id;
  const refusal = { orderId, lineId, discount: '', message: 'Refused discount' };
  await act(async () => notice.setDiscountNotice(refusal));
  await act(async () => { await backend.useActions().updateLine({ lineId, discount: { type: 'percent', value: 5 } }); });
  expect(notice.discountNotice).toBeNull();
  await act(async () => notice.setDiscountNotice({ ...refusal, discount: '5%' }));
  await act(async () => { await backend.useActions().removeLine({ lineId }); });
  expect(notice.discountNotice).toBeNull();
});

it('does not consume a pending Review or replace the editor while payment is submitting', async () => {
  await show(true);
  await act(async () => {
    payment.setPaymentSubmitting(true);
    notice.setDiscountNotice({ orderId, lineId: view.lines[0]._id, discount: '', message: 'Refused discount', review: true });
  });
  expect(notice.discountNotice?.review).toBe(true);
  expect(document.querySelector('input[aria-label="Discount"]')).toBeNull();
  await act(async () => payment.setPaymentSubmitting(false));
  expect(notice.discountNotice).toBeNull();
  expect(document.querySelector('input[aria-label="Discount"]')).toBeTruthy();
});

it('clears a notice when its manager request is sent elsewhere, including a late notice after removal', async () => {
  await show();
  const lineId = view.lines[0]._id;
  const refusal = { orderId, lineId, discount: '', message: 'Refused discount', review: true };
  await act(async () => notice.setDiscountNotice(refusal));
  await act(async () => { await backend.seedApproval({ orderId, requesterEmail: 'cashier@example.com', reason: 'Guest waited', payload: { kind: 'discount', lineId, discount: { type: 'percent', value: 20 } } }); });
  expect(notice.discountNotice).toBeNull();
  await act(async () => { await backend.useActions().removeLine({ lineId }); });
  await act(async () => notice.setDiscountNotice(refusal));
  expect(notice.discountNotice).toBeNull();
});
