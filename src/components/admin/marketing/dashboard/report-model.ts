import {
  MAX_REPORT_DAYS,
  reportDayCount,
  spendInRange,
  type ReportBucket,
  type ReportData,
  type ReportSale,
  type ReportTouch,
} from "convex/lib/marketingReport";

// The dashboard's numbers, worked out in the browser from one getReport read. No React, so every
// rule here is unit-tested (tests/unit/marketing-dashboard-model.test.ts).
//
// Rules:
// - Property filter keeps sales with that propertyId. Sessions, conversion and ROAS only exist for
//   All properties: sessions and spend have no property.
// - Last touch reads `sale.last`; first touch reads `sale.first ?? sale.last`. One touch per sale, so
//   the two are never added together.
// - Cohort basis: money is each sale's collected / refunded / discount; Paid counts paid stays, and
//   paid orders and desk payments are counted apart (they're in the money). Cash basis: collected and
//   refunds are the sale's events dated in range, discount counts when paidDay is in range, and Paid
//   counts sales whose paidDay is in range.
// - Conversion = tracked paid stays ÷ tracked sessions of the same links. Unknown, staff-entered and
//   messaging sales count in business totals, never in conversion.
// - ROAS = net of a campaign's sales ÷ its spend in range. A source's ROAS sums its campaigns that have
//   spend. No spend → unavailable, never ฿0.

export type Touch = "last" | "first";
export type BreakdownView = "source" | "campaign" | "link" | "coupon";
export type PropertyFilter = "all" | string;
export type ReportFilters = { property: PropertyFilter; touch: Touch };
export type DrillStep = { level: "source"; id: string } | { level: "campaign"; id: string };
export type SortKey = "name" | "sessions" | "paid" | "conv" | "discount" | "collected" | "refunded" | "net" | "roas";
export type Sort = { key: SortKey; dir: "asc" | "desc" };

/** One sale with its touch and its money under the current basis. */
export type SaleLine = {
  sale: ReportSale;
  touch?: ReportTouch;
  group: ReportBucket;
  /** Cohort: a paid stay. Cash: paidDay in range (any kind). */
  paid: number;
  /** Cohort only: a paid checkout order or desk payment (counted in money, not in Paid). */
  paidOther: number;
  collected: number;
  refunded: number;
  discount: number;
};

export type Money = {
  sales: number;
  paid: number;
  paidOther: number;
  collected: number;
  refunded: number;
  discount: number;
  net: number;
};

export type Roas =
  | { kind: "value"; value: number; net: number; spend: number; campaigns: number; /** Campaigns with sales here and no spend. */ missing: string[] }
  /** No spend entered in range: `campaignIds` are the campaigns spend can be added to. */
  | { kind: "missing"; campaignIds: string[] }
  /** A property is selected: spend isn't split by property. */
  | { kind: "all_properties_only" };

export type RowKind = "tracked" | "unknown" | "staff" | "messaging" | "none";

export type BreakdownRow = Money & {
  key: string;
  kind: RowKind;
  name: string;
  sub?: string;
  /** "link" rows use a mono slug. */
  mono?: boolean;
  status?: string;
  /** null: not applicable (not tracked, coupon tab, or a property is selected). */
  sessions: number | null;
  conv: number | null;
  roas?: Roas;
  /** Where selecting the row goes: one level down, or the sales list. */
  drill: DrillStep | { level: "sales" };
  lines: SaleLine[];
};

export type TotalRow = Money & { key: string; name: string; note?: string; sessions: number | null; conv: number | null; roas?: Roas };

export type Breakdown = {
  view: BreakdownView;
  path: DrillStep[];
  /** Tracked rows first, then the pinned "Not tracked" rows (or "No coupon"). */
  rows: BreakdownRow[];
  pinned: BreakdownRow[];
  totals: TotalRow[];
  showSessions: boolean;
  showRoas: boolean;
};

