// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ReportData, ReportSale } from "convex/lib/marketingReport";
import { MarketingAccessProvider, type MarketingAccess } from "@/components/admin/marketing/MarketingAccess";
import { DashboardBreakdown } from "@/components/admin/marketing/dashboard/DashboardBreakdown";
import { SalesSheet } from "@/components/admin/marketing/dashboard/DashboardSheets";
import { DashboardTiles } from "@/components/admin/marketing/dashboard/DashboardTiles";
import { buildBreakdown, businessTotals, prepareReport } from "@/components/admin/marketing/dashboard/report-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

const covered: ReportSale = {
  kind: "order", id: "covered", label: "Free service", channel: "pos", bucket: "staff", createdDay: "2026-11-09",
  settlementDay: "2026-11-09", paid: true, collected: 0, refunded: 0, discount: 50000,
};
async function render(sales: ReportSale[], events: ReportData["events"] = [], access?: MarketingAccess) {
  const report: ReportData = {
    asOf: 0, from: "2026-11-09", to: "2026-11-09", basis: "cash", currency: "THB", timeZone: "Asia/Bangkok", model: "last_touch_30d@1",
    sales, events, sessions: [], campaigns: [], links: [], coupons: [], properties: [], spend: [], excluded: { nonThb: 0 }, truncated: false,
  };
  const p = prepareReport(report, { property: "all", touch: "last" });
  const sort = { key: "net", dir: "desc" } as const;
  const content = createElement(Fragment, null,
    createElement(DashboardTiles, { p, totals: businessTotals(p), onAddSpend() {}, onDefinitions() {} }),
    createElement(DashboardBreakdown, { p, b: buildBreakdown(p, "source", [], sort), sort, onSort() {}, onView() {}, onPath() {}, onOpen() {}, onAddSpend() {} }),
    createElement(SalesSheet, { p, target: { title: "Sales", lines: p.lines }, onClose() {}, onOpenStay() {}, orderHref: id => `/orders/${id}` }),
  );
  await act(async () => root.render(access ? createElement(MarketingAccessProvider, { value: access }, content) : content));
}

it("shows zero first-payment sales and one coupon-only settlement in Finance tiles, breakdown and detail", async () => {
  await render([covered]);
  const tile = [...host.querySelectorAll("p")].find(node => node.textContent === "First-payment sales")!.parentElement!;
  expect(tile.textContent).toContain("First-payment sales0");
  expect(tile.textContent).toContain("1 coupon-only checkout settlement");
  expect([...host.querySelectorAll("th")].some(node => node.textContent === "First paid")).toBe(true);
  expect(host.querySelector("tbody tr:last-child")!.children).toHaveLength(7);
  expect(host.querySelector("tbody tr:last-child")!.textContent).toContain("+1 coupon-only");
  const detail = document.querySelector('[role="dialog"]')!;
  expect(detail.textContent).toContain("Coupon-only settlement");
  expect(detail.textContent).toContain("฿500 off");
  expect(detail.textContent).not.toContain("first payment 9 Nov");
  expect(detail.textContent).toContain("coupon settlement 9 Nov");
});

it("describes a partially paid stay as payment received and counts its first payment", async () => {
  const stay: ReportSale = { ...covered, kind: "stay", id: "partial", label: "Partial stay", channel: "admin", discount: 0, collected: 30000, settlementDay: undefined, paidDay: "2026-11-09" };
  await render([stay], [{ saleId: stay.id, kind: "payment", day: "2026-11-09", amount: 30000 }]);
  const tile = [...host.querySelectorAll("p")].find(node => node.textContent === "First-payment sales")!.parentElement!;
  expect(tile.textContent).toContain("First-payment sales1");
  const detail = document.querySelector('[role="dialog"]')!;
  expect(detail.textContent).toContain("Payment received");
  expect(detail.textContent).not.toContain("Coupon-only settlement");
  expect(detail.textContent).not.toContain("Settled");
});


it("gives role-only readers sale details without spend or operational booking and receipt actions", async () => {
  const access: MarketingAccess = { email: "viewer@example.com", role: "viewer", pendingInvitation: null, capabilities: { view: true, draft: false, publish: false, spend: false, partners: false, reviewCredits: false, manageAccess: false } };
  const stay: ReportSale = { ...covered, kind: "stay", id: "stay", label: "Guest", collected: 30000, discount: 0, settlementDay: undefined, paidDay: "2026-11-09" };
  await render([covered, stay], [{ saleId: stay.id, kind: "payment", day: "2026-11-09", amount: 30000 }], access);
  const detail = document.querySelector('[role="dialog"]')!;
  expect(detail.textContent).toContain("Read-only sale details");
  expect(detail.textContent).toContain("Free service");
  expect(detail.textContent).toContain("Guest");
  expect([...document.querySelectorAll("button")].some(button => ["Open booking", "Add spend"].includes(button.textContent?.trim() ?? ""))).toBe(false);
  expect(document.querySelector('a[href^="/orders/"]')).toBeNull();
});
