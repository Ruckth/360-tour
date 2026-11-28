// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import { StaffRosterView } from '@/components/admin/StaffRosterView';

const state = vi.hoisted(() => ({ apply: vi.fn(), search: '' }));
vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock('@/components/admin/RecordHistoryPanel', () => ({ RecordHistoryPanel: () => null }));
const dates = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'];
const staff = ['Mali', 'Nok', 'Pim'].map((name, i) => ({ _id: `staff${i}`, name, role: 'Therapist', color: '#abc' }));
let week = {
  dates, staff, lastBatch: null,
  cells: staff.flatMap(person => dates.map(date => ({ staffId: person._id, date, shifts: [{ start: '09:00', end: '17:00' }], breaks: [], note: null, override: false, patternHistoryKnown: true, patternKnownFrom: '2026-01-01', appointments: 0, timeOff: [] }))),
};
const initialCells = week.cells;
vi.mock('convex/react', () => ({
  useQuery: (ref: FunctionReference<'query'>) => getFunctionName(ref).endsWith('getWeek') ? week : [],
  useMutation: (ref: FunctionReference<'mutation'>) => getFunctionName(ref).endsWith('applyCells') ? state.apply : vi.fn(),
}));

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('640'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-12-01T10:00:00+07:00'));
  state.apply.mockReset().mockResolvedValue({ ok: true, batchId: 'b1', warnings: [], skipped: [], changed: 3 });
  state.search = '';
  week = { ...week, cells: initialCells };
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const byText = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith(text))!;

it('D24: at phone width one day is edited at a time: Friday 10:00–18:00 for three staff without the wide grid', async () => {
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(StaffRosterView))));
  expect(document.querySelector('table')!.className).toContain('hidden');
  const friday = document.querySelector<HTMLButtonElement>('[aria-label^="Fri 4 Dec"]')!;
  await act(async () => friday.click());
  expect(friday.getAttribute('aria-pressed')).toBe('true');
  for (const name of ['Mali', 'Nok', 'Pim']) await act(async () => [...document.querySelectorAll<HTMLButtonElement>('li button')].find(b => b.textContent?.includes(name))!.click());
  expect(document.body.textContent).toContain('3 cells selected');
  await act(async () => byText('Custom').click());
  await act(async () => document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(state.apply).toHaveBeenCalledWith(expect.objectContaining({
    // Each cell carries the plan that was reviewed, so a concurrent change is refused instead of overwritten.
    cells: staff.map(person => ({ staffId: person._id, date: '2026-12-04', expectedPlan: { shifts: [{ start: '09:00', end: '17:00' }], breaks: [] } })),
    shifts: [{ start: '10:00', end: '18:00' }],
  }));
}, 30_000);

it('F13/D18: a roster deep link opens that week with the person-day selected', async () => {
  state.search = 'date=2026-12-03&staff=staff1';
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(StaffRosterView))));
  expect(document.querySelector('[aria-label^="Thu 3 Dec"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(document.body.textContent).toContain('1 cell selected');
  expect([...document.querySelectorAll('li button')].find(b => b.textContent?.includes('Nok'))!.getAttribute('aria-pressed')).toBe('true');
}, 30_000);

it('opens the week grid with staff names pinned and returns to the selected day', async () => {
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(StaffRosterView))));
  const friday = () => document.querySelector<HTMLButtonElement>('[aria-label^="Fri 4 Dec"]')!;
  await act(async () => friday().click());
  const [day, week] = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="Roster view"] button'));
  await act(async () => week.click());
  expect(week.getAttribute('aria-pressed')).toBe('true');
  const table = document.querySelector('table')!;
  expect(table.classList.contains('hidden')).toBe(false);
  expect(table.querySelector('th[scope="row"]')?.classList.contains('sticky')).toBe(true);
  await act(async () => day.click());
  expect(friday().getAttribute('aria-pressed')).toBe('true');
}, 30_000);

it('D24: selections on days that are not shown are counted and named, and changing week asks before clearing them', async () => {
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(StaffRosterView))));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="Fri 4 Dec"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('li button')].find(b => b.textContent?.includes('Mali'))!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="Thu 3 Dec"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('li button')].find(b => b.textContent?.includes('Nok'))!.click());
  expect(document.body.textContent).toContain('2 cells selected');
  expect(document.body.textContent).toContain('1 not on Thu 3 Dec');
  expect(document.querySelector('[aria-label^="Fri 4 Dec"]')!.getAttribute('aria-label')).toBe('Fri 4 Dec, 1 selected');

  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click());
  expect(document.querySelector('[role="alertdialog"], [role="dialog"]')?.textContent).toContain('Clear 2 selected cells?');
  await act(async () => byText('Cancel').click());
  expect(document.body.textContent).toContain('2 cells selected');

  await act(async () => byText('Keep only this day').click());
  expect(document.body.textContent).toContain('1 cell selected');
  expect(document.body.textContent).not.toContain('not on Thu');
}, 30_000);

it('D24: a concurrent change while the editor is open is sent as the reviewed plan, refused safely, and re-reviewed', async () => {
  const render = () => act(async () => root.render(createElement(ConfirmProvider, null, createElement(StaffRosterView))));
  await render();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="Fri 4 Dec"]')!.click());
  for (const name of ['Mali', 'Nok', 'Pim']) await act(async () => [...document.querySelectorAll<HTMLButtonElement>('li button')].find(b => b.textContent?.includes(name))!.click());
  await act(async () => byText('Custom').click());
  // Another operator saves Mali's Friday while this editor is open; the live query updates underneath it.
  const evening = [{ start: '14:00', end: '22:00' }];
  week = { ...week, cells: week.cells.map(cell => cell.staffId === 'staff0' && cell.date === '2026-12-04' ? { ...cell, shifts: evening, override: true } : cell) };
  await render();
  state.apply.mockReset().mockRejectedValue(new Error('This roster day changed since you opened it. Review the latest schedule and try again.'));
  await act(async () => document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const malisFriday = () => (state.apply.mock.calls.at(-1)![0] as { cells: Array<{ staffId: string; expectedPlan: unknown }> }).cells.find(cell => cell.staffId === 'staff0')!.expectedPlan;
  expect(malisFriday()).toEqual({ shifts: [{ start: '09:00', end: '17:00' }], breaks: [] });
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('changed since you opened it');
  expect(document.body.textContent).toContain('3 cells selected');
  // After reviewing what is shown now, retrying expects the plan on screen.
  state.apply.mockReset().mockResolvedValue({ ok: true, batchId: 'b2', warnings: [], skipped: [], changed: 3 });
  await act(async () => byText('Custom').click());
  await act(async () => document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(malisFriday()).toEqual({ shifts: evening, breaks: [] });
}, 30_000);