export const BUCKET_LABEL: Record<Exclude<RowKind, "tracked">, { name: string; sub: string }> = {
  unknown: { name: "Unknown / untracked", sub: "Web bookings with no tracked link" },
  staff: { name: "Staff-entered", sub: "Admin bookings, checkout orders and desk payments" },
  messaging: { name: "Messaging", sub: "Stays booked through LINE, WhatsApp, Messenger or Instagram" },
  none: { name: "No coupon", sub: "Direct-booking offer or full price" },
};

/** "f1" or "/f1" → "/f1". */
export const slugPath = (slug: string) => `/${slug.replace(/^\/+/, "")}`;

// ---------------------------------------------------------------- dates

export function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export const PRESETS = [
  { id: "last7", label: "Last 7 days" },
  { id: "last30", label: "Last 30 days" },
  { id: "last90", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "prev30", label: "Previous 30 days" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"];
export type RangeChoice = { preset: PresetId | "custom"; from: string; to: string };

/** Rolling ranges end yesterday, so every day in them is complete; This month runs to today. */
export function presetRange(id: PresetId, today: string): { from: string; to: string } {
  const yesterday = addDays(today, -1);
  switch (id) {
    case "last7":
      return { from: addDays(today, -7), to: yesterday };
    case "last30":
      return { from: addDays(today, -30), to: yesterday };
    case "last90":
      return { from: addDays(today, -90), to: yesterday };
    case "month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "prev30":
      return { from: addDays(today, -60), to: addDays(today, -31) };
  }
}

/** The first problem with a custom range in plain words, or null. */
export function customRangeProblem(from: string, to: string, today: string): string | null {
  if (!from || !to) return "Choose both dates.";
  const days = reportDayCount(from, to);
  if (days === null) return "Choose a start date on or before the end date.";
  if (to > today) return "The end date can’t be after today.";
  if (days > MAX_REPORT_DAYS) return `Choose at most ${MAX_REPORT_DAYS} days.`;
  return null;
}

// ---------------------------------------------------------------- preparing the read

export type Prepared = {
  report: ReportData;
  filters: ReportFilters;
  cash: boolean;
  allProperties: boolean;
  lines: SaleLine[];
  campaigns: Map<string, ReportData["campaigns"][number]>;
  links: Map<string, ReportData["links"][number]>;
  coupons: Map<string, ReportData["coupons"][number]>;
  /** Tracked sessions (with a link), by link, campaign and source. Empty unless All properties. */
  sessions: { byLink: Map<string, number>; byCampaign: Map<string, number>; bySource: Map<string, number>; /** campaign → link → sessions */ byCampaignLink: Map<string, Map<string, number>>; tracked: number };
  /** Spend in range per campaign (prorated by days), only campaigns with spend > 0. */
  spend: Map<string, number>;
};

/** The touch a sale is credited to; undefined for sales that aren't tracked. */
export function saleTouch(sale: ReportSale, touch: Touch): ReportTouch | undefined {
  if (sale.bucket !== "tracked") return undefined;
  return touch === "first" ? (sale.first ?? sale.last) : sale.last;
}

function add(map: Map<string, number>, key: string | undefined, value: number) {
  if (key === undefined) return;
  map.set(key, (map.get(key) ?? 0) + value);
}

export function prepareReport(report: ReportData, filters: ReportFilters): Prepared {
  const cash = report.basis === "cash";
  const allProperties = filters.property === "all";
  const inRange = (day?: string) => !!day && day >= report.from && day <= report.to;

  const events = new Map<string, { collected: number; refunded: number }>();
  if (cash) {
    for (const event of report.events) {
      if (!inRange(event.day)) continue;
      const entry = events.get(event.saleId) ?? { collected: 0, refunded: 0 };
      if (event.kind === "payment") entry.collected += event.amount;
      else entry.refunded += event.amount;
      events.set(event.saleId, entry);
    }
  }

  const lines: SaleLine[] = [];
  for (const sale of report.sales) {
    if (!allProperties && sale.propertyId !== filters.property) continue;
    const touch = saleTouch(sale, filters.touch);
    // A tracked sale without a touch can't be credited to a link: it's shown as unknown.
    const group: ReportBucket = sale.bucket === "tracked" && !touch ? "unknown" : sale.bucket;
    if (cash) {
      const money = events.get(sale.id) ?? { collected: 0, refunded: 0 };
      const paidInRange = inRange(sale.paidDay);
      lines.push({ sale, touch, group, paid: paidInRange ? 1 : 0, paidOther: 0, ...money, discount: paidInRange ? sale.discount : 0 });
    } else {
      const isStay = sale.kind === "stay";
      lines.push({
        sale,
        touch,
        group,
        paid: sale.paid && isStay ? 1 : 0,
        paidOther: sale.paid && !isStay ? 1 : 0,
        collected: sale.collected,
        refunded: sale.refunded,
        discount: sale.discount,
      });
    }
  }

  const campaigns = new Map(report.campaigns.map((c) => [c.id as string, c]));
  const links = new Map(report.links.map((l) => [l.id as string, l]));
  const coupons = new Map(report.coupons.map((c) => [c.id as string, c]));

  const sessions = { byLink: new Map<string, number>(), byCampaign: new Map<string, number>(), bySource: new Map<string, number>(), byCampaignLink: new Map<string, Map<string, number>>(), tracked: 0 };
  if (allProperties) {
    for (const row of report.sessions) {
      if (!row.linkId || !inRange(row.day)) continue;
      // The campaign the link belonged to when the session was counted; the link's campaign now only for a row without one.
      const campaignId = row.campaignId ?? links.get(row.linkId)?.campaignId;
      add(sessions.byLink, row.linkId, row.count);
      add(sessions.byCampaign, campaignId, row.count);
      add(sessions.bySource, campaignId ? campaigns.get(campaignId)?.source : undefined, row.count);
      if (campaignId) {
        const ofCampaign = sessions.byCampaignLink.get(campaignId) ?? new Map<string, number>();
        add(ofCampaign, row.linkId, row.count);
        sessions.byCampaignLink.set(campaignId, ofCampaign);
      }
      sessions.tracked += row.count;
    }
  }

  const spend = new Map<string, number>();
  for (const entry of report.spend) add(spend, entry.campaignId, spendInRange(entry, report.from, report.to));
  for (const [id, amount] of spend) if (!(amount > 0)) spend.delete(id);

  return { report, filters, cash, allProperties, lines, campaigns, links, coupons, sessions, spend };
}

// ---------------------------------------------------------------- sums

export function sumLines(lines: readonly SaleLine[]): Money {
  const money: Money = { sales: lines.length, paid: 0, paidOther: 0, collected: 0, refunded: 0, discount: 0, net: 0 };
  for (const line of lines) {
    money.paid += line.paid;
    money.paidOther += line.paidOther;
    money.collected += line.collected;
    money.refunded += line.refunded;
    money.discount += line.discount;
  }
  money.net = money.collected - money.refunded;
  return money;
}

const ratio = (paid: number, sessions: number | null) => (sessions ? paid / sessions : null);

/** ROAS for a set of campaigns: the net of those that have spend ÷ their spend. */
export function roasFor(p: Prepared, campaignIds: readonly string[], lines: readonly SaleLine[] = p.lines): Roas {
  if (!p.allProperties) return { kind: "all_properties_only" };
  const withSpend = campaignIds.filter((id) => p.spend.has(id));
  if (!withSpend.length) return { kind: "missing", campaignIds: [...campaignIds] };
  const ids = new Set(withSpend);
  const net = sumLines(lines.filter((line) => line.touch && ids.has(line.touch.campaignId))).net;
  const spend = withSpend.reduce((total, id) => total + p.spend.get(id)!, 0);
  const missing = campaignIds.filter((id) => !ids.has(id) && lines.some((line) => line.touch?.campaignId === id));
  return { kind: "value", value: net / spend, net, spend, campaigns: withSpend.length, missing };
}

export type BusinessTotals = Record<ReportBucket, Money> & { all: Money; trackedSessions: number | null; conv: number | null; roas: Roas };

export function businessTotals(p: Prepared): BusinessTotals {
  const by = (group: ReportBucket) => sumLines(p.lines.filter((line) => line.group === group));
  const tracked = by("tracked");
  const trackedSessions = p.allProperties ? p.sessions.tracked : null;
  return {
    tracked,
    unknown: by("unknown"),
    staff: by("staff"),
    messaging: by("messaging"),
    all: sumLines(p.lines),
    trackedSessions,
    conv: ratio(tracked.paid, trackedSessions),
    roas: roasFor(p, [...new Set([...p.campaigns.keys(), ...p.lines.flatMap((l) => (l.touch ? [l.touch.campaignId as string] : []))])]),
  };
}

// ---------------------------------------------------------------- breakdown

const pathMatches = (path: readonly DrillStep[]) => (line: SaleLine) =>
  !!line.touch &&
  path.every((step) => (step.level === "source" ? line.touch!.source === step.id : line.touch!.campaignId === step.id));

const ACTIVE = new Set(["active"]);

/** Spend follows a campaign's source as it is now, so a campaign whose source was edited isn't counted under both. */
const spendsUnder = (p: Prepared, source: string) => (campaignId: string) => (p.campaigns.get(campaignId)?.source ?? source) === source;

function campaignName(p: Prepared, id: string) {
  return p.campaigns.get(id)?.name ?? p.lines.find((l) => l.touch?.campaignId === id)?.touch?.campaignName ?? "Removed campaign";
}

function trackedRow(p: Prepared, base: Omit<BreakdownRow, keyof Money | "kind" | "conv">): BreakdownRow {
  const money = sumLines(base.lines);
  return { ...money, ...base, kind: "tracked", conv: ratio(money.paid, base.sessions) };
}

/** Only rows with something to show, plus active setup that hasn't had results yet. */
const hasActivity = (row: BreakdownRow) => row.lines.length > 0 || !!row.sessions || row.roas?.kind === "value";

function sourceRows(p: Prepared, tracked: SaleLine[]): BreakdownRow[] {
  const sources = new Set<string>();
  for (const c of p.campaigns.values()) if (ACTIVE.has(c.status) || p.spend.has(c.id)) sources.add(c.source);
  for (const line of tracked) sources.add(line.touch!.source);
  for (const source of p.sessions.bySource.keys()) sources.add(source);
  return [...sources].map((source) => {
    const lines = tracked.filter((line) => line.touch!.source === source);
    const campaignIds = new Set([...p.campaigns.values()].filter((c) => c.source === source).map((c) => c.id as string));
    for (const line of lines) campaignIds.add(line.touch!.campaignId);
    const n = campaignIds.size;
    return trackedRow(p, {
      key: `source:${source}`,
      name: source,
      sub: `${n} ${n === 1 ? "campaign" : "campaigns"}`,
      sessions: p.allProperties ? (p.sessions.bySource.get(source) ?? 0) : null,
      roas: roasFor(p, [...campaignIds].filter(spendsUnder(p, source)), lines),
      drill: { level: "source", id: source },
      lines,
    });
  });
}

function campaignRows(p: Prepared, tracked: SaleLine[], source?: string): BreakdownRow[] {
  const ids = new Set<string>();
  for (const c of p.campaigns.values()) if ((!source || c.source === source) && (ACTIVE.has(c.status) || p.spend.has(c.id))) ids.add(c.id);
  for (const line of tracked) ids.add(line.touch!.campaignId);
  for (const id of p.sessions.byCampaign.keys()) if (!source || p.campaigns.get(id)?.source === source) ids.add(id);
  return [...ids].map((id) => {
    const campaign = p.campaigns.get(id);
    const lines = tracked.filter((line) => line.touch!.campaignId === id);
    const touch = lines[0]?.touch;
    return trackedRow(p, {
      key: `campaign:${id}`,
      name: campaignName(p, id),
      sub: campaign ? `${campaign.source} · ${campaign.medium}` : touch ? `${touch.source} · ${touch.medium}` : undefined,
      status: campaign && campaign.status !== "active" ? campaign.status : undefined,
      sessions: p.allProperties ? (p.sessions.byCampaign.get(id) ?? 0) : null,
      roas: !source || spendsUnder(p, source)(id) ? roasFor(p, [id], lines) : undefined,
      drill: { level: "campaign", id },
      lines,
    });
  });
}

function linkRows(p: Prepared, tracked: SaleLine[], campaignId?: string): BreakdownRow[] {
  const ids = new Set<string>();
  for (const l of p.links.values()) if ((!campaignId || l.campaignId === campaignId) && ACTIVE.has(l.status)) ids.add(l.id);
  for (const line of tracked) ids.add(line.touch!.linkId);
  // Under a campaign, a link's sessions are the ones counted while it belonged to that campaign.
  const sessionsHere = campaignId ? p.sessions.byCampaignLink.get(campaignId) : p.sessions.byLink;
  for (const id of sessionsHere?.keys() ?? []) ids.add(id);
  return [...ids].map((id) => {
    const link = p.links.get(id);
    const lines = tracked.filter((line) => line.touch!.linkId === id);
    const touch = lines[0]?.touch;
    return trackedRow(p, {
      key: `link:${id}`,
      name: slugPath(link?.slug ?? touch?.slug ?? ""),
      mono: true,
      sub: [link?.name, campaignName(p, link?.campaignId ?? touch?.campaignId ?? ""), (link?.entry ?? touch?.entry) === "qr" ? "QR" : null]
        .filter(Boolean)
        .join(" · "),
      status: link && link.status !== "active" ? link.status : undefined,
      sessions: p.allProperties ? (sessionsHere?.get(id) ?? 0) : null,
      drill: { level: "sales" },
      lines,
    });
  });
}

function couponRows(p: Prepared): BreakdownRow[] {
  const byCoupon = new Map<string, SaleLine[]>();
  for (const line of p.lines) {
    const id = line.sale.coupon?.couponId;
    if (id) byCoupon.set(id, [...(byCoupon.get(id) ?? []), line]);
  }
  return [...byCoupon].map(([id, lines]) => {
    const coupon = p.coupons.get(id);
    const campaignId = coupon?.campaignId ?? lines[0].sale.coupon?.campaignId;
    const money = sumLines(lines);
    return {
      ...money,
      key: `coupon:${id}`,
      kind: "tracked",
      name: coupon?.code ?? lines[0].sale.coupon!.code,
      mono: true,
      sub: campaignId ? campaignName(p, campaignId) : "No campaign",
      status: coupon && coupon.status !== "active" ? coupon.status : undefined,
      sessions: null,
      conv: null,
      drill: { level: "sales" },
      lines,
    } satisfies BreakdownRow;
  });
}

function pinnedRow(kind: Exclude<RowKind, "tracked">, lines: SaleLine[]): BreakdownRow {
  return { ...sumLines(lines), key: kind, kind, ...BUCKET_LABEL[kind], sessions: null, conv: null, drill: { level: "sales" }, lines };
}

function sortValue(row: BreakdownRow, key: SortKey): number | string {
  if (key === "name") return row.name.toLowerCase();
  if (key === "roas") return row.roas?.kind === "value" ? row.roas.value : -1;
  return row[key] ?? -1;
}

export function sortRows(rows: BreakdownRow[], sort: Sort): BreakdownRow[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // Rows with nothing yet sink to the bottom whatever the sort.
    const idle = Number(hasActivity(b)) - Number(hasActivity(a));
    if (idle) return idle;
    const x = sortValue(a, sort.key);
    const y = sortValue(b, sort.key);
    return (x > y ? 1 : x < y ? -1 : 0) * sign || a.name.localeCompare(b.name);
  });
}

