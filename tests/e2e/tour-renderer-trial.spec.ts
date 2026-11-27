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
  await viewer.getByRole("button", { name: "Pool Area", exact: true }).last().click();
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-pool");
  await expect(viewer).toHaveAttribute("aria-busy", "false");
  await viewer.getByRole("button", { name: "Close tour", exact: true }).click();
  await expect(page).toHaveURL((url) => !url.searchParams.has("tour") && url.searchParams.get("tourRenderer") === "pannellum");
  await page.getByRole("button", { name: /Explore (in )?360/i }).first().click();
  await expect(viewer).toHaveAttribute("data-tour-renderer", "pannellum");
  await expect(viewer).toHaveAttribute("data-shown-room", "pv-living");
  await expect(viewer).toHaveAttribute("aria-busy", "false");
  expect(scripts.some((path) => alternateViewer.test(path))).toBe(true);
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
