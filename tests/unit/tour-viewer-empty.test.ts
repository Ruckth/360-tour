// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Property } from "@/lib/data/properties";

const rooms = vi.hoisted(() => ({ loading: false }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/react/convex", () => ({ useConvexQuery: () => ({ data: [], loading: rooms.loading }) }));
vi.mock("@/lib/i18n/use-public-messages", () => ({ usePublicMessages: () => ({}) }));
vi.mock("@/components/tour/TourCanvas", () => ({ TourCanvas: () => null }));

const { TourViewer } = await import("@/components/tour/TourViewer");
const villa = { id: "new-villa", name: "New Villa", tourRoomIds: [] } as unknown as Property;

describe("a villa with no tour rooms", () => {
  let root: Root | undefined;
  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    rooms.loading = false;
    document.body.innerHTML = "";
    document.body.style.overflow = "";
    vi.unstubAllGlobals();
  });

  /** Mirrors VillaCard/RoomDetailClient: closing unmounts the viewer through onClose. */
  async function openTour() {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const onClose = vi.fn();
    function Parent() {
      const [open, setOpen] = useState(true);
      return open ? createElement(TourViewer, { property: villa, onClose: () => { onClose(); setOpen(false); } }) : null;
    }
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await act(async () => root!.render(createElement(Parent)));
    return onClose;
  }
  const closeButton = () => [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === "close");

  it("shows a closable screen and restores the page's previous overflow", async () => {
    document.body.style.overflow = "scroll";
    const onClose = await openTour();
    const dialog = document.querySelector('[data-testid="tour-viewer"]');
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.textContent).toContain("unavailable");
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(closeButton());

    await act(async () => closeButton()!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-testid="tour-viewer"]')).toBeNull();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("closes with Escape", async () => {
    const onClose = await openTour();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("");
  });

  it("keeps the intro close control while rooms are still loading", async () => {
    rooms.loading = true;
    const onClose = await openTour();
    expect(document.querySelector('[data-scene-status="loading"]')).not.toBeNull();
    await act(async () => closeButton()!.click());
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("");
  });
});
