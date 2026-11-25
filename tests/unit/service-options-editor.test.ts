// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { ConvexError } from 'convex/values';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminStaffServicesManager } from '@/components/admin/AdminStaffServicesManager';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import { TooltipProvider } from '@/components/ui/tooltip';

const thai = {
  _id: 'thai', slug: 'thai-massage', name: 'Thai massage', description: '', category: 'Wellness', status: 'active',
  durationMin: 60, bufferMin: 15, price: 80000, currency: 'THB', staffIds: ['staff'], revision: 3,
  options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }, { durationMin: 120, price: 140000 }],
};
const facial = { ...thai, _id: 'facial', slug: 'facial', name: 'Facial', category: 'Beauty', durationMin: 45, price: 150000, options: [{ durationMin: 45, price: 150000 }], revision: 0 };
const nok = { _id: 'staff', name: 'Nok', role: 'Therapist', color: '#0f766e', status: 'active', workingHours: [], breaks: [] };
const state = vi.hoisted(() => ({ save: vi.fn<(args: Record<string, unknown>) => Promise<undefined>>(), services: [] as unknown[], usage: [] as unknown[], staff: [] as unknown[] }));
vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/admin/RecordHistoryPanel', () => ({
  RecordHistoryPanel: () => null, ConfigurationHistoryRecords: () => null,
  HistoryDisclosure: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('convex/react', () => ({
  useMutation: () => state.save,
  useAction: () => vi.fn(),
  useQuery: (ref: FunctionReference<'query'>) => {
    const name = getFunctionName(ref).split(':').pop();
    if (name === 'listStaff') return state.staff;
    if (name === 'listServices') return state.services;
    if (name === 'upcomingOptionUsage') return state.usage;
    if (name === 'countUpcomingAppointments') return 0;
    return undefined;
  },
  useConvex: () => ({}),
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
}));

let root: Root;
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label || b.getAttribute('aria-label') === label) as HTMLButtonElement;
const input = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const type = (element: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
});
const save = () => act(async () => {
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});
const errorFor = (element: HTMLInputElement) => document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent;
async function open(service?: typeof thai) {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(ConfirmProvider, null, createElement(AdminStaffServicesManager, { section: 'services' })))));
  await act(async () => button(service ? `Edit ${service.name}` : 'Add service').click());
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.save.mockReset().mockResolvedValue(undefined);
  state.services = [thai, facial];
  state.usage = [];
  state.staff = [nok];
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('lists a multi-length service with its lengths, price range, badge and pills; a one-length row reads as before', async () => {
  await act(async () => root.render(createElement(TooltipProvider, null, createElement(ConfirmProvider, null, createElement(AdminStaffServicesManager, { section: 'services' })))));
  const [thaiRow, facialRow] = document.querySelectorAll('ul.divide-y > li');
  expect(thaiRow.textContent).toContain('Wellness · 60 / 90 / 120 min + 15 min turnaround · ฿800–1,400 · Nok');
  expect(thaiRow.textContent).toContain('3 durations');
  expect([...thaiRow.querySelectorAll('ul li')].map(li => li.textContent)).toEqual(['60 min ฿800 · default', '90 min ฿1,100', '120 min ฿1,400']);
  expect(facialRow.textContent).toContain('Beauty · 45 min + 15 min turnaround · ฿1,500 · Nok');
  expect(facialRow.textContent).not.toContain('durations');
});

it('adds a preset at the per-minute price, changes the default and saves options with the revision', async () => {
  await open(thai);
  await act(async () => button('150 min').click());
  // ฿800 for 60 min → ฿2,000 for 150, rounded to ฿50; the new price is focused for editing.
  const price150 = input('Price for 150 min (THB)');
  expect(price150.value).toBe('2000');
  expect(document.activeElement).toBe(price150);
  expect(button('150 min')).toBeUndefined();
  expect(document.body.textContent).toContain('Guests see: Thai massage — 60 min ฿800 · 90 min ฿1,100 · 120 min ฿1,400 · 150 min ฿2,000');
  await act(async () => input('Default length: 90 min').click());
  await save();
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    serviceId: 'thai', expectedRevision: 3, defaultDurationMin: 90,
    options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 110000 }, { durationMin: 120, price: 140000 }, { durationMin: 150, price: 200000 }],
  }));
  // Only the changed field group goes: nothing else can overwrite a newer save.
  expect(Object.keys(state.save.mock.calls[0][0]).sort()).toEqual(['defaultDurationMin', 'expectedRevision', 'imageStorageId', 'options', 'serviceId']);
});

