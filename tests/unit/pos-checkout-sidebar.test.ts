// @vitest-environment happy-dom
// Real shell/sidebar, with only auth, transport and router boundaries mocked.
import type { Window as HappyDOMWindow } from 'happy-dom';
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
vi.mock('convex/react', async () => (await import('./admin-shell-convex')).shellConvex({ role: 'owner' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: route.push }),
}));

let root: Root;
const initialViewport = { width: window.innerWidth, height: window.innerHeight };
// Resize Happy DOM itself: overriding Vitest's window.innerWidth leaves matchMedia's window unchanged.
const viewport = (width: number) => (window as unknown as HappyDOMWindow).happyDOM.setWindowSize({ width, height: 900 });
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
  viewport(1440);
  document.documentElement.classList.remove('dark');
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  document.documentElement.classList.remove('dark');
  (window as unknown as HappyDOMWindow).happyDOM.setWindowSize(initialViewport);
  vi.unstubAllGlobals();
});

it('keeps checkout and other-route sidebar choices independent through keyboard and trigger toggles', async () => {
  await renderShell();
  expect(railState()).toBe('collapsed');
  // The checkout shell wears the app theme; it adds none of its own.
  expect(document.querySelector('.dark, .checkout-theme')).toBeNull();
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

it('keeps the checkout rail on its receipts, so paying does not expand the sidebar', async () => {
  await renderShell();
  expect(railState()).toBe('collapsed');
  route.pathname = '/admin/receipt/order123abc';
  await renderShell();
  expect(railState()).toBe('collapsed');
  await key('b');
  expect(railState()).toBe('expanded');
  route.pathname = '/admin/checkout';
  await renderShell();
  expect(railState()).toBe('expanded');
  // Other pages keep their own choice.
  route.pathname = '/admin/receipts-elsewhere';
  await renderShell();
  expect(railState()).toBe('expanded');
  await trigger();
  route.pathname = '/admin/receipt/order123abc';
  await renderShell();
  expect(railState()).toBe('expanded');
});

it('opens and closes the real mobile sidebar with the shell trigger', async () => {
  viewport(390);
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
  await act(async () => root.render(createElement(CheckoutBackendProvider, { backend, children: null } as ComponentProps<typeof CheckoutBackendProvider>,
    createElement(CheckoutView, { orderId, onOrderChange: () => {}, onPaid: () => {} }))));
  const panel = () => document.querySelector('aside')!;
  expect(panel().querySelector('output')?.textContent).toBe('99');
  expect(panel().querySelector<HTMLButtonElement>('[aria-label="One more"]')?.disabled).toBe(true);
  expect(panel().querySelector('[data-testid=order-due]')?.textContent).toBe('฿9,900');
  await act(async () => {
    panel().querySelector<HTMLButtonElement>('[aria-label="One less"]')!.click();
    // Wait for the queued write and re-render, not a fixed delay (the full suite runs under load).
    for (let waited = 0; waited < 3000 && panel().querySelector('output')?.textContent !== '98'; waited += 25) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  });
  expect(panel().querySelector('output')?.textContent).toBe('98');
  await act(async () => { await actions.updateLine({ lineId, qtyChange: -97 }); });
  expect(panel().querySelector('output')?.textContent).toBe('1');
  expect(panel().querySelector<HTMLButtonElement>('[aria-label="One less"]')?.disabled).toBe(true);
  expect(panel().querySelector('[data-testid=order-due]')?.textContent).toBe('฿100');
});

// Theme boundaries: checkout follows the app's light or dark theme (on <html>) like every other
// admin page, so its portaled layers can't drift from the page they open over.
const mobileSidebar = () => {
  const panel = document.querySelector('[role=dialog][data-mobile=true]')!;
  return { panel, overlay: panel.previousElementSibling! };
};

for (const theme of ['light', 'dark'] as const) {
  it(`${theme}: checkout's mobile sidebar and its backdrop take the app theme, exactly like other pages`, async () => {
    viewport(390);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const html = theme === 'dark' ? document.documentElement : null;
    const classesOn = async (pathname: string) => {
      route.pathname = pathname;
      await renderShell();
      await trigger();
      const { panel, overlay } = mobileSidebar();
      expect(panel.closest('.dark'), pathname).toBe(html);
      expect(overlay.closest('.dark'), pathname).toBe(html);
      expect(document.body.querySelector('.dark, .checkout-theme'), pathname).toBeNull();
      const classes = [panel.className, overlay.className];
      await act(async () => root.unmount());
      root = createRoot(document.body.appendChild(document.createElement('div')));
      return classes;
    };
    expect(await classesOn('/admin/checkout')).toEqual(await classesOn('/admin/hotel'));
  });

  it(`${theme}: the checkout Orders dialog and its blurred backdrop take the app theme`, async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    await act(async () => root.render(createElement(CheckoutBackendProvider, {
      backend: createFixtureBackend(), children: null,
    } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId: null, onOrderChange: () => {}, onPaid: () => {} }))));
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Orders')!.click());
    const content = document.querySelector('[role=dialog]')!;
    const overlay = content.previousElementSibling!;
    expect(overlay.className).toContain('backdrop-blur');
    const html = theme === 'dark' ? document.documentElement : null;
    expect(content.closest('.dark')).toBe(html);
    expect(overlay.closest('.dark')).toBe(html);
    expect(document.body.querySelector('.dark, .checkout-theme')).toBeNull();
  });
}
