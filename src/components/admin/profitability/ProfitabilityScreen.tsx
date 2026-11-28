import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarRange, SlidersHorizontal } from 'lucide-react';
import { useRouter as useStartRouter, useRouterState } from '@tanstack/react-router';
import { Overview } from './ProfitOverview';
import { Details } from './ProfitRecords';
import { box, path, type Href, type Report, type Request } from './report-model';
import { useConvex, useMutation, useQuery } from 'convex/react';
import { api } from 'convex/_generated/api';
import { emptyFilters, metricNames, profitMetrics } from 'convex/shared/profitability';
import { monthBounds, monthOf, shiftMonth } from 'convex/shared/calendar';
import { resortTodayIso } from 'convex/shared/time';
import { MAX_REPORT_DAYS, reportDayCount } from 'convex/shared/marketingReport';
import Link from '@/platform/link';
import { useSearchParams } from '@/platform/navigation';
import { staffDateTime } from '@/lib/staff-time';
import { Button } from '@/components/ui/button';
import { useMarketingAccess } from '../marketing/MarketingAccess';
import { thb, marketingErrorText } from '../marketing/marketing-format';
import { FinanceInputs, type FinanceInputsHandle } from './FinanceInputs';
import { inputStyle, readGroup, RuleEditor, ruleLabel } from './report-controls';
import { retryTransactionPreparation } from './prepare-transaction-retry';

