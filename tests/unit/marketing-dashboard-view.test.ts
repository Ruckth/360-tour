// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendDialogProps } from "@/components/admin/marketing/SpendDialog";
import { DashboardView, DEFAULT_REQUEST, type DashboardViewProps, type ReportState } from "@/components/admin/marketing/dashboard/DashboardView";
import { MarketingAccessProvider, type MarketingRole } from "@/components/admin/marketing/MarketingAccess";
import { marketingCapabilities } from "convex/lib/marketingAccess";
import { csvMeta, salesCsv, summaryCsv } from "@/components/admin/marketing/dashboard/report-csv";
import { buildBreakdown, businessTotals, prepareReport } from "@/components/admin/marketing/dashboard/report-model";
import type { ReportData, ReportSale } from "convex/lib/marketingReport";
import { dashboardReport, FIXTURE_TODAY, firstRunReport, emptyRangeReport, PROPERTIES, untrackedReport } from "../browser/marketing-dashboard-data";

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
      "# Conversion: distinct consented sessions behind tracked paid stays / sessions started in range; breakdowns follow the session link and campaign",
      "# Dates: 2026-10-08 to 2026-11-06",
      "# Property: All properties",
      "# As of: 7 Nov 2026, 06:00 Asia/Bangkok",
    ]);
    const cash = prepareReport(dashboardReport({ basis: "cash", truncated: true, nonThb: 2 }), { property: "prop-canopy", touch: "first" });
    const meta = csvMeta(cash, "Canopy Halo Loft").map((cells) => cells[0]);
    expect(meta).toContain("# Attribution: last_touch_30d@1 (first touch)");
    expect(meta).toContain("# Basis: Finance (cash date: money and coupon settlements dated in range)");
    expect(meta).toContain("# Property: Canopy Halo Loft");
    expect(meta.some((line) => line.startsWith("# Incomplete"))).toBe(true);
    expect(meta).toContain("# Left out: 2 sales in another currency");
  });

  it("exports the current table with positive refunds and its totals", () => {
    const lines = csvLines(summaryCsv(p, "All properties", buildBreakdown(p, "link", [], { key: "net", dir: "desc" }), ""));
    const header = lines.find((line) => line.startsWith("Row,"))!;
    expect(header).toBe("Row,Link,Detail,Sessions,Paid,Other paid sales,Current-link paid stays,Converted sessions,Session conversion %,Discounts,Collected,Refunds,Net");
    const a1 = lines.find((line) => line.startsWith("tracked,/a1,"))!.split(",");
    expect(a1.slice(3)).toEqual(["2310", "24", "0", "0", "24", "1.04", a1[9], "197800", "9600", "188200"]);
    expect(lines.some((line) => /,'-|,-\d/.test(line))).toBe(false);
    expect(lines.find((line) => line.startsWith("not tracked,Unknown"))).toContain(",352800");
    expect(lines.at(-2)).toMatch(/^total,Tracked total,,11980,132,4,2,130,1\.09,/);
    expect(lines.at(-1)).toBe('total,Business total,"All paid sales, tracked or not",,179,7,2,0,,93700,1554300,38400,1515900');
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

  function render(state: ReportState, extra: Partial<DashboardViewProps> = {}, role?: MarketingRole) {
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
    const view = createElement(DashboardView, props);
    act(() => root.render(role ? createElement(MarketingAccessProvider, { value: { email: "person@example.com", role, capabilities: marketingCapabilities(role), pendingInvitation: null } }, view) : view));
  }
  const ready = (report = dashboardReport()): ReportState => ({ status: "ready", report });
  const text = () => document.body.textContent ?? "";
  const buttons = (name: string | RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => (typeof name === "string" ? b.textContent?.trim() === name || b.getAttribute("aria-label") === name : name.test(b.getAttribute("aria-label") ?? b.textContent ?? "")));
  const click = (el: Element) => act(() => (el as HTMLElement).click());

  it.each(["viewer", "finance"] as const)("does not offer setup actions to %s", role => {
    render(ready(firstRunReport()), {}, role);
    expect([...document.querySelectorAll("a")].some(a => /Create a campaign|Make a link/.test(a.textContent ?? ""))).toBe(false);
    expect(text()).toContain("Ask a manager");
  });

  it.each(["viewer", "marketer"] as const)("renders a redacted custom-price stay gracefully for %s", role => {
    const report = dashboardReport();
    const custom = report.sales.find(sale => sale.kind === "stay" && sale.last?.slug === "a1")!;
    custom.customPrice = true;
    custom.discount = 0;
    custom.label = "Guest";
    delete custom.ref;
    report.sales = [custom];
    render(ready(report), {}, role);
    click(buttons("Link")[0]);
    click(buttons(/^\/a1.*Show sales/)[0]);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Guest");
    expect(dialog.textContent).toContain("Custom price");
    expect(dialog.textContent).not.toContain("undefined");
    expect(dialog.textContent).not.toContain("Open booking");
  });

  it("renders the tiles, context line and breakdown from the fixture", () => {
    render(ready());
    expect(text()).toContain("As of 7 Nov 2026, 06:00");
    expect(text()).toContain("Asia/Bangkok · THB");
    expect(text()).toContain("Last touch (last_touch_30d@1)");
    expect(text()).toContain("11,980");
    expect(text()).toContain("179 paid stays in all · 7 checkout orders count in money only");
    // The ROAS tile says which campaigns its figure leaves out.
    expect(text()).toMatch(/2 campaigns with spend · \d+ more campaigns? with sales ha(s|ve) no spend\./);
    expect(text()).toContain("1.09%");
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
    for (const label of ["Collected", "Refunds", "First-payment sales", "Money in and out", "Business total · payments, refunds and coupon settlements"]) expect(text()).toContain(label);
    expect(text()).not.toContain("left out of conversion");
    expect(text()).toContain("฿38,400");
    expect(text()).not.toContain("Consented sessions");
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

  describe("before the first campaign or link", () => {
    const sale = (overrides: Partial<ReportSale>): ReportSale => ({
      kind: "stay",
      id: "stay-x",
      label: "Anna Weber",
      propertyId: PROPERTIES[0].id,
      channel: "web",
      bucket: "unknown",
      createdDay: "2026-10-20",
      paidDay: "2026-10-20",
      paid: true,
      collected: 0,
      refunded: 0,
      discount: 0,
      ...overrides,
    });
    const exportButton = () => buttons("Export CSV")[0];
    const onboardingOnly = "Paid bookings and money from those links show up here";
    const baht = (n: number) => `฿${n.toLocaleString("en-US")}`;

    it("shows the business totals and export, with setup guidance alongside", () => {
      const report = untrackedReport();
      expect(report.sales.length).toBeGreaterThan(0);
      render({ status: "ready", report, refreshError: "Server timed out." });
      expect(text()).toContain("Couldn’t update the figures");
      expect(text()).not.toContain(onboardingOnly);
      expect(text()).toContain("Business total");
      expect(text()).toContain("Not tracked");
      expect(text()).toContain("No campaigns or links yet");
      expect(document.querySelector('a[href="/admin/marketing/campaigns"]')).not.toBeNull();
      expect(document.querySelector('a[href="/admin/marketing/links"]')).not.toBeNull();

      // The CSV's business total is the figure on screen.
      const net = businessTotals(prepareReport(report, { property: "all", touch: "last" })).all.net;
      expect(net).toBeGreaterThan(0);
      expect(text()).toContain(baht(net));
      expect(exportButton().disabled).toBe(false);
      click(exportButton());
      const preview = document.querySelector('[data-testid="csv-preview"]')?.textContent ?? "";
      expect(preview.split(/\r?\n/).find((line) => line.startsWith("total,Business total"))).toMatch(new RegExp(`,${net}(,|$)`));
    });

    it("counts a Finance range with only a refund as activity", () => {
      const report: ReportData = {
        ...untrackedReport({ basis: "cash" }),
        sales: [sale({ id: "stay-r", createdDay: "2026-09-20", paidDay: "2026-09-20", collected: 4800, refunded: 4800 })],
        events: [{ saleId: "stay-r", kind: "refund", day: "2026-10-20", amount: 4800 }],
      };
      render(ready(report), { request: { ...DEFAULT_REQUEST(FIXTURE_TODAY), basis: "cash" } });
      expect(text()).not.toContain(onboardingOnly);
      expect(text()).toContain("Business total");
      expect(text()).toContain("฿4,800");
      expect(exportButton().disabled).toBe(false);
    });

    it("counts a coupon-only, zero-net sale as activity", () => {
      const report: ReportData = { ...untrackedReport(), sessions: [], sales: [sale({ kind: "order", id: "order-c", propertyId: undefined, channel: "pos", bucket: "staff", collected: 0, discount: 500 })] };
      render(ready(report));
      expect(text()).not.toContain(onboardingOnly);
      expect(text()).toContain("Business total");
      expect(exportButton().disabled).toBe(false);
    });

    it("keeps the setup-only welcome for a business with no activity at all", () => {
      render(ready(firstRunReport()));
      expect(text()).toContain(onboardingOnly);
      expect(text()).not.toContain("Business total");
      expect(exportButton().disabled).toBe(true);
    });

    it("says a property has no sales instead of showing the welcome when only the filter is empty", async () => {
      const report = { ...untrackedReport(), properties: [...PROPERTIES, { id: "prop-empty" as ReportData["properties"][number]["id"], name: "Quiet Villa" }] };
      render(ready(report));
      const trigger = document.querySelector<HTMLElement>('[aria-label="Property"]')!;
      await act(async () => void trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      const option = [...document.querySelectorAll('[role="option"]')].find((el) => el.textContent?.includes("Quiet Villa"))!;
      await act(async () => void option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
      expect(text()).toContain("No sales for Quiet Villa in these dates.");
      expect(text()).not.toContain(onboardingOnly);
      expect(text()).toContain("No campaigns or links yet");
    });

    it("shows a finance or viewer role the figures and who to ask, without setup actions", () => {
      render(ready(untrackedReport()), {}, "finance");
      expect(text()).toContain("Business total");
      expect(text()).toContain("No campaigns or links yet");
      expect(text()).toContain("Ask a manager to set up campaigns and links");
      expect([...document.querySelectorAll("a")].some((a) => /Create a campaign|Make a link/.test(a.textContent ?? ""))).toBe(false);
    });

    it("treats a visit-only range as activity, without claiming sales", () => {
      const report: ReportData = { ...untrackedReport(), sales: [], events: [] };
      expect(report.sessions.length).toBeGreaterThan(0);
      render(ready(report));
      expect(text()).not.toContain(onboardingOnly);
      expect(text()).toContain("Consented sessions3,120");
      expect(text()).not.toContain("No sales or tracked visits in these dates.");
      expect(text()).toContain("No campaigns or links yet");
    });
  });

  it("never calls an incomplete read with no rows empty", () => {
    for (const report of [{ ...firstRunReport(), truncated: true }, { ...emptyRangeReport(), truncated: true }]) {
      render(ready(report));
      expect(text()).toContain("These figures are incomplete");
      expect(text()).not.toContain("No sales or tracked visits in these dates.");
      expect(text()).not.toContain("Paid bookings and money from those links show up here");
      expect(text()).toContain("may still have sales");
      // Its CSV says it is incomplete, so it can still be exported.
      expect(buttons("Export CSV")[0].disabled).toBe(false);
    }
    render(ready({ ...emptyRangeReport(), basis: "cash", truncated: true }));
    expect(text()).not.toContain("No payments or refunds in these dates.");
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
