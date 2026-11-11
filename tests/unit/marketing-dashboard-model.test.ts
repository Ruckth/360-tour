import { describe, expect, it } from "vitest";
import type { Id } from "convex/_generated/dataModel";
import type { ReportData, ReportSale, ReportTouch } from "convex/lib/marketingReport";
import {
  addDays,
  buildBreakdown,
  businessTotals,
  chartData,
  customRangeProblem,
  convertedSessions,
  prepareReport,
  presetRange,
  roasFor,
  saleTouch,
  sheetLines,
  type BreakdownRow,
  type ReportFilters,
  type Sort,
} from "@/components/admin/marketing/dashboard/report-model";
import { salesCsv, summaryCsv } from "@/components/admin/marketing/dashboard/report-csv";
import { dashboardReport, FIXTURE_FROM, FIXTURE_TO, FIXTURE_TODAY } from "../browser/marketing-dashboard-data";

const LAST: ReportFilters = { property: "all", touch: "last" };
const FIRST: ReportFilters = { property: "all", touch: "first" };
const BY_NET: Sort = { key: "net", dir: "desc" };
const row = (rows: BreakdownRow[], key: string) => rows.find((r) => r.key === key)!;

// ---------------------------------------------------------------- tiny hand-made reports

const cid = (s: string) => s as Id<"marketingCampaigns">;
const lid = (s: string) => s as Id<"marketingLinks">;
const touch = (link: string, campaign: string, source: string): ReportTouch => ({
  linkId: lid(link), campaignId: cid(campaign), slug: link, campaignName: campaign, source, medium: "social", entry: "link",
});
const A = touch("la", "ca", "facebook");
const B = touch("lb", "cb", "instagram");
let n = 0;
const sale = (patch: Partial<ReportSale>): ReportSale => ({
  kind: "stay", id: `s${++n}`, label: "Guest", channel: "web", bucket: "tracked", createdDay: "2026-10-10", paidDay: "2026-10-10",
  paid: true, collected: 1000, refunded: 0, discount: 0, ...patch,
});
function report(patch: Partial<ReportData>): ReportData {
  return {
    asOf: 0, from: "2026-10-01", to: "2026-10-31", basis: "cohort", timeZone: "Asia/Bangkok", currency: "THB", model: "last_touch_30d@1",
    sales: [], events: [], sessions: [],
    campaigns: [
      { id: cid("ca"), name: "ca", source: "facebook", medium: "social", status: "active" },
      { id: cid("cb"), name: "cb", source: "instagram", medium: "social", status: "active" },
    ],
    links: [
      { id: lid("la"), slug: "la", name: "A", campaignId: cid("ca"), entry: "link", status: "active" },
      { id: lid("lb"), slug: "lb", name: "B", campaignId: cid("cb"), entry: "link", status: "active" },
    ],
    coupons: [], properties: [], spend: [], excluded: { nonThb: 0 }, truncated: false,
    ...patch,
  };
}

