import type { Browser, BrowserContext, Page } from "@playwright/test";

export const PANORAMA =
  /\/(pool-villa-living|pool-villa-pool|garden-suite-interior|garden-dining360|garden-villa-360|penthouse-bedroom)(?:-(2048|4096))?\.(webp|jpe?g)(?:$|\?)/;

async function throttle(context: BrowserContext, page: Page, disableCache: boolean) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: disableCache });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

export async function newMobilePage(browser: Browser, disableCache: boolean, init?: () => void) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(() => sessionStorage.setItem("seaview-demo-disclaimer-dismissed", "true"));
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on("requestfailed", (request) => {
    if (PANORAMA.test(request.url()))
      console.error("panorama-request-failed", new URL(request.url()).pathname, request.failure()?.errorText);
  });
  page.on("response", (response) => {
    if (PANORAMA.test(response.url()) && response.status() >= 400)
      console.error("panorama-http-error", new URL(response.url()).pathname, response.status());
  });
  const cdp = await throttle(context, page, disableCache);
  return { context, page, cdp };
}
