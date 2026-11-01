// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFunctionName } from 'convex/server';
import type { Doc } from 'convex/_generated/dataModel';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../messages/en.json';
import { AppointmentFinancials, AppointmentMoneyDialog } from '@/components/admin/AppointmentFinancials';
const mocks = vi.hoisted(() => ({ pay: vi.fn(), refund: vi.fn(), correct: vi.fn(), query: vi.fn() }));
vi.mock('convex/react', () => ({
  useQuery: () => mocks.query(),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    return name.endsWith(':markAppointmentPaid') ? mocks.pay : name.endsWith(':refundAppointment') ? mocks.refund : mocks.correct;
  }
}));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children) }));
const now = Date.UTC(2026,10,1,5);
const appointment = { _id: 'appointment1', price: 1200, currency: 'THB', status: 'completed', paymentStatus: 'paid', revision: 4 } as Doc<'serviceAppointments'>;
const payment = { _id: 'payment1', amount: 1200, currency: 'THB', method: 'cash', effectiveAt: now - 1000, recordedAt: now, recordedBy: 'desk@example.com', status: 'recorded', refunded: 0 } as Doc<'appointmentPayments'>;
const intl = { locale: 'en', messages, timeZone: 'Asia/Bangkok' } as unknown as ComponentProps<typeof NextIntlClientProvider>;
let root: Root;
const render = (node: ReactNode) => act(async () => root.render(createElement(NextIntlClientProvider, intl, node)));
const button = (text: string) => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text);
const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click());
const type = (id: string, value: string) => act(async () => {
  const el = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  Object.values(mocks).forEach(fn => fn.mockReset().mockResolvedValue(null));
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });
it('shows accurate net/refunded balances, actual receipt path, legacy unknowns and refund provenance', async () => {
  mocks.query.mockReturnValue({ revision: 4, money: { gross: 1200, refunded: 200, net: 1000, owed: 0 }, unitemised: 1200, payments: [], orders: [{ billId: 'order1', receiptNumber: 42, charged: 1200, refundable: 1000 }], refunds: [{ _id: 'refund1', amount: 200, method: 'cash', reason: 'Courtesy', effectiveAt: now - 60000, recordedAt: now, recordedBy: 'desk@example.com' }] });
  await render(createElement(AppointmentFinancials, { appointment }));
  expect(document.body.textContent).toContain('Paid ฿1,000 · Refunded ฿200 · To collect ฿0');
  expect(document.querySelector('a')?.getAttribute('href')).toContain('order1');
  expect(document.body.textContent).toContain('Correct the tender or payment date');
  expect(document.body.textContent).toContain('desk@example.com');
  expect(button('Not received…')).toBeUndefined();
});
it('validates a refund cap/reason, retains failed draft and retries exactly the original attempt', async () => {
  const onClose = vi.fn(); mocks.refund.mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce(null);
  await render(createElement(AppointmentMoneyDialog, { appointment, revision: 4, dialog: { kind: 'refund', paymentId: payment._id, max: 1000 }, onClose }));
  expect(button('Record refund')?.disabled).toBe(true);
  await type('af-reason', 'Partial service refund'); await type('af-amount', '1000.01');
  expect(button('Record refund')?.disabled).toBe(true);
  await type('af-amount', '250'); await click(button('Record refund'));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Connection lost');
  expect((document.getElementById('af-amount') as HTMLInputElement).value).toBe('250');
  expect((document.getElementById('af-reason') as HTMLTextAreaElement).value).toBe('Partial service refund');
  expect(onClose).not.toHaveBeenCalled();
  await click(button('Retry same refund'));
  expect(mocks.refund).toHaveBeenCalledTimes(2);
  expect(mocks.refund.mock.calls[1]).toEqual(mocks.refund.mock.calls[0]);
  expect(mocks.refund.mock.calls[0][0]).toMatchObject({ expectedRevision: 4, amount: 250, method: 'cash', currency: 'THB', reason: 'Partial service refund', paymentId: 'payment1' });
  expect(onClose).toHaveBeenCalledOnce();
});
it('blocks duplicate submits and dismissal while payment is pending, preserving business date and reviewed revision', async () => {
  let resolve!: () => void; mocks.pay.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
  const onClose = vi.fn();
  await render(createElement(AppointmentMoneyDialog, { appointment: { ...appointment, paymentStatus: 'unpaid' }, revision: 4, dialog: { kind: 'pay' }, onClose }));
  await click(button('Record payment')); await click(button('Record payment'));
  expect(mocks.pay).toHaveBeenCalledOnce(); expect(button('Close')?.disabled).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(onClose).not.toHaveBeenCalled();
  expect(mocks.pay.mock.calls[0][0]).toMatchObject({ expectedRevision: 4, method: 'cash', effectiveAt: now });
  await act(async () => resolve()); expect(onClose).toHaveBeenCalledOnce();
});
it('requires a reason for mistaken entry cancellation and preserves the same correction key on retry', async () => {
  mocks.correct.mockRejectedValueOnce(new Error('Network failed')).mockResolvedValueOnce(null);
  await render(createElement(AppointmentMoneyDialog, { appointment, revision: 4, dialog: { kind: 'cancel', payment }, onClose: vi.fn() }));
  expect(button('Cancel mistaken payment entry')?.disabled).toBe(true);
  await type('af-reason', 'No money was received'); await click(button('Cancel mistaken payment entry'));
  await click(button('Cancel mistaken payment entry'));
  expect(mocks.correct).toHaveBeenCalledTimes(2); expect(mocks.correct.mock.calls[1]).toEqual(mocks.correct.mock.calls[0]);
  expect(mocks.correct.mock.calls[0][0]).toMatchObject({ action: 'cancel', expectedRevision: 4, paymentId: payment._id, reason: 'No money was received' });
});

