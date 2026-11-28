// @vitest-environment happy-dom
// The real admin shell's working branch: switcher, first-landing chooser, dirty confirm, revocation
// and the branch-denied card. Auth, transport and router are mocked.
import type { Window as HappyDOMWindow } from 'happy-dom';
import { act, createElement, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { AdminShell } from '@/components/admin/AdminShell';
import { useAdminBranch } from '@/components/admin/branch/branch-context';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { useUnsavedChangesGuard } from '@/lib/react/use-unsaved-changes';
import { AdminViewErrorCard } from '@/start-app/admin/AdminBoundaries';
import { KOH_SAMUI, PHUKET, staffAccessFor } from './admin-shell-convex';

const EMAIL = 'niran@example.com';
const state = vi.hoisted(() => ({ pathname: '/admin/stock/balances', search: '', access: undefined as unknown, dirty: false, legacyDirty: false, replace: vi.fn() }));
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
    return getFunctionName(ref) === 'auth/staffAccess:myAccess' ? state.access : { businessName: 'Audit resort' };
  },
  useMutation: () => async () => null,
  usePaginatedQuery: () => ({ results: [], status: 'Exhausted', loadMore: () => undefined }),
  useQueries: () => ({}),
}));
vi.mock('@/platform/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(state.search),
  useRouter: () => ({ push: vi.fn(), replace: state.replace }),
}));
vi.mock('@/platform/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: ReactNode }) => createElement('a', { href, ...rest }, children),
}));

/** The page: shows the working branch and a counter that a remount resets. */
let mounts = 0;
function Page() {
  const { current, scope } = useAdminBranch();
  const [mount] = useState(() => ++mounts);
  useUnsavedGuard(state.dirty);
  useUnsavedChangesGuard(state.legacyDirty);
  return createElement('p', { id: 'page', 'data-mount': mount, 'data-scope': scope }, current?.name ?? 'none');
}

