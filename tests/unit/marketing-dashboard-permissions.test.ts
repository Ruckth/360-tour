// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { marketingCapabilities } from 'convex/shared/marketingAccess';
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
  initialRequest: (today: string) => ({ basis: "cohort", range: { preset: "custom", from: today, to: today } }),
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

it.each(["range", "basis"] as const)("clears previous figures while a different %s loads", async (change) => {
  mocked.client.query.mockImplementationOnce((_ref, args) => Promise.resolve({ ...firstRunReport(), ...args }));
  await render("admin");
  expect(mocked.view!.state.status).toBe("ready");
  const request = mocked.view!.request;
  let finish!: (report: ReturnType<typeof firstRunReport>) => void;
  mocked.client.query.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => mocked.view!.onRequestChange(change === "basis"
    ? { ...request, basis: "cash" }
    : { ...request, range: { preset: "custom", from: "2026-10-01", to: "2026-10-31" } }));
  expect(mocked.view!.state).toEqual({ status: "loading" });
  const next = mocked.view!.request;
  await act(async () => finish({ ...firstRunReport(), from: next.range.from, to: next.range.to, basis: next.basis }));
  expect(mocked.view!.state).toMatchObject({ status: "ready", report: { from: next.range.from, to: next.range.to, basis: next.basis } });
});

it("retains figures for a same-scope refresh and preserves them on failure", async () => {
  mocked.client.query.mockImplementationOnce((_ref, args) => Promise.resolve({ ...firstRunReport(), ...args }));
  await render("admin");
  const initial = mocked.view!.state;
  expect(initial.status).toBe("ready");
  let fail!: (error: Error) => void;
  mocked.client.query.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await act(async () => mocked.view!.onRetry());
  expect(mocked.view!.state).toMatchObject({ status: "ready", refreshing: true });
  if (initial.status === "ready") expect(mocked.view!.state).toHaveProperty("report", initial.report);
  await act(async () => fail(new Error("Refresh unavailable")));
  expect(mocked.view!.state).toMatchObject({ status: "ready", refreshError: "Refresh unavailable" });
});
