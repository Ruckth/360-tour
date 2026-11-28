// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BookingCleanupDialog } from '@/components/admin/BookingCleanupDialog';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';

const state = vi.hoisted(() => ({ del: vi.fn(), args: [] as Array<{ olderThanDays: number }>, rows: [] as unknown[] }));
vi.mock('convex/react', () => ({
  useMutation: () => state.del,
  useQuery: (_ref: unknown, args: { olderThanDays: number }) => { state.args.push(args); return state.rows; },
}));

const row = (i: number) => ({ _id: `booking_${String(i).padStart(6, '0')}`, propertyId: 'v1', guestName: `Guest ${i}`, checkIn: '2026-01-01', checkOut: '2026-01-02', createdAt: 0, status: 'pending', paymentStatus: 'pending', source: 'web' });
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.del.mockReset(); state.args = []; state.rows = [];
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(createElement(ConfirmProvider, null, createElement(BookingCleanupDialog, { properties: [], onClose: vi.fn() }))));
const input = () => document.querySelector<HTMLInputElement>('#cleanup-days')!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith(label))!;

it('F7: editing the threshold never queries a transient zero-day list; only an applied whole number is used', async () => {
  await render();
  await type('');
  await type('3');
  await type('30');
  expect(state.args.every(args => args.olderThanDays === 7)).toBe(true);
  expect(document.body.textContent).toContain('plus hand-entered ones');
  await act(async () => input().closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(state.args.at(-1)).toEqual({ olderThanDays: 30 });
  await type('');
  await act(async () => { input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
  expect(input().value).toBe('30');
  expect(state.args.some(args => args.olderThanDays === 0)).toBe(false);
});

it('F6: an interrupted cleanup keeps confirmed counts and skipped references visible and marks the failed batch unconfirmed', async () => {
  state.rows = Array.from({ length: 150 }, (_, i) => row(i));
  state.del
    .mockResolvedValueOnce({ deleted: 99, skipped: [{ bookingId: 'booking_000004', reason: 'Paid bookings are never deleted.' }] })
    .mockRejectedValueOnce(new Error('Network lost'));
  await render();
  await act(async () => (document.querySelector<HTMLInputElement>('label input[type="checkbox"]')!).click());
  await act(async () => button('Delete 150').click());
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Delete')!.click());
  const text = document.querySelector('[role="alert"]')!.textContent!;
  expect(text).toContain('Batch 2 of 2 did not confirm');
  expect(text).toContain('Network lost');
  expect(text).toContain('deleted 99 bookings, skipped 1');
  expect(document.body.textContent).toContain('Skipped bookings (1)');
  expect(document.body.textContent).toContain('Guest 4');
}, 30_000);
