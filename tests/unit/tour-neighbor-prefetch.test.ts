// @vitest-environment happy-dom
import {
  StrictMode,
  act,
  createContext,
  createElement,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Texture } from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Property } from "@/lib/data/properties";
import type { Room } from "@/lib/data/rooms";
import { fakeTourClient } from "./tour-live-client";

type MockSphere = {
  material: { opacity: number };
  draw: () => void;
};

const env = vi.hoisted(() => ({
  client: undefined as unknown,
  userId: null as string | null,
  reads: [] as { slug: string; resolve: (value: unknown) => void; reject: (error: unknown) => void }[],
  canvas: null as HTMLCanvasElement | null,
  canvasVisible: true,
  holdScene: false,
  canvasRect: { width: 390, height: 844 },
  hitTarget: undefined as Element | null | undefined,
  invalidate: vi.fn(),
  changedDrawCallback: vi.fn(),
  frames: new Set<(delta: number) => void>(),
  spheres: new Set<MockSphere>(),
}));

const CanvasContext = createContext<HTMLCanvasElement | null>(null);

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query(_query: unknown, { slug }: { slug: string }) {
      return new Promise((resolve, reject) => env.reads.push({ slug, resolve, reject }));
    }
  },
}));
vi.mock("@/platform/intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/platform/auth", () => ({ useAuth: () => ({ userId: env.userId }) }));
vi.mock("convex/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("convex/react")>(),
  useConvex: () => env.client,
}));
vi.mock("@/lib/i18n/use-public-messages", () => ({ usePublicMessages: () => ({ Rooms: {} }) }));
vi.mock("@react-three/drei", () => ({
  Html: ({ children }: { children?: ReactNode }) => children ?? null,
  OrbitControls: () => null,
  PerspectiveCamera: () => null,
}));
vi.mock("@react-three/fiber", () => ({
  Canvas({ children }: { children?: ReactNode }) {
    // R3F can commit its children after the surrounding DOM root.
    const [committedChildren, setCommittedChildren] = useState(children);
    if (!env.holdScene && committedChildren !== children) setCommittedChildren(children);
    const [canvas] = useState(() => {
      const node = document.createElement("canvas");
      Object.defineProperty(node, "checkVisibility", {
        configurable: true,
        value: () => env.canvasVisible,
      });
      node.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: env.canvasRect.width,
        bottom: env.canvasRect.height,
        width: env.canvasRect.width,
        height: env.canvasRect.height,
        toJSON: () => ({}),
      });
      return node;
    });
    const hostRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      env.canvas = canvas;
      host.appendChild(canvas);
      return () => {
        canvas.remove();
        if (env.canvas === canvas) env.canvas = null;
      };
    }, [canvas]);
    return createElement(CanvasContext.Provider, { value: canvas }, createElement("div", { ref: hostRef }, committedChildren));
  },
  useFrame(callback: (state: { invalidate: () => void }, delta: number) => void) {
    const callbackRef = useRef(callback);
    useLayoutEffect(() => {
      callbackRef.current = callback;
    });
    useEffect(() => {
      const entry = (delta: number) => callbackRef.current({ invalidate: env.invalidate }, delta);
      env.frames.add(entry);
      return () => {
        env.frames.delete(entry);
      };
    }, []);
  },
  useThree<T>(selector: (state: {
    invalidate: () => void;
    gl: { domElement: HTMLCanvasElement; capabilities: { maxTextureSize: number } };
    get: () => { size: { width: number; height: number }; viewport: { dpr: number } };
  }) => T): T {
    const canvas = useContext(CanvasContext);
    if (!canvas) throw new Error("useThree called outside Canvas");
    return selector({
      invalidate: env.invalidate,
      gl: { domElement: canvas, capabilities: { maxTextureSize: 4096 } },
      get: () => ({ size: { width: 390, height: 844 }, viewport: { dpr: 1.5 } }),
    });
  },
}));
function setMaterialRef(
  ref: { current: { opacity: number } | null } | undefined,
  value: { opacity: number } | null,
) {
  if (ref) ref.current = value;
}

function clearMaterialRef(
  ref: { current: { opacity: number } | null } | undefined,
  expected: { opacity: number },
) {
  if (ref?.current === expected) ref.current = null;
}

