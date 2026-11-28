// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const facts = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("convex/react", () => ({ useQuery: () => facts.value, useAction: () => vi.fn() }));
vi.mock("@/components/admin/useChannelConfig", () => ({
  useChannelConfig: () => ({ state: "ready", retry: () => {}, channels: Object.fromEntries(["line", "facebook", "instagram", "whatsapp"].map((key) => [key, { configured: true, vars: {} }])) }),
}));
vi.mock("@/platform/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => createElement("a", { href, ...props }, children) }));
import { SetupChecklistCard } from "@/components/admin/SetupChecklist";
import { hotelPanel } from "@/components/admin/admin-routes";

const allDone = {
  profileSaved: true, villaReady: true, aiKey: true, email: true, stripe: true, messagingImageSecret: true, icalSynced: true,
  channelsReplied: { line: true, facebook: true, instagram: true, whatsapp: true },
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async () => act(async () => root.render(createElement(SetupChecklistCard)));
const visibleRows = () => [...host.querySelectorAll(":scope > details > ul > li")].map((row) => row.textContent);

describe("setup checklist", () => {
  it("shows remaining work first and folds completed steps behind a count (N05)", async () => {
    facts.value = { ...allDone, icalSynced: false };
    await render();
    const rows = visibleRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("An OTA calendar synced");
    const completed = host.querySelector<HTMLDetailsElement>('[data-testid="setup-checklist-completed"]')!;
    expect(completed.open).toBe(false);
    expect(completed.querySelector("summary")?.textContent).toBe("Completed (11)");
    // Diagnostics in completed rows stay reachable inside the fold-out.
    expect(completed.textContent).toContain("Send test email");
  });

  it("links the OTA calendar step straight to the hotel's OTA calendars panel (N04)", async () => {
    facts.value = { ...allDone, icalSynced: false };
    await render();
    expect(host.querySelector('a[href="/admin/hotel?panel=ota-calendars"]')?.textContent).toBe("OTA calendars");
    expect(hotelPanel("ota-calendars")).toBe("ota-calendars");
    expect(hotelPanel("ota-calendars ")).toBeNull();
    expect(hotelPanel(null)).toBeNull();
  });

  it("lists every step once setup is complete, with no Completed fold-out", async () => {
    facts.value = allDone;
    await render();
    expect(visibleRows()).toHaveLength(12);
    expect(host.querySelector('[data-testid="setup-checklist-completed"]')).toBeNull();
  });
});
