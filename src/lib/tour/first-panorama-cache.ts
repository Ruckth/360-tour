// Keeps one CPU copy of the first bundled 2048 panorama across a close and reopen in the same page.
//
// Scope: only the first load of an open, and only an immutable bundled rendition
// (`/tour/panoramas/v1/<name>-2048.webp`; edited and uploaded rooms never map there). Neighbours, details,
// uploads and other widths take the ordinary loader.
//
// First open: the ordinary loader runs unchanged. Afterwards, at idle time, the image it already decoded is
// copied into one RGBA buffer in WebGL row order. Nothing is fetched again.
// Reopen: the loader is called only after the live room list confirmed this path, exactly like a fetch. It
// returns a DataTexture over that buffer, with the image texture's sRGB space, filters and mipmaps, so the
// upload skips the image decode.
//
// Bounds: one entry of at most 8 MiB; capturing another path drops the previous one. A close aborts a
// pending capture and holds no image, bitmap, canvas or callback afterwards.

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Texture } from "three";
import { isBundledMobileRendition } from "@/lib/tour/panoramas";
import { markTourBench } from "@/lib/tour/bench";
import type { TextureLoaderFn } from "@/lib/tour/texture-cache";

export type DecodedPanorama = { path: string; width: number; height: number; data: Uint8Array };

let entry: DecodedPanorama | undefined;

/** For tests and memory pressure: drop the held copy. */
export function clearFirstPanoramaCache() {
  entry = undefined;
}

export function heldFirstPanorama(): Readonly<DecodedPanorama> | undefined {
  return entry;
}

/** A texture equivalent to the image texture `loadPanorama` creates, over CPU pixels in WebGL row order. */
export function panoramaDataTexture({ data, width, height }: DecodedPanorama) {
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
  // Image textures default to trilinear mipmaps; DataTexture defaults to nearest without mipmaps.
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  // The capture canvas writes bottom-up rows, as `flipY: true` uploads an image.
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

export type CaptureDeps = {
  /** Decodes the bundled image where bitmap decoding is supported. */
  bitmap: (image: HTMLImageElement) => Promise<ImageBitmap>;
  /** Copies a bitmap's pixels; returns undefined when unsupported. */
  pixels: (bitmap: ImageBitmap) => Uint8Array | undefined;
  /** Waits for idle time; resolves at once when aborted, so nothing stays scheduled after a close. */
  idle: (signal: AbortSignal) => Promise<void>;
};

export const browserCaptureDeps: CaptureDeps = {
  bitmap: (image) => createImageBitmap(image),
  pixels(bitmap) {
    if (typeof OffscreenCanvas === "undefined") return undefined;
    const context = new OffscreenCanvas(bitmap.width, bitmap.height)
      .getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) return undefined;
    // The canvas transform also works on browsers that ignore ImageBitmap orientation options.
    context.setTransform(1, 0, 0, -1, 0, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: "srgb" });
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  },
  idle: (signal) =>
    new Promise<void>((resolve) => {
      if (signal.aborted) return resolve();
      const done = () => {
        signal.removeEventListener("abort", stop);
        resolve();
      };
      const usesIdleCallback = typeof window.requestIdleCallback === "function";
      const handle = usesIdleCallback
        ? window.requestIdleCallback(done)
        : window.setTimeout(done, 50);
      function stop() {
        if (usesIdleCallback) window.cancelIdleCallback(handle);
        else window.clearTimeout(handle);
        resolve();
      }
      signal.addEventListener("abort", stop, { once: true });
    }),
};

/** Copies a loaded first panorama for later reopens. Fails quietly: the cache is only an optimisation. */
export async function captureFirstPanorama(path: string, image: unknown, signal: AbortSignal, deps = browserCaptureDeps) {
  if (!(typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement)) return;
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height || width > 2048 || height > 1024) return;
  let bitmap: ImageBitmap | undefined;
  try {
    await deps.idle(signal);
    if (signal.aborted) return;
    bitmap = await deps.bitmap(image);
    if (signal.aborted || bitmap.width !== width || bitmap.height !== height) return;
    await deps.idle(signal);
    if (signal.aborted) return;
    const data = deps.pixels(bitmap);
    if (!data || data.byteLength !== width * height * 4) return;
    entry = { path, width, height, data };
    markTourBench("first_panorama_captured");
  } catch {
    // An unsupported decode or a tainted image keeps the ordinary path.
  } finally {
    bitmap?.close();
  }
}

/**
 * The first-texture loader for one open tour. `open()` (on mount) returns the close (on unmount), which
 * aborts a capture still waiting for idle time.
 */
export function firstPanoramaLoader(load: TextureLoaderFn<Texture>, deps = browserCaptureDeps) {
  let first = true;
  let controller: AbortController | undefined;
  return {
    open() {
      const opened = new AbortController();
      controller = opened;
      return () => {
        opened.abort();
        if (controller === opened) controller = undefined;
      };
    },
    load(path: string, signal: AbortSignal): Promise<Texture> {
      const isFirst = first;
      first = false;
      if (!isFirst || !isBundledMobileRendition(path)) return load(path, signal);
      if (signal.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
      if (entry?.path === path) {
        markTourBench("first_panorama_cache_hit");
        return Promise.resolve(panoramaDataTexture(entry));
      }
      return load(path, signal).then((texture) => {
        const open = controller;
        if (open && !open.signal.aborted) void captureFirstPanorama(path, texture.image, open.signal, deps);
        return texture;
      });
    },
  };
}
