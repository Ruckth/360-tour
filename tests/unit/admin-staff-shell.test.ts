// @vitest-environment happy-dom
// The real shell with staff access from auth/staffAccess.myAccess; auth, transport and router are mocked.
import type { Window as HappyDOMWindow } from 'happy-dom';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { AdminShell } from '@/components/admin/AdminShell';
import { branchStorageKeys } from '@/components/admin/branch/branch-selection';
import { StockSectionShell } from '@/components/stock/StockSectionNav';
import { KOH_SAMUI, PHUKET, staffAccessFor, type ShellRole } from './admin-shell-convex';

const state = vi.hoisted(() => ({
  pathname: '/admin/chats',
  tab: null as string | null,
  access: undefined as unknown,
  pending: 0,
  stale: false,
  approvalsUnavailable: false,
  replace: vi.fn(),
  claim: vi.fn(async () => null),
  claimMarketing: vi.fn(async () => null),
}));
vi.mock('@/platform/auth', () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: {} }),
  UserButton: () => null,
  SignInButton: () => null,
  SignOutButton: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (ref: FunctionReference<'query'>, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = getFunctionName(ref);
    if (name === 'auth/staffAccess:myAccess') return state.access;
    return { businessName: 'Audit resort' };
  }, useMutation: (ref: FunctionReference<'mutation'>) => (getFunctionName(ref) === 'auth/staffAccess:claimInvite' ? state.claim : getFunctionName(ref) === 'marketing/access:claimInvite' ? state.claimMarketing : async () => null), usePaginatedQuery: (ref: FunctionReference<'query'>, args: unknown) => {
    if (state.approvalsUnavailable && args !== 'skip' && getFunctionName(ref) === 'pos/staffApprovals:pendingPage') throw new Error('Approval queue offline');
    const pending = args !== 'skip' && getFunctionName(ref) === 'pos/staffApprovals:pendingPage' ? state.pending : 0;
    const now = Date.now();
    const stale = pending > 0 && state.stale;
    const results = Array.from({ length: pending + (stale ? 2 : 0) }, (_, i) => ({
      _id: `appr${i}`,
      kind: 'discount',
      requesterEmail: 'mint@example.com',
      createdAt: now - 120_000,
      expiresAt: now + (stale && i === pending ? -60_000 : 60_000),
      status: 'pending',
      label: 'discount',
      summary: { amount: 100 },
    }));
    return { results, status: 'Exhausted', loadMore: () => undefined };
  }, useQueries: (queries: Record<string, unknown>) => Object.fromEntries(
    Object.keys(queries).map((id) => [id, state.stale && id === `appr${state.pending + 1}` ? 'revoked' : 'pending']),
  ) }));
vi.mock('@/platform/navigation', () => ({
  usePathname: () => state.pathname,
  useSelectedLayoutSegment: () => state.pathname.split('/')[3],
  useSearchParams: () => new URLSearchParams(state.tab ? `tab=${state.tab}` : ''),
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
}));

let root: Root;
const initialViewport = { width: window.innerWidth, height: window.innerHeight };
const render = () => act(async () => root.render(createElement(AdminShell, null, createElement('p', { id: 'page' }, 'Page'))));
const as = (role: ShellRole) => { state.access = staffAccessFor(role); };
const sidebarLinks = () => [...document.querySelectorAll('[data-sidebar="sidebar"] a')].map((a) => a.textContent?.trim());
const navs = () => document.querySelectorAll('nav[aria-label="Admin sections"], [data-sidebar="sidebar"]');
const approvals = () => document.querySelector('header [data-testid="approvals-button"]');
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(state, { pathname: '/admin/chats', tab: null, access: undefined, pending: 0, stale: false, approvalsUnavailable: false });
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
});

it('gives a cashier the till alone: no navigation or approvals, Sign out in the header', async () => {
  as('cashier');
  state.pathname = '/admin/checkout';
  await render();
  expect(state.replace).not.toHaveBeenCalled();
  expect(document.getElementById('page')).not.toBeNull();
  expect(document.querySelector('header [data-testid="cashier-badge"]')?.textContent).toBe('Cashier');
  expect(navs()).toHaveLength(0);
  expect(approvals()).toBeNull();
  expect(document.querySelector('header')?.textContent).toContain('Sign out');
  expect(document.querySelector('header')?.textContent).not.toContain('Concierge operations');
});

it('sends a manager from Settings › Team to Settings, with Approvals and the count in the header', async () => {
  as('manager');
  state.pending = 3;
  state.stale = true;
  state.pathname = '/admin/settings';
  state.tab = 'team';
  await render();
  expect(state.replace).toHaveBeenCalledWith('/admin/settings');
  expect(approvals()?.textContent).toBe('Approvals3 waiting');
  // The nav badge is gone.
  expect(document.querySelector('[data-sidebar="sidebar"] [data-approval-count]')).toBeNull();
  expect(document.querySelector('header')?.textContent).not.toContain('Sign out');
});

it('opens Settings › Branches to owners only: a manager is sent to Settings', async () => {
  state.pathname = '/admin/settings';
  state.tab = 'branches';
  as('manager');
  await render();
  expect(state.replace).toHaveBeenCalledWith('/admin/settings');
  expect(document.getElementById('page')).toBeNull();
  state.replace.mockClear();
  as('owner');
  await render();
  expect(state.replace).not.toHaveBeenCalled();
  expect(document.getElementById('page')).not.toBeNull();
});

it('shows a manager Approvals on every page, not only checkout', async () => {
  as('manager');
  for (const path of ['/admin/chats', '/admin/hotel', '/admin/questions']) {
    state.pathname = path;
    await render();
    expect(approvals(), path).not.toBeNull();
  }
});