describe("fixture from kit/data.md (cohort, last touch)", () => {
  const p = prepareReport(dashboardReport(), LAST);
  const t = businessTotals(p);

  it("matches the tracked and business totals", () => {
    expect(t.tracked.net).toBe(1_091_700);
    expect(t.all.net).toBe(1_515_900);
    expect(t.all.refunded).toBe(38_400);
    expect(t.trackedSessions).toBe(11_980);
    // 136 tracked paid sales: 132 stays + 4 Spa week checkout orders counted in money only.
    expect(t.tracked.paid).toBe(132);
    expect(t.tracked.paidOther).toBe(4);
    expect(t.all.paid + t.all.paidOther).toBe(186);
    expect(t.unknown).toMatchObject({ paid: 41, net: 352_800 });
    expect(t.staff).toMatchObject({ paid: 6, paidOther: 3, net: 71_400 });
    expect(t.messaging.sales).toBe(0);
  });

  it("converts distinct consented sessions, excluding current-link stays", () => {
    expect(t.conv).toBeCloseTo(130 / 11_980, 10);
  });

  it("sums ROAS over the campaigns that have spend", () => {
    // November escape (/f1 + /a1) ฿364,600 on ฿45,000; Spa week ฿5,600 on ฿1,200.
    expect(t.roas).toMatchObject({ kind: "value", value: (364_600 + 5_600) / 46_200, net: 370_200, spend: 46_200, campaigns: 2 });
    // Campaigns that sold with no spend entered are named, so the tile can say the figure leaves them out.
    const missing = t.roas.kind === "value" ? t.roas.missing : [];
    expect(missing).toContain("c-ig");
    expect(missing).not.toContain("c-fb-nov");
  });

  it("builds source rows with sessions, conversion, ROAS and pinned untracked rows", () => {
    const b = buildBreakdown(p, "source", [], BY_NET);
    const fb = row(b.rows, "source:facebook");
    expect(fb.net).toBe(148_600 + 176_400 + 188_200);
    expect(fb.sessions).toBe(1_240 + 860 + 2_310);
    expect(fb.conv).toBeCloseTo((18 + 21 + 24) / 4_410, 10);
    // Facebook · Always on and Songkran have no spend: the source ROAS covers November escape only.
    expect(fb.roas).toMatchObject({ kind: "value", net: 364_600, spend: 45_000, campaigns: 1 });
    expect(row(b.rows, "source:instagram").roas).toEqual({ kind: "missing", campaignIds: ["c-ig"] });
    expect(b.rows[0].key).toBe("source:facebook");
    expect(b.pinned.map((r) => [r.kind, r.paid + r.paidOther, r.net, r.sessions, r.conv])).toEqual([
      ["unknown", 41, 352_800, null, null],
      ["staff", 9, 71_400, null, null],
    ]);
    expect(b.totals.map((r) => [r.name, r.net, r.sessions])).toEqual([
      ["Tracked total", 1_091_700, 11_980],
      ["Business total", 1_515_900, null],
    ]);
  });

  it("drills source → campaign → link and keeps the path's totals", () => {
    const campaigns = buildBreakdown(p, "source", [{ level: "source", id: "facebook" }], BY_NET);
    expect(campaigns.pinned).toEqual([]);
    const nov = row(campaigns.rows, "campaign:c-fb-nov");
    expect(nov.roas).toMatchObject({ kind: "value", value: 364_600 / 45_000 });
    expect(row(campaigns.rows, "campaign:c-fb-always").roas).toEqual({ kind: "missing", campaignIds: ["c-fb-always"] });
    expect(campaigns.totals).toHaveLength(1);
    expect(campaigns.totals[0]).toMatchObject({ name: "Total for facebook", net: 513_200, sessions: 4_410 });

    const links = buildBreakdown(p, "source", [{ level: "source", id: "facebook" }, { level: "campaign", id: "c-fb-nov" }], BY_NET);
    expect(links.rows.map((r) => [r.name, r.paid, r.net, r.refunded])).toEqual([
      ["/a1", 24, 188_200, 9_600],
      ["/f1", 21, 176_400, 0],
    ]);
    expect(links.rows.every((r) => r.drill.level === "sales")).toBe(true);
    expect(links.totals[0]).toMatchObject({ name: "Total for Facebook · November escape", net: 364_600 });
  });

  it("counts Spa week orders in money but not in paid stays", () => {
    const b = buildBreakdown(p, "link", [], BY_NET);
    expect(row(b.rows, "link:l-q1")).toMatchObject({ paid: 0, paidOther: 4, net: 5_600, sessions: 95, conv: 0 });
    // Draft /a2 and paused /sk have no results, so they're not listed.
    expect(b.rows.map((r) => r.key)).not.toContain("link:l-a2");
    expect(b.rows.map((r) => r.key)).not.toContain("link:l-sk");
  });

  it("groups coupons across tracked and untracked sales and says nothing about sessions", () => {
    const b = buildBreakdown(p, "coupon", [], BY_NET);
    expect(b.showSessions).toBe(false);
    expect(b.showRoas).toBe(false);
    const f1 = row(b.rows, "coupon:k-f1");
    expect(f1.paid).toBe(35);
    expect(f1.discount).toBe(66_450);
    expect(f1.lines.filter((l) => l.group === "unknown")).toHaveLength(4);
    expect(b.pinned.map((r) => r.kind)).toEqual(["none"]);
    const sum = [...b.rows, ...b.pinned].reduce((total, r) => total + r.net, 0);
    expect(sum).toBe(1_515_900);
    expect(b.totals.map((r) => r.name)).toEqual(["Business total"]);
  });
});

