// @vitest-environment happy-dom
import type { Doc, Id } from "convex/_generated/dataModel";
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  anglesToHotspotPosition,
  HOTSPOT_RADIUS,
  hotspotPositionToAngles,
  nudgeHotspotPosition,
} from "@/lib/tour-geometry";

type LoadCall = {
  url: string;
  resolve: () => void;
  reject: () => void;
  disposed: boolean;
};

const state = vi.hoisted(() => ({
  loads: [] as LoadCall[],
  setHotspots: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => state.setHotspots,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ useConfirm: () => state.confirm }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children?: ReactNode }) => createElement("div", { "data-testid": "mock-canvas" }, children),
  useThree: () => ({ camera: {}, gl: { domElement: document.createElement("canvas") } }),
}));
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: ReactNode }) => createElement(Fragment, null, children),
}));
vi.mock("@/components/tour/RoomSphere", () => ({
  RoomSphere: () => createElement("div", { "data-testid": "mock-sphere" }),
}));
vi.mock("@/components/tour/TourCanvas", () => ({
  TourCamera: () => null,
}));
vi.mock("@/components/tour/Hotspot", () => ({
  Hotspot: ({ label, onClick, selected }: { label: string; onClick?: () => void; selected?: boolean }) =>
    createElement(
      "button",
      { type: "button", "data-testid": "tour-hotspot", "data-selected": String(Boolean(selected)), onClick },
      label,
    ),
}));
vi.mock("three", () => {
  class MockTextureLoader {
    load(
      url: string,
      onLoad?: (texture: { colorSpace?: string; dispose: () => void }) => void,
      _onProgress?: unknown,
      onError?: (err: unknown) => void,
    ) {
      const entry: LoadCall = {
        url,
        disposed: false,
        resolve: () => {
          onLoad?.({
            colorSpace: "",
            dispose: () => {
              entry.disposed = true;
            },
          });
        },
        reject: () => onError?.(new Error("Load failed")),
      };
      state.loads.push(entry);
      return {};
    }
  }
  return {
    TextureLoader: MockTextureLoader,
    SRGBColorSpace: "srgb",
    Raycaster: class {},
    Vector2: class {},
  };
});

import { HotspotEditorDialog } from "@/components/admin/HotspotEditorDialog";

function makeRoom(overrides: Partial<Doc<"tourScenes">> = {}): Doc<"tourScenes"> {
  return {
    _id: "room-living" as Id<"tourScenes">,
    _creationTime: 1,
    propertyId: "prop-1" as Id<"properties">,
    slug: "living",
    name: "Garden Suite",
    imagePath: "/garden-suite.webp",
    hotspots: [
      {
        id: "h1",
        label: "To pool",
        targetRoomSlug: "pool",
        position: anglesToHotspotPosition(45, 5),
      },
    ],
    ...overrides,
  };
}

let root: Root;
let host: HTMLDivElement;

const render = (node: ReactNode) => act(async () => root.render(node));
const setInput = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.loads = [];
  state.setHotspots.mockReset().mockResolvedValue(null);
  state.confirm.mockReset().mockResolvedValue(true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Tour hotspot angle geometry helpers (F17)", () => {
  it("wraps headings across 0/360, clamps elevation to [-85, 85], and preserves HOTSPOT_RADIUS", () => {
    const start = anglesToHotspotPosition(355, 82);
    expect(Math.hypot(...start)).toBeCloseTo(HOTSPOT_RADIUS, 0);

    const wrapped = nudgeHotspotPosition(start, 10, 10);
    expect(hotspotPositionToAngles(wrapped)).toEqual({ heading: 5, elevation: 85 });

    const wrappedBack = nudgeHotspotPosition(wrapped, -10, -200);
    expect(hotspotPositionToAngles(wrappedBack)).toEqual({ heading: 355, elevation: -85 });
  });
});