let root: Root;
const render = () => act(async () => root.render(createElement(AdminShell, null, createElement(Page))));
const manager = (branches = [KOH_SAMUI, PHUKET]) => { state.access = staffAccessFor('manager', EMAIL, branches); };
const page = () => document.getElementById('page');
const buttons = () => [...document.querySelectorAll('button')];
const button = (text: string) => buttons().find((b) => b.textContent?.trim() === text);
const click = (element: Element | undefined | null) => act(async () => (element as HTMLElement).click());
const sidebar = () => document.querySelector('[data-sidebar="sidebar"]');
const headerPill = () => document.querySelector('header [data-branch-switcher]');
/** The bottom sheet's branch rows (the header pill opens it). */
const sheetRow = (name: string) => [...document.querySelectorAll('[role="dialog"] [role="group"] button')].find((b) => b.textContent?.includes(name));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(state, { pathname: '/admin/stock/balances', search: '', access: undefined, dirty: false, legacyDirty: false });
  state.replace.mockClear();
  mounts = 0;
  sessionStorage.clear();
  localStorage.clear();
  (window as unknown as HappyDOMWindow).happyDOM.setWindowSize({ width: 1440, height: 900 });
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('branch switcher', () => {
  it('shows single-branch staff the branch as static text, with no control', async () => {
    manager([KOH_SAMUI]);
    await render();
    expect(page()?.textContent).toBe('Koh Samui');
    expect(sidebar()?.querySelector('[data-branch-static]')?.textContent).toBe('BranchKoh Samui');
    expect(document.querySelector('[data-branch-switcher]')).toBeNull();
    expect(document.querySelector('header [data-branch-pill]')?.textContent).toBe('Branch: Koh Samui');
    expect(document.body.textContent).not.toContain('Choose a branch');
  });

  it('gives two-branch staff a switcher in the sidebar and the header, listing each branch with its state', async () => {
    manager();
    localStorage.setItem(`admin:last-branch:${EMAIL}`, KOH_SAMUI.id);
    await render();
    const trigger = sidebar()?.querySelector('[data-branch-switcher]');
    expect(trigger?.textContent).toBe('BranchKoh Samui');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    await click(headerPill());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Switch branch');
    expect(sheetRow('Koh Samui')?.getAttribute('aria-current')).toBe('true');
    expect(sheetRow('Phuket')?.textContent).toBe('PhuketSetup · hidden from guests');
    expect(sheetRow('Phuket')?.hasAttribute('aria-current')).toBe(false);

    await click(sheetRow('Phuket'));
    expect(page()?.textContent).toBe('Phuket');
    // The page remounted, so its filters, selection and search start fresh.
    expect(page()?.dataset.mount).toBe('2');
    expect(sessionStorage.getItem(`admin:branch:${EMAIL}`)).toBe(PHUKET.id);
    expect(localStorage.getItem(`admin:last-branch:${EMAIL}`)).toBe(PHUKET.id);
    expect(headerPill()?.textContent).toBe('Branch: Phuket, Setup · hidden from guests');
    // Nothing in the URL belonged to the old branch, so it stays.
    expect(state.replace).not.toHaveBeenCalled();
  });

  it('drops the old branch’s URL state (open appointment, date and staff) on a switch, keeping the remount', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    state.pathname = '/admin/staff/calendar';
    state.search = 'appointment=appt1&date=2026-12-02&staff=staff1';
    await render();
    await click(headerPill());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Switching closes the open record and clears filters, search and selection.');
    await click(sheetRow('Phuket'));
    expect(state.replace).toHaveBeenCalledWith('/admin/staff/calendar');
    expect(page()?.textContent).toBe('Phuket');
    expect(page()?.dataset.mount).toBe('2');
  });

  describe('return after a switch (D04)', () => {
    async function switchFromOpenAppointment() {
      manager();
      sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
      state.pathname = '/admin/staff/calendar';
      state.search = 'appointment=appt1&date=2026-12-02&staff=staff1';
      await render();
      await click(headerPill());
      await click(sheetRow('Phuket'));
      state.search = '';
      state.replace.mockClear();
      await render();
    }

    it('offers one action that restores the previous branch and the record it had open', async () => {
      await switchFromOpenAppointment();
      expect(page()?.textContent).toBe('Phuket');
      await click(button('Back to Koh Samui'));
      // The date and staff filters are discarded; the appointment route resolves the record again.
      expect(state.replace).toHaveBeenLastCalledWith('/admin/staff/calendar?appointment=appt1');
      expect(page()?.textContent).toBe('Koh Samui');
      expect(button('Back to Koh Samui')).toBeUndefined();
    });

    it('keeps the normal unsaved-changes guard on the way back', async () => {
      await switchFromOpenAppointment();
      state.dirty = true;
      await render();
      await click(button('Back to Koh Samui'));
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Discard unsaved changes and switch to Koh Samui?');
      await click(button('Stay here'));
      expect(page()?.textContent).toBe('Phuket');
      expect(state.replace).not.toHaveBeenCalledWith('/admin/staff/calendar?appointment=appt1');
    });

    it('discards the return when access ends, even if the branch is granted again', async () => {
      await switchFromOpenAppointment();
      manager([PHUKET]);
      await render();
      expect(button('Back to Koh Samui')).toBeUndefined();
      manager();
      await render();
      expect(button('Back to Koh Samui')).toBeUndefined();
    });

    it('discards the return after leaving the landing page and revisiting it', async () => {
      await switchFromOpenAppointment();
      expect(button('Back to Koh Samui')).toBeDefined();
      state.pathname = '/admin/stock/balances';
      await render();
      expect(button('Back to Koh Samui')).toBeUndefined();
      state.pathname = '/admin/staff/calendar';
      await render();
      expect(button('Back to Koh Samui')).toBeUndefined();
    });

    it('is not offered when the switch closed nothing', async () => {
      manager();
      sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
      state.pathname = '/admin/stock/balances';
      await render();
      await click(headerPill());
      await click(sheetRow('Phuket'));
      expect(button('Back to Koh Samui')).toBeUndefined();
    });
  });

  it('returns from the property editor to the list on a manual switch', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    state.pathname = '/admin/properties/villa-1';
    await render();
    await click(headerPill());
    await click(sheetRow('Phuket'));
    expect(state.replace).toHaveBeenCalledExactlyOnceWith('/admin/properties');
    expect(page()?.textContent).toBe('Phuket');

    // The notice survives the legitimate record-to-list route change.
    state.pathname = '/admin/properties';
    await render();
    await click(button('Back to Koh Samui'));
    expect(state.replace).toHaveBeenLastCalledWith('/admin/properties/villa-1');
    expect(page()?.textContent).toBe('Koh Samui');
  });

  it('shows the header pill at xl once the sidebar is collapsed', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    await render();
    expect(headerPill()?.className).toContain('xl:hidden');
    await click(document.querySelector('header [data-sidebar="trigger"]'));
    expect(sidebar()?.closest('[data-state]')?.getAttribute('data-state')).toBe('collapsed');
    expect(headerPill()?.className).not.toContain('xl:hidden');
  });

  it('closes the phone/tablet drawer after switching from its switcher', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    (window as unknown as HappyDOMWindow).happyDOM.setWindowSize({ width: 1000, height: 800 });
    await render();
    await click(buttons().find((b) => b.textContent?.trim() === 'Menu'));
    const drawer = () => document.querySelector('[data-mobile="true"]');
    expect(drawer()).not.toBeNull();
    await click(drawer()?.querySelector('[data-branch-switcher]'));
    await click(sheetRow('Phuket'));
    expect(page()?.textContent).toBe('Phuket');
    expect(drawer()).toBeNull();
  });

  it('ends the switcher with Manage branches for owners only', async () => {
    state.access = staffAccessFor('owner', EMAIL, [KOH_SAMUI, PHUKET]);
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    await render();
    await click(sidebar()?.querySelector('[data-branch-switcher]'));
    const manage = [...document.querySelectorAll('[role="menu"] a')].find((a) => a.textContent === 'Manage branches');
    expect(manage?.getAttribute('href')).toBe('/admin/settings?tab=branches');
    await click(headerPill());
    expect([...document.querySelectorAll('[role="dialog"] a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['Manage branches', '/admin/settings?tab=branches']]);

    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement('div')));
    manager();
    await render();
    await click(sidebar()?.querySelector('[data-branch-switcher]'));
    expect(document.body.textContent).not.toContain('Manage branches');
  });

  it('switches from the desktop sidebar popover', async () => {
    manager();
    localStorage.setItem(`admin:last-branch:${EMAIL}`, KOH_SAMUI.id);
    await render();
    await click(sidebar()?.querySelector('[data-branch-switcher]'));
    const items = [...document.querySelectorAll('[role="menuitemradio"]')];
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([['Koh Samui', 'true'], ['PhuketSetup · hidden from guests', 'false']]);
    await click(items[1]);
    expect(page()?.textContent).toBe('Phuket');
  });

  it('shows no branch control on checkout and receipts, which still sell for the till', async () => {
    manager();
    for (const path of ['/admin/checkout', '/admin/receipt/order123']) {
      state.pathname = path;
      await render();
      expect(page()?.textContent, path).toBe('Koh Samui');
      expect(document.querySelector('[data-branch-switcher]'), path).toBeNull();
      expect(document.querySelector('[data-branch-pill]'), path).toBeNull();
      expect(document.querySelector('[data-branch-static]'), path).toBeNull();
    }
    // Nothing was chosen there, so the first list route still asks.
    expect(localStorage.getItem(`admin:last-branch:${EMAIL}`)).toBeNull();
  });
});

