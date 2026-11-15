import { expect, type Locator, type Page } from "@playwright/test";

/** iPad landscape and phone, as in the click audit (docs/reviews/ux-audit/click-audit.md). */
export const DESK_VIEWPORTS = { ipad: { width: 1180, height: 820 }, phone: { width: 390, height: 844 } } as const;
/** Thursday 12 Nov 2026, 10:00 at the resort: the desk fixture's "today". */
export const DESK_NOW = new Date("2026-11-12T10:00:00+07:00");

export async function openDesk(page: Page, query = "") {
  await page.clock.setFixedTime(DESK_NOW);
  await page.goto(`/tests/browser/booking-desk.html${query}`);
  await page.locator("[data-fixture-ready]").waitFor();
}

/**
 * Counts what a person does on the way through a task: taps, typed fields, and taps whose target
 * was off screen first (a scroll they would have to make).
 */
export class Taps {
  taps = 0;
  typed = 0;
  scrolls = 0;
  readonly log: string[] = [];
  constructor(private page: Page) {}

  private async offScreen(target: Locator) {
    return target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom > window.innerHeight + 1 || r.top < -1 || r.right > window.innerWidth + 1 || r.left < -1) return true;
      for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
        if (!/(auto|scroll)/.test(getComputedStyle(node).overflowY)) continue;
        const p = node.getBoundingClientRect();
        if (r.bottom > p.bottom + 1 || r.top < p.top - 1) return true;
      }
      return false;
    });
  }

  async tap(target: Locator, label: string) {
    await expect(target).toBeVisible();
    if (await this.offScreen(target)) {
      this.scrolls += 1;
      this.log.push(`scroll to ${label}`);
      await target.scrollIntoViewIfNeeded();
    }
    await target.click();
    this.taps += 1;
    this.log.push(`tap ${label}`);
  }

  async type(target: Locator, text: string, label: string) {
    await expect(target).toBeVisible();
    await target.fill(text);
    this.typed += 1;
    this.log.push(`type ${label}`);
  }

  summary() {
    return { taps: this.taps, typed: this.typed, scrolls: this.scrolls, log: this.log };
  }
}
