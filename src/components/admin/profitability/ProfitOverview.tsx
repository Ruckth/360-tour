import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import Link from '@/platform/link';
import { costTotal, metricNames, type ProfitFilters, type ProfitMetric } from 'convex/shared/profitability';
import { thb } from '../marketing/marketing-format';
import { inputStyle } from './report-controls';
import { box, money, type Report, type Href } from './report-model';
export function Overview({
  report,
  href,
  narrowed,
  openMonth,
}: {
  report: Report;
  href: Href;
  narrowed: boolean;
  openMonth?: (month: string) => void;
}) {
  const [sort, setSort] = useState('revenue');
  const breakdown = [...report.breakdown].sort((a, b) => {
    if (sort === 'missing') return b.missingCount - a.missingCount || a.name.localeCompare(b.name);
    if (sort === 'gross')
      return (b.gross ?? -Infinity) - (a.gross ?? -Infinity) || a.name.localeCompare(b.name);
    return b.revenue - a.revenue || a.name.localeCompare(b.name);
  });
  const s = report.summary;
  const financeCoverage = s.unmappedSpend
    ? thb(s.unmappedSpend) + ' in campaign spend awaits classification'
    : report.missingMonths.length
      ? 'Awaiting monthly accounts'
      : null;
  const note: Record<ProfitMetric, string> = {
    revenue: s.missingCount
      ? thb(s.coveredRevenue) +
        ' with complete costs · ' +
        thb(s.revenue - s.coveredRevenue) +
        ' awaiting costs'
      : 'Delivered services and fees, after VAT and refunds',
    gross:
      s.gross === null
        ? 'Awaiting service costs'
        : thb(s.coveredRevenue) + ' revenue less ' + thb(costTotal(s.costs)) + ' service COGS',
    net: narrowed
      ? 'Shared expenses apply to all services'
      : (financeCoverage ??
        (s.missingCount ? 'Awaiting service costs' : 'After acquisition spend, expenses and tax')),
    ltv: s.customerCount
      ? 'Lifetime service revenue ÷ ' +
        s.customerCount +
        (s.customerCount === 1 ? ' identified customer' : ' identified customers')
      : 'Requires an identified attendee',
    cac: narrowed
      ? 'Spend applies to the full service business'
      : (financeCoverage ??
        (s.newCount
          ? thb(s.spend) + ' spend ÷ ' + s.newCount + (s.newCount === 1 ? ' new customer' : ' new customers')
          : 'No identified new customers in this period')),
  };
  const metricCard = (metric: ProfitMetric) => (
    <div className={box + ' min-w-0'}>
      <Link
        href={href(true, { metric, additional: null })}
        className={
          'group flex min-w-0 flex-col gap-3 p-4 transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring'
        }
      >
        <div className="flex items-start justify-between gap-3 text-sm font-medium">
          {metricNames[metric]}
          <ArrowUpRight aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
        </div>
        <div
          className={
            'break-words font-semibold tracking-tight tabular-nums ' +
            (s[metric] === null ? 'text-lg' : 'text-2xl')
          }
        >
          {money(s[metric])}
        </div>
        <span className="text-xs leading-relaxed text-muted-foreground">
          {metric === 'gross' && s.gross !== null && s.missingCount > 0 && <b>Partial · </b>}
          {note[metric]}
        </span>
      </Link>
      {metric === 'net' && s.net === null && !narrowed && report.missingMonths.length > 0 && (
        <ul aria-label="Unconfirmed monthly accounts" className="px-4 pb-4 text-xs">
          {report.missingMonths.map((month) => (
            <li key={month}>
              {openMonth ? (
                <button
                  type="button"
                  className="min-h-11 text-primary underline"
                  onClick={() => openMonth(month)}
                  aria-label={'Review monthly accounts for ' + month}
                >
                  {month}
                </button>
              ) : (
                <span>{month}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {metricCard('revenue')}
        <div className={box + ' grid content-start gap-2 p-4'}>
          <h2 className="text-sm font-medium">Service COGS</h2>
          <strong
            className={
              'break-words font-semibold tracking-tight tabular-nums ' +
              (s.gross === null ? 'text-lg' : 'text-2xl')
            }
          >
            {money(s.gross === null ? null : costTotal(s.costs))}
          </strong>
          {s.count > 0 && s.gross !== null ? (
            <dl className="text-xs" aria-label="Service COGS breakdown">
              {(['staff', 'materials', 'tools'] as const).map((part) => (
                <div key={part} className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <dt className="capitalize">{part}</dt>
                  <dd>
                    <Link
                      href={href(true, {
                        metric: 'gross',
                        category: part[0].toUpperCase() + part.slice(1),
                        additional: null,
                      })}
                      aria-label={'Review ' + part + ' costs'}
                      className="inline-flex min-h-6 items-center font-medium tabular-nums underline pointer-coarse:min-h-11 decoration-muted-foreground/60 underline-offset-2"
                    >
                      {thb(s.costs[part])}
                    </Link>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <span className="text-xs text-muted-foreground">Staff, materials and tools</span>
          )}
          {s.missingCount > 0 && s.gross !== null && (
            <span className="text-xs font-medium">
              Partial total · {thb(s.coveredRevenue)} covered revenue
            </span>
          )}
          {s.missingCount > 0 && (
            <Link
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
              href={href(true, {
                metric: 'gross',
                category: 'Awaiting cost',
                additional: null,
              })}
            >
              Review {s.missingCount} {s.missingCount === 1 ? 'record' : 'records'} missing costs
            </Link>
          )}
        </div>
        {metricCard('gross')}
        {metricCard('net')}
      </div>
      <section className={box + ' overflow-hidden'}>
        <header className="border-b border-border p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Revenue and costs by service</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.count} financial {s.count === 1 ? 'row' : 'rows'} · {s.customerCount} identified{' '}
            {s.customerCount === 1 ? 'customer' : 'customers'}
            {s.missingCount > 0 && ' · Cost totals include only records with complete costs'}
          </p>
          {breakdown.length > 0 && (
            <label className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              Sort services by
              <select className={inputStyle} value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="revenue">Revenue</option>
                <option value="gross">Gross profit</option>
                <option value="missing">Missing cost count</option>
              </select>
            </label>
          )}
        </header>
        {!breakdown.length ? (
          <p className="p-5 text-sm">No delivered services, fees or refunds match these filters.</p>
        ) : (
          <table className="w-full text-left text-sm max-md:block">
            <caption className="sr-only">Service revenue and cost comparison</caption>
            <thead className="bg-muted/40 text-xs max-md:sr-only">
              <tr>
                {['Service', 'Revenue', 'Known COGS', 'Gross profit', 'Missing costs'].map((column) => (
                  <th key={column} scope="col" className={'px-4 py-3' + (column === 'Service' ? '' : ' text-right')}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border max-md:block">
              {breakdown.map((row) => {
                const group: ProfitFilters = {
                  join: 'and',
                  rules: [{ field: 'service', operator: 'is', value: row.id }],
                };
                const url = (metric: ProfitMetric, category?: string) =>
                  href(true, {
                    metric,
                    additional: JSON.stringify(group),
                    category: category ?? null,
                  });
                return (
                  <tr key={row.id} className="max-md:grid max-md:grid-cols-2 max-md:p-4">
                    <th scope="row" className="break-words font-semibold max-md:col-span-2 md:px-4 md:py-3">
                      {row.name}
                    </th>
                    <td className="py-2 md:px-4 md:text-right">
                      <span className="block text-xs text-muted-foreground md:hidden">Revenue</span>
                      <Link className="inline-flex items-center pointer-coarse:min-h-11 underline tabular-nums" href={url('revenue')}>
                        {thb(row.revenue)}
                      </Link>
                    </td>
                    <td className="py-2 tabular-nums md:px-4 md:text-right">
                      <span className="block text-xs text-muted-foreground md:hidden">Known COGS</span>
                      {row.gross === null ? money(null) : (
                        <details>
                          <summary className="cursor-pointer pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:items-center md:justify-end">
                            {thb(costTotal(row.costs))}{row.missingCount > 0 && ' · Partial'}
                          </summary>
                          <ul className="mt-1 space-y-1 text-xs">
                            {(['staff', 'materials', 'tools'] as const).map((part) => (
                              <li key={part}>
                                <Link className="inline-flex items-center pointer-coarse:min-h-11 capitalize underline" href={url('gross', part[0].toUpperCase() + part.slice(1))}>
                                  {part} {thb(row.costs[part])}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td className="py-2 md:px-4 md:text-right">
                      <span className="block text-xs text-muted-foreground md:hidden">Gross profit</span>
                      <Link className="inline-flex items-center pointer-coarse:min-h-11 underline tabular-nums" href={url('gross')}>
                        {money(row.gross)}
                      </Link>
                    </td>
                    <td className="py-2 tabular-nums md:px-4 md:text-right">
                      <span className="block text-xs text-muted-foreground md:hidden">Missing costs</span>
                      {row.missingCount ? (
                        <Link
                          className="inline-flex items-center pointer-coarse:min-h-11 text-primary underline pointer-coarse:min-w-11"
                          href={url('gross', 'Awaiting cost')}
                          aria-label={'Review missing costs for ' + row.name}
                        >
                          {row.missingCount}
                        </Link>
                      ) : (
                        '0'
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      {!narrowed && report.expenses.length > 0 && (
        <section className={box + ' p-4 sm:p-5'}>
          <h2 className="text-lg font-semibold">From gross to net profit</h2>
          <dl className="mt-2 divide-y divide-border text-sm">
            <div className="flex justify-between gap-3 py-2">
              <dt>Gross profit</dt>
              <dd className="font-semibold tabular-nums">{money(s.gross)}</dd>
            </div>
            {report.expenses.map((e) => (
              <div className="flex justify-between gap-3 py-2" key={e.kind}>
                <dt>{e.kind}</dt>
                <dd>
                  <Link
                    className="inline-flex items-center pointer-coarse:min-h-11 tabular-nums underline-offset-4 hover:underline"
                    href={href(true, {
                      metric: 'net',
                      category: e.kind,
                      additional: null,
                    })}
                  >
                    {thb(e.amount)} <span aria-hidden="true">↗</span>
                  </Link>
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 pt-3 font-semibold">
              <dt>Net profit</dt>
              <dd className="tabular-nums">{money(s.net)}</dd>
            </div>
          </dl>
        </section>
      )}
      <section aria-label="Customer metrics" className="grid grid-cols-2 gap-2">
        {metricCard('ltv')}
        {metricCard('cac')}
        {s.anonymous > 0 && (
          <Link
            className="col-span-2 inline-flex min-h-11 w-fit items-center text-sm text-primary underline"
            href={href(true, {
              metric: 'revenue',
              category: null,
              additional: JSON.stringify({
                join: 'and',
                rules: [{ field: 'attendee', operator: 'is', value: 'Unidentified' }],
              } satisfies ProfitFilters),
            })}
          >
            Review {s.anonymous} {s.anonymous === 1 ? 'record' : 'records'} without an identified attendee
          </Link>
        )}
      </section>
    </>
  );
}
