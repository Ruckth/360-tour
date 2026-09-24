/**
 * Records AI booking conversations over the messaging-channel pipeline (the same
 * generateConciergeReply + booking tools used by the LINE/WhatsApp/Messenger webhooks).
 * Each guest turn runs `npx convex run [--prod] chatEval:messagingTurn` and the reply, plus
 * the tools the AI called, is rendered in a local chat page that Playwright records.
 *
 *   node scripts/ai-demo/record-messaging.ts <scenario> [--prod]
 * Scenarios live in scripts/ai-demo/messaging-scenarios.json.
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [name = "room-booking", ...flags] = process.argv.slice(2);
const prod = flags.includes("--prod");
const siteUrl = "https://tour.helpgueststay.com";
type Scenario = { title: string; channel: "line" | "facebook" | "whatsapp"; visitorName?: string; visitorPhone?: string; turns: string[] };
const scenario: Scenario = JSON.parse(readFileSync(join(import.meta.dirname, "messaging-scenarios.json"), "utf8"))[name];
if (!scenario) throw new Error(`Unknown scenario ${name}`);

const outDir = join(import.meta.dirname, "../../docs/ai-demo");
mkdirSync(join(outDir, "raw"), { recursive: true });
mkdirSync(join(outDir, "transcripts"), { recursive: true });

function convexRun<T>(fn: string, args: unknown): T {
  const out = execFileSync("npx", ["convex", "run", ...(prod ? ["--prod"] : []), fn, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
  });
  return JSON.parse(out) as T;
}

const sessionId = convexRun<string>("chatEval:createSession", {
  channel: scenario.channel,
  ...(scenario.visitorName ? { visitorName: scenario.visitorName } : {}),
  ...(scenario.visitorPhone ? { visitorPhone: scenario.visitorPhone } : {}),
});
console.log(`session ${sessionId} (${prod ? "prod" : "dev"})`);

const channelLabel = { line: "LINE", facebook: "Messenger", whatsapp: "WhatsApp" }[scenario.channel];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box} body{margin:0;font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;background:#e9edf2;height:100vh;display:flex}
.side{width:380px;padding:36px 32px;background:#1c2536;color:#e8ecf3}
.side h1{font-size:22px;margin:0 0 8px} .side p{font-size:14px;line-height:1.5;color:#b7c0cf}
.side .pill{display:inline-block;background:#06c755;color:#fff;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600}
.phone{flex:1;display:flex;flex-direction:column;max-width:900px}
.top{background:#fff;padding:14px 22px;border-bottom:1px solid #d9dee6;font-weight:600;display:flex;gap:10px;align-items:center}
.top small{font-weight:400;color:#6b7686}
#log{flex:1;overflow-y:auto;padding:22px 26px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}
.msg{max-width:70%;padding:10px 14px;border-radius:16px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.guest{align-self:flex-end;background:#06c755;color:#fff;border-bottom-right-radius:4px}
.ai{align-self:flex-start;background:#fff;color:#1b2330;border-bottom-left-radius:4px;box-shadow:0 1px 2px rgba(0,0,0,.08)}
.tools{align-self:flex-start;display:flex;flex-wrap:wrap;gap:6px;max-width:80%}
.tool{font:12px ui-monospace,Menlo,monospace;background:#fff7e6;border:1px solid #f0d49b;color:#7a5200;border-radius:6px;padding:3px 7px}
.tool.err{background:#fdecec;border-color:#f3b4b4;color:#9b1c1c}
.meta{align-self:flex-start;font-size:11px;color:#8a94a3;margin-top:-6px}
.typing{align-self:flex-start;color:#6b7686;font-size:14px;font-style:italic}
.composer{display:flex;gap:10px;padding:14px 20px;background:#fff;border-top:1px solid #d9dee6}
#input{flex:1;font-size:15px;padding:11px 14px;border:1px solid #cfd6e0;border-radius:22px;outline:none}
button{background:#06c755;color:#fff;border:0;border-radius:22px;padding:0 20px;font-weight:600}
</style></head><body>
<div class="side"><span class="pill">${channelLabel} channel simulation</span><h1>${scenario.title}</h1>
<p>Live AI concierge on the production backend (Auralis Cove demo). Each guest message runs the same AI + booking-tool pipeline the ${channelLabel} webhook uses. Yellow chips show the tools the AI called; red chips are tool errors returned to the AI.</p>
<p>Guest: AI-EVAL Test Guest (test data).</p></div>
<div class="phone"><div class="top">Auralis Cove Concierge <small>AI assistant</small></div><div id="log"></div>
<div class="composer"><input id="input" placeholder="Type a message"><button>Send</button></div></div>
</body></html>`;

const size = { width: 1280, height: 800 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: size, recordVideo: { dir: join(outDir, "raw", `${name}-tmp`), size } });
const page = await context.newPage();
await page.setContent(html);
await page.waitForTimeout(1500);

type Trace = { name: string; args: Record<string, unknown>; result: string };
const transcript: Array<{ guest: string; reply: string; model: string; latencyMs: number; tools: Trace[] }> = [];
const input = page.locator("#input");
for (const turn of scenario.turns) {
  await input.click();
  await input.pressSequentially(turn, { delay: 40 });
  await page.waitForTimeout(400);
  await page.evaluate((text) => {
    const log = document.getElementById("log")!;
    const el = document.createElement("div");
    el.className = "msg guest";
    el.textContent = text;
    log.append(el);
    const typing = document.createElement("div");
    typing.className = "typing";
    typing.id = "typing";
    typing.textContent = "Concierge is typing…";
    log.append(typing);
    (document.getElementById("input") as HTMLInputElement).value = "";
    log.scrollTop = log.scrollHeight;
  }, turn);
  const started = Date.now();
  let result: { response: string; model: string; toolTrace: Trace[] };
  try {
    result = convexRun("chatEval:messagingTurn", { sessionId, userMessage: turn, siteUrl });
  } catch (error) {
    result = { response: `[harness error] ${(error as Error).message.slice(0, 300)}`, model: "error", toolTrace: [] };
  }
  const latencyMs = Date.now() - started;
  transcript.push({ guest: turn, reply: result.response, model: result.model, latencyMs, tools: result.toolTrace });
  console.log(`\n> ${turn}\n  tools: ${result.toolTrace.map((t) => `${t.name}${t.result.startsWith("Error") || t.result.includes('"error"') ? "(ERR)" : ""}`).join(", ") || "-"}\n< (${latencyMs}ms) ${result.response}`);
  await page.evaluate(({ reply, tools, latencyMs }) => {
    document.getElementById("typing")?.remove();
    const log = document.getElementById("log")!;
    if (tools.length) {
      const row = document.createElement("div");
      row.className = "tools";
      for (const tool of tools) {
        const chip = document.createElement("span");
        const failed = tool.result.startsWith("Error") || tool.result.includes('"error"');
        chip.className = failed ? "tool err" : "tool";
        chip.textContent = `${tool.name}(${Object.entries(tool.args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")})${failed ? " → error" : ""}`;
        row.append(chip);
      }
      log.append(row);
    }
    const el = document.createElement("div");
    el.className = "msg ai";
    el.textContent = reply;
    log.append(el);
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `replied in ${(latencyMs / 1000).toFixed(1)}s (includes CLI round-trip)`;
    log.append(meta);
    log.scrollTop = log.scrollHeight;
  }, { reply: result.response, tools: result.toolTrace, latencyMs });
  await page.waitForTimeout(Math.min(10_000, 3000 + result.response.length * 20));
}
await page.waitForTimeout(2000);

const video = page.video();
await context.close();
await browser.close();
const videoPath = await video?.path();
if (videoPath) renameSync(videoPath, join(outDir, "raw", `${name}.webm`));
writeFileSync(
  join(outDir, "transcripts", `${name}.json`),
  JSON.stringify({ name, sessionId, prod, channel: scenario.channel, recordedAt: new Date().toISOString(), transcript }, null, 2),
);
