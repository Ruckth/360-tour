// @vitest-environment happy-dom
// Independent audit: real shell/sidebar, with only auth, transport and router boundaries mocked.
import { act, createElement, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminShell } from '@/components/admin/AdminShell';
import { CheckoutPhoto } from '@/components/checkout/CheckoutPhoto';
import { CheckoutBackendProvider } from '@/components/checkout/backend';
import { CheckoutView } from '@/components/checkout/CheckoutView';
import { createFixtureBackend } from '@/components/checkout/fixture-backend';

const route = vi.hoisted(() => ({ pathname: '/admin/checkout', push: vi.fn() }));
vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: {} }),
  UserButton: () => null,
  SignInButton: () => null,
}));
vi.mock('@/lib/react/convex', () => ({
  useOptionalConvex: () => ({}),
  useOptionalConvexAuth: () => ({ isAuthEnabled: true, isAuthenticated: true }),
}));
vi.mock('convex/react', () => ({ useQuery: () => ({ businessName: 'Audit resort' }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: route.push }),
}));

let root: Root;
const renderShell = () => act(async () => root.render(createElement(AdminShell, null, 'Audit content')));
const railState = () => document.querySelector('[data-collapsible]')?.getAttribute('data-state');
const key = (value: string) => act(async () => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: value, ctrlKey: true, bubbles: true, cancelable: true }));
});
const trigger = () => act(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Toggle Sidebar'))!.click();
});
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  route.pathname = '/admin/checkout';
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('keeps checkout and other-route sidebar choices independent through keyboard and trigger toggles', async () => {
  await renderShell();
  expect(railState()).toBe('collapsed');
  await key('b');
  expect(railState()).toBe('expanded');
  route.pathname = '/admin/bookings';
  await renderShell();
  expect(railState()).toBe('expanded');
  expect(document.querySelector('.checkout-theme')).toBeNull();
  await trigger();
  expect(railState()).toBe('collapsed');
  route.pathname = '/admin/checkout';
  await renderShell();
  expect(railState()).toBe('expanded');
  await trigger();
  await key('k');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
  expect(railState()).toBe('expanded');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Search admin pages');
  route.pathname = '/admin/bookings';
  await renderShell();
  expect(railState()).toBe('collapsed');
});

it('opens and closes the real mobile sidebar with the shell trigger', async () => {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  await renderShell();
  await trigger();
  expect(document.querySelector('[role=dialog][data-mobile=true]')).toBeTruthy();
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent?.trim() === 'Close')!.click();
  });
  expect(document.querySelector('[role=dialog][data-mobile=true]')).toBeNull();
});

it('recovers from a failed photo when its URL changes, and falls back when the URL is removed', async () => {
  const show = (src?: string) => act(async () => root.render(createElement(CheckoutPhoto, { src, kind: 'room' })));
  await show('/broken.jpg');
  await act(async () => document.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(document.querySelector('[data-photo-fallback]')).toBeTruthy();
  await show('/replacement.jpg');
  expect(document.querySelector('img')?.getAttribute('src')).toBe('/replacement.jpg');
  await show();
  expect(document.querySelector('img')).toBeNull();
  expect(document.querySelector('[data-photo-fallback]')).toBeTruthy();
});

it('enforces the new inline stepper bounds and keeps totals correct at 99 and one', async () => {
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const { orderId, lineId } = await actions.addItem({ item: { kind: 'extra', name: 'Bounded extra', price: 100 } });
  await actions.updateLine({ lineId, qtyChange: 98 });
  await act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>,
    createElement(CheckoutView, { orderId, onOrderChange: () => {}, onPaid: () => {} }))));
  const panel = () => document.querySelector('aside')!;
  expect(panel().querySelector('output')?.textContent).toBe('99');
  expect(panel().querySelector<HTMLButtonElement>('[aria-label="One more"]')?.disabled).toBe(true);
  expect(panel().querySelector('[data-testid=order-due]')?.textContent).toBe('฿9,900');
  await act(async () => {
    panel().querySelector<HTMLButtonElement>('[aria-label="One less"]')!.click();
    await new Promise(resolve => setTimeout(resolve, 200));
  });
  expect(panel().querySelector('output')?.textContent).toBe('98');
  await act(async () => { await actions.updateLine({ lineId, qtyChange: -97 }); });
  expect(panel().querySelector('output')?.textContent).toBe('1');
  expect(panel().querySelector<HTMLButtonElement>('[aria-label="One less"]')?.disabled).toBe(true);
  expect(panel().querySelector('[data-testid=order-due]')?.textContent).toBe('฿100');
});

// Retained acceptance regression for checkout theme boundaries.
it('keeps the mobile sidebar in checkout dark theme even when the app root is light', async () => {
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  document.documentElement.classList.remove('dark');
  await renderShell();
  await trigger();
  const panel = document.querySelector('[role=dialog][data-mobile=true]')!;
  expect(panel.closest('.checkout-theme.dark')).toBeTruthy();
  expect(panel.previousElementSibling?.closest('.checkout-theme.dark')).toBeTruthy();
});

it('themes the checkout Orders backdrop as well as its portaled content under a light app root', async () => {
  await act(async () => root.render(createElement(CheckoutBackendProvider, {
    backend: createFixtureBackend(),
  } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId: null, onOrderChange: () => {}, onPaid: () => {} }))));
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Orders')!.click());
  const content = document.querySelector('[role=dialog]')!;
  expect(content.closest('.checkout-theme.dark')).toBeTruthy();
  const overlay = content.previousElementSibling!;
  expect(overlay.className).toContain('backdrop-blur');
  expect(overlay.closest('.checkout-theme.dark')).toBeTruthy();
});


it('keeps ordinary mobile navigation and its backdrop in the selected app theme', async () => {
  route.pathname = '/admin/hotel';
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  document.documentElement.classList.remove('dark');
  await renderShell();
  await trigger();
  const panel = document.querySelector('[role=dialog][data-mobile=true]')!;
  expect(panel).toBeTruthy();
  expect(panel.closest('.checkout-theme')).toBeNull();
  expect(panel.previousElementSibling?.closest('.checkout-theme')).toBeNull();
});
