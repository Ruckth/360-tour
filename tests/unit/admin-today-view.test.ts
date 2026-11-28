// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { resortMidnight } from "@/lib/staff-bookings";
import { serverTodayIso } from "@/components/admin/admin-bookings-shared";
import { addDaysIso } from "@/lib/booking/dates";

const mocks = vi.hoisted(() => ({ calls: [] as [string, unknown][], search: "", queue: { waiting: 3, inProgress: 0 } as unknown }));
const today = serverTodayIso();
const stay = (id: string, checkIn: string, checkOut: string, owed = 0) => ({ _id: id, guestName: id, checkIn, checkOut, status: "confirmed", owed, currency: "THB" });
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    mocks.calls.push([name, args]);
    if (args === "skip") return undefined;
    if (name === "bookings/admin:listForAdmin") return { complete: true, bookings: [stay("a", today, addDaysIso(today, 2)), stay("b", today, addDaysIso(today, 1), 500), stay("c", addDaysIso(today, -2), today)] };
    if (name === "services/admin:listSchedule") {
      const start = resortMidnight(today);
      return { appointments: [{ start: start + 3_600_000, status: "booked" }, { start: start + 7_200_000, status: "cancelled" }, { start: start - 3_600_000, status: "booked" }] };
    }
    return undefined;
  },
  useQueries: (requests: { queue?: { query: Parameters<typeof getFunctionName>[0]; args: unknown } }) => {
    const request = requests.queue;
    if (!request) {
      mocks.calls.push(["messaging/adminChat:queueCounts", "skip"]);
      return {};
    }
    mocks.calls.push([getFunctionName(request.query), request.args]);
    return { queue: mocks.queue };
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

  it("keeps Hotel and Spa summaries when the chat count fails", async () => {
    mocks.queue = new Error("Count unavailable");
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount("/admin/chats")).toBe("Needs you—");
    expect(linkCount("/admin/hotel?today=arriving")).toBe("Arriving2");
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBe("Open appointments today1");
  });

  it("keeps Spa available without exposing Hotel or Chats to a manager outside the resort", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("manager", undefined, [PHUKET]) }, createElement(AdminTodayView))));
    expect(mocks.calls).toContainEqual(["bookings/admin:listForAdmin", "skip"]);
    expect(mocks.calls).toContainEqual(["messaging/adminChat:queueCounts", "skip"]);
    expect(host.querySelectorAll("a")).toHaveLength(1);
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBe("Open appointments today1");
  });

  it("asks for nothing and links nowhere a cashier can't open", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("cashier") }, createElement(AdminTodayView))));
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(mocks.calls.every(([, args]) => args === "skip")).toBe(true);
  });

  it("refreshes its appointment date and stay range across Bangkok midnight", async () => {
    const tomorrow = addDaysIso(today, 1);
    vi.useFakeTimers();
    vi.setSystemTime(resortMidnight(tomorrow) - 30_000);
    await act(async () => root.render(createElement(AdminTodayView)));
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBeDefined();

    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(linkCount(`/admin/staff/calendar?date=${today}&scope=open`)).toBeUndefined();
    expect(linkCount(`/admin/staff/calendar?date=${tomorrow}&scope=open`)).toBeDefined();
    expect(mocks.calls).toContainEqual(["bookings/admin:listForAdmin", {
      from: today, to: addDaysIso(tomorrow, 1), bookingsOnly: true, includeRecordedStays: true,
    }]);
  });

  it("opens Hotel's Today strip on the linked group", async () => {
    mocks.search = "today=arriving";
    await act(async () => root.render(createElement(TodayStrip, { villaName: () => "Villa", onOpen: () => {} })));
    expect(host.querySelector('button[aria-expanded="true"]')?.textContent).toContain("Arriving");
  });
});
