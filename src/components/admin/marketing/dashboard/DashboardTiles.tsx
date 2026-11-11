"use client";

import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import { pluralize } from "../../admin-bulk";
import { thb } from "../marketing-format";
import { useMarketingAccess } from "../MarketingAccess";
import { formatPercent, formatRoas, type BusinessTotals, type Prepared, type Roas } from "./report-model";

// The headline tiles and the business-total bar under them.

function Tile({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1 bg-card p-4">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      <div className="text-xs leading-5 text-muted-foreground">{children}</div>
    </div>
  );
}

const Strong = ({ children }: { children: ReactNode }) => <span className="font-medium text-foreground">{children}</span>;

export function AddSpendLink({ onClick, label = "Add spend" }: { onClick: () => void; label?: string }) {
  const { capabilities } = useMarketingAccess();
  if (!capabilities.spend) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded font-semibold text-foreground underline underline-offset-2 hover:text-gold-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
    >
      {label}
    </button>
  );
}

function RoasTile({ roas, onAddSpend }: { roas: Roas; onAddSpend: (campaignIds: string[]) => void }) {
  if (roas.kind === "all_properties_only") return <Tile label="Ad ROAS" value="—">All properties only: spend isn’t split by property.</Tile>;
  if (roas.kind === "missing")
    return (
      <Tile label="Ad ROAS" value="—">
        No spend entered for these dates. <AddSpendLink onClick={() => onAddSpend(roas.campaignIds)} />
      </Tile>
    );
  return (
    <Tile label="Ad ROAS" value={formatRoas(roas.value)}>
      {thb(Math.round(roas.net))} net ÷ {thb(Math.round(roas.spend))} spend · {pluralize(roas.campaigns, "campaign")} with spend
      {roas.missing.length ? (
        <>
          {" "}
          · {pluralize(roas.missing.length, "more campaign")} with sales {roas.missing.length === 1 ? "has" : "have"} no spend. <AddSpendLink onClick={() => onAddSpend(roas.missing)} />
        </>
      ) : null}
    </Tile>
  );
}

const ALL_ONLY = "All properties only";