describe("touch", () => {
  it("first touch falls back to the last touch and never adds the two", () => {
    const scanned = sale({ kind: "order", evidence: "scanned", last: A });
    const tracked = sale({ evidence: "tracked", last: A, first: B });
    expect(saleTouch(scanned, "first")).toBe(A);
    expect(saleTouch(tracked, "first")).toBe(B);
    expect(saleTouch(tracked, "last")).toBe(A);
    expect(saleTouch(sale({ bucket: "unknown", last: A }), "last")).toBeUndefined();

    const r = report({ sales: [scanned, tracked] });
    const last = buildBreakdown(prepareReport(r, LAST), "source", [], BY_NET);
    const first = buildBreakdown(prepareReport(r, FIRST), "source", [], BY_NET);
    expect(row(last.rows, "source:facebook").collected).toBe(2000);
    expect(row(first.rows, "source:facebook").collected).toBe(1000);
    expect(row(first.rows, "source:instagram").collected).toBe(1000);
    expect(last.totals[0].collected).toBe(2000);
    expect(first.totals[0].collected).toBe(2000);
  });

  it("moves credit between links on the fixture without changing the totals", () => {
    const last = prepareReport(dashboardReport(), LAST);
    const first = prepareReport(dashboardReport(), FIRST);
    const ig = (p: typeof last) => row(buildBreakdown(p, "link", [], BY_NET).rows, "link:l-ig").net;
    expect(ig(first)).toBeGreaterThan(ig(last));
    expect(businessTotals(first).tracked.net).toBe(businessTotals(last).tracked.net);
  });

  it("shows a tracked sale without a touch as unknown", () => {
    const p = prepareReport(report({ sales: [sale({ last: undefined })] }), LAST);
    expect(p.lines[0].group).toBe("unknown");
  });
});

describe("property filter", () => {
  const p = prepareReport(dashboardReport(), { property: "prop-mossbell", touch: "last" });

  it("keeps only that property's sales and hides sessions, conversion and ROAS", () => {
    expect(p.lines.every((l) => l.sale.propertyId === "prop-mossbell")).toBe(true);
    expect(p.lines.some((l) => l.sale.kind === "order")).toBe(false);
    const t = businessTotals(p);
    expect(t.trackedSessions).toBeNull();
    expect(t.conv).toBeNull();
    expect(t.roas).toEqual({ kind: "all_properties_only" });
    const b = buildBreakdown(p, "source", [], BY_NET);
    expect(b.rows.every((r) => r.sessions === null && r.conv === null)).toBe(true);
    expect(row(b.rows, "source:facebook").roas).toEqual({ kind: "all_properties_only" });
  });

  it("adds up across properties to less than All properties (orders have none)", () => {
    const all = businessTotals(prepareReport(dashboardReport(), LAST)).all.net;
    const parts = ["prop-tideglass", "prop-mossbell", "prop-canopy"].map((id) => businessTotals(prepareReport(dashboardReport(), { property: id, touch: "last" })).all.net);
    const orders = 5_600 + 1_300 + 1_000 + 1_500;
    expect(parts.reduce((a, b) => a + b, 0)).toBe(all - orders);
  });
});

