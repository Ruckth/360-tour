// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({ calls: [] as [string, unknown][] }));
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    mocks.calls.push([name, args]);
    if (args === "skip") return undefined;
    if (name === "bookings/admin:searchBookings") return [{ _id: "k57booking0000000000000000000001", guestName: "Maya Chen", checkIn: "2026-12-01" }];
    if (name === "messaging/adminChat:listSessions") return { sessions: [{ _id: "k57chat000000000000000000000001", channel: "line", visitorName: "Maya" }], continueCursor: null };
    return undefined;
  },
}));
vi.mock("@/platform/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));
import { AdminRecordSearch } from "@/components/admin/AdminRecordSearch";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { staffAccessFor } from "./admin-shell-convex";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.calls = [];
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
const render = async (query: string, role: "manager" | "cashier" = "manager") => {
  await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor(role) }, createElement(AdminRecordSearch, { query, onOpen: () => {} }))));
};
const settle = () => act(async () => { vi.advanceTimersByTime(350); });

describe("admin Search record results (D03)", () => {
  it("groups permitted stays and chats, each opening its record in one activation", async () => {
    await render("maya");
    await settle();
    expect(host.querySelector('section[aria-label="Stays"] a')?.getAttribute("href")).toBe("/admin/hotel?booking=k57booking0000000000000000000001");
    expect(host.querySelector('section[aria-label="Chats"] a')?.getAttribute("href")).toBe("/admin/chats?session=k57chat000000000000000000000001");
    expect(mocks.calls).toContainEqual(["bookings/admin:searchBookings", { query: "maya" }]);
  });

  it("never asks for records a cashier can't open", async () => {
    await render("maya", "cashier");
    await settle();
    expect(host.querySelector("a")).toBeNull();
    expect(mocks.calls.every(([, args]) => args === "skip")).toBe(true);
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
