import type { Locator, Page } from "@playwright/test";
import { visibleSentences } from "../helpers/sentence-count";
import { FINAL_RESULTS, FINAL_SCREENS, Recorder, type ViewportName } from "./measure";

/*
 * Shared pieces for the final re-run of the click audit on ux/integration (final-audit.md).
 * The counters are measure.ts from the original audit (the same rules as helpers/screen-census.ts);
 * sentences come from helpers/sentence-count.ts, the counter the package specs assert with.
 */

export const OUT = { screens: FINAL_SCREENS, results: FINAL_RESULTS };
export const STAFF = "/tests/browser/staff-roles.html";
export const CHECKOUT = "/tests/browser/checkout.html";
export const DESK = "/tests/browser/booking-desk.html";
export const SHELL = "/tests/browser/admin-shell.html";
export const COUPON = "/tests/browser/marketing-coupon.html";
/** Thursday 12 Nov 2026, 10:00 at the resort: the desk fixture's "today" (helpers/desk-taps.ts). */
export const DESK_NOW = new Date("2026-11-12T10:00:00+07:00");

/**
 * Explanatory sentences shown in `scope` (or the page). The receipt paper is printed output, not
 * explanation, so it is left out the same way on code that predates data-sentence-budget.
 */
export async function sentences(page: Page, scope?: string): Promise<string[]> {
  await page.evaluate(() => document.querySelectorAll(".pos-receipt").forEach((el) => el.setAttribute("data-sentence-budget", "ignore")));
  const root = page.locator(scope ?? "body").first();
  if ((await root.count()) === 0) return [];
  return root.evaluate(visibleSentences);
}

export const recorder = (page: Page, task: string, vp: ViewportName) => new Recorder(page, task, vp, OUT, sentences);

/** Print opens the OS dialog; count the call instead. */
export async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => { (window as unknown as { printed: number }).printed += 1; };
  });
}

export async function open(page: Page, url: string, opts: { clock?: boolean } = {}) {
  await stubPrint(page);
  if (opts.clock) await page.clock.setFixedTime(DESK_NOW);
  await page.goto(url);
  await page.locator("[data-fixture-ready], header h1, [role=dialog]").first().waitFor();
  await page.waitForTimeout(400);
}

/** index.html renders dark by default; the audit's screens are light unless named dark. */
export async function light(page: Page) {
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await page.waitForTimeout(100);
}

/** Whether the element is the topmost thing where a finger lands on it. */
export function uncovered(target: Locator) {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(top && (el === top || el.contains(top)));
  });
}
