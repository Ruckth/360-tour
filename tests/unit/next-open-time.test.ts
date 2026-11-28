// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Id } from 'convex/_generated/dataModel';
import { NextOpenTime } from '@/components/admin/NewAppointmentDialog';

const state = vi.hoisted(() => ({ result: undefined as unknown, args: [] as unknown[] }));
vi.mock('convex/react', () => ({ useMutation: () => vi.fn(), useQuery: (_ref: unknown, args: unknown) => { state.args.push(args); return state.result; } }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.args = [];
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const args = { serviceId: 'svc' as Id<'services'>, afterDate: '2026-12-01', staffId: 'mali' as Id<'staff'> };

it('D20: a later matching slot is shown with its date and selecting it applies date and time', async () => {
  const start = Date.parse('2026-12-04T09:00:00+07:00');
  state.result = { slot: { date: '2026-12-04', start }, from: '2026-12-02', through: '2026-12-15' };
  const onChoose = vi.fn();
  await act(async () => root.render(createElement(NextOpenTime, { args, onChoose })));
  expect(state.args).toContainEqual(args);
  const button = document.querySelector('button')!;
  expect(button.textContent).toMatch(/Next open: .*4 Dec · 09:00/);
  await act(async () => button.click());
  expect(onChoose).toHaveBeenCalledWith({ date: '2026-12-04', start });
});

it('D20: with no match the searched range is named and nothing is offered', async () => {
  state.result = { slot: null, from: '2026-12-02', through: '2026-12-15' };
  await act(async () => root.render(createElement(NextOpenTime, { args, onChoose: vi.fn() })));
  expect(document.querySelector('button')).toBeNull();
  expect(document.body.textContent).toMatch(/No open times from .*2 Dec through .*15 Dec/);
});

it('D19: the stay picker lists only stays covering the appointment date, and attaching is explicit and removable', async () => {
  const { StayAttachPicker, attachableStays } = await import('@/components/admin/NewAppointmentDialog');
  const stays = [
    { _id: 'b1', guestName: 'Mia', checkIn: '2026-12-01', checkOut: '2026-12-03', status: 'confirmed', confirmationCode: 'VIL-2026-AAAAAA' },
    { _id: 'b2', guestName: 'Mia', checkIn: '2026-12-10', checkOut: '2026-12-12', status: 'confirmed', confirmationCode: 'VIL-2026-BBBBBB' },
    { _id: 'b3', guestName: 'Mia', checkIn: '2026-12-01', checkOut: '2026-12-04', status: 'cancelled', confirmationCode: 'VIL-2026-CCCCCC' },
  ] as never[];
  expect(attachableStays(stays, '2026-12-02').map((s: { _id: string }) => s._id)).toEqual(['b1']);
  state.result = stays;
  const onChange = vi.fn();
  await act(async () => root.render(createElement(StayAttachPicker, { date: '2026-12-02', value: null, onChange })));
  const input = document.getElementById('na-stay') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Mia');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(state.args).toContainEqual({ query: 'Mia' });
  const options = [...document.querySelectorAll('li button')];
  expect(options.map(o => o.textContent)).toEqual([expect.stringContaining('VIL-2026-AAAAAA')]);
  await act(async () => (options[0] as HTMLButtonElement).click());
  expect(onChange).toHaveBeenCalledWith(stays[0]);
  await act(async () => root.render(createElement(StayAttachPicker, { date: '2026-12-02', value: stays[0], onChange })));
  expect(document.body.textContent).toContain('Nothing is charged until staff take payment');
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Remove')!.click());
  expect(onChange).toHaveBeenLastCalledWith(null);
}, 30_000);
