"use client";

import { Info } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Stat } from "@/components/ui/stat";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
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

function SecondaryMetric({
  label,
  value,
  info,
  hint,
  inlineDefinitions,
  children,
}: {
  label: string;
  value: ReactNode;
  info: ReactNode;
  hint?: string;
  inlineDefinitions: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const defId = useId();
  const aboutLabel = `About ${label.toLowerCase()}`;

  if (!inlineDefinitions) {
    return (
      <Stat
        label={label}
        value={value}
        info={info}
        hint={hint}
        className="gap-1 px-4 py-3 sm:p-4 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-0 max-sm:shadow-none"
      >
        {children}
      </Stat>
    );
  }

  return (
    <div data-slot="stat" className="grid min-w-0 content-start gap-1 py-3">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>{label}</span>
        <button
          type="button"
          aria-label={aboutLabel}
          aria-expanded={open}
          aria-controls={defId}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            "relative inline-grid size-5 shrink-0 place-items-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // A 44px touch target without shifting the label row.
            "after:absolute after:-inset-3 after:content-['']",
            open && "text-gold-text",
          )}
        >
          <Info aria-hidden className="size-4" />
        </button>
      </div>
      <div
        id={defId}
        hidden={!open}
        className="mt-1 mb-0.5 rounded-[10px] bg-secondary px-2.5 py-2 text-[13px] leading-5 text-secondary-foreground"
      >
        {open ? info : null}
      </div>
      <p className="wrap-anywhere font-sans text-[26px] leading-tight font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      {hint ? <p className="text-balance text-[13px] text-muted-foreground" title={hint}>{hint}</p> : null}
      {children}
    </div>
  );
}