describe('unsaved changes', () => {
  it('asks before switching, naming the target branch: Stay here keeps everything', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    state.dirty = true;
    await render();
    await click(headerPill());
    await click(sheetRow('Phuket'));
    const confirm = document.querySelector('[role="alertdialog"]');
    expect(confirm?.textContent).toContain('Discard unsaved changes and switch to Phuket?');
    expect(confirm?.textContent).toContain('Your changes for Koh Samui haven’t been saved.');
    await click(button('Stay here'));
    expect(page()?.textContent).toBe('Koh Samui');
    expect(page()?.dataset.mount).toBe('1');
    expect(sessionStorage.getItem(`admin:branch:${EMAIL}`)).toBe(KOH_SAMUI.id);
  });

  it('switches after Discard and switch', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    state.dirty = true;
    await render();
    await click(headerPill());
    await click(sheetRow('Phuket'));
    state.dirty = false;
    await click(button('Discard and switch'));
    expect(page()?.textContent).toBe('Phuket');
  });

  it('rejects a pending switch when the target assignment was removed during confirmation', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    state.dirty = true;
    state.pathname = '/admin/staff/calendar';
    state.search = 'appointment=appt1';
    await render();
    await click(headerPill());
    await click(sheetRow('Phuket'));
    manager([KOH_SAMUI]);
    await render();
    await click(button('Discard and switch'));
    expect(page()?.textContent).toBe('Koh Samui');
    expect(page()?.dataset.mount).toBe('1');
    expect(state.replace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(`admin:branch:${EMAIL}`)).toBe(KOH_SAMUI.id);
    expect(localStorage.getItem(`admin:last-branch:${EMAIL}`)).toBeNull();
  });

  it('asks through the older useUnsavedChangesGuard path too', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, KOH_SAMUI.id);
    state.legacyDirty = true;
    await render();
    await click(headerPill());
    await click(sheetRow('Phuket'));
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Discard unsaved changes and switch to Phuket?');
    await click(button('Stay here'));
    expect(page()?.textContent).toBe('Koh Samui');
  });
});

