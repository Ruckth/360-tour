import { expect, test, type Locator, type Page } from "@playwright/test";
import { bypassDemoDisclaimer } from "./demo-disclaimer";

test.beforeEach(async ({ page }) => {
  await bypassDemoDisclaimer(page);
});

const localizedSmoke = [
  { path: "/th", nav: "จอง", chat: "เปิดแชตคอนเซียจ", close: "ปิดแชต", placeholder: "พิมพ์คำถาม" },
  { path: "/zh-CN", nav: "预订", chat: "打开礼宾聊天", close: "关闭聊天", placeholder: "输入问题" },
  { path: "/ja", nav: "予約", chat: "コンシェルジュチャットを開く", close: "チャットを閉じる", placeholder: "質問を入力" },
  { path: "/ko", nav: "예약", chat: "컨시어지 채팅 열기", close: "채팅 닫기", placeholder: "질문 입력" },
  { path: "/fr", nav: "Réserver", chat: "Ouvrir le chat concierge", close: "Fermer le chat", placeholder: "Posez une question" },
  { path: "/de", nav: "Buchen", chat: "Concierge-Chat öffnen", close: "Chat schließen", placeholder: "Frage stellen" },
  { path: "/es", nav: "Reservar", chat: "Abrir chat de conserjería", close: "Cerrar chat", placeholder: "Haga una pregunta" },
  { path: "/ru", nav: "Забронировать", chat: "Открыть чат с консьержем", close: "Закрыть чат", placeholder: "Задайте вопрос" },
  { path: "/it", nav: "Prenota", chat: "Apri chat concierge", close: "Chiudi chat", placeholder: "Fai una domanda" },
  { path: "/hi", nav: "बुक करें", chat: "कंसीयर्ज चैट खोलें", close: "चैट बंद करें", placeholder: "प्रश्न पूछें" },
];

const CHAT_SESSION_STORAGE_KEY = "sv_chat_session_id";
const CHAT_MESSAGE_CACHE_PREFIX = "sv_chat_messages:";
const CHAT_MESSAGE_CACHE_VERSION = 1;
const CONTACT_PREFILL_MESSAGE =
  "Hi, I'm interested in having a website built with you. I'm available on [date] at [time]. Could we talk then?";
const CONTACT_EMAIL = "rugbykritsakorn@gmail.com";
const LINE_URL = "https://line.me/R/ti/p/@361jhvij";

type SeededChatMessage = { role: "user" | "assistant"; content: string };

async function chooseLanguage(page: Page, optionName: string) {
  const languageButtons = page.getByTestId("language-switcher");
  const buttonCount = await languageButtons.count();
  for (let index = 0; index < buttonCount; index += 1) {
    const button = languageButtons.nth(index);
    if (await button.isVisible()) {
      await button.click();
      break;
    }
  }
  await page.getByRole("link", { name: optionName }).click();
}

async function openCalendarPopover(page: Page, trigger: Locator) {
  await trigger.scrollIntoViewIfNeeded();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await trigger.click();
    const opened = await page
      .getByRole("grid")
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (opened) return;
  }
  await expect(page.getByRole("grid")).toBeVisible();
}

async function expectPrefilledWhatsApp(link: Locator) {
  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();
  const url = new URL(href!);
  expect(`${url.origin}${url.pathname}`).toBe("https://wa.me/66956823432");
  expect(url.searchParams.get("text")).toBe(CONTACT_PREFILL_MESSAGE);
}

async function expectPrefilledEmail(link: Locator) {
  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();
  const url = new URL(href!);
  expect(url.protocol).toBe("mailto:");
  expect(url.pathname).toBe(CONTACT_EMAIL);
  expect(url.searchParams.get("subject")).toBe("Website inquiry");
  expect(url.searchParams.get("body")).toBe(CONTACT_PREFILL_MESSAGE);
}

async function expectVillaTileImageVisible(tile: Locator) {
  const image = tile.locator("img").first();
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("opacity", "1");
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
}

async function installMockVisualViewport(page: Page, userAgent: string) {
  await page.addInitScript(({ mockedUserAgent }) => {
    Object.defineProperty(navigator, "userAgent", {
      get: () => mockedUserAgent,
    });

    type VisualViewportListener = (event: Event) => void;
    const listeners = new Map<string, Set<VisualViewportListener>>();
    const viewport = {
      width: 390,
      height: 760,
      offsetTop: 0,
      offsetLeft: 0,
      pageTop: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener !== "function") return;
        const items = listeners.get(type) ?? new Set<VisualViewportListener>();
        items.add(listener);
        listeners.set(type, items);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        if (typeof listener !== "function") return;
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: Event) {
        listeners.get(event.type)?.forEach((listener) => listener(event));
        return true;
      },
    };

    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      get: () => viewport,
    });
    (
      window as unknown as {
        __setTestVisualViewportHeight: (height: number) => void;
      }
    ).__setTestVisualViewportHeight = (height: number) => {
      viewport.height = height;
      viewport.dispatchEvent(new Event("resize"));
    };
  }, { mockedUserAgent: userAgent });
}

