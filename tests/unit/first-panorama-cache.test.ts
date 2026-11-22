// @vitest-environment happy-dom
import { LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, Texture, UnsignedByteType, type DataTexture } from "three";
import { isBundledMobileRendition } from "@/lib/tour/panoramas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserCaptureDeps,
  clearFirstPanoramaCache,
  firstPanoramaLoader,
  heldFirstPanorama,
  type CaptureDeps,
} from "@/lib/tour/first-panorama-cache";

const FIRST = "/tour/panoramas/v1/pool-villa-living-2048.webp";
const OTHER = "/tour/panoramas/v1/pool-villa-pool-2048.webp";

function image(width = 2048, height = 1024) {
  const element = new Image();
  Object.defineProperty(element, "naturalWidth", { value: width });
  Object.defineProperty(element, "naturalHeight", { value: height });
  return element;
}

/** The ordinary loader: an image texture, as loadPanorama resolves it. */
function ordinary(width?: number, height?: number) {
  return vi.fn<(path: string, signal: AbortSignal) => Promise<Texture>>(async () => {
    const texture = new Texture(image(width, height));
    texture.colorSpace = SRGBColorSpace;
    return texture;
  });
}

function deps(overrides: Partial<CaptureDeps> = {}) {
  const closed = vi.fn();
  const value: CaptureDeps = {
    idle: vi.fn(async () => {}),
    bitmap: vi.fn(async (source: HTMLImageElement) =>
      ({ width: source.naturalWidth, height: source.naturalHeight, close: closed }) as unknown as ImageBitmap),
    pixels: vi.fn((bitmap: ImageBitmap) => new Uint8Array(bitmap.width * bitmap.height * 4).fill(7)),
    ...overrides,
  };
  return { ...value, closed };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const signal = () => new AbortController().signal;

async function firstOpen(load = ordinary(), capture = deps()) {
  const loader = firstPanoramaLoader(load, capture);
  const close = loader.open();
  const texture = await loader.load(FIRST, signal());
  await settle();
  return { loader, close, texture, load, capture };
}

describe("first panorama CPU cache", () => {
  beforeEach(() => clearFirstPanoramaCache());
  afterEach(() => clearFirstPanoramaCache());

  it("is limited to bundled immutable 2048 renditions", () => {
    expect(isBundledMobileRendition(FIRST)).toBe(true);
    for (const path of [
      "/pool-villa-living.webp",
      "/tour/panoramas/v1/not-bundled-2048.webp",
      "/tour/panoramas/v1/pool-villa-living-4096.webp",
      "/tour/panoramas/v2/pool-villa-living-2048.webp",
      "https://example.convex.cloud/api/storage/upload-2048.webp",
      "/tour/panoramas/v1/../secret-2048.webp",
    ]) expect(isBundledMobileRendition(path)).toBe(false);
  });

  it("loads a first open normally, then copies the decoded image at idle time without fetching again", async () => {
    const { texture, load, capture, close } = await firstOpen();
    expect(load).toHaveBeenCalledTimes(1);
    expect(texture).toBeInstanceOf(Texture);
    expect(capture.idle).toHaveBeenCalledTimes(2);
    expect(capture.bitmap).toHaveBeenCalledTimes(1);
    expect(capture.closed).toHaveBeenCalledTimes(1);
    expect(heldFirstPanorama()).toMatchObject({ path: FIRST, width: 2048, height: 1024 });
    expect(heldFirstPanorama()!.data.byteLength).toBe(2048 * 1024 * 4);
    close();
  });

  it("serves a reopen from the CPU copy, with the image texture's colour, filtering, mipmaps and row order", async () => {
    const first = await firstOpen();
    first.close();
    const load = ordinary();
    const reopened = firstPanoramaLoader(load, deps());
    reopened.open();
    const texture = (await reopened.load(FIRST, signal())) as DataTexture;
    expect(load).not.toHaveBeenCalled();
    expect(texture.isDataTexture).toBe(true);
    expect(texture.image).toMatchObject({ width: 2048, height: 1024 });
    expect(texture.image.data).toBe(heldFirstPanorama()!.data);
    expect(texture.format).toBe(RGBAFormat);
    expect(texture.type).toBe(UnsignedByteType);
    expect(texture.colorSpace).toBe(SRGBColorSpace);
    const image = new Texture();
    expect([texture.minFilter, texture.magFilter, texture.generateMipmaps]).toEqual([image.minFilter, image.magFilter, image.generateMipmaps]);
    expect([texture.minFilter, texture.magFilter]).toEqual([LinearMipmapLinearFilter, LinearFilter]);
    expect([texture.wrapS, texture.wrapT, texture.anisotropy]).toEqual([image.wrapS, image.wrapT, image.anisotropy]);
    // Captured bottom-up by the 2D canvas, so the data is not flipped again on upload.
    expect(texture.flipY).toBe(false);
  });

  it("uses the copy only for the first load of an open: neighbours and later loads stay ordinary", async () => {
    (await firstOpen()).close();
    const load = ordinary();
    const reopened = firstPanoramaLoader(load, deps());
    reopened.open();
    await reopened.load("/tour/panoramas/v1/pool-villa-pool-2048.webp", signal());
    await reopened.load(FIRST, signal());
    expect(load.mock.calls.map(([path]) => path)).toEqual([OTHER, FIRST]);
  });

  it("does not cache a first open that is not a bundled 2048 rendition", async () => {
    const capture = deps();
    const loader = firstPanoramaLoader(ordinary(), capture);
    loader.open();
    await loader.load("/tour/panoramas/v1/pool-villa-living-4096.webp", signal());
    await settle();
    expect(capture.idle).not.toHaveBeenCalled();
    expect(heldFirstPanorama()).toBeUndefined();
  });

  it("aborts a capture still waiting for idle time when the tour closes, holding nothing afterwards", async () => {
    let release!: () => void;
    const capture = deps({ idle: vi.fn((abort: AbortSignal) => new Promise<void>((resolve) => {
      release = resolve;
      abort.addEventListener("abort", () => resolve(), { once: true });
    })) });
    const loader = firstPanoramaLoader(ordinary(), capture);
    const close = loader.open();
    await loader.load(FIRST, signal());
    await settle();
    close();
    await settle();
    release();
    await settle();
    expect(capture.bitmap).not.toHaveBeenCalled();
    expect(heldFirstPanorama()).toBeUndefined();
  });

  it("captures nothing when the load resolves after the tour closed", async () => {
    const capture = deps();
    const loader = firstPanoramaLoader(ordinary(), capture);
    const close = loader.open();
    const pending = loader.load(FIRST, signal());
    close();
    await pending;
    await settle();
    expect(capture.idle).not.toHaveBeenCalled();
    expect(heldFirstPanorama()).toBeUndefined();
  });

  it("bounds the copy to one 2048 × 1024 entry and replaces a superseded one", async () => {
    const big = firstPanoramaLoader(ordinary(4096, 2048), deps());
    big.open();
    await big.load(FIRST, signal());
    await settle();
    expect(heldFirstPanorama()).toBeUndefined();

    (await firstOpen()).close();
    const previous = heldFirstPanorama()!.data;
    const next = firstPanoramaLoader(ordinary(), deps());
    next.open();
    await next.load(OTHER, signal());
    await settle();
    expect(heldFirstPanorama()?.path).toBe(OTHER);
    expect(heldFirstPanorama()!.data === previous).toBe(false);
  });

  it("keeps the ordinary result when decoding or copying is unsupported", async () => {
    const failing = deps({ bitmap: vi.fn(async () => { throw new Error("unsupported"); }) });
    const { texture } = await firstOpen(ordinary(), failing);
    expect(texture).toBeInstanceOf(Texture);
    expect(heldFirstPanorama()).toBeUndefined();
    const empty = deps({ pixels: vi.fn(() => undefined) });
    await firstOpen(ordinary(), empty);
    expect(heldFirstPanorama()).toBeUndefined();
    expect(empty.closed).toHaveBeenCalledTimes(1);
  });

  it("rejects an already aborted request on a cache hit", async () => {
    (await firstOpen()).close();
    const reopened = firstPanoramaLoader(ordinary(), deps());
    reopened.open();
    const controller = new AbortController();
    controller.abort();
    await expect(reopened.load(FIRST, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("schedules no idle work once aborted", async () => {
    const schedule = vi.fn(() => 1);
    vi.stubGlobal("requestIdleCallback", schedule);
    const controller = new AbortController();
    controller.abort();
    await browserCaptureDeps.idle(controller.signal);
    expect(schedule).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
