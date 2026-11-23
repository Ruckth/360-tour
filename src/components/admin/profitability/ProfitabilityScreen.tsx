import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ArrowLeft, ArrowUpRight, CalendarRange, Download, SlidersHorizontal } from 'lucide-react';
import { useConvex } from 'convex/react';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { api } from 'convex/_generated/api';
import { metricNames, profitMetrics, type ProfitFilters, type ProfitMetric } from 'convex/shared/profitability';
import { resortTodayIso } from 'convex/shared/time';
import { MAX_REPORT_DAYS, reportDayCount } from 'convex/shared/marketingReport';
import Link from '@/platform/link';
import { usePathname, useRouter, useSearchParams } from '@/platform/navigation';
import { Button } from '@/components/ui/button';
import { toCsv } from '@/lib/admin/csv';
import { useMarketingAccess } from '../marketing/MarketingAccess';
import { thb, marketingErrorText } from '../marketing/marketing-format';
import { CustomerAssignment } from './CustomerAssignment';
import { FinanceInputs } from './FinanceInputs';
import { inputStyle, readGroup, RuleEditor, ruleLabel } from './report-controls';

const path = '/admin/marketing/profitability';
const endpoint = api.marketing.profitability.report;
type Report = FunctionReturnType<typeof endpoint>;
type Request = FunctionArgs<typeof endpoint>;
const money = (n: number | null) => (n === null ? 'Unavailable' : thb(n));
const box = 'rounded-xl border border-border bg-card';
type Href = (detail: boolean, updates: Record<string, string | null>) => string;

