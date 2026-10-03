import { writeFileSync } from "node:fs";
import { test, type Browser } from "@playwright/test";

/**
 * Home page JavaScript before interaction, and first chat open latency. Desktop viewport,
 * CPU 4x and ~1.6 Mbps / 150 ms RTT throttling, cold HTTP cache per run.
 *
 * - idleScriptBytes: encodedBodySize of every script resource fetched within 6 s of `load`
 *   without interaction (the old shell mounted the chat widget on idle; the new one waits).
 * - clickToChatPanelMs: click on "Open concierge chat" -> chat panel visible (includes loading
 *   the widget chunk when it was not loaded yet).
 */
const RUNS = Number(process.env.BENCH_RUNS ?? 5);

async function newPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => sessionStorage.setItem("seaview-demo-disclaimer-dismissed", "true"));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return { context, page };
}

test("home idle JS and first chat open", async ({ browser }) => {
  test.setTimeout(RUNS * 120_000);
  const samples: Array<{ idleScriptBytes: number; idleScriptRequests: number; clickToChatPanelMs: number }> = [];
  for (let run = 0; run < RUNS; run++) {
    const { context, page } = await newPage(browser);
    await page.goto("/", { waitUntil: "load" });
    await page.waitForTimeout(6_000);
    const idle = await page.evaluate(() => {
      const scripts = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
        (entry) => entry.initiatorType === "script" || entry.name.endsWith(".js"),
      );
      return { bytes: scripts.reduce((sum, entry) => sum + entry.encodedBodySize, 0), requests: scripts.length };
    });
    const clickToChatPanelMs = await page.evaluate(async () => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === "Open concierge chat" && node.offsetParent !== null,
      );
      if (!button) throw new Error("launcher not found");
      const start = performance.now();
      button.click();
      return await new Promise<number>((resolve, reject) => {
        const check = () => {
          const panel = document.querySelector<HTMLElement>('[data-testid="chat-panel"]');
          if (panel && getComputedStyle(panel).opacity === "1") return resolve(performance.now() - start);
          if (performance.now() - start > 60_000) return reject(new Error("chat never opened"));
          requestAnimationFrame(check);
        };
        check();
      });
    });
    samples.push({ idleScriptBytes: idle.bytes, idleScriptRequests: idle.requests, clickToChatPanelMs });
    await context.close();
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const output = {
    baseURL: test.info().project.use.baseURL,
    profile: "1280x800 desktop, CPU 4x, 1.6 Mbps/150 ms RTT, cold cache, headless Chromium",
    measuredAt: new Date().toISOString(),
    median: {
      idleScriptBytes: median(samples.map((s) => s.idleScriptBytes)),
      idleScriptRequests: median(samples.map((s) => s.idleScriptRequests)),
      clickToChatPanelMs: Math.round(median(samples.map((s) => s.clickToChatPanelMs))),
    },
    samples,
  };
  console.log(JSON.stringify(output.median));
  if (process.env.BENCH_OUT) writeFileSync(process.env.BENCH_OUT, `${JSON.stringify(output, null, 2)}\n`);
});
