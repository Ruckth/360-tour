import { stat } from "node:fs/promises";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { rooms } from "@/lib/data/rooms";
import { choosePanoramaWidth, panoramaRendition } from "@/lib/tour/panoramas";

describe("tour panorama renditions", () => {
  it("selects a small first view and accounts for the canvas pixel ratio and GPU limit", () => {
    expect(choosePanoramaWidth(390, 1.5, 8192)).toBe(2048);
    expect(choosePanoramaWidth(768, 1.5, 8192)).toBe(4096);
    expect(choosePanoramaWidth(1440, 1, 2048)).toBe(2048);
  });

  it.each([
    "https://resort.convex.cloud/api/storage/uploaded",
    "https://images.unsplash.com/pool-villa-living.webp",
    "/custom/pool-villa-living.webp",
    "/pool-villa-living.webp?revision=2",
    "/constructor",
  ])("uses the exact configured URL for %s", (path) => {
    expect(panoramaRendition(path, 2048)).toEqual({ path, originalWidth: null });
  });

  it.each(rooms)("ships smaller, unstretched renditions for $imagePath", async ({ imagePath }) => {
    const original = `public${imagePath}`;
    const { width, height } = await sharp(original).metadata();
    expect(width).toBe(height * 2);
    const originalBytes = (await stat(original)).size;
    for (const targetWidth of [2048, 4096] as const) {
      const rendition = panoramaRendition(imagePath, targetWidth);
      if (width <= targetWidth) {
        expect(rendition.path).toBe(imagePath);
      } else {
        expect(rendition.originalWidth).toBe(width);
        const file = `public${rendition.path}`;
        expect(await sharp(file).metadata()).toMatchObject({
          width: targetWidth,
          height: targetWidth / 2,
          format: "webp",
        });
        expect((await stat(file)).size).toBeLessThan(originalBytes);
      }
    }
  });
});
