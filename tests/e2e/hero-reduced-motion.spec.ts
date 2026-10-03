import { expect, test, type Page } from "@playwright/test";
import { bypassDemoDisclaimer } from "./demo-disclaimer";

/**
 * Reduced motion on the home hero: a still first poster — no video source / mp4 request, no
 * Ken Burns zoom, no step cycle, no cross-fade transitions — including when the preference changes
 * while the page is open. Page timers are driven by Playwright's clock so the >7s observation
 * window (the hero's longest cycle delay is 7s) does not slow the suite down.
 */

function trackVideoRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes(".mp4")) urls.push(request.url());
  });
  return urls;
}

async function expectStillPoster(page: Page) {
  const hero = page.getByTestId("home-hero");
  await expect(hero).toHaveAttribute("data-hero-motion", "reduced");
  await expect(hero).toHaveAttribute("data-hero-step", "0");
  await expect(hero.locator("video source")).toHaveCount(0);
  await expect(hero.locator(".hero-ken-burns")).toHaveCount(0);
  const motion = await hero.evaluate((node) => {
    const layers = [...node.querySelectorAll<HTMLElement>(".transition-opacity")];
    const card = node.querySelector<HTMLElement>(".hero-card-reveal");
    return {
      transitions: layers.map((layer) => getComputedStyle(layer).transitionProperty),
      cardAnimation: card ? getComputedStyle(card).animationName : "missing",
      videosPlaying: [...node.querySelectorAll("video")].some((video) => !video.paused),
    };
  });
  expect(motion.transitions.length).toBeGreaterThan(0);
  for (const property of motion.transitions) expect(property).toBe("none");
  expect(motion.cardAnimation).toBe("none");
  expect(motion.videosPlaying).toBe(false);
}

test.beforeEach(async ({ page }) => {
  await bypassDemoDisclaimer(page);
});

test("reduced motion from the start: still first poster and no video for over 7s", async ({ page }) => {
  const videoRequests = trackVideoRequests(page);
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expectStillPoster(page);

  // Past the 900ms video enable, the 6s/7s cycle timers, and then some.
  await page.clock.runFor(7_500);
  await expectStillPoster(page);
  await page.clock.runFor(7_500);
  await expectStillPoster(page);
  expect(videoRequests).toEqual([]);
});

test("switching to reduced motion while open stops video and the cycle; switching back resumes", async ({
  page,
}) => {
  const videoRequests = trackVideoRequests(page);
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const hero = page.getByTestId("home-hero");
  await expect(hero).toHaveAttribute("data-hero-motion", "full");

  // Full motion: after the 900ms delay the first clip gets its real source.
  await page.clock.runFor(1_000);
  await expect(hero.locator("video source")).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expectStillPoster(page);
  const requestsAtSwitch = videoRequests.length;
  await page.clock.runFor(7_500);
  await expectStillPoster(page);
  await page.clock.runFor(7_500);
  await expectStillPoster(page);
  expect(videoRequests.length).toBe(requestsAtSwitch);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(hero).toHaveAttribute("data-hero-motion", "full");
  await expect(hero.locator("video source")).toHaveCount(1);
});