describe("cash basis", () => {
  it("counts events dated in range, discount and payments completed by paidDay", () => {
    const early = sale({ id: "early", createdDay: "2026-09-20", paidDay: "2026-09-21", collected: 5000, refunded: 1000, discount: 300, last: A });
    const inside = sale({ id: "inside", createdDay: "2026-10-05", paidDay: "2026-10-06", collected: 2000, discount: 200, last: A });
    const r = report({
      basis: "cash",
      sales: [early, inside],
      events: [
        { saleId: "early", kind: "payment", day: "2026-10-03", amount: 2500 }, // balance paid in range
        { saleId: "early", kind: "refund", day: "2026-10-20", amount: 1000 },
        { saleId: "inside", kind: "payment", day: "2026-10-06", amount: 2000 },
        { saleId: "inside", kind: "payment", day: "2026-11-02", amount: 999 }, // outside: ignored
      ],
      sessions: [{ day: "2026-10-06", linkId: lid("la"), count: 10 }],
    });
    const p = prepareReport(r, LAST);
    const t = businessTotals(p);
    expect(t.all).toMatchObject({ collected: 4500, refunded: 1000, net: 3500, discount: 200, paid: 1, paidOther: 0 });
    const b = buildBreakdown(p, "source", [], BY_NET);
    expect(b.showSessions).toBe(false);
  });

  it("matches the cohort totals on the fixture when every event is in range", () => {
    const cohort = businessTotals(prepareReport(dashboardReport(), LAST)).all;
    const cash = businessTotals(prepareReport(dashboardReport({ basis: "cash" }), LAST)).all;
    expect(cash.collected).toBe(cohort.collected);
    expect(cash.refunded).toBe(cohort.refunded);
    // Cash counts every paid sale, orders included.
    expect(cash.paid).toBe(cohort.paid + cohort.paidOther);
  });
});

describe("conversion and pinned rows", () => {
  it("leaves unknown, staff-entered and messaging out of conversion but in the business total", () => {
    const r = report({
      sales: [
        sale({ last: A, evidence: "tracked", session: { id: "session-a" as Id<"marketingSessions">, day: "2026-10-10", linkId: A.linkId, campaignId: A.campaignId } }),
        sale({ bucket: "unknown", channel: "web" }),
        sale({ bucket: "staff", channel: "admin" }),
        sale({ bucket: "messaging", channel: "messaging" }),
      ],
      sessions: [
        { day: "2026-10-10", linkId: lid("la"), count: 4 },
        { day: "2026-10-10", count: 100 }, // consented direct arrival: included in the overall denominator
        { day: "2026-11-05", linkId: lid("la"), count: 50 }, // outside the range
      ],
    });
    const p = prepareReport(r, LAST);
    const t = businessTotals(p);
    expect(t.trackedSessions).toBe(104);
    expect(t.conv).toBe(1 / 104);
    expect(t.all.paid).toBe(4);
    const b = buildBreakdown(p, "campaign", [], BY_NET);
    expect(b.pinned.map((r) => r.kind)).toEqual(["unknown", "staff", "messaging"]);
    expect(row(b.rows, "campaign:ca")).toMatchObject({ sessions: 4, conv: 0.25 });
  });

  it("maps sessions by link → campaign → source", () => {
    // A link since moved to another campaign: its sessions stay with the campaign they were counted for.
    const moved = prepareReport(report({ sessions: [{ day: "2026-10-10", linkId: lid("la"), campaignId: cid("cb"), count: 5 }] }), LAST);
    expect([moved.sessions.byCampaign.get("cb"), moved.sessions.byCampaign.get("ca"), moved.sessions.byLink.get("la")]).toEqual([5, undefined, 5]);
    // Drilling into either campaign shows the link with the sessions it had under that campaign, and the Link tab shows them all.
    const split = prepareReport(report({ sessions: [{ day: "2026-10-10", linkId: lid("lb"), campaignId: cid("ca"), count: 5 }, { day: "2026-10-11", linkId: lid("lb"), campaignId: cid("cb"), count: 2 }] }), LAST);
    const under = (campaign: string) => row(buildBreakdown(split, "campaign", [{ level: "campaign", id: campaign }], BY_NET).rows, "link:lb")?.sessions;
    expect([under("ca"), under("cb"), row(buildBreakdown(split, "link", [], BY_NET).rows, "link:lb").sessions]).toEqual([5, 2, 7]);
    const r = report({ sessions: [{ day: "2026-10-10", linkId: lid("lb"), count: 7 }] });
    const b = buildBreakdown(prepareReport(r, LAST), "source", [], BY_NET);
    expect(row(b.rows, "source:instagram").sessions).toBe(7);
    expect(row(b.rows, "source:facebook").sessions).toBe(0);
  });
});