async function seedChatMessageCache(
  page: Page,
  sessionId: string,
  messages: SeededChatMessage[],
) {
  await page.addInitScript(
    ({ cachePrefix, cacheVersion, sessionKey, seededMessages, seededSessionId }) => {
      let latestExchange: { userMessage: string; assistantMessage: string } | null = null;
      for (let assistantIndex = seededMessages.length - 1; assistantIndex >= 0; assistantIndex -= 1) {
        if (seededMessages[assistantIndex]?.role !== "assistant") continue;

        for (let userIndex = assistantIndex - 1; userIndex >= 0; userIndex -= 1) {
          if (seededMessages[userIndex]?.role === "user") {
            latestExchange = {
              userMessage: seededMessages[userIndex].content,
              assistantMessage: seededMessages[assistantIndex].content,
            };
            break;
          }
        }

        if (latestExchange) break;
      }

      window.localStorage.setItem(sessionKey, seededSessionId);
      window.localStorage.setItem(
        `${cachePrefix}${seededSessionId}`,
        JSON.stringify({
          version: cacheVersion,
          sessionId: seededSessionId,
          messages: seededMessages,
          latestExchange,
          updatedAt: Date.now(),
        }),
      );
    },
    {
      cachePrefix: CHAT_MESSAGE_CACHE_PREFIX,
      cacheVersion: CHAT_MESSAGE_CACHE_VERSION,
      sessionKey: CHAT_SESSION_STORAGE_KEY,
      seededMessages: messages,
      seededSessionId: sessionId,
    },
  );
}

test("home page opens chat, shows fallback replies, and exposes contact capture", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Auralis Cove Retreat").first()).toBeVisible();
  await page.getByRole("button", { name: "Open concierge chat" }).click({ force: true });

  await expect(page.getByRole("button", { name: /Restart chat/i })).toBeVisible();
  await expect(page.getByText("Share contact details")).toBeVisible();
  const chatMessages = page.getByTestId("chat-messages");
  const chatFooter = page.getByTestId("chat-footer");

  await expect(
    chatMessages.getByRole("button", { name: /Can I check my dates/i }),
  ).toBeVisible();
  await expect(
    chatFooter.getByRole("button", { name: /Can I check my dates/i }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /How many guests can each villa sleep/i }).click();
  await expect(page.getByText(/Tideglass Pool Residence sleeps up to 4/i)).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: /Which villa is best for a family or group/i }),
  ).toBeVisible();
  await expect(chatMessages.getByRole("button", { name: /Can I check my dates/i })).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: /How many guests can each villa sleep/i }),
  ).toHaveCount(0);

  await page.getByPlaceholder("Ask a question").fill("What do I get when I book direct?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Direct booking saves about 15%/i)).toBeVisible();
  await expect(page.getByTestId("chat-booking-card")).toBeVisible();
  await expect(chatMessages.getByRole("button", { name: /What will my stay cost/i })).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: /Can I check my dates/i }),
  ).toBeVisible();

  await page.getByPlaceholder("Ask a question").fill("Do you have airport pickup?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Do you have airport pickup?")).toBeVisible();
  await expect(
    page.getByText(
      /live chat will connect once Convex is configured|Welcome to Auralis Cove Retreat|trouble connecting/i,
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: /Restart chat/i }).click();
  await expect(page.getByText("Do you have airport pickup?")).toHaveCount(0);
  await expect(page.getByText("Ask anything?")).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: /Can I check my dates/i }),
  ).toBeVisible();

  await page.getByText("Share contact details").click();
  await page.getByRole("textbox", { name: "Email" }).fill("visitor@example.com");
  const contactAppField = page.getByTestId("contact-app-field");
  await expect(contactAppField).toBeVisible();
  await expect(contactAppField.getByLabel("Preferred app")).toBeVisible();
  await expect(contactAppField.getByLabel("Contact handle")).toBeVisible();
  await contactAppField.getByLabel("Preferred app").click();
  const whatsappOption = page.getByTestId("contact-app-option-whatsapp");
  const lineOption = page.getByTestId("contact-app-option-line");
  await expect(whatsappOption).toBeVisible();
  await expect(whatsappOption.getByTestId("contact-app-icon-whatsapp")).toBeVisible();
  await expect(lineOption).toBeVisible();
  await expect(lineOption.getByTestId("contact-app-icon-line")).toBeVisible();
  await page.getByRole("option", { name: "LINE" }).click();
  await expect(page.getByPlaceholder("LINE ID or phone number")).toBeVisible();
  await page.getByLabel("Contact handle").fill("@testvisitor");
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
  await page.getByLabel("Contact handle").fill("+66 81 234 5678");
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
});

test("thai locale renders translated public UI and chat labels", async ({ page }) => {
  await page.goto("/th");

  await expect(page.getByRole("link", { name: "จอง" }).first()).toBeVisible();
  await page.getByRole("button", { name: "เปิดแชตคอนเซียจ" }).click();

  await expect(page.getByRole("button", { name: /เริ่มแชตใหม่/i })).toBeVisible();
  await expect(page.getByText("ฝากข้อมูลติดต่อ")).toBeVisible();
  await expect(page.getByPlaceholder("พิมพ์คำถาม")).toBeVisible();
});

