// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Id } from 'convex/_generated/dataModel';
import { parseStaffCalendarLink, parseStaffRosterLink, staffCalendarHref, staffRosterHref } from '@/lib/staff-links';
import { TimeOffConflictLinks } from '@/components/admin/AdminStaffTimeOff';
import { staffFilterLabel } from '@/components/admin/AdminStaffBookingsView';

vi.mock('@/platform/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

it('builds and validates calendar and roster deep links', () => {
  expect(staffCalendarHref({ date: '2026-12-01', staffId: 'staff123abc', appointmentId: 'appt456def' })).toBe('/admin/staff/calendar?date=2026-12-01&staff=staff123abc&appointment=appt456def');
  expect(staffCalendarHref()).toBe('/admin/staff/calendar');
  expect(parseStaffCalendarLink(new URLSearchParams('date=2026-02-30&staff=a%20b&appointment=appt456def'))).toEqual({ date: undefined, staffId: undefined, appointmentId: 'appt456def' });
  expect(staffRosterHref({ date: '2026-12-04', staffId: 'staff123abc' })).toBe('/admin/staff/roster?date=2026-12-04&staff=staff123abc');
  expect(parseStaffRosterLink(new URLSearchParams('date=2026-12-04&staff=staff123abc'))).toEqual({ date: '2026-12-04', staffId: 'staff123abc' });
});

let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('F12: every returned time-off conflict opens its appointment, with rows past three disclosed', async () => {
  const start = Date.parse('2026-12-01T10:00:00+07:00');
  const conflicts = Array.from({ length: 5 }, (_, i) => ({ appointmentId: `appointment${i}` as Id<'appointments'>, start: start + i * 3_600_000 }));
  await act(async () => root.render(createElement(TimeOffConflictLinks, { staffId: 'staff123abc' as Id<'staff'>, conflicts })));
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a')];
  expect(links).toHaveLength(5);
  expect(links[0].getAttribute('href')).toBe('/admin/staff/calendar?date=2026-12-01&staff=staff123abc&appointment=appointment0');
  expect(document.querySelector('details summary')!.textContent).toBe('Show 2 more');
  expect(document.body.textContent).toContain('5 booked appointments in the way');
});

it('D22: the staff filter trigger reports appointments of hidden staff', () => {
  expect(staffFilterLabel(4, 5, 3)).toBe('4 of 5 staff · 3 hidden appts');
  expect(staffFilterLabel(4, 5, 1)).toBe('4 of 5 staff · 1 hidden appt');
  expect(staffFilterLabel(5, 5, 0)).toBe('5 of 5 staff');
});
