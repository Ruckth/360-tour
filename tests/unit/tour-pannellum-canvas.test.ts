// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Room } from "@/lib/data/rooms";

vi.mock("pannellum/build/pannellum.js", () => ({}));
vi.mock("pannellum/build/pannellum.css", () => ({}));

type Listener = (value?: unknown) => void;
type SceneConfig = { panorama: string; hotSpots: { id: string; createTooltipFunc: (div: HTMLElement) => void }[] };

/** Pannellum's viewer contract as the component uses it: one scene loads at a time, then fires load or error. */
class FakeViewer {
  listeners = new Map<string, Listener[]>();
  scenes: Record<string, SceneConfig>;
  scene: string;
  loading = true;
  destroyed = false;
  yaw: number;
  pitch: number;
  hfov: number;
  hotspotHost = document.createElement("div");
  constructor(readonly container: HTMLElement, config: { default: { firstScene: string; yaw: number; pitch: number; hfov: number }; scenes: Record<string, SceneConfig> }) {
    this.scenes = { ...config.scenes };
    this.scene = config.default.firstScene;
    ({ yaw: this.yaw, pitch: this.pitch, hfov: this.hfov } = config.default);
    const canvas = document.createElement("canvas");
    container.append(canvas, this.hotspotHost);
    viewers.push(this);
  }
  get path() { return this.scenes[this.scene].panorama; }
  on(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    return this;
  }
  emit(type: string, value?: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(value); }
  addScene(id: string, config: SceneConfig) { this.scenes[id] = config; return this; }
  loadScene(id: string) {
    if (this.loading) return this;
    this.scene = id;
    this.loading = true;
    this.hotspotHost.replaceChildren();
    return this;
  }
  finish() {
    this.loading = false;
    for (const hotspot of this.scenes[this.scene].hotSpots) {
      const div = document.createElement("div");
      hotspot.createTooltipFunc(div);
      this.hotspotHost.append(div);
    }
    this.emit("load");
  }
  fail(message: string) { this.loading = false; this.emit("error", message); }
  getYaw() { return this.yaw; }
  getPitch() { return this.pitch; }
  getHfov() { return this.hfov; }
  setHfov() { return this; }
  setHfovBounds() { return this; }
  resize() {}
  destroy() { this.destroyed = true; this.container.replaceChildren(); }
}

let viewers: FakeViewer[];
const last = () => viewers[viewers.length - 1];

class NoopResizeObserver { observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const { PannellumTourCanvas } = await import("@/components/tour/PannellumTourCanvas");

const rooms = [
  { id: "living", name: "Living", imagePath: "/pool-villa-living.webp",
    hotspots: [{ id: "to-pool", position: [300, -30, -200], targetRoomId: "pool", label: "Pool Area" }] },
  { id: "pool", name: "Pool", imagePath: "/pool-villa-pool.webp", hotspots: [] },
  { id: "suite", name: "Suite", imagePath: "/garden-suite-interior.webp", hotspots: [] },
] as unknown as Room[];
const LIVING = "/tour/panoramas/v1/pool-villa-living-2048.webp";
const POOL = "/tour/panoramas/v1/pool-villa-pool-2048.webp";
const SUITE = "/tour/panoramas/v1/garden-suite-interior-2048.webp";

let root: Root;
let host: HTMLDivElement;
let props: Record<string, unknown>;
const spies = () => ({
  onTransitionComplete: vi.fn(), onLoaded: vi.fn(), onNavigate: vi.fn(), onLoadError: vi.fn(),
  onStatusChange: vi.fn(), onDetailStatusChange: vi.fn(), onFallback: vi.fn(),
});
let cb: ReturnType<typeof spies>;
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); });

async function render(next: Record<string, unknown> = {}) {
  props = { ...props, ...next };
  await act(async () => root.render(createElement(PannellumTourCanvas, props as never)));
  await flush();
}
const status = () => cb.onStatusChange.mock.lastCall;

beforeEach(async () => {
  viewers = [];
  (window as { pannellum?: unknown }).pannellum = { viewer: (el: HTMLElement, config: never) => new FakeViewer(el, config) };
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob()) })));
  cb = spies();
  props = { initialTextureConfirmed: true, rooms, currentRoomId: "living", previousRoomId: null, transitioning: false, ...cb };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("loads only the current room's rendition, then reports it drawn with an accessible hotspot", async () => {
  expect(viewers).toHaveLength(1);
  expect(last().path).toBe(LIVING);
  expect(last()).toMatchObject({ yaw: -90, pitch: 0 });
  expect(status()).toEqual(["loading", null]);
  expect(fetch).not.toHaveBeenCalled();

  await act(async () => last().finish());
  expect(status()).toEqual(["ready", "living"]);
  expect(cb.onLoaded).toHaveBeenCalledTimes(1);
  expect(cb.onDetailStatusChange).toHaveBeenLastCalledWith("available");

  const button = host.querySelector<HTMLButtonElement>("[data-testid=tour-hotspot]");
  expect(button?.textContent).toBe("Pool Area");
  button?.click();
  expect(cb.onNavigate).toHaveBeenCalledWith("pool");
});

