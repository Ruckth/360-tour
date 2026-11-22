import { expect, test } from "@playwright/test";

test("a cached panorama keeps the bottom image row first for WebGL upload", async ({ page }) => {
  await page.route("**/panorama-pixel-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Panorama pixels</title>" }),
  );
  await page.goto("/panorama-pixel-fixture");
  const rows = await page.evaluate(async (moduleUrl) => {
    const { browserCaptureDeps } = await import(moduleUrl) as typeof import("@/lib/tour/first-panorama-cache");
    const source = document.createElement("canvas");
    source.width = 4;
    source.height = 2;
    const context = source.getContext("2d")!;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 4, 1);
    context.fillStyle = "#0000ff";
    context.fillRect(0, 1, 4, 1);
    const image = new Image();
    image.src = source.toDataURL();
    await image.decode();
    const bitmap = await browserCaptureDeps.bitmap(image);
    try {
      const pixels = browserCaptureDeps.pixels(bitmap);
      if (!pixels) throw new Error("Missing captured panorama pixels");
      return [Array.from(pixels.slice(0, 4)), Array.from(pixels.slice(16, 20))];
    } finally {
      bitmap.close();
    }
  }, "/src/lib/tour/first-panorama-cache.ts");
  expect(rows).toEqual([[0, 0, 255, 255], [255, 0, 0, 255]]);
});
