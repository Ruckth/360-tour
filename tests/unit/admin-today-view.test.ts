// @vitest-environment happy-dom
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { resortMidnight } from "@/lib/staff-bookings";
import { serverTodayIso } from "@/components/admin/admin-bookings-shared";
import { addDaysIso } from "@/lib/booking/dates";

const mocks = vi.hoisted(() => ({ calls: [] as [string, unknown][], search: "", queue: { waiting: 3, inProgress: 0 } as unknown, complete: true, failHotel: false, failSpa: false }));
const today = serverTodayIso();
const stay = (id: string, checkIn: string, checkOut: string, owed = 0) => ({ _id: id, guestName: id, checkIn, checkOut, status: "confirmed", owed, currency: "THB" });
function readMock(name: string, args: unknown) {
  mocks.calls.push([name, args]);
  if (args === "skip") return undefined;
  if (name === "bookings/admin:listForAdmin") return mocks.failHotel ? new Error("Hotel unavailable") : { complete: mocks.complete, bookings: [stay("a", today, addDaysIso(today, 2)), stay("b", today, addDaysIso(today, 1), 500), stay("c", addDaysIso(today, -2), today)] };
  if (name === "services/admin:listSchedule") {
    const start = resortMidnight(today);
    return mocks.failSpa ? new Error("Spa unavailable") : { appointments: [{ start: start + 3_600_000, status: "booked" }, { start: start + 7_200_000, status: "cancelled" }, { start: start - 3_600_000, status: "booked" }] };
  }
  if (name === "messaging/adminChat:queueCounts") return mocks.queue;
  return undefined;
}
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => readMock(getFunctionName(reference), args),
  useQueries: (requests: Record<string, { query: Parameters<typeof getFunctionName>[0]; args: unknown }>) => {
    // Convex's subscription hook refreshes synchronously when the request identity changes.
    const [previous, setPrevious] = useState(requests);
    if (requests !== previous) setPrevious(requests);
    return Object.fromEntries(Object.entries(requests).map(([key, request]) => [key, readMock(getFunctionName(request.query), request.args)]));
  },
}));
vi.mock("@/platform/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));
vi.mock("@/platform/navigation", () => ({ useSearchParams: () => new URLSearchParams(mocks.search) }));
import { AdminTodayView } from "@/components/admin/AdminTodayView";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { TodayStrip } from "@/components/admin/TodayStrip";
import { PHUKET, staffAccessFor } from "./admin-shell-convex";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.calls = [];
  mocks.search = "";
  mocks.queue = { waiting: 3, inProgress: 0 };
  mocks.complete = true;
  mocks.failHotel = false;
  mocks.failSpa = false;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const linkCount = (href: string) => host.querySelector(`a[href="${href}"]`)?.textContent;

describe("Today home (D01)", () => {
  it("gives a manager today's counts, each linking to its own list", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("manager") }, createElement(AdminTodayView))));
    expect(linkCount("/admin/hotel?today=arriving")).toBe("Arriving2");
    expect(linkCount("/admin/hotel?today=leaving")).toBe("Leaving1");
    expect(linkCount("/admin/hotel?today=balanceDue")).toBe("Balance due1");
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBe("Open appointments today1");
    expect(linkCount("/admin/chats")).toBe("Needs you3");
  });

  it("settles subscription updates when staff access changes after mount", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("cashier") }, createElement(AdminTodayView))));
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("manager") }, createElement(AdminTodayView))));
    expect(linkCount("/admin/hotel?today=arriving")).toBe("Arriving2");
    expect(linkCount("/admin/chats")).toBe("Needs you3");
  });

  it("keeps Hotel and Spa summaries when the chat count fails", async () => {
    mocks.queue = new Error("Count unavailable");
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount("/admin/chats")).toBe("Open chat queueCount unavailable");
    expect(linkCount("/admin/hotel?today=arriving")).toBe("Arriving2");
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBe("Open appointments today1");
  });

  it.each(["hotel", "spa"] as const)("isolates an unavailable %s report", async (tile) => {
    mocks.failHotel = tile === "hotel";
    mocks.failSpa = tile === "spa";
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount("/admin/hotel?today=arriving")).toBe(tile === "hotel" ? "ArrivingCount unavailable" : "Arriving2");
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBe(tile === "spa" ? "Open appointments todayCount unavailable" : "Open appointments today1");
    expect(linkCount("/admin/chats")).toBe("Needs you3");
  });

  it("keeps Spa available without exposing Hotel or Chats to a manager outside the resort", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("manager", undefined, [PHUKET]) }, createElement(AdminTodayView))));
    expect(mocks.calls.some(([name]) => name === "bookings/admin:listForAdmin")).toBe(false);
    expect(mocks.calls.some(([name]) => name === "messaging/adminChat:queueCounts")).toBe(false);
    expect(host.querySelectorAll("a")).toHaveLength(1);
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBe("Open appointments today1");
  });

  it("keeps every desk count on a phone-height grid and widens a lone desk", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("manager") }, createElement(AdminTodayView))));
    const tile = (name: string) => host.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
    // Hotel's four counts share one row (2×2 on phones); Spa and Chats sit side by side.
    expect(tile("Hotel").className).toContain("col-span-2");
    expect(tile("Hotel").querySelector(".grid-cols-2")?.querySelectorAll("a")).toHaveLength(4);
    expect(tile("Spa").className).not.toContain("col-span-2");
    expect(tile("Chats").className).not.toContain("col-span-2");
    expect(host.querySelector('a[href="/admin/chats"] [role="status"]')?.className).toContain("text-2xl");

    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("manager", undefined, [PHUKET]) }, createElement(AdminTodayView))));
    expect(tile("Spa").className).toContain("col-span-2");
  });

  it("keeps an unavailable count as readable text instead of a large figure", async () => {
    mocks.failSpa = true;
    await act(async () => root.render(createElement(AdminTodayView)));
    const count = host.querySelector(`a[href="/admin/staff/calendar?date=${today}&scope=open"] [role="status"]`);
    expect(count?.textContent).toBe("Count unavailable");
    expect(count?.className).toContain("text-sm");
  });

  it("asks for nothing and links nowhere a cashier can't open", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("cashier") }, createElement(AdminTodayView))));
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).toContain("Use the navigation to open your available workspaces");
    expect(mocks.calls).toHaveLength(0);
  });

  it("refreshes its appointment date and stay range across Bangkok midnight", async () => {
    const tomorrow = addDaysIso(today, 1);
    vi.useFakeTimers();
    vi.setSystemTime(resortMidnight(tomorrow) - 30_000);
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBeDefined();

    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBeUndefined();
    expect(linkCount(`/admin/staff/calendar?date=${tomorrow}&scope=open`)).toBeDefined();
    expect(host.querySelector("time")?.dateTime).toBe(tomorrow);
    expect(mocks.calls).toContainEqual(["bookings/admin:listForAdmin", {
      from: today, to: addDaysIso(tomorrow, 1), bookingsOnly: true, includeRecordedStays: true,
    }]);
  });

  it("labels partial counts at the desk link and in the linked Hotel group", async () => {
    mocks.complete = false;
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount("/admin/hotel?today=arriving")).toBe("Arriving2 (partial)");
    mocks.search = "today=arriving";
    await act(async () => root.render(createElement(TodayStrip, { villaName: () => "Villa", onOpen: () => {} })));
    expect(host.querySelector('button[aria-expanded="true"]')?.textContent).toContain("Partial");
  });

  it("distinguishes loading from a verified empty chat queue", async () => {
    mocks.queue = undefined;
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount("/admin/chats")).toBe("Needs youLoading count");
    mocks.queue = { waiting: 0, inProgress: 0 };
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount("/admin/chats")).toBe("Needs you0");
  });

  it("opens Hotel's Today strip on the linked group", async () => {
    mocks.search = "today=arriving";
    await act(async () => root.render(createElement(TodayStrip, { villaName: () => "Villa", onOpen: () => {} })));
    expect(host.querySelector('button[aria-expanded="true"]')?.textContent).toContain("Arriving");
  });
});