vi.mock("@/components/tour/RoomSphere", () => ({
  RoomSphere(props: {
    texture: Texture;
    opacity?: number;
    materialRef?: { current: { opacity: number } | null };
    onAfterRender?: (
      gl: unknown,
      scene: unknown,
      camera: { quaternion: { x: number; y: number; z: number; w: number } },
      geometry: unknown,
      material: { opacity: number },
      group: unknown,
    ) => void;
  }) {
    const { opacity = 1, materialRef, onAfterRender } = props;
    const renderRef = useRef(onAfterRender);
    useLayoutEffect(() => {
      renderRef.current = onAfterRender;
      env.changedDrawCallback();
    }, [onAfterRender]);
    useEffect(() => {
      if (!renderRef.current) return;
      const material = { opacity };
      setMaterialRef(materialRef, material);
      const entry: MockSphere = {
        material,
        draw() {
          renderRef.current?.(null, null, { quaternion: { x: 0, y: 0, z: 0, w: 1 } }, null, material, null);
        },
      };
      env.spheres.add(entry);
      return () => {
        env.spheres.delete(entry);
        clearMaterialRef(materialRef, material);
      };
    }, [materialRef, opacity]);
    return null;
  },
}));

const { TourCanvas } = await import("@/components/tour/TourCanvas");
const { TourViewer } = await import("@/components/tour/TourViewer");
const { loadPanorama } = await import("@/components/tour/useTourTextures");

const LIVING_2048 = "/tour/panoramas/v1/pool-villa-living-2048.webp";
const POOL_2048 = "/tour/panoramas/v1/pool-villa-pool-2048.webp";
const GARDEN_2048 = "/tour/panoramas/v1/garden-villa-360-2048.webp";
const BEDROOM_2048 = "/tour/panoramas/v1/penthouse-bedroom-2048.webp";
const SUITE_2048 = "/tour/panoramas/v1/garden-suite-interior-2048.webp";

type DbScene = {
  slug: string;
  name: string;
  imagePath: string;
  hotspots: { id: string; position: [number, number, number]; targetRoomSlug: string; label: string }[];
};

const fourRoomTour = (): DbScene[] => [
  {
    slug: "pv-living",
    name: "Living Room",
    imagePath: "/pool-villa-living.webp",
    hotspots: [{ id: "h-bed", position: [1, 0, 0], targetRoomSlug: "pv-bedroom", label: "Bedroom" }],
  },
  {
    slug: "pv-pool",
    name: "Pool",
    imagePath: "/pool-villa-pool.webp",
    hotspots: [{ id: "h-suite", position: [1, 0, 0], targetRoomSlug: "pv-suite", label: "Suite" }],
  },
  {
    slug: "pv-garden",
    name: "Garden",
    imagePath: "/garden-villa-360.webp",
    hotspots: [],
  },
  {
    slug: "pv-bedroom",
    name: "Bedroom",
    imagePath: "/penthouse-bedroom.webp",
    hotspots: [],
  },
  {
    slug: "pv-suite",
    name: "Suite",
    imagePath: "/garden-suite-interior.webp",
    hotspots: [],
  },
];

const villa = (id: string) => ({ id, name: `Villa ${id}`, tourRoomIds: [] }) as unknown as Property;

