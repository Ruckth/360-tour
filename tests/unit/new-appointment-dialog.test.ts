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
  ['2026-11-01', now - 30 * 60000, 'In progress · Unpaid.'],
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


it("shows a directly operable staff selector and preserves explicit calendar assignment", async () => {
  const start = now + 24 * 60 * 60000;
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-02', start, staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  const trigger = document.getElementById('na-staff');
  expect(trigger?.getAttribute('role')).toBe('combobox');
  expect(trigger?.textContent).toContain('Mali');
  expect([...document.querySelectorAll('button')].some(b => b.textContent?.trim() === 'Change')).toBe(false);
  await act(async () => trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const auto = [...document.querySelectorAll('[role=option]')].find(o => o.textContent?.includes('Auto (least busy)'));
  expect(auto?.textContent).toBe('Auto (least busy)');
});

it("requires an actual person for historical work and keeps archived people marked", async () => {
  const archived = { ...staff, _id: 'staff2', name: 'Nok', status: 'archived' } as Doc<'staff'>;
  mocks.query.mockImplementation((name: string) => name.endsWith(':listServices') ? [service] : name.endsWith(':listStaff') ? [staff, archived] : name.endsWith(':findOpenSlots') ? [] : { warnings: [], needsReason: false, problem: null });
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2020-01-02' }, services: [service], staff: [staff, archived], onClose: vi.fn(), onCreated: vi.fn() }))));
  const trigger = document.getElementById('na-staff');
  expect(trigger?.textContent).toContain('Choose who did the work');
  await act(async () => trigger!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const options = [...document.querySelectorAll('[role=option]')].map(o => o.textContent);
  expect(options.some(o => o?.includes('Auto'))).toBe(false);
  expect(options.some(o => o?.includes('Nok (archived)'))).toBe(true);
});


it("changes temporal wording and suggestions from the edited time without changing historical eligibility", async () => {
  const future = Date.parse('2026-11-01T15:00:00+07:00');
  mocks.query.mockImplementation((name: string) => name.endsWith(':listServices') ? [service] : name.endsWith(':listStaff') ? [staff] : name.endsWith(':findOpenSlots') ? [{ start: future, staffIds: [staff._id], autoStaffId: staff._id }] : { warnings: [], needsReason: false, problem: null });
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', start: now - 2 * 60 * 60000, staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(document.body.textContent).toContain('Past work · Verify service and staff.');
  expect(document.body.textContent).not.toContain('Suggested open times');
  expect(document.querySelectorAll('input[type=time]')).toHaveLength(1);
  const input = document.getElementById('na-actual-time') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '15:00');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(document.body.textContent).not.toContain('Past work · Verify');
  expect(document.body.textContent).toContain('Suggested open times');
  expect(document.body.textContent).toContain('Booked · Unpaid.');
  // Today keeps the existing date-based eligibility; this presentation change does not introduce Auto.
  await act(async () => document.getElementById('na-staff')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect([...document.querySelectorAll('[role=option]')].some(o => o.textContent?.includes('Auto'))).toBe(false);
});

it("keeps today's later slots available when the automatic fallback is a finished morning slot", async () => {
  const morning = Date.parse('2026-11-01T09:00:00+07:00');
  const afternoon = Date.parse('2026-11-01T15:00:00+07:00');
  mocks.query.mockImplementation((name: string) => name.endsWith(':listServices') ? [service] : name.endsWith(':listStaff') ? [staff] : name.endsWith(':findOpenSlots') ? [morning, afternoon].map(start => ({ start, staffIds: [staff._id], autoStaffId: staff._id })) : { warnings: [], needsReason: false, problem: null });
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(document.querySelector('[aria-label="9:00 AM"]')).not.toBeNull();
  const later = document.querySelector<HTMLButtonElement>('[aria-label="3:00 PM"]');
  expect(later).not.toBeNull();
  expect(later!.disabled).toBe(false);
  await act(async () => later!.click());
  expect((document.getElementById('na-actual-time') as HTMLInputElement).value).toBe('15:00');
  expect(document.body.textContent).toContain('Booked · Unpaid.');
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ staffId: staff._id, start: afternoon }));
});
