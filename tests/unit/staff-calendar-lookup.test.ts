// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Doc } from 'convex/_generated/dataModel';
import { AllDatesResults, NextAppointmentJump } from '@/components/admin/AdminStaffBookingsView';

const state = vi.hoisted(() => ({ results: {} as Record<string, unknown>, args: [] as unknown[] }));
vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), useSelectedLayoutSegment: () => null }));
vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: (ref: FunctionReference<'query'>, args: unknown) => { state.args.push(args); return state.results[getFunctionName(ref).split(':').pop()!]; },
}));

const start = Date.parse('2026-12-18T10:00:00+07:00');
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.results = {}; state.args = [];
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('D14: the all-dates lookup lists bounded matches and one selection opens the appointment at its date', async () => {
  state.results.searchAppointments = { windowDays: 365, results: [{ _id: 'a20', start, end: start + 3_600_000, staffId: 's1', serviceId: 'v1', guestName: 'Lena Park', confirmationCode: 'SPA-2026-ABCDEF', status: 'booked' }] };
  const onOpen = vi.fn();
  const staffById = new Map([['s1', { name: 'Mali' } as Doc<'staff'>]]);
  const serviceById = new Map([['v1', { name: 'Thai massage' } as Doc<'services'>]]);
  await act(async () => root.render(createElement(AllDatesResults, { query: 'Lena', staffById, serviceById, onOpen, onClose: vi.fn() })));
  expect(state.args).toContainEqual({ query: 'Lena' });
  expect(document.body.textContent).toContain('1 match for “Lena” within 12 months of today');
  expect(document.body.textContent).toContain('Thai massage · Mali');
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Lena Park'))!.click());
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ _id: 'a20', start }));
}, 30_000);

it('D21: an empty range offers a jump to the next appointment, or names the searched window', async () => {
  const from = Date.parse('2026-12-08T00:00:00+07:00');
  const onOpen = vi.fn();
  state.results.nextAppointment = { appointment: { _id: 'a1', start, staffId: 's1' }, until: from + 30 * 86_400_000 };
  await act(async () => root.render(createElement(NextAppointmentJump, { from, onOpen })));
  expect(state.args).toContainEqual({ from });
  const jump = document.querySelector('button')!;
  expect(jump.textContent).toContain('Next appointment');
  await act(async () => jump.click());
  expect(onOpen).toHaveBeenCalledWith(start);
  state.results.nextAppointment = { appointment: null, until: from + 30 * 86_400_000 };
  await act(async () => root.render(createElement(NextAppointmentJump, { from: from + 1, onOpen })));
  expect(document.body.textContent).toContain('None in the 30 days after');
}, 30_000);
