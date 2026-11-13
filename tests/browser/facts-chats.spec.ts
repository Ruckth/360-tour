import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectAtMostSentences } from "./helpers/sentence-budget";

/*
 * P6 · Facts and Chats. Each task counts taps through one recorder and asserts the target from
 * docs/plans/ux-simplification-plan.md. Measured before the change (same fixtures):
 *   Reach the Missing information queue: 2 taps (Questions, then the tab) → now 1 (Questions).
 *   Resolve a report with an existing fact: 3 taps (open picker, fact, Resolve) → now 2.
 *   Clear a chat (desktop): 2 taps (⋯, No reply needed) and 1 more to open the next chat → now 1.
 *   Clear a chat (phone): 3 taps (chat, ⋯, No reply needed) and 2 more to reach the next → now 2.
 *   Read a guest's contact: 2 taps (ⓘ, Close) → now 0.
 */
const SIZES = { desktop: { width: 1180, height: 820 }, phone: { width: 390, height: 844 } } as const;
const SHOTS = "docs/screenshots/ux-p6";
const screenshots = process.env.UX_P6_SCREENSHOTS === "1";

function recorder() {
  let taps = 0;
  return {
    async tap(locator: Locator) {
      await locator.click();
      taps += 1;
    },
    get taps() {
      return taps;
    },
  };
}
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.locator("[data-fixture-ready]").waitFor();
}
async function shot(page: Page, name: string) {
  if (screenshots) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}
const fixtureCalls = (page: Page) => page.evaluate(() => (window as unknown as { fixtureCalls: Array<[string, unknown]> }).fixtureCalls);

