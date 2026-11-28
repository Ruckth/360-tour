import { type ComponentProps, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useConvex } from 'convex/react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toCsv } from '@/lib/admin/csv';
import { metricNames } from 'convex/shared/profitability';
import { thb, marketingErrorText } from '../marketing/marketing-format';
import { useConfirm } from '../ConfirmDialog';
import { useMarketingAccess } from '../marketing/MarketingAccess';
import { CustomerAssignment } from './CustomerAssignment';
import { VisitCosts } from './VisitCosts';
import { collectExportRows } from './export-rows';
import { inputStyle } from './report-controls';
import { endpoint, box, money, type Report, type Request } from './report-model';
export function Details(props: ComponentProps<typeof AuthorizedDetails>) {
  const { role, email } = useMarketingAccess();
  const canWrite = role === 'admin' || role === 'finance';
  return <AuthorizedDetails key={JSON.stringify([email, canWrite])} {...props} />;
}

function AuthorizedDetails({
  report,
  registerCorrectionGuard,
  request,
  preparedViewId,
  setPage,
  category,
  setCategory,
  search,
  setSearch,
  setDescending,
  refresh,
  busy,
  submitSearch,
}: {
  report: Report;
  registerCorrectionGuard: (guard: ((navigate: () => void) => void) | null) => void;
  request: Request;
  preparedViewId: Request['preparedViewId'];
  setPage: (page: number) => void;
  category: string;
  setCategory: (v: string) => void;
  search: string;
  setSearch: (v: string) => void;
  setDescending: (v: boolean) => void;
  refresh: () => void;
  busy: boolean;
  submitSearch: (value: string) => void;
}) {
  const convex = useConvex();
  const confirm = useConfirm();
  const confirming = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const { role, email } = useMarketingAccess();
  const canWrite = role === 'admin' || role === 'finance';
  const [actual, setActual] = useState<NonNullable<Report['detail']>['rows'][number] | null>(null);
  const exportScope = JSON.stringify([
    request.viewId, preparedViewId, role, email, request.from, request.to, request.metric,
    request.overview, request.additional, request.search, request.category, request.descending,
  ]);
  const [exportChoice, setExportChoice] = useState({ scope: exportScope, identifiable: false });
  const includeCustomer = exportChoice.scope === exportScope && exportChoice.identifiable;
  if (exportChoice.scope !== exportScope) setExportChoice({ scope: exportScope, identifiable: false });
  const activeExport = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => activeExport.current?.abort(), [exportScope]);
  const [editorScope, setEditorScope] = useState('');
  const scope = JSON.stringify([
    request.from,
    request.to,
    request.metric,
    request.overview,
    request.additional,
    request.search,
    request.category,
    request.page,
    request.descending,
  ]);
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  const [assignment, setAssignment] = useState<NonNullable<Report['detail']>['rows'][number] | null>(null);
  function guardCorrection(navigate: () => void) {
    if (saving || confirming.current) return;
    const closeAndNavigate = () => {
      setActual(null);
      setAssignment(null);
      setDirty(false);
      navigate();
    };
    if (!dirty) {
      closeAndNavigate();
      return;
    }
    confirming.current = true;
    void confirm({
      title: 'Discard this correction?',
      description: 'Changing the record view will close the unsaved correction.',
      cancelLabel: 'Keep editing',
      confirmLabel: 'Discard changes',
      destructive: true,
    }).then((accepted) => { if (accepted) closeAndNavigate(); })
      .finally(() => { confirming.current = false; });
  }
  useEffect(() => {
    if (!actual && !assignment) return;
    registerCorrectionGuard(guardCorrection);
    return () => registerCorrectionGuard(null);
  });
  const detail = report.detail,
    metric = request.metric;
  if (!detail || !metric) return null;
  async function download() {
    if (!canWrite || !metric || !request.viewId || !preparedViewId || busy || activeExport.current) return;
    const attempt = new AbortController();
    activeExport.current = attempt;
    setExporting(true);
    setError('');
    try {
      const readPage = (page: number) => convex.query(endpoint, {
        ...request,
        preparedViewId,
        page,
        exportRows: true,
        includeCustomer,
      });
      const evidence = await collectExportRows(readPage, attempt.signal);
      if (!evidence || attempt.signal.aborted) return;
      const { asOf, detail: all, rows } = evidence;
      const date = new Date(asOf).toISOString();
      const csv = toCsv([
        [
          'From (inclusive)',
          'Through (inclusive)',
          'Timezone',
          'Metric',
          'Category',
          'Snapshot (UTC)',
          'Revenue basis',
          'Overview filters',
          'Transaction filters',
          'Search filter',
          'Matching records',
          'Evidence subtotal (THB)',
          'Export scope',
        ],
        [
          request.from,
          request.to,
          'Asia/Bangkok',
          metricNames[metric],
          category || 'All categories',
          date,
          'Delivered services and fees, excluding VAT',
          JSON.stringify(request.overview),
          JSON.stringify(request.additional),
          request.search ? 'Applied (private)' : 'None',
          all.count,
          all.sum / 100,
          includeCustomer ? 'Identifiable' : 'Operational',
        ],
        [],
        [
          'Date',
          'Reference',
          'Service',
          ...(includeCustomer ? ['Customer'] : []),
          'Category',
          'Evidence basis',
          'Amount (THB)',
        ],
        ...rows.map((r) => [
          r.day,
          r.ref,
          r.service,
          ...(includeCustomer ? [r.customer] : []),
          r.category,
          r.basis ?? r.category,
          r.amount === null ? '' : r.amount / 100,
        ]),
      ]);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'service-' + metric + '-' + request.from + '-' + request.to + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (!attempt.signal.aborted) setError(marketingErrorText(err, 'Could not export these records.'));
    } finally {
      activeExport.current = null;
      setExporting(false);
    }
  }
  return (
    <section className={box + ' min-w-0'}>
      <header className="grid gap-3 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Supporting records</h2>
          {canWrite && (
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <label className="grid min-w-0 gap-1 text-xs">
                CSV export scope
                <select
                  className={inputStyle + ' w-full'}
                  value={includeCustomer ? 'identifiable' : 'operational'}
                  disabled={busy || exporting}
                  onChange={(event) => setExportChoice({ scope: exportScope, identifiable: event.target.value === 'identifiable' })}
                >
                  <option value="operational">Operational (without customer names)</option>
                  <option value="identifiable">Identifiable (includes customer names)</option>
                </select>
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void download()}
                disabled={busy || exporting || !detail.count || !preparedViewId}
              >
                <Download size={15} />
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            </div>
          )}
        </div>
        <p className="text-sm">
          Overview {metricNames[metric].toLowerCase()} <b>{money(report.summary[metric])}</b>
          {request.additional.rules.length > 0 && (
            <>
              {' '}
              · With transaction rules <b>{money(detail.value)}</b>
            </>
          )}
        </p>
        {category === 'Awaiting cost' && metric === 'gross' && (
          <p className="text-sm">
            These records are excluded from gross profit until their service costs are entered.
          </p>
        )}
        <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
          <form
            className="col-span-2 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-1 sm:flex sm:max-w-full sm:flex-wrap"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch(search);
            }}
          >
            <label className="grid min-w-0 max-w-full gap-1 text-xs">
              Search records
              <input
                className={inputStyle + ' w-full'}
                type="search"
                maxLength={120}
                placeholder="Customer, service, reference"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
            {search.trim() !== (request.search ?? '') && (
              <p role="status" className="col-span-2 basis-full text-xs text-muted-foreground">
                Apply search to update the records.{' '}
                {request.search ? `Showing results for “${request.search}”.` : 'Showing all search results.'}
              </p>
            )}
            {request.search && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="col-span-2 justify-self-start"
                onClick={() => {
                  setSearch('');
                  submitSearch('');
                }}
              >
                Clear search
              </Button>
            )}
          </form>
          <label className="grid min-w-0 max-w-full gap-1 text-xs">
            Record category
            <select className={inputStyle + ' w-full sm:w-auto'} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {[...new Set([...detail.categories, ...(category ? [category] : [])])].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-xs">
            Transaction sort
            <select
              className={inputStyle + ' w-full sm:w-auto'}
              value={request.descending ? 'desc' : 'asc'}
              onChange={(event) => setDescending(event.target.value === 'desc')}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </label>
        </div>
      </header>
      {error && (
        <p role="alert" className="px-4 pt-3 text-destructive">
          {error}
        </p>
      )}
      {(actual || assignment) && editorScope !== scope && !busy && (
        <p role="status" className="border-y border-border px-4 py-3 text-sm">
          Your correction for {(actual ?? assignment)?.ref} is still open from the previous record view.
        </p>
      )}
      {actual?.costEntry && (
        <VisitCosts
          key={actual.id}
          onDirty={() => setDirty(true)}
          onSaving={setSaving}
          entry={actual.costEntry}
          reference={actual.ref}
          close={() => {
            setActual(null);
            setDirty(false);
          }}
          saved={() => {
            setActual(null);
            setDirty(false);
            refresh();
          }}
        />
      )}
      {assignment?.appointmentId && (
        <CustomerAssignment
          key={assignment.id}
          onDirty={() => setDirty(true)}
          onSaving={setSaving}
          visit={assignment.appointmentId}
          expected={assignment.currentCustomer ?? null}
          reference={assignment.ref}
          close={() => {
            setAssignment(null);
            setDirty(false);
          }}
          done={() => {
            setAssignment(null);
            setDirty(false);
            refresh();
          }}
        />
      )}
      {detail.count ? (
        <div className="overflow-x-auto">
          <table role="table" className="w-full text-left text-sm max-sm:block">
            <caption className="sr-only">{metricNames[metric]} supporting records</caption>
            <thead
              role="rowgroup"
              className="border-b border-border bg-muted/40 text-xs text-muted-foreground max-sm:sr-only"
            >
              <tr role="row">
                {['Date', 'Reference', 'Service / customer', 'Category', 'Amount'].map((c) => (
                  <th
                    role="columnheader"
                    key={c}
                    scope="col"
                    className="whitespace-nowrap px-4 py-3 last:text-right"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup" className="divide-y divide-border max-sm:block">
              {detail.rows.map((r) => (
                <tr
                  role="row"
                  key={r.id}
                  className="max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-3 max-sm:gap-y-1 max-sm:p-4"
                >
                  <td
                    role="cell"
                    className="text-muted-foreground tabular-nums sm:whitespace-nowrap sm:px-4 sm:py-3"
                  >
                    {r.day || '—'}
                  </td>
                  <td role="cell" className="break-words font-medium max-sm:text-right sm:px-4 sm:py-3">
                    {r.ref}
                  </td>
                  <td role="cell" className="break-words max-sm:col-span-2 sm:px-4 sm:py-3">
                    {r.service}
                    {canWrite && r.costEntry && (
                      <button
                        disabled={busy}
                        type="button"
                        className="block min-h-11 text-sm text-primary underline"
                        onClick={() => {
                          const open = () => {
                            setAssignment(null);
                            setActual(r);
                            setEditorScope(scope);
                          };
                          if (actual || assignment) guardCorrection(open);
                          else open();
                        }}
                      >
                        Record actual costs
                      </button>
                    )}
                    {canWrite && r.appointmentId && (
                      <button
                        type="button"
                        className="block min-h-11 text-sm text-primary underline"
                        disabled={busy}
                        onClick={() => {
                          const open = () => {
                            setActual(null);
                            setAssignment(r);
                            setEditorScope(scope);
                          };
                          if (actual || assignment) guardCorrection(open);
                          else open();
                        }}
                      >
                        {r.currentCustomer ? 'Edit customer' : 'Identify customer'}
                      </button>
                    )}
                    {r.customer && r.customer !== r.ref && (
                      <div className="text-xs text-muted-foreground">{r.customer}</div>
                    )}
                  </td>
                  <td role="cell" className="sm:px-4 sm:py-3">
                    {r.category}
                    {r.basis && <span className="block text-xs text-muted-foreground">{r.basis}</span>}
                  </td>
                  <td
                    role="cell"
                    className="break-words text-right font-medium tabular-nums sm:whitespace-nowrap sm:px-4 sm:py-3"
                  >
                    {r.amount === null ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">Amount unavailable</span>
                      </>
                    ) : (
                      thb(r.amount)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-5">No records match the selected rules and search.</p>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-sm">
        <span aria-live="polite">
          <span className="block text-xs text-muted-foreground">
            Matching evidence · {category || 'All categories'} ·{' '}
            {request.search ? `Search “${request.search}”` : 'No search'}
          </span>
          {detail.count} matching {detail.count === 1 ? 'record' : 'records'}
          {category !== 'Awaiting cost' && <> · {thb(detail.sum)} subtotal</>}
          {(metric === 'ltv' || metric === 'cac') &&
            ' · ' + detail.people + (detail.people === 1 ? ' customer' : ' customers')}
          {detail.displayedRatio !== null && (
            <>
              {' '}
              · {metricNames[metric]} {money(detail.displayedRatio)}
            </>
          )}
          {metric === 'cac' && (request.search || category) && (
            <span className="block text-xs text-muted-foreground">
              CAC uses the full period’s spend and new customers. This subtotal shows the matching records.
            </span>
          )}
        </span>
        {detail.count > 0 && (
          <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
            <Button
              size="sm"
              variant="outline"
              disabled={!detail.page}
              onClick={() => setPage(detail.page - 1)}
            >
              Previous
            </Button>
            <span>
              {detail.page * detail.pageSize + 1}–
              {Math.min((detail.page + 1) * detail.pageSize, detail.count)} of {detail.count}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={(detail.page + 1) * detail.pageSize >= detail.count}
              onClick={() => setPage(detail.page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </footer>
    </section>
  );
}