test("mobile chat trigger opens the dedicated chat page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");

  await page.getByRole("link", { name: "Open concierge chat" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/chat" && url.searchParams.get("returnTo") === "/",
  );
  await expect(page.getByRole("button", { name: /Restart chat/i })).toBeVisible();
  await expect(page.getByPlaceholder("Ask a question")).toBeVisible();
  await expect(page.getByRole("banner")).toBeHidden();

  await page.getByRole("button", { name: "Close chat" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("localized mobile chat trigger keeps the locale on the chat page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/th");

  await page.getByRole("link", { name: "เปิดแชตคอนเซียจ" }).click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/th/chat" && url.searchParams.get("returnTo") === "/th",
  );
  await expect(page.getByPlaceholder("พิมพ์คำถาม")).toBeVisible();

  await page.getByRole("button", { name: "ปิดแชต" }).click();
  await expect(page).toHaveURL(/\/th$/);
});

test("localized chat page keeps cached messages and updates suggestion language", async ({ page }) => {
  const sessionId = "cached-locale-session";
  await seedChatMessageCache(page, sessionId, [
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

test("mobile chat page restores cached messages and keeps the first new send", async ({ page }) => {
  const sessionId = "cached-mobile-session";
  await page.setViewportSize({ width: 390, height: 760 });
  await seedChatMessageCache(page, sessionId, [
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
  await expect
    .poll(async () =>
      page.evaluate(
        ({ cachePrefix, seededSessionId }) => {
          const raw = window.localStorage.getItem(`${cachePrefix}${seededSessionId}`);
          if (!raw) return "";
          const cache = JSON.parse(raw) as { messages?: Array<{ content?: string }> };
          return cache.messages?.map((message) => message.content ?? "").join("\n") ?? "";
        },
        { cachePrefix: CHAT_MESSAGE_CACHE_PREFIX, seededSessionId: sessionId },
      ),
    )
    .toContain("First new message after cache restore");
});

test("restart chat clears cached mobile messages", async ({ page }) => {
  const sessionId = "cached-restart-session";
  await page.setViewportSize({ width: 390, height: 760 });
  await seedChatMessageCache(page, sessionId, [
    { role: "user", content: "Cached restart question" },
    { role: "assistant", content: "Cached restart answer" },
  ]);

  await page.goto("/chat");

  await expect(page.getByText("Cached restart question")).toBeVisible();
  await page.getByRole("button", { name: /Restart chat/i }).click();
  const chatMessages = page.getByTestId("chat-messages");

  await expect(page.getByText("Cached restart question")).toHaveCount(0);
  await expect(page.getByText("Cached restart answer")).toHaveCount(0);
  await expect(page.getByText("Ask anything?")).toBeVisible();
  await expect(page.getByTestId("chat-suggestions").getByRole("button")).toHaveCount(6);

  await chatMessages.evaluate((node) => {
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

test("mobile chat trigger stays in the same position on booking and home", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });

  await page.goto("/");
  const homeBox = await page.getByRole("link", { name: "Open concierge chat" }).boundingBox();
  expect(homeBox).not.toBeNull();

  await page.goto("/booking");
  const bookingBox = await page.getByRole("link", { name: "Open concierge chat" }).boundingBox();
  expect(bookingBox).not.toBeNull();

  expect(Math.abs(bookingBox!.x - homeBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(bookingBox!.y - homeBox!.y)).toBeLessThanOrEqual(1);
});

test("mobile chat page keeps the composer visible while typing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/chat");

  const chatFooter = page.getByTestId("chat-footer");
  const floatingContactActions = page.getByTestId("floating-contact-actions");
  const chatMessages = page.getByTestId("chat-messages");
  const input = page.getByPlaceholder("Ask a question");
  const whatsappLink = floatingContactActions.getByRole("link", { name: /Open WhatsApp chat/i });
  const lineLink = floatingContactActions.getByRole("link", { name: /Open LINE chat/i });
  const emailLink = floatingContactActions.getByRole("link", { name: /Email concierge/i });

  await expect(whatsappLink).toBeVisible();
  await expect(lineLink).toBeVisible();
  await expect(lineLink).toHaveAttribute("href", LINE_URL);
  await expect(emailLink).toBeVisible();
  await expectPrefilledWhatsApp(whatsappLink);
  await expectPrefilledEmail(emailLink);
  await expect(
    chatFooter.getByRole("link", { name: /Open WhatsApp chat/i }),
  ).toHaveCount(0);

  await input.focus();
  await input.fill("Hello from mobile");

  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(chatMessages).toHaveCSS("overflow-y", "auto");
  await expect(floatingContactActions).toBeHidden();
  await expect(chatFooter.getByText("Share contact details")).toBeHidden();

  const inputBox = await input.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(760);

  await input.blur();
  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(whatsappLink).toBeVisible();
  await expect(lineLink).toBeVisible();
  await expect(emailLink).toBeVisible();
});

test("desktop chat contact actions show LINE QR and use prefilled links", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/chat");

  const floatingContactActions = page.getByTestId("floating-contact-actions");
  const whatsappLink = floatingContactActions.getByRole("link", { name: /Open WhatsApp chat/i });
  const emailLink = floatingContactActions.getByRole("link", { name: /Email concierge/i });
  const lineButton = floatingContactActions.getByRole("button", { name: /Open LINE chat/i });

  await expect(whatsappLink).toBeVisible();
  await expectPrefilledWhatsApp(whatsappLink);
  await expect(emailLink).toBeVisible();
  await expectPrefilledEmail(emailLink);
  await expect(floatingContactActions.getByRole("link", { name: /Open LINE chat/i })).toHaveCount(0);
  await expect(lineButton).toBeVisible();

  await lineButton.click();
  const dialog = page.getByRole("dialog", { name: "Scan LINE QR code" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText("LINE QR code for contacting us")).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open LINE instead" })).toHaveAttribute(
    "href",
    LINE_URL,
  );
});

test("mobile Chrome keeps Thai contact details typable while the viewport resizes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await installMockVisualViewport(
    page,
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
  );
  await page.goto("/th/chat?continueInApp=1");

  const chatFooter = page.getByTestId("chat-footer");
  const emailInput = page.getByRole("textbox", { name: "อีเมล" });
  const chatInput = page.getByPlaceholder("พิมพ์คำถาม");

  await page.getByText("ฝากข้อมูลติดต่อ").click();
  await expect
    .poll(async () =>
      emailInput.evaluate((node) =>
        Number.parseFloat(window.getComputedStyle(node).fontSize),
      ),
    )
    .toBeGreaterThanOrEqual(16);
  await expect
    .poll(async () =>
      page
        .getByRole("textbox", { name: "ช่องทางติดต่อ" })
        .evaluate((node) => Number.parseFloat(window.getComputedStyle(node).fontSize)),
    )
    .toBeGreaterThanOrEqual(16);
  await emailInput.focus();
  await page.evaluate(() => {
    (
      window as unknown as {
        __setTestVisualViewportHeight: (height: number) => void;
      }
    ).__setTestVisualViewportHeight(500);
  });
  await emailInput.fill("visitor@example.com");

  await expect(page.getByTestId("chat-panel")).toHaveAttribute("data-keyboard-layout", "resizedViewport");
  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(page.getByText("ฝากข้อมูลติดต่อ")).toBeVisible();
  await expect(emailInput).toBeVisible();
  await expect(emailInput).toHaveValue("visitor@example.com");
  await expect(chatInput).toBeHidden();

  const emailBox = await emailInput.boundingBox();
  expect(emailBox).not.toBeNull();
  expect(emailBox!.y + emailBox!.height).toBeLessThanOrEqual(500);
});

test("instagram in-app browser shows the external browser chat gate", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 333.0.0.0.0 Android",
    });
  });

  await page.goto("/chat");

  const gate = page.getByTestId("chat-browser-gate");
  await expect(gate).toBeVisible();
  await expect(page.getByText("Opening chat in Chrome")).toBeVisible();
  await expect(page.getByTestId("chat-open-browser")).toHaveAttribute("data-browser-target", "chrome");
  await expect(page.getByTestId("chat-open-browser")).toHaveAttribute(
    "href",
    /intent:\/\/.*external=1.*package=com\.android\.chrome/,
  );
  await expect(page.getByTestId("chat-copy-browser-link")).toBeVisible();
  await expect(page.getByTestId("chat-continue-in-app")).toBeVisible();
});

