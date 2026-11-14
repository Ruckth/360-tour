"use client";

import { Button } from "@/components/ui/button";
import { Stat } from "@/components/ui/stat";
import { Disclosure } from "@/components/ui/disclosure";
import type { ReactNode } from "react";
import { pluralize } from "../../admin-bulk";
import { thb } from "../marketing-format";
import { useMarketingAccess } from "../MarketingAccess";
import { formatPercent, formatRoas, type BusinessTotals, type Prepared, type Roas } from "./report-model";

// Short captions stay on the surface; attribution and formulas live in the information tip.
const HINTS: Record<string, string> = {
  Collected: "Payments in this period",
  Refunds: "Refunds in this period",
  "First-payment sales": "First paid in this period",
  "Discounts granted": "Coupon savings",
  "Tracked visits": "Visitors who allowed tracking",
  "Paid bookings": "Stays paid",
  "Booked rate": "Visits that booked",
};
function Tile({ label, value, children }: { label: string; value: ReactNode; children: ReactNode }) {
  return <Stat label={label} value={value} info={children} hint={HINTS[label]} />;
}

const Strong = ({ children }: { children: ReactNode }) => <span className="font-medium text-foreground">{children}</span>;

export function AddSpendLink({ onClick, label = "Add spend" }: { onClick: () => void; label?: string }) {
  const { capabilities } = useMarketingAccess();
  if (!capabilities.spend) return null;
  return (
    <Button type="button" size="sm" variant="outline" onClick={onClick}>
      {label}
    </Button>
  );
}

function RoasTile({ roas, onAddSpend }: { roas: Roas; onAddSpend: (campaignIds: string[]) => void }) {
  const info = roas.kind === "all_properties_only" ? "All properties only: spend isn’t split by property."
    : roas.kind === "missing" ? "No spend entered for these dates."
      : `${thb(Math.round(roas.net))} net ÷ ${thb(Math.round(roas.spend))} spend · ${pluralize(roas.campaigns, "campaign")} with spend${roas.missing.length ? ` · ${pluralize(roas.missing.length, "more campaign")} with sales have no spend` : ""}`;
  const missing = roas.kind === "missing" ? roas.campaignIds : roas.kind === "value" ? roas.missing : [];
  return (
    <Stat className="relative pr-32" label="Return on ad spend" value={roas.kind === "value" ? formatRoas(roas.value) : "—"} info={info} hint={roas.kind === "all_properties_only" ? "All properties only" : roas.kind === "missing" ? "No spend entered" : `${pluralize(roas.campaigns, "campaign")} with spend`}>
      {missing.length || roas.kind === "missing" ? <div className="absolute right-4 bottom-4 sm:right-5 sm:bottom-5"><AddSpendLink onClick={() => onAddSpend(missing)} /></div> : null}
    </Stat>
  );
}

const ALL_ONLY = "All properties only";

export function DashboardTiles({ p, totals, onAddSpend }: { p: Prepared; totals: BusinessTotals; onAddSpend: (campaignIds: string[]) => void }) {
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
      <Tile label="Tracked visits" value={totals.trackedSessions === null ? "—" : totals.trackedSessions.toLocaleString("en-US")}>
        {totals.trackedSessions === null ? ALL_ONLY : "Visitors who allowed tracking, including direct arrivals. Visits, not people."}
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
      <Tile label="Booked rate" value={totals.conv === null ? "—" : formatPercent(totals.conv)}>
        {totals.trackedSessions === null
          ? ALL_ONLY
          : totals.trackedSessions
            ? `${totals.convertedSessions.toLocaleString("en-US")} converted sessions ÷ ${totals.trackedSessions.toLocaleString("en-US")} sessions started in range`
            : "No consented sessions in these dates"}
        <span className="block">Consented direct visits can also book, even without a tracked sales link.</span>
        <span className="block">{pluralize(tracked.currentLinkPaidStays, "current-link paid stay")} without a session · counted separately</span>
      </Tile>
      <Tile label="Discounts granted" value={thb(tracked.discount)}>
        Coupons on tracked sales · <Strong>{thb(all.discount)}</Strong> business total
      </Tile>
      <RoasTile roas={totals.roas} onAddSpend={onAddSpend} />
    </>
  );

  const parts = [
    { key: "tracked", label: "Tracked links", money: tracked, color: "var(--primary)" },
    { key: "unknown", label: "Not tracked", money: unknown, color: "var(--chart-s0)" },
    { key: "staff", label: "Staff-entered", money: staff, color: "var(--chart-s0b)" },
    { key: "messaging", label: "Messaging", money: messaging, color: "var(--chart-s5)" },
  ].filter((part) => part.key === "tracked" || part.money.sales > 0);
  const positive = Math.max(1, parts.reduce((total, part) => total + Math.max(0, part.money.net), 0));
  const share = (net: number) => Math.round((Math.max(0, net) / positive) * 100);
  const countOf = (m: { paid: number; paidOther: number; couponOnlySettlements: number }) => (p.cash ? `${m.paid} first paid · ${m.couponOnlySettlements} coupon-only` : `${m.paid} paid${m.paidOther ? ` + ${m.paidOther} orders` : ""}`);

  const trackingBreakdown = <>
<div role="img" aria-label={`Net collected by tracking: ${parts.map((part) => `${part.label} ${thb(part.money.net)}`).join(", ")}`} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
              {parts.filter((part) => part.money.net > 0).map((part) => <span key={part.key} className="block h-2 rounded-full" style={{ flex: `${part.money.net} 1 0`, background: part.color }} />)}
            </div>
            <ul className="grid gap-2 text-[13px] text-muted-foreground">
              {parts.map((part) => <li key={part.key} className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full" style={{ background: part.color }} /><span className="flex-1">{part.label}</span><span className="money font-medium text-foreground">{thb(part.money.net)}</span></li>)}
            </ul>
  </>;

  return (
    <section aria-labelledby="kpi-title" className="grid min-w-0 gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="kpi-title" className="text-base font-semibold text-foreground">{p.cash ? "Money in and out" : "Results from tracked links"}</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">{p.cash ? "Finance view · by payment, refund and coupon settlement date" : `Sales made in these dates · credited to the ${p.filters.touch === "first" ? "first" : "last"} link clicked`}</p>
        </div>

      </header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat hero label="Net collected" value={thb(p.cash ? all.net : tracked.net)} hint={p.cash ? "Collected minus refunds" : undefined}
          info={<>Net is collected minus refunds, not profit. {p.cash ? `Tracked links: ${thb(tracked.net)} net.` : `Business total: ${thb(all.net)} after ${thb(all.refunded)} refunds.`} {countOf(all)}. {parts.map((part) => `${part.label}: ${countOf(part.money)} · ${share(part.money.net)}%`).join(". ")}</>}
          className="col-span-2 flex flex-col p-4 sm:p-6">
          <div className="mt-2 grid gap-3 border-t border-border pt-3 sm:mt-auto sm:pt-4">
            <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] text-muted-foreground">Business total</span>
              <span className="money text-lg font-semibold">{thb(all.net)} <span className="text-xs font-normal text-muted-foreground">net</span></span>
            </div>
            <Disclosure label="Tracking breakdown" className="sm:hidden" contentClassName="grid gap-3">{trackingBreakdown}</Disclosure>
            <div className="hidden gap-3 sm:grid">{trackingBreakdown}</div>
          </div>
        </Stat>
        <div className="col-span-2 grid grid-cols-2 gap-4 md:grid-cols-3 lg:col-span-3 [&>*:last-child:nth-child(odd)]:col-span-2">{tiles}</div>
      </div>
    </section>
  );
}
