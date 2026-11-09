import { toCsv } from "@/lib/admin/csv";
import { formatStamp } from "../marketing-format";
import { slugPath, type Breakdown, type BreakdownRow, type Prepared, type Roas, type TotalRow } from "./report-model";

// The dashboard's CSV export, built in the browser from the same read. Amounts are whole baht as
// plain numbers; refunds are positive (a leading minus would be prefixed by the formula guard).

export type ExportKind = "summary" | "sales";

const VIEW_LABEL = { source: "Source", campaign: "Campaign", link: "Link", coupon: "Coupon" } as const;

/** The `#` lines at the top of every export, so a file explains itself when it's forwarded. */
export function csvMeta(p: Prepared, propertyName: string): string[][] {
  const { report, filters } = p;
  return [
    [`# Marketing report`],
    [`# Time zone: ${report.timeZone}`],
    [`# Currency: ${report.currency}`],
    [`# Attribution: ${report.model} (${filters.touch === "first" ? "first touch" : "last touch"})`],
    [`# Basis: ${report.basis === "cash" ? "Finance (cash date: money dated in range)" : "Marketing (visit cohort: sales made in range, all their money to date)"}`],
    [`# Dates: ${report.from} to ${report.to}`],
    [`# Property: ${propertyName}`],
    [`# As of: ${formatStamp(report.asOf)} ${report.timeZone}`],
    ...(report.truncated ? [[`# Incomplete: the read limit was reached, so figures are partial`]] : []),
    ...(report.excluded.nonThb ? [[`# Left out: ${report.excluded.nonThb} sales in another currency`]] : []),
  ];
}

const amount = (value: number) => String(Math.round(value));
const roasCells = (roas: Roas | undefined): [string, string] =>
  roas?.kind === "value" ? [roas.value.toFixed(2), amount(roas.spend)] : roas?.kind === "all_properties_only" ? ["all properties only", ""] : ["", ""];

export function summaryCsv(p: Prepared, propertyName: string, table: Breakdown, path: string): string {
  const header = [
    "Row",
    VIEW_LABEL[table.view],
    "Detail",
    ...(table.showSessions ? ["Sessions"] : []),
    "Paid",
    "Other paid sales",
    ...(table.showSessions ? ["Conversion %"] : []),
    "Discounts",
    "Collected",
    "Refunds",
    "Net",
    ...(table.showRoas ? ["ROAS", "Spend in range"] : []),
  ];
  const line = (type: string, row: BreakdownRow | TotalRow, detail: string) => [
    type,
    row.name,
    detail,
    ...(table.showSessions ? [row.sessions === null ? "" : String(row.sessions)] : []),
    String(row.paid),
    String(row.paidOther),
    ...(table.showSessions ? [row.conv === null ? "" : (row.conv * 100).toFixed(2)] : []),
    amount(row.discount),
    amount(row.collected),
    amount(row.refunded),
    amount(row.net),
    ...(table.showRoas ? roasCells(row.roas) : []),
  ];
  return toCsv([
    ...csvMeta(p, propertyName),
    [`# Table: ${VIEW_LABEL[table.view]}${path ? ` · ${path}` : ""}`],
    ...(table.view === "coupon" ? [[`# Coupons regroup the same sales: never add this table to the source table`]] : []),
    header,
    ...table.rows.map((row) => line("tracked", row, row.sub ?? "")),
    ...table.pinned.map((row) => line(row.kind === "none" ? "no coupon" : "not tracked", row, row.sub ?? "")),
    ...table.totals.map((row) => line("total", row, row.note ?? "")),
  ]);
}

export function salesCsv(p: Prepared, propertyName: string): string {
  const properties = new Map(p.report.properties.map((x) => [x.id as string, x.name]));
  const header = [
    "Kind", "Id", "Reference", "Guest or customer", "Property", "Channel", "Tracking", "Evidence", "Source", "Medium", "Campaign",
    "Link", "Coupon", "Created day", "Paid day", "Paid", "Collected", "Refunds", "Discount", "Net",
  ];
  const rows = p.lines.map(({ sale, touch, group, paid, paidOther, collected, refunded, discount }) => [
    sale.kind,
    sale.id,
    sale.ref ?? "",
    sale.label,
    sale.propertyId ? (properties.get(sale.propertyId) ?? "") : "",
    sale.channel,
    group,
    sale.evidence ?? "",
    touch?.source ?? "",
    touch?.medium ?? "",
    touch?.campaignName ?? "",
    touch ? slugPath(touch.slug) : "",
    sale.coupon?.code ?? "",
    sale.createdDay,
    sale.paidDay ?? "",
    paid || paidOther ? "yes" : "no",
    amount(collected),
    amount(refunded),
    amount(discount),
    amount(collected - refunded),
  ]);
  return toCsv([...csvMeta(p, propertyName), header, ...rows]);
}

export function csvFileName(p: Prepared, kind: ExportKind) {
  return `marketing-${kind}-${p.report.basis}-${p.report.from}-to-${p.report.to}.csv`;
}
