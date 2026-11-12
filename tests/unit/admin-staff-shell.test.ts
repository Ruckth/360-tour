// @vitest-environment happy-dom
// The real shell with staff access from staffAccess.myAccess; auth, transport and router are mocked.
import type { Window as HappyDOMWindow } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { AdminShell } from '@/components/admin/AdminShell';
import { staffAccessFor, type ShellRole } from './admin-shell-convex';

const state = vi.hoisted(() => ({
  pathname: '/admin/chats',
  tab: null as string | null,
  access: undefined as unknown,
  pending: 0,
  replace: vi.fn(),
  claim: vi.fn(async () => null),
}));
vi.mock('@clerk/nextjs', () => ({ useUser: () => ({ isLoaded: true, isSignedIn: true, user: {} }), UserButton: () => null, SignInButton: () => null }));
vi.mock('@/lib/react/convex', () => ({ useOptionalConvex: () => ({}), useOptionalConvexAuth: () => ({ isAuthEnabled: true, isAuthenticated: true }) }));
vi.mock('convex/react', () => ({
  useQuery: (ref: FunctionReference<'query'>, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = getFunctionName(ref);
    if (name === 'staffAccess:myAccess') return state.access;
    if (name === 'pos/staffApprovals:pending') return { count: state.pending, list: [] };
    return { businessName: 'Audit resort' };
  },
  useMutation: (ref: FunctionReference<'mutation'>) => (getFunctionName(ref) === 'staffAccess:claimInvite' ? state.claim : async () => null),
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: () => undefined }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.tab ? `tab=${state.tab}` : ''),
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
}));

let root: Root;
const initialViewport = { width: window.innerWidth, height: window.innerHeight };
const render = () => act(async () => root.render(createElement(AdminShell, null, createElement('p', { id: 'page' }, 'Page'))));
const as = (role: ShellRole) => { state.access = staffAccessFor(role); };
const sidebarLinks = () => [...document.querySelectorAll('[data-sidebar="sidebar"] a')].map((a) => a.textContent?.trim());
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(state, { pathname: '/admin/chats', tab: null, access: undefined, pending: 0 });
  state.replace.mockClear();
  state.claim.mockClear();
  // Wide enough for the full sidebar rather than the drawer.
  (window as unknown as HappyDOMWindow).happyDOM.setWindowSize({ width: 1440, height: 900 });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  (window as unknown as HappyDOMWindow).happyDOM.setWindowSize(initialViewport);
  vi.unstubAllGlobals();
});

it('waits for staff access before showing any page', async () => {
  await render();
  expect(document.getElementById('page')).toBeNull();
  expect(document.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Checking access');
});

it('sends a cashier from another admin page to checkout without rendering it', async () => {
  as('cashier');
  await render();
  expect(state.replace).toHaveBeenCalledWith('/admin/checkout');
  expect(document.getElementById('page')).toBeNull();
  expect(sidebarLinks()).toEqual(['Checkout']);
});

it('renders checkout for a cashier, with the Cashier badge in the header', async () => {
  as('cashier');
  state.pathname = '/admin/checkout';
  await render();
  expect(state.replace).not.toHaveBeenCalled();
  expect(document.getElementById('page')).not.toBeNull();
  expect(document.querySelector('header [data-testid="cashier-badge"]')?.textContent).toBe('Cashier');
});

it('sends a manager from Settings › Team to Settings, and badges Checkout with waiting approvals', async () => {
  as('manager');
  state.pending = 3;
  state.pathname = '/admin/settings';
  state.tab = 'team';
  await render();
  expect(state.replace).toHaveBeenCalledWith('/admin/settings');
  expect(document.querySelector('[data-sidebar="sidebar"] [data-approval-count]')?.textContent).toBe('3 approvals waiting');
});

it('shows owners the admin as before: every section, no badge or redirect', async () => {
  as('owner');
  await render();
  expect(state.replace).not.toHaveBeenCalled();
  expect(sidebarLinks()).toEqual(['Chats', 'Hotel bookings', 'Staff bookings', 'Checkout', 'Business facts', 'Properties', 'Leads', 'Marketing', 'Settings']);
  expect(document.querySelector('[data-approval-count]')).toBeNull();
});

it('keeps the existing experience for a signed-in person without a role', async () => {
  as(null);
  await render();
  expect(state.replace).not.toHaveBeenCalled();
  expect(document.getElementById('page')).not.toBeNull();
});

it('lets an invited person activate their access explicitly', async () => {
  state.access = { ...staffAccessFor(null, 'lek@example.com'), pendingInvitation: { role: 'cashier', expiresAt: Date.now() + 86_400_000 } };
  await render();
  expect(document.body.textContent).toContain('lek@example.com is invited as Cashier.');
  expect(document.getElementById('page')).toBeNull();
  await act(async () => button('Activate access')!.click());
  expect(state.claim).toHaveBeenCalledWith({});
});
