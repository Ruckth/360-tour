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

test("home page opens chat, shows fallback replies, and exposes contact capture", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Seaview Residence").first()).toBeVisible();
  await page.getByRole("button", { name: "Open concierge chat" }).click({ force: true });

  await expect(page.getByRole("button", { name: /Restart chat/i })).toBeVisible();
  await expect(page.getByText("Share contact details")).toBeVisible();
  const chatMessages = page.getByTestId("chat-messages");
  const chatFooter = page.getByTestId("chat-footer");

  await expect(
    chatMessages.getByRole("button", { name: /Which villa is best for a couple/i }),
  ).toBeVisible();
  await expect(
    chatFooter.getByRole("button", { name: /Which villa is best for a couple/i }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: /Which villa is best for a couple/i }).click();
  await expect(page.getByText(/The Garden Suite is the quietest couples/i)).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: /What's included when booking direct/i }),
  ).toBeVisible();
  await expect(chatMessages.getByRole("button", { name: /Can I see the villa in 360/i })).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: /Which villa is best for a couple/i }),
  ).toHaveCount(0);

  await page.getByPlaceholder("Ask a question").fill("What's included when booking direct?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Direct booking saves around 15%/i)).toBeVisible();
  await expect(page.getByTestId("chat-booking-card")).toBeVisible();
  await expect(chatMessages.getByRole("button", { name: /Can I see the villa in 360/i })).toHaveCount(0);
  await expect(
    chatMessages.getByRole("button", { name: /Which villa is best for a couple/i }),
  ).toHaveCount(0);

  await page.getByPlaceholder("Ask a question").fill("Do you have airport pickup?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Do you have airport pickup?")).toBeVisible();
  await expect(
    page.getByText(
      /live chat will connect once Convex is configured|Welcome to Seaview Residence|trouble connecting/i,
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: /Restart chat/i }).click();
  await expect(page.getByText("Do you have airport pickup?")).toHaveCount(0);
  await expect(page.getByText(/I can help pick the right villa/i)).toBeVisible();

  await page.getByText("Share contact details").click();
  await page.getByLabel("Email").fill("visitor@example.com");
  await page.getByLabel("Preferred app").click();
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
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.getByRole("button", { name: /Restart chat/i })).toBeVisible();
  await expect(page.getByPlaceholder("Ask a question")).toBeVisible();
});

test("localized mobile chat trigger keeps the locale on the chat page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/th");

  await page.getByRole("link", { name: "เปิดแชตคอนเซียจ" }).click();
  await expect(page).toHaveURL(/\/th\/chat$/);
  await expect(page.getByPlaceholder("พิมพ์คำถาม")).toBeVisible();
});

test("mobile chat page keeps the composer visible while typing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/chat");

  const chatFooter = page.getByTestId("chat-footer");
  const chatMessages = page.getByTestId("chat-messages");
  const input = page.getByPlaceholder("Ask a question");

  await input.focus();
  await input.fill("Hello from mobile");

  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(chatMessages).toHaveCSS("overflow-y", "auto");
  await expect(chatFooter.getByRole("link", { name: "WhatsApp" })).toBeHidden();
  await expect(chatFooter.getByText("Share contact details")).toBeHidden();

  const inputBox = await input.boundingBox();
  expect(inputBox).not.toBeNull();
  expect(inputBox!.y + inputBox!.height).toBeLessThanOrEqual(760);

  await input.blur();
  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(chatFooter.getByRole("link", { name: "WhatsApp" })).toBeVisible();
});

test("thai booking chat shows a prefilled booking handoff", async ({ page }) => {
  await page.goto("/th");

  await page.getByRole("button", { name: "เปิดแชตคอนเซียจ" }).click();
  await page
    .getByPlaceholder("พิมพ์คำถาม")
    .fill("Pool Villa สำหรับ 4 คน 30 ตุลาคม ถึง 3 พฤศจิกายน จองเลยครับ");
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
  await expect(page).toHaveURL(/\/chat$/);
  await page.getByPlaceholder("Ask a question").fill("I want to book a villa");
  await page.getByRole("button", { name: "Send message" }).click();

  const bookingCard = page.getByTestId("chat-booking-card");
  const chatFooter = page.getByTestId("chat-footer");
  const input = page.getByPlaceholder("Ask a question");
  await expect(bookingCard).toBeVisible();
  await input.focus();
  await expect(chatFooter).toHaveCSS("position", "static");
  await expect(input).toBeVisible();
  await expect(chatFooter.getByRole("link", { name: "WhatsApp" })).toBeHidden();

  const poolCard = bookingCard.getByTestId("chat-villa-option-pool-villa");
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

test("german chat suggestions float under assistant messages and update", async ({ page }) => {
  await page.goto("/de");

  await page.getByRole("button", { name: "Concierge-Chat öffnen" }).click({ force: true });
  const chatMessages = page.getByTestId("chat-messages");
  const chatFooter = page.getByTestId("chat-footer");

  await expect(
    chatMessages.getByRole("button", { name: "Welche Villa ist am besten für ein Paar?" }),
  ).toBeVisible();
  await expect(
    chatFooter.getByRole("button", { name: "Welche Villa ist am besten für ein Paar?" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Welche Villa ist am besten für ein Paar?" }).click();
  await expect(page.getByText(/Garden Suite ist der ruhigste Rückzugsort/i)).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: "Was ist bei Direktbuchung enthalten?" }),
  ).toBeVisible();
  await expect(
    chatMessages.getByRole("button", { name: "Kann ich die Villa in 360° sehen?" }),
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
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
    .toBe(true);
  const beforeBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await chooseLanguage(page, "English EN");
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
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
