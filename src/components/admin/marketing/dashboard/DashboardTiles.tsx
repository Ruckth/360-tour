"use client";

import { Button, ButtonLink } from "@/components/ui/button";
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
  "Paid bookings": "From tracked links",
  "Booked rate": "Distinct converted sessions ÷ tracked visits",
};
function Tile({ label, value, children, hint }: { label: string; value: ReactNode; children: ReactNode; hint?: string }) {
  return <Stat label={label} value={value} info={children} hint={hint ?? HINTS[label]} className="gap-1 px-4 py-3 sm:p-4" />;
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

function RoasTile({ roas, eligible, campaignsHref, onAddSpend }: { roas: Roas; eligible: string[]; campaignsHref: string; onAddSpend: (campaignIds: string[]) => void }) {
  const info = roas.kind === "all_properties_only" ? "All properties only: spend isn’t split by property."
    : roas.kind === "missing" ? "No spend entered for these dates."
      : `${thb(Math.round(roas.net))} net ÷ ${thb(Math.round(roas.spend))} spend · ${pluralize(roas.campaigns, "campaign")} with spend${roas.missing.length ? ` · ${pluralize(roas.missing.length, "more campaign")} with sales have no spend` : ""}`;
  const missing = roas.kind === "missing" ? roas.campaignIds : roas.kind === "value" ? roas.missing : [];
  const addable = missing.filter((id) => eligible.includes(id));
  const { capabilities } = useMarketingAccess();
  return (
    <Stat className="gap-1 px-4 py-3 sm:p-4" label="Return on ad spend" value={roas.kind === "value" ? formatRoas(roas.value) : "—"} info={info} hint={roas.kind === "all_properties_only" ? "All properties only" : roas.kind === "missing" ? "No spend entered" : `Net from ${pluralize(roas.campaigns, "campaign")} with spend${roas.missing.length ? `; ${pluralize(roas.missing.length, "sales campaign")} without spend excluded` : ""}`}>
      {addable.length ? <div className="pt-1"><AddSpendLink onClick={() => onAddSpend(addable)} /></div> : roas.kind === "missing" && capabilities.spend ? <p className="text-xs">Add spend is available for active campaigns. <ButtonLink href={campaignsHref} variant="link" size="sm" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11">Review campaigns</ButtonLink></p> : null}
    </Stat>
  );
}

const ALL_ONLY = "All properties only";

export function DashboardTiles({ p, totals, onAddSpend, definitionsAction, campaignsHref }: { p: Prepared; totals: BusinessTotals; onAddSpend: (campaignIds: string[]) => void; definitionsAction: ReactNode; campaignsHref: string }) {
  const { tracked, unknown, staff, messaging, all } = totals;
  const eligible = p.report.campaigns.filter((campaign) => campaign.status === "active").map((campaign) => campaign.id);
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
      <RoasTile roas={totals.roas} eligible={eligible} campaignsHref={campaignsHref} onAddSpend={onAddSpend} />
    </>
  ) : (
    <>
      <Tile label="Tracked visits" value={totals.trackedSessions === null ? "—" : totals.trackedSessions.toLocaleString("en-US")}>
        {totals.trackedSessions === null ? ALL_ONLY : "Visits with tracking consent include direct arrivals."}
      </Tile>
      <Tile label="Paid bookings" value={tracked.paid.toLocaleString("en-US")}>
        Of {all.paid.toLocaleString("en-US")} paid stays, {tracked.paid.toLocaleString("en-US")} came from tracked links; {pluralize(all.paidOther, "checkout order")} {all.paidOther === 1 ? "counts" : "count"} in money only.
      </Tile>
      <Tile label="Booked rate" hint={totals.trackedSessions === null ? ALL_ONLY : `${pluralize(totals.convertedSessions, "converted session")} ÷ ${pluralize(totals.trackedSessions, "consented visit")}`} value={totals.conv === null ? "—" : formatPercent(totals.conv)}>
        {totals.trackedSessions === null ? ALL_ONLY : "Distinct consented sessions behind paid web stays ÷ consented sessions started in the range, including direct visits."}
      </Tile>
      <Tile label="Discounts granted" value={thb(tracked.discount)}>
        Coupons on tracked sales · <Strong>{thb(all.discount)}</Strong> business total
      </Tile>
      <RoasTile roas={totals.roas} eligible={eligible} campaignsHref={campaignsHref} onAddSpend={onAddSpend} />
    </>
  );

  const parts = [
    { key: "tracked", label: "Tracked links", money: tracked, color: "var(--primary)" },
    { key: "unknown", label: "Not tracked", money: unknown, color: "var(--chart-s0)" },
    { key: "staff", label: "Staff-entered", money: staff, color: "var(--chart-s0b)" },
    { key: "messaging", label: "Messaging", money: messaging, color: "var(--chart-s5)" },
  ].filter((part) => part.key === "tracked" || part.money.sales > 0 || part.money.net < 0);
  const hasNegativeNet = parts.some((part) => part.money.net < 0);

  const trackingBreakdown = <>
    {hasNegativeNet ? <p className="text-[13px] text-muted-foreground">Refunds exceed income for some sources.</p> : (
      <div role="img" aria-label={`Net collected by tracking: ${parts.map((part) => `${part.label} ${thb(part.money.net)}`).join(", ")}`} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full">
        {parts.filter((part) => part.money.net > 0).map((part) => <span key={part.key} className="block h-2 rounded-full" style={{ flex: `${part.money.net} 1 0`, background: part.color }} />)}
      </div>
    )}
    <ul aria-label="Net collected by tracking" className="grid gap-2 text-[13px] text-muted-foreground">
      {parts.map((part) => <li key={part.key} className="flex items-center gap-2"><span aria-hidden className="size-2 rounded-full" style={{ background: part.color }} /><span className="flex-1">{part.label}</span><span className="money font-medium text-foreground">{thb(part.money.net)}</span></li>)}
    </ul>
  </>;

  return (
    <section aria-labelledby="kpi-title" className="grid min-w-0 gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 id="kpi-title" className="text-base font-semibold text-foreground">{p.cash ? "Money in and out" : "Results from tracked links"}</h2>
        </div>
        {definitionsAction}
      </header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat hero label={p.cash ? "Business net" : "Tracked net"} value={thb(p.cash ? all.net : tracked.net)} hint={p.cash ? "Collected minus refunds" : undefined}
          info="Collected minus refunds (not profit); business total includes untracked and staff-entered sales."
          className="col-span-2 flex flex-col gap-2 p-4">
          <div className="mt-1 grid gap-2 border-t border-border pt-2">
            {!p.cash ? <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[13px] text-muted-foreground">Business total</span>
              <span className="money text-lg font-semibold">{thb(all.net)} <span className="text-xs font-normal text-muted-foreground">net</span></span>
            </div> : null}
            {hasNegativeNet ? <div className="grid gap-3">{trackingBreakdown}</div> : <>
              <Disclosure label="Tracking breakdown" className="sm:hidden" contentClassName="grid gap-3">{trackingBreakdown}</Disclosure>
              <div className="hidden gap-3 sm:grid">{trackingBreakdown}</div>
            </>}
          </div>
        </Stat>
        <div className="col-span-2 grid grid-cols-2 gap-4 md:grid-cols-3 lg:col-span-3 [&>*:last-child:nth-child(odd)]:col-span-2">{tiles}</div>
      </div>
    </section>
  );
}
