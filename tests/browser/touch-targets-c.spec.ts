import { expect, test, type Page } from "@playwright/test";

// No size exceptions. aria-hidden form mirrors are visually clipped and not interactive. Native radio/checkbox inputs use their clickable label's hit box.
// summary and combobox are included as well as the required selector, so disclosures
// and shared structured pickers cannot silently fall outside the touch census.
const targets =
  "button, a[href], input, select, textarea, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=combobox], summary";
async function assertTargets(page: Page) {
  const more = page.getByRole("button", { name: "More tabs", exact: true });
  if (await more.isVisible()) {
    const box = (await more.boundingBox())!;
    expect(box.width, "More tabs: width").toBeGreaterThanOrEqual(44);
    expect(box.height, "More tabs: height").toBeGreaterThanOrEqual(44);
  }
  const results = await page.locator(targets).evaluateAll(async (elements) => {
    const results: { name: string; width: number; height: number }[] = [];
    for (const element of elements) {
      if (
        !element.isConnected ||
        element.getAttribute("aria-hidden") === "true" ||
        !element.checkVisibility()
      )
        continue;
      element.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      results.push(
        (() => {
          const rect = element.getBoundingClientRect();
          const name =
            element.getAttribute("aria-label") ||
            element.textContent?.trim().slice(0, 70) ||
            element.id ||
            element.tagName;
          if (rect.width >= 44 && rect.height >= 44)
            return { name, width: rect.width, height: rect.height };
          const after = getComputedStyle(element, "::after");
          if (after.content !== "none" && after.position === "absolute") {
            const left = parseFloat(after.left),
              top = parseFloat(after.top);
            const right = parseFloat(after.right),
              bottom = parseFloat(after.bottom);
            if ([left, top, right, bottom].every(Number.isFinite)) {
              const width = rect.width - left - right,
                height = rect.height - top - bottom;
              const hit = [0.05, 0.5, 0.95].every((x) =>
                [0.05, 0.5, 0.95].every((y) => {
                  const target = document.elementFromPoint(
                    rect.left + left + width * x,
                    rect.top + top + height * y,
                  );
                  return target !== null && element.contains(target);
                }),
              );
              if (hit) return { name, width, height };
            }
          }
          const label =
            element instanceof HTMLInputElement ? element.labels?.[0] : null;
          if (label) {
            const box = label.getBoundingClientRect();
            // Sample the label's expanded hit area, including both edges. Each point
            // must resolve to the label or a descendant that activates this input.
            const hit = [0.1, 0.5, 0.9].every((x) =>
              [0.1, 0.5, 0.9].every((y) => {
                const target = document.elementFromPoint(
                  box.left + box.width * x,
                  box.top + box.height * y,
                );
                return target !== null && label.contains(target);
              }),
            );
            if (hit) return { name, width: box.width, height: box.height };
          }
          return { name, width: rect.width, height: rect.height };
        })(),
      );
    }
    return results;
  });
  expect(
    results.filter(({ width, height }) => width < 44 || height < 44),
    "Every visible control has a 44×44 hit box",
  ).toEqual([]);
  expect(results.length).toBeGreaterThan(0);
}

for (const [size, viewport] of Object.entries({
  phone: { width: 390, height: 844 },
  ipad: { width: 1180, height: 820 },
})) {
  test.describe(`Package C touch targets (${size})`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });
    for (const tab of [
      "business",
      "bookingRules",
      "ai",
      "email",
      "channels",
      "team",
    ]) {
      test(`settings ${tab}`, async ({ page }) => {
        await page.goto(
          `/tests/browser/staff-roles.html?view=settings&tab=${tab}`,
        );
        await page.locator("[data-fixture-ready]").waitFor();
        if (tab === "team")
          await page
            .getByRole("region", { name: "People", exact: true })
            .waitFor();
        else if (tab === "business")
          await page.getByLabel("Business name", { exact: true }).waitFor();
        await assertTargets(page);
        if (tab === "team") {
          await page
            .getByRole("button", { name: "Invite", exact: true })
            .click();
          await page
            .getByRole("button", { name: "Change roles for Ploy" })
            .click();
          await assertTargets(page);
        }
      });
    }
    test("coupon and expanded rules", async ({ page }) => {
      await page.goto("/tests/browser/marketing-coupon.html");
      await page
        .getByRole("heading", { name: "New coupon", exact: true })
        .waitFor();
      await assertTargets(page);
      await page
        .getByRole("radio", { name: "Choose villas", exact: true })
        .click();
      await page.locator("summary").filter({ hasText: /^More/ }).click();
      await assertTargets(page);
    });
    test("dashboard", async ({ page }) => {
      await page.goto("/tests/browser/marketing-dashboard.html");
      await page
        .getByRole("heading", { name: "Marketing dashboard", exact: true })
        .waitFor();
      await page
        .getByRole("heading", {
          name: "Results from tracked links",
          exact: true,
        })
        .waitFor();
      await assertTargets(page);
    });
    test("overflow reveals Email and Channels", async ({ page }) => {
      await page.goto(
        "/tests/browser/staff-roles.html?view=settings&tab=business",
      );
      await page.getByLabel("Business name", { exact: true }).waitFor();
      for (const name of ["Email", "Channels"]) {
        const tab = page.getByRole("tab", { name, exact: true });
        for (let step = 0; step < 4; step++) {
          const box = await tab.boundingBox();
          if (box && box.x >= 0 && box.x + box.width <= viewport.width - 15)
            break;
          await page.getByRole("button", { name: "More tabs" }).click();
          await expect
            .poll(async () =>
              page
                .getByRole("tablist", { name: "Settings sections" })
                .evaluate((el) => el.scrollLeft),
            )
            .toBeGreaterThan(0);
          await page.waitForTimeout(250);
        }
        const box = (await tab.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      }
    });
  });
}
