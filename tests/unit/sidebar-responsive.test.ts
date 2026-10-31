// @vitest-environment happy-dom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";

let root: Root;
let node: HTMLDivElement;
let sidebar: ReturnType<typeof useSidebar>;
let width = 390;
const queries: Array<{ target: EventTarget; query: string }> = [];

function Harness() {
  const current = useSidebar();
  useEffect(() => { sidebar = current; });
  return null;
}

async function resize(nextWidth: number) {
  await act(async () => {
    width = nextWidth;
    queries.forEach(({ target }) => target.dispatchEvent(new Event("change")));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", (query: string) => {
    const target = new EventTarget();
    queries.push({ target, query });
    return {
      get matches() { return width < Number(query.match(/[\d.]+/)?.[0]); },
      media: query,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    };
  });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  queries.length = 0;
  vi.unstubAllGlobals();
});

async function mount(viewport: number) {
  width = viewport;
  await act(async () => {
    root.render(createElement(SidebarProvider, null, createElement(Harness)));
  });
}

describe("responsive sidebar", () => {
  it.each([390, 768, 820, 1024, 1180, 1366, 1399, 1399.5])(
    "starts closed and opens as a drawer at %spx", async (viewport) => {
      await mount(viewport);
      expect(sidebar.isMobile).toBe(true);
      expect(sidebar.openMobile).toBe(false);
      await act(async () => sidebar.toggleSidebar());
      expect(sidebar.openMobile).toBe(true);
      expect(sidebar.open).toBe(true);
      await act(async () => sidebar.toggleSidebar());
      expect(sidebar.openMobile).toBe(false);
    },
  );

  it.each([1400, 1440])("retains desktop collapse at %spx", async (viewport) => {
    await mount(viewport);
    expect(sidebar.isMobile).toBe(false);
    await act(async () => sidebar.toggleSidebar());
    expect(sidebar.state).toBe("collapsed");
    expect(sidebar.openMobile).toBe(false);
  });

  it("clears a stale drawer across layout changes and preserves desktop collapse", async () => {
    await mount(1440);
    await act(async () => sidebar.setOpen(false));
    await resize(820);
    await act(async () => sidebar.toggleSidebar());
    expect(sidebar.openMobile).toBe(true);
    await resize(1180);
    expect(sidebar.openMobile).toBe(true);
    await resize(1440);
    expect(sidebar.openMobile).toBe(false);
    expect(sidebar.state).toBe("collapsed");
    await resize(820);
    expect(sidebar.openMobile).toBe(false);
  });
});