function totalRow(key: string, name: string, money: Money, sessions: number | null, roas?: Roas, note?: string): TotalRow {
  return { ...money, key, name, note, sessions, conv: ratio(money.paid, sessions), roas };
}

/** The breakdown table for a tab and drill path. */
export function buildBreakdown(p: Prepared, view: BreakdownView, path: DrillStep[], sort: Sort): Breakdown {
  const tracked = p.lines.filter((line) => line.group === "tracked");
  const scoped = tracked.filter(pathMatches(path));
  const top = path.length === 0;
  const last = path[path.length - 1];
  const showSessions = !p.cash && view !== "coupon";
  const showRoas = view === "source" || view === "campaign";

  let rows: BreakdownRow[];
  if (view === "coupon") rows = couponRows(p);
  else if (top) rows = view === "source" ? sourceRows(p, scoped) : view === "campaign" ? campaignRows(p, scoped) : linkRows(p, scoped);
  else if (last.level === "source") rows = campaignRows(p, scoped, last.id);
  else rows = linkRows(p, scoped, last.id);
  rows = sortRows(rows, sort);

  const pinned: BreakdownRow[] = [];
  if (view === "coupon") {
    const none = p.lines.filter((line) => !line.sale.coupon);
    if (none.length) pinned.push(pinnedRow("none", none));
  } else if (top) {
    for (const kind of ["unknown", "staff", "messaging"] as const) {
      const lines = p.lines.filter((line) => line.group === kind);
      if (lines.length) pinned.push(pinnedRow(kind, lines));
    }
  }

  const totals: TotalRow[] = [];
  const business = businessTotals(p);
  if (view !== "coupon" && top) {
    totals.push(totalRow("tracked", "Tracked total", business.tracked, business.trackedSessions, business.roas));
  } else if (!top) {
    const name = last.level === "source" ? last.id : campaignName(p, last.id);
    const sessions = p.allProperties ? rows.reduce((total, row) => total + (row.sessions ?? 0), 0) : null;
    const roas = last.level === "source" ? roasFor(p, rows.map((row) => row.key.replace(/^campaign:/, "")).filter(spendsUnder(p, last.id)), scoped) : roasFor(p, [last.id], scoped);
    totals.push(totalRow("scope", `Total for ${name}`, sumLines(scoped), sessions, roas));
  }
  if (top) totals.push(totalRow("business", "Business total", business.all, null, undefined, "All paid sales, tracked or not"));

  return { view, path, rows, pinned, totals, showSessions, showRoas };
}

