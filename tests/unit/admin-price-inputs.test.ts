// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminPropertyEditor } from '@/components/admin/AdminPropertyEditor';
import { AdminStaffServicesManager } from '@/components/admin/AdminStaffServicesManager';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import { TooltipProvider } from '@/components/ui/tooltip';

const state = vi.hoisted(() => ({ save: vi.fn(async () => undefined) }));
vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/admin/RecordHistoryPanel', () => ({
  RecordHistoryPanel: () => null, ConfigurationHistoryRecords: () => null,
  HistoryDisclosure: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('convex/react', () => ({
  useMutation: () => state.save,
  useAction: () => vi.fn(),
  useQuery: (ref: FunctionReference<'query'>) => {
    const name = getFunctionName(ref).split(':').pop();
    if (name === 'get') return {
      property: {
        _id: 'villa', slug: 'villa', name: 'Villa', status: 'active', tagline: '', description: '',
        pricePerNight: 10050, currency: 'THB', directDiscountPercent: 0, maxGuests: 2,
        bedrooms: 1, bathrooms: 1, area: 40, amenities: [], images: [], tourRoomIds: [],
      }, deleteBlocker: null, slugLocked: false, rooms: [],
    };
    if (name === 'listStaff') return [{ _id: 'staff', name: 'Nok', color: '#0f766e', status: 'active', workingHours: [], breaks: [] }];
    if (name === 'listServices') return [];
    return undefined;
  },
  useConvex: () => ({}),
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: vi.fn() }),
}));

let root: Root;
const render = (node: ReactNode) => act(async () => root.render(
  createElement(TooltipProvider, null, createElement(ConfirmProvider, null, node)),
));
const submit = (form: HTMLFormElement) => act(async () => {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.save.mockClear();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('shows a villa price error for three decimals, then saves an exact two-decimal price', async () => {
  await render(createElement(AdminPropertyEditor, { propertyId: 'villa' }));
  const price = document.querySelector<HTMLInputElement>('#pr-price')!;
  expect(price.value).toBe('100.5');
  price.value = '100.505';
  await submit(price.form!);
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Enter a price with at most 2 decimals.');
  expect(state.save).not.toHaveBeenCalled();
  price.value = '100.51';
  await submit(price.form!);
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ propertyId: 'villa', pricePerNight: 10051 }));
});

it('shows a service price error for three decimals, then saves an exact two-decimal price', async () => {
  await render(createElement(AdminStaffServicesManager, { section: 'services' }));
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Add service')!.click());
  const price = document.querySelector<HTMLInputElement>('input[aria-label="Price for 60 min (THB)"]')!;
  const setValue = (input: HTMLInputElement, value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const setPrice = (value: string) => setValue(price, value);
  await setValue(document.querySelector<HTMLInputElement>('#sv-name')!, 'Massage');
  await setValue(document.querySelector<HTMLInputElement>('#sv-category')!, 'Wellness');
  await setPrice('100.505');
  await submit(price.form!);
  expect(document.getElementById(price.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a price with at most 2 decimals.');
  expect(state.save).not.toHaveBeenCalled();
  await setPrice('100.51');
  await submit(price.form!);
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Massage', category: 'Wellness', options: [{ durationMin: 60, price: 10051 }], defaultDurationMin: 60 }));
});
