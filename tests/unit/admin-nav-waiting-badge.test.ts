// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

const mocks = vi.hoisted(() => ({ result: undefined as unknown, args: [] as unknown[] }));
vi.mock("convex/react", () => ({
  useQuery: (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    expect(getFunctionName(reference)).toBe("messaging/adminChat:waitingCount");
    mocks.args.push(args);
    return args === "skip" ? undefined : mocks.result;
  },
}));
vi.mock("@/platform/navigation", () => ({ usePathname: () => "/admin/hotel" }));
vi.mock("@/platform/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));
vi.mock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ setOpenMobile: () => {} }) }));
import { AdminTabBar } from "@/components/admin/AdminNav";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { waitingBadge } from "@/components/admin/waiting-chats";
import { staffAccessFor } from "./admin-shell-convex";

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
    mocks.result = { count: 3, capped: false };
    await act(async () => root.render(createElement(AdminTabBar)));
    expect(chatsLink()?.querySelector('[data-testid="nav-waiting-badge"]')?.textContent).toBe("3");
    expect(chatsLink()?.textContent).toContain(", 3 chats need you");
  });

  it("labels a capped count 99+ and keeps navigation without a count", async () => {
    expect(waitingBadge({ count: 99, capped: true })).toEqual({ text: "99+", label: "99+ chats need you" });
    expect(waitingBadge({ count: 1, capped: false })?.label).toBe("1 chat needs you");
    expect(waitingBadge({ count: 0, capped: false })).toBeNull();
    expect(waitingBadge(null)).toBeNull();
    mocks.result = undefined;
    await act(async () => root.render(createElement(AdminTabBar)));
    expect(chatsLink()).not.toBeNull();
    expect(chatsLink()?.querySelector('[data-testid="nav-waiting-badge"]')).toBeNull();
  });

  it("never asks for the count for a person without Chats", async () => {
    await act(async () => root.render(createElement(StaffAccessProvider, { access: staffAccessFor("cashier") }, createElement(AdminTabBar))));
    expect(chatsLink()).toBeNull();
    expect(mocks.args.every((args) => args === "skip")).toBe(true);
  });
});
