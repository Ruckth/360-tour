// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminPropertyEditor } from '@/components/admin/AdminPropertyEditor';
import { AdminStaffServicesManager } from '@/components/admin/AdminStaffServicesManager';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import { TooltipProvider } from '@/components/ui/tooltip';

const state = vi.hoisted(() => ({ save: vi.fn<() => Promise<unknown>>(async () => undefined) }));
vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/admin/RecordHistoryPanel', () => ({
  RecordHistoryPanel: () => null, ConfigurationHistoryRecords: () => null,
  HistoryDisclosure: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('convex/react', () => ({
  useMutation: () => state.save,
  useAction: () => vi.fn(),
  useQuery: (ref: FunctionReference<'query'>, args?: { propertyId: string }) => {
    const name = getFunctionName(ref).split(':').pop();
    if (name === 'get') return {
      property: {
        _id: args?.propertyId, slug: args?.propertyId, name: 'Villa', status: 'active', tagline: '', description: '',
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
const setValue = (input: HTMLInputElement, value: string) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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

it('keeps unsaved villa details and web address across tabs and clears them for another villa', async () => {
  await render(createElement(AdminPropertyEditor, { propertyId: 'villa' }));
  const field = (id: string) => document.querySelector<HTMLInputElement>(id)!;
  await setValue(field('#pr-name'), 'Draft villa name');
  await setValue(field('#pr-slug'), 'draft-address');

  const photos = document.querySelector<HTMLButtonElement>('#villa-tab-photos')!;
  await act(async () => photos.click());
  await act(async () => photos.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(field('#pr-name').value).toBe('Draft villa name');
  expect(field('#pr-slug').value).toBe('draft-address');
  expect(state.save).not.toHaveBeenCalled();
  await submit(field('#pr-name').form!);
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ propertyId: 'villa', name: 'Draft villa name' }));

  await render(createElement(AdminPropertyEditor, { propertyId: 'another-villa' }));
  expect(field('#pr-name').value).toBe('Villa');
  expect(field('#pr-slug').value).toBe('another-villa');
});

it.each([
  ['#pr-name', 'Villa'],
  ['#pr-slug', 'villa'],
])('only shows Saved for the submitted value in %s', async (selector, initial) => {
  await render(createElement(AdminPropertyEditor, { propertyId: 'villa' }));
  const input = document.querySelector<HTMLInputElement>(selector)!;
  const form = input.form!;
  const status = () => form.querySelector('[role="status"]')?.textContent;

  state.save.mockResolvedValueOnce(initial);
  await submit(form);
  expect(status()).toBe('Saved');
  await setValue(input, 'first-draft');
  expect(status()).toBeUndefined();

  const pending = Promise.withResolvers<string>();
  state.save.mockReturnValueOnce(pending.promise);
  await submit(form);
  await setValue(input, 'newer-draft');
  await act(async () => pending.resolve('first-draft'));
  expect(input.value).toBe('newer-draft');
  expect(status()).toBeUndefined();
});

it('shows a service price error for three decimals, then saves an exact two-decimal price', async () => {
  await render(createElement(AdminStaffServicesManager, { section: 'services' }));
  await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Add service')!.click());
  const price = document.querySelector<HTMLInputElement>('input[aria-label="Price for 60 min (THB)"]')!;
  const setPrice = (value: string) => setValue(price, value);
  await setValue(document.querySelector<HTMLInputElement>('#sv-name')!, 'Massage');
  await setValue(document.querySelector<HTMLInputElement>('#sv-category')!, 'Wellness');
  await act(async () => document.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
  await setPrice('100.505');
  await submit(price.form!);
  expect(document.getElementById(price.getAttribute('aria-describedby')!)?.textContent).toBe('Enter a price with at most 2 decimals.');
  expect(state.save).not.toHaveBeenCalled();
  await setPrice('100.51');
  await submit(price.form!);
  expect(state.save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Massage', category: 'Wellness', options: [{ durationMin: 60, price: 10051 }], defaultDurationMin: 60 }));
});
