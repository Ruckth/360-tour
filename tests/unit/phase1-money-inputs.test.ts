// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Id } from 'convex/_generated/dataModel';
import { OtaRatesPanel } from '@/components/admin/OtaRatesDialog';
import { formatChartTick } from '@/components/admin/marketing/dashboard/DashboardChart';

const state = vi.hoisted(() => ({ amount: 1000000, save: vi.fn(async () => undefined) }));
vi.mock('convex/react', () => ({
  useQuery: () => [{ _id: 'rate', platform: 'booking_com', nightlyRate: state.amount, updatedAt: Date.now() }],
  useMutation: () => state.save,
}));
vi.mock('@/components/admin/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); container?.remove(); root = undefined; state.save.mockClear(); });

it.each([1000000, 1000050])('editing an OTA rate preserves its stored satang amount (%s)', async amount => {
  state.amount = amount;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(createElement(OtaRatesPanel, { propertyId: 'property' as Id<'properties'> })));
  const edit = [...container.querySelectorAll('button')].find(button => button.textContent === 'Edit')!;
  await act(async () => edit.click());
  const price = container.querySelector<HTMLInputElement>('#ota-rate')!;
  expect(price.value).toBe(String(amount / 100));
  await act(async () => container!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ nightlyRate: amount }));
});

it('formats chart ticks from satang once at small and abbreviated values', () => {
  expect(formatChartTick(500000, true)).toBe('฿5,000');
  expect(formatChartTick(1000000, true)).toBe('฿10K');
  expect(formatChartTick(100000000, true)).toBe('฿1M');
  expect(formatChartTick(500000, false)).toBe('500,000');
});