describe('first landing', () => {
  it('asks a first-time two-branch person to choose once, then restores the choice on this device', async () => {
    manager();
    await render();
    expect(page()).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Choose a branch to start');
    expect(document.body.textContent).toContain(`Signed in as ${EMAIL}. We remember your choice on this device only.`);
    expect(document.body.textContent).toContain('Setup · hidden from guests');
    await click(buttons().find((b) => b.textContent?.startsWith('Phuket')));
    expect(page()?.textContent).toBe('Phuket');

    // A new tab: no session choice, the device remembers Phuket.
    await act(async () => root.unmount());
    sessionStorage.clear();
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await render();
    expect(page()?.textContent).toBe('Phuket');
    expect(document.body.textContent).not.toContain('Choose a branch');
  });

  it('never asks on company routes: Settings and Marketing show Company', async () => {
    state.access = staffAccessFor('owner', EMAIL, [KOH_SAMUI, PHUKET]);
    for (const path of ['/admin/settings', '/admin/marketing/dashboard']) {
      state.pathname = path;
      await render();
      expect(page()?.dataset.scope, path).toBe('company');
      expect(document.body.textContent, path).not.toContain('Choose a branch');
      expect(sidebar()?.querySelector('[data-branch-static]')?.textContent, path).toBe('BranchCompany');
      expect(sidebar()?.querySelector('[data-branch-static] svg.lucide-building-2'), path).not.toBeNull();
      expect(document.querySelector('header [data-branch-pill]')?.textContent, path).toBe('Branch: Company');
      expect(document.querySelector('[data-branch-switcher]'), path).toBeNull();
    }
    // A branch route still asks.
    state.pathname = '/admin/stock/balances';
    await render();
    expect(document.querySelector('h1')?.textContent).toBe('Choose a branch to start');
  });

  it.each([
    ['/admin/chats', 'session=chat1'],
    ['/admin/hotel', 'booking=stay1'],
  ])('opens the resort desk at %s without choosing a working branch', async (pathname, search) => {
    manager();
    Object.assign(state, { pathname, search });
    await render();
    expect(page()?.dataset.scope).toBe('resort');
    expect(document.body.textContent).not.toContain('Choose a branch');
    expect(document.querySelector('[data-branch-switcher]')).toBeNull();
    expect(state.replace).not.toHaveBeenCalled();
    expect(localStorage.getItem(`admin:last-branch:${EMAIL}`)).toBeNull();
  });

  it('asks again when the stored branch is no longer assigned', async () => {
    manager();
    localStorage.setItem(`admin:last-branch:${EMAIL}`, 'branch_chiang_mai');
    await render();
    expect(page()).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Choose a branch to start');
  });
});

