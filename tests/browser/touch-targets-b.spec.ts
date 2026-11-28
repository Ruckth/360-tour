import { expect, test, type Page } from "@playwright/test";
import { openDesk } from "./helpers/desk-taps";

// Exceptions: compact month bars belong to a >=44px, keyboard-operable day cell.
// Inline links within prose may use their text line. There are none in these scenes.
// Checkboxes may use their associated label; InfoTip uses its verified ::after area.
// Screen-reader-only focus/dismiss sentinels have no visible hit box and are excluded.
// No blanket exemptions for icon buttons, disabled fields, or calendar controls.
test.use({ hasTouch: true, isMobile: true, timezoneId: "Asia/Bangkok" });
async function targets(page: Page) {
  const failures = await page.evaluate(() => {
    const selector = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=combobox], [role=gridcell]';
    const result: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      if (!el.checkVisibility() || el.closest('[aria-hidden="true"], [inert]')) continue;
      const style = getComputedStyle(el);
      if (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)") continue;
      const box = el.getBoundingClientRect();
      // Only rendered controls in the visible scroll window; other controls are
      // checked after scrolling each panel below.
      if (box.bottom <= 0 || box.top >= innerHeight || box.right <= 0 || box.left >= innerWidth) continue;
      let clipped = false;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (!/(auto|scroll|hidden)/.test(getComputedStyle(parent).overflowY)) continue;
        const r = parent.getBoundingClientRect();
        if (box.bottom <= r.top || box.top >= r.bottom) clipped = true;
      }
      if (clipped) continue;
      const toolbar = el.closest('[data-testid="calendar-toolbar"]')?.getBoundingClientRect();
      if (toolbar && (box.left < toolbar.left - 1 || box.right > toolbar.right + 1)) result.push(`Calendar control clipped: ${el.getAttribute('aria-label') || el.textContent?.trim()}`);
      if (box.width >= 43.9 && box.height >= 43.9) continue;
      const label = el instanceof HTMLInputElement ? el.labels?.[0] : null;
      if (label) { const r = label.getBoundingClientRect(); if (r.width >= 43.9 && r.height >= 43.9) continue; }
      if (el.matches('[data-slot="event-calendar-event"][data-view="month"]')) {
        const row = el.closest('[data-slot="event-calendar-month-row"]');
        const cells = Array.from(row?.querySelectorAll('[role=gridcell]') ?? []);
        if (cells.length && cells.every(cell => { const r = cell.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && cell.getAttribute('tabindex') === '0'; })) continue;
      }
      const after = getComputedStyle(el, '::after');
      if (after.content !== 'none' && after.position === 'absolute') {
        const left = box.left + (parseFloat(after.left) || 0);
        const right = box.right - (parseFloat(after.right) || 0);
        const top = box.top + (parseFloat(after.top) || 0);
        const bottom = box.bottom - (parseFloat(after.bottom) || 0);
        if (right - left >= 43.9 && bottom - top >= 43.9 && [[left + 1, top + 1], [right - 1, top + 1], [left + 1, bottom - 1], [right - 1, bottom - 1]].every(([x, y]) => el.contains(document.elementFromPoint(x, y)))) continue;
      }
      result.push(`${el.tagName} ${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 70)}: ${box.width.toFixed(1)} × ${box.height.toFixed(1)}`);
    }
    return result;
  });
  expect(failures).toEqual([]);
}
async function scrollTargets(page: Page) {
  await targets(page);
  const panels = page.locator('[role=dialog], [data-slot=scroll-area-viewport], fieldset');
  for (const panel of await panels.all()) {
    if (!await panel.isVisible()) continue;
    await panel.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await targets(page);
  }
}
for (const viewport of [{ width: 390, height: 844 }, { width: 1180, height: 820 }]) {
  test.describe(`${viewport.width}px touch`, () => {
    test.use({ viewport });
    test('hotel calendar, tools and new booking', async ({ page }) => {
      await openDesk(page);
      await scrollTargets(page);
      await page.getByRole('button', { name: 'New booking', exact: true }).click();
      await scrollTargets(page);
    });
    test('stay and edit sheet', async ({ page }) => {
      await openDesk(page);
      await page.locator('[data-slot=event-calendar-event]').filter({ hasText: 'Anna Schmidt' }).first().click();
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      await scrollTargets(page);
      await page.getByRole('button', { name: 'Edit stay' }).click();
      await scrollTargets(page);
    });
    test('staff calendar and appointment', async ({ page }) => {
      await openDesk(page, '?view=staff');
      await scrollTargets(page);
      await page.locator('[data-slot=event-calendar-event]').filter({ hasText: 'Ken Tanaka' }).first().click();
      await scrollTargets(page);
    });
    test('chat list, header and composer', async ({ page }) => {
      await page.goto('/tests/browser/chats.html?path=/admin/chats');
      await page.locator('[data-fixture-ready]').waitFor();
      await scrollTargets(page);
      await page.getByRole('complementary', { name: 'Chat list' }).getByRole('button', { name: /^Website · Anna Müller/ }).click();
      await scrollTargets(page);
    });
    test('missing information and searchable resolve', async ({ page }) => {
      await page.goto('/tests/browser/questions.html?path=/admin/questions');
      await page.locator('[data-fixture-ready]').waitFor();
      await scrollTargets(page);
      await page.getByRole('combobox', { name: 'Resolve "Is breakfast included?" with a fact or source' }).click();
      await scrollTargets(page);
    });
  });
}