export function DashboardTiles({ p, totals, onAddSpend, onDefinitions }: { p: Prepared; totals: BusinessTotals; onAddSpend: (campaignIds: string[]) => void; onDefinitions: () => void }) {
  const { tracked, unknown, staff, messaging, all } = totals;
  const otherPaid = all.paidOther;
  const tiles = p.cash ? (
    <>
      <Tile label="Collected" value={thb(all.collected)}>
        Payments dated in range · tracked <Strong>{thb(tracked.collected)}</Strong>
      </Tile>
      <Tile label="Refunds" value={thb(all.refunded)}>
        Refunds dated in range · tracked <Strong>{thb(tracked.refunded)}</Strong>
      </Tile>
      <Tile label="Net collected" value={thb(all.net)}>
        Collected minus refunds · tracked <Strong>{thb(tracked.net)}</Strong>
      </Tile>
      <Tile label="First-payment sales" value={all.paid.toLocaleString("en-US")}>
        Sales receiving their first payment in range · tracked <Strong>{tracked.paid.toLocaleString("en-US")}</Strong>
        <span className="block">{pluralize(all.couponOnlySettlements, "coupon-only checkout settlement")}</span>
      </Tile>
      <Tile label="Discounts granted" value={thb(all.discount)}>
        Coupons at first payment or checkout settlement in range · tracked <Strong>{thb(tracked.discount)}</Strong>
      </Tile>
      <RoasTile roas={totals.roas} onAddSpend={onAddSpend} />
    </>
  ) : (
    <>
      <Tile label="Consented sessions" value={totals.trackedSessions === null ? "—" : totals.trackedSessions.toLocaleString("en-US")}>
        {totals.trackedSessions === null ? ALL_ONLY : "Visits after consent, including direct arrivals. Visits, not people."}
      </Tile>
      <Tile label="Paid bookings" value={tracked.paid.toLocaleString("en-US")}>
        Paid stays from tracked links · <Strong>{all.paid.toLocaleString("en-US")}</Strong> paid stays in all
        {otherPaid ? (
          <>
            {" "}
            · {pluralize(otherPaid, "checkout order")} {otherPaid === 1 ? "counts" : "count"} in money only
          </>
        ) : null}
      </Tile>
      <Tile label="Session conversion" value={totals.conv === null ? "—" : formatPercent(totals.conv)}>
        {totals.trackedSessions === null
          ? ALL_ONLY
          : totals.trackedSessions
            ? `${totals.convertedSessions.toLocaleString("en-US")} converted sessions ÷ ${totals.trackedSessions.toLocaleString("en-US")} sessions started in range`
            : "No consented sessions in these dates"}
        <span className="block">{pluralize(tracked.currentLinkPaidStays, "current-link paid stay")} without a session · counted separately</span>
      </Tile>
      <Tile label="Net collected" value={thb(tracked.net)}>
        Tracked · <Strong>{thb(all.net)}</Strong> business total, after {thb(all.refunded)} refunds
      </Tile>
      <Tile label="Discounts granted" value={thb(tracked.discount)}>
        Coupons on tracked sales · <Strong>{thb(all.discount)}</Strong> business total
      </Tile>
      <RoasTile roas={totals.roas} onAddSpend={onAddSpend} />
    </>
  );

  const parts = [
    { key: "tracked", label: "Tracked links", money: tracked, color: "var(--primary)" },
    { key: "unknown", label: "Unknown", money: unknown, color: "var(--chart-s0)" },
    { key: "staff", label: "Staff-entered", money: staff, color: "var(--chart-s0b)" },
    { key: "messaging", label: "Messaging", money: messaging, color: "var(--chart-s5)" },
  ].filter((part) => part.key === "tracked" || part.money.sales > 0);
  const positive = Math.max(1, parts.reduce((total, part) => total + Math.max(0, part.money.net), 0));
  const share = (net: number) => Math.round((Math.max(0, net) / positive) * 100);
  const countOf = (m: { paid: number; paidOther: number; couponOnlySettlements: number }) => (p.cash ? `${m.paid} first paid · ${m.couponOnlySettlements} coupon-only` : `${m.paid} paid${m.paidOther ? ` + ${m.paidOther} orders` : ""}`);

  return (
    <section aria-labelledby="kpi-title" className="min-w-0 border border-border bg-card">
      <header className="flex flex-wrap items-end justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id="kpi-title" className="text-base font-semibold text-foreground">
            {p.cash ? "Money in and out" : "Results from tracked links"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {p.cash ? "Finance view · by payment, refund and coupon settlement date" : `${p.filters.touch === "first" ? "First touch" : "Last touch"} · sales made in these dates`}
          </p>
        </div>
        <button
          type="button"
          onClick={onDefinitions}
          className="inline-flex items-center gap-1 rounded text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
        >
          <HelpCircle aria-hidden className="size-3.5" />
          What these count
        </button>
      </header>
      <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-3 xl:grid-cols-6">{tiles}</div>
      <div className="grid gap-3 border-t border-border px-4 py-3 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-center lg:gap-6">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Business total · {p.cash ? "payments, refunds and coupon settlements" : "every paid sale"}</p>
          <p className="text-base font-semibold tabular-nums text-foreground">
            {thb(all.net)} net
          </p>
          <p className="text-xs tabular-nums text-muted-foreground">{countOf(all)}</p>
        </div>
        <div className="grid min-w-0 gap-2">
          <div role="img" aria-label={`Net collected by tracking: ${parts.map((part) => `${part.label} ${thb(part.money.net)}`).join(", ")}`} className="flex h-2 w-full gap-0.5">
            {parts
              .filter((part) => part.money.net > 0)
              .map((part) => (
                <span key={part.key} className="block h-2 rounded-full" style={{ flex: `${part.money.net} 1 0`, background: part.color }} />
              ))}
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {parts.map((part) => (
              <li key={part.key} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2 rounded-full" style={{ background: part.color }} />
                {part.label} <span className="font-semibold tabular-nums text-foreground">{thb(part.money.net)}</span> · {countOf(part.money)} · {share(part.money.net)}%
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
