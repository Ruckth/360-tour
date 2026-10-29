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

test("historical create loads only bounded months and allows changing past check-in", async ({ page }) => {
  await page.goto("/tests/browser/index.html?checkIn=2025-01-30&checkOut=2025-02-03");
  const submit = page.getByRole("button", { name: "Create booking", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByTestId("booking-check-in").click();
  await page.locator('[data-day="2025-01-29"] button').click();
  await page.locator('[data-day="2025-02-04"] button').click();
  await page.getByLabel("Phone", { exact: true }).fill("0812345678");
  await page.getByLabel("Guest name", { exact: true }).fill("Past Guest");
  await submit.click();
  await expect(page.locator("body")).toHaveAttribute("data-submission", /"checkIn":"2025-01-29","checkOut":"2025-02-04"/);
  const requests = JSON.parse((await page.locator("body").getAttribute("data-availability-requests"))!);
  expect(requests.length).toBeLessThanOrEqual(3);
  expect(requests.every((request: { startDate: string; endDate: string }) =>
    request.startDate.startsWith("2025-") && request.startDate.slice(0, 7) === request.endDate.slice(0, 7),
  )).toBe(true);
});

test("historical conflict in a middle month blocks submission and is marked unavailable", async ({ page }) => {
  await page.goto("/tests/browser/index.html?checkIn=2025-01-30&checkOut=2025-03-03&blocked=2025-02-15");
  await expect(page.getByRole("alert")).toContainText("overlap");
  await expect(page.getByRole("button", { name: "Create booking", exact: true })).toBeDisabled();
  await page.getByTestId("booking-check-in").click();
  await page.getByRole("button", { name: "Go to the Previous Month" }).click();
  const cell = page.locator('[data-day="2025-02-15"]');
  await expect(cell).toHaveAttribute("data-disabled", "true");
  await expect(cell).toHaveClass(/bg-destructive/);
});

test("availability loading and failures stay closed until a successful retry", async ({ page }) => {
  await page.goto("/tests/browser/index.html?checkIn=2025-01-30&checkOut=2025-02-03&delay&fail");
  const submit = page.getByRole("button", { name: "Create booking", exact: true });
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText("Checking availability…");
  await expect(page.getByRole("alert")).toContainText("Could not load availability");
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "Retry availability" }).click();
  await expect(submit).toBeDisabled();
  await expect(submit).toBeEnabled();
});

