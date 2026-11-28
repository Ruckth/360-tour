// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFunctionName } from 'convex/server';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { IntlProvider } from '@/platform/intl';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import messages from '../../messages/en.json';
import { NewAppointmentDialog } from '@/components/admin/NewAppointmentDialog';
const mocks = vi.hoisted(() => ({ create: vi.fn(), query: vi.fn() }));
vi.mock('convex/react', () => ({
  useMutation: () => mocks.create,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => (args === 'skip' ? undefined : mocks.query(getFunctionName(ref), args)),
}));
const now = Date.parse('2026-11-01T12:00:00+07:00');
const staff = { _id: 'staff1', name: 'Mali', status: 'active', color: '#abc' } as Doc<'staff'>;
const service = { _id: 'service1', name: 'Massage', category: 'Wellness', description: '', slug: 'massage', status: 'active', durationMin: 60, bufferMin: 15, price: 120000, currency: 'THB', staffIds: [staff._id] } as Doc<'services'>;
const intl = { locale: 'en', messages, timeZone: 'Asia/Bangkok' } as unknown as ComponentProps<typeof IntlProvider>;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now);
  mocks.create.mockReset().mockResolvedValue({ appointmentId: 'created1' });
  mocks.query.mockReset().mockImplementation((name: string) => name.endsWith(':listServices') ? [service] : name.endsWith(':listStaff') ? [staff] : name.endsWith(':findOpenSlots') ? [] : name.endsWith(':findNextOpenSlot') ? undefined : { warnings: [], needsReason: false, problem: null });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([
  ['2020-01-02', Date.parse('2020-01-02T10:07:00+07:00'), 'Completed · Unpaid'],
  ['2026-11-01', now - 30 * 60000, 'In progress · Unpaid'],
])('submits the mounted %s entry at its actual time and displays its default service/payment state', async (date, start, label) => {
  const onCreated = vi.fn();
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date, start, staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated }))));
  expect(document.body.textContent).toContain(label);
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ serviceId: service._id, staffId: staff._id, start });
  // The trusted mutation derives status; the form cannot inject a fictitious paid/completed flag.
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('status');
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('paymentStatus');
  expect(onCreated).toHaveBeenCalledWith('created1' as Id<'appointments'>, start);
});


it("shows a directly operable staff selector and preserves explicit calendar assignment", async () => {
  const start = now + 24 * 60 * 60000;
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-02', start, staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
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
  mocks.query.mockImplementation((name: string) => name.endsWith(':listServices') ? [service] : name.endsWith(':listStaff') ? [staff, archived] : name.endsWith(':findOpenSlots') ? [] : name.endsWith(':findNextOpenSlot') ? undefined : { warnings: [], needsReason: false, problem: null });
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2020-01-02' }, services: [service], staff: [staff, archived], onClose: vi.fn(), onCreated: vi.fn() }))));
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
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01' }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
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
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(timeButton('09:00')).toBeUndefined();
  expect(timeButton('15:00')?.getAttribute('aria-pressed')).toBe('true');
  expect((await staffOptions()).some(o => o.includes('Auto'))).toBe(true);
});

it("Other time… swaps the chips for a time box; a service that has ended is past work, one that started minutes ago is a booking", async () => {
  withSlots('15:00');
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
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
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01', start: now - 2 * 60 * 60000, staffId: staff._id }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(document.body.textContent).toContain('Past work · Verify service and staff.');
  expect(document.querySelectorAll('input[type=time]')).toHaveLength(1);
  expect(timeButton('15:00')).toBeUndefined();
  expect((await staffOptions()).some(o => o.includes('Auto'))).toBe(false);
});

const thai = { ...service, _id: 'thai1', name: 'Thai massage', durationMin: 60, price: 80000, options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }, { durationMin: 120, price: 140000 }] } as Doc<'services'>;
const withThai = () => mocks.query.mockImplementation((name: string) => name.endsWith(':listServices') ? [thai] : name.endsWith(':listStaff') ? [staff] : name.endsWith(':findOpenSlots') ? [slotAt('14:00')] : { warnings: [], needsReason: false, problem: null });
const renderThai = () => act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01' }, services: [thai], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
const radio = (minutes: number) => document.querySelector<HTMLInputElement>(`input[type=radio][value="${minutes}"]`)!;