for (const [size, viewport] of Object.entries(SIZES)) {
  test.describe(size, () => {
    test.beforeEach(async ({ page }) => page.setViewportSize(viewport));

    test("Questions opens on the Missing information queue (2 → 1 tap)", async ({ page }) => {
      const taps = recorder();
      // The nav tap to Questions is the one tap; the queue is already open on arrival.
      const navTaps = 1;
      await open(page, "/tests/browser/questions.html?path=/admin/questions");
      await expect(page.getByRole("tab", { name: "Missing information" })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByText("Do you have a baby cot?")).toBeVisible();
      expect(navTaps + taps.taps).toBe(1);
      await expect(page.getByRole("tab")).toHaveText(["Missing information", "Business facts"]);
      await expect(page.getByRole("tab", { name: /Legacy/ })).toHaveCount(0);
      await expectAtMostSentences(page.getByRole("tabpanel"), 1);
      await shot(page, `after-${size}-missing`);
    });

    test("an old Legacy link lands on Missing information", async ({ page }) => {
      await open(page, "/tests/browser/questions.html?path=/admin/questions&tab=legacy");
      await expect(page.getByRole("tab", { name: "Missing information" })).toHaveAttribute("aria-selected", "true");
    });

    test("picking an existing fact resolves the report, with Undo (3 → 2 taps)", async ({ page }) => {
      await open(page, "/tests/browser/questions.html?path=/admin/questions");
      const taps = recorder();
      await taps.tap(page.getByRole("combobox", { name: 'Resolve "Is breakfast included?" with a fact or source' }));
      await taps.tap(page.getByRole("option", { name: "Breakfast is included" }));
      const toast = page.getByTestId("toast");
      await expect(toast).toContainText("Resolved 2 reports with “Breakfast is included”");
      expect(taps.taps).toBe(2);
      expect(await fixtureCalls(page)).toEqual([
        ["adminResolveUnknownGroups", { normalizedQuestions: ["is breakfast included"], factId: "fact-breakfast" }],
      ]);
      await expect(page.getByText("Is breakfast included?")).toHaveCount(0);
      // The toast is in view, above the phone tab bar.
      const box = (await toast.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expectAtMostSentences(toast, 1);
      await shot(page, `after-${size}-resolved-undo`);

      await toast.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByText("Is breakfast included?")).toBeVisible();
      expect((await fixtureCalls(page)).at(-1)).toEqual([
        "adminReopenUnknownGroups",
        { unknownQuestionIds: ["unknown-1", "unknown-2"] },
      ]);
      await expect(toast.getByRole("button", { name: "Undo" })).toHaveCount(0);
    });

    test("a report card: resolve with a fact, Create fact in one tap, Ignore in ⋯", async ({ page }) => {
      await open(page, "/tests/browser/questions.html?path=/admin/questions");
      const card = page.locator("tbody tr").filter({ hasText: "Do you have a baby cot?" });
      // Before round 2: checkbox, Open chat, the select, Create fact, Ignore (5), plus a "New" badge,
      // a "Context" label and the page path (/villas/tideglass) on every card.
      const controls = await card.evaluate((el) => el.querySelectorAll("button, select, a[href], input:not([type=hidden])").length);
      expect(controls).toBe(5);
      await expect(card.getByRole("button", { name: "Create fact" })).toHaveCount(1);
      await expect(card.getByRole("button", { name: "Ignore", exact: true })).toHaveCount(0);
      await expect(page.locator("tbody").getByText("New", { exact: true })).toHaveCount(0);
      await expect(page.locator("tbody").getByText("/villas/")).toHaveCount(0);
      await expect(page.locator('tbody [data-label="Context"]')).toHaveCount(0);
      await expect(card).toContainText("Tideglass Pool Residence");
      await expectAtMostSentences(page.getByRole("tabpanel"), 1);

      // Create fact: one tap opens the form, prefilled from the question (most reports need a new fact).
      const taps = recorder();
      await taps.tap(card.getByRole("button", { name: "Create fact" }));
      const form = page.getByRole("dialog");
      await expect(form).toBeVisible();
      await expect(form.getByRole("textbox").first()).toHaveValue(/Do you have a baby cot\?/);
      expect(taps.taps).toBe(1);
      expect(await fixtureCalls(page)).toEqual([]);
      await page.keyboard.press("Escape");

      // Ignore: ⋯, then Ignore, with Undo.
      const dog = page.locator("tbody tr").filter({ hasText: "Can I bring my dog?" });
      await dog.getByRole("button", { name: 'More for "Can I bring my dog?"' }).click();
      await page.getByRole("menuitem", { name: "Ignore" }).click();
      await expect(page.getByTestId("toast")).toContainText("Ignored 1 report");
      expect((await fixtureCalls(page)).at(-1)).toEqual(["adminIgnoreUnknownGroups", { normalizedQuestions: ["can i bring my dog"] }]);
      await shot(page, `after-${size}-missing-r2`);
    });

    test("handled reports keep their status and a Reopen button", async ({ page }) => {
      await open(page, "/tests/browser/questions.html?path=/admin/questions");
      await page.getByRole("combobox", { name: 'Resolve "Is breakfast included?" with a fact or source' }).click();
      await page.getByRole("option", { name: "Breakfast is included" }).click();
      await page.getByRole("combobox", { name: "Report status" }).click();
      await page.getByRole("option", { name: "All" }).click();
      const card = page.locator("tbody tr").filter({ hasText: "Is breakfast included?" });
      await expect(card).toContainText("Resolved");
      await expect(card.getByRole("button", { name: "Reopen" })).toBeVisible();
    });

    test("No reply needed clears the chat and opens the next one", async ({ page }) => {
      await open(page, "/tests/browser/chats.html?path=/admin/chats");
      const taps = recorder();
      if (size === "phone") await taps.tap(page.getByRole("button", { name: /Anna Müller/ }).first());
      await expect(page.getByRole("heading", { name: "Anna Müller", exact: true })).toBeVisible();
      await taps.tap(page.getByRole("button", { name: "No reply needed", exact: true }));
      await expect(page.getByRole("heading", { name: "Somchai P.", exact: true })).toBeVisible();
      // Desktop 2 → 1 (the chat opens itself); phone 3 → 2 (open the chat, then No reply needed).
      expect(taps.taps).toBe(size === "phone" ? 2 : 1);
      expect(await fixtureCalls(page)).toEqual([
        ["setSessionStatus", { sessionId: "chat-anna", status: "resolved", expectedGuestMessageId: "msg-3" }],
      ]);
      // Anna left the Needs you queue.
      const list = page.getByRole("complementary", { name: "Chat list" });
      await expect(list.getByRole("button", { name: /Anna Müller/ })).toHaveCount(0);
      if (size === "desktop") await expect(list.getByRole("status")).toHaveText("No reply needed · Anna Müller");
    });

    test("contact details sit in the chat header; IDs sit under a closed More · technical section (2 → 0 taps)", async ({ page }) => {
      await open(page, "/tests/browser/chats.html?path=/admin/chats");
      if (size === "phone") await page.getByRole("button", { name: /Anna Müller/ }).first().click();
      const contact = page.getByRole("group", { name: "Contact" }).or(page.locator('address[aria-label="Contact"]'));
      await expect(contact).toContainText("+49 151 2345 6789");
      await expect(contact).toContainText("anna.mueller@example.com");
      await expect(contact.getByRole("link", { name: "anna.mueller@example.com" })).toHaveAttribute("href", "mailto:anna.mueller@example.com");
      await expect(contact.getByRole("link", { name: "+49 151 2345 6789" })).toHaveAttribute("href", "tel:+4915123456789");
      for (const box of [await contact.boundingBox()]) {
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
        expect(box!.y).toBeGreaterThanOrEqual(0);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await expect(page.getByText("chat-anna")).toHaveCount(0);
      const pane = size === "phone" ? page.getByTestId("admin-chat-detail-dialog") : page.getByRole("region", { name: "Selected chat" });
      await expectAtMostSentences(pane, 1);
      await shot(page, `after-${size}-chat`);

      // Debug fields: in Chat details, under More · technical, closed until asked for.
      await page.getByRole("button", { name: "Chat details" }).click();
      const sheet = page.getByRole("dialog", { name: "Chat details" });
      const technical = sheet.locator("details", { has: page.locator("summary", { hasText: "More · technical" }) });
      await expect(technical).not.toHaveAttribute("open", "");
      await expect(sheet.getByText("chat-anna")).toBeHidden();
      await expect(sheet.getByText("visitor_8f2c41d0")).toBeHidden();
      await technical.locator("summary").click();
      await expect(sheet.getByText("chat-anna")).toBeVisible();
      await expect(sheet.getByText("Europe/Berlin")).toBeVisible();
      await expectAtMostSentences(sheet, 1);
      await shot(page, `after-${size}-technical`);
    });

    test("chat actions say chat, never conversation", async ({ page }) => {
      await open(page, "/tests/browser/chats.html?path=/admin/chats");
      if (size === "phone") await page.getByRole("button", { name: /Anna Müller/ }).first().click();
      await page.getByRole("button", { name: "More chat actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Archive chat" })).toBeVisible();
      await expect(page.getByText(/conversation/i)).toHaveCount(0);
    });

    test("an LINE guest shows the app handle in the header", async ({ page }) => {
      await open(page, "/tests/browser/chats.html?path=/admin/chats&session=chat-somchai&view=needs_reply");
      if (size === "phone") await expect(page.getByTestId("admin-chat-detail-dialog")).toBeVisible();
      await expect(page.locator('address[aria-label="Contact"]')).toContainText("@somchai.p");
    });
  });
}