test("LINE in-app browser shows the external browser chat gate", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1 Line/14.0.0",
    });
  });

  await page.goto("/chat");

  await expect(page.getByTestId("chat-browser-gate")).toBeVisible();
  await expect(page.getByText("Opening chat in Safari")).toBeVisible();
  await expect(page.getByTestId("chat-open-browser")).toHaveAttribute("data-browser-target", "safari");
  await expect(page.getByTestId("chat-open-browser")).toHaveAttribute(
    "href",
    /x-safari-https?:\/\/.*external=1/,
  );
});

test("external and continue-in-app flags bypass the in-app browser gate", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 333.0.0.0.0 Android",
    });
  });

  await page.goto("/chat?external=1");
  await expect(page.getByTestId("chat-browser-gate")).toHaveCount(0);
  await expect(page.getByPlaceholder("Ask a question")).toBeVisible();

  await page.goto("/chat?continueInApp=1");
  await expect(page.getByTestId("chat-browser-gate")).toHaveCount(0);
  await expect(page.getByPlaceholder("Ask a question")).toBeVisible();
});

test("instagram in-app browser lifts the composer when viewport inset is unavailable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 333.0.0.0.0 Android",
    });
  });
  await page.goto("/chat?continueInApp=1");

  const chatFooter = page.getByTestId("chat-footer");
  const input = page.getByPlaceholder("Ask a question");

  await input.focus();
  await input.fill("Hello from Instagram");

  await expect(chatFooter).toHaveCSS("position", "fixed");
  await expect
    .poll(async () =>
      chatFooter.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).bottom)),
    )
    .toBeGreaterThan(250);
  await expect
    .poll(async () =>
      chatFooter.evaluate((node) =>
        Number.parseFloat(window.getComputedStyle(node).getPropertyValue("--chat-keyboard-inset")),
      ),
    )
    .toBeGreaterThan(250);

  const inputBox = await input.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y + inputBox!.height).toBeLessThan(520);
});

