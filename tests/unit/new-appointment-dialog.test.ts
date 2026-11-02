// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFunctionName } from 'convex/server';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import { NewAppointmentDialog } from '@/components/admin/NewAppointmentDialog';
const mocks = vi.hoisted(() => ({ create: vi.fn(), query: vi.fn() }));
vi.mock('convex/react', () => ({
  useMutation: () => mocks.create,
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => mocks.query(getFunctionName(ref)),
}));
const now = Date.parse('2026-11-01T12:00:00+07:00');
const staff = { _id: 'staff1', name: 'Mali', status: 'active', color: '#abc' } as Doc<'staff'>;
const service = { _id: 'service1', name: 'Massage', category: 'Wellness', description: '', slug: 'massage', status: 'active', durationMin: 60, bufferMin: 15, price: 1200, currency: 'THB', staffIds: [staff._id] } as Doc<'services'>;
const intl = { locale: 'en', messages, timeZone: 'Asia/Bangkok' } as unknown as ComponentProps<typeof NextIntlClientProvider>;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  mocks.create.mockReset().mockResolvedValue({ appointmentId: 'created1' });
  mocks.query.mockReset().mockImplementation((name: string) => name.endsWith(':listServices') ? [service] : name.endsWith(':listStaff') ? [staff] : name.endsWith(':findOpenSlots') ? [] : { warnings: [], needsReason: false, problem: null });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([
  ['2020-01-02', Date.parse('2020-01-02T10:07:00+07:00'), 'Completed · Unpaid. Checkout can collect payment for this service.'],
  ['2026-11-01', now - 30 * 60000, 'Booked · Unpaid.'],
])('submits the mounted %s entry at its actual time and displays its default service/payment state', async (date, start, label) => {
  const onCreated = vi.fn();
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date, start, staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated }))));
  expect(document.body.textContent).toContain(label);
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ serviceId: service._id, staffId: staff._id, start });
  // The trusted mutation derives status; the form cannot inject a fictitious paid/completed flag.
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('status');
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('paymentStatus');
  expect(onCreated).toHaveBeenCalledWith('created1' as Id<'serviceAppointments'>, start);
});
