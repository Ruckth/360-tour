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
  ['2020-01-02', Date.parse('2020-01-02T10:07:00+07:00'), 'Completed · Unpaid'],
  ['2026-11-01', now - 30 * 60000, 'In progress · Unpaid'],
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


const slotAt = (time: string) => ({ start: Date.parse(`2026-11-01T${time}:00+07:00`), staffIds: [staff._id], autoStaffId: staff._id });
const withSlots = (...times: string[]) => mocks.query.mockImplementation((name: string) => name.endsWith(':listServices') ? [service] : name.endsWith(':listStaff') ? [staff] : name.endsWith(':findOpenSlots') ? times.map(slotAt) : { warnings: [], needsReason: false, problem: null });
const timeButton = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const staffOptions = async () => {
  await act(async () => document.getElementById('na-staff')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  return [...document.querySelectorAll('[role=option]')].map(o => o.textContent ?? '');
};
const setTime = (value: string) => act(async () => {
  const input = document.getElementById('na-actual-time') as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

it("opens today as a normal booking: 24-hour chips, Auto staff, no time box and one sentence", async () => {
  withSlots('15:00', '16:30');
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01' }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(timeButton('15:00')?.getAttribute('aria-pressed')).toBe('true');
  expect(timeButton('16:30')).toBeDefined();
  expect(timeButton('Other time…')).toBeDefined();
  expect(document.getElementById('na-actual-time')).toBeNull();
  expect(document.body.textContent).not.toContain('Booked · Unpaid');
  expect(document.body.textContent).not.toContain('Past work');
  expect(document.getElementById('na-staff')?.textContent).toContain('Auto (least busy) · Mali');
  expect(timeButton('Book Massage · 15:00')).toBeDefined();
  // No footer Cancel: the dialog closes with ✕.
  expect(timeButton('Cancel')).toBeUndefined();
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ start: slotAt('15:00').start, staffId: staff._id }));
});

it("never offers a time that has already started, and books the first later one", async () => {
  withSlots('09:00', '15:00');
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(timeButton('09:00')).toBeUndefined();
  expect(timeButton('15:00')?.getAttribute('aria-pressed')).toBe('true');
  expect((await staffOptions()).some(o => o.includes('Auto'))).toBe(true);
});

it("Other time… swaps the chips for a time box; a service that has ended is past work, one that started minutes ago is a booking", async () => {
  withSlots('15:00');
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  await act(async () => timeButton('Other time…')!.click());
  expect(timeButton('15:00')).toBeUndefined();
  expect((document.getElementById('na-actual-time') as HTMLInputElement).value).toBe('15:00');
  // Started one minute ago: still running, so a normal booking, as the server treats it.
  await setTime('11:59');
  expect(document.getElementById('na-actual-time')).not.toBeNull();
  expect((await staffOptions()).some(o => o.includes('Auto'))).toBe(true);
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  // Hours ago: the service and its turnaround have ended, so past work names the person and Auto goes.
  await setTime('08:00');
  expect((await staffOptions()).some(o => o.includes('Auto'))).toBe(false);
});

it("a calendar slot that started before now opens as past work with the time box", async () => {
  withSlots('15:00');
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', start: now - 2 * 60 * 60000, staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(document.body.textContent).toContain('Past work · Verify service and staff.');
  expect(document.querySelectorAll('input[type=time]')).toHaveLength(1);
  expect(timeButton('15:00')).toBeUndefined();
  expect((await staffOptions()).some(o => o.includes('Auto'))).toBe(false);
});