describe("ROAS", () => {
  const spend = (amount: number, from: string, to: string, campaign = "ca") => ({ id: `sp-${from}` as Id<"marketingSpend">, campaignId: cid(campaign), amount, from, to });

  it("counts a campaign's spend under one source after its source was edited", () => {
    // Sold as facebook, then the campaign's source was changed to tiktok.
    const r = report({
      sales: [sale({ last: A, collected: 2000 })],
      spend: [spend(1000, "2026-10-01", "2026-10-31")],
      campaigns: [{ id: cid("ca"), name: "ca", source: "tiktok", medium: "social", status: "active" }],
    });
    const p = prepareReport(r, LAST);
    const b = buildBreakdown(p, "source", [], BY_NET);
    expect(row(b.rows, "source:facebook")).toMatchObject({ net: 2000, roas: { kind: "missing", campaignIds: [] } });
    expect(row(b.rows, "source:tiktok").roas).toMatchObject({ kind: "value", spend: 1000 });
    // The drill under the old source lists the campaign's sales there without its spend.
    expect(row(buildBreakdown(p, "source", [{ level: "source", id: "facebook" }], BY_NET).rows, "campaign:ca").roas).toBeUndefined();
    expect(businessTotals(p).roas).toMatchObject({ kind: "value", value: 2, spend: 1000 });
  });

  it("lists the source of an ended campaign that has spend and no results", () => {
    const r = report({
      sales: [sale({ last: A, collected: 2000 })],
      spend: [spend(1000, "2026-10-01", "2026-10-31"), { ...spend(1000, "2026-10-02", "2026-10-31", "cb") }],
      campaigns: [
        { id: cid("ca"), name: "ca", source: "facebook", medium: "social", status: "active" },
        { id: cid("cb"), name: "cb", source: "instagram", medium: "social", status: "ended" },
      ],
    });
    const b = buildBreakdown(prepareReport(r, LAST), "source", [], BY_NET);
    expect(row(b.rows, "source:instagram").roas).toMatchObject({ kind: "value", value: 0, spend: 1000 });
    expect(b.totals[0].roas).toMatchObject({ kind: "value", value: 1 });
  });

  it("is unavailable without spend, never zero", () => {
    const p = prepareReport(report({ sales: [sale({ last: A })] }), LAST);
    expect(roasFor(p, ["ca"])).toEqual({ kind: "missing", campaignIds: ["ca"] });
  });

  it("prorates a spend entry that only partly overlaps the range", () => {
    // 1 Sep–30 Nov (91 days) for ฿9,100: 31 days fall in October → ฿3,100.
    const p = prepareReport(report({ sales: [sale({ last: A, collected: 6200 })], spend: [spend(9100, "2026-09-01", "2026-11-30")] }), LAST);
    expect(p.spend.get("ca")).toBeCloseTo(3100, 6);
    expect(roasFor(p, ["ca"])).toMatchObject({ kind: "value", value: 2, net: 6200 });
  });

  it("uses net after refunds and sums only campaigns that have spend", () => {
    const r = report({
      sales: [sale({ last: A, collected: 3000, refunded: 1000 }), sale({ last: B, collected: 9000 })],
      spend: [spend(1000, "2026-10-01", "2026-10-31")],
    });
    const p = prepareReport(r, LAST);
    expect(roasFor(p, ["ca", "cb"])).toEqual({ kind: "value", value: 2, net: 2000, spend: 1000, campaigns: 1, missing: ["cb"] });
  });

  it("ignores spend that doesn't overlap", () => {
    const p = prepareReport(report({ spend: [spend(500, "2026-11-01", "2026-11-30")] }), LAST);
    expect(p.spend.size).toBe(0);
  });
});