it('removes a length, moves focus to its neighbour, keeps one row and moves the default off a removed row', async () => {
  state.usage = [{ durationMin: 120, count: 3 }];
  await open(thai);
  expect(errorFor(input('Duration 3 (minutes)'))).toBe("3 upcoming bookings use this length. Changing it won't move them.");
  await act(async () => button('Remove 120 min').click());
  expect(document.activeElement).toBe(input('Duration 2 (minutes)'));
  expect(document.querySelector('[aria-live=polite]')?.textContent).toBe('Removed 120 min. 3 upcoming bookings keep their time and price.');
  await act(async () => button('Remove 60 min').click());
  expect(document.querySelector('[aria-live=polite]')?.textContent).toBe('Removed 60 min. 90 min is now the default.');
  expect(button('Remove 90 min').disabled).toBe(true);
  expect(input('Default length: 90 min').checked).toBe(true);
  await save();
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ options: [{ durationMin: 90, price: 110000 }], defaultDurationMin: 90 }));
});

it('shows each problem inline on its row, tied to the field, and saves nothing until fixed', async () => {
  await open(thai);
  const duration = input('Duration 2 (minutes)');
  await type(duration, '70');
  await type(input('Price for 120 min (THB)'), '');
  await save();
  expect(state.save).not.toHaveBeenCalled();
  expect(duration.getAttribute('aria-invalid')).toBe('true');
  expect(errorFor(duration)).toBe('Duration must be a multiple of 15 minutes');
  expect(document.activeElement).toBe(duration);
  expect(errorFor(input('Price for 120 min (THB)'))).toBe('Enter a price (0 or more)');
  await type(duration, '60');
  expect(errorFor(duration)).toBe('60 min is already listed');
  await type(duration, '1440');
  expect(errorFor(duration)).toBe('Duration plus turnaround must fit in one day');
  await type(duration, '90');
  await type(input('Price for 120 min (THB)'), '1400.505');
  expect(errorFor(input('Price for 120 min (THB)'))).toBe('Enter a price with at most 2 decimals.');
  await type(input('Price for 120 min (THB)'), '1400.5');
  expect(document.querySelector('[aria-invalid=true]')).toBeNull();
  await save();
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ options: expect.arrayContaining([{ durationMin: 120, price: 140050 }]) }));
});

it('creates a service with one length by default and "Other…" for a custom one', async () => {
  await open();
  const name = document.querySelector<HTMLInputElement>('#sv-name')!;
  await type(name, 'Massage');
  await type(document.querySelector<HTMLInputElement>('#sv-category')!, 'Wellness');
  await type(input('Price for 60 min (THB)'), '100.51');
  await act(async () => button('Other…').click());
  expect(document.activeElement).toBe(input('Duration 2 (minutes)'));
  expect(input('Duration 2 (minutes)').value).toBe('75');
  await act(async () => [...document.querySelectorAll<HTMLInputElement>('input[type=checkbox]')][0].click());
  await save();
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    name: 'Massage', slug: 'massage', category: 'Wellness', currency: 'THB', bufferMin: 15, staffIds: ['staff'], defaultDurationMin: 60, options: [{ durationMin: 60, price: 10051 }, { durationMin: 75, price: 15000 }],
  }));
  expect(state.save.mock.calls[0][0]).not.toHaveProperty('expectedRevision');
  expect(Object.keys(state.save.mock.calls[0][0]).sort()).toEqual(['bufferMin', 'category', 'currency', 'defaultDurationMin', 'description', 'imageStorageId', 'name', 'options', 'slug', 'staffIds']);
});

const rerender = () => act(async () => root.render(createElement(TooltipProvider, null, createElement(ConfirmProvider, null, createElement(AdminStaffServicesManager, { section: 'services' })))));
const stale = () => new ConvexError({ code: 'STALE_ADJUSTMENT_REVISION', message: 'This record changed.' });
const checkbox = (name: string) => [...document.querySelectorAll('label')].find(label => label.textContent?.includes(name))!.querySelector<HTMLInputElement>('input[type=checkbox]')!;

it('recovers from an edit conflict: reload takes the other admin\'s changes, keeps mine and saves only mine', async () => {
  state.save.mockRejectedValueOnce(stale());
  await open(thai);
  await type(input('Price for 90 min (THB)'), '1200');
  await save();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Someone else changed this service.');
  expect(document.activeElement).toBe(button('Reload & keep my edits'));
  // Someone else's save arrives through the live list: a new name, turnaround and 60-min price.
  state.services = [{ ...thai, revision: 4, name: 'Thai massage (traditional)', bufferMin: 30, options: [{ durationMin: 60, price: 90000 }, ...thai.options.slice(1)], price: 90000 }, facial];
  await rerender();
  await act(async () => button('Reload & keep my edits').click());
  expect(document.querySelector<HTMLInputElement>('#sv-name')!.value).toBe('Thai massage (traditional)');
  expect(document.querySelector<HTMLInputElement>('#sv-buffer')!.value).toBe('30');
  expect(input('Price for 90 min (THB)').value).toBe('1200');
  // The lengths are one group: mine changed, so all of it stays mine.
  expect(input('Price for 60 min (THB)').value).toBe('800');
  expect(document.querySelector('[role=status]')?.textContent).toBe('Loaded the latest version. Your changes are kept.');
  expect(document.activeElement?.textContent?.trim()).toBe('Save');
  await save();
  const sent = state.save.mock.lastCall![0];
  expect(sent).toMatchObject({ expectedRevision: 4, defaultDurationMin: 60, options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 120000 }, { durationMin: 120, price: 140000 }] });
  expect(sent).not.toHaveProperty('name');
  expect(sent).not.toHaveProperty('bufferMin');
  expect(sent).not.toHaveProperty('staffIds');
});