it('mounts proven legacy Not received, requires review/reason and freezes pending/lost-response retries', async () => {
  const data = { revision: 4, legacyManualPayment: { changeId: 'legacy-change' }, money: { gross: 1200, refunded: 0, net: 1200, owed: 0 }, unitemised: 1200, payments: [], orders: [], refunds: [] };
  mocks.query.mockReturnValue(data);
  let reject!: (error: Error) => void;
  mocks.correct.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce(null);
  await render(createElement(AppointmentFinancials, { appointment }));
  expect(document.body.textContent).toContain('original tender and received date remain unknown');
  await click(button('Not received…'));
  expect(button('Cancel mistaken payment entry')?.disabled).toBe(true);
  await type('af-reason', 'Old manual paid entry was a mistake');
  await click(button('Cancel mistaken payment entry'));
  expect(mocks.correct).toHaveBeenCalledOnce();
  expect(mocks.correct.mock.calls[0][0]).toMatchObject({ appointmentId: appointment._id, expectedRevision: 4, legacyChangeId: 'legacy-change', action: 'cancel', reason: 'Old manual paid entry was a mistake' });
  expect(mocks.correct.mock.calls[0][0]).not.toHaveProperty('paymentId');
  expect(mocks.correct.mock.calls[0][0]).not.toHaveProperty('method');
  expect(mocks.correct.mock.calls[0][0]).not.toHaveProperty('effectiveAt');
  expect(button('Close')?.disabled).toBe(true);
  await click(button('Cancel mistaken payment entry'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(mocks.correct).toHaveBeenCalledOnce();
  await act(async () => reject(new Error('Response lost after commit')));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Response lost');
  expect(document.getElementById('af-reason')?.closest('fieldset')?.disabled).toBe(true);
  // Refreshed query data must not replace the original review or submitted attempt on retry.
  mocks.query.mockReturnValue({ ...data, revision: 5, legacyManualPayment: null, money: { gross: 0, refunded: 0, net: 0, owed: 1200 }, unitemised: 0 });
  await render(createElement(AppointmentFinancials, { appointment: { ...appointment, paymentStatus: 'unpaid', revision: 5 } }));
  await click(button('Cancel mistaken payment entry'));
  expect(mocks.correct).toHaveBeenCalledTimes(2);
  expect(mocks.correct.mock.calls[1]).toEqual(mocks.correct.mock.calls[0]);
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
it.each(['unknown', 'refunded', 'receipt', 'provider'])('does not expose manual Not received for %s money', async kind => {
  mocks.query.mockReturnValue({ revision: 4, legacyManualPayment: null, money: { gross: 1200, refunded: kind === 'refunded' ? 100 : 0, net: 1100, owed: 0 }, unitemised: kind === 'provider' ? 0 : 1200, payments: kind === 'provider' ? [{ ...payment, method: 'provider' }] : [], orders: kind === 'receipt' ? [{ billId: 'order1', charged: 1200, refundable: 1200 }] : [], refunds: [] });
  await render(createElement(AppointmentFinancials, { appointment }));
  expect(button('Not received…')).toBeUndefined();
});
