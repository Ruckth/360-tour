// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Texture } from "three";
import { expect, it, vi } from "vitest";
import { useTourTextures } from "@/components/tour/useTourTextures";
import type { Room } from "@/lib/data/rooms";

it("keeps a replacement scene pending until its own texture is shown", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  const images = new Map<string, (texture: Texture) => void>();
  const loader = (url: string) => new Promise<Texture>((resolve) => images.set(url, resolve));
  function View({ rooms }: { rooms: Room[] }) {
    const state = useTourTextures({
      rooms, currentRoomId: "living", previousRoomId: null, loader, panoramaWidth: 2048, maxTextureSize: 4096,
    });
    return createElement("output", { "data-ready": state.currentReady }, state.shown?.originalPath);
  }
  const render = (imagePath: string) => act(async () => {
    root.render(createElement(View, { rooms: [{ id: "living", name: "Living", imagePath, hotspots: [] }] }));
  });
  try {
    await render("/first-upload.webp");
    await act(async () => images.get("/first-upload.webp")!(new Texture()));
    expect(host.textContent).toBe("/first-upload.webp");
    expect(host.firstElementChild?.getAttribute("data-ready")).toBe("true");
    await render("/second-upload.webp");
    expect(host.textContent).toBe("/first-upload.webp");
    expect(host.firstElementChild?.getAttribute("data-ready")).toBe("false");
    await act(async () => images.get("/second-upload.webp")!(new Texture()));
    expect(host.textContent).toBe("/second-upload.webp");
    expect(host.firstElementChild?.getAttribute("data-ready")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