describe("dates", () => {
  it("builds presets that end yesterday, except This month", () => {
    expect(presetRange("last30", FIXTURE_TODAY)).toEqual({ from: FIXTURE_FROM, to: FIXTURE_TO });
    expect(presetRange("last7", FIXTURE_TODAY)).toEqual({ from: "2026-10-31", to: "2026-11-06" });
    expect(presetRange("last90", FIXTURE_TODAY)).toEqual({ from: "2026-08-09", to: "2026-11-06" });
    expect(presetRange("month", FIXTURE_TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(presetRange("prev30", FIXTURE_TODAY)).toEqual({ from: "2026-09-08", to: "2026-10-07" });
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("checks custom ranges: order, future and the 92-day cap", () => {
    expect(customRangeProblem("2026-10-01", "2026-10-31", FIXTURE_TODAY)).toBeNull();
    expect(customRangeProblem("2026-10-31", "2026-10-01", FIXTURE_TODAY)).toMatch(/on or before/);
    expect(customRangeProblem("2026-11-01", "2026-11-08", FIXTURE_TODAY)).toMatch(/after today/);
    expect(customRangeProblem("2026-08-07", "2026-11-06", FIXTURE_TODAY)).toBeNull(); // 92 days
    expect(customRangeProblem("2026-08-06", "2026-11-06", FIXTURE_TODAY)).toMatch(/at most 92/);
    expect(customRangeProblem("", "2026-11-06", FIXTURE_TODAY)).toMatch(/both/);
  });
});

describe("chart", () => {
  it("is daily up to 31 days and adds up to the totals", () => {
    const p = prepareReport(dashboardReport(), LAST);
    const data = chartData(p, "net");
    expect(data.interval).toBe("day");
    expect(data.buckets).toHaveLength(30);
    expect(data.series.at(-1)?.label).toBe("Not tracked");
    const total = data.buckets.reduce((sum, b) => sum + Object.values(b.values).reduce((a, v) => a + v, 0), 0);
    expect(total).toBe(1_515_900);
    expect(chartData(p, "paid").buckets.reduce((sum, b) => sum + b.total, 0)).toBe(132 + 41 + 6);
  });

  it("is weekly Monday to Sunday above 31 days, clipped to the range", () => {
    const p = prepareReport({ ...dashboardReport(), from: "2026-08-09", to: "2026-11-06" }, LAST);
    const data = chartData(p, "net");
    expect(data.interval).toBe("week");
    expect(data.buckets[0]).toMatchObject({ from: "2026-08-09", to: "2026-08-09" }); // a Sunday: part week
    expect(data.buckets[1]).toMatchObject({ from: "2026-08-10", to: "2026-08-16" });
    expect(data.buckets.at(-1)).toMatchObject({ from: "2026-11-02", to: "2026-11-06" });
  });

  it("keeps four sources and folds the rest into Other sources", () => {
    const p = prepareReport(dashboardReport(), LAST);
    const labels = chartData(p, "net").series.map((s) => s.label);
    expect(labels).toHaveLength(6);
    expect(labels.slice(-2)).toEqual(["Other sources", "Not tracked"]);
    expect(labels[0]).toBe("facebook");
  });
});

describe("sales sheet order", () => {
  it("puts refunded sales first, then newest", () => {
    const p = prepareReport(dashboardReport(), LAST);
    const a1 = row(buildBreakdown(p, "link", [], BY_NET).rows, "link:l-a1");
    const ordered = sheetLines(a1.lines);
    expect(ordered.slice(0, 2).every((l) => l.refunded > 0)).toBe(true);
    expect(ordered[2].sale.createdDay >= ordered[3].sale.createdDay).toBe(true);
  });
});

describe("sales CSV numbers", () => {
  it("writes a refund-only sale's net as a negative number and keeps satang", () => {
    const refunded = sale({ last: A, collected: 1000, refunded: 1000, paidDay: "2026-09-20", createdDay: "2026-09-20" });
    const small = sale({ last: A, collected: 99.5 });
    const r = report({
      basis: "cash",
      sales: [refunded, small],
      events: [
        { saleId: refunded.id, kind: "refund", day: "2026-10-05", amount: 1000 },
        { saleId: small.id, kind: "payment", day: "2026-10-10", amount: 99.5 },
      ],
    });
    const lines = salesCsv(prepareReport(r, LAST), "All properties").split("\r\n");
    expect(lines.find((line) => line.includes(`,${refunded.id},`))).toMatch(/,0,1000,0,-1000$/);
    expect(lines.find((line) => line.includes(`,${small.id},`))).toMatch(/,99\.5,0,0,99\.5$/);
    expect(lines.some((line) => line.includes("'-"))).toBe(false);
  });
});


it("counts coupon-only Finance settlements separately throughout totals, breakdowns and CSV", () => {
  const covered = sale({ kind: "order", channel: "pos", id: "covered", bucket: "staff", paidDay: undefined, settlementDay: "2026-10-10", collected: 0, discount: 500 });
  const p = prepareReport(report({ basis: "cash", sales: [covered] }), LAST);
  expect(businessTotals(p).all).toMatchObject({ collected: 0, discount: 500, paid: 0, couponOnlySettlements: 1 });
  expect(chartData(p, "paid").buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(0);
  const b = buildBreakdown(p, "source", [], BY_NET);
  expect(b.pinned[0]).toMatchObject({ paid: 0, couponOnlySettlements: 1, discount: 500 });
  const csv = salesCsv(p, "All properties").split("\r\n");
  const header = csv.find(line => line.startsWith("Kind,"))!.split(",");
  const values = csv.find(line => line.includes(",covered,"))!.split(",");
  const cells = Object.fromEntries(header.map((key, i) => [key, values[i]]));
  expect(cells).toMatchObject({ "Paid day": "", "First payment in range": "no", "Settlement day": "2026-10-10", "Coupon-only settlement": "yes", Collected: "0", Discount: "500" });
  const summary = summaryCsv(p, "All properties", b, "").split("\r\n");
  const summaryHeader = summary.find(line => line.startsWith("Row,"))!.split(",");
  const total = summary.find(line => line.startsWith("total,Business total,"))!.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  expect(Object.fromEntries(summaryHeader.map((key, i) => [key, total[i]]))).toMatchObject({ "First-payment sales": "0", "Coupon-only settlements": "1", Discounts: "500", Collected: "0" });
  const cohort = prepareReport(report({ sales: [covered] }), LAST);
  expect(businessTotals(cohort).all).toMatchObject({ paid: 0, paidOther: 1, discount: 500 });
  expect(salesCsv(cohort, "All properties")).not.toContain("Settlement day");
});


describe("session conversion truth", () => {
  const session = { id: "consented-a" as Id<"marketingSessions">, day: "2026-10-10", linkId: A.linkId, campaignId: A.campaignId };
  it("deduplicates stays and excludes current-link, old and missing sessions without needing the clamp", () => {
    const sales = [
      sale({ last: A, evidence: "tracked", session }),
      sale({ last: A, evidence: "tracked", session }),
      sale({ last: A, evidence: "current_link" }),
      sale({ last: A, evidence: "current_link" }),
      sale({ last: A, evidence: "tracked", session: { ...session, id: "old" as Id<"marketingSessions">, day: "2026-09-30" } }),
      sale({ last: A, evidence: "tracked" }),
      sale({ kind: "order", channel: "pos", last: A, evidence: "scanned" }),
    ];
    const r = report({ sales, sessions: [{ day: session.day, linkId: A.linkId, campaignId: A.campaignId, count: 2 }] });
    const p = prepareReport(r, LAST);
    const totals = businessTotals(p);
    expect(totals.tracked.paid).toBe(6);
    expect(totals.tracked.currentLinkPaidStays).toBe(2);
    expect(convertedSessions(p)).toBe(1);
    // Raw numerator / denominator already <= 1; the defensive clamp does no work.
    expect(totals.conv).toBe(convertedSessions(p) / totals.trackedSessions!);
    expect(totals.conv).toBe(0.5);
    for (const view of ["source", "campaign", "link"] as const) {
      const b = buildBreakdown(p, view, [], BY_NET);
      for (const row of [...b.rows, ...b.totals]) if (row.conv !== null) {
        expect(row.conv).toBeLessThanOrEqual(1);
        expect(row.conv).toBe(row.convertedSessions / row.sessions!);
      }
    }
    const summary = summaryCsv(p, "All", buildBreakdown(p, "source", [], BY_NET), "");
    expect(summary).toContain("Current-link paid stays,Converted sessions,Session conversion %");
    expect(summary).toContain(",2,1,50.00,");
  });

  it("keeps conversion in the session cohort when first touch differs or a link moved campaigns", () => {
    const p = prepareReport(report({
      sales: [sale({ last: A, first: B, evidence: "tracked", session })],
      sessions: [{ day: session.day, linkId: A.linkId, campaignId: A.campaignId, count: 1 }],
      links: [{ id: A.linkId, slug: "la", name: "Moved", campaignId: B.campaignId, entry: "link", status: "active" }],
    }), FIRST);
    expect(businessTotals(p).conv).toBe(1);
    const b = buildBreakdown(p, "campaign", [], BY_NET);
    expect(row(b.rows, "campaign:ca")).toMatchObject({ paid: 0, conv: 1, convertedSessions: 1 });
    expect(row(b.rows, "campaign:cb")).toMatchObject({ paid: 1, conv: null, convertedSessions: 0 });
  });

  it("counts a latest direct session in the overall cohort while keeping link rates bounded", () => {
    const p = prepareReport(report({
      sales: [sale({ last: A, evidence: "tracked", session: { id: session.id, day: session.day } })],
      sessions: [{ day: session.day, count: 1 }],
    }), LAST);
    expect(businessTotals(p).conv).toBe(1);
    expect(row(buildBreakdown(p, "link", [], BY_NET).rows, "link:la").conv).toBeNull();
  });

  it("defensively clamps inconsistent rollups", () => {
    const p = prepareReport(report({
      sales: [sale({ last: A, evidence: "tracked", session }), sale({ last: A, evidence: "tracked", session: { ...session, id: "another" as Id<"marketingSessions"> } })],
      sessions: [{ day: session.day, linkId: A.linkId, campaignId: A.campaignId, count: 1 }],
    }), LAST);
    expect(convertedSessions(p)).toBe(2);
    expect(businessTotals(p).conv).toBe(1);
  });

  it("exports the custom-price flag and zero discount while retaining coupon attribution", () => {
    const custom = sale({ last: A, customPrice: true, discount: 0, coupon: { couponId: "coupon" as Id<"coupons">, code: "KEPT" } });
    const p = prepareReport(report({ sales: [custom] }), LAST);
    expect(businessTotals(p).all.discount).toBe(0);
    expect(buildBreakdown(p, "coupon", [], BY_NET).rows[0]).toMatchObject({ name: "KEPT", sales: 1, discount: 0 });
    const lines = salesCsv(p, "All").split("\r\n");
    const header = lines.find(l => l.startsWith("Kind,"))!.split(",");
    const values = lines.find(l => l.startsWith(`stay,${custom.id},`))!.split(",");
    expect(values[header.indexOf("Custom price")]).toBe("yes");
    expect(values[header.indexOf("Discount")]).toBe("0");
    expect(values[header.indexOf("Coupon")]).toBe("KEPT");
    expect(header).toContain("Current-link only");
  });
});