it("keeps the last room on screen while the next loads, then completes the transition", async () => {
  await act(async () => last().finish());
  await render({ currentRoomId: "pool", previousRoomId: "living", transitioning: true });
  expect(last().path).toBe(POOL);
  expect(status()).toEqual(["pending", "living"]);
  expect(cb.onTransitionComplete).not.toHaveBeenCalled();

  await act(async () => last().finish());
  expect(cb.onTransitionComplete).toHaveBeenCalledTimes(1);
  await render({ previousRoomId: null, transitioning: false });
  expect(status()).toEqual(["ready", "pool"]);
  expect(viewers).toHaveLength(1);
});

it("loads the latest requested room after a rapid change during a load", async () => {
  await render({ currentRoomId: "pool" });
  await render({ currentRoomId: "suite" });
  // Pannellum ignores loadScene mid-load; the first scene finishes, then the latest request loads.
  expect(last().path).toBe(LIVING);
  await act(async () => last().finish());
  expect(cb.onLoaded).not.toHaveBeenCalled();
  expect(last().path).toBe(SUITE);
  await act(async () => last().finish());
  expect(status()).toEqual(["ready", "suite"]);
  expect(cb.onLoaded).toHaveBeenCalledTimes(1);
});

it("tries the original after a failed rendition, reports a failed original and retries", async () => {
  await act(async () => last().fail("tour-file-error:<a>x</a>"));
  expect(last().path).toBe("/pool-villa-living.webp");
  expect(cb.onLoadError).toHaveBeenLastCalledWith(false);

  await act(async () => last().fail("tour-file-error:<a>x</a>"));
  expect(status()).toEqual(["failed", null]);
  expect(cb.onLoadError).toHaveBeenLastCalledWith(true);
  expect(cb.onFallback).not.toHaveBeenCalled();

  await render({ retrySignal: 1 });
  expect(last().loading).toBe(true);
  expect(last().path).toBe(LIVING);
  await act(async () => last().finish());
  expect(status()).toEqual(["ready", "living"]);
  expect(cb.onLoadError).toHaveBeenLastCalledWith(false);
});

it("falls back to the existing renderer on an unusable WebGL renderer", async () => {
  await act(async () => last().fail("tour-renderer-error"));
  expect(cb.onFallback).toHaveBeenCalledTimes(1);
});

it("falls back when the guest asks for full detail", async () => {
  await act(async () => last().finish());
  await render({ detailRequest: { roomId: "living", originalPath: "/pool-villa-living.webp" } });
  expect(cb.onFallback).toHaveBeenCalledTimes(1);
});

it("recreates the viewer on the same scene and camera after a restored context", async () => {
  await act(async () => last().finish());
  await render({ currentRoomId: "pool" });
  await act(async () => last().finish());
  const first = last();
  first.yaw = 42;
  first.pitch = -10;
  const canvas = host.querySelector("canvas")!;

  const lost = new Event("webglcontextlost", { cancelable: true });
  await act(async () => canvas.dispatchEvent(lost));
  expect(lost.defaultPrevented).toBe(true);
  expect(status()).toEqual(["pending", "pool"]);

  await act(async () => canvas.dispatchEvent(new Event("webglcontextrestored")));
  await flush();
  expect(first.destroyed).toBe(true);
  expect(viewers).toHaveLength(2);
  expect(last()).toMatchObject({ yaw: 42, pitch: -10 });
  expect(last().path).toBe(POOL);
  await act(async () => last().finish());
  expect(status()).toEqual(["ready", "pool"]);
  expect(cb.onFallback).not.toHaveBeenCalled();
});

it("falls back when a lost context is not restored in time", async () => {
  await act(async () => last().finish());
  vi.useFakeTimers();
  await act(async () => host.querySelector("canvas")!.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  await act(async () => vi.advanceTimersByTime(3_000));
  expect(cb.onFallback).toHaveBeenCalledTimes(1);
});

it("prefetches likely next rooms only once the scene accepts input, and destroys the viewer on unmount", async () => {
  await act(async () => last().finish());
  expect(fetch).not.toHaveBeenCalled();
  await render({ prefetchAllowed: true });
  expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toEqual([POOL, SUITE]);
  const viewer = last();
  await act(() => root.unmount());
  expect(viewer.destroyed).toBe(true);
  root = createRoot(host);
});
