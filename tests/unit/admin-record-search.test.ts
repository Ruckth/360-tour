// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({ calls: [] as [string, unknown][], failStays: false }));
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    mocks.calls.push([name, args]);
    if (args === "skip") return undefined;
    if (name === "bookings/admin:searchBookings" && mocks.failStays) throw new Error("Stay source failed");
    if (name === "bookings/admin:searchBookings") return [{ _id: "k57booking0000000000000000000001", guestName: "Maya Chen", checkIn: "2026-12-01" }];
    if (name === "messaging/adminChat:listSessions") return { sessions: [{ _id: "k57chat000000000000000000000001", channel: "line", visitorName: "Maya" }], continueCursor: null };
    if (name === "services/admin:searchAppointments") return { results: [{ _id: "spa1", start: Date.parse("2026-12-01T18:15:00Z"), guestName: "Maya Chen" }] };
    return undefined;
  },
}));
vi.mock("@/platform/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));
import { AdminRecordSearch } from "@/components/admin/AdminRecordSearch";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { PHUKET, staffAccessFor } from "./admin-shell-convex";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.calls = [];
  mocks.failStays = false;
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
const render = async (query: string, role: "manager" | "cashier" = "manager", branches?: typeof PHUKET[]) => {
  await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor(role, undefined, branches) }, createElement(AdminRecordSearch, { query, onOpen: () => {} }))));
};
const settle = () => act(async () => { vi.advanceTimersByTime(350); });

describe("admin Search record results (D03)", () => {
  it("groups permitted stays, chats and appointments, each opening its record in one activation", async () => {
    await render("maya");
    await settle();
    expect(host.querySelector('section[aria-label="Stays"] a')?.getAttribute("href")).toBe("/admin/hotel?booking=k57booking0000000000000000000001");
    expect(host.querySelector('section[aria-label="Chats"] a')?.getAttribute("href")).toBe("/admin/chats?session=k57chat000000000000000000000001");
    const appointment = host.querySelector('section[aria-label="Appointments"] a');
    expect(appointment?.getAttribute("href")).toBe("/admin/staff/calendar?date=2026-12-02&appointment=spa1");
    expect(appointment?.textContent).toContain("01:15");
    expect(mocks.calls).toContainEqual(["bookings/admin:searchBookings", { query: "maya" }]);
  });

  it("keeps authorized Spa results when Hotel and Chats access is removed", async () => {
    await render("maya");
    await settle();
    expect(host.querySelectorAll("a")).toHaveLength(3);
    await render("maya", "manager", [PHUKET]);
    expect(host.querySelectorAll("a")).toHaveLength(1);
    expect(host.querySelector('section[aria-label="Appointments"] a')).not.toBeNull();
    expect(mocks.calls.at(-1)).toEqual(["services/admin:searchAppointments", { query: "maya" }]);
  });

  it("recovers a rejected source without losing the current query or healthy results", async () => {
    mocks.failStays = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await render("maya");
      await settle();
      const chat = host.querySelector('section[aria-label="Chats"] a');
      const appointment = host.querySelector('section[aria-label="Appointments"] a');
      expect(chat).not.toBeNull();
      expect(appointment).not.toBeNull();
      const retry = host.querySelector<HTMLButtonElement>('section[aria-label="Stays"] button')!;
      expect(retry.textContent).toContain("Retry stays search");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not search stays");
      mocks.failStays = false;
      await act(async () => retry.click());
      expect(host.querySelector('section[aria-label="Stays"] a')?.textContent).toContain("Maya Chen");
      expect(host.querySelector('section[aria-label="Chats"] a')).toBe(chat);
      expect(host.querySelector('section[aria-label="Appointments"] a')).toBe(appointment);
      expect(mocks.calls.at(-1)).toEqual(["bookings/admin:searchBookings", { query: "maya" }]);
    } finally {
      errors.mockRestore();
    }
  });

  it("never asks for records a cashier can't open", async () => {
    await render("maya", "cashier");
    await settle();
    expect(host.querySelector("a")).toBeNull();
    expect(mocks.calls).toHaveLength(0);
  });

  it("shows nothing for text that changed since the last lookup, or under two characters", async () => {
    await render("maya");
    await settle();
    await render("mayb");
    expect(host.querySelector("a")).toBeNull();
    await render("m");
    await settle();
    expect(host.querySelector("a")).toBeNull();
  });
});
