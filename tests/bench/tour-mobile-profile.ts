import type { Browser, BrowserContext, Page } from "@playwright/test";

export const PANORAMA =
  /\/(pool-villa-living|pool-villa-pool|garden-suite-interior|garden-dining360|garden-villa-360|penthouse-bedroom)(?:-(2048|4096))?\.(webp|jpe?g)(?:$|\?)/;

/** Single shared mobile emulation profile (decimal 1.6 Mbps down, 750 kbps up, 150 ms RTT, 4x CPU). */
export const MOBILE_PROFILE = {
  width: 390,
  height: 844,
  dpr: 2,
  cpuFactor: 4,
  rttMs: 150,
  downMbps: 1.6,
  upKbps: 750,
  downloadThroughput: 1_600_000 / 8,
  uploadThroughput: 750_000 / 8,
} as const;

async function throttle(context: BrowserContext, page: Page, disableCache: boolean) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: disableCache });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: MOBILE_PROFILE.rttMs,
    downloadThroughput: MOBILE_PROFILE.downloadThroughput,
    uploadThroughput: MOBILE_PROFILE.uploadThroughput,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: MOBILE_PROFILE.cpuFactor });
  return cdp;
}

/**
 * Probes the active WebGL renderer in a clean blank context (zero app requests) and verifies
 * Chromium is running on SwiftShader software WebGL.
 */
export async function verifySoftwareWebGLRenderer(browser: Browser): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const renderer = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (!gl) return null;
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      const value = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return typeof value === "string" ? value : null;
    });
    if (!renderer) throw new Error("WebGL context unavailable; cannot verify software WebGL renderer");
    if (!/swiftshader/i.test(renderer)) {
      throw new Error(`Expected fixed SwiftShader software WebGL renderer, got: ${renderer}`);
    }
    return renderer;
  } finally {
    await context.close();
  }
}

export async function newMobilePage(browser: Browser, disableCache: boolean, init?: () => void) {
  const context = await browser.newContext({
    viewport: { width: MOBILE_PROFILE.width, height: MOBILE_PROFILE.height },
    deviceScaleFactor: MOBILE_PROFILE.dpr,
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