test("instagram in-app browser keeps Thai contact details above the keyboard fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile Safari/537.36 Instagram 333.0.0.0.0 Android",
    });
  });
  await page.goto("/th/chat?continueInApp=1");

  const chatFooter = page.getByTestId("chat-footer");
  const emailInput = page.getByRole("textbox", { name: "อีเมล" });
  const chatInput = page.getByPlaceholder("พิมพ์คำถาม");

  await page.getByText("ฝากข้อมูลติดต่อ").click();
  await emailInput.focus();
  await emailInput.fill("visitor@example.com");

  await expect(chatFooter).toHaveCSS("position", "fixed");
  await expect
    .poll(async () =>
      chatFooter.evaluate((node) => Number.parseFloat(window.getComputedStyle(node).bottom)),
    )
    .toBeGreaterThan(250);
  await expect
    .poll(async () =>
      chatFooter.evaluate((node) =>
        Number.parseFloat(window.getComputedStyle(node).getPropertyValue("--chat-keyboard-inset")),
      ),
    )
    .toBeGreaterThan(250);
  await expect(page.getByText("ฝากข้อมูลติดต่อ")).toBeVisible();
  await expect(emailInput).toHaveValue("visitor@example.com");
  await expect(chatInput).toBeHidden();

  const emailBox = await emailInput.boundingBox();
  expect(emailBox).not.toBeNull();
  expect(emailBox!.y + emailBox!.height).toBeLessThan(520);
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
    const sessionId = `resized-keyboard-${browserCase.name.toLowerCase().replace(/\s+/g, "-")}`;
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
    await seedChatMessageCache(page, sessionId, seededMessages);
    await page.goto("/chat");

    const chatPanel = page.getByTestId("chat-panel");
    const chatFooter = page.getByTestId("chat-footer");
    const chatMessages = page.getByTestId("chat-messages");
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
    await expect(chatMessages).toHaveCSS("overflow-y", "auto");
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

    const metrics = await chatMessages.evaluate((node) => {
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

test("LINE/Safari resized viewport uses docked page layout instead of overlay fallback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await installMockVisualViewport(
    page,
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1 Line/14.0.0",
  );
  await page.goto("/chat?continueInApp=1");

  const chatPanel = page.getByTestId("chat-panel");
  const chatFooter = page.getByTestId("chat-footer");
  const chatMessages = page.getByTestId("chat-messages");
  const input = page.getByPlaceholder("Ask a question");

  await input.focus();
  await page.evaluate(() => {
    (
      window as unknown as {
        __setTestVisualViewportHeight: (height: number) => void;
      }
    ).__setTestVisualViewportHeight(500);
  });
  await input.fill("Hello from LINE");

  await expect(chatPanel).toHaveAttribute("data-keyboard-layout", "resizedViewport");
  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(chatMessages).toHaveCSS("overflow-y", "auto");
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

  const inputBox = await input.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(500);
});

test("unknown mobile browser with zero inset avoids synthetic overlay fallback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      get: () =>
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Mobile Safari/537.36",
    });
  });
  await page.goto("/chat?continueInApp=1");

  const chatFooter = page.getByTestId("chat-footer");
  const input = page.getByPlaceholder("Ask a question");

  await input.focus();
  await input.fill("Hello from a WebView");

  await expect(page.getByTestId("chat-panel")).toHaveAttribute("data-keyboard-layout", "none");
  await expect(chatFooter).toHaveCSS("position", "static");

  const inputBox = await input.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y).toBeGreaterThan(600);
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(760);
});

