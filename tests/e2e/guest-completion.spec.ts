import en from "../../messages/en.json" with { type: "json" };
import th from "../../messages/th.json" with { type: "json" };
import { api } from "../../convex/_generated/api";
import { localBackend } from "./backend";
import { expect, test } from "./fixtures";

/**
 * Browser acceptance for guest audit rows G19–G36 that depend on real routing, focus or layout.
 * Rule permutations live in the focused Vitest files named in each test.
 */

test.describe("G19 services empty-state reset", () => {
  for (const [prefix, messages] of [["", en], ["/th", th]] as const) {
    test(`one action clears query and category, Back restores them (${prefix || "en"})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${prefix}/services?category=Wellness&q=no-match-xyz`);
      await expect(page.getByRole("status")).toHaveText(messages.ServiceCatalog.empty);
      await page.getByRole("link", { name: messages.ServiceCatalog.showAll, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${prefix}/services$`));
      await expect(page.locator("article").first()).toBeVisible();
      await expect(page.getByRole("textbox", { name: messages.ServiceCatalog.search, exact: true })).toHaveValue("");
      await page.goBack();
      await expect(page).toHaveURL(/category=Wellness&q=no-match-xyz/);
      await expect(page.getByRole("link", { name: messages.ServiceCatalog.showAll, exact: true })).toBeVisible();
    });
  }
});

test.describe("G21 Experiences Contact Concierge", () => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    test(`opens localized chat directly without sending (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/th/experiences");
      const links = page.getByRole("link", { name: th.Experiences.secondaryCta, exact: true });
      await expect(links).toHaveCount(2);
      await links.first().click();
      await expect(page).toHaveURL(/\/th\/chat$/);
      await expect(page.getByPlaceholder(th.Chat.askPlaceholder).first()).toHaveValue("");
      await expect(page.getByTestId("chat-messages").getByText(th.Chat.sent)).toHaveCount(0);
    });
  }
});

function isoDaysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

test("G35 step bar shows one current step and a completed mark", async ({ page }) => {
  await page.goto(`/booking?checkin=${isoDaysFromNow(126)}&nights=2&adults=2&children=0&unit=garden-suite`);
  await page.getByRole("button", { name: en.Booking.continue, exact: true }).click();
  const current = page.getByRole("button", { name: en.Booking.guestDetails, exact: true });
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute("aria-current", "step");
  const done = page.getByRole("button", { name: `${en.Booking.stepCompleted} ${en.Booking.villaDates}`, exact: true });
  await expect(done).toHaveAttribute("data-step-state", "complete");
  await expect(done.locator("svg")).toBeVisible();
  expect(await done.evaluate((node) => getComputedStyle(node).backgroundColor))
    .not.toBe(await current.evaluate((node) => getComputedStyle(node).backgroundColor));
  await expect(page.getByRole("button", { name: en.Booking.pay, exact: true })).toBeDisabled();
  await done.press("Enter");
  await expect(page.getByRole("button", { name: en.Booking.villaDates, exact: true })).toHaveAttribute("aria-current", "step");
});

test.describe("G36 follow-up chips on a coarse pointer", () => {
  test.use({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  test("each follow-up chip is at least 44 px high and chips do not overlap", async ({ page }) => {
    await page.goto("/th/chat?returnTo=%2Fth");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const messages = page.getByTestId("chat-messages");
    await messages.getByTestId("chat-suggestions").getByRole("button", { name: th.Chat.suggestionGuests }).tap();
    const chips = messages.getByTestId("chat-suggestions").getByRole("button");
    await expect(chips).toHaveCount(2);
    const boxes = [];
    for (const chip of await chips.all()) {
      const box = (await chip.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      boxes.push(box);
    }
    const [a, b] = boxes;
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap).toBe(false);
  });
});

test("G22 restart asks first; Keep chatting preserves the conversation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/chat");
  const messages = page.getByTestId("chat-messages");
  // Message bubbles render text in spans; suggestion chips hold bare text.
  const sentBubble = messages.locator("span", { hasText: en.Chat.suggestionGuests });
  await messages.getByTestId("chat-suggestions").getByRole("button", { name: en.Chat.suggestionGuests }).click();
  await expect(sentBubble.first()).toBeVisible();
  await page.getByPlaceholder(en.Chat.askPlaceholder).fill("Unsent follow-up");
  const restart = page.getByRole("button", { name: /Restart chat/i });
  await restart.click();
  const confirm = page.getByRole("alertdialog", { name: en.Chat.restartConfirmTitle });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole("button", { name: en.Chat.restartKeep })).toBeFocused();
  await confirm.getByRole("button", { name: en.Chat.restartKeep }).click();
  await expect(confirm).toHaveCount(0);
  await expect(restart).toBeFocused();
  await expect(sentBubble.first()).toBeVisible();
  await expect(page.getByPlaceholder(en.Chat.askPlaceholder)).toHaveValue("Unsent follow-up");

  await restart.click();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await restart.click();
  await page.getByRole("button", { name: en.Chat.restartConfirm, exact: true }).click();
  await expect(sentBubble).toHaveCount(0);
  await expect(page.getByText(en.Chat.initialPrompt)).toBeVisible();
  await expect(page.getByPlaceholder(en.Chat.askPlaceholder)).toHaveValue("");
});

test("G24 switching contact apps keeps each app's draft", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/chat");
  await page.getByText(en.Chat.shareContact).click();
  const field = page.getByTestId("contact-app-field");
  const handle = field.getByLabel(en.Chat.contactHandle);
  const pick = async (app: "whatsapp" | "line") => {
    await field.getByLabel(en.Chat.preferredApp).click();
    await page.getByTestId(`contact-app-option-${app}`).click();
  };
  await handle.fill("+66 81 234 5678");
  await pick("line");
  await expect(handle).toHaveValue("");
  await expect(handle).toHaveAttribute("placeholder", en.Chat.linePlaceholder);
  await handle.fill("@auralis-guest");
  await pick("whatsapp");
  await expect(handle).toHaveValue("+66 81 234 5678");
  await pick("line");
  await expect(handle).toHaveValue("@auralis-guest");
});

test("G28 the date picker shows the stay rule and a three-entry key at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { bookingRules } = await localBackend().query(api.settings.settings.publicProfile, {});
  await page.goto(`/booking?checkin=${isoDaysFromNow(47)}&nights=2&unit=garden-suite`);
  await page.getByTestId("booking-check-out").click();
  const dialog = page.getByRole("dialog", { name: en.Booking.chooseDates });
  const key = dialog.getByTestId("booking-calendar-key");
  await expect(key.getByRole("listitem")).toHaveText([en.Booking.legendAvailable, en.Booking.legendBooked, en.Booking.legendNotSelectable]);
  await expect(dialog).toHaveAttribute("aria-describedby", (await key.getAttribute("id"))!);
  await expect(key.getByTestId("booking-min-stay")).toHaveCount(bookingRules.minNights > 1 ? 1 : 0);
  const box = (await key.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  // The key adds no tab stops: Escape still closes the picker back to its trigger.
  await expect(key.locator("button, a, [tabindex]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("booking-check-out")).toBeFocused();
});
