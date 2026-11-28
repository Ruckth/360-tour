// @vitest-environment happy-dom
import { createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act } from '../support/checkout-act';
import { Details } from '@/components/admin/profitability/ProfitRecords';
import { MarketingAccessProvider, type MarketingAccess } from '@/components/admin/marketing/MarketingAccess';
import { emptyFilters, profitTotals } from 'convex/shared/profitability';
import type { Id } from 'convex/_generated/dataModel';

const query = vi.hoisted(() => vi.fn());
vi.mock('convex/react', () => ({
  useConvex: () => ({ query }),
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));
vi.mock('@/components/admin/ConfirmDialog', () => ({ useConfirm: () => vi.fn() }));

type Props = ComponentProps<typeof Details>;
const visit = 'visit' as Id<'appointments'>;
const row = {
  id: visit, day: '2026-11-02', ref: 'Private booking reference', customer: 'Private guest',
  service: 'Service A', category: 'Service', amount: 100, appointmentId: visit,
  costEntry: { appointmentId: visit, version: 0, costs: { staff: 500, materials: 0, tools: 0 } },
};
const detail = {
  page: 0, pageSize: 25, count: 1, sum: 100, people: 0, displayedRatio: null, value: 100,
  categories: ['Service'], rows: [row],
};
const report: Props['report'] = {
  asOf: 1,
  summary: {
    ...profitTotals([]), revenue: 100, net: null, ltv: null, cac: null,
    customerCount: 0, newCount: 0, lifetime: 0, spend: 0, unmappedSpend: 0, anonymous: 0,
  },
  breakdown: [], expenses: [], excludedCurrency: 0, missingMonths: [], services: [], sources: [], detail,
};
const registerCorrectionGuard = vi.fn();
const props: Props = {
  report, registerCorrectionGuard,
  request: {
    from: '2026-11-01', to: '2026-11-30', metric: 'revenue', page: 0, search: '', category: '',
    descending: true, overview: emptyFilters, additional: emptyFilters, viewId: 'source' as Id<'serviceProfitViews'>,
  },
  preparedViewId: 'prepared' as Id<'serviceProfitViews'>,
  category: '', search: '', busy: false, setPage: vi.fn(), setCategory: vi.fn(), setSearch: vi.fn(),
  setDescending: vi.fn(), refresh: vi.fn(), submitSearch: vi.fn(),
};
const access: MarketingAccess = {
  email: 'staff@example.test', role: 'finance', pendingInvitation: null,
  capabilities: { view: true, draft: false, publish: false, spend: true, partners: false, reviewCredits: false, manageAccess: false },
};

let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function show(role: MarketingAccess['role'], overrides: Partial<Props> = {}) {
  await act(async () => root.render(createElement(MarketingAccessProvider, { value: { ...access, role } },
    createElement(Details, { ...props, ...overrides }))));
}
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it.each([
  ['Record actual costs', 'Actual costs for'],
  ['Identify customer', 'Identify customer for'],
])('closes %s on downgrade and preserves it during loading', async (button, heading) => {
  const currentHeading = () => document.querySelector('h3')?.textContent;
  await show('finance');
  await click(button);
  expect(currentHeading()).toContain(heading + ' ' + row.ref);
  await show('finance', { busy: true });
  expect(currentHeading()).toContain(row.ref);
  await show('manager', { busy: true });
  expect(currentHeading()).toBeUndefined();
  expect(registerCorrectionGuard).toHaveBeenLastCalledWith(null);
  await show('manager', { report: {
    ...report, detail: { ...detail, rows: [{
      id: 'record-1', day: row.day, category: row.category, service: row.service,
      amount: row.amount, ref: 'Record 1', customer: 'Attendee 1',
    }] },
  } });
  expect(document.body.textContent).not.toContain(row.ref);
  expect(document.body.textContent).not.toContain(row.customer);
  await show('finance');
  expect(currentHeading()).toBeUndefined();
});

it('downloads complete 10,000-row evidence through the export button with bounded parallel reads', async () => {
  let active = 0;
  let peak = 0;
  const count = 10_000;
  const fullDetail = { ...detail, count, sum: count * 100 };
  query.mockImplementation(async (_endpoint, args: { page: number }) => {
    peak = Math.max(peak, ++active);
    await Promise.resolve();
    active--;
    const rows = Array.from({ length: 25 }, (_, i) => ({
      ...row, id: 'export-' + (args.page * 25 + i), ref: '', customer: '',
    }));
    return { asOf: 1, detail: { ...fullDetail, page: args.page, rows } };
  });
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  await show('finance', { report: { ...report, detail: fullDetail } });
  await click('Export CSV');
  expect(query).toHaveBeenCalledTimes(400);
  expect(peak).toBe(8);
  expect(download).toHaveBeenCalledOnce();
  const blob = createUrl.mock.calls[0]?.[0];
  if (!(blob instanceof Blob)) throw new Error('Expected a CSV Blob');
  const csv = await blob.text();
  expect(csv).toContain('Matching records,Evidence subtotal (THB)');
  expect(csv.split('\r\n')).toHaveLength(count + 4);
});

it('creates no download when finance permission changes during the export', async () => {
  const fullDetail = { ...detail, count: 500, sum: 50_000 };
  query.mockReset().mockImplementation(async (_endpoint, args: { page: number }) => {
    if (args.page === 3) throw new Error('Finance access is required to export.');
    return { asOf: 1, detail: { ...fullDetail, page: args.page } };
  });
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const createUrl = vi.spyOn(URL, 'createObjectURL');
  await show('finance', { report: { ...report, detail: fullDetail } });
  await click('Export CSV');
  expect(query).toHaveBeenCalledTimes(9);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Finance access');
  expect(createUrl).not.toHaveBeenCalled();
  expect(download).not.toHaveBeenCalled();
});
