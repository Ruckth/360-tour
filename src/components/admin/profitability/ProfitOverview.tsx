import { ArrowUpRight } from 'lucide-react';
import Link from '@/platform/link';
import { metricNames, profitMetrics, type ProfitFilters, type ProfitMetric } from 'convex/shared/profitability';
import { thb } from '../marketing/marketing-format';
import { box, money, type Report, type Href } from './report-model';
export function Overview({ report, href, narrowed }: { report: Report; href: Href; narrowed: boolean }) {
  const s = report.summary;
  const financeCoverage = s.unmappedSpend
    ? thb(s.unmappedSpend) + ' in campaign spend awaits classification'
    : report.missingMonths.length
      ? 'Awaiting monthly accounts'
      : null;
  const note: Record<ProfitMetric, string> = {
    revenue: 'Delivered services and fees, after VAT and refunds',
    gross: s.missingCount ? s.missingCount + ' rows awaiting costs' : 'After staff, materials and tools',
    net: narrowed
      ? 'Shared expenses apply to all services'
      : financeCoverage ?? (s.missingCount ? 'Awaiting service costs' : 'After acquisition spend, expenses and tax'),
    ltv: s.customerCount
      ? 'Lifetime service revenue ÷ ' +
        s.customerCount +
        (s.customerCount === 1 ? ' identified customer' : ' identified customers')
      : 'Requires an identified attendee',
    cac: narrowed
      ? 'Spend applies to the full service business'
      : financeCoverage ??
        (s.newCount
          ? thb(s.spend) + ' spend ÷ ' + s.newCount + (s.newCount === 1 ? ' new customer' : ' new customers')
          : 'No identified new customers in this period'),
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
              {(metric === 'cac' || metric === 'ltv') && s.anonymous > 0 && (
                <span className="block">
                  {s.anonymous} of {s.count} rows lack a verified attendee.
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
      <section className={box + ' overflow-hidden'}>
        <header className="border-b border-border p-4 sm:p-5">
          <h2 className="text-lg font-semibold">Revenue and costs by service</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {s.count} financial {s.count === 1 ? 'row' : 'rows'} · {s.customerCount} identified{' '}
            {s.customerCount === 1 ? 'customer' : 'customers'} · {s.anonymous} {s.anonymous === 1 ? 'row' : 'rows'}{' '}
            without an attendee
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
                  {row.revenue > 0 && row.gross !== null && row.gross >= 0 && !row.missingCount && (
                    <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="bg-foreground/55"
                        style={{
                          width: Math.min(100, Math.max(0, ((row.revenue - row.gross) / row.revenue) * 100)) + '%',
                        }}
                      />
                      <div className="grow bg-primary/20" />
                    </div>
                  )}
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
                    className="tabular-nums underline-offset-4 hover:underline"
                    href={href(true, { metric: 'net', category: e.kind, additional: null })}
                  >
                    {thb(e.amount)} ↗
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
    </>
  );
}