describe("deferred neighbor panorama prefetch lifecycle", () => {
  let root: Root;
  let convex: ReturnType<typeof fakeTourClient>;
  let requestedUrls: string[];
  let cancelledUrls: string[];
  let pendingImages: Map<string, FakeImage[]>;
  let rafQueue: Map<number, FrameRequestCallback>;
  let nextRafId: number;
  let originalElementFromPoint: PropertyDescriptor | undefined;

  class FakeImage extends EventTarget {
    crossOrigin: string | null = null;
    private currentSrc: string | null = null;

    get src(): string {
      return this.currentSrc ?? "";
    }

    set src(value: string) {
      this.currentSrc = value;
      if (!value) return;
      requestedUrls.push(value);
      const list = pendingImages.get(value) ?? [];
      list.push(this);
      pendingImages.set(value, list);
    }

    getAttribute(name: string): string | null {
      return name === "src" ? this.currentSrc : null;
    }

    removeAttribute(name: string): void {
      if (name !== "src") return;
      const previous = this.currentSrc;
      this.currentSrc = null;
      if (!previous) return;
      cancelledUrls.push(previous);
      const list = pendingImages.get(previous);
      if (list) {
        const remaining = list.filter((item) => item !== this);
        if (remaining.length) pendingImages.set(previous, remaining);
        else pendingImages.delete(previous);
      }
    }

    resolveLoad(): void {
      this.dispatchEvent(new Event("load"));
    }

    rejectLoad(): void {
      this.dispatchEvent(new Event("error"));
    }
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("Image", FakeImage);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    delete window.__tourBench;

    requestedUrls = [];
    cancelledUrls = [];
    pendingImages = new Map();
    rafQueue = new Map();
    nextRafId = 1;

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafQueue.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
      rafQueue.delete(id);
    });

    convex = fakeTourClient();
    env.client = convex.client;
    env.userId = null;
    env.reads = [];
    env.canvas = null;
    env.canvasVisible = true;
    env.holdScene = false;
    env.canvasRect = { width: 390, height: 844 };
    env.hitTarget = undefined;
    env.invalidate.mockClear();
    env.frames.clear();
    env.spheres.clear();
    originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => (env.hitTarget !== undefined ? env.hitTarget : env.canvas),
    });
    root = createRoot(document.body.appendChild(document.createElement("div")));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
    else Reflect.deleteProperty(document, "elementFromPoint");
    document.body.innerHTML = "";
    document.body.style.overflow = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const flushMicrotasks = () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const takePending = (url: string) => {
    const list = pendingImages.get(url);
    const img = list?.shift();
    if (!img) throw new Error(`No pending image for ${url}. Pending: ${[...pendingImages.keys()].join(", ")}`);
    if (!list!.length) pendingImages.delete(url);
    return img;
  };

  const resolveImage = async (url: string) => {
    await act(async () => {
      takePending(url).resolveLoad();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const failImage = async (url: string) => {
    await act(async () => {
      takePending(url).rejectLoad();
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const drawScene = async () => {
    await act(async () => {
      for (const sphere of [...env.spheres]) sphere.draw();
      await Promise.resolve();
    });
  };

  const advanceCrossfade = async (delta: number) => {
    await act(async () => {
      for (const frame of [...env.frames]) frame(delta);
      await Promise.resolve();
    });
  };

  const stepRaf = async () => {
    const batch = [...rafQueue.values()];
    rafQueue.clear();
    await act(async () => {
      for (const cb of batch) cb(performance.now());
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  const renderViewer = (property = villa("pool-villa"), strict = false) =>
    act(async () => {
      const node = createElement(TourViewer, { property, onClose: () => {} });
      root.render(strict ? createElement(StrictMode, null, node) : node);
    });

  const deliver = (slug: string, value: unknown) => act(async () => {
    convex.deliver(slug, value);
    await Promise.resolve();
  });

  const buttonByText = (name: string) =>
    [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === name).at(-1);

  it("keeps the staged mobile 2048 load early and defers hotspot-priority neighbors until after the first usable frame paints", async () => {
    env.canvasVisible = false; // Simulate CSS opacity transition at t=0 (computed opacity === 0).
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());

    // Initial confirmed mobile 2048 image starts early via staged load; no neighbors or masters.
    expect(requestedUrls).toEqual([LIVING_2048]);
    expect(window.__tourBench).toBeUndefined();

    // First image finishes and calls invalidate(): still zero speculative neighbor requests.
    await resolveImage(LIVING_2048);
    expect(env.invalidate).toHaveBeenCalled();
    expect(requestedUrls).toEqual([LIVING_2048]);

    expect(env.canvas?.closest(".pointer-events-none")).toBeTruthy();
    env.changedDrawCallback.mockClear();
    env.invalidate.mockClear();

    // Texture availability alone cannot dismiss the intro.
    await drawScene();
    expect(env.canvas?.closest(".pointer-events-none")).toBeNull();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Opacity becomes > 0: first usable frame paints now — still zero neighbor requests on this frame.
    env.canvasVisible = true;
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Next frame after the usable frame has painted: hotspot target first, then next sequential room
    // (bounded by prefetchConcurrency = 2), using mobile 2048 renditions and never unresized masters.
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    expect(requestedUrls.every((url) => url.endsWith("-2048.webp"))).toBe(true);
    // Bookkeeping for speculative downloads must not update the Three mesh or request a draw.
    expect(env.changedDrawCallback).not.toHaveBeenCalled();
    expect(env.invalidate).not.toHaveBeenCalled();
  });

  it("reveals the drawn room while input is locked and resumes neighbors on confirmation", async () => {
    const rooms: Room[] = [
      { id: "living", name: "Living", imagePath: "/pool-villa-living.webp", hotspots: [] },
      { id: "pool", name: "Pool", imagePath: "/pool-villa-pool.webp", hotspots: [] },
    ];
    const onLoaded = vi.fn();
    const noop = () => {};
    const render = (locked: boolean) => act(async () => root.render(createElement(TourCanvas, {
      rooms, currentRoomId: "living", previousRoomId: null, transitioning: false,
      initialTextureConfirmed: !locked, inputLocked: locked, prefetchAllowed: !locked,
      onTransitionComplete: noop, onLoaded, onNavigate: noop,
    })));
    await render(true);
    await resolveImage(LIVING_2048);
    expect(onLoaded).not.toHaveBeenCalled();
    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(requestedUrls).toEqual([LIVING_2048]);

    await render(false);
    await stepRaf();
    await stepRaf();
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(requestedUrls).toContain(POOL_2048);
  });

  it("revokes a pending neighbor start in the commit that locks input", async () => {
    const rooms: Room[] = [
      { id: "living", name: "Living", imagePath: "/pool-villa-living.webp", hotspots: [] },
      { id: "pool", name: "Pool", imagePath: "/pool-villa-pool.webp", hotspots: [] },
    ];
    const noop = () => {};
    function Screen({ locked, queuedFrame }: { locked: boolean; queuedFrame?: FrameRequestCallback }) {
      useLayoutEffect(() => {
        // A browser frame delivered after the new scene commits, before passive cleanup.
        if (locked) queuedFrame?.(performance.now());
      }, [locked, queuedFrame]);
      return createElement(TourCanvas, {
        rooms, currentRoomId: "living", previousRoomId: null, transitioning: false,
        onTransitionComplete: noop, onLoaded: noop, onNavigate: noop,
        initialTextureConfirmed: true, inputLocked: locked, prefetchAllowed: !locked,
      });
    }
    await act(async () => root.render(createElement(Screen, { locked: false })));
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    expect(rafQueue.size).toBe(1);
    const [queuedFrame] = rafQueue.values();
    env.holdScene = true;
    await act(async () => root.render(createElement(Screen, { locked: true, queuedFrame })));
    expect(requestedUrls).toEqual([LIVING_2048]);
  });

  it("does not prefetch after first draw while intro still intercepts input or canvas wrapper hides it", async () => {
    const rooms: Room[] = [
      {
        id: "living",
        name: "Living",
        imagePath: "/pool-villa-living.webp",
        hotspots: [{ id: "h1", position: [1, 0, 0], targetRoomId: "bedroom", label: "Bedroom" }],
      },
      { id: "pool", name: "Pool", imagePath: "/pool-villa-pool.webp", hotspots: [] },
      { id: "bedroom", name: "Bedroom", imagePath: "/penthouse-bedroom.webp", hotspots: [] },
    ];
    const noop = () => {};
    const renderCanvas = (prefetchAllowed: boolean) =>
      act(async () => {
        root.render(
          createElement(
            "div",
            { "data-testid": "wrapper" },
            createElement(TourCanvas, {
              initialTextureConfirmed: true,
              rooms,
              currentRoomId: "living",
              previousRoomId: null,
              transitioning: false,
              onTransitionComplete: noop,
              onLoaded: noop,
              onNavigate: noop,
              prefetchAllowed,
            }),
          ),
        );
      });

    await renderCanvas(false);
    const hostWrapper = document.querySelector<HTMLElement>('[data-testid="wrapper"]')!;
    hostWrapper.style.pointerEvents = "none";
    hostWrapper.style.opacity = "0";

    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Intro releases state flag, but ancestor still blocks pointer events.
    await renderCanvas(true);
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Pointer events restored, but ancestor opacity is still 0.
    hostWrapper.style.pointerEvents = "auto";
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Canvas becomes visible (opacity > 0): zero neighbors on the first visible frame, then prefetch.
    hostWrapper.style.opacity = "0.08";
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
  });

  it("allows prefetch when an ancestor sets pointer-events:none but a child re-enables events, and respects pointer hit targets", async () => {
    const rooms: Room[] = [
      {
        id: "living",
        name: "Living",
        imagePath: "/pool-villa-living.webp",
        hotspots: [{ id: "h1", position: [1, 0, 0], targetRoomId: "bedroom", label: "Bedroom" }],
      },
      { id: "pool", name: "Pool", imagePath: "/pool-villa-pool.webp", hotspots: [] },
      { id: "bedroom", name: "Bedroom", imagePath: "/penthouse-bedroom.webp", hotspots: [] },
    ];
    const noop = () => {};
    await act(async () => {
      root.render(
        createElement(
          "div",
          { "data-testid": "outer", style: { pointerEvents: "none" } },
          createElement(
            "div",
            { "data-testid": "inner", style: { pointerEvents: "auto" } },
            createElement(TourCanvas, {
              initialTextureConfirmed: true,
              rooms,
              currentRoomId: "living",
              previousRoomId: null,
              transitioning: false,
              onTransitionComplete: noop,
              onLoaded: noop,
              onNavigate: noop,
              prefetchAllowed: true,
            }),
          ),
        ),
      );
    });

    const canvas = env.canvas!;
    const coveringOverlay = document.createElement("div");
    env.hitTarget = coveringOverlay;

    await resolveImage(LIVING_2048);
    await drawScene();

    // Covering intro/overlay still intercepts pointer hits -> no prefetch.
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Once pointer hits reach the canvas itself, ancestor pointer-events:none must NOT block prefetch.
    env.hitTarget = canvas;
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
  });

  it("keeps explicit navigation immediate, cancels pending Room 1 prefetch, and waits through crossfade for Room 2", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();

    // Advance one frame (first usable frame seen, post-paint prefetch queued for next frame).
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Navigate explicitly to Pool before Room 1's post-paint prefetch fires.
    await act(async () => {
      buttonByText("Pool")!.click();
      await Promise.resolve();
    });
    expect(requestedUrls).toEqual([LIVING_2048, POOL_2048]);

    // Flushing rAFs while Pool is loading must NOT run Room 1's cancelled prefetch.
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, POOL_2048]);

    // Pool texture resolves -> enters crossfade (opacity starts at 0, then fades in across 12 capped steps).
    await resolveImage(POOL_2048);
    await advanceCrossfade(1 / 30); // frame 0 -> opacity 0
    await drawScene();
    for (let step = 0; step < 6; step++) await advanceCrossfade(1 / 30); // mid-crossfade -> opacity 0.5
    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, POOL_2048]);

    // Crossfade completes -> Room 2 is ready and accepts input -> next usable + post-paint frame prefetches Room 2's hotspot first.
    for (let step = 0; step < 7; step++) await advanceCrossfade(1 / 30);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, POOL_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, POOL_2048, SUITE_2048, GARDEN_2048]);
  });

  it("blocks neighbor prefetch while disconnected or unconfirmed and resumes after fresh confirmation", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Connection drops before the post-paint frame: scheduled rAF is cancelled.
    await act(async () => convex.disconnect());
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Reconnects without a fresh server delivery yet: still locked and no prefetch.
    await act(async () => convex.reconnect());
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Fresh server delivery unlocks input; prefetch resumes after usable + post-paint frames.
    await deliver("pool-villa", fourRoomTour());
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
  });

  it("cancels scheduled and in-flight neighbor transfers on close and villa switch with zero work after teardown", async () => {
    // Subcase A: close while post-paint rAF is still queued.
    await renderViewer(villa("villa-a"));
    await deliver("villa-a", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    await act(async () => root.unmount());
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    expect(pendingImages.size).toBe(0);

    // Subcase B: start prefetching neighbors, then switch villa -> in-flight image src cleared immediately.
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await renderViewer(villa("villa-a"));
    await deliver("villa-a", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, LIVING_2048, BEDROOM_2048, POOL_2048]);
    expect(pendingImages.has(BEDROOM_2048)).toBe(true);
    expect(pendingImages.has(POOL_2048)).toBe(true);

    await renderViewer(villa("villa-b"));
    await flushMicrotasks();
    expect(cancelledUrls).toEqual(expect.arrayContaining([BEDROOM_2048, POOL_2048]));
    expect(pendingImages.size).toBe(0);

    // Direct loadPanorama abort cancels the underlying HTMLImageElement src so no transfer lingers.
    const controller = new AbortController();
    const loading = loadPanorama(GARDEN_2048, controller.signal);
    expect(pendingImages.has(GARDEN_2048)).toBe(true);
    controller.abort();
    await expect(loading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelledUrls).toContain(GARDEN_2048);
    expect(pendingImages.has(GARDEN_2048)).toBe(false);
  });

  it("does not prefetch neighbors when the first room fails, and recovers cleanly on retry", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Fail rendition and master fallback -> loadFailed state, zero neighbors.
    await failImage(LIVING_2048);
    expect(requestedUrls).toEqual([LIVING_2048, "/pool-villa-living.webp"]);
    await failImage("/pool-villa-living.webp");
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, "/pool-villa-living.webp"]);

    // Click Retry -> succeeds -> draws -> visible + post-paint -> prefetches neighbors.
    await act(async () => {
      buttonByText("retry")!.click();
      await Promise.resolve();
    });
    expect(requestedUrls).toEqual([LIVING_2048, "/pool-villa-living.webp", LIVING_2048]);
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, "/pool-villa-living.webp", LIVING_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, "/pool-villa-living.webp", LIVING_2048, BEDROOM_2048, POOL_2048]);
  });

  it("preserves single first-image start (zero aborted starts) and deferred neighbor prefetch under React StrictMode", async () => {
    await renderViewer(villa("pool-villa"), true);
    await deliver("pool-villa", fourRoomTour());

    // StrictMode cleanup + synchronous replay keeps the single staged mobile 2048 request
    // with zero aborted starts and zero speculative neighbor requests.
    expect(requestedUrls).toEqual([LIVING_2048]);
    expect(cancelledUrls).toEqual([]);
    expect(pendingImages.get(LIVING_2048)).toHaveLength(1);

    await resolveImage(LIVING_2048);
    expect(requestedUrls).toEqual([LIVING_2048]);

    await drawScene();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    expect(cancelledUrls).toEqual([]);
  });

  it("cancels unowned speculative downloads and never drains a queued 3rd neighbor after disconnect, then recovers on confirmation", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();

    // Concurrency limit = 2: BEDROOM_2048 and POOL_2048 occupy both slots; SUITE_2048 is queued #3.
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    expect(pendingImages.has(BEDROOM_2048)).toBe(true);
    expect(pendingImages.has(POOL_2048)).toBe(true);

    // Disconnect locks input: unowned in-flight prefetches abort and queued SUITE_2048 is dropped.
    await act(async () => convex.disconnect());
    expect(cancelledUrls).toEqual(expect.arrayContaining([BEDROOM_2048, POOL_2048]));
    expect(pendingImages.size).toBe(0);
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);

    // Reconnect without fresh delivery stays paused; SUITE_2048 must not drain.
    await act(async () => convex.reconnect());
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);

    // Fresh confirmation resumes prefetching and drains queued SUITE_2048 once a slot frees.
    await deliver("pool-villa", fourRoomTour());
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048, BEDROOM_2048, POOL_2048]);
    await resolveImage(BEDROOM_2048);
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048, BEDROOM_2048, POOL_2048, SUITE_2048]);
  });

  it("drops a queued 3rd neighbor removed by a live edit before an in-flight download finishes draining", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();

    // BEDROOM_2048 and POOL_2048 occupy the 2 slots; SUITE_2048 is queued as #3 (prev sequential neighbor).
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);

    // Live edit removes pv-suite (prev neighbor becomes pv-bedroom, already in flight; no 3rd queued room).
    await deliver("pool-villa", fourRoomTour().filter((room) => room.slug !== "pv-suite"));
    expect(cancelledUrls).toEqual([]);
    expect(pendingImages.has(BEDROOM_2048)).toBe(true);
    expect(pendingImages.has(POOL_2048)).toBe(true);

    // Finishing BEDROOM_2048 must NOT drain removed SUITE_2048.
    await resolveImage(BEDROOM_2048);
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    expect(requestedUrls).not.toContain(SUITE_2048);
  });

  it("preserves a shared in-flight neighbor when explicitly navigated to while cancelling unowned sibling prefetches and queued 3rd items", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();

    // BEDROOM_2048 and POOL_2048 are in flight; SUITE_2048 is queued #3.
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);

    // Explicitly click Pool: joins existing POOL_2048 flight, aborts unowned BEDROOM_2048, drops queued SUITE_2048.
    await act(async () => {
      buttonByText("Pool")!.click();
      await Promise.resolve();
    });
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    expect(cancelledUrls).toEqual([BEDROOM_2048]);
    expect(pendingImages.has(POOL_2048)).toBe(true);
    expect(pendingImages.has(BEDROOM_2048)).toBe(false);

    // Completing shared POOL_2048 enters crossfade without draining stale Room 1 queue (SUITE_2048).
    await resolveImage(POOL_2048);
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
  });

  it("does not drain a queued 3rd neighbor when a completion microtask is already queued at unmount", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();

    // BEDROOM_2048 and POOL_2048 occupy both prefetch slots; SUITE_2048 is queued #3.
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);

    // Queue BEDROOM_2048's completion microtask and unmount synchronously before microtasks flush.
    const completedBedroom = takePending(BEDROOM_2048);
    await act(async () => {
      completedBedroom.resolveLoad();
      root.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    root = createRoot(document.body.appendChild(document.createElement("div")));

    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    expect(requestedUrls).not.toContain(SUITE_2048);
    expect(pendingImages.size).toBe(0);
  });

  it("fails closed on zero-width or zero-height canvas rects and prefetches only after layout is non-zero", async () => {
    env.canvasRect = { width: 0, height: 844 };
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();

    // Zero width -> never qualifies.
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Zero height -> still fails closed.
    env.canvasRect = { width: 390, height: 0 };
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Non-zero laid-out rect -> zero neighbors on first visible frame, then prefetches post-paint.
    env.canvasRect = { width: 390, height: 844 };
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
  });

  it("keeps the intro over a superseded texture when the scene root has not committed a source edit", async () => {
    const original = fourRoomTour();
    await renderViewer();
    await deliver("pool-villa", original);
    await resolveImage(LIVING_2048);
    env.holdScene = true;
    const edited = original.map(room => room.slug === "pv-living" ? { ...room, imagePath: "/garden-villa-360.webp" } : room);
    await deliver("pool-villa", edited);
    await drawScene();
    expect(env.canvas?.closest(".pointer-events-none")).toBeTruthy();
    expect(requestedUrls).toEqual([LIVING_2048]);

    env.holdScene = false;
    await deliver("pool-villa", [...edited]);
    await resolveImage(GARDEN_2048);
    await drawScene();
    expect(env.canvas?.closest(".pointer-events-none")).toBeNull();
  });

  it("never falls back to the master of a source the viewer replaced while the scene root still holds it", async () => {
    const original = fourRoomTour();
    await renderViewer();
    await deliver("pool-villa", original);
    expect(requestedUrls).toEqual([LIVING_2048]);
    // The DOM viewer commits an edited source; the scene root has not committed it yet.
    env.holdScene = true;
    const edited = original.map(room => room.slug === "pv-living" ? { ...room, imagePath: "/garden-villa-360.webp" } : room);
    await deliver("pool-villa", edited);
    await failImage(LIVING_2048);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    expect(requestedUrls).not.toContain("/pool-villa-living.webp");
    expect(document.querySelector('[role="alert"]')).toBeNull();

    // Once the scene commits, the edited source loads normally.
    env.holdScene = false;
    await deliver("pool-villa", [...edited]);
    expect(requestedUrls).toEqual([LIVING_2048, GARDEN_2048]);
    await resolveImage(GARDEN_2048);
    await drawScene();
    expect(env.canvas?.closest(".pointer-events-none")).toBeNull();
    expect(requestedUrls).not.toContain("/pool-villa-living.webp");
  });

  it("retries when the DOM selects the original source again before the scene commits its replacement", async () => {
    const original = fourRoomTour();
    await renderViewer();
    await deliver("pool-villa", original);
    env.holdScene = true;
    const edited = original.map(room => room.slug === "pv-living" ? { ...room, imagePath: "/garden-villa-360.webp" } : room);
    await deliver("pool-villa", edited);
    await failImage(LIVING_2048);
    expect(requestedUrls).toEqual([LIVING_2048]);
    await deliver("pool-villa", original);
    env.holdScene = false;
    await deliver("pool-villa", [...original]);
    expect(requestedUrls).toEqual([LIVING_2048, LIVING_2048]);
    await resolveImage(LIVING_2048);
    await drawScene();
    expect(env.canvas?.closest(".pointer-events-none")).toBeNull();
  });

  it("still falls back to the master of the current source when its rendition fails", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    env.holdScene = true;
    // A delivery with the same scenes keeps the committed source current.
    await deliver("pool-villa", fourRoomTour());
    await failImage(LIVING_2048);
    expect(requestedUrls).toEqual([LIVING_2048, "/pool-villa-living.webp"]);
  });

  const loseContext = () => act(async () => {
    env.canvas!.dispatchEvent(new Event("webglcontextlost"));
    await Promise.resolve();
  });
  const restoreContext = () => act(async () => {
    env.canvas!.dispatchEvent(new Event("webglcontextrestored"));
    await Promise.resolve();
  });

  it("revokes eligibility on context loss between the first and second visible frame, until the restored sphere draws", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf(); // first visible frame
    await loseContext();
    await stepRaf();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Restored but not yet drawn: still blank, still nothing speculative.
    await restoreContext();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // The requested sphere draws on the restored context; two visible frames then re-arm.
    await drawScene();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    // The intro stayed dismissed and the scene stays the same texture: no extra request for it.
    expect(env.canvas?.closest(".pointer-events-none")).toBeNull();
    expect(requestedUrls.filter((url) => url === LIVING_2048)).toHaveLength(1);
  });

  it("drains no queued neighbor while the context is lost, even after an earlier presented frame", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);

    await loseContext();
    // A finished neighbor frees a slot: the queued third must not start on a blank canvas.
    await resolveImage(BEDROOM_2048);
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).not.toContain(SUITE_2048);

    await restoreContext();
    await resolveImage(POOL_2048);
    await stepRaf();
    expect(requestedUrls).not.toContain(SUITE_2048);

    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toContain(SUITE_2048);
  });

  it("checks the committed room list before an old scene drains a queued third neighbor", async () => {
    await renderViewer();
    await deliver("pool-villa", fourRoomTour());
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, BEDROOM_2048, POOL_2048]);
    env.holdScene = true;
    await deliver("pool-villa", fourRoomTour().filter(room => room.slug !== "pv-suite"));
    await resolveImage(BEDROOM_2048);
    expect(requestedUrls).not.toContain(SUITE_2048);
  });

  it("waits for a live replacement image of the current room to draw before prefetching updated neighbors", async () => {
    await renderViewer();
    await deliver("pool-villa", [
      { slug: "pv-living", name: "Living Room", imagePath: "/pool-villa-living.webp", hotspots: [] },
    ]);
    await resolveImage(LIVING_2048);
    await drawScene();
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048]);

    // Live update replaces the current room's panorama AND adds a neighbor room.
    await deliver("pool-villa", [
      { slug: "pv-living", name: "Living Room", imagePath: "/garden-villa-360.webp", hotspots: [] },
      { slug: "pv-pool", name: "Pool", imagePath: "/pool-villa-pool.webp", hotspots: [] },
    ]);
    expect(requestedUrls).toEqual([LIVING_2048, GARDEN_2048]);

    // Replacement loads, but has not drawn yet -> neighbor stays deferred.
    await resolveImage(GARDEN_2048);
    await stepRaf();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, GARDEN_2048]);

    // Replacement draws -> usable frame -> post-paint frame -> neighbor prefetches.
    await drawScene();
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, GARDEN_2048]);
    await stepRaf();
    expect(requestedUrls).toEqual([LIVING_2048, GARDEN_2048, POOL_2048]);
  });
});