describe('access changes', () => {
  it('moves to the remaining branch and says so when a branch is removed mid-session', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, PHUKET.id);
    await render();
    expect(page()?.textContent).toBe('Phuket');
    manager([KOH_SAMUI]);
    await render();
    expect(page()?.textContent).toBe('Koh Samui');
    const banner = [...document.querySelectorAll('[role="status"]')].find((node) => node.textContent?.includes('Your access'));
    expect(banner?.textContent).toContain('Your access to Phuket ended.');
    expect(banner?.textContent).toContain('You’re now working in Koh Samui.');
    // Nothing was being edited, so nothing was discarded.
    expect(banner?.textContent).not.toContain('Unsaved changes');
    expect(document.querySelector('[data-branch-switcher]')).toBeNull();
    await click(button('Dismiss'));
    expect(document.body.textContent).not.toContain('Your access to Phuket ended.');
  });

  it('says unsaved changes were discarded only when a form was dirty, and drops the old URL state', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, PHUKET.id);
    state.dirty = true;
    state.pathname = '/admin/staff/calendar';
    state.search = 'appointment=appt1';
    await render();
    manager([KOH_SAMUI]);
    await render();
    const banner = [...document.querySelectorAll('[role="status"]')].find((node) => node.textContent?.includes('Your access'));
    expect(banner?.textContent).toContain('Unsaved changes for Phuket were discarded.');
    expect(state.replace).toHaveBeenCalledWith('/admin/staff/calendar');
  });

  it('drops the property record URL when its working branch is revoked', async () => {
    manager();
    sessionStorage.setItem(`admin:branch:${EMAIL}`, PHUKET.id);
    state.pathname = '/admin/properties/villa-1';
    state.search = 'q=villa';
    await render();
    manager([KOH_SAMUI]);
    await render();
    expect(state.replace).toHaveBeenCalledExactlyOnceWith('/admin/properties');
    expect(page()?.textContent).toBe('Koh Samui');
  });

  it.each([
    ['/admin/settings', 'tab=email&draft=1'],
    ['/admin/marketing/coupons/coupon-1', 'draft=1'],
    ['/admin/checkout', 'order=order-1'],
    ['/admin/receipt/order-1', 'print=1'],
    ['/admin/chats', 'session=chat1'],
    ['/admin/hotel', 'booking=stay1'],
  ])('preserves a surviving draft and URL on %s', async (pathname, search) => {
    state.access = staffAccessFor('owner', EMAIL, [KOH_SAMUI, PHUKET]);
    sessionStorage.setItem(`admin:branch:${EMAIL}`, PHUKET.id);
    Object.assign(state, { pathname, search, dirty: true });
    await render();
    state.access = staffAccessFor('owner', EMAIL, [KOH_SAMUI]);
    await render();
    expect(page()?.dataset.mount).toBe('1');
    expect(state.replace).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Your access to Phuket ended.');
    expect(document.body.textContent).not.toContain('Unsaved changes');
  });

  it.each(['/admin/properties/villa-1', '/admin/marketing/coupons/coupon-1'])(
    'announces loss of the last desk assignment while preserving Marketing from %s',
    async (pathname) => {
      const marketing = { marketingRole: 'admin' as const };
      const desk = staffAccessFor('manager', EMAIL, [KOH_SAMUI]);
      state.access = { ...desk, ...marketing, capabilities: { ...desk.capabilities, marketing: true } };
      Object.assign(state, { pathname, search: 'draft=1', dirty: true });
      await render();
      const none = staffAccessFor(null, EMAIL);
      state.access = { ...none, ...marketing, capabilities: { ...none.capabilities, marketing: true } };
      await render();

      if (pathname.startsWith('/admin/properties')) {
        expect(state.replace).toHaveBeenCalledExactlyOnceWith('/admin/marketing/dashboard');
        state.pathname = '/admin/marketing/dashboard';
        state.search = '';
        await render();
      } else {
        expect(state.replace).not.toHaveBeenCalled();
        expect(page()?.dataset.mount).toBe('1');
      }
      expect(page()?.dataset.scope).toBe('company');
      const status = [...document.querySelectorAll('[role="status"]')].find((node) => node.textContent?.includes('Your access'));
      expect(status?.textContent).toContain('Your access to Koh Samui ended.');
      expect(status?.textContent?.includes('Unsaved changes')).toBe(pathname.startsWith('/admin/properties'));
      expect(sidebar()?.textContent).toContain('Marketing');
    },
  );

  it('forgets the working branch when none is left, so a later return is not read as a removal', async () => {
    state.access = staffAccessFor('owner', EMAIL, [KOH_SAMUI, PHUKET]);
    sessionStorage.setItem(`admin:branch:${EMAIL}`, PHUKET.id);
    await render();
    expect(page()?.textContent).toBe('Phuket');
    state.access = staffAccessFor('owner', EMAIL, []);
    await render();
    expect(page()?.textContent).toBe('none');
    state.access = staffAccessFor('owner', EMAIL, [KOH_SAMUI]);
    await render();
    expect(page()?.textContent).toBe('Koh Samui');
    expect(document.body.textContent).not.toContain('Your access to');
  });

  it('gives a marketing-only person Marketing with the Company label, not the owner navigation', async () => {
    const none = staffAccessFor(null, 'dao@example.com');
    state.access = { ...none, marketingRole: 'admin', capabilities: { ...none.capabilities, marketing: true } };
    state.pathname = '/admin/marketing/dashboard';
    await render();
    expect(page()?.textContent).toBe('none');
    expect([...sidebar()!.querySelectorAll('a')].map((a) => a.textContent?.trim())).toContain('Marketing');
    expect([...sidebar()!.querySelectorAll('a')].map((a) => a.textContent?.trim())).not.toContain('Chats');
    expect(sidebar()?.querySelector('[data-branch-static]')?.textContent).toBe('BranchCompany');
    expect(document.querySelector('header [data-branch-pill]')?.textContent).toBe('Branch: Company');
    expect(document.body.textContent).not.toContain('Choose a branch');
  });

  it('shows "Your access has changed" when the last branch goes', async () => {
    manager([KOH_SAMUI]);
    await render();
    state.access = staffAccessFor(null, EMAIL);
    await render();
    expect(page()).toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe('Your access has changed');
    expect(button('Sign out')).toBeDefined();
  });
});

