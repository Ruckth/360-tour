// The original paths are also stored in Convex. Match the exact path so edited and uploaded
// rooms use their own images, even if they reuse a bundled room name or slug.
const bundledPanoramaWidths = new Map([
  ["/pool-villa-living.webp", 8192],
  ["/pool-villa-pool.webp", 8192],
  ["/garden-suite-interior.webp", 8192],
  ["/garden-dining360.webp", 4096],
  ["/garden-villa-360.webp", 7096],
  ["/penthouse-bedroom.webp", 4096],
]);

export type PanoramaWidth = 2048 | 4096;

export function choosePanoramaWidth(width: number, dpr: number, maxTextureSize: number): PanoramaWidth {
  // Small canvases use the measured 2K first view. Account for the renderer's pixel ratio
  // so a dense tablet or desktop gets the higher rendition when the GPU can accept it.
  return width * dpr >= 1024 && maxTextureSize >= 4096 ? 4096 : 2048;
}

export function panoramaRendition(original: string, width: PanoramaWidth) {
  const originalWidth = bundledPanoramaWidths.get(original);
  if (originalWidth === undefined || originalWidth <= width) {
    return { path: original, originalWidth: null };
  }
  return {
    // Assets are cached as immutable. Publish changes in a new directory.
    path: `/tour/panoramas/v1/${original.slice(1, -".webp".length)}-${width}.webp`,
    originalWidth,
  };
}

const bundledMobileRenditions = new Set(
  Array.from(bundledPanoramaWidths.keys(), original => panoramaRendition(original, 2048).path),
);

export function isBundledMobileRendition(path: string) {
  return bundledMobileRenditions.has(path);
}

export const TOUR_CANVAS_DPR: [number, number] = [1, 1.5];

/** The fixed, full-screen canvas cannot exceed this viewport width or its DPR cap. */
export function earlyMobilePanoramaPath(original: string, viewportWidth: number): string | undefined {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || choosePanoramaWidth(viewportWidth, TOUR_CANVAS_DPR[1], 4096) !== 2048) return;
  const { path } = panoramaRendition(original, 2048);
  return path === original ? undefined : path;
}
