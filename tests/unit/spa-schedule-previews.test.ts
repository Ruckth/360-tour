// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Doc, Id } from 'convex/_generated/dataModel';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import { RescheduleDialog } from '@/components/admin/RescheduleDialog';
import { TurnaroundDialog } from '@/components/admin/TurnaroundDialog';

const state = vi.hoisted(() => ({ queries: {} as Record<string, (args: unknown) => unknown>, mutation: vi.fn() }));
vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('convex/react', () => ({
  useMutation: () => state.mutation,
  useQuery: (ref: FunctionReference<'query'>, args: unknown) => args === 'skip' ? undefined : state.queries[getFunctionName(ref).split(':').pop()!]?.(args),
}));

const HOUR = 3_600_000;
const start = Date.now() + 48 * HOUR - ((Date.now() + 48 * HOUR) % (15 * 60_000));
const appointment = {
  _id: 'a1' as Id<'appointments'>, _creationTime: 0, serviceId: 's1' as Id<'services'>, staffId: 'mali' as Id<'staff'>, start, end: start + HOUR, blockedUntil: start + HOUR + 15 * 60_000,
  status: 'booked', guestName: 'Ann', guestPhone: '+66', price: 100000, currency: 'THB', paymentStatus: 'unpaid', revision: 0,
} as unknown as Doc<'appointments'>;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.queries = {}; state.mutation.mockReset();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
const render = (node: ReturnType<typeof createElement>) => act(async () => root.render(createElement(ConfirmProvider, null, node)));

it('F11: a longer turnaround names its first blocker and the maximum that fits before any write', async () => {
  const previewArgs: unknown[] = [];
  state.queries.previewAppointmentTurnaround = (args) => { previewArgs.push(args); return { problem: null, blocker: { kind: 'appointment', start: start + HOUR + 15 * 60_000 }, maxMin: 15 }; };
  await render(createElement(TurnaroundDialog, { appointment, initialMin: 30, onClose: vi.fn() }));
  expect(previewArgs).toContainEqual({ appointmentId: 'a1', turnaroundMin: 30 });
  const alert = document.querySelector('[role="alert"]')!.textContent!;
  expect(alert).toContain('by another appointment');
  expect(alert).toContain('No longer turnaround fits');
  expect(button('Save turnaround').disabled).toBe(true);
  expect(state.mutation).not.toHaveBeenCalled();
});

it('F11: a turnaround that fits stays saveable through the existing write-time check', async () => {
  state.queries.previewAppointmentTurnaround = () => ({ problem: null, blocker: null, maxMin: null });
  await render(createElement(TurnaroundDialog, { appointment, initialMin: 30, onClose: vi.fn() }));
  expect(button('Save turnaround').disabled).toBe(false);
});

it('F10: the staff picker shows open-time counts for the selected day, including zero', async () => {
  const slot = (offset: number, staffIds: string[]) => ({ start: start + offset * 15 * 60_000, staffIds });
  state.queries.rescheduleOptions = () => ({ staff: [{ _id: 'mali', name: 'Mali' }, { _id: 'nok', name: 'Nok' }, { _id: 'pim', name: 'Pim' }], slots: [slot(0, ['mali', 'nok']), slot(1, ['nok']), slot(2, ['nok'])] });
  state.queries.previewAppointmentTime = () => ({ warnings: [], needsReason: false, problem: null });
  await render(createElement(RescheduleDialog, { appointment, serviceName: 'Massage', staffById: new Map(), onClose: vi.fn() }));
  const trigger = document.getElementById('rs-staff')!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  const labels = [...document.querySelectorAll('[role="option"]')].map(option => option.textContent);
  expect(labels).toEqual(['Mali · 1 open', 'Nok · 3 open', 'Pim · 0 open']);
});

it('F13: on an overridden date the disabled weekly option links to that person and weekday in Roster', async () => {
  state.queries.previewBreakChange = () => ({ problem: null, conflicts: [], affectedDates: [], keptDates: [], previewThrough: null });
  const plan = { shifts: [{ start: '09:00', end: '18:00' }], breaks: [{ start: '12:00', end: '13:00', label: 'Lunch' }] };
  const block = { kind: 'break', staffId: 'mali', start, end: start + HOUR, label: 'Lunch', date: '2026-12-01', original: plan.breaks[0], plan, override: true };
  const { BreakEditDialog } = await import('@/components/admin/BreakEditDialog');
  await render(createElement(BreakEditDialog, { block: block as never, staffName: 'Mali', onClose: vi.fn() }));
  expect(document.querySelector<HTMLInputElement>('input[name="break-scope"]:disabled')).toBeTruthy();
  const link = document.querySelector<HTMLAnchorElement>('a[href="/admin/staff/roster?date=2026-12-01&staff=mali"]')!;
  expect(link.textContent).toBe("Open Mali's Tuesday in Roster");
});
