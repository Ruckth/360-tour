// @vitest-environment happy-dom
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/admin/ConfirmDialog';
import { useUnsavedChangesGuard } from '@/lib/react/use-unsaved-changes';

const nav = vi.hoisted(() => ({ push: vi.fn(), segment: 'calendar' }));
vi.mock('@/platform/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  useSelectedLayoutSegment: () => nav.segment,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('convex/react', () => ({ useQuery: () => undefined, useMutation: () => vi.fn(), useConvex: () => ({}) }));

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  nav.push.mockReset();
  nav.segment = 'calendar';
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


it('D44: restores the pressed tab on either confirmation outcome and leaves plain route changes alone', async () => {
  const { AdminStaffTabs } = await import('@/components/admin/AdminStaffBookingsView');
  function DirtyPanel() {
    useUnsavedChangesGuard(true);
    return createElement('input', { 'aria-label': 'Draft' });
  }
  const render = (layoutKey: string) => {
    const tabs = createElement(AdminStaffTabs, null, createElement(DirtyPanel));
    root.render(createElement(ConfirmProvider, null, createElement(Fragment, { key: layoutKey }, tabs)));
  };
  const draft = () => document.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
  await act(async () => render('original'));
  draft().focus();
  nav.segment = 'services';
  await act(async () => render('original'));
  expect(document.activeElement).toBe(draft());

  const therapists = () => document.querySelector<HTMLButtonElement>('#staff-tab-staff')!;
  const confirm = async (button: string) => {
    await act(async () => therapists().click());
    const dialog = document.querySelector('[role=alertdialog]')!;
    const action = [...dialog.querySelectorAll('button')].find(node => node.textContent === button)!;
    await act(async () => action.click());
    await vi.waitFor(() => expect(document.activeElement).toBe(therapists()));
  };
  // Radix's programmatic confirmation has no trigger to restore on close.
  await confirm('Keep editing');
  expect(nav.push).not.toHaveBeenCalled();
  const previousTab = therapists();
  nav.push.mockImplementation(() => {
    nav.segment = 'staff';
    render('remounted');
  });
  await confirm('Discard');
  expect(nav.push).toHaveBeenCalledWith('/admin/staff/staff');
  expect(therapists()).not.toBe(previousTab);
  expect(therapists().getAttribute('aria-selected')).toBe('true');
});