test("changing villas cannot reuse the prior villa's loaded availability", async ({ page }) => {
  await page.goto("/tests/browser/index.html?checkIn=2025-01-30&checkOut=2025-02-03&delay");
  const submit = page.getByRole("button", { name: "Create booking", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByRole("button", { name: /^Villa / }).click();
  await page.getByRole("option", { name: /Garden Villa/ }).click();
  await expect(submit).toBeDisabled();
  await expect(submit).toBeEnabled();
});

test("overlong historical stays are rejected without loading years of availability", async ({ page }) => {
  await page.goto("/tests/browser/index.html?checkIn=2020-01-01&checkOut=2025-02-03");
  await expect(page.getByRole("alert")).toContainText("365 nights");
  await expect(page.getByRole("button", { name: "Create booking", exact: true })).toBeDisabled();
  const requests = JSON.parse((await page.locator("body").getAttribute("data-availability-requests"))!);
  expect(requests).toHaveLength(3);
});

test("historical edit excludes its booking id and submits changed past dates", async ({ page }) => {
  await page.goto("/tests/browser/index.html?mode=edit");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await expect(save).toBeEnabled();
  await page.getByTestId("booking-check-in").click();
  await page.locator('[data-day="2025-01-29"] button').click();
  await page.locator('[data-day="2025-02-04"] button').click();
  await save.click();
  await expect(page.locator("body")).toHaveAttribute("data-submission", /"checkIn":"2025-01-29","checkOut":"2025-02-04"/);
  const requests = JSON.parse((await page.locator("body").getAttribute("data-availability-requests"))!);
  expect(requests.every((request: { excludeBookingId?: string }) => request.excludeBookingId === "booking-id")).toBe(true);
});

test("country selector changes the example, accepts international phone entry, and requires phone", async ({ page }) => {
  await page.goto("/tests/browser/index.html");
  const phone = page.getByLabel("Phone", { exact: true });
  await expect(phone).toHaveAttribute("placeholder", "081 234 5678");
  await page.getByLabel("Guest name", { exact: true }).fill("Phone Guest");
  await page.getByRole("button", { name: "Create booking", exact: true }).click();
  await expect(page.locator("body")).not.toHaveAttribute("data-submission");
  await page.getByRole("combobox", { name: "Country: Thailand", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search countries" });
  await search.fill("United Kingdom");
  await page.getByRole("option", { name: /United Kingdom/ }).click();
  await expect(phone).toHaveAttribute("placeholder", "07400 123456");
  await phone.fill("07700900123");
  await page.getByRole("button", { name: "Create booking", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-submission", /"guestPhone":"\+447700900123"/);
});

test("returning guest selection fills contact fields and updates the country", async ({ page }) => {
  await page.goto("/tests/browser/index.html?returning&phone=%2B44%207400%20123456");
  await page.getByLabel("Email (optional)").fill("returning@");
  await page.getByRole("button", { name: /Returning Guest/ }).click();
  await expect(page.getByLabel("Guest name", { exact: true })).toHaveValue("Returning Guest");
  await expect(page.getByLabel("Email (optional)")).toHaveValue("returning@example.com");
  await expect(page.getByRole("combobox", { name: "Country: United Kingdom", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create booking", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-submission", /"guestPhone":"\+447400123456"/);
});

test("phone country search handles empty results, keyboard selection and mobile bounds", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/tests/browser/index.html");
  await page.getByRole("combobox", { name: "Country: Thailand", exact: true }).click();
  const search = page.getByRole("combobox", { name: "Search countries" });
  await expect(search).toBeFocused();
  await search.fill("zzzz");
  await expect(page.getByText("No country found.", { exact: true })).toBeVisible();
  await search.fill("United Kingdom");
  const option = page.getByRole("option", { name: /United Kingdom/ });
  const box = await option.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  expect(box!.y + box!.height).toBeLessThanOrEqual(568);
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(search).not.toBeVisible();
  const country = page.getByRole("combobox", { name: "Country: United Kingdom", exact: true });
  await expect(country).toBeVisible();
  await country.click();
  await expect(search).toHaveValue("");
  await search.press("Escape");
  await expect(search).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "New booking" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveAttribute("data-submission");
});


test("admin availability updates while the dialog is open", async ({ page }) => {
  await page.goto("/tests/browser/index.html?checkIn=2025-01-30&checkOut=2025-02-03");
  const submit = page.getByRole("button", { name: "Create booking", exact: true });
  await expect(submit).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-availability", { detail: "2025-02-01" })));
  await expect(submit).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("overlap");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("fixture-availability", { detail: null })));
  await expect(submit).toBeEnabled();
  await expect(page.getByText("These dates overlap an existing booking or block.")).not.toBeVisible();
});

test("incomplete phone entry is rejected before creating a booking", async ({ page }) => {
  await page.goto("/tests/browser/index.html");
  await page.getByLabel("Phone", { exact: true }).fill("08");
  await page.getByLabel("Guest name", { exact: true }).fill("Phone Guest");
  await page.getByRole("button", { name: "Create booking", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Enter a complete phone number for the selected country.");
  await expect(page.locator("body")).not.toHaveAttribute("data-submission");
});

for (const saved of ["(202) 555-0123", "07700 900123", "081-234-5678 ext 2", "+66 81 234 5678 ext 2"]) {
  test(`ambiguous saved contact is shown for correction: ${saved}`, async ({ page }) => {
    await page.goto(`/tests/browser/index.html?returning&phone=${encodeURIComponent(saved)}`);
    await page.getByLabel("Email (optional)").fill("returning@");
    await page.getByRole("button", { name: /Returning Guest/ }).click();
    await expect(page.getByText(`Saved phone: ${saved}. Select the country and re-enter this number before booking.`)).toBeVisible();
    await expect(page.getByLabel("Phone", { exact: true })).toBeEmpty();
    await page.getByRole("button", { name: "Create booking", exact: true }).click();
    await expect(page.locator("body")).not.toHaveAttribute("data-submission");
  });
}


test("public calendar keeps past blocked dates plainly disabled", async ({ page }) => {
  await page.goto("/tests/browser/index.html?mode=public-calendar");
  await page.getByTestId("booking-check-in").click();
  const cell = page.locator('[data-day="2025-02-15"]');
  await expect(cell).toHaveAttribute("data-disabled", "true");
  await expect(cell).not.toHaveClass(/bg-destructive/);
});