function Tile({ label, value, children, hint, inlineDefinitions }: { label: string; value: ReactNode; children: ReactNode; hint?: string; inlineDefinitions: boolean }) {
  return <SecondaryMetric label={label} value={value} info={children} hint={hint ?? HINTS[label]} inlineDefinitions={inlineDefinitions} />;
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

function RoasTile({ roas, eligible, campaignsHref, onAddSpend, inlineDefinitions }: { roas: Roas; eligible: string[]; campaignsHref: string; onAddSpend: (campaignIds: string[]) => void; inlineDefinitions: boolean }) {
  const info = roas.kind === "all_properties_only" ? "All properties only: spend isn’t split by property."
    : roas.kind === "missing" ? "No spend entered for these dates."
      : `${thb(Math.round(roas.net))} net ÷ ${thb(Math.round(roas.spend))} spend · ${pluralize(roas.campaigns, "campaign")} with spend${roas.missing.length ? ` · ${pluralize(roas.missing.length, "more campaign")} with sales have no spend` : ""}`;
  const missing = roas.kind === "missing" ? roas.campaignIds : roas.kind === "value" ? roas.missing : [];
  const addable = missing.filter((id) => eligible.includes(id));
  const { capabilities } = useMarketingAccess();
  return (
    <SecondaryMetric
      label="Return on ad spend"
      value={roas.kind === "value" ? formatRoas(roas.value) : "—"}
      info={info}
      hint={roas.kind === "all_properties_only" ? "All properties only" : roas.kind === "missing" ? "No spend entered" : `Net from ${pluralize(roas.campaigns, "campaign")} with spend${roas.missing.length ? `; ${pluralize(roas.missing.length, "sales campaign")} without spend excluded` : ""}`}
      inlineDefinitions={inlineDefinitions}
    >
      {addable.length ? <div className="pt-1"><AddSpendLink onClick={() => onAddSpend(addable)} /></div> : roas.kind === "missing" && capabilities.spend ? <p className="text-xs">Add spend is available for active campaigns. <ButtonLink href={campaignsHref} variant="link" size="sm" className="pointer-coarse:min-h-11 pointer-coarse:min-w-11">Review campaigns</ButtonLink></p> : null}
    </SecondaryMetric>
  );
}

const ALL_ONLY = "All properties only";

export function DashboardTiles({ p, totals, onAddSpend, definitionsAction, campaignsHref }: { p: Prepared; totals: BusinessTotals; onAddSpend: (campaignIds: string[]) => void; definitionsAction: ReactNode; campaignsHref: string }) {
  const { tracked, unknown, staff, messaging, all } = totals;
  const isPhone = useIsMobile(640);
  const eligible = p.report.campaigns.filter((campaign) => campaign.status === "active").map((campaign) => campaign.id);
  const tiles = p.cash ? (
    <>
      <Tile key="cash-collected" label="Collected" value={thb(all.collected)} inlineDefinitions={isPhone}>
        Payments dated in range · tracked <Strong>{thb(tracked.collected)}</Strong>
      </Tile>
      <Tile key="cash-refunds" label="Refunds" value={thb(all.refunded)} inlineDefinitions={isPhone}>
        Refunds dated in range · tracked <Strong>{thb(tracked.refunded)}</Strong>
      </Tile>
      <Tile key="cash-first-payment" label="First-payment sales" value={all.paid.toLocaleString("en-US")} inlineDefinitions={isPhone}>
        Sales receiving their first payment in range · tracked <Strong>{tracked.paid.toLocaleString("en-US")}</Strong>
        <span className="block">{pluralize(all.couponOnlySettlements, "coupon-only checkout settlement")}</span>
      </Tile>
      <Tile key="cash-discounts" label="Discounts granted" value={thb(all.discount)} inlineDefinitions={isPhone}>
        Coupons at first payment or checkout settlement in range · tracked <Strong>{thb(tracked.discount)}</Strong>
      </Tile>
      <RoasTile key="cash-roas" roas={totals.roas} eligible={eligible} campaignsHref={campaignsHref} onAddSpend={onAddSpend} inlineDefinitions={isPhone} />
    </>
  ) : (
    <>
      <Tile key="cohort-visits" label="Tracked visits" value={totals.trackedSessions === null ? "—" : totals.trackedSessions.toLocaleString("en-US")} inlineDefinitions={isPhone}>
        {totals.trackedSessions === null ? ALL_ONLY : "Visits with tracking consent include direct arrivals."}
      </Tile>
      <Tile key="cohort-paid" label="Paid bookings" value={tracked.paid.toLocaleString("en-US")} inlineDefinitions={isPhone}>
        Of {all.paid.toLocaleString("en-US")} paid stays, {tracked.paid.toLocaleString("en-US")} came from tracked links; {pluralize(all.paidOther, "checkout order")} {all.paidOther === 1 ? "counts" : "count"} in money only.
      </Tile>
      <Tile key="cohort-rate" label="Booked rate" hint={totals.trackedSessions === null ? ALL_ONLY : `${pluralize(totals.convertedSessions, "converted session")} ÷ ${pluralize(totals.trackedSessions, "consented visit")}`} value={totals.conv === null ? "—" : formatPercent(totals.conv)} inlineDefinitions={isPhone}>
        {totals.trackedSessions === null ? ALL_ONLY : "Distinct consented sessions behind paid web stays ÷ consented sessions started in the range, including direct visits."}
      </Tile>
      <Tile key="cohort-discounts" label="Discounts granted" value={thb(tracked.discount)} inlineDefinitions={isPhone}>
        Coupons on tracked sales · <Strong>{thb(all.discount)}</Strong> business total
      </Tile>
      <RoasTile key="cohort-roas" roas={totals.roas} eligible={eligible} campaignsHref={campaignsHref} onAddSpend={onAddSpend} inlineDefinitions={isPhone} />
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
      {/* Tablets put the hero beside a two-column tile grid instead of stacking a full-width hero
          over the tiles, so the chart starts about one tile row sooner; desktop gets three columns. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat hero label={p.cash ? "Business net" : "Tracked net"} value={thb(p.cash ? all.net : tracked.net)} hint={p.cash ? "Collected minus refunds" : undefined}
          info="Collected minus refunds (not profit); business total includes untracked and staff-entered sales."
          className="@container col-span-2 flex flex-col gap-2 p-4 [&>p:first-of-type]:wrap-anywhere [&>p:first-of-type]:text-[clamp(1.75rem,12cqi,2.5rem)]">
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
        <div
          data-slot="secondary-metrics"
          className="col-span-2 grid grid-cols-1 max-sm:divide-y max-sm:divide-border max-sm:rounded-xl max-sm:border max-sm:border-border max-sm:bg-card max-sm:px-4 max-sm:py-0.5 max-sm:text-card-foreground max-sm:shadow-sm sm:grid-cols-2 sm:gap-4 md:col-span-3 lg:grid-cols-3 sm:[&>*:last-child:nth-child(odd)]:col-span-2"
        >
          {tiles}
        </div>
      </div>
    </section>
  );
}