function Overview({ report, href, narrowed }: { report: Report; href: Href; narrowed: boolean }) {
  const s = report.summary;
  const note: Record<ProfitMetric, string> = {
    revenue: 'Delivered services and fees, after VAT and refunds',
    gross: s.missingCount ? s.missingCount + ' rows awaiting costs' : 'After staff, materials and tools',
    net: narrowed
      ? 'Shared expenses apply to all services'
      : report.missingMonths.length
        ? 'Enter monthly accounts below'
        : s.missingCount
          ? 'Complete service costs below'
          : 'After acquisition spend, expenses and tax',
    ltv: s.customerCount
      ? 'Lifetime service revenue ÷ ' + s.customerCount + ' identified customers'
      : 'Requires an identified attendee',
    cac: narrowed
      ? 'Spend applies to the full service business'
      : report.missingMonths.length
        ? 'Confirm monthly campaign spend'
        : thb(s.spend) + ' spend ÷ ' + s.newCount + ' new customers',
  };
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {profitMetrics.map((metric) => (
          <Link
            key={metric}
            href={href(true, { metric, additional: null })}
            className={
              box +
              ' group flex min-w-0 flex-col gap-3 p-4 transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring'
            }
          >
            <div className="flex items-start justify-between gap-3 text-sm font-medium">
              {metricNames[metric]}
              <ArrowUpRight aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
            </div>
            <div className="text-2xl font-semibold tracking-tight tabular-nums">{money(s[metric])}</div>
            <span className="text-xs leading-relaxed text-muted-foreground">
              {metric === 'gross' && s.gross !== null && s.missingCount > 0 && <b>Partial · </b>}
              {note[metric]}
            </span>
          </Link>
        ))}
      </div>
      <section className={box + ' overflow-hidden'}>
        <header className="border-b border-border p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Revenue and costs by service</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.count} financial rows · {s.customerCount} identified customers · {s.anonymous} rows without an
            attendee
          </p>
        </header>
        {!report.breakdown.length ? (
          <p className="p-5 text-sm">No delivered services, fees or refunds match these filters.</p>
        ) : (
          <div className="divide-y divide-border">
            {report.breakdown.map((row) => {
              const group: ProfitFilters = {
                join: 'and',
                rules: [{ field: 'service', operator: 'is', value: row.id }],
              };
              const url = (metric: ProfitMetric, category?: string) =>
                href(true, { metric, additional: JSON.stringify(group), category: category ?? null });
              return (
                <article key={row.id} className="grid gap-3 p-4 sm:p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-semibold">{row.name}</h3>
                    <Link
                      className="text-sm font-semibold underline-offset-4 hover:underline"
                      href={url('revenue')}
                    >
                      {thb(row.revenue)} revenue ↗
                    </Link>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    {(['staff', 'materials', 'tools'] as const).map((k) => (
                      <Link
                        key={k}
                        href={url('gross', k[0].toUpperCase() + k.slice(1))}
                        className="grid gap-0.5 rounded-md bg-muted/50 px-3 py-2 hover:bg-muted"
                      >
                        <span className="capitalize text-muted-foreground">{k}</span>
                        <b className="tabular-nums">
                          {row.count === row.missingCount ? 'Awaiting costs' : thb(row.costs[k])}
                        </b>
                      </Link>
                    ))}
                    <Link href={url('gross')} className="grid gap-0.5 rounded-md bg-primary/10 px-3 py-2">
                      <span>Gross profit</span>
                      <b className="tabular-nums">{money(row.gross)} ↗</b>
                    </Link>
                  </div>
                  {row.missingCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {row.missingCount} rows totaling {thb(row.revenue - row.coveredRevenue)} await a cost
                      schedule.
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function Details({
  report,
  request,
  setPage,
  category,
  setCategory,
  search,
  setSearch,
  setDescending,
  refresh,
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
}) {
  const convex = useConvex();
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void download();
            }}
            disabled={exporting || !detail.count}
          >
            <Download size={15} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </div>
        <p className="text-sm">
          Overview <b>{money(report.summary[metric])}</b> · After transaction rules <b>{money(detail.value)}</b>
        </p>
        <div className="flex flex-wrap items-end gap-3">
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
      {assignment?.appointmentId && (
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
                    {r.appointmentId && (
                      <button
                        type="button"
                        className="block min-h-10 text-xs text-primary underline"
                        onClick={() => setAssignment(r)}
                      >
                        {r.currentCustomer ? 'Edit customer' : 'Identify customer'}
                      </button>
                    )}
                    {r.customer && r.customer !== r.ref && (
                      <div className="text-xs text-muted-foreground">{r.customer}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.category}</td>
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
          {(metric === 'ltv' || metric === 'cac') && ' · ' + detail.people + ' customers'}
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

function ReportScreen({ detailPage }: { detailPage: boolean }) {
  const convex = useConvex(),
    router = useRouter(),
    params = useSearchParams(),
    pathname = usePathname();
  const today = resortTodayIso(),
    from = params.get('from') || today.slice(0, 8) + '01',
    to = params.get('to') || today;
  const chosen = params.get('metric'),
    metric = profitMetrics.find((m) => m === chosen) ?? 'revenue';
  const overview = useMemo(() => readGroup(params.get('rules')), [params]),
    additional = useMemo(() => readGroup(params.get('additional')), [params]);
  const [search, setSearch] = useState(''),
    [submitted, setSubmitted] = useState(''),
    [page, setPage] = useState(0),
    [descending, setDescending] = useState(true);
  const [open, setOpen] = useState(false),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSubmitted(search);
      setPage(0);
    }, 220);
    return () => clearTimeout(timer);
  }, [search]);
  const category = params.get('category') ?? '';
  const request: Request = useMemo(
    () => ({
      from,
      to,
      overview,
      additional,
      search: submitted,
      category,
      page,
      descending,
      ...(detailPage ? { metric } : {}),
    }),
    [from, to, overview, additional, submitted, category, page, descending, detailPage, metric],
  );
  const key = JSON.stringify([request, revision]);
  const [state, setState] = useState<{ key: string; data?: Report; error?: string } | null>(null);
  const days = reportDayCount(from, to),
    valid = days !== null && days <= MAX_REPORT_DAYS;
  useEffect(() => {
    if (!valid) return;
    let active = true;
    convex.query(endpoint, request).then(
      (data) => {
        if (active) setState({ key, data });
      },
      (err) => {
        if (active) setState({ key, error: marketingErrorText(err, 'The report could not be loaded.') });
      },
    );
    return () => {
      active = false;
    };
  }, [convex, key, request, valid]);
  const href: Href = (detail, updates) => {
    const next = new URLSearchParams(params);
    next.set('from', from);
    next.set('to', to);
    if (!detail) for (const k of ['metric', 'additional', 'category']) next.delete(k);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return path + (detail ? '/transactions' : '') + '?' + next.toString();
  };
  function update(changes: Record<string, string | null>) {
    setPage(0);
    router.replace(href(detailPage, changes), { scroll: false });
  }
  const report = valid && state?.key === key ? state.data : undefined;
  const options = state?.data ?? { services: [], sources: [] };
  const loading = valid && state?.key !== key;
  const group = detailPage ? additional : overview;
  return (
    <main className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 text-foreground sm:px-6">
      {detailPage && (
        <Link href={href(false, {})} className="inline-flex w-fit items-center gap-2 text-sm font-medium">
          <ArrowLeft size={16} />
          Profitability overview
        </Link>
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {detailPage ? metricNames[metric] + ' transactions' : 'Service profitability'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Delivered services and fees · THB excluding VAT · Bangkok time
          </p>
        </div>
        {!detailPage && (
          <Button variant="outline" aria-expanded={open} onClick={() => setOpen(!open)}>
            <SlidersHorizontal size={16} />
            Finance inputs
          </Button>
        )}
      </header>
      {open && !detailPage && (
        <section className={box}>
          <h2 className="px-4 pt-4 text-lg font-semibold sm:px-6">Service finance inputs</h2>
          <FinanceInputs today={to} onSave={() => setRevision((v) => v + 1)} />
        </section>
      )}
      <section className={box + ' grid gap-4 p-4 sm:p-5'} aria-label="Report filters">
        {detailPage ? (
          <div className="grid gap-1 text-sm">
            <b>From overview</b>
            <span>
              {from} – {to} ·{' '}
              {overview.rules.length
                ? overview.rules.map((r) => ruleLabel(r, options)).join(' ' + overview.join.toUpperCase() + ' ')
                : 'All services'}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <CalendarRange aria-hidden="true" className="mb-3 hidden text-muted-foreground sm:block" size={18} />
            <label className="grid gap-1 text-xs">
              From
              <input
                type="date"
                className={inputStyle}
                value={from}
                onChange={(e) => update({ from: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-xs">
              Through
              <input
                type="date"
                className={inputStyle}
                value={to}
                onChange={(e) => update({ to: e.target.value })}
              />
            </label>
          </div>
        )}
        <RuleEditor
          group={group}
          options={options}
          onChange={(g) =>
            update({ [detailPage ? 'additional' : 'rules']: g.rules.length ? JSON.stringify(g) : null })
          }
        />
      </section>
      {!valid && <p role="alert">Choose a period of 1–92 days.</p>}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Updating report…
        </p>
      )}
      {state?.key === key && state.error && (
        <div role="alert" className={box + ' p-4'}>
          {state.error}{' '}
          <Button size="sm" variant="outline" onClick={() => setRevision((v) => v + 1)}>
            Retry
          </Button>
        </div>
      )}
      {valid &&
        (report || (detailPage && loading && state?.data?.detail)) &&
        (() => {
          const shown = report ?? state!.data!;
          return (
            <div className={'grid gap-5' + (loading ? ' opacity-65' : '')} aria-busy={loading}>
              {detailPage ? (
                <Details
                  key={pathname}
                  report={shown}
                  request={request}
                  refresh={() => setRevision((v) => v + 1)}
                  setPage={setPage}
                  category={category}
                  setCategory={(v) => update({ category: v || null })}
                  search={search}
                  setSearch={setSearch}
                  setDescending={(v) => {
                    setPage(0);
                    setDescending(v);
                  }}
                />
              ) : (
                <Overview report={shown} href={href} narrowed={overview.rules.length > 0} />
              )}
              {!!shown.missingMonths.length && (
                <p className="text-sm text-muted-foreground">
                  Monthly accounts awaiting finance confirmation: {shown.missingMonths.join(', ')}.
                </p>
              )}
              {!!shown.excludedCurrency && (
                <p className="text-sm">Excluded {shown.excludedCurrency} non-THB services.</p>
              )}
            </div>
          );
        })()}
      <details className="text-sm text-muted-foreground">
        <summary className="w-fit cursor-pointer font-medium">How the figures are calculated</summary>
        <div className="mt-2 grid max-w-prose gap-2">
          <p>
            Revenue is earned on the completed appointment’s end date. Prepaid sessions earn their share on
            delivery. Refunds reduce revenue on their effective day, or on delivery if earlier. Direct cost
            schedules are estimates per delivery.
          </p>
          <p>
            LTV uses the full recorded service history of matching identified attendees through the last selected
            day. CAC uses the first paid delivery recorded for each attendee and the acquisition campaigns finance
            selected for the service business. Anonymous services still count toward revenue.
          </p>
          <p>
            Net profit requires complete service costs and monthly accounts. Monthly overhead, other expenses, tax,
            other income and campaign spend apply to the entire service business. CAC and net profit are available
            for the unfiltered period.
          </p>
        </div>
      </details>
    </main>
  );
}
export function ProfitabilityScreen({ detailPage = false }: { detailPage?: boolean }) {
  const access = useMarketingAccess();
  if (!access.capabilities.spend) return <p className="p-6">Finance access is required to view profitability.</p>;
  return <ReportScreen detailPage={detailPage} />;
}
