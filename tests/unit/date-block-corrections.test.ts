// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Id } from 'convex/_generated/dataModel';
import { DateBlockDialog } from '@/components/admin/DateBlockDialog';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';

const state = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('convex/react', () => ({
  useMutation: (ref: FunctionReference<'mutation'>) => getFunctionName(ref) === 'adminBookings:updateDateBlock' ? state.update : vi.fn(),
  useQuery: () => [],
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
}));
vi.mock('@/components/booking/BookingDatePicker', () => ({ BookingRangePicker: () => null }));
vi.mock('@/components/admin/VillaPicker', () => ({ VillaPicker: () => null }));

const block = { _id: 'block1' as Id<'dateBlocks'>, propertyId: 'villa1' as Id<'properties'>, start: '2020-01-01', end: '2020-01-03', reason: 'Maintenance' };
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.update.mockReset();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const submit = () => act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

it('captures the reviewed block, prevents duplicate saves and Escape dismissal while pending, and retains a rejected draft', async () => {
  let reject!: (error: Error) => void;
  state.update.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const close = vi.fn();
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(DateBlockDialog, { target: { kind: 'host', block }, properties: [], onClose: close }))));
  const input = document.querySelector<HTMLInputElement>('#block-reason')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Corrected maintenance');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await submit();
  await submit();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(close).not.toHaveBeenCalled();
  expect(document.querySelector('fieldset')!.disabled).toBe(true);
  expect(state.update).toHaveBeenCalledTimes(1);
  expect(state.update).toHaveBeenCalledWith({ blockId: block._id, propertyId: block.propertyId, start: block.start, end: block.end, reason: 'Corrected maintenance', expected: { propertyId: block.propertyId, start: block.start, end: block.end, reason: block.reason } });
  await act(async () => reject(new Error('This block changed. Reopen it.')));
  expect(input.value).toBe('Corrected maintenance');
  expect(document.body.textContent).toContain('This block changed. Reopen it.');
  expect(document.querySelector('fieldset')!.disabled).toBe(false);
});
