import { expect, test } from "@playwright/test";
import { openDesk } from "./helpers/desk-taps";

// The desk fixture models Bangkok operating hours, independent of the runner's timezone.
test.use({ hasTouch: true, isMobile: true, timezoneId: "Asia/Bangkok" });

for (const width of [390, 1180]) {
  test(`${width}px: chat status is singular and the composer controls align`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tests/browser/chats.html?path=/admin/chats&session=chat-anna");
    await page.locator("[data-fixture-ready]").waitFor();
    await expect(page.getByRole("heading", { name: "Anna Müller", exact: true })).toBeVisible();
    // The queue can also say Needs you. Scope this assertion to the thread header.
    const header = page.getByRole("heading", { name: "Anna Müller", exact: true }).locator("../../..");
    await expect(header.getByText("Needs you", { exact: true }).locator("visible=true")).toHaveCount(1);
    await expect(header.getByText("Waiting for staff", { exact: true })).toHaveCount(0);
    await expect(header.getByText("AI on", { exact: true })).toHaveCount(0);
    const input = page.getByRole("textbox", { name: "Type an admin reply" });
    const send = page.getByRole("button", { name: "Send", exact: true });
    const inputBox = (await input.boundingBox())!;
    const sendBox = (await send.boundingBox())!;
    expect(Math.abs(inputBox.height - sendBox.height)).toBeLessThanOrEqual(1);
    expect(inputBox.height).toBeGreaterThanOrEqual(44);
    if (width === 390) expect(await input.evaluate(el => getComputedStyle(el).borderRadius)).toBe(await send.evaluate(el => getComputedStyle(el).borderRadius));
  });

  test(`${width}px: a resolve failure stays with its question and can be retried`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tests/browser/questions.html?path=/admin/questions&failResolve");
    await page.locator("[data-fixture-ready]").waitFor();
    const row = page.locator("tbody tr").filter({ hasText: "Is breakfast included?" });
    const otherRow = page.locator("tbody tr").filter({ hasText: "Do you have a baby cot?" });
    if (width === 390) await expect(page.getByRole("combobox", { name: "Report status" })).toContainText("Status: New");
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Breakfast is included", exact: true }).click();
    await expect(row.getByRole("alert")).toContainText("Couldn’t resolve this question. Try again.");
    await expect(otherRow.getByRole("alert")).toHaveCount(0);
    await expect(row.getByRole("combobox")).toBeEnabled();
    await row.getByRole("combobox").click();
    await page.getByRole("option", { name: "Breakfast is included", exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(page.getByTestId("toast")).toContainText("Resolved 2 reports");
  });
}

test("phone booking footer reaches the bottom and Block stays beside the date task", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesk(page);
  await page.getByRole("button", { name: "New booking", exact: true }).click();
  await page.getByTestId("booking-check-in").click();
  await page.locator('[data-day="2026-11-20"] button').click();
  await page.locator('[data-day="2026-11-23"] button').click();
  const dialog = page.getByRole("dialog", { name: "New booking", exact: true });
  const footer = dialog.getByRole("button", { name: "Create booking" }).locator("../..");
  const footerBox = (await footer.boundingBox())!;
  expect(footerBox.y + footerBox.height).toBeCloseTo(844, 0);
  await expect(dialog.locator('section[aria-labelledby="nb-stay-title"]').getByRole("button", { name: "Block these dates instead" })).toBeVisible();
  await expect(footer.getByRole("button", { name: "Block these dates instead" })).toHaveCount(0);
  await expect(footer.getByRole("button", { name: "Create booking" })).toBeDisabled();
});

test("phone hotel list states Paid once and explains whose balance is due", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDesk(page);
  await expect(page.getByRole("button", { name: /^Balance due/ })).toContainText("From today’s guests");
  const lena = page.locator('[data-slot="event-calendar-event"]').filter({ hasText: "Lena Fischer" });
  await expect(lena.first()).toBeVisible();
  for (const row of await lena.all()) await expect(row.getByText("Paid", { exact: true })).toHaveCount(1);
});

test("staff status chips stay distinct from turnaround and offscreen cues keep headers aligned", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openDesk(page, "?view=staff");
  const ken = page.locator('[data-slot="event-calendar-event"]').filter({ hasText: "Ken Tanaka" }).first();
  await expect(ken).toBeVisible();
  expect(await ken.evaluate(el => getComputedStyle(el).borderLeftWidth)).toBe("3px");
  expect(await ken.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await page.locator(".bg-card").first().evaluate(el => getComputedStyle(el).backgroundColor));
  const headers = page.locator('[data-slot="event-calendar-resource-header"] > span');
  const positions = await headers.evaluateAll(nodes => nodes.map(el => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })));
  expect(positions.length).toBe(4);
  expect(new Set(positions.map(box => box.top)).size).toBe(1);
  expect(new Set(positions.map(box => box.height)).size).toBe(1);
  await expect(page.getByText("2 appointments", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Week", exact: true }).click();
  const narrowKen = page.locator('[data-slot="event-calendar-event"]').filter({ hasText: "Ken Tanaka" }).first();
  await expect(narrowKen.locator('svg[aria-label="Booked"]')).toBeVisible();
});
