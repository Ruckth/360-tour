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
const week = {
  dates, staff, lastBatch: null,
  cells: staff.flatMap(person => dates.map(date => ({ staffId: person._id, date, shifts: [{ start: '09:00', end: '17:00' }], breaks: [], note: null, override: false, patternHistoryKnown: true, patternKnownFrom: '2026-01-01', appointments: 0, timeOff: [] }))),
};
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
    cells: staff.map(person => ({ staffId: person._id, date: '2026-12-04' })),
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
