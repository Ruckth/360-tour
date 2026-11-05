// @vitest-environment happy-dom
// The real shell with the phone tab bar and iPad rail; only auth, transport and router are mocked.
import type { Window as HappyDOMWindow } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminShell } from '@/components/admin/AdminShell';
import { ADMIN_NAV, ADMIN_TAB_BAR } from '@/components/admin/admin-routes';

const route = vi.hoisted(() => ({ pathname: '/admin/chats' }));
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
  useRouter: () => ({ push: vi.fn() }),
}));

let root: Root;
const initialViewport = { width: window.innerWidth, height: window.innerHeight };
const viewport = (width: number) => (window as unknown as HappyDOMWindow).happyDOM.setWindowSize({ width, height: 900 });
const render = () => act(async () => root.render(createElement(AdminShell, null, 'Page')));
const navs = () => [...document.querySelectorAll<HTMLElement>('nav[aria-label="Admin sections"]')];
const tabBar = () => navs().find((nav) => nav.className.includes('md:hidden'))!;
const rail = () => navs().find((nav) => nav.className.includes('xl:hidden') && !nav.className.includes('md:hidden'))!;
const tile = (nav: HTMLElement, text: string) =>
  [...nav.querySelectorAll<HTMLElement>('a, button')].find((el) => el.textContent?.trim() === text)!;
const drawer = () => document.querySelector('[role=dialog][data-mobile=true]');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  route.pathname = '/admin/chats';
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  (window as unknown as HappyDOMWindow).happyDOM.setWindowSize(initialViewport);
  vi.unstubAllGlobals();
});

it('puts the daily sections, Search and Menu on the phone tab bar, marking the current one', async () => {
  viewport(360);
  route.pathname = '/admin/hotel';
  await render();
  const labels = [...tabBar().children].map((el) => el.textContent?.trim());
  expect(labels).toEqual(['Chats', 'Hotel (Hotel bookings)', 'Spa (Staff bookings)', 'Search', 'Menu']);
  expect(ADMIN_TAB_BAR.map((item) => item.href)).toEqual(['/admin/chats', '/admin/hotel', '/admin/staff/calendar']);
  expect(tile(tabBar(), 'Hotel (Hotel bookings)').getAttribute('aria-current')).toBe('page');
  expect(tile(tabBar(), 'Chats').getAttribute('aria-current')).toBeNull();
});

it('marks Menu as the way back on sections that are not on the tab bar', async () => {
  viewport(360);
  route.pathname = '/admin/settings';
  await render();
  expect(tile(tabBar(), 'Menu').className).toContain('bg-sidebar-accent ');
  expect(tile(tabBar(), 'Chats').className).not.toContain('bg-sidebar-accent ');
});

it('opens the full sidebar from Menu, and from Search with its field focused', async () => {
  viewport(360);
  await render();
  await act(async () => tile(tabBar(), 'Menu').click());
  expect(drawer()).toBeTruthy();
  await act(async () => {
    [...drawer()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Close')!.click();
  });
  expect(drawer()).toBeNull();
  await act(async () => tile(tabBar(), 'Search').click());
  expect(drawer()).toBeTruthy();
  // The field is focused two animation frames after the drawer opens.
  await vi.waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Search admin pages'));
});

it('lists every section, in sidebar order, on the iPad rail', async () => {
  viewport(1180);
  route.pathname = '/admin/staff/roster';
  await render();
  const sections = [...rail().querySelectorAll('a')];
  expect(sections.map((a) => a.getAttribute('href'))).toEqual(ADMIN_NAV.map((item) => item.href));
  expect(sections.find((a) => a.getAttribute('aria-current') === 'page')?.textContent?.trim()).toBe('Spa (Staff bookings)');
});
