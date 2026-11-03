// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps, type ReactNode, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView, type RestoreReview } from '@/components/checkout/backend';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';
import { CheckoutView } from '@/components/checkout/CheckoutView';
import { OrdersBrowser } from '@/components/checkout/OrderStrip';
import { OrderLifecycle } from '@/components/checkout/OrderLifecycle';
import { AppointmentFeeControls } from '@/components/admin/AppointmentFeeAction';
import { FinancialHistory } from '@/components/checkout/FinancialHistory';
import type { Doc, Id } from 'convex/_generated/dataModel';

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));

let root: Root, current: OrderView, review: RestoreReview | undefined;
const saved = 'fxbill000002' as OrderId;
const appt = 'fxappt000002' as Id<'serviceAppointments'>;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const button = (text: string) => buttons().find(b => b.textContent?.trim() === text)!;
const click = (text: string) => act(async () => { expect(button(text), text).toBeTruthy(); button(text).click(); });
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
async function run<T>(promise: Promise<T>) { await tick(); return await promise; }
async function show(backend: CheckoutBackend, child: ReactElement) { await act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child))); }
function Probe({ backend, id }: { backend: CheckoutBackend; id: OrderId }) { current = backend.useOrder(id)!; review = backend.useRestoreCheck(id); return null; }
const probe = (backend: CheckoutBackend, id = saved) => show(backend, createElement(Probe, { backend, id }));
function Harness({ id }: { id: OrderId }) { const [orderId, setOrderId] = useState<OrderId | null>(id); return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: vi.fn() }); }
const input = (selector: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const expandHistory = async (title: string) => act(async () => {
  const summary = [...document.querySelectorAll("summary")].find(el => el.textContent === title)!;
  const details = summary.parentElement as HTMLDetailsElement;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
});
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); root = createRoot(document.body.appendChild(document.createElement('div'))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('directly discards the selected order, guards pending dismissal, and reopens retained rows read only', async () => {
  const backend = createFixtureBackend();
  await show(backend, createElement(Harness, { id: saved }));
  await click('Orders'); await click('Discard');
  const dialog = document.querySelector('[role="dialog"]')!;
  await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  expect(button('Back to orders').disabled).toBe(true);
  await tick();
  expect(document.body.textContent).toContain('bookings are not cancelled');
  await click('Back to orders'); await click('Discarded');
  const row = document.querySelector<HTMLButtonElement>('[aria-current="true"]')!;
  await act(async () => row.click());
  expect(document.body.textContent).toContain('Read only');
  expect(document.body.textContent).toContain('Foot spa 45'); expect(document.body.textContent).toContain('Coconut water');
  expect(button('Cash')).toBeUndefined(); expect(button('Add booking').disabled).toBe(true);
  await expandHistory("Order history");
  expect(document.querySelector('[aria-label="Order history"]')!.textContent).toContain('Order discarded');
  await probe(backend); expect(current.order.customerId).toBe('fxcust000002'); expect(current.lines).toHaveLength(2);
  const denied = expect(backend.useActions().addItem({ orderId: saved, item: { kind: 'extra', name: 'Refused', price: 1 } })).rejects.toThrow('discarded'); await tick(); await denied;
});
it('retries a lost discard response with the identical key and revision after it leaves Unpaid', async () => {
  const backend = createFixtureBackend(); const actions = backend.useActions(), original = actions.discardOrder;
  const discard = vi.spyOn(actions, 'discardOrder').mockImplementationOnce(async args => { await original(args); throw new Error('Response lost'); });
  await show(backend, createElement(OrdersBrowser, { currentId: saved, onOpen: vi.fn() }));
  await click('Discard'); await tick();
  expect(document.body.textContent).toContain('Response lost'); await click('Retry discard'); await tick();
  expect(discard).toHaveBeenCalledTimes(2); expect(discard.mock.calls[1][0]).toEqual(discard.mock.calls[0][0]);
  expect(document.body.textContent).toContain('discarded. Contents');
  await probe(backend); expect(current.order.revision).toBe(3);
});
it('reviews source conflicts and explicitly restores without competing rows, preserving removal history and links', async () => {
  const backend = createFixtureBackend(), actions = backend.useActions();
  const { orderId } = await run(actions.openOrderFor({ appointmentId: appt }));
  await run(actions.addItem({ orderId, item: { kind: 'extra', name: 'Keep me', price: 10 } }));
  await probe(backend, orderId);
  await run(actions.discardOrder({ orderId, expectedRevision: current.order.revision, idempotencyKey: 'discard-source' }));
  const other = await run(actions.openOrderFor({ appointmentId: appt })); expect(other.orderId).not.toBe(orderId);
  const onOpen = vi.fn();
  await show(backend, createElement(OrderLifecycle, { orderId, mode: 'restore', onDone: vi.fn(), onPending: vi.fn(), onOpen }));
  expect(document.body.textContent).toContain('is now on Order');
  await click('Restore without 1 conflicting row'); await tick();
  await click('Open restored order'); expect(onOpen).toHaveBeenCalledWith(orderId);
  await probe(backend, orderId); expect(current.order.state).toBe('unpaid'); expect(current.lines.map(l => l.name)).toEqual(['Keep me']); expect(current.order.appointmentId).toBe(appt);
  let history: ReturnType<CheckoutBackend['useOrderHistory']>;
  function HistoryProbe() { history = backend.useOrderHistory(orderId); return null; }
  await show(backend, createElement(HistoryProbe)); expect(history!.results.some(r => r.kind === 'line_removed' && r.before)).toBe(true);
});
it('refuses an all-conflict restore and restores a source paid elsewhere as a retained warning that blocks payment', async () => {
  const backend = createFixtureBackend(), actions = backend.useActions();
  const { orderId } = await run(actions.openOrderFor({ appointmentId: appt })); await probe(backend, orderId);
  await run(actions.discardOrder({ orderId, expectedRevision: current.order.revision, idempotencyKey: 'discard-paid-source' }));
  const other = await run(actions.openOrderFor({ appointmentId: appt }));
  await show(backend, createElement(OrderLifecycle, { orderId, mode: 'restore', onDone: vi.fn(), onPending: vi.fn(), onOpen: vi.fn() }));
  expect(document.body.textContent).toContain('Every row conflicts'); expect(button('Restore without 1 conflicting row').disabled).toBe(true);
  await probe(backend, other.orderId);
  await run(actions.settleOrder({ orderId: other.orderId, expectedRevision: current.order.revision, expectedDue: 1600, idempotencyKey: 'paid-other-source', tenders: [{ method: 'card', amount: 1600 }] }));
  await probe(backend, orderId); expect(review!.blocking).toBe(0); expect(review!.conflicts.some(c => c.kind === 'settled')).toBe(true);
  await run(actions.restoreOrder({ orderId, expectedRevision: current.order.revision, idempotencyKey: 'restore-paid-source' }));
  await probe(backend, orderId); expect(current.lines).toHaveLength(1); expect(current.lines[0].sourceIssue?.kind).toBe('settled');
  await show(backend, createElement(Harness, { id: orderId })); expect(button('Cash').disabled).toBe(true);
});
it('shows archived and merged customer warnings during restore without deleting the identity link', async () => {
  const backend = createFixtureBackend(), actions = backend.useActions();
  await run(actions.discardOrder({ orderId: saved, expectedRevision: 2, idempotencyKey: 'customer-discard' }));
  await run(actions.setCustomerArchived({ customerId: 'fxcust000002' as Id<'customers'>, expectedRevision: 0, archived: true }));
  await probe(backend); expect(review!.conflicts.some(c => c.kind === 'customer' && c.message.includes('archived'))).toBe(true);
  await run(actions.restoreOrder({ orderId: saved, expectedRevision: current.order.revision, idempotencyKey: 'customer-restore' }));
  await probe(backend); expect(current.order.customerId).toBe('fxcust000002');
});
const appointment = { _id: appt, status: 'no_show' as const, paymentStatus: 'unpaid' as const, price: 1600, currency: 'THB', revision: 0, start: Date.now(), confirmationCode: 'SVC-0002' };
it('adds an explicit labelled fee from the appointment, prevents repeated collection, and never attaches a no-show as service', async () => {
  const backend = createFixtureBackend({ appointments: [{ appointmentId: appt, status: 'no_show' }] }); const actions = backend.useActions();
  const denied = expect(actions.openOrderFor({ appointmentId: appt })).rejects.toThrow('not chargeable'); await tick(); await denied;
  const pending = vi.fn();
  await show(backend, createElement(AppointmentFeeControls, { appointment, onPendingChange: pending }));
  await input('input[id^="fee-amount"]', '500'); await input('textarea', 'Guest did not attend');
  await click('Add fee to checkout'); expect(button('Adding fee…').disabled).toBe(true); await tick();
  expect(pending.mock.calls).toEqual([[true], [false]]); expect(document.body.textContent).toContain('another fee cannot be collected');
  const href = document.querySelector<HTMLAnchorElement>('a')!.getAttribute('href')!; const orderId = href.split('order=')[1] as OrderId;
  await probe(backend, orderId); expect(current.lines[0]).toMatchObject({ kind: 'extra', feeAppointmentId: appt, unitPrice: 500, qty: 1 });
  const rejected = expect(actions.addAppointmentFee({ appointmentId: appt, kind: 'no_show', amount: 500 })).rejects.toThrow('already on'); await tick(); await rejected;
  await run(actions.settleOrder({ orderId, expectedRevision: current.order.revision, expectedDue: 500, idempotencyKey: 'pay-fee', tenders: [{ method: 'card', amount: 500 }] }));
  const charged = expect(actions.addAppointmentFee({ appointmentId: appt, kind: 'no_show', amount: 500 })).rejects.toThrow('charged'); await tick(); await charged;
  // Fee did not mark the appointment paid: this rejection still comes from its no-show status.
  const unchanged = expect(actions.openOrderFor({ appointmentId: appt })).rejects.toThrow('not chargeable'); await tick(); await unchanged;
});
it('requires whole-satang amount, reason and renewed review when appointment revision changes', async () => {
  const backend = createFixtureBackend({ appointments: [{ appointmentId: appt, status: 'no_show' }] });
  await show(backend, createElement(AppointmentFeeControls, { appointment }));
  await input('input', '1601'); await input('textarea', 'No show'); expect(button('Add fee to checkout').disabled).toBe(true);
  await input('input', '0.001'); expect(button('Add fee to checkout').disabled).toBe(true);
  await input('input', '500'); expect(button('Add fee to checkout').disabled).toBe(false);
  await show(backend, createElement(AppointmentFeeControls, { appointment: { ...appointment, revision: 1, price: 400 } }));
  expect(button('Add fee to checkout').disabled).toBe(true); await click('Review current appointment'); expect(button('Add fee to checkout').disabled).toBe(true);
});
it('pages financial ledgers beyond 20/50 and retries a failed continuation independently', async () => {
  const now = Date.now();
  const corrections: Doc<'billCorrections'>[] = Array.from({ length: 61 }, (_, i) => ({ _id: `correction-${i}` as Id<'billCorrections'>, _creationTime: i, billId: saved, sequence: i + 1, kind: 'amended', reason: `Reason ${i + 1}`, actor: 'cashier@example.com', recordedAt: now - i, idempotencyKey: `history-${i}` }));
  const base = createFixtureBackend({ financialHistory: { corrections } });
  let down = false;
  const backend: CheckoutBackend = { ...base, useCorrectionHistory: id => { const page = base.useCorrectionHistory(id); if (down) throw new Error('Network'); return { ...page, loadMore: n => { down = true; page.loadMore(n); } }; } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await show(backend, createElement(FinancialHistory, { orderId: saved }));
  await expandHistory("Browse all financial history");
  const section = () => document.querySelector('[aria-label="All payment amendments"]')!;
  expect(section().textContent).toContain('#61'); expect(section().textContent).not.toContain('Reason 1Recorded');
  await click('Load older payment amendments'); expect(section().textContent).toContain("Couldn't load");
  down = false;
  await act(async () => { const details = document.querySelector('details')!; details.open = false; details.dispatchEvent(new Event('toggle')); });
  await expandHistory("Browse all financial history");
  expect(section().textContent).toContain("Couldn't load");
  await click('Try again');
  // Retry remount starts a new cursor, then can continue normally.
  backend.useCorrectionHistory = base.useCorrectionHistory;
  await show(backend, createElement(FinancialHistory, { orderId: saved }));
  await expandHistory("Browse all financial history");
  for (let i = 0; i < 3; i++) await click('Load older payment amendments');
  expect(section().querySelectorAll('li')).toHaveLength(61); expect(section().textContent).toContain('#1'); expect(button('Load older payment amendments')).toBeUndefined();
  expect(document.querySelector('[aria-label="All appointment refunds"]')!.textContent).toContain('No entries recorded');
});
it('retries a lost restore response with the identical revision and explicit row choice', async () => {
  const backend = createFixtureBackend(), actions = backend.useActions();
  await run(actions.discardOrder({ orderId: saved, expectedRevision: 2, idempotencyKey: 'restore-retry-discard' }));
  const original = actions.restoreOrder;
  const restore = vi.spyOn(actions, 'restoreOrder').mockImplementationOnce(async args => { await original(args); throw new Error('Restore response lost'); });
  await show(backend, createElement(OrderLifecycle, { orderId: saved, mode: 'restore', onDone: vi.fn(), onPending: vi.fn(), onOpen: vi.fn() }));
  await click('Restore order'); await tick(); await click('Retry restore'); await tick();
  expect(restore.mock.calls[1][0]).toEqual(restore.mock.calls[0][0]); expect(document.body.textContent).toContain('restored. Review');
  await probe(backend); expect(current.order.revision).toBe(4); expect(current.lines).toHaveLength(2);
});
it('shows appointment refunds with source, provenance and net snapshot while paging audit past 50', async () => {
  const now = Date.now();
  const audits: Doc<'billAudit'>[] = Array.from({ length: 61 }, (_, i) => ({ _id: `audit-${i}` as Id<'billAudit'>, _creationTime: i, billId: saved, at: now - i, kind: 'price_override', actor: 'cashier@example.com', note: `Activity ${i + 1}`, fromPrice: 100, toPrice: 90 }));
  const refunds: Doc<'appointmentRefunds'>[] = [{ _id: 'appointment-refund' as Id<'appointmentRefunds'>, _creationTime: now, billId: saved, appointmentId: appt, amount: 50, currency: 'THB', method: 'transfer', reason: 'Partial service return', recordedBy: 'cashier@example.com', recordedAt: now, effectiveAt: now - 1000, idempotencyKey: 'fixture-appointment-refund', netBefore: 100, netAfter: 50 }];
  const backend = createFixtureBackend({ financialHistory: { audit: audits }, appointmentRefunds: refunds });
  await show(backend, createElement(FinancialHistory, { orderId: saved }));
  await expandHistory("Browse all financial history");
  const ledger = document.querySelector('[aria-label="All appointment refunds"]')!;
  expect(ledger.textContent).toContain('Recorded · ฿50 · transfer'); expect(ledger.textContent).toContain('Partial service return'); expect(ledger.textContent).toContain(appt); expect(ledger.textContent).toContain('Net balance after this return: ฿100 → ฿50'); expect(ledger.textContent).toContain('cashier@example.com');
  for (let i = 0; i < 3; i++) await click('Load older receipt activity');
  expect(document.querySelectorAll('[aria-label="All receipt activity"] li')).toHaveLength(61);
});
it('keeps empty filtered pages pageable instead of incorrectly announcing exhausted Orders', async () => {
  const base = createFixtureBackend(), loadMore = vi.fn();
  const backend: CheckoutBackend = { ...base, useOrders: () => ({ results: [], status: 'CanLoadMore', loadMore }) };
  await show(backend, createElement(OrdersBrowser, { currentId: saved, onOpen: vi.fn() }));
  expect(document.body.textContent).not.toContain('No unpaid orders'); await click('Load more'); expect(loadMore).toHaveBeenCalledExactlyOnceWith(20);
});
it('keeps fees charged after an ordinary void and releases only a proven mistaken entry', async () => {
  const backend = createFixtureBackend({ appointments: [{ appointmentId: appt, status: 'no_show' }] }), actions = backend.useActions();
  const { orderId } = await run(actions.addAppointmentFee({ appointmentId: appt, kind: 'no_show', amount: 500, reason: 'No attendance' }));
  await probe(backend, orderId);
  await run(actions.settleOrder({ orderId, expectedRevision: current.order.revision, expectedDue: 500, idempotencyKey: 'fee-paid-before-void', tenders: [{ method: 'card', amount: 500 }] }));
  await run(actions.voidOrder({ orderId, reason: 'Void receipt only; money remains' }));
  const denied = expect(actions.addAppointmentFee({ appointmentId: appt, kind: 'no_show', amount: 500 })).rejects.toThrow('charged'); await tick(); await denied;
  await show(backend, createElement(AppointmentFeeControls, { appointment }));
  expect(document.body.textContent).toContain('already charged'); expect(button('Add fee to checkout')).toBeUndefined();
  const other = createFixtureBackend({ appointments: [{ appointmentId: appt, status: 'no_show' }] }), otherActions = other.useActions();
  const fee = await run(otherActions.addAppointmentFee({ appointmentId: appt, kind: 'no_show', amount: 500 }));
  await probe(other, fee.orderId);
  await run(otherActions.settleOrder({ orderId: fee.orderId, expectedRevision: current.order.revision, expectedDue: 500, idempotencyKey: 'mistaken-fee-payment', tenders: [{ method: 'card', amount: 500 }] }));
  await run(otherActions.voidUnreceivedOrder({ orderId: fee.orderId, expectedCorrectionRevision: 0, idempotencyKey: 'fee-proved-unreceived', reason: 'No money received' }));
  await show(other, createElement(AppointmentFeeControls, { appointment }));
  expect(button('Add fee to checkout')).toBeTruthy();
  const replacement = await run(otherActions.addAppointmentFee({ appointmentId: appt, kind: 'no_show', amount: 500 })); expect(replacement.orderId).not.toBe(fee.orderId);
});
it('restores externally edited appointment rows stale, updates from the real source snapshot, and retains original removal evidence', async () => {
  const backend = createFixtureBackend(), actions = backend.useActions();
  const { orderId } = await run(actions.openOrderFor({ appointmentId: appt })); await probe(backend, orderId);
  await run(actions.discardOrder({ orderId, expectedRevision: current.order.revision, idempotencyKey: 'discard-before-edit' }));
  await act(async () => backend.setAppointmentSnapshot(appt, { price: 1400, start: Date.now() - 3600000, revision: 1 }));
  await probe(backend, orderId); expect(review!.conflicts.some(c => c.kind === 'changed' && !c.blocking)).toBe(true);
  await run(actions.restoreOrder({ orderId, expectedRevision: current.order.revision, idempotencyKey: 'restore-after-edit' }));
  await probe(backend, orderId); expect(current.lines[0].unitPrice).toBe(1600); expect(current.lines[0].sourceIssue?.kind).toBe('changed');
  await run(actions.updateSourceLine({ lineId: current.lines[0]._id }));
  await probe(backend, orderId); expect(current.lines[0].unitPrice).toBe(1400); expect(current.lines[0].sourceIssue).toBeNull(); expect(backend.appointmentSnapshot(appt)?.price).toBe(1400);
});
it('charges only unwaived stay terms and preserves the actual net deposit through discard and source updates', async () => {
  const bookingId = 'fxbkg000001' as Id<'bookings'>;
  const backend = createFixtureBackend({ bookings: [{ id: bookingId, price: 250, providerRefundWaived: 150, deposit: 50, paid: false }] }), actions = backend.useActions();
  const { orderId } = await run(actions.openOrderFor({ bookingId })); await probe(backend, orderId);
  expect(current.lines[0]).toMatchObject({ unitPrice: 100, deposit: 50 }); expect(current.totals.due).toBe(50); expect(current.lines[0].detail).toContain('150 THB refunded charge waived');
  await run(actions.discardOrder({ orderId, expectedRevision: current.order.revision, idempotencyKey: 'waived-discard' }));
  await act(async () => backend.setBookingSnapshot(bookingId, { price: 300 }));
  await probe(backend, orderId);
  await run(actions.restoreOrder({ orderId, expectedRevision: current.order.revision, idempotencyKey: 'waived-restore' }));
  await probe(backend, orderId); expect(current.lines[0].sourceIssue?.kind).toBe('changed');
  await run(actions.updateSourceLine({ lineId: current.lines[0]._id }));
  await probe(backend, orderId); expect(current.lines[0]).toMatchObject({ unitPrice: 150, deposit: 50 }); expect(current.totals.due).toBe(100);
});
it('recovers a lost fee response through its actual order link and never offers a duplicate collection', async () => {
  const backend = createFixtureBackend({ appointments: [{ appointmentId: appt, status: 'no_show' }] });
  const actions = backend.useActions(), original = actions.addAppointmentFee;
  vi.spyOn(actions, 'addAppointmentFee').mockImplementationOnce(async args => { await original(args); throw new Error('Lost fee response'); });
  await show(backend, createElement(AppointmentFeeControls, { appointment }));
  await input('input', '500'); await input('textarea', 'No attendance'); await click('Add fee to checkout'); await tick();
  expect(document.body.textContent).toContain('response may have been lost'); expect(document.querySelector('a[href*="checkout?order="]')).toBeTruthy(); expect(button('Retry fee')).toBeUndefined();
  expect(backend.appointmentSnapshot(appt)).toMatchObject({ status: 'no_show', price: 1600, paid: false });
});
it('shows an actual receipt-attributed appointment return with net balance and keeps issued money unchanged', async () => {
  const refunds: Doc<'appointmentRefunds'>[] = [];
  const backend = createFixtureBackend({ appointmentRefunds: refunds }), actions = backend.useActions();
  const { orderId } = await run(actions.openOrderFor({ appointmentId: appt })); await probe(backend, orderId);
  await run(actions.settleOrder({ orderId, expectedRevision: current.order.revision, expectedDue: 1600, idempotencyKey: 'appointment-receipt-paid', tenders: [{ method: 'card', amount: 1600 }] }));
  refunds.push({ _id: 'actual-appt-return' as Id<'appointmentRefunds'>, _creationTime: Date.now(), appointmentId: appt, billId: orderId, amount: 200, currency: 'THB', method: 'transfer', reason: 'Partial recorded return', effectiveAt: Date.now(), recordedAt: Date.now(), recordedBy: 'cashier@example.com', idempotencyKey: 'external-return', netBefore: 1600, netAfter: 1400 });
  await act(async () => backend.setAppointmentSnapshot(appt, { amountRefunded: 200 }));
  await probe(backend, orderId);
  expect(current.refunds[0]).toMatchObject({ sourceType: 'appointment', appointmentId: appt, amount: 200 });
  expect(current.payments[0].amount).toBe(1600); expect(current.totals.total).toBe(1600);
  await show(backend, createElement(FinancialHistory, { orderId, view: current }));
  await expandHistory("Browse all financial history");
  expect(document.querySelector('[aria-label="All appointment refunds"]')!.textContent).toContain('Received on this receipt ฿1,600 · Net retained ฿1,400');
  const denied = expect(actions.voidUnreceivedOrder({ orderId, expectedCorrectionRevision: 0, idempotencyKey: 'refunded-reversal-denied', reason: 'Cannot reverse returned money' })).rejects.toThrow('refunded'); await tick(); await denied;
  await probe(backend, orderId); expect(current.order.state).toBe('paid'); expect(current.payments[0].amount).toBe(1600);
});