test("thai booking chat shows a prefilled booking handoff", async ({ page }) => {
  await page.goto("/th");

  await page.getByRole("button", { name: "เปิดแชตคอนเซียจ" }).click();
  await page
    .getByPlaceholder("พิมพ์คำถาม")
    .fill("Tideglass Pool Residence สำหรับ 4 คน 30 ตุลาคม ถึง 3 พฤศจิกายน จองเลยครับ");
  await page.getByRole("button", { name: "ส่งข้อความ" }).click();

  const bookingCard = page.getByTestId("chat-booking-card");
  await expect(bookingCard).toBeVisible();
  await expect(bookingCard.getByTestId("chat-booking-check-in")).toHaveAttribute(
    "data-selected-date",
    "2026-10-30",
  );
  await expect(bookingCard.getByTestId("chat-booking-check-out")).toHaveAttribute(
    "data-selected-date",
    "2026-11-03",
  );
  await expect(bookingCard.getByTestId("chat-villa-option-pool-villa")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(bookingCard.getByText(/เลือกแล้ว:/)).toHaveCount(0);
  await expect(bookingCard.getByTestId("chat-villa-swipe-hint")).toContainText("เลื่อนดูวิลล่า");

  await bookingCard.getByRole("button", { name: "จอง" }).click();
  await expect(page).toHaveURL((url) => {
    expect(url.pathname).toBe("/th/booking");
    expect(url.searchParams.get("checkin")).toBe("2026-10-30");
    expect(url.searchParams.get("checkout")).toBe("2026-11-03");
    expect(url.searchParams.get("unit")).toBe("pool-villa");
    expect(url.searchParams.get("guests")).toBe("4");
    return true;
  });
});

test("thai booking prompt asks only for missing fields and shows villa cards", async ({ page }) => {
  await page.goto("/th");

  await page.getByRole("button", { name: "เปิดแชตคอนเซียจ" }).click();
  await page.getByPlaceholder("พิมพ์คำถาม").fill("จองวันที่ 12 เดือนหน้า");
  await page.getByRole("button", { name: "ส่งข้อความ" }).click();

  const bookingCard = page.getByTestId("chat-booking-card");
  await expect(page.getByText(/เลือกวิลล่า วันที่เช็กอิน และเช็กเอาต์/)).toBeVisible();
  await expect(bookingCard).toBeVisible();
  await expect(bookingCard.getByTestId("chat-villa-selector")).toBeVisible();
  await expect(bookingCard.getByTestId("chat-villa-swipe-hint")).toContainText("เลื่อนดูวิลล่า");
  await expect(bookingCard.getByTestId("chat-villa-option-pool-villa")).toBeVisible();
  await expect(bookingCard.getByTestId("chat-villa-option-garden-suite")).toBeVisible();
  await expect(bookingCard.getByTestId("chat-villa-option-penthouse")).toBeVisible();
});

test("thai availability suggestion shows the booking card and keeps it attached", async ({ page }) => {
  await page.goto("/th");

  await page.getByRole("button", { name: "เปิดแชตคอนเซียจ" }).click();
  await page.getByRole("button", { name: "เช็กวันที่ที่ต้องการได้ไหม?" }).click();

  const bookingCard = page.getByTestId("chat-booking-card");
  await expect(bookingCard).toBeVisible();
  await expect(page.getByTestId("chat-tour-card")).toHaveCount(0);
  await expect(page.getByText(/เลือกวิลล่า วันเช็กอิน และวันเช็กเอาต์/)).toBeVisible();
  await expect(bookingCard.getByTestId("chat-villa-selector")).toBeVisible();
  await expect(bookingCard.getByTestId("chat-booking-check-in")).toBeVisible();
  await expect(bookingCard.getByTestId("chat-booking-check-out")).toBeVisible();
  await expect(bookingCard.getByRole("button", { name: "จอง" })).toBeVisible();

  await page.getByPlaceholder("พิมพ์คำถาม").fill("ขอข้อมูลเพิ่มเติม");
  await page.getByRole("button", { name: "ส่งข้อความ" }).click();

  await expect(page.getByText("ขอข้อมูลเพิ่มเติม")).toBeVisible();
  await expect(page.getByTestId("chat-booking-card")).toHaveCount(1);
  await expect(bookingCard).toBeVisible();
});

test("thai 360 chat shows a distinct villa tour card with detail links", async ({ page }) => {
  await page.goto("/th");

  await page.getByRole("button", { name: "เปิดแชตคอนเซียจ" }).click();
  await page.getByRole("button", { name: "ดูวิลล่าแบบ 360° ได้ไหม?" }).click();

  const tourCard = page.getByTestId("chat-tour-card");
  await expect(tourCard).toBeVisible();
  await expect(page.getByTestId("chat-booking-card")).toHaveCount(0);
  await expect(tourCard.getByTestId("chat-booking-check-in")).toHaveCount(0);
  await expect(tourCard.getByTestId("chat-booking-check-out")).toHaveCount(0);
  await expect(tourCard.getByRole("button", { name: "จอง" })).toHaveCount(0);
  await expectVillaTileImageVisible(tourCard.getByTestId("chat-tour-villa-option-pool-villa"));

  const gardenTourOption = tourCard.getByTestId("chat-tour-villa-option-garden-suite");
  await page.waitForTimeout(1000);
  await gardenTourOption.click();
  await page.waitForTimeout(250);
  await expect(page).toHaveURL(
    (url) => url.pathname === "/th/rooms/garden-suite" && url.search === "",
  );
});

test("chat action cards stay attached after a newer message", async ({ page }) => {
  await page.goto("/th");

  await page.getByRole("button", { name: "เปิดแชตคอนเซียจ" }).click();
  await page.getByRole("button", { name: "ดูวิลล่าแบบ 360° ได้ไหม?" }).click();
  await expect(page.getByTestId("chat-tour-card")).toBeVisible();

  await page.getByPlaceholder("พิมพ์คำถาม").fill("ขอข้อมูลเพิ่มเติม");
  await page.getByRole("button", { name: "ส่งข้อความ" }).click();

  await expect(page.getByText("ขอข้อมูลเพิ่มเติม")).toBeVisible();
  await expect(page.getByTestId("chat-tour-card")).toHaveCount(1);
  await expect(page.getByTestId("chat-tour-card")).toBeVisible();
});

test("english booking chat lets visitors choose a missing villa before booking", async ({ page }) => {
  const checkIn = "2026-10-30";
  const checkOut = "2026-11-03";
  await page.goto("/");

  await page.getByRole("button", { name: "Open concierge chat" }).click({ force: true });
  await page.getByPlaceholder("Ask a question").fill("I want to book 30 October to 3 November");
  await page.getByRole("button", { name: "Send message" }).click();

  const bookingCard = page.getByTestId("chat-booking-card");
  await expect(bookingCard).toBeVisible();
  await expect(bookingCard.getByTestId("chat-booking-check-in")).toHaveAttribute(
    "data-selected-date",
    checkIn,
  );
  await expect(bookingCard.getByTestId("chat-booking-check-out")).toHaveAttribute(
    "data-selected-date",
    checkOut,
  );

  await bookingCard.getByRole("button", { name: "Book" }).click();
  await expect(bookingCard.getByRole("alert")).toContainText("Choose a villa");

  await bookingCard.getByTestId("chat-villa-option-garden-suite").click();
  await expect(bookingCard.getByTestId("chat-villa-option-garden-suite")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await bookingCard.getByRole("button", { name: "Book" }).click();
  await expect(page).toHaveURL((url) => {
    expect(url.pathname).toBe("/booking");
    expect(url.searchParams.get("checkin")).toBe(checkIn);
    expect(url.searchParams.get("checkout")).toBe(checkOut);
    expect(url.searchParams.get("unit")).toBe("garden-suite");
    return true;
  });
});

test("mobile booking calendars open cleanly from the chat card", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");

  await page.getByRole("link", { name: "Open concierge chat" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/chat");
  await page.getByPlaceholder("Ask a question").fill("I want to book a villa");
  await page.getByRole("button", { name: "Send message" }).click();

  const bookingCard = page.getByTestId("chat-booking-card");
  const chatFooter = page.getByTestId("chat-footer");
  const floatingContactActions = page.getByTestId("floating-contact-actions");
  const input = page.getByPlaceholder("Ask a question");
  await expect(bookingCard).toBeVisible();
  await input.focus();
  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(input).toBeVisible();
  await expect(floatingContactActions).toBeHidden();
  await expect(
    chatFooter.getByRole("link", { name: /Open WhatsApp chat/i }),
  ).toHaveCount(0);

  const poolCard = bookingCard.getByTestId("chat-villa-option-pool-villa");
  await expectVillaTileImageVisible(poolCard);
  const guestBadge = poolCard.getByText(/Up to 4 guests/);
  const price = bookingCard.getByTestId("chat-villa-price-pool-villa");
  const guestBox = await guestBadge.boundingBox();
  const priceBox = await price.boundingBox();
  expect(guestBox).not.toBeNull();
  expect(priceBox).not.toBeNull();
  expect(priceBox!.y).toBeGreaterThan(guestBox!.y + 8);

  await openCalendarPopover(page, bookingCard.getByTestId("chat-booking-check-in"));
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkIn")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkOut")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("grid")).toHaveCount(0);

  await openCalendarPopover(page, bookingCard.getByTestId("chat-booking-check-out"));
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkIn")).toBeVisible();
  await expect(page.getByTestId("booking-range-checkOut")).toBeVisible();
});

test("thai chat initializes with six question chips before regular chat", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/th/chat?returnTo=%2Fth");

  const chatMessages = page.getByTestId("chat-messages");
  const chatFooter = page.getByTestId("chat-footer");
  const initialPromptGroup = chatMessages.getByTestId("chat-initial-prompts");
  const initialSuggestions = chatMessages.getByTestId("chat-suggestions");
  await expect(chatMessages.getByText("ฉันช่วยเลือกวิลล่าที่เหมาะสม")).toHaveCount(0);
  await expect(initialPromptGroup.getByText("ถามได้เลย")).toBeVisible();
  await expect(initialSuggestions.getByRole("button")).toHaveCount(6);
  await expect(initialSuggestions).toHaveCSS("justify-content", "center");
  await expect(initialSuggestions.getByRole("button", { name: "เช็กวันที่ที่ต้องการได้ไหม?" })).toBeVisible();
  await expect(initialSuggestions.getByRole("button", { name: "พักทั้งหมดประมาณเท่าไหร่?" })).toBeVisible();
  await expect(initialSuggestions.getByRole("button", { name: "แต่ละวิลล่าพักได้กี่คน?" })).toBeVisible();
  await expect(
    initialSuggestions.getByRole("button", { name: "ติดต่อเจ้าของที่พักได้ทางไหน?" }),
  ).toBeVisible();
  const firstInitialChipBox = await initialSuggestions
    .getByRole("button", { name: "เช็กวันที่ที่ต้องการได้ไหม?" })
    .boundingBox();
  expect(firstInitialChipBox).not.toBeNull();
  expect(firstInitialChipBox!.height).toBeGreaterThanOrEqual(44);

  await initialSuggestions.getByRole("button", { name: "แต่ละวิลล่าพักได้กี่คน?" }).click();
  await expect(chatMessages.getByText("แต่ละวิลล่าพักได้กี่คน?")).toBeVisible();
  await expect(chatMessages.getByText(/Tideglass Pool Residence พักได้สูงสุด 4 คน/)).toBeVisible();
  await expect(chatMessages.getByTestId("chat-suggestions").getByRole("button")).toHaveCount(2);
  await expect(
    chatMessages.getByRole("button", { name: "วิลล่าไหนเหมาะกับครอบครัวหรือกลุ่ม?" }),
  ).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: "เช็กวันที่ที่ต้องการได้ไหม?" }),
  ).toBeVisible();
  await expect(chatFooter.getByRole("button", { name: "วิลล่าไหนเหมาะกับครอบครัวหรือกลุ่ม?" })).toHaveCount(0);
});

