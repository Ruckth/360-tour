import sharp from "sharp";
import { expect, test } from "./fixtures";

const trialRoom = "/rooms/pool-villa?tourRenderer=pannellum";
const alternateViewer = /\/assets\/PannellumTourViewer-[^/]+\.js$/;
const standardCanvas = /\/assets\/TourCanvas-[^/]+\.js$/;

test.skip(process.env.START_PANNELLUM_TRIAL !== "1", "Requires the isolated renderer trial");
test.use({
  launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

test("direct trial and reopen use the lightweight viewer without requesting Three.js", async ({ page }) => {
  const scripts: string[] = [];
  let stage = "direct";
  const heavyRequests: { stage: string; initiator: string[] }[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (event) => {
    if (!standardCanvas.test(new URL(event.request.url).pathname)) return;
    heavyRequests.push({ stage, initiator: event.initiator.stack?.callFrames.map((frame) => new URL(frame.url, page.url()).pathname) ?? [] });
  });
  page.on("request", (request) => {
    if (request.resourceType() === "script") scripts.push(new URL(request.url()).pathname);
  });
  const response = await page.goto(trialRoom + "&tour=1");
  expect(response?.ok()).toBe(true);
  const html = await response!.text();
  expect(html).toMatch(/rel="modulepreload"[^>]*PannellumTourViewer-/);

  const viewer = page.getByTestId("tour-viewer");
  await expect(viewer).toHaveAttribute("data-tour-renderer", "pannellum");
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
  await expect(viewer).toHaveAttribute("aria-busy", "false");
  stage = "switch scene";
  await viewer.getByRole("button", { name: "Pool Area", exact: true }).last().click();
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-pool");
  await expect(viewer).toHaveAttribute("aria-busy", "false");
  await expect(viewer).toHaveAttribute("data-tour-renderer", "pannellum");

  stage = "recover WebGL";
  const canvas = viewer.getByTestId("tour-pannellum").locator("canvas");
  const beforeReset = await canvas.elementHandle();
  if (!beforeReset) throw new Error("The trial did not mount a canvas");
  await beforeReset.evaluate((element) => {
    if (!(element instanceof HTMLCanvasElement)) throw new Error("Expected a panorama canvas");
    const gl = element.getContext("webgl") ?? element.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Software WebGL did not expose context recovery");
    extension.loseContext();
    window.setTimeout(() => extension.restoreContext(), 250);
  });
  await expect.poll(() => beforeReset.evaluate((element) => element.isConnected)).toBe(false);
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-pool");
  await expect(viewer).toHaveAttribute("aria-busy", "false");
  const region = page.viewportSize()!;
  const pixel = await page.screenshot({ clip: { x: region.width / 2 - 40, y: region.height / 2 - 30, width: 80, height: 60 } });
  const stats = await sharp(pixel).removeAlpha().stats();
  expect(stats.channels.slice(0, 3).reduce((total, channel) => total + channel.mean, 0) / 3).toBeGreaterThan(15);
  await expect(viewer).toHaveAttribute("data-tour-renderer", "pannellum");

  stage = "close";
  await viewer.getByRole("button", { name: "Close tour", exact: true }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("tour") && url.searchParams.get("tourRenderer") === "pannellum");
  stage = "reopen";
  await page.getByRole("button", { name: /Explore (in )?360/i }).first().click();
  await expect(viewer).toHaveAttribute("data-tour-renderer", "pannellum");
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
  await expect(viewer).toHaveAttribute("aria-busy", "false");
  expect(scripts.some((path) => alternateViewer.test(path))).toBe(true);
  expect(heavyRequests).toEqual([]);
  expect(scripts.some((path) => standardCanvas.test(path))).toBe(false);
});

test("a failed trial import opens the standard viewer", async ({ page }) => {
  await page.route(alternateViewer, (route) => route.abort("failed"));
  await page.goto(trialRoom + "&tour=1");
  const viewer = page.getByTestId("tour-viewer");
  await expect(viewer).toHaveAttribute("data-tour-renderer", "three");
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
  await expect(viewer).toHaveAttribute("aria-busy", "false");
});
