// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { getFunctionName } from 'convex/server';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { expect, it, vi } from 'vitest';
import { AppointmentSheet } from '@/components/admin/AppointmentSheet';
const mocks = vi.hoisted(() => ({ fee: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children) }));
vi.mock('@/components/admin/AppointmentFinancials', () => ({ AppointmentFinancials: () => createElement('p', {}, 'Appointment financials retained') }));
vi.mock('@/components/admin/AppointmentHistory', () => ({ AppointmentHistory: () => createElement('p', {}, 'Appointment history retained') }));
vi.mock('convex/react', () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === 'skip') return undefined;
    if (getFunctionName(ref) === 'pos:appointmentFees') return [];
    if (getFunctionName(ref) === 'pos:ordersForBooking') return { balance: { total: 1600, paid: 0, owed: 0, refunded: 0, credit: 0 }, activeOrder: null, orders: [], discardedOrders: [] };
    return undefined;
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref) === 'pos:addAppointmentFee' ? mocks.fee : vi.fn(),
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
}));
it('mounts the real fee control beside financials and blocks sheet Close, Escape and appointment actions while adding', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  let finish!: (value: { orderId: Id<'orders'>; lineId: Id<'orderLines'>; replayed: boolean }) => void;
  mocks.fee.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const onClose = vi.fn(), start = Date.now() - 3600000;
  const appointment: Doc<'appointments'> = { amountPaid: 0, amountRefunded: 0, guestPhoneDigits: '0812345678', serviceNameSnapshot: 'Massage', staffNameSnapshot: 'Nok', _id: 'fxappt000002' as Id<'appointments'>, _creationTime: start, serviceId: 'fxsvc000002' as Id<'services'>, staffId: 'fxstaff000001' as Id<'staff'>, status: 'no_show', paymentStatus: 'unpaid', price: 160000, currency: 'THB', revision: 0, start, end: start + 3600000, blockedUntil: start + 3600000, guestName: 'Somchai', guestPhone: '0812345678', source: 'admin', confirmationCode: 'SVC-0002', accessToken: 'fixture', createdAt: start };
  const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === name)!;
  const type = async (selector: string, value: string) => act(async () => {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
    Object.getOwnPropertyDescriptor(el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(AppointmentSheet, { appointment, services: [], staffById: new Map(), serviceById: new Map(), onBookAgain: vi.fn(), onClose })));
    expect(document.body.textContent).toContain('Appointment financials retained');
    await type('input[id^="fee-amount"]', '500'); await type('textarea[id^="fee-reason"]', 'No attendance');
    await act(async () => button('Add fee to checkout').click());
    await act(async () => button('Close').click());
    await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).not.toHaveBeenCalled(); expect(button('Adding fee…').disabled).toBe(true); expect(button('Correct status').disabled).toBe(true);
    expect(mocks.fee).toHaveBeenCalledExactlyOnceWith({ appointmentId: appointment._id, kind: 'no_show', amount: 50000, reason: 'No attendance', expectedRevision: appointment.revision ?? 0, idempotencyKey: expect.any(String) });
    await act(async () => finish({ orderId: 'fxbill000099' as Id<'orders'>, lineId: 'fxline000099' as Id<'orderLines'>, replayed: false }));
    expect(document.querySelector('a[href="/admin/checkout?order=fxbill000099"]')).toBeTruthy();
    await act(async () => button('Close').click()); expect(onClose).toHaveBeenCalledOnce();
  } finally { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); }
});
