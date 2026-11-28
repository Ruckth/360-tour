// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({ result: undefined as unknown, args: [] as unknown[] }));
vi.mock("convex/react", () => ({
  useQueries: (requests: Record<string, { query: Parameters<typeof getFunctionName>[0] }>) => {
    mocks.args.push(Object.keys(requests));
    if (!requests.queue) return {};
    expect(getFunctionName(requests.queue.query)).toBe("messaging/adminChat:queueCounts");
    return { queue: mocks.result };
  },
}));
vi.mock("@/platform/navigation", () => ({ usePathname: () => "/admin/hotel" }));
vi.mock("@/platform/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));
vi.mock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ setOpenMobile: () => {} }) }));
import { AdminTabBar } from "@/components/admin/AdminNav";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { waitingBadge } from "@/components/admin/waiting-chats";
import { PHUKET, staffAccessFor } from "./admin-shell-convex";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.args = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const chatsLink = () => host.querySelector<HTMLAnchorElement>('a[href="/admin/chats"]');

describe("Needs you badge in navigation (D02)", () => {
  it("shows the server's count on the Chats tab with an accessible name, from any page", async () => {
    mocks.result = { waiting: 3, inProgress: 0 };
    await act(async () => root.render(createElement(AdminTabBar)));
    expect(chatsLink()?.querySelector('[data-testid="nav-waiting-badge"]')?.textContent).toBe("3");
    expect(chatsLink()?.textContent).toContain(", 3 chats need you");
  });

  it("labels a capped count 99+ and keeps navigation without a count", async () => {
    expect(waitingBadge(100)).toEqual({ text: "99+", label: "99+ chats need you" });
    expect(waitingBadge(1)?.label).toBe("1 chat needs you");
    expect(waitingBadge(0)).toBeNull();
    expect(waitingBadge(null)).toBeNull();
    mocks.result = undefined;
    await act(async () => root.render(createElement(AdminTabBar)));
    expect(chatsLink()).not.toBeNull();
    expect(chatsLink()?.querySelector('[data-testid="nav-waiting-badge"]')).toBeNull();
  });

  it("keeps the Chats link available when the badge subscription fails", async () => {
    mocks.result = new Error("Queue unavailable");
    await act(async () => root.render(createElement(AdminTabBar)));
    expect(chatsLink()).not.toBeNull();
    expect(chatsLink()?.querySelector('[data-testid="nav-waiting-badge"]')).toBeNull();
  });

  it("skips the waiting count for an operations manager outside the resort", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("manager", undefined, [PHUKET]) }, createElement(AdminTabBar))));
    expect(chatsLink()).toBeNull();
    expect(mocks.args).toContainEqual([]);
    expect(mocks.args.flat()).toEqual([]);
  });

  it("never asks for the count for a person without Chats", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("cashier") }, createElement(AdminTabBar))));
    expect(chatsLink()).toBeNull();
    expect(mocks.args.flat()).toEqual([]);
  });
});