it("books the chosen length: slots re-query with it, the summary and button name it, and it is remembered", async () => {
  window.localStorage.clear();
  withThai();
  await renderThai();
  // The default length is pre-selected; a single-length service has no chips at all.
  expect(document.querySelector('fieldset legend')?.textContent).toBe('Service');
  expect([...document.querySelectorAll('legend')].map(legend => legend.textContent)).toContain('Duration');
  expect(radio(60).checked).toBe(true);
  expect(timeButton('Thai massage · from ฿800')).toBeDefined();
  await act(async () => radio(90).click());
  const slotCalls = mocks.query.mock.calls.filter(([name]) => name.endsWith(':findOpenSlots'));
  expect(slotCalls.at(-1)?.[1]).toEqual({ serviceId: thai._id, durationMin: 90, date: '2026-11-01', staffId: undefined });
  expect(mocks.query.mock.calls.filter(([name]) => name.endsWith(':previewAppointmentTime')).at(-1)?.[1]).toMatchObject({ durationMin: 90 });
  expect(document.body.textContent).toContain('90 min · ฿1,100 · 15 min turnaround');
  expect(timeButton('Book Thai massage · 90 min · 14:00')).toBeDefined();
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ serviceId: thai._id, durationMin: 90, expectedPrice: 110000, start: slotAt('14:00').start }));
  expect(JSON.parse(window.localStorage.getItem('admin.staff.lastDurations')!)).toEqual({ [thai._id]: 90 });
  // The next booking starts on the last length used for this service.
  await act(async () => root.unmount());
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await renderThai();
  expect(radio(90).checked).toBe(true);
});

it("leaves single-length bookings unchanged: no duration in the slot query or the payload", async () => {
  withSlots('15:00');
  await act(async () => root.render(createElement(IntlProvider, intl, createElement(NewAppointmentDialog, { draft: { date: '2026-11-01' }, services: [service], staff: [staff], onClose: vi.fn(), onCreated: vi.fn() }))));
  expect(document.querySelectorAll('input[type=radio]')).toHaveLength(0);
  expect(mocks.query.mock.calls.find(([name]) => name.endsWith(':findOpenSlots'))?.[1]).not.toHaveProperty('durationMin');
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty('durationMin');
});

it("keeps the chosen time through a duration change, or clears it and says so; never picks another", async () => {
  const open: Record<number, string[]> = { 60: ['13:00', '14:00', '15:00'], 90: ['13:00', '14:00'], 120: ['12:30', '15:00'] };
  mocks.query.mockImplementation((name: string, args: { durationMin?: number }) => name.endsWith(':listServices') ? [thai] : name.endsWith(':listStaff') ? [staff] : name.endsWith(':findOpenSlots') ? open[args.durationMin ?? 60].map(slotAt) : { warnings: [], needsReason: false, problem: null });
  window.localStorage.clear();
  await renderThai();
  await act(async () => timeButton('14:00')!.click());
  await act(async () => radio(90).click());
  expect(timeButton('14:00')?.getAttribute('aria-pressed')).toBe('true');
  expect(timeButton('Book Thai massage · 90 min · 14:00')).toBeDefined();
  await act(async () => radio(120).click());
  // 14:00 isn't open for 120 min: nothing is chosen (not 12:30 or 15:00) and the form says why.
  expect([...document.querySelectorAll('button[aria-pressed=true]')].map(b => b.textContent)).not.toContain('12:30');
  expect(timeButton('12:30')?.getAttribute('aria-pressed')).toBe('false');
  expect(timeButton('15:00')?.getAttribute('aria-pressed')).toBe('false');
  expect(document.querySelector('[role=status]:not([aria-label])')?.textContent).toBe("14:00 isn't open for 120 min. Pick another time.");
  expect(timeButton('Book appointment')?.disabled).toBe(true);
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create).not.toHaveBeenCalled();
  await act(async () => timeButton('15:00')!.click());
  expect(document.body.textContent).not.toContain("isn't open for");
  await act(async () => (document.querySelector('form') as HTMLFormElement).requestSubmit());
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ durationMin: 120, start: slotAt('15:00').start }));
});

it("names the selected staff member when switching staff makes the retained time unavailable", async () => {
  const nok = { ...staff, _id: 'staff2' as Id<'staff'>, name: 'Nok' };
  const massage = { ...thai, staffIds: [staff._id, nok._id] };
  mocks.query.mockImplementation((name: string, args: { staffId?: Id<'staff'> }) => {
    if (name.endsWith(':listServices')) return [massage];
    if (name.endsWith(':listStaff')) return [staff, nok];
    if (name.endsWith(':findOpenSlots')) return (args.staffId === nok._id ? ['15:00'] : ['14:00']).map(slotAt);
    return { warnings: [], needsReason: false, problem: null };
  });
  window.localStorage.clear();
  await renderThai();
  await act(async () => timeButton('14:00')!.click());
  await act(async () => radio(90).click());
  await staffOptions();
  const nokOption = [...document.querySelectorAll('[role=option]')].find(option => option.textContent === 'Nok')!;
  await act(async () => nokOption.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(document.getElementById('na-staff')?.textContent).toBe('Nok');
  expect(document.querySelector('[role=status]:not([aria-label])')?.textContent).toBe("Nok isn't available at 14:00. Pick another time.");
  expect(timeButton('15:00')?.getAttribute('aria-pressed')).toBe('false');
  expect(timeButton('Book appointment')?.disabled).toBe(true);
});
