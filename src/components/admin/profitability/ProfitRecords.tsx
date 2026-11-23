import { useState } from 'react';
import { useConvex } from 'convex/react';
import { ArrowDownUp, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toCsv } from '@/lib/admin/csv';
import { metricNames } from 'convex/shared/profitability';
import { thb, marketingErrorText } from '../marketing/marketing-format';
import { useMarketingAccess } from '../marketing/MarketingAccess';
import { CustomerAssignment } from './CustomerAssignment';
import { VisitCosts } from './VisitCosts';
import { inputStyle } from './report-controls';
import { endpoint, box, money, type Report, type Request } from './report-model';
export function Details({
  report,
  request,
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
  request: Request;
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
  const role = useMarketingAccess().role;
  const canWrite = role === 'admin' || role === 'finance';
  const [actual, setActual] = useState<NonNullable<Report['detail']>['rows'][number] | null>(null);
  const [exporting, setExporting] = useState(false),
    [error, setError] = useState('');
  const [assignment, setAssignment] = useState<NonNullable<Report['detail']>['rows'][number] | null>(null);
  const detail = report.detail,
    metric = request.metric;
  if (!detail || !metric) return null;
  async function download() {
    setExporting(true);
    setError('');
    try {
      const { detail: all } = await convex.query(endpoint, { ...request, exportRows: true });
      if (!all) return;
      const csv = toCsv([
        ['Date', 'Reference', 'Service', 'Customer', 'Category', 'Amount (THB)'],
        ...all.rows.map((r) => [
          r.day,
          r.ref,
          r.service,
          r.customer,
          r.category,
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
      setError(marketingErrorText(err, 'Could not export these records.'));
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className={box + ' min-w-0'}>
      <header className="grid gap-3 border-b border-border p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Supporting records</h2>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void download();
              }}
              disabled={busy || exporting || !detail.count}
            >
              <Download size={15} />
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
          )}
        </div>
        <p className="text-sm">
          Overview <b>{money(report.summary[metric])}</b> · After transaction rules <b>{money(detail.value)}</b>
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex max-w-full flex-wrap items-end gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              submitSearch(search);
            }}
          >
            <label className="grid max-w-full gap-1 text-xs">
              Search records
              <input
                className={inputStyle}
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
            {request.search && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  submitSearch('');
                }}
              >
                Clear search
              </Button>
            )}
          </form>
          <label className="grid max-w-full gap-1 text-xs">
            Record category
            <select className={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {[...new Set([...detail.categories, ...(category ? [category] : [])])].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="ghost" onClick={() => setDescending(!request.descending)}>
            <ArrowDownUp size={15} />
            {request.descending ? 'Newest first' : 'Oldest first'}
          </Button>
        </div>
      </header>
      {error && (
        <p role="alert" className="px-4 pt-3 text-destructive">
          {error}
        </p>
      )}
      {actual?.costEntry && !busy && (
        <VisitCosts
          entry={actual.costEntry}
          reference={actual.ref}
          close={() => setActual(null)}
          saved={() => {
            setActual(null);
            refresh();
          }}
        />
      )}
      {assignment?.appointmentId && !busy && (
        <CustomerAssignment
          visit={assignment.appointmentId}
          expected={assignment.currentCustomer ?? null}
          reference={assignment.ref}
          done={() => {
            setAssignment(null);
            refresh();
          }}
        />
      )}
      {detail.count ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{metricNames[metric]} supporting records</caption>
            <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
              <tr>
                {['Date', 'Reference', 'Service / customer', 'Category', 'Amount'].map((c) => (
                  <th key={c} scope="col" className="whitespace-nowrap px-4 py-3 last:text-right">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detail.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{r.day || '—'}</td>
                  <td className="px-4 py-3 font-medium">{r.ref}</td>
                  <td className="px-4 py-3">
                    {r.service}
                    {r.costEntry && (
                      <button
                        disabled={busy}
                        type="button"
                        className="block min-h-10 text-xs text-primary underline"
                        onClick={() => setActual(r)}
                      >
                        Record actual costs
                      </button>
                    )}
                    {r.appointmentId && (
                      <button
                        type="button"
                        className="block min-h-10 text-xs text-primary underline"
                        disabled={busy}
                        onClick={() => setAssignment(r)}
                      >
                        {r.currentCustomer ? 'Edit customer' : 'Identify customer'}
                      </button>
                    )}
                    {r.customer && r.customer !== r.ref && (
                      <div className="text-xs text-muted-foreground">{r.customer}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.category}
                    {r.basis && <span className="block text-xs text-muted-foreground">{r.basis}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                    {r.amount === null ? '—' : thb(r.amount)}
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
          {detail.count} matching records · {thb(detail.sum)} subtotal
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!detail.page} onClick={() => setPage(detail.page - 1)}>
            Previous
          </Button>
          <span>
            {detail.page + 1} / {Math.max(1, Math.ceil(detail.count / detail.pageSize))}
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
      </footer>
    </section>
  );
}
