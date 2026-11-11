"use client";

import { Download, ExternalLink, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { pluralize } from "../../admin-bulk";
import { StatusBadge } from "../../StatusBadge";
import { ChoiceGroup, CouponChip, EditorSheet, FactList } from "../MarketingBits";
import { useMarketingAccess } from "../MarketingAccess";
import { formatDay, formatStamp, thb } from "../marketing-format";
import { csvFileName, salesCsv, summaryCsv, type ExportKind } from "./report-csv";
import { formatRoas, roasFor, sheetLines, slugPath, sumLines, type Breakdown, type Prepared, type SaleLine } from "./report-model";

// The sales list a row drills into, the metric definitions, and the CSV export.

export type SalesSheetTarget = { title: string; sub?: string; lines: SaleLine[]; campaignId?: string };

const KIND_LABEL = { stay: "Stay", order: "Checkout order", appointment: "Desk payment" } as const;
const CHANNEL_LABEL = { web: "Website", web_chat: "Website chat", messaging: "Messaging", admin: "Admin booking", pos: "Checkout", desk: "Desk" } as const;
const SHEET_LIMIT = 25;

function SaleItem({ line, p, onOpenStay, orderHref }: { line: SaleLine; p: Prepared; onOpenStay: (id: string) => void; orderHref: (id: string) => string }) {
  const { sale, touch } = line;
  const { role } = useMarketingAccess();
  const property = sale.propertyId ? p.report.properties.find((x) => x.id === sale.propertyId)?.name : undefined;
  const refundedAll = sale.refunded > 0 && sale.refunded >= sale.collected;
  const otherFirst = p.filters.touch === "last" && sale.first && sale.last && sale.first.linkId !== sale.last.linkId ? sale.first : null;
  const net = line.collected - line.refunded;
  const action = role !== "admin" ? <span className="text-xs text-muted-foreground">Read-only sale details. Booking and receipt screens require system administrator access.</span> :
    sale.kind === "stay" ? (
      <button type="button" onClick={() => onOpenStay(sale.id)} className="inline-flex w-fit items-center gap-1 rounded text-xs font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
        Open booking
      </button>
    ) : sale.kind === "order" ? (
      <Link href={orderHref(sale.id)} className="inline-flex w-fit items-center gap-1 rounded text-xs font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
        Open order
        <ExternalLink aria-hidden className="size-3.5" />
      </Link>
    ) : (
      <span className="text-xs text-muted-foreground">Open it from Staff bookings.</span>
    );
  return (
    <li className="grid gap-2 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{sale.label}</p>
          <p className="text-xs text-muted-foreground">
            {[KIND_LABEL[sale.kind], sale.ref, property, CHANNEL_LABEL[sale.channel]].filter(Boolean).join(" · ")}
          </p>
          {touch ? (
            <p className="text-xs text-muted-foreground">
              Via <span className="font-mono text-foreground">{slugPath(touch.slug)}</span> · {touch.campaignName}
              {sale.evidence === "scanned" ? " · scanned at checkout" : sale.evidence === "current_link" ? " · link as it is now" : ""}
            </p>
          ) : null}
          {otherFirst ? <p className="text-xs text-muted-foreground">First touch {slugPath(otherFirst.slug)}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">{thb(line.collected)}</p>
          {line.refunded ? <p className="text-xs tabular-nums text-muted-foreground">−{thb(line.refunded)}</p> : null}
          {line.refunded ? <p className="text-xs font-medium tabular-nums text-foreground">{thb(net)} net</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!sale.refunded ? (
          <StatusBadge tone="success" label={sale.kind === "order" && sale.collected === 0 && sale.discount > 0 ? "Coupon-only settlement" : sale.kind === "stay" ? "Payment received" : "Paid"} />
        ) : (
          <StatusBadge tone="neutral" label={refundedAll ? "Refunded" : "Partly refunded"} />
        )}
        {sale.customPrice ? <StatusBadge tone="neutral" label="Custom price" /> : null}
        {sale.coupon ? <CouponChip code={sale.coupon.code} /> : null}
        {line.discount ? <span className="text-muted-foreground">{thb(line.discount)} off</span> : null}
        <span className="text-muted-foreground">
          {sale.kind === "stay" ? "Booked" : "Sold"} {formatDay(sale.createdDay)}
          {sale.paidDay ? ` · first payment ${formatDay(sale.paidDay)}` : ""}
          {sale.settlementDay && !sale.paidDay ? ` · coupon settlement ${formatDay(sale.settlementDay)}` : ""}
        </span>
      </div>
      {action}
    </li>
  );
}

export function SalesSheet({
  target,
  p,
  onClose,
  onOpenStay,
  orderHref,
}: {
  target: SalesSheetTarget | null;
  p: Prepared;
  onClose: () => void;
  onOpenStay: (id: string) => void;
  orderHref: (id: string) => string;
}) {
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => (target ? sheetLines(target.lines) : []), [target]);
  const money = sumLines(lines);
  const refunded = lines.filter((line) => line.refunded > 0);
  // Spend is entered per campaign, so a link's list shows its whole campaign's ROAS, never the link's net over that spend.
  const roas = target?.campaignId ? roasFor(p, [target.campaignId]) : null;
  const shown = showAll ? lines : lines.slice(0, SHEET_LIMIT);
  return (
    <EditorSheet
      open={!!target}
      onClose={() => {
        setShowAll(false);
        onClose();
      }}
      header={
        <>
          <SheetTitle>{target?.title}</SheetTitle>
          <SheetDescription>
            {target?.sub ? `${target.sub} · ` : ""}
            {p.cash ? "Payments, refunds or coupon settlements" : "Sales made"} {formatDay(p.report.from)}–{formatDay(p.report.to)} · {p.filters.touch === "first" ? "first touch" : "last touch"}
          </SheetDescription>
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="grid gap-5">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border text-sm sm:grid-cols-4">
            {[
              [p.cash ? "First-payment sales" : "Paid", `${money.paid}${money.paidOther ? ` + ${money.paidOther} orders` : ""}${money.couponOnlySettlements ? ` + ${money.couponOnlySettlements} coupon-only settlements` : ""}`],
              ["Collected", thb(money.collected)],
              ["Refunds", money.refunded ? thb(money.refunded) : "—"],
              ["Net", thb(money.net)],
            ].map(([term, value]) => (
              <div key={term} className="bg-card p-3">
                <dt className="text-xs text-muted-foreground">{term}</dt>
                <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
          {roas?.kind === "value" ? (
            <p className="text-xs text-muted-foreground">
              Whole campaign ROAS {formatRoas(roas.value)} · {thb(Math.round(roas.net))} net ÷ {thb(Math.round(roas.spend))} spend. Spend isn’t split by link.
            </p>
          ) : null}
          {refunded.length ? (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
              <Undo2 aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="min-w-0 text-muted-foreground">
                <span className="font-medium text-foreground">
                  {pluralize(refunded.length, "refund")} reduced net by {thb(money.refunded)}.
                </span>{" "}
                Sales with money received still count as first paid; refunds don’t give coupon uses back.
              </p>
            </div>
          ) : null}
          <section aria-labelledby="sales-list" className="grid gap-1">
            <h3 id="sales-list" className="admin-eyebrow">
              Sales · refunded first, then newest
            </h3>
            {lines.length ? (
              <>
                <ul className="divide-y divide-border border-y border-border">
                  {shown.map((line) => (
                    <SaleItem key={line.sale.id} line={line} p={p} onOpenStay={onOpenStay} orderHref={orderHref} />
                  ))}
                </ul>
                {lines.length > shown.length ? (
                  <Button type="button" variant="outline" size="sm" className="mt-3 w-full" onClick={() => setShowAll(true)}>
                    Show all {lines.length} sales
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">No sales in these dates.</p>
            )}
          </section>
        </div>
      </div>
    </EditorSheet>
  );
}

const DEFINITIONS: [string, string][] = [
  ["Consented session", "A visit recorded after the guest allowed measurement, including direct arrivals. Sessions are visits, not people: one guest can make several, and guests who decline aren’t counted, so sessions undercount."],
  ["Paid booking", "A stay with at least one recorded payment. A later refund keeps it paid but lowers net. Checkout orders and desk payments are in the money figures but not in this count."],
  ["Session conversion", "Distinct consented sessions behind tracked paid stays ÷ sessions started in the range. Several stays from one session count once; sessions outside the range are excluded. Breakdown rates follow the session’s recorded link and campaign, independently of first/last sales attribution. Current-link paid stays without a session are counted separately."],
  ["Collected and net", "Collected is money actually received, after discounts. Net is collected minus refunds. Net is not profit: costs, commissions and taxes aren’t taken off."],
  ["First-payment sales", "Finance counts sales receiving their first actual payment in range. A partial stay payment counts; this does not mean the stay is fully settled. Coupon-only checkout settlements are counted separately."],
  ["Coupon-only checkout settlements", "Checkout orders with a positive coupon discount and no own cash received, dated by settlement. A mixed stay and service checkout counts stay cash once on the stay and fully covered services once here."],
  ["Discounts granted", "Coupon discounts dated by first payment for stays and desk sales, or checkout settlement for orders. Includes fully coupon-covered orders. Custom-price stays retain coupon usage and attribution but report zero coupon discount and show a Custom price flag. The direct-booking offer isn’t included. A real void or refund keeps the use; voiding money never received releases it."],
  ["Ad ROAS", "Net of a campaign’s sales ÷ the spend entered for the same dates (spread evenly over each entry’s days). A source’s ROAS covers its campaigns that have spend. No spend means no ROAS, never ฿0. ROAS shows what came back, not that the ad caused the sale."],
  ["Last touch and first touch", "Rule last_touch_30d@1: last touch credits the last tracked link the guest opened within 30 days before booking; first touch credits the first. Both split the same sales, so never add them together. Scanned and current-link sales have one touch, used for both."],
  ["Marketing view and Finance view", "Marketing (visit cohort) shows sales made in the dates with all their money to date. Finance (cash date) counts each payment and refund on its business date, including money for older sales. It also includes coupon discounts on checkout settlements in range, without adding a cash payment."],
  ["Unknown, staff-entered and messaging", "Unknown: website bookings with no tracked link (typed address, declined measurement, another device). Staff-entered: admin bookings, checkout orders and desk payments. Messaging: stays booked through LINE, WhatsApp, Messenger or Instagram. All count in business totals, never in conversion."],
  ["Coupon table", "Regroups the same sales by the coupon used, tracked or not. It overlaps the other tables, so never add it to the Source table."],
  ["Property filter", "Keeps sales for that property. Sales without one, such as checkout orders, show only under All properties. Sessions, conversion and ROAS are for All properties only."],
  ["Time zone and currency", "Days are Bangkok days (Asia/Bangkok). Money is THB; sales in another currency are left out and counted in a note."],
];

export function DefinitionsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <EditorSheet
      open={open}
      onClose={onClose}
      header={
        <>
          <SheetTitle>Metric definitions</SheetTitle>
          <SheetDescription>What each number counts, and what it doesn’t.</SheetDescription>
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <dl className="divide-y divide-border border-y border-border text-sm">
          {DEFINITIONS.map(([term, text]) => (
            <div key={term} className="grid gap-1 py-3">
              <dt className="font-semibold text-foreground">{term}</dt>
              <dd className="text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">Numbers may differ from Google Analytics or ad platforms, which use their own identity and attribution rules.</p>
      </div>
    </EditorSheet>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportDialog({
  open,
  onOpenChange,
  p,
  breakdown,
  pathLabel,
  propertyName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  p: Prepared;
  breakdown: Breakdown;
  pathLabel: string;
  propertyName: string;
}) {
  const [kind, setKind] = useState<ExportKind>("summary");
  const csv = useMemo(
    () => (open ? (kind === "summary" ? summaryCsv(p, propertyName, breakdown, pathLabel) : salesCsv(p, propertyName)) : ""),
    [open, kind, p, propertyName, breakdown, pathLabel],
  );
  const preview = csv.replace(/^﻿/, "").split("\r\n").slice(0, 15).join("\n");
  const tab = { source: "Source", campaign: "Campaign", link: "Link", coupon: "Coupon" }[breakdown.view];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export CSV</DialogTitle>
          <DialogDescription>Built from the figures on screen. The first lines say how they were counted.</DialogDescription>
        </DialogHeader>
        <ChoiceGroup<ExportKind>
          name="export-kind"
          label="What to export"
          value={kind}
          onChange={setKind}
          columns="grid-cols-1"
          options={[
            { value: "summary", label: "This table", hint: `${tab}${pathLabel ? ` · ${pathLabel}` : ""}, with its totals` },
            { value: "sales", label: "One row per sale", hint: pluralize(p.lines.length, "sale") },
          ]}
        />
        <FactList
          className="rounded-lg border border-border p-3"
          rows={[
            ["Dates", `${formatDay(p.report.from)}–${formatDay(p.report.to)}`],
            ["Basis", p.cash ? "Finance (cash date)" : "Marketing (visit cohort)"],
            ["Attribution", `${p.report.model} · ${p.filters.touch === "first" ? "first touch" : "last touch"}`],
            ["Property", propertyName],
            ["As of", `${formatStamp(p.report.asOf)} · Asia/Bangkok · THB`],
          ]}
        />
        <div className="grid min-w-0 gap-2">
          <p className="admin-eyebrow">First lines</p>
          <pre data-testid="csv-preview" role="region" aria-label="First lines of the CSV" tabIndex={0} className="max-h-44 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg bg-muted/60 p-3 font-mono text-[11px] leading-5 text-foreground">
            {preview}
          </pre>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              download(csvFileName(p, kind), csv);
              onOpenChange(false);
            }}
          >
            <Download aria-hidden className="size-4" />
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