it('after a conflict, keeps staff the other admin removed off the service when I did not touch staff', async () => {
  const mali = { ...nok, _id: 'staff2', name: 'Mali' };
  state.staff = [nok, mali];
  state.services = [{ ...thai, staffIds: ['staff', 'staff2'] }, facial];
  state.save.mockRejectedValueOnce(stale());
  await open(thai);
  expect(checkbox('Mali').checked).toBe(true);
  await type(document.querySelector<HTMLInputElement>('#sv-description')!, 'Deep pressure');
  await save();
  // The other admin took Mali off this service and changed the 60-min price.
  state.services = [{ ...thai, revision: 4, staffIds: ['staff'], price: 90000, options: [{ durationMin: 60, price: 90000 }, ...thai.options.slice(1)] }, facial];
  await rerender();
  await act(async () => button('Reload & keep my edits').click());
  expect(checkbox('Mali').checked).toBe(false);
  expect(input('Price for 60 min (THB)').value).toBe('900');
  expect(document.querySelector<HTMLInputElement>('#sv-description')!.value).toBe('Deep pressure');
  await save();
  expect(state.save.mock.lastCall![0]).toEqual({ serviceId: 'thai', description: 'Deep pressure', imageStorageId: undefined, expectedRevision: 4 });
});

it('keeps the draft when staff is archived during editing and saves only active assignments', async () => {
  const mali = { ...nok, _id: 'staff2', name: 'Mali' };
  const pla = { ...nok, _id: 'staff3', name: 'Pla' };
  state.staff = [nok, mali, pla];
  await open(thai);
  await act(async () => checkbox('Mali').click());
  await act(async () => checkbox('Pla').click());
  await type(input('Price for 90 min (THB)'), '1200');
  state.staff = [nok, { ...mali, status: 'archived' }, pla];
  await rerender();
  await save();
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    staffIds: ['staff', 'staff3'],
    options: expect.arrayContaining([{ durationMin: 90, price: 120000 }]),
  }));
});

it('preserves the draft after the only assigned staff member is archived', async () => {
  state.save.mockRejectedValueOnce(stale());
  await open(thai);
  await type(input('Price for 90 min (THB)'), '1200');
  state.staff = [{ ...nok, status: 'archived' }];
  state.services = [{ ...thai, staffIds: [], revision: 4 }, facial];
  await rerender();
  await save();
  await act(async () => button('Reload & keep my edits').click());
  expect(button('Save').disabled).toBe(false);
  await save();
  expect(state.save.mock.lastCall![0]).toEqual({
    serviceId: 'thai',
    expectedRevision: 4,
    imageStorageId: undefined,
    defaultDurationMin: 60,
    options: [{ durationMin: 60, price: 80000 }, { durationMin: 90, price: 120000 }, { durationMin: 120, price: 140000 }],
  });
});

it('keeps the conflict and the old revision when the latest version has not arrived', async () => {
  state.save.mockRejectedValue(stale());
  await open(thai);
  await type(input('Price for 90 min (THB)'), '1200');
  await save();
  await act(async () => button('Reload & keep my edits').click());
  expect(document.querySelector('[role=alert]')?.textContent).toContain("the latest version hasn't loaded yet");
  expect(button('Reload & keep my edits')).toBeDefined();
  await save();
  expect(state.save.mock.lastCall![0]).toMatchObject({ expectedRevision: 3 });
});

it('shows the row\'s own error, not the browser\'s bubble, when the browser finds a length invalid', async () => {
  await open(thai);
  const duration = input('Duration 2 (minutes)');
  await type(duration, '119');
  const invalid = new Event('invalid', { cancelable: true });
  await act(async () => { duration.dispatchEvent(invalid); });
  expect(invalid.defaultPrevented).toBe(true);
  expect(duration.getAttribute('aria-invalid')).toBe('true');
  expect(errorFor(duration)).toBe('Duration must be a multiple of 15 minutes');
  expect(document.activeElement).toBe(duration);
});

it('offers presets until six lengths, then says so', async () => {
  await open(thai);
  for (const minutes of [30, 45, 75]) await act(async () => button(`${minutes} min`).click());
  expect(document.body.textContent).toContain('Maximum of 6 lengths');
  expect(button('Other…')).toBeUndefined();
});
