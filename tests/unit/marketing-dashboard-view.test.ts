// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendDialogProps } from "@/components/admin/marketing/SpendDialog";
import { DashboardView, DEFAULT_REQUEST, type DashboardViewProps, type ReportState } from "@/components/admin/marketing/dashboard/DashboardView";
import { csvMeta, salesCsv, summaryCsv } from "@/components/admin/marketing/dashboard/report-csv";
import { buildBreakdown, prepareReport } from "@/components/admin/marketing/dashboard/report-model";
import { dashboardReport, FIXTURE_TODAY, firstRunReport, emptyRangeReport } from "../browser/marketing-dashboard-data";

// The spend dialog is another package's stub: record what the dashboard opens it with.
const spendDialog = vi.hoisted(() => ({ last: null as SpendDialogProps | null }));
vi.mock("@/components/admin/marketing/SpendDialog", () => ({
  SpendDialog: (props: SpendDialogProps) => {
    spendDialog.last = props;
    return null;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const csvLines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("CSV export", () => {
  const p = prepareReport(dashboardReport(), { property: "all", touch: "last" });

  it("starts with # lines that explain how the figures were counted", () => {
    expect(csvMeta(p, "All properties").map((cells) => cells[0])).toEqual([
      "# Marketing report",
      "# Time zone: Asia/Bangkok",
      "# Currency: THB",
      "# Attribution: last_touch_30d@1 (last touch)",
      "# Basis: Marketing (visit cohort: sales made in range, all their money to date)",
      "# Dates: 2026-10-08 to 2026-11-06",
      "# Property: All properties",
      "# As of: 7 Nov 2026, 06:00 Asia/Bangkok",
    ]);
    const cash = prepareReport(dashboardReport({ basis: "cash", truncated: true, nonThb: 2 }), { property: "prop-canopy", touch: "first" });
    const meta = csvMeta(cash, "Canopy Halo Loft").map((cells) => cells[0]);
    expect(meta).toContain("# Attribution: last_touch_30d@1 (first touch)");
    expect(meta).toContain("# Basis: Finance (cash date: money dated in range)");
    expect(meta).toContain("# Property: Canopy Halo Loft");
    expect(meta.some((line) => line.startsWith("# Incomplete"))).toBe(true);
    expect(meta).toContain("# Left out: 2 sales in another currency");
  });

  it("exports the current table with positive refunds and its totals", () => {
    const lines = csvLines(summaryCsv(p, "All properties", buildBreakdown(p, "link", [], { key: "net", dir: "desc" }), ""));
    const header = lines.find((line) => line.startsWith("Row,"))!;
    expect(header).toBe("Row,Link,Detail,Sessions,Paid,Other paid sales,Conversion %,Discounts,Collected,Refunds,Net");
    const a1 = lines.find((line) => line.startsWith("tracked,/a1,"))!.split(",");
    expect(a1.slice(3)).toEqual(["2310", "24", "0", "1.04", a1[7], "197800", "9600", "188200"]);
    expect(lines.some((line) => /,'-|,-\d/.test(line))).toBe(false);
    expect(lines.find((line) => line.startsWith("not tracked,Unknown"))).toContain(",352800");
    expect(lines.at(-2)).toMatch(/^total,Tracked total,,8860,132,4,1\.49,/);
    expect(lines.at(-1)).toBe('total,Business total,"All paid sales, tracked or not",,179,7,,93700,1554300,38400,1515900');
  });

  it("adds ROAS and spend columns for campaigns and warns that coupons overlap", () => {
    const campaigns = csvLines(summaryCsv(p, "All properties", buildBreakdown(p, "campaign", [], { key: "net", dir: "desc" }), ""));
    expect(campaigns.find((line) => line.startsWith("tracked,Facebook · November escape,"))).toMatch(/,8\.10,45000$/);
    expect(campaigns.find((line) => line.startsWith("tracked,Instagram · Always on,"))).toMatch(/,,$/);
    const coupons = csvLines(summaryCsv(p, "All properties", buildBreakdown(p, "coupon", [], { key: "net", dir: "desc" }), ""));
    expect(coupons).toContain("# Coupons regroup the same sales: never add this table to the source table");
  });

  it("exports one row per sale with the chosen touch", () => {
    const lines = csvLines(salesCsv(p, "All properties"));
    const headerAt = lines.findIndex((line) => line.startsWith("Kind,"));
    expect(lines.length - headerAt - 1).toBe(p.lines.length);
    const refunded = lines.slice(headerAt + 1).filter((line) => line.includes("/a1") && /,4800,/.test(line));
    expect(refunded).toHaveLength(2);
    expect(lines.slice(headerAt + 1).some((line) => line.split(",").includes("'-4800"))).toBe(false);
  });
});

describe("dashboard view", () => {
  let host: HTMLDivElement;
  let root: Root;
  const calls = { request: [] as unknown[], retry: 0, stays: [] as string[], spend: [] as unknown[] };

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    spendDialog.last = null;
    calls.request = [];
    calls.retry = 0;
    calls.stays = [];
    calls.spend = [];
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  function render(state: ReportState, extra: Partial<DashboardViewProps> = {}) {
    const props: DashboardViewProps = {
      request: DEFAULT_REQUEST(FIXTURE_TODAY),
      onRequestChange: (r) => calls.request.push(r),
      state,
      onRetry: () => (calls.retry += 1),
      today: FIXTURE_TODAY,
      campaignsHref: "/admin/marketing/campaigns",
      linksHref: "/admin/marketing/links",
      orderHref: (id) => `/admin/receipt/${id}`,
      onOpenStay: (id) => calls.stays.push(id),
      onSaveSpend: async (draft) => void calls.spend.push(draft),
      ...extra,
    };
    act(() => root.render(createElement(DashboardView, props)));
  }
  const ready = (report = dashboardReport()): ReportState => ({ status: "ready", report });
  const text = () => document.body.textContent ?? "";
  const buttons = (name: string | RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => (typeof name === "string" ? b.textContent?.trim() === name || b.getAttribute("aria-label") === name : name.test(b.getAttribute("aria-label") ?? b.textContent ?? "")));
  const click = (el: Element) => act(() => (el as HTMLElement).click());

  it("renders the tiles, context line and breakdown from the fixture", () => {
    render(ready());
    expect(text()).toContain("As of 7 Nov 2026, 06:00");
    expect(text()).toContain("Asia/Bangkok · THB");
    expect(text()).toContain("Last touch (last_touch_30d@1)");
    expect(text()).toContain("8,860");
    expect(text()).toContain("179 paid stays in all · 7 checkout orders count in money only");
    // The ROAS tile says which campaigns its figure leaves out.
    expect(text()).toMatch(/2 campaigns with spend · \d+ more campaigns? with sales ha(s|ve) no spend\./);
    expect(text()).toContain("1.49%");
    expect(text()).toContain("฿1,091,700");
    expect(text()).toContain("฿1,515,900");
    expect(text()).toContain("8.01×");
    expect(text()).toContain("Not tracked");
    expect(text()).toContain("Tracked total");
    expect(text()).toContain("Business total");
    expect(text()).toContain("Net collected by source");
  });

  it("opens the spend dialog for the campaigns of a row without spend", async () => {
    render(ready());
    expect(spendDialog.last?.open).toBe(false);
    click(buttons(/^instagram.*Show campaigns$/)[0]); // drill into instagram
    // The ROAS tile has its own Add spend link; this is the row's.
    const add = buttons("Add spend").find((b) => b.closest("#breakdown"))!;
    click(add);
    expect(spendDialog.last).toMatchObject({
      open: true,
      campaigns: [{ id: "c-ig", name: "Instagram · Always on" }],
      defaults: { campaignId: "c-ig", from: "2026-10-08", to: "2026-11-06" },
    });
    await act(async () => {
      await spendDialog.last!.onSave({ campaignId: "c-ig" as never, amount: 5000, from: "2026-10-08", to: "2026-11-06" });
    });
    expect(calls.spend).toEqual([{ campaignId: "c-ig", amount: 5000, from: "2026-10-08", to: "2026-11-06" }]);
    expect(spendDialog.last?.open).toBe(false);
  });

  it("offers Add spend from the ROAS tile when nothing has spend", () => {
    render(ready(dashboardReport({ spend: false })));
    expect(text()).toContain("No spend entered for these dates.");
    expect(text()).not.toContain("฿0.00×");
    click(buttons("Add spend")[0]);
    expect(spendDialog.last?.open).toBe(true);
    expect(spendDialog.last?.campaigns.map((c) => c.id)).toContain("c-fb-nov");
  });

  it("drills source → campaign with breadcrumbs, then opens the sales sheet", () => {
    render(ready());
    click(buttons(/^facebook.*Show campaigns$/)[0]);
    expect(document.querySelector('nav[aria-label="Drill-down"]')?.textContent).toContain("All sources");
    click(buttons(/^Facebook · November escape.*Show links$/)[0]);
    expect(document.querySelector('nav[aria-label="Drill-down"]')?.textContent).toContain("Facebook · November escape");
    click(buttons(/^\/a1.*Show sales$/)[0]);
    expect(text()).toContain("2 refunds reduced net by ฿9,600.");
    // /a1 is one of the campaign's two links: the list shows the whole campaign's ROAS, not /a1's net over the campaign's spend.
    expect(text()).toContain("Whole campaign ROAS 8.10× · ฿364,600 net ÷ ฿45,000 spend.");
    click(buttons("Open booking")[0]);
    expect(calls.stays).toHaveLength(1);
    expect(calls.stays[0]).toMatch(/^stay-/);
    click(buttons("All sources")[0]);
    expect(document.querySelector('nav[aria-label="Drill-down"]')).toBeNull();
  });

  it("links checkout orders to the order", () => {
    render(ready());
    click(document.querySelector('[role="tab"][id="breakdown-tab-link"]')!);
    click(buttons(/^\/q1.*Show sales$/)[0]);
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent?.includes("Open order"));
    expect(link?.getAttribute("href")).toMatch(/^\/admin\/receipt\/order-/);
  });

  it("says the coupon tab overlaps the others", () => {
    render(ready());
    click(document.querySelector('[role="tab"][id="breakdown-tab-coupon"]')!);
    expect(text()).toContain("never add it to the Source table");
    expect(text()).toContain("DCNT-F1-20");
    expect(text()).toContain("Paid uses");
  });

  it("asks for a new read when the basis changes", () => {
    render(ready());
    const finance = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Finance")!;
    click(finance);
    expect(calls.request).toEqual([{ ...DEFAULT_REQUEST(FIXTURE_TODAY), basis: "cash" }]);
  });

  it("shows the Finance tiles on a cash read", () => {
    render(ready(dashboardReport({ basis: "cash" })), { request: { ...DEFAULT_REQUEST(FIXTURE_TODAY), basis: "cash" } });
    for (const label of ["Collected", "Refunds", "Payments completed", "Money in and out", "Business total · all payments and refunds"]) expect(text()).toContain(label);
    expect(text()).not.toContain("left out of conversion");
    expect(text()).toContain("฿38,400");
    expect(text()).not.toContain("Tracked sessions");
  });

  it("previews the CSV in the export dialog", () => {
    render(ready());
    click(buttons("Export CSV")[0]);
    const preview = document.querySelector('[data-testid="csv-preview"]')?.textContent ?? "";
    expect(preview).toContain("# Time zone: Asia/Bangkok");
    expect(preview).toContain("Row,Source,");
  });

  it("shows loading, error with retry, first run, empty range, truncated and non-THB states", () => {
    render({ status: "loading" });
    expect(text()).toContain("Loading marketing results");

    render({ status: "error", message: "Server timed out." });
    expect(text()).toContain("Couldn’t load marketing results");
    click(buttons("Try again")[0]);
    expect(calls.retry).toBe(1);

    render(ready(firstRunReport()));
    expect(text()).toContain("See which links bring paid bookings");
    expect(document.querySelector('a[href="/admin/marketing/campaigns"]')).not.toBeNull();

    render(ready(emptyRangeReport()));
    expect(text()).toContain("No sales or tracked visits in these dates.");
    render(ready({ ...emptyRangeReport(), basis: "cash" }));
    expect(text()).toContain("No payments or refunds in these dates.");

    // Spend with no sales yet is a result, not an empty range.
    const empty = emptyRangeReport();
    render(ready({ ...empty, spend: [{ id: "sp-only" as never, campaignId: "c-fb-nov" as never, amount: 10_000, from: empty.from, to: empty.to }] }));
    expect(text()).not.toContain("No sales or tracked visits");
    expect(text()).toContain("0.00×");

    render(ready(dashboardReport({ truncated: true, nonThb: 3 })));
    expect(text()).toContain("These figures are incomplete");
    expect(text()).toContain("3 sales in another currency are left out");
  });

  it("keeps the figures on screen when a refresh fails", () => {
    render({ status: "ready", report: dashboardReport(), refreshError: "Server timed out." });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Couldn’t update the figures");
    expect(text()).toContain("Server timed out. These are the figures as of 7 Nov 2026, 06:00.");
    expect(text()).toContain("฿1,515,900");
    click(buttons("Try again")[0]);
    expect(calls.retry).toBe(1);
  });
});
