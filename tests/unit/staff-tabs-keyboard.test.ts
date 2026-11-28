// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/platform/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSelectedLayoutSegment: () => 'calendar',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('convex/react', () => ({ useQuery: () => undefined, useMutation: () => vi.fn(), useConvex: () => ({}) }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  nav.push.mockReset();
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
const key = (k: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });

it('D44: arrows and End move focus between staff route tabs without activating; Enter/click activates only the focused tab', async () => {
  const { AdminStaffTabs } = await import('@/components/admin/AdminStaffBookingsView');
  await act(async () => root.render(createElement(ConfirmProvider, null, createElement(AdminStaffTabs, null, 'panel'))));
  document.getElementById('staff-tab-calendar')!.focus();
  await key('ArrowRight');
  await key('ArrowRight');
  await key('ArrowRight');
  expect(document.activeElement?.id).toBe('staff-tab-services');
  await key('Home');
  await key('End');
  expect(document.activeElement?.id).toBe('staff-tab-services');
  expect(nav.push).not.toHaveBeenCalled();
  // A button's Enter/Space activation is its click.
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(nav.push).toHaveBeenCalledTimes(1);
  expect(nav.push).toHaveBeenCalledWith('/admin/staff/services');
}, 30_000);