/** Display name of a drill step for breadcrumbs. */
export function stepName(p: Prepared, step: DrillStep) {
  return step.level === "source" ? step.id : campaignName(p, step.id);
}

/** Sales for the sheet: refunded first, then newest. */
export function sheetLines(lines: readonly SaleLine[]) {
  return [...lines].sort(
    (a, b) => Number(b.refunded > 0) - Number(a.refunded > 0) || b.sale.createdDay.localeCompare(a.sale.createdDay) || a.sale.id.localeCompare(b.sale.id),
  );
}

// ---------------------------------------------------------------- chart

export type ChartMetric = "net" | "paid";
export type ChartSeries = { key: string; label: string; color: string };
export type ChartBucket = { from: string; to: string; label: string; long: string; values: Record<string, number>; total: number };
export type ChartData = { interval: "day" | "week"; series: ChartSeries[]; buckets: ChartBucket[] };

/** Validated categorical slots from the design (docs/previews/marketing/src/dashboard.html). */
export const CHART_COLOR_VARS =
  "[--chart-s1:#3568b2] [--chart-s2:#d58d25] [--chart-s3:#009589] [--chart-s4:#d45b3d] [--chart-s5:#8c5cad] [--chart-s0:#b3aea6] [--chart-s0b:#dcd8d2] dark:[--chart-s1:#5589d7] dark:[--chart-s2:#c68627] dark:[--chart-s3:#00998c] dark:[--chart-s4:#c9593d] dark:[--chart-s5:#9868ba] dark:[--chart-s0:#5c6068] dark:[--chart-s0b:#3e424a]";
