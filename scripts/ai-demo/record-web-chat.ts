/**
 * Records the public website concierge chat on a live site as a guest.
 *   node scripts/ai-demo/record-web-chat.ts <name> [desktop|mobile] [baseUrl]
 * Questions come from scripts/ai-demo/scenarios.json (key = <name>).
 * Writes docs/ai-demo/raw/<name>.webm and docs/ai-demo/transcripts/<name>.json.
 */
import { chromium, devices, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [name = "chat", device = "desktop", baseUrl = "https://tour.helpgueststay.com"] = process.argv.slice(2);
const scenarios = JSON.parse(readFileSync(join(import.meta.dirname, "scenarios.json"), "utf8"));
const questions: string[] = scenarios[name];
if (!questions) throw new Error(`Unknown scenario ${name}`);

const outDir = join(import.meta.dirname, "../../docs/ai-demo");
const tag = device === "mobile" ? `${name}-mobile` : name;
mkdirSync(join(outDir, "raw"), { recursive: true });
mkdirSync(join(outDir, "transcripts"), { recursive: true });

const mobile = device === "mobile";
const size = mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 };
const browser = await chromium.launch();
const context = await browser.newContext({
  ...(mobile ? devices["iPhone 13"] : {}),
  viewport: size,
  recordVideo: { dir: join(outDir, "raw", `${tag}-tmp`), size },
  locale: "en-US",
  timezoneId: "Asia/Bangkok",
});
const page = await context.newPage();

async function dismissBanners(p: Page) {
  for (const label of [/^i understand/i, /^accept/i, /^decline/i, /^reject/i, /^got it/i]) {
    const button = p.getByRole("button", { name: label }).first();
    if (await button.isVisible().catch(() => false)) await button.click().catch(() => null);
  }
}

await page.goto(mobile ? `${baseUrl}/chat` : baseUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await dismissBanners(page);
if (!mobile) {
  await page.getByRole("button", { name: "Open concierge chat" }).click();
}
const input = page.getByRole("textbox", { name: "Ask a question" });
await input.waitFor({ state: "visible", timeout: 20_000 });
await page.waitForTimeout(1500);

const transcript: Array<{ guest: string; reply: string; latencyMs: number }> = [];
const messages = page.getByTestId("chat-messages");
for (const question of questions) {
  await input.click();
  await input.pressSequentially(question, { delay: mobile ? 35 : 45 });
  await page.waitForTimeout(500);
  const started = Date.now();
  await input.press("Enter");
  const loading = messages.getByRole("status");
  await loading.waitFor({ state: "visible", timeout: 5_000 }).catch(() => null);
  await loading.waitFor({ state: "detached", timeout: 90_000 });
  const latencyMs = Date.now() - started;
  await page.waitForTimeout(400);
  const bubble = messages.locator("div.rounded-2xl.bg-muted").last();
  const reply = (await bubble.innerText()).trim();
  await page.waitForTimeout(1200);
  // The widget auto-scrolls to cards/chips below the reply; bring the reply text back into view.
  await bubble.evaluate((el) => el.scrollIntoView({ block: "start", behavior: "smooth" }));
  transcript.push({ guest: question, reply, latencyMs });
  console.log(`\n> ${question}\n< (${latencyMs}ms) ${reply}`);
  // Reading pause scaled to reply length.
  await page.waitForTimeout(Math.min(9000, 2500 + reply.length * 18));
}
await page.waitForTimeout(1500);

const video = page.video();
await context.close();
await browser.close();
const videoPath = await video?.path();
if (videoPath) renameSync(videoPath, join(outDir, "raw", `${tag}.webm`));
writeFileSync(join(outDir, "transcripts", `${tag}.json`), JSON.stringify({ name, device, baseUrl, recordedAt: new Date().toISOString(), transcript }, null, 2));
