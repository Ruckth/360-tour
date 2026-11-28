// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import type { Id } from 'convex/_generated/dataModel';
import { listingHref, OtaRatesPanel } from '@/components/admin/OtaRatesDialog';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';

const state = vi.hoisted(() => ({ upsert: vi.fn(), remove: vi.fn() }));
const propertyId = 'villa1' as Id<'properties'>;
const rates = [
  { _id: 'r1', _creationTime: 0, propertyId, platform: 'booking_com', nightlyRate: 499000, url: 'https://www.booking.com/hotel/tideglass', updatedAt: Date.now() },
  { _id: 'r2', _creationTime: 0, propertyId, platform: 'agoda', nightlyRate: 510000, updatedAt: Date.now() },
];
vi.mock('convex/react', () => ({
  useMutation: (ref: FunctionReference<'mutation'>) => getFunctionName(ref).endsWith('upsertOtaRate') ? state.upsert : state.remove,
  useQuery: () => rates,
}));

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.upsert.mockReset().mockResolvedValue('r1');
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const render = () => act(async () => root.render(createElement(ConfirmProvider, null, createElement(OtaRatesPanel, { propertyId }))));
const input = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
async function type(id: string, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(id), value);
    input(id).dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
const submit = () => act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

it('F01: hydrates the selected platform from its saved row and a price-only save preserves the stored link', async () => {
  await render();
  expect(input('ota-rate').value).toBe('4990');
  expect(input('ota-url').value).toBe('https://www.booking.com/hotel/tideglass');
  await type('ota-rate', '5290');
  await submit();
  expect(state.upsert).toHaveBeenCalledWith({ propertyId, platform: 'booking_com', nightlyRate: 529000, urlChange: { kind: 'preserve' } });
});

it('F01: clearing a link takes an explicit action, and a new link is sent as set', async () => {
  await render();
  await click(button('Clear link'));
  expect(document.body.textContent).toContain('will be removed when you save');
  await submit();
  expect(state.upsert).toHaveBeenLastCalledWith({ propertyId, platform: 'booking_com', nightlyRate: 499000, urlChange: { kind: 'clear' } });
  await click(button('Edit'));
  await type('ota-url', 'https://www.booking.com/new');
  await submit();
  expect(state.upsert).toHaveBeenLastCalledWith({ propertyId, platform: 'booking_com', nightlyRate: 499000, urlChange: { kind: 'set', url: 'https://www.booking.com/new' } });
});

it('F01: a cancelled platform switch retains the draft', async () => {
  await render();
  await type('ota-rate', '5290');
  const agodaEdit = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Edit')[1]!;
  await click(agodaEdit);
  expect(document.body.textContent).toContain('Discard unsaved rate changes?');
  await click(button('Cancel'));
  expect(input('ota-rate').value).toBe('5290');
  await click(agodaEdit);
  await click(button('Discard changes'));
  expect(input('ota-rate').value).toBe('5100');
  expect(input('ota-url').value).toBe('');
});

it('F02: a saved http(s) link opens the listing in a new tab without leaving the dialog', async () => {
  await render();
  const link = document.querySelector<HTMLAnchorElement>('a[target="_blank"]')!;
  expect(link.textContent).toContain('Open listing');
  expect(link.href).toBe('https://www.booking.com/hotel/tideglass');
  expect(link.rel).toContain('noopener');
  expect(listingHref('javascript:alert(1)')).toBeNull();
  expect(listingHref('not a url')).toBeNull();
});
