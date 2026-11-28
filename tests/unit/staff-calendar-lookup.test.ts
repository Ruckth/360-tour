// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Doc } from 'convex/_generated/dataModel';
import { AllDatesResults, InlineNextStatus, NextAppointmentJump, inlineNextStatus } from '@/components/admin/AdminStaffBookingsView';

const state = vi.hoisted(() => ({ results: {} as Record<string, unknown>, args: [] as unknown[], mutate: vi.fn() }));
vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), useSelectedLayoutSegment: () => null }));
vi.mock('convex/react', () => ({
  useMutation: () => state.mutate,
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
  state.results.searchAppointments = { windowDays: 365, sampled: true, results: [] };
  await act(async () => root.render(createElement(AllDatesResults, { query: 'Lee', staffById, serviceById, onOpen, onClose: vi.fn() })));
  expect(document.body.textContent).toContain('only the best name matches were checked');
}, 30_000);

it('D21: an empty range offers a jump to the next appointment the filters show, or names the exact searched window', async () => {
  const from = Date.parse('2026-12-08T00:00:00+07:00');
  const onOpen = vi.fn();
  const filters = { hiddenStaffIds: ['s2'], hiddenServiceIds: [], hiddenStatuses: ['no_show'], includeCancelled: false } as never;
  state.results.nextAppointment = { appointment: { _id: 'a1', start, staffId: 's1' }, until: from + 30 * 86_400_000 };
  await act(async () => root.render(createElement(NextAppointmentJump, { from, filters, filtered: true, onOpen })));
  expect(state.args).toContainEqual({ from, hiddenStaffIds: ['s2'], hiddenServiceIds: [], hiddenStatuses: ['no_show'], includeCancelled: false });
  const jump = document.querySelector('button')!;
  expect(jump.textContent).toContain('Next matching appointment: Fri 18 Dec');
  await act(async () => jump.click());
  expect(onOpen).toHaveBeenCalledWith(start);
  state.results.nextAppointment = { appointment: null, until: from + 30 * 86_400_000 };
  await act(async () => root.render(createElement(NextAppointmentJump, { from: from + 1, filters: {} as never, filtered: false, onOpen })));
  // Inclusive start, exclusive end: 8 Dec + 30 days searches through 6 Jan.
  expect(document.body.textContent).toContain('No appointments from Tue 8 Dec to Wed 6 Jan 2027 either');
}, 30_000);

it('D16: a booked chip offers one inline next status through the guarded mutation, without opening the sheet', async () => {
  state.mutate.mockReset().mockResolvedValue(null);
  const appointment = { _id: 'a1', status: 'booked', revision: 4, guestName: 'Ann' } as unknown as Doc<'appointments'>;
  const openSheet = vi.fn();
  await act(async () => root.render(createElement('div', { onClick: openSheet, onPointerDown: openSheet, onKeyDown: openSheet }, createElement(InlineNextStatus, { appointment }))));
  const button = document.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('Mark arrived: Ann');
  await act(async () => { button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); button.click(); });
  expect(state.mutate).toHaveBeenCalledWith({ appointmentId: 'a1', status: 'arrived', expectedRevision: 4 });
  expect(openSheet).not.toHaveBeenCalled();
  expect(inlineNextStatus({ status: 'arrived' })).toBe('in_service');
  // Completion keeps its sheet path (payment cues); finished appointments get nothing inline.
  expect(inlineNextStatus({ status: 'in_service' })).toBeNull();
  expect(inlineNextStatus({ status: 'completed' })).toBeNull();
}, 30_000);

it('D16: a stale or refused status change is shown on the chip', async () => {
  state.mutate.mockReset().mockRejectedValue(new Error('This appointment changed. Reopen it.'));
  const appointment = { _id: 'a1', status: 'arrived', revision: 1, guestName: 'Ann' } as unknown as Doc<'appointments'>;
  await act(async () => root.render(createElement(InlineNextStatus, { appointment })));
  await act(async () => document.querySelector('button')!.click());
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('This appointment changed');
}, 30_000);