describe('branch-denied record', () => {
  it('shows the fixed card with one way back to the list, never the server text or record details', async () => {
    const error = new ConvexError({ code: 'BRANCH_FORBIDDEN', message: "You don't have access to this branch.", guest: 'Maya Lin', amount: 180000 });
    await act(async () => root.render(createElement(AdminViewErrorCard, { error, onRetry: () => undefined, pathname: '/admin/receipt/order123' })));
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.querySelector('h2')?.textContent).toBe('You don’t have access to this branch’s records');
    expect(alert?.textContent).not.toContain("You don't have access to this branch.");
    expect(alert?.textContent).not.toContain('Maya Lin');
    expect(alert?.textContent).not.toContain('Try again');
    const links = alert?.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links?.[0].getAttribute('href')).toBe('/admin/checkout');
    expect(links?.[0].textContent).toBe('Back to Checkout');
  });

  it('recognizes the code in a serialized error message too', async () => {
    const error = new Error('[CONVEX Q(pos/orders:receipt)] Uncaught ConvexError: {"code":"BRANCH_FORBIDDEN","message":"No"}');
    await act(async () => root.render(createElement(AdminViewErrorCard, { error, onRetry: () => undefined, pathname: '/admin/hotel' })));
    expect(document.querySelector('[role="alert"] h2')?.textContent).toBe('You don’t have access to this branch’s records');
    expect(document.querySelector('[role="alert"] a')?.getAttribute('href')).toBe('/admin/hotel');
  });
});
