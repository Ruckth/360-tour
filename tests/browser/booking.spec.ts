import { test, expect } from "@playwright/test";

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`booking popup keeps content inside its padding at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/tests/browser/index.html");
    const dialog = page.getByRole("dialog", { name: "New booking" });
    await expect(dialog).toBeVisible();
    await page.getByLabel("Phone", { exact: true }).focus();
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const title = element.querySelector("h2")!.getBoundingClientRect();
      const form = element.querySelector("form")!.getBoundingClientRect();
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        left: rect.left,
        right: rect.right,
        titleLeft: title.left,
        formLeft: form.left,
        padding: parseFloat(style.paddingLeft),
      };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
    expect(geometry.left).toBeGreaterThanOrEqual(15);
    expect(geometry.right).toBeLessThanOrEqual(viewport.width - 15);
    expect(geometry.titleLeft).toBeGreaterThanOrEqual(
      geometry.left + geometry.padding,
    );
    expect(geometry.formLeft).toBeGreaterThanOrEqual(
      geometry.left + geometry.padding,
    );
    const submit = page.getByRole("button", {
      name: "Create booking",
      exact: true,
    });
    if (viewport.width >= 640) {
      const closeBox = await dialog.getByRole("button", { name: "Close", exact: true }).first().boundingBox();
      const submitBox = await submit.boundingBox();
      expect(closeBox!.y).toBe(submitBox!.y);
    }
    await page.screenshot({ path: testInfo.outputPath("booking-popup.png") });
    await submit.scrollIntoViewIfNeeded();
    const box = await submit.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(geometry.left + geometry.padding);
    expect(box!.x + box!.width).toBeLessThanOrEqual(
      geometry.right - geometry.padding,
    );
  });
}

for (const mode of ["villa", "service"]) {
  test(`${mode} picker supports search, keyboard selection, Escape and photo focus return`, async ({
    page,
  }) => {
    await page.goto(`/tests/browser/index.html?mode=${mode}`);
    const label = mode === "villa" ? "Villa" : "Service";
    const trigger = page.getByRole("button", {
      name: new RegExp(`^${label} `),
    });
    await trigger.click();
    const search = page.getByRole("combobox", { name: `Search ${mode}s` });
    await expect(search).toBeFocused();
    await search.fill("zzzz");
    await expect(
      page.getByText(`No ${mode}s match.`, { exact: true }),
    ).toBeVisible();
    await search.fill("");
    await page.locator('button[aria-label^="View photo of"]').first().click();
    const photo = page.getByRole("img", { name: /^Photo of/ });
    await expect(photo).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(photo).not.toBeVisible();
    await expect(search).toBeFocused();
    await search.fill(mode === "villa" ? " GARDEN " : "Wellness");
    await search.press("ArrowDown");
    await search.press("Enter");
    await expect(search).not.toBeVisible();
    await expect(trigger).toContainText(
      mode === "villa" ? "Garden Villa" : "Yoga",
    );
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(search).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
}

test("new booking submits the selected villa slug", async ({ page }) => {
  await page.goto("/tests/browser/index.html");
  await page.evaluate(() =>
    window.addEventListener("fixture-mutation", (event) => {
      document.body.dataset.submission = JSON.stringify(
        (event as CustomEvent).detail,
      );
    }),
  );
  await page.getByRole("button", { name: /^Villa / }).click();
  await page.getByRole("option", { name: /Garden Villa/ }).click();
  await page.getByLabel("Phone", { exact: true }).fill("0812345678");
  await page.getByLabel("Guest name", { exact: true }).fill("Test Guest");
  await page
    .getByRole("button", { name: "Create booking", exact: true })
    .click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-submission",
    /"propertySlug":"garden-villa"/,
  );
});

test("villa filter preserves All villas and empty and disabled states", async ({
  page,
}) => {
  await page.goto("/tests/browser/index.html?mode=filter");
  const trigger = page.getByRole("button", { name: /^Villa:/ });
  await expect(trigger).toContainText("All villas");
  await trigger.click();
  await page.getByRole("option", { name: /Garden Villa/ }).click();
  await trigger.click();
  await page.getByRole("option", { name: "All villas", exact: true }).click();
  await expect(trigger).toContainText("All villas");
  await page.goto("/tests/browser/index.html?mode=filter&empty");
  await trigger.click();
  await expect(
    page.getByText("No villas yet. Add one under Villas."),
  ).toBeVisible();
  await page.goto("/tests/browser/index.html?mode=filter&disabled");
  await expect(trigger).toBeDisabled();
});

test("long service list scrolls inside the appointment dialog on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await page.goto("/tests/browser/index.html?mode=service");
  await page.getByRole("button", { name: /^Service / }).click();
  const list = page.getByRole("listbox");
  const box = await list.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(15);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(box!.y + box!.height).toBeLessThanOrEqual(480);
  await list.hover();
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.getByRole("combobox").fill("Yoga 29");
  await page.getByRole("option", { name: /Yoga 29/ }).click();
  await expect(page.getByRole("button", { name: /^Service / })).toContainText(
    "Yoga 29",
  );
});

for (const mode of ["villa", "service"]) {
  test(`${mode} uses a fallback when its thumbnail fails`, async ({ page }) => {
    await page.goto(`/tests/browser/index.html?mode=${mode}&broken`);
    const trigger = page.getByRole("button", {
      name: new RegExp(`^${mode === "villa" ? "Villa" : "Service"} `),
    });
    await expect(trigger).toBeVisible();
    await expect(trigger.locator("img")).toHaveCount(0);
    await expect(trigger.locator('span[aria-hidden="true"]')).toBeVisible();
  });
}