test("german chat suggestions float under assistant messages and update", async ({ page }) => {
  await page.goto("/de");

  await page.getByRole("button", { name: "Concierge-Chat öffnen" }).click({ force: true });
  const chatMessages = page.getByTestId("chat-messages");
  const chatFooter = page.getByTestId("chat-footer");

  await expect(
    chatMessages.getByRole("button", { name: "Kann ich meine Reisedaten prüfen?" }),
  ).toBeVisible();
  await expect(
    chatFooter.getByRole("button", { name: "Kann ich meine Reisedaten prüfen?" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Welche Vorteile habe ich bei Direktbuchung?" }).click();
  await expect(page.getByText(/Direktbuchung spart etwa 15%/i)).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: "Was kostet mein Aufenthalt?" }),
  ).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: "Kann ich meine Reisedaten prüfen?" }),
  ).toBeVisible();
});

test("all visible translated locales render localized nav and chat UI", async ({ page }) => {
  for (const locale of localizedSmoke) {
    await page.goto(locale.path);

    await expect(page.getByRole("link", { name: locale.nav }).first()).toBeVisible();
    await page.getByRole("button", { name: locale.chat }).click();
    await expect(page.getByPlaceholder(locale.placeholder)).toBeVisible();
    await page.getByRole("button", { name: locale.close, exact: true }).click();
  }
});

