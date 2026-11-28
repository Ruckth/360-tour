import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarRange, SlidersHorizontal } from 'lucide-react';
import { useRouter as useStartRouter, useRouterState } from '@tanstack/react-router';
import { Overview } from './ProfitOverview';
import { Details } from './ProfitRecords';
import { box, path, type Href, type Report, type Request } from './report-model';
import { useConvex, useMutation } from 'convex/react';
import { api } from 'convex/_generated/api';
import { metricNames, profitMetrics } from 'convex/shared/profitability';
import { monthBounds, monthOf, shiftMonth } from 'convex/shared/calendar';
import { resortTodayIso } from 'convex/shared/time';
import { MAX_REPORT_DAYS, reportDayCount } from 'convex/shared/marketingReport';
import Link from '@/platform/link';
import { usePathname, useSearchParams } from '@/platform/navigation';
import { staffDateTime } from '@/lib/staff-time';
import { Button } from '@/components/ui/button';
import { useMarketingAccess } from '../marketing/MarketingAccess';
import { thb, marketingErrorText } from '../marketing/marketing-format';
import { FinanceInputs, type FinanceInputsHandle } from './FinanceInputs';
import { inputStyle, readGroup, RuleEditor, ruleLabel } from './report-controls';

declare module '@tanstack/react-router' {
  interface HistoryState {
    profitSearch?: { owner: string; text: string };
  }
}
function ReportScreen({ detailPage }: { detailPage: boolean }) {
  const convex = useConvex(),
    router = useStartRouter(),
    params = useSearchParams(),
    pathname = usePathname();
  const today = resortTodayIso(),
    from = params.get('from') || today.slice(0, 8) + '01',
    to = params.get('to') || today;
  const [dateDraft, setDateDraft] = useState({ from, to, start: from, end: to });
  const dates = dateDraft.from === from && dateDraft.to === to ? dateDraft : { from, to, start: from, end: to };
  const draftDays = reportDayCount(dates.start, dates.end);
  const draftInvalid = draftDays === null || draftDays > MAX_REPORT_DAYS;
  const [refreshRevision, setRefreshRevision] = useState<number | null>(null);
  const chosen = params.get('metric'),
    metric = profitMetrics.find((m) => m === chosen) ?? 'revenue';
  const overview = useMemo(() => readGroup(params.get('rules')), [params]),
    additional = useMemo(() => readGroup(params.get('additional')), [params]);
  const access = useMarketingAccess();
  const canWrite = access.role === 'admin' || access.role === 'finance';
  const savedSearch = useRouterState({ select: (s) => s.location.state.profitSearch });
  const submitted = detailPage && savedSearch?.owner === access.email ? (savedSearch?.text ?? '') : '';
  const [draft, setDraft] = useState({ term: submitted, text: submitted });
  const search = draft.term === submitted ? draft.text : submitted;
  const setSearch = (text: string) => setDraft({ term: submitted, text });
  const page = Math.max(0, Math.floor(Number(params.get('page')) || 0));
  const descending = params.get('sort') !== 'asc';
  const [financeEntry, setFinanceEntry] = useState<{ mode: 'cost' | 'month'; date: string } | null>(null);
  const financeInputs = useRef<FinanceInputsHandle>(null);
  const financeHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (financeEntry) financeHeading.current?.focus();
  }, [financeEntry]);
  const [revision, setRevision] = useState(0);
  const refreshing = refreshRevision === revision;
  const expiredView = useRef<string | null>(null);
  const openView = useMutation(api.marketing.profitViews.openView);
  const viewKey = JSON.stringify([access.email, canWrite, from, to, revision]);
  const [view, setView] = useState<{ key: string; id?: Request['viewId']; error?: string }>();
  const days = reportDayCount(from, to),
    valid = days !== null && days <= MAX_REPORT_DAYS;
  useEffect(() => {
    if (!valid) return;
    let active = true;
    openView({ from, to, refresh: revision > 0 }).then(
      (id) => {
        if (active) setView({ key: viewKey, id });
      },
      (err) => {
        if (active) setView({ key: viewKey, error: marketingErrorText(err, 'Could not open the report.') });
      },
    );
    return () => {
      active = false;
    };
  }, [openView, from, to, revision, valid, viewKey]);
  const viewId = view?.key === viewKey ? view.id : undefined;
  const category = params.get('category') ?? '';
  const request: Request = useMemo(
    () => ({
      from,
      to,
      overview,
      additional,
      viewId,
      search: submitted,
      category,
      page,
      descending,
      ...(detailPage ? { metric } : {}),
    }),
    [viewId, from, to, overview, additional, submitted, category, page, descending, detailPage, metric],
  );
  const key = JSON.stringify([request, revision]);
  const [state, setState] = useState<{ key: string; data?: Report; error?: string } | null>(null);
  useEffect(() => {
    if (!valid || !viewId) return;
    let active = true;
    convex.query(api.marketing.profitability.report, request).then(
      (data) => {
        if (active) setState({ key, data });
      },
      (err) => {
        if (!active) return;
        const message = marketingErrorText(err, 'The report could not be loaded.');
        if (message.includes('view expired') && expiredView.current !== viewId) {
          expiredView.current = viewId;
          setRevision((n) => n + 1);
        } else setState({ key, error: message });
      },
    );
    return () => {
      active = false;
    };
  }, [convex, key, request, valid, viewId]);
  const href: Href = (detail, updates) => {
    const next = new URLSearchParams();
    for (const k of ['rules', 'metric', 'additional', 'page', 'sort', 'lookup', 'category']) {
      const v = params.get(k);
      if (v) next.set(k, v);
    }
    next.set('from', from);
    next.set('to', to);
    if (!detail) for (const k of ['metric', 'additional', 'category', 'page', 'sort', 'lookup']) next.delete(k);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return path + (detail ? '/transactions' : '') + '?' + next.toString();
  };
  function update(changes: Record<string, string | null>, term = submitted) {
    void router.navigate({
      href: href(detailPage, { page: null, ...changes }),
      resetScroll: false,
      state: (prev) => ({
        ...prev,
        profitSearch: detailPage && access.email && term ? { owner: access.email, text: term } : undefined,
      }),
    });
  }
  const report = valid && state?.key === key ? state.data : undefined;
  const options = state?.data ?? { services: [], sources: [] };
  const loading = valid && state?.key !== key && !(view?.key === viewKey && view.error);
  const group = detailPage ? additional : overview;
  return (
    <section
      aria-label="Service profitability report"
      className="mx-auto grid w-full max-w-7xl gap-5 px-4 py-6 text-foreground sm:px-6"
    >
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
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-xs text-muted-foreground">
            {report ? `${refreshing ? 'Report refreshed' : 'Report updated'} ${staffDateTime(report.asOf)}` : refreshing && loading ? 'Refreshing report…' : ''}
          </span>
          {report && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setRefreshRevision(revision + 1); setRevision(revision + 1); }}
            >
              Refresh report
            </Button>
          )}
          {!detailPage && canWrite && (
            <Button
              variant="outline"
              aria-expanded={Boolean(financeEntry)}
              onClick={() => {
                if (financeEntry) void financeInputs.current?.changeContext(() => setFinanceEntry(null));
                else setFinanceEntry({ mode: 'cost', date: to });
              }}
            >
              <SlidersHorizontal size={16} />
              Finance inputs
            </Button>
          )}
        </div>
      </header>
      {financeEntry && !detailPage && canWrite && (
        <section className={box}>
          <h2 ref={financeHeading} tabIndex={-1} className="px-4 pt-4 text-lg font-semibold sm:px-6">
            Service finance inputs
          </h2>
          <FinanceInputs
            ref={financeInputs}
            key={financeEntry.mode + financeEntry.date}
            onClose={() => setFinanceEntry(null)}
            initialDate={financeEntry.date}
            initialMode={financeEntry.mode}
            onSave={() => setRevision((v) => v + 1)}
          />
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
          <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <CalendarRange aria-hidden="true" className="mb-3 hidden text-muted-foreground sm:block" size={18} />
            <label className="grid gap-1 text-xs">
              From
              <input
                type="date"
                className={inputStyle + ' w-full'}
                value={dates.start}
                onChange={(e) => setDateDraft({ ...dates, start: e.target.value })}
              />
            </label>
            <label className="grid gap-1 text-xs">
              Through
              <input
                type="date"
                className={inputStyle + ' w-full'}
                value={dates.end}
                onChange={(e) => setDateDraft({ ...dates, end: e.target.value })}
              />
            </label>
            <Button size="sm" disabled={draftInvalid || (dates.start === from && dates.end === to)} onClick={() => {
              if (!draftInvalid) {
                setRefreshRevision(null);
                update({ from: dates.start, to: dates.end });
              }
            }}>Apply dates</Button>
            {draftInvalid && <p role="status" className="text-xs text-destructive">Choose a valid range of up to {MAX_REPORT_DAYS} days.</p>}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setDateDraft({ from, to, start: from, end: to });
                setRefreshRevision(null);
                const { startDate, endDate } = monthBounds(shiftMonth(monthOf(today), -1));
                update({ from: startDate, to: endDate });
              }}
            >
              Last month
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setDateDraft({ from, to, start: from, end: to }); setRefreshRevision(null); update({ from: monthOf(today) + '-01', to: today }); }}
            >
              Month to date
            </Button>
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
      {((view?.key === viewKey && view.error) || (state?.key === key && state.error)) && (
        <div role="alert" className={box + ' p-4'}>
          {(view?.key === viewKey && view.error) || (state?.key === key && state.error)}{' '}
          <Button size="sm" variant="outline" onClick={() => setRevision((v) => v + 1)}>
            Retry
          </Button>
        </div>
      )}
      {valid &&
        (report || (loading && state?.data && Boolean(state.data.detail) === detailPage)) &&
        (() => {
          const shown = report ?? state!.data!;
          return (
            <div className={'grid gap-5' + (loading ? ' opacity-65' : '')} aria-busy={loading} inert={loading}>
              {detailPage ? (
                <Details
                  key={pathname}
                  report={shown}
                  request={request}
                  refresh={() => setRevision((v) => v + 1)}
                  busy={loading}
                  submitSearch={(term) =>
                    update({ lookup: term ? String(Number(params.get('lookup') ?? 0) + 1) : null }, term.trim())
                  }
                  setPage={(p) => update({ page: p ? String(p) : null })}
                  category={category}
                  setCategory={(v) => update({ category: v || null })}
                  search={search}
                  setSearch={setSearch}
                  setDescending={(v) => update({ sort: v ? null : 'asc' })}
                />
              ) : (
                <Overview report={shown} href={href} narrowed={overview.rules.length > 0} />
              )}
              {!!shown.summary.unmappedSpend && (
                <p role="status">
                  Unclassified campaign spend of {thb(shown.summary.unmappedSpend)}. Finance can classify it in
                  monthly accounts.
                </p>
              )}
              {!!shown.missingMonths.length && (
                <p className="text-sm text-muted-foreground">
                  Monthly accounts awaiting confirmation ·{' '}
                  {shown.missingMonths.map((month, index) => (
                    <span key={month}>
                      {index > 0 && ', '}
                      {canWrite && !detailPage && !financeEntry ? (
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center text-primary underline"
                          onClick={() => {
                            const open = () => setFinanceEntry({ mode: 'month', date: month + '-01' });
                            if (financeInputs.current) void financeInputs.current.changeContext(open);
                            else open();
                          }}
                          aria-label={'Review monthly accounts for ' + month}
                        >
                          {month}
                        </button>
                      ) : (
                        month
                      )}
                    </span>
                  ))}
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
            delivery. Refunds reduce revenue on their effective day, or on delivery if earlier. Service COGS
            includes staff time and commission, materials consumed and per-use equipment costs. Cost schedules
            estimate these amounts per delivery.
          </p>
          <p>
            LTV uses the full recorded service history of matching identified attendees through the last selected
            day. Customer merges take effect on their recorded date. Finance corrections to the attendee apply on
            the delivery date. CAC uses the first paid delivery recorded for each attendee and the acquisition
            campaigns finance selected for the service business. Anonymous services still count toward revenue.
          </p>
          <p>
            Net profit requires complete service costs and monthly accounts. Monthly overhead, other expenses, tax,
            other income and campaign spend apply to the entire service business. CAC and net profit are available
            for the unfiltered period.
          </p>
        </div>
      </details>
    </section>
  );
}
export function ProfitabilityScreen({ detailPage = false }: { detailPage?: boolean }) {
  const access = useMarketingAccess();
  if (!access.capabilities.spend) return <p className="p-6">Finance access is required to view profitability.</p>;
  return <ReportScreen key={[access.email, access.role].join('|')} detailPage={detailPage} />;
}
