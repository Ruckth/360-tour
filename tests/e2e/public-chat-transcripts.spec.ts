import { seedTranscript, serverTranscript } from "./backend";
import { installMockVisualViewport } from "./chat-viewport";
import { expect, test } from "./fixtures";

const CHAT_SESSION_STORAGE_KEY = "sv_chat_session_id";
const CHAT_MESSAGE_CACHE_PREFIX = "sv_chat_messages:";

test("localized chat page keeps server messages and updates suggestion language", async ({ page }) => {
  await seedTranscript(page, "localized-session", [
    { role: "user", content: "What do I get when I book direct?" },
    {
      role: "assistant",
      content:
        "Direct booking saves about 15% versus OTA pricing and keeps support with the host.",
    },
  ]);

  await page.goto("/th/chat?continueInApp=1");

  await expect(page.getByText("What do I get when I book direct?")).toBeVisible();
  await expect(page.getByText(/Direct booking saves about 15%/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "พักทั้งหมดประมาณเท่าไหร่?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "เช็กวันที่ที่ต้องการได้ไหม?" })).toBeVisible();
});

test("mobile chat page restores server messages and keeps the first new send", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await seedTranscript(page, "mobile-session", [
    { role: "user", content: "Cached question about airport pickup" },
    { role: "assistant", content: "Cached answer about private transfers" },
  ]);

  await page.goto("/chat?continueInApp=1");

  await expect(page.getByText("Cached question about airport pickup")).toBeVisible();
  await expect(page.getByText("Cached answer about private transfers")).toBeVisible();

  await page.getByPlaceholder("Ask a question").fill("First new message after cache restore");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Cached question about airport pickup")).toBeVisible();
  await expect(page.getByText("Cached answer about private transfers")).toBeVisible();
  await expect(page.getByText("First new message after cache restore")).toBeVisible();
  await expect.poll(async () => (await serverTranscript(page)).map(row => row.content).join('\n')).toContain("First new message after cache restore");
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('sv_chat_messages:')))).toEqual([]);
});

test("restart chat starts a new persisted session", async ({ page }) => {
  let sessionId = "cached-restart-session";
  await page.setViewportSize({ width: 390, height: 760 });
  sessionId = await seedTranscript(page, sessionId, [
    { role: "user", content: "Cached restart question" },
    { role: "assistant", content: "Cached restart answer" },
  ]);

  await page.goto("/chat");

  await expect(page.getByText("Cached restart question")).toBeVisible();
  await page.getByRole("button", { name: /Restart chat/i }).click();
  const messages = page.getByTestId("chat-messages");

  await expect(page.getByText("Cached restart question")).toHaveCount(0);
  await expect(page.getByText("Cached restart answer")).toHaveCount(0);
  await expect(page.getByText("Ask anything?")).toBeVisible();
  await expect(page.getByTestId("chat-suggestions").getByRole("button")).toHaveCount(6);

  await messages.evaluate((node) => {
    const element = node as HTMLElement;
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await expect(page.getByText("Cached restart question")).toHaveCount(0);
  await expect(page.getByText("Cached restart answer")).toHaveCount(0);

  await expect
    .poll(async () =>
      page.evaluate(
        ({ cachePrefix, seededSessionId }) =>
          window.localStorage.getItem(`${cachePrefix}${seededSessionId}`),
        { cachePrefix: CHAT_MESSAGE_CACHE_PREFIX, seededSessionId: sessionId },
      ),
    )
    .toBeNull();
  await expect
    .poll(async () =>
      page.evaluate((sessionKey) => window.localStorage.getItem(sessionKey), CHAT_SESSION_STORAGE_KEY),
    )
    .not.toBe(sessionId);

  const newSessionCache = await page.evaluate(
    ({ cachePrefix, seededSessionId, sessionKey }) => {
      const nextSessionId = window.localStorage.getItem(sessionKey);
      if (!nextSessionId || nextSessionId === seededSessionId) return "";
      return window.localStorage.getItem(`${cachePrefix}${nextSessionId}`) ?? "";
    },
    {
      cachePrefix: CHAT_MESSAGE_CACHE_PREFIX,
      seededSessionId: sessionId,
      sessionKey: CHAT_SESSION_STORAGE_KEY,
    },
  );
  expect(newSessionCache).not.toContain("Cached restart question");
  expect(newSessionCache).not.toContain("Cached restart answer");
});

for (const browserCase of [
  {
    name: "Android Chrome",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36",
  },
  {
    name: "Mobile Safari",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
  },
]) {
  test(`${browserCase.name} resized viewport keeps messages scrollable above the docked composer`, async ({
    page,
  }) => {
    const label = `resized-keyboard-${browserCase.name.toLowerCase().replace(/\s+/g, "-")}`;
    const seededMessages = Array.from({ length: 8 }).flatMap((_, index) => [
      {
        role: "user" as const,
        content: `Keyboard scroll question ${index + 1}`,
      },
      {
        role: "assistant" as const,
        content: `Assistant keyboard answer ${index + 1} with enough text to create a scrollable transcript on mobile.`,
      },
    ]);

    await page.setViewportSize({ width: 390, height: 760 });
    await installMockVisualViewport(page, browserCase.userAgent);
    await seedTranscript(page, label, seededMessages);
    await page.goto("/chat");

    const chatPanel = page.getByTestId("chat-panel");
    const chatFooter = page.getByTestId("chat-footer");
    const messages = page.getByTestId("chat-messages");
    const input = page.getByPlaceholder("Ask a question");

    await expect(page.getByText("Assistant keyboard answer 8")).toBeVisible();

    await input.focus();
    await page.evaluate(() => {
      (
        window as unknown as {
          __setTestVisualViewportHeight: (height: number) => void;
        }
      ).__setTestVisualViewportHeight(500);
    });
    await input.fill(`Hello from ${browserCase.name}`);

    await expect(chatPanel).toHaveAttribute("data-keyboard-layout", "resizedViewport");
    await expect(chatFooter).toHaveCSS("position", "static");
    await expect(messages).toHaveCSS("overflow-y", "auto");
    await expect
      .poll(async () =>
        chatPanel.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).height)),
      )
      .toBeGreaterThan(450);
    await expect
      .poll(async () =>
        chatPanel.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).height)),
      )
      .toBeLessThan(530);

    const metrics = await messages.evaluate((node) => {
      const originalScrollTop = node.scrollTop;
      node.scrollTop = 0;
      const topScrollTop = node.scrollTop;
      node.scrollTop = node.scrollHeight;
      const bottomScrollTop = node.scrollTop;
      const result = {
        bottomScrollTop,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        topScrollTop,
      };
      node.scrollTop = originalScrollTop;
      return result;
    });
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    expect(metrics.bottomScrollTop).toBeGreaterThan(metrics.topScrollTop);

    const inputBox = await input.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(500);
  });
}
