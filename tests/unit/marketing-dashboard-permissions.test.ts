// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { marketingCapabilities } from "convex/lib/marketingAccess";
import { MarketingAccessProvider, type MarketingRole } from "@/components/admin/marketing/MarketingAccess";
import { DashboardScreen } from "@/components/admin/marketing/dashboard/DashboardScreen";
import type { DashboardViewProps } from "@/components/admin/marketing/dashboard/DashboardView";
import { firstRunReport } from "../browser/marketing-dashboard-data";

const mocked = vi.hoisted(() => ({ client: { query: vi.fn() }, query: vi.fn(), mutate: vi.fn(), bookingSheet: vi.fn(), view: null as DashboardViewProps | null }));
vi.mock("convex/react", () => ({
  useConvex: () => mocked.client,
  useMutation: () => mocked.mutate,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => { mocked.query(getFunctionName(ref), args); return undefined; },
}));
vi.mock("@/components/admin/BookingSheet", () => ({ BookingSheet: (props: unknown) => { mocked.bookingSheet(props); return null; } }));
vi.mock("@/components/admin/marketing/dashboard/DashboardView", () => ({
  DEFAULT_REQUEST: (today: string) => ({ basis: "cohort", range: { preset: "custom", from: today, to: today } }),
  DashboardView: (props: DashboardViewProps) => { mocked.view = props; return createElement("p", null, "Report"); },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); mocked.client.query.mockReset().mockResolvedValue(firstRunReport()); mocked.query.mockClear(); mocked.mutate.mockClear(); mocked.bookingSheet.mockClear(); mocked.view = null; });
afterEach(() => { act(() => root.unmount()); host.remove(); document.body.innerHTML = ""; });
async function render(role: MarketingRole) {
  await act(async () => root.render(createElement(MarketingAccessProvider, { value: { email: "person@example.com", role, capabilities: marketingCapabilities(role), pendingInvitation: null } }, createElement(DashboardScreen))));
}
it.each(["manager", "marketer", "finance", "viewer"] as const)("keeps operational booking queries unmounted for Marketing %s", async role => {
  await render(role);
  await act(async () => mocked.view!.onOpenStay("booking"));
  expect(mocked.bookingSheet).not.toHaveBeenCalled();
  expect(mocked.query.mock.calls.filter(call => call[0] === "catalog/properties:adminList").every(call => call[1] === "skip")).toBe(true);
  if (role === "marketer" || role === "viewer") {
    await expect(mocked.view!.onSaveSpend({ campaignId: "campaign" as Parameters<DashboardViewProps["onSaveSpend"]>[0]["campaignId"], amount: 10000, from: "2026-11-09", to: "2026-11-09" })).rejects.toThrow("cannot manage spend");
    expect(mocked.mutate).not.toHaveBeenCalled();
  }
});
it("retains operational booking details for system administrators", async () => {
  await render("admin");
  await act(async () => mocked.view!.onOpenStay("booking"));
  expect(mocked.bookingSheet).toHaveBeenCalledWith(expect.objectContaining({ bookingId: "booking" }));
  expect(mocked.query).toHaveBeenCalledWith("catalog/properties:adminList", {});
});
