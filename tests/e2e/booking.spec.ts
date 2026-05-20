import { expect, test } from "@playwright/test";

function isoDaysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

test("booking flow validates steps and reaches demo payment", async ({ page }) => {
  const checkIn = isoDaysFromNow(45);
  await page.goto(`/booking?checkin=${checkIn}&nights=2&adults=2&children=0&unit=garden-suite`);

  await expect(page.getByRole("heading", { name: "Reserve your villa" })).toBeVisible();
  await expect(page.getByText(/Demo booking mode/i)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Guests" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Guest details" })).toBeVisible();
  await page.getByLabel("Full name").fill("Test Guest");
  await page.getByLabel("Email").fill("guest@example.com");
  await page.getByLabel("Phone / WhatsApp").fill("+66 77 111 222");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review and pay" })).toBeVisible();
  await page.getByRole("button", { name: "Continue to Pay" }).click();

  await expect(page).toHaveURL(/\/booking\/pay\?bookingId=demo/);
  await expect(page.getByRole("heading", { name: "Confirm demo payment" })).toBeVisible();
});

test("booking dates open as separate single-date pickers", async ({ page }) => {
  const checkIn = isoDaysFromNow(45);
  await page.goto(`/booking?checkin=${checkIn}&nights=2&adults=2&children=0&unit=garden-suite`);

  await page.getByLabel("Check in").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".rdp-range_start, .rdp-range_middle, .rdp-range_end")).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByLabel("Check out").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".rdp-range_start, .rdp-range_middle, .rdp-range_end")).toHaveCount(0);
});

test("payment and success pages guard live links and allow demo confirmation", async ({ page }) => {
  await page.goto("/booking/pay?bookingId=live-without-token");
  await expect(page.getByText(/Live booking verification is unavailable/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Await Secure Checkout" })).toBeDisabled();

  await page.goto("/booking/pay?bookingId=demo");
  await page.getByRole("button", { name: "Confirm Demo Payment" }).click();
  await expect(page).toHaveURL(/\/booking\/success\?bookingId=demo/);
  await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();

  await page.goto("/booking/success?bookingId=live-without-token");
  await expect(page.getByText(/Live booking verification is unavailable/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Booking not confirmed" })).toBeVisible();
});
