// @vitest-environment happy-dom
import { StrictMode, act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Room } from "@/lib/data/rooms";
import { TourTextureCache } from "@/lib/tour/texture-cache";

type Loader = (path: string, signal: AbortSignal) => Promise<FakeTexture>;
const env = vi.hoisted(() => ({ adopt: undefined as undefined | Loader }));

// Stand in for WebGL: the canvas exposes the loader its scene would hand to the per-open cache.
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactElement<{ loader: Loader }> }) => {
    env.adopt = children.props.loader;
    return null;
  },
  useFrame: () => {},
  useThree: () => ({}),
}));
vi.mock("@react-three/drei", () => ({ OrbitControls: () => null, PerspectiveCamera: () => null }));

const { TourCanvas } = await import("@/components/tour/TourCanvas");

class FakeTexture {
  dispose = vi.fn();
  constructor(readonly path: string) {}
}

const ENTRY = "/tour/panoramas/v1/pool-villa-living-2048.webp";
const rooms = [
  { id: "living", imagePath: "/pool-villa-living.webp", hotspots: [] },
  { id: "pool", imagePath: "/pool-villa-pool.webp", hotspots: [] },
] as unknown as Room[];

let root: Root;
let calls: { path: string; signal: AbortSignal; resolve: (texture: FakeTexture) => void }[];
const loader = vi.fn<Loader>((path, signal) =>
  new Promise((resolve) => calls.push({ path, signal, resolve })));
const flush = () => act(async () => { await Promise.resolve(); });

function canvas(currentRoomId: string) {
  const noop = () => {};
  return createElement(StrictMode, null, createElement(TourCanvas, {
    initialTextureConfirmed: true, rooms, currentRoomId, previousRoomId: null, transitioning: false,
    onTransitionComplete: noop, onLoaded: noop, onNavigate: noop,
    loader: loader as unknown as NonNullable<Parameters<typeof TourCanvas>[0]["loader"]>,
  }));
}

beforeEach(async () => {
  calls = [];
  loader.mockClear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(canvas("living")));
  await flush();
});
afterEach(() => act(() => root.unmount()));

it("keeps one request through StrictMode's layout cleanup and replay, then WebGL adopts it", async () => {
  expect(loader).toHaveBeenCalledOnce();
  expect(calls[0].path).toBe(ENTRY);
  expect(calls[0].signal.aborted).toBe(false);

  const cache = new TourTextureCache({ load: env.adopt! });
  const acquired = cache.acquire(ENTRY, "requested");
  const texture = new FakeTexture(ENTRY);
  calls[0].resolve(texture);
  expect(await acquired).toEqual({ texture, failed: false });
  expect(loader).toHaveBeenCalledOnce();

  await act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  expect(texture.dispose).not.toHaveBeenCalled();
  cache.disposeAll();
  expect(texture.dispose).toHaveBeenCalledOnce();
});

it("aborts the staged request and disposes its late result when the viewer closes before WebGL", async () => {
  await act(() => root.unmount());
  root = createRoot(document.createElement("div"));
  await flush();
  expect(calls[0].signal.aborted).toBe(true);
  const late = new FakeTexture(ENTRY);
  calls[0].resolve(late);
  await flush();
  expect(late.dispose).toHaveBeenCalledOnce();
  expect(loader).toHaveBeenCalledOnce();
});

it("aborts the staged request when the selected room changes before WebGL, then loads the new room normally", async () => {
  await act(async () => root.render(canvas("pool")));
  await flush();
  expect(calls[0].signal.aborted).toBe(true);
  expect(loader).toHaveBeenCalledOnce();

  const pool = "/tour/panoramas/v1/pool-villa-pool-2048.webp";
  const cache = new TourTextureCache({ load: env.adopt! });
  const acquired = cache.acquire(pool, "requested");
  await flush();
  expect(loader.mock.calls.map(([path]) => path)).toEqual([ENTRY, pool]);
  const texture = new FakeTexture(pool);
  calls[1].resolve(texture);
  expect(await acquired).toEqual({ texture, failed: false });
  cache.disposeAll();
});