describe("HotspotEditorDialog keyboard selection/repositioning and loading/error recovery (F17, F18)", () => {
  const living = makeRoom();
  const pool = makeRoom({
    _id: "room-pool" as Id<"tourScenes">,
    slug: "pool",
    name: "Pool Deck",
    imagePath: "/pool-deck.webp",
    hotspots: [],
  });
  const rooms = [living, pool];

  it("F17: selects and repositions an existing hotspot via keyboard marker activation and Hotspot list controls, returning focus on close", async () => {
    const onClose = vi.fn();
    await render(
      createElement(HotspotEditorDialog, {
        room: living,
        rooms,
        onClose,
        onCloseAutoFocus: () => {},
      }),
    );

    // Finish initial texture load.
    await act(async () => state.loads[0].resolve());
    expect(document.body.textContent).not.toContain("Loading Garden Suite panorama…");

    // Keyboard activation of the 3D marker selects the hotspot without pointerdown.
    const markerBtn = document.querySelector<HTMLButtonElement>('[data-testid="tour-hotspot"]')!;
    await act(async () => markerBtn.click());

    const listAside = document.querySelector<HTMLElement>('aside[aria-label="Hotspot list"]')!;
    expect(listAside).not.toBeNull();
    const headingInput = listAside.querySelector<HTMLInputElement>('input[aria-label="Heading"]')!;
    const elevationInput = listAside.querySelector<HTMLInputElement>('input[aria-label="Elevation"]')!;
    expect(Number(headingInput.value)).toBeCloseTo(45, 0);
    expect(Number(elevationInput.value)).toBeCloseTo(5, 0);

    // Nudge Right 5° and Up 5° updates the same draft position.
    const rightBtn = [...listAside.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Right 5°"))!;
    const upBtn = [...listAside.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Up 5°"))!;
    await act(async () => rightBtn.click());
    await act(async () => upBtn.click());
    expect(Number(headingInput.value)).toBeCloseTo(50, 0);
    expect(Number(elevationInput.value)).toBeCloseTo(10, 0);

    // Direct numeric entry wraps and clamps cleanly.
    await setInput(headingInput, "370");
    await setInput(elevationInput, "95");
    expect(Number(headingInput.value)).toBeCloseTo(10, 0);
    expect(Number(elevationInput.value)).toBeCloseTo(85, 0);

    // Closing the position editor returns focus to the hotspot's list button.
    const closePositionBtn = [...listAside.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Close")!;
    await act(async () => closePositionBtn.click());
    const editListBtn = [...listAside.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Edit To pool"))!;
    expect(document.activeElement).toBe(editListBtn);

    // Save hotspots sends the updated valid coordinates.
    const saveBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Save hotspots"))!;
    expect(saveBtn.disabled).toBe(false);
    await act(async () => saveBtn.click());
    expect(state.setHotspots).toHaveBeenCalledWith({
      roomId: living._id,
      hotspots: [
        expect.objectContaining({
          id: "h1",
          label: "To pool",
          targetRoomSlug: "pool",
          position: anglesToHotspotPosition(10, 85),
        }),
      ],
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("F18: displays loading state, recovers from a failed panorama load without losing hotspot drafts, and ignores stale room loads", async () => {
    const onClose = vi.fn();
    await render(
      createElement(HotspotEditorDialog, {
        room: living,
        rooms,
        onClose,
        onCloseAutoFocus: () => {},
      }),
    );

    // While loading, visible indicator names the room.
    expect(document.body.textContent).toContain("Loading Garden Suite panorama…");
    expect(state.loads).toHaveLength(1);
    expect(state.loads[0].url).toBe("/garden-suite.webp");

    // Edit a draft while loading/before failure, then fail the texture request.
    const editBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Edit To pool"))!;
    await act(async () => editBtn.click());
    const rightBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Right 5°"))!;
    await act(async () => rightBtn.click());

    await act(async () => state.loads[0].reject());
    expect(document.body.textContent).toContain("Could not load Garden Suite panorama");
    expect(document.body.textContent).toContain("Your hotspot drafts are still here");

    // Retry re-requests the exact same asset and keeps the edited draft position.
    const retryBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Retry panorama"))!;
    await act(async () => retryBtn.click());
    expect(state.loads).toHaveLength(2);
    expect(state.loads[1].url).toBe("/garden-suite.webp");
    expect(document.body.textContent).toContain("Loading Garden Suite panorama…");

    await act(async () => state.loads[1].resolve());
    expect(document.body.textContent).not.toContain("Loading Garden Suite panorama…");
    expect(document.body.textContent).not.toContain("Could not load Garden Suite panorama");
    // Draft edit (50° heading) survived image failure & retry.
    const headingInput = document.querySelector<HTMLInputElement>('input[aria-label="Heading"]')!;
    expect(Number(headingInput.value)).toBeCloseTo(50, 0);

    // Stale load check: enter Preview, walk to Pool Deck, then have an older load fail/resolve late.
    const previewBtn = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Preview"))!;
    await act(async () => previewBtn.click());
    // Preview keeps living room initially; navigate via marker to pool.
    await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="tour-hotspot"]')!.click());
    expect(document.body.textContent).toContain("Loading Pool Deck panorama…");
    const poolLoad = state.loads.at(-1)!;
    expect(poolLoad.url).toBe("/pool-deck.webp");

    // Return to editing (switches back to living room) BEFORE poolLoad resolves.
    await act(async () => previewBtn.click());
    const livingReload = state.loads.at(-1)!;
    expect(livingReload.url).toBe("/garden-suite.webp");

    // Late error from stale poolLoad must be ignored and not break living room.
    await act(async () => poolLoad.reject());
    expect(document.body.textContent).not.toContain("Could not load");
    await act(async () => livingReload.resolve());
    expect(document.body.textContent).not.toContain("Loading Garden Suite panorama…");
  });
});