test("language switcher preserves equivalent public routes", async ({ page }) => {
  await page.goto("/rooms/garden-suite");

  await chooseLanguage(page, "ไทย TH");
  await expect(page).toHaveURL(/\/th\/rooms\/garden-suite/);
  await expect(page.getByRole("link", { name: "วิลล่าของเรา" })).toBeVisible();
});

test("language switcher preserves query strings and hash anchors", async ({ page }) => {
  await page.goto("/th/booking?unit=garden-suite&nights=2#villas");

  await chooseLanguage(page, "English EN");
  await expect(page).toHaveURL((url) => {
    expect(url.pathname).toBe("/booking");
    expect(url.searchParams.get("unit")).toBe("garden-suite");
    expect(url.searchParams.get("nights")).toBe("2");
    expect(url.hash).toBe("#villas");
    return true;
  });
});

test("language switcher preserves dark theme preference", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("theme", "dark");
  });
  await page.goto("/ko");

  await expect
    .poll(() => page.evaluate(() => document.documentElement?.classList.contains("dark") ?? false))
    .toBe(true);
  const beforeBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await chooseLanguage(page, "English EN");
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => document.documentElement?.classList.contains("dark") ?? false))
    .toBe(true);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(beforeBackground);
});

test("mobile language switcher stays compact while opening full options", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 360 });
  await page.goto("/th");

  const language = page.getByTestId("language-switcher").filter({ hasText: /^TH$/ });
  await expect(language).toHaveText("TH");
  const box = await language.boundingBox();
  expect(box?.width).toBeLessThan(90);

  await language.click();
  await expect(page.getByRole("link", { name: "ไทย TH" })).toBeVisible();
  const menuBox = await page.getByTestId("language-menu").boundingBox();
  expect(menuBox?.height).toBeLessThan(240);
});

test("locale routing handles canonical English, removed Arabic, and sampled deep links", async ({ page }) => {
  await page.goto("/en");
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/ar");
  await expect(page.getByText("This page could not be found")).toBeVisible();
  await page.getByLabel("Language").first().click();
  await expect(page.getByRole("link", { name: "العربية AR" })).toHaveCount(0);

  await page.goto("/zh-CN/booking");
  await expect(page.getByRole("heading", { name: "预订您的别墅" })).toBeVisible();

  await page.goto("/ja/rooms/garden-suite");
  await expect(page.getByRole("link", { name: "ヴィラ一覧" })).toBeVisible();

  await page.goto("/hi/booking/pay?bookingId=demo");
  await expect(page.getByRole("heading", { name: "डेमो भुगतान पुष्टि करें" })).toBeVisible();
});