it('shows owners every section and Approvals without a count when nothing waits', async () => {
  as('owner');
  await render();
  expect(state.replace).not.toHaveBeenCalled();
  expect(sidebarLinks()).toEqual(['Today', 'Chats', 'Hotel bookings', 'Staff bookings', 'Checkout', 'Stock', 'Business facts', 'Properties', 'Leads', 'Marketing', 'Settings']);
  expect(approvals()?.textContent).toBe('Approvals');
  expect(document.querySelector('[data-approval-count]')).toBeNull();
});

it('shows a signed-in person without a role "No access" with Sign out, never the owner navigation', async () => {
  as(null);
  await render();
  expect(state.replace).not.toHaveBeenCalled();
  expect(document.getElementById('page')).toBeNull();
  expect(navs()).toHaveLength(0);
  expect(document.querySelector('h1')?.textContent).toBe('No access');
  expect(button('Sign out')).toBeDefined();
});

it('says access changed when a member is removed mid-session', async () => {
  state.access = staffAccessFor('manager', 'lek@example.com');
  await render();
  expect(document.getElementById('page')).not.toBeNull();
  state.access = staffAccessFor(null, 'lek@example.com');
  await render();
  expect(document.getElementById('page')).toBeNull();
  expect(document.querySelector('h1')?.textContent).toBe('Your access has changed');
  expect(document.body.textContent).toContain('lek@example.com no longer has admin access.');
});

it('lets an invited person activate their access explicitly', async () => {
  state.access = { ...staffAccessFor(null, 'lek@example.com'), pendingInvitation: { role: 'cashier', expiresAt: Date.now() + 86_400_000, branchIds: [KOH_SAMUI.id], branches: [KOH_SAMUI] } };
  await render();
  expect(document.body.textContent).toContain('lek@example.com is invited as Cashier at Koh Samui.');
  expect(document.getElementById('page')).toBeNull();
  await act(async () => button('Activate access')!.click());
  expect(state.claim).toHaveBeenCalledWith({});
});

it('lets a Marketing-only invitee claim from the admin shell before any page mounts', async () => {
  const base = staffAccessFor(null, 'market@example.com');
  state.access = { ...base, marketingInvitation: { role: 'viewer', expiresAt: Date.now() + 60_000 } };
  state.pathname = '/admin/marketing';
  await render();
  expect(document.getElementById('page')).toBeNull();
  await act(async () => button('Activate Marketing access')!.click());
  expect(state.claimMarketing).toHaveBeenCalledWith({});
  state.access = { ...base, marketingRole: 'viewer', capabilities: { ...base.capabilities, marketing: true } };
  await render();
  expect(document.getElementById('page')).not.toBeNull();
});

it('offers the pending owner invitation to an existing desk member', async () => {
  state.access = { ...staffAccessFor('cashier'), pendingInvitation: { role: 'owner', expiresAt: null, branchIds: [], branches: [] } };
  await render();
  expect(document.body.textContent).toContain('is invited as Owner.');
  expect(document.getElementById('page')).toBeNull();
  await act(async () => button('Activate access')!.click());
  expect(state.claim).toHaveBeenCalledWith({});
});

it('keeps a pending Marketing invite reachable after a desk invite is claimed', async () => {
  state.access = { ...staffAccessFor('manager'), marketingInvitation: { role: 'viewer', expiresAt: Date.now() + 60_000 } };
  await render();
  expect(document.getElementById('page')).not.toBeNull();
  expect(document.querySelector('a[href="/admin/marketing"]')?.textContent).toBe('Review invitation');
});

it('recovers a first Stock bookmark in place with an assigned branch', async () => {
  state.pathname = '/admin/stock/balances';
  state.access = staffAccessFor('manager', 'first-stock@example.com', [KOH_SAMUI, PHUKET]);
  await act(async () => root.render(createElement(AdminShell, null,
    createElement(StockSectionShell, null, 'Branch stock balances'))));
  const prompt = document.querySelector('section[aria-labelledby="stock-choose-branch"]')!;
  expect(prompt.textContent).toContain('Select a working branch');
  expect(document.body.textContent).not.toContain('Branch stock balances');
  const choice = [...prompt.querySelectorAll('button')].find(option => option.textContent?.includes('Koh Samui'))!;
  await act(async () => choice.click());
  expect(document.body.textContent).toContain('Branch stock balances');
  expect(state.replace).not.toHaveBeenCalled();
});

it('keeps the phone branch switcher available during an approvals failure and restores the queue count on retry', async () => {
  (window as unknown as HappyDOMWindow).happyDOM.setWindowSize({ width: 390, height: 844 });
  state.pathname = '/admin/stock/balances';
  const email = 'queue-retry@example.com';
  state.access = staffAccessFor('manager', email, [KOH_SAMUI, PHUKET]);
  window.sessionStorage.setItem(branchStorageKeys(email).session, KOH_SAMUI.id);
  state.approvalsUnavailable = true;
  // React logs errors caught by the boundary in the test renderer.
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await render();
    const trigger = document.querySelector<HTMLButtonElement>('header [aria-label="Approvals unavailable"]')!;
    expect(trigger).toBeTruthy();
    expect(document.querySelector('header [data-branch-switcher]')?.textContent).toContain('Koh Samui');
    expect(button('Try again')).toBeUndefined();
    await act(async () => trigger.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('could not be loaded');
    state.pending = 2;
    state.approvalsUnavailable = false;
    await act(async () => button('Try again')!.click());
    expect(approvals()?.textContent).toBe('Approvals2 waiting');
  } finally {
    logged.mockRestore();
  }
});
