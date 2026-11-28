// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { DateBlockDialog } from '@/components/admin/DateBlockDialog';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import type { AdminProperty } from '@/components/admin/admin-bookings-shared';

const state = vi.hoisted(() => ({ add: vi.fn(), previewArgs: [] as unknown[], preview: undefined as unknown }));
vi.mock('convex/react', () => ({
  useMutation: (ref: FunctionReference<'mutation'>) => getFunctionName(ref).endsWith('addDateBlocks') ? state.add : vi.fn(),
  useQuery: (ref: FunctionReference<'query'>, args: unknown) => {
    if (!getFunctionName(ref).endsWith('previewDateBlocks')) return [];
    state.previewArgs.push(args);
    return args === 'skip' ? undefined : state.preview;
  },
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
}));
vi.mock('@/components/booking/BookingDatePicker', () => ({ BookingRangePicker: () => null }));
vi.mock('@/components/admin/VillaPicker', () => ({ VillaPicker: () => null }));

const properties = [{ _id: 'v1', name: 'Pool' }, { _id: 'v2', name: 'Garden' }, { _id: 'v3', name: 'Tideglass' }] as unknown as AdminProperty[];
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.add.mockReset(); state.previewArgs = [];
  state.preview = [{ propertyId: 'v1', error: null }, { propertyId: 'v2', error: null }, { propertyId: 'v3', error: 'These dates overlap a booking.' }];
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim().startsWith(label));
async function openWithAllVillas() {
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(DateBlockDialog, { target: { kind: 'new', start: '2030-01-10', end: '2030-01-12' }, properties, onClose: vi.fn() }))));
  await act(async () => button('Select all')!.click());
  const reason = document.querySelector<HTMLInputElement>('#block-reason')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(reason, 'Festival');
    reason.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('F04: previews per-villa conflicts before any write and states how many blocks will be saved', async () => {
  await openWithAllVillas();
  expect(state.previewArgs).toContainEqual({ propertyIds: ['v1', 'v2', 'v3'], start: '2030-01-10', end: '2030-01-12' });
  expect(document.body.textContent).toContain('2 of 3 villas can be blocked');
  expect(document.body.textContent).toContain('Tideglass');
  expect(document.body.textContent).toContain('These dates overlap a booking.');
  expect(button('Save 2 blocks · skip 1')).toBeTruthy();
  expect(state.add).not.toHaveBeenCalled();
});

it('F03: after a partial result, retry returns to the form with only skipped villas and keeps range and reason', async () => {
  state.add.mockResolvedValue([{ propertyId: 'v1', blockId: 'b1', error: null }, { propertyId: 'v2', blockId: 'b2', error: null }, { propertyId: 'v3', blockId: null, error: 'These dates overlap a booking.' }]);
  await openWithAllVillas();
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(document.body.textContent).toContain('Blocked 2 of 3 villas');
  await act(async () => button('Retry skipped villas')!.click());
  const checked = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map(box => box.checked);
  expect(checked).toEqual([false, false, true]);
  expect(document.querySelector<HTMLInputElement>('#block-reason')!.value).toBe('Festival');
  expect(button('Block dates')).toBeTruthy();
});