declare module '@tanstack/react-router' {
  interface HistoryState {
    profitSearch?: { owner: string; text: string };
  }
}
function ReportScreen({ detailPage }: { detailPage: boolean }) {
  const convex = useConvex(),
    router = useStartRouter(),
    params = useSearchParams();
  const today = resortTodayIso(),
    from = params.get('from') || today.slice(0, 8) + '01',
    to = params.get('to') || today;
  const [dateDraft, setDateDraft] = useState({
    from,
    to,
    start: from,
    end: to,
  });
  const dates =
    dateDraft.from === from && dateDraft.to === to ? dateDraft : { from, to, start: from, end: to };
  if (dates !== dateDraft) setDateDraft(dates);
  const draftDays = reportDayCount(dates.start, dates.end);
  const draftInvalid = draftDays === null || draftDays > MAX_REPORT_DAYS;
  const pendingRefresh = useRef<string | null>(null);
  const chosen = params.get('metric'),
    metric = profitMetrics.find((m) => m === chosen) ?? 'revenue';
  const overviewParam = params.get('rules'),
    additionalParam = params.get('additional');
  const savedOverview = useMemo(() => readGroup(overviewParam), [overviewParam]);
  const savedAdditional = useMemo(() => readGroup(additionalParam), [additionalParam]);
  const invalidOverview = savedOverview === null;
  const invalidAdditional = detailPage && savedAdditional === null;
  const invalidRules = invalidOverview || invalidAdditional;
  const overview = savedOverview ?? emptyFilters;
  const additional = savedAdditional ?? emptyFilters;
  const access = useMarketingAccess();
  const canWrite = access.role === 'admin' || access.role === 'finance';
  const savedSearch = useRouterState({
    select: (s) => s.location.state.profitSearch,
  });
  const submitted = detailPage && savedSearch?.owner === access.email ? (savedSearch?.text ?? '') : '';
  const [draft, setDraft] = useState({ term: submitted, text: submitted });
  const search = draft.term === submitted ? draft.text : submitted;
  const setSearch = (text: string) => setDraft({ term: submitted, text });
  const page = Math.max(0, Math.floor(Number(params.get('page')) || 0));
  const descending = params.get('sort') !== 'asc';
  const [financeEntry, setFinanceEntry] = useState<{
    mode: 'cost' | 'month';
    date: string;
    instance?: number;
  } | null>(null);
  const financeInputs = useRef<FinanceInputsHandle>(null);
  const financeHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (financeEntry) financeHeading.current?.focus();
  }, [financeEntry]);
  const [revision, setRevision] = useState(0);
  const expiredView = useRef<string | null>(null);
  const openView = useMutation(api.marketing.profitViews.openView);
  const viewKey = JSON.stringify([access.email, canWrite, from, to, revision]);
  const [view, setView] = useState<{
    key: string;
    id?: Request['viewId'];
    error?: string;
  }>();
  const days = reportDayCount(from, to),
    valid = days !== null && days <= MAX_REPORT_DAYS;
  useEffect(() => {
    if (!valid || invalidRules) return;
    let active = true;
    openView({ from, to, refresh: revision > 0 }).then(
      (id) => {
        if (active) setView({ key: viewKey, id });
      },
      (err) => {
        if (active)
          setView({
            key: viewKey,
            error: marketingErrorText(err, 'Could not open the report.'),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [openView, from, to, revision, valid, invalidRules, viewKey]);
  const openedViewId = view?.key === viewKey ? view.id : undefined;
  const sourceStatus = useQuery(api.marketing.profitViews.sourceStatus, openedViewId ? { id: openedViewId } : 'skip');
  const viewId = sourceStatus === 'ready' ? openedViewId : undefined;
  const sourceError = sourceStatus === 'failed'
    ? 'Could not open the full source snapshot. Try a shorter period.'
    : sourceStatus === 'expired' ? 'The report view expired. Refresh the report.' : null;
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
  const prepareTransactions = useMutation(api.marketing.profitability.prepareTransactions);
  const transactionScope = useMemo(
    () => ({
      from,
      to,
      overview,
      additional,
      search: submitted,
      category,
      descending,
      metric,
    }),
    [from, to, overview, additional, submitted, category, descending, metric],
  );
  const [preparationRevision, setPreparationRevision] = useState(0);
  const transactionKey = JSON.stringify([viewId, transactionScope, preparationRevision]);
  const [prepared, setPrepared] = useState<{
    key: string;
    id?: Request['preparedViewId'];
    error?: string;
  }>();
  useEffect(() => {
    if (!detailPage || !viewId || invalidRules) return;
    const controller = new AbortController();
    retryTransactionPreparation(() => prepareTransactions({ ...transactionScope, viewId }), controller.signal)
      .then(
        (id) => {
          if (!controller.signal.aborted && id) setPrepared({ key: transactionKey, id });
        },
        (err) => {
          if (!controller.signal.aborted)
            setPrepared({
              key: transactionKey,
              error: marketingErrorText(err, 'Could not prepare transactions.'),
            });
        },
      );
    return () => controller.abort();
  }, [detailPage, invalidRules, prepareTransactions, transactionKey, transactionScope, viewId]);
  const preparedViewId = prepared?.key === transactionKey ? prepared.id : undefined;
  const preparationError = prepared?.key === transactionKey ? prepared.error : undefined;
  const accessKey = JSON.stringify([access.email, access.role]);
  const key = JSON.stringify([accessKey, request, revision, preparedViewId]);
  const refreshKey = JSON.stringify([params.toString(), detailPage, submitted, access.email, revision]);
  const stampScope = JSON.stringify([access.email, access.role, from, to, detailPage]);
  const [state, setState] = useState<{
    key: string;
    refreshed?: boolean;
    data?: Report;
    dataAccessKey?: string;
    error?: string;
    lastSuccess?: { scope: string; asOf: number };
  } | null>(null);
  useEffect(() => {
    if (!valid || !viewId || invalidRules || (detailPage && !preparedViewId)) return;
    let active = true;
    convex.query(api.marketing.profitability.report, { ...request, preparedViewId }).then(
      (data) => {
        if (active) {
          const refreshed = pendingRefresh.current === refreshKey;
          pendingRefresh.current = null;
          setState({
            key,
            data,
            dataAccessKey: accessKey,
            refreshed,
            lastSuccess: { scope: stampScope, asOf: data.asOf },
          });
        }
      },
      (err) => {
        if (!active) return;
        const message = marketingErrorText(err, 'The report could not be loaded.');
        if (message.includes('view expired') && expiredView.current !== viewId) {
          expiredView.current = viewId;
          setRevision((n) => n + 1);
        } else
          setState((previous) => ({
            key,
            data: previous?.data,
            dataAccessKey: previous?.dataAccessKey,
            error: message,
            lastSuccess: previous?.lastSuccess,
          }));
      },
    );
    return () => {
      active = false;
    };
  }, [refreshKey, convex, key, request, stampScope, accessKey, valid, viewId, invalidRules, detailPage, preparedViewId]);
  const href: Href = (detail, updates) => {
    const next = new URLSearchParams();
    for (const k of ['rules', 'metric', 'additional', 'page', 'sort', 'lookup', 'category']) {
      const v = params.get(k);
      if (v) next.set(k, v);
    }
    next.set('from', from);
    next.set('to', to);
    if (!detail)
      for (const k of ['metric', 'additional', 'category', 'page', 'sort', 'lookup']) next.delete(k);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return path + (detail ? '/transactions' : '') + '?' + next.toString();
  };
  const correctionGuardRef = useRef<((navigate: () => void) => void) | null>(null);
  const registerCorrectionGuard = useCallback((guard: ((navigate: () => void) => void) | null) => {
    correctionGuardRef.current = guard;
  }, []);
  function update(changes: Record<string, string | null>, term = submitted) {
    const navigate = () =>
      void router.navigate({
        href: href(detailPage, { page: null, ...changes }),
        resetScroll: false,
        state: (prev) => ({
          ...prev,
          profitSearch: detailPage && access.email && term ? { owner: access.email, text: term } : undefined,
        }),
      });
    if (correctionGuardRef.current) correctionGuardRef.current(navigate);
    else navigate();
  }
  const report = valid && !invalidRules && state?.key === key && !state.error ? state.data : undefined;
  const options = state?.data ?? { services: [], sources: [] };
  const loading =
    valid &&
    !invalidRules &&
    state?.key !== key &&
    !preparationError && !sourceError &&
    !(view?.key === viewKey && view.error);
  const lastStamp = state?.lastSuccess?.scope === stampScope ? staffDateTime(state.lastSuccess.asOf) : null;
  const group = detailPage ? additional : overview;
  // Keep the previous render mounted for a correction draft while a new scope loads,
  // but hide its figures until the snapshot and applied scope match again.
  const shown = report ?? (state?.dataAccessKey === accessKey && Boolean(state.data?.detail) === detailPage ? state?.data : undefined);
  function submitSearch(term: string) {
    update({ lookup: term ? String(Number(params.get('lookup') ?? 0) + 1) : null }, term.trim());
  }
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
            {report && state?.refreshed
              ? `Report refreshed ${lastStamp}`
              : lastStamp
                ? `Report updated ${lastStamp}`
                : ''}
          </span>
          {report && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                pendingRefresh.current = JSON.stringify([
                  params.toString(),
                  detailPage,
                  submitted,
                  access.email,
                  revision + 1,
                ]);
                setRevision(revision + 1);
              }}
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
            key={financeEntry.mode + financeEntry.date + (financeEntry.instance ?? 0)}
            onClose={() => setFinanceEntry(null)}
            initialDate={financeEntry.date}
            initialMode={financeEntry.mode}
            onSave={() => setRevision((v) => v + 1)}
          />
        </section>
      )}
      <section className={box + ' grid gap-3 p-3 sm:gap-4 sm:p-5'} aria-label="Report filters">
        {!detailPage && (
          <p role="status" className="text-sm">
            Applied dates · {from} – {to}
            {(dates.start !== from || dates.end !== to) && ' · Date edits pending'}
          </p>
        )}
        {detailPage ? (
          <div className="grid gap-1 text-sm">
            <b>From overview</b>
            <span>
              {from} – {to} ·{' '}
              {overview.rules.length
                ? overview.rules
                    .map((r) => ruleLabel(r, options))
                    .join(' ' + overview.join.toUpperCase() + ' ')
                : 'All services'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-6 items-end gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <CalendarRange
              aria-hidden="true"
              className="mb-3 hidden text-muted-foreground sm:block"
              size={18}
            />
            <label className="col-span-3 grid min-w-0 gap-1 text-xs">
              From
              <input
                type="date"
                className={inputStyle + ' w-full'}
                value={dates.start}
                onChange={(e) => setDateDraft({ ...dates, start: e.target.value })}
              />
            </label>
            <label className="col-span-3 grid min-w-0 gap-1 text-xs">
              Through
              <input
                type="date"
                className={inputStyle + ' w-full'}
                value={dates.end}
                onChange={(e) => setDateDraft({ ...dates, end: e.target.value })}
              />
            </label>
            <Button
              size="sm"
              className="col-span-2 max-sm:h-auto max-sm:min-h-10 max-sm:whitespace-normal max-sm:px-2 max-sm:leading-tight"
              disabled={draftInvalid || (dates.start === from && dates.end === to)}
              onClick={() => {
                if (!draftInvalid) {
                  pendingRefresh.current = null;
                  update({ from: dates.start, to: dates.end });
                }
              }}
            >
              Apply dates
            </Button>
            {draftInvalid && (
              <p role="status" className="col-span-6 text-xs text-destructive sm:basis-full">
                Choose a valid range of up to {MAX_REPORT_DAYS} days.
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="col-span-2 max-sm:h-auto max-sm:min-h-10 max-sm:whitespace-normal max-sm:px-2 max-sm:leading-tight"
              onClick={() => {
                setDateDraft({ from, to, start: from, end: to });
                pendingRefresh.current = null;
                const { startDate, endDate } = monthBounds(shiftMonth(monthOf(today), -1));
                update({ from: startDate, to: endDate });
              }}
            >
              Last month
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="col-span-2 max-sm:h-auto max-sm:min-h-10 max-sm:whitespace-normal max-sm:px-2 max-sm:leading-tight"
              onClick={() => {
                setDateDraft({ from, to, start: from, end: to });
                pendingRefresh.current = null;
                update({ from: monthOf(today) + '-01', to: today });
              }}
            >
              Month to date
            </Button>
          </div>
        )}
        {invalidRules && (
          <div role="alert" className="grid gap-2 text-sm">
            <p>This shared link contains invalid filter rules. Clear those rules to run the report.</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit"
              onClick={() =>
                update({
                  ...(invalidOverview ? { rules: null } : {}),
                  ...(invalidAdditional ? { additional: null } : {}),
                })
              }
            >
              Clear invalid filters
            </Button>
          </div>
        )}
        {!invalidRules && (
          <RuleEditor
            group={group}
            options={options}
            onChange={(g) =>
              update({
                [detailPage ? 'additional' : 'rules']: g.rules.length ? JSON.stringify(g) : null,
              })
            }
          />
        )}
      </section>
      {!valid && <p role="alert">Choose a period of 1–92 days.</p>}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {sourceStatus === 'building' ? 'Building the profitability snapshot…' : 'Updating report…'}
        </p>
      )}
      {(sourceError || preparationError || (view?.key === viewKey && view.error) || (state?.key === key && state.error)) && (
        <div role="alert" className={box + ' p-4'}>
          {sourceError || preparationError || (view?.key === viewKey && view.error) || (state?.key === key && state.error)}{' '}
          <Button size="sm" variant="outline" onClick={() => {
            if (preparationError && viewId && !preparationError.includes('view expired'))
              setPreparationRevision((n) => n + 1);
            else setRevision((n) => n + 1);
          }}>
            Retry
          </Button>
        </div>
      )}
      {valid && shown && (
        <div
          className={report ? 'grid gap-5' : 'hidden'}
          aria-busy={loading}
          inert={!report}
        >
          {detailPage ? (
            <Details
              registerCorrectionGuard={registerCorrectionGuard}
              report={shown}
              request={request}
              preparedViewId={preparedViewId}
              refresh={() => setRevision((v) => v + 1)}
              busy={loading}
              submitSearch={submitSearch}
              setPage={(p) => update({ page: p ? String(p) : null })}
              category={category}
              setCategory={(v) => update({ category: v || null })}
              search={search}
              setSearch={setSearch}
              setDescending={(v) => update({ sort: v ? null : 'asc' })}
            />
          ) : (
            <Overview
              report={shown}
              href={href}
              narrowed={overview.rules.length > 0}
              period={from === to ? from : `${from} – ${to}`}
              openMonth={
                canWrite
                  ? (month) => {
                      const open = () =>
                        setFinanceEntry((previous) => ({
                          mode: 'month',
                          date: month + '-01',
                          instance: (previous?.instance ?? 0) + 1,
                        }));
                      if (financeInputs.current) void financeInputs.current.changeContext(open);
                      else open();
                    }
                  : undefined
              }
            />
          )}
          {!!shown.summary.unmappedSpend && (
            <p role="status">
              Unclassified campaign spend of {thb(shown.summary.unmappedSpend)}. Finance can classify it in
              monthly accounts.
            </p>
          )}
          {!!shown.excludedCurrency && (
            <p className="text-sm">Excluded {shown.excludedCurrency} non-THB services.</p>
          )}
        </div>
      )}
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
            LTV uses the full recorded service history of matching identified attendees through the last
            selected day. Customer merges take effect on their recorded date. Finance corrections to the
            attendee apply on the delivery date. CAC uses the first paid delivery recorded for each attendee
            and the acquisition campaigns finance selected for the service business. Anonymous services still
            count toward revenue.
          </p>
          <p>
            Net profit requires complete service costs and monthly accounts. Monthly overhead, other expenses,
            tax, other income and campaign spend apply to the entire service business. CAC and net profit are
            available for the unfiltered period.
          </p>
        </div>
      </details>
    </section>
  );
}
export function ProfitabilityScreen({ detailPage = false }: { detailPage?: boolean }) {
  const access = useMarketingAccess();
  if (!access.capabilities.spend)
    return <p className="p-6">Finance access is required to view profitability.</p>;
  return <ReportScreen key={[access.email, access.role].join('|')} detailPage={detailPage} />;
}
