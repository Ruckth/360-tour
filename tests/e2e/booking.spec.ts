import { expect, test } from "./fixtures";
import { localBackend } from "./backend";
import { api } from "../../convex/_generated/api";


function isoDaysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

test("@smoke booking flow validates steps and persists the booking and reaches payment", async ({ page }) => {
  const checkIn = isoDaysFromNow(45);
  await page.goto(`/booking?checkin=${checkIn}&nights=2&adults=2&children=0&unit=garden-suite`);

  await expect(page.getByRole("heading", { name: "Reserve your villa" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Guests" })).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Guest details" })).toBeVisible();
  await page.getByLabel("Full name").fill("Test Guest");
  await page.getByLabel("Email").fill("guest@example.com");
  await page.getByLabel("Phone / WhatsApp").fill("+66 77 111 222");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "Review and pay" })).toBeVisible();
  await expect(page.getByTestId("booking-review-property")).toContainText("Mossbell Garden Suite");
  await expect(page.getByTestId("booking-review-dates")).toContainText("2 nights");
  await expect(page.getByTestId("booking-review-guests")).toHaveText("2 guests");
  await expect(page.getByText(/Mossbell Garden Suite, 2 guests, 2 nights/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to Pay" }).click();

  await expect(page).toHaveURL(/\/booking\/pay\?bookingId=[a-z0-9]+&token=/);
  await expect(page.getByRole("heading", { name: "Confirm payment" })).toBeVisible();
});

test("booking dates open as a unified start/end range picker", async ({ page }) => {
  const checkIn = isoDaysFromNow(45);
  await page.goto(`/booking?checkin=${checkIn}&nights=2&adults=2&children=0&unit=garden-suite`);

  await page.getByLabel("Check in").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkIn")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkOut")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkIn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(3);
  await page.keyboard.press("Escape");

  await page.getByLabel("Check out").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkIn")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkOut")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkOut")).toHaveAttribute("aria-pressed", "true");
});

test("a retired villa URL selects actual backend inventory", async ({ page }) => {
  // A retired URL slug selects actual available inventory, with no bundled/default villa.
  const inventory = await localBackend().query(api.catalog.properties.list, {});
  expect(inventory.length).toBeGreaterThan(0);
  await page.goto('/booking?unit=retired-villa');
  await expect(page.getByRole('button', { pressed: true }).filter({ hasText: inventory[0].name })).toBeVisible();
});

test("thai booking calendar localizes the month header", async ({ page }) => {
  await page.goto("/th/booking?checkin=2026-05-22&checkout=2026-05-31&unit=garden-suite");

  await page.getByLabel("เช็กอิน").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("พฤษภาคม 2569")).toBeVisible();
  await expect(page.getByText("May 2026")).toHaveCount(0);
});

test("payment and success pages refuse missing access credentials", async ({ page }) => {
  await page.goto("/booking/pay?bookingId=invalid-without-token");
  await expect(page.getByRole("button", { name: "Pay", exact: true })).toBeDisabled();
  await expect(page.getByText(/access token|secure link/i)).toBeVisible();
  await page.goto("/booking/success?bookingId=invalid-without-token");
  await expect(page.getByRole("heading", { name: "Booking not confirmed" })).toBeVisible();
});