const SOURCE_COLORS = ["var(--chart-s1)", "var(--chart-s2)", "var(--chart-s3)", "var(--chart-s4)"];
const OTHER = { key: "__other", label: "Other sources", color: "var(--chart-s5)" };
const UNTRACKED = { key: "__untracked", label: "Not tracked", color: "var(--chart-s0)" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** Daily up to 31 days, weekly (Monday to Sunday, clipped to the range) above. */
export function chartData(p: Prepared, metric: ChartMetric): ChartData {
  const { from, to } = p.report;
  const days = reportDayCount(from, to) ?? 1;
  const interval = days > 31 ? "week" : "day";
  const buckets: ChartBucket[] = [];
  for (let day = from; day <= to; ) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const end = interval === "day" ? day : [addDays(day, (7 - weekday) % 7), to].sort()[0];
    const span = (reportDayCount(day, end) ?? 1);
    buckets.push({
      from: day,
      to: end,
      label: interval === "day" ? dm(day) : `${dm(day)}–${dm(end)}`,
      long: interval === "day" ? `${WEEKDAYS[weekday]} ${dm(day)}` : `${span < 7 ? "Part week" : "Week"} ${dm(day)}–${dm(end)}`,
      values: {},
      total: 0,
    });
    day = addDays(end, 1);
  }
  const index = (day?: string) => (day ? buckets.findIndex((b) => day >= b.from && day <= b.to) : -1);

  // Series: the four biggest sources by the chosen metric, the rest as "Other sources", then not tracked.
  const sourceOf = (line: SaleLine) => (line.touch ? line.touch.source : UNTRACKED.key);
  const points: { key: string; day?: string; value: number }[] = [];
  for (const line of p.lines) {
    if (!p.cash) {
      points.push({ key: sourceOf(line), day: line.sale.createdDay, value: metric === "net" ? line.collected - line.refunded : line.paid });
    } else if (metric === "paid") {
      if (line.paid) points.push({ key: sourceOf(line), day: line.sale.paidDay, value: 1 });
    }
  }
  if (p.cash && metric === "net") {
    const bySale = new Map(p.lines.map((line) => [line.sale.id, line]));
    for (const event of p.report.events) {
      const line = bySale.get(event.saleId);
      if (line && event.kind === "payment") points.push({ key: sourceOf(line), day: event.day, value: event.amount });
    }
  }
  const totals = new Map<string, number>();
  for (const point of points) if (point.key !== UNTRACKED.key) add(totals, point.key, point.value);
  const ranked = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([key]) => key);
  const named = ranked.length > SOURCE_COLORS.length + 1 ? ranked.slice(0, SOURCE_COLORS.length) : ranked.slice(0, SOURCE_COLORS.length + 1);
  const series: ChartSeries[] = named.map((key, i) => ({ key, label: key, color: SOURCE_COLORS[i] ?? OTHER.color }));
  if (ranked.length > named.length) series.push(OTHER);
  series.push(UNTRACKED);
  const keyFor = (key: string) => (key === UNTRACKED.key || named.includes(key) ? key : OTHER.key);

  for (const bucket of buckets) for (const s of series) bucket.values[s.key] = 0;
  for (const point of points) {
    const i = index(point.day);
    if (i < 0) continue;
    buckets[i].values[keyFor(point.key)] += point.value;
  }
  for (const bucket of buckets) bucket.total = Object.values(bucket.values).reduce((a, b) => a + Math.max(0, b), 0);
  return { interval, series, buckets };
}

/** A round axis step for `max` split into about `n` parts. */
export function niceStep(max: number, n = 4) {
  if (max <= 0) return 1;
  const raw = max / n;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
}

export function formatRoas(value: number) {
  return `${value.toFixed(2)}×`;
}

export function formatPercent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}
