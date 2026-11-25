// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFunctionName } from 'convex/server';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import { AppointmentSheet } from '@/components/admin/AppointmentSheet';

const mocks = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/platform/localized-navigation', () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children) }));
vi.mock('@/components/admin/AppointmentFinancials', () => ({ AppointmentFinancials: () => null, AppointmentMoneyBlock: () => null }));
vi.mock('@/components/admin/AppointmentHistory', () => ({ AppointmentHistory: () => null }));
vi.mock('convex/react', () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === 'skip') return undefined;
    if (getFunctionName(ref) === 'pos/orders:appointmentFees') return [];
    if (getFunctionName(ref) === 'pos/orders:ordersForBooking') return { balance: { total: 0, paid: 0, owed: 0, refunded: 0, credit: 0 }, activeOrder: null, orders: [], discardedOrders: [] };
    return undefined;
  },
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref).endsWith(':updateAppointmentDetails') ? mocks.update : vi.fn(),
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
}));

const start = Date.parse('2030-01-10T14:00:00+07:00');
const thai = {
  _id: 'svc0thai' as Id<'services'>, name: 'Thai massage', category: 'Wellness', slug: 'thai', description: '', status: 'active', durationMin: 60, bufferMin: 15, price: 80000, currency: 'THB',
  staffIds: ['staff0nok' as Id<'staff'>], options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }],
} as Doc<'services'>;
const appointment = {
  _id: 'appt0001' as Id<'appointments'>, _creationTime: start, serviceId: thai._id, staffId: 'staff0nok' as Id<'staff'>, serviceNameSnapshot: 'Thai massage', staffNameSnapshot: 'Nok',
  status: 'booked', paymentStatus: 'unpaid', price: 80000, currency: 'THB', revision: 2, start, end: start + 60 * 60_000, blockedUntil: start + 75 * 60_000,
  guestName: 'Somchai', guestPhone: '0812345678', guestPhoneDigits: '', amountPaid: 0, amountRefunded: 0, source: 'admin', confirmationCode: 'SVC-0001', accessToken: 'fixture', createdAt: start,
} as Doc<'appointments'>;

let root: Root;
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent?.trim() === name)!;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.update.mockReset().mockResolvedValue(null);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('changes the booked length with duration chips, confirms the new end and price, and sends the option terms', async () => {
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(AppointmentSheet, {
    appointment, services: [thai], staffById: new Map(), serviceById: new Map([[thai._id, thai]]), onBookAgain: vi.fn(), onClose: vi.fn(),
  }))));
  await act(async () => button('Edit appointment').click());
  const radio = (minutes: number) => document.querySelector<HTMLInputElement>(`input[type=radio][value="${minutes}"]`)!;
  expect(radio(60).checked).toBe(true);
  await act(async () => radio(90).click());
  await act(async () => document.querySelector('form')!.requestSubmit());
  const dialog = document.querySelector('[role=alertdialog], [role=dialog]:last-of-type')!;
  expect(dialog.textContent).toContain('From: Thai massage · 60 min · 14:00 – 15:00');
  expect(dialog.textContent).toContain('To: Thai massage · 90 min · 14:00 – 15:30 · 15 min turnaround · available again 15:45 · ฿1,100.');
  await act(async () => button('Change service').click());
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    appointmentId: appointment._id, expectedRevision: 2, serviceId: thai._id, durationMin: 90,
    expectedService: { durationMin: 90, bufferMin: 15, price: 110000, currency: 'THB' },
  }));
});

it('saves guest details alone without touching the service or its length', async () => {
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(AppointmentSheet, {
    appointment, services: [thai], staffById: new Map(), serviceById: new Map([[thai._id, thai]]), onBookAgain: vi.fn(), onClose: vi.fn(),
  }))));
  await act(async () => button('Edit appointment').click());
  await act(async () => document.querySelector('form')!.requestSubmit());
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('durationMin');
  expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('serviceId');
});
