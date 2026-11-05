import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { args, json, root, str } from "./common.ts";
import { DEVICES, SCREENS } from "./config.ts";
import { preparePage, session, settle } from "./session.ts";
import type { Manifest } from "./types.ts";
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
async function imageData(file: string) {
  return "data:image/png;base64," + (await readFile(file)).toString("base64");
}
if (import.meta.main) {
  const { values: v, positionals } = args({ state: "string" }),
    section = str(v.section, "1-daily"),
    screen = str(v.screen, "chats");
  if (positionals[0] === "strip") {
    if (v.base === undefined || v.current === undefined)
      throw new Error("--base and --current are required");
    const base = str(v.base),
      current = str(v.current),
      dir = path.resolve("output/ui-loop", section, "strips");
    await mkdir(dir, { recursive: true });
    const columns: string[] = [];
    for (const d of DEVICES.filter((d) => d.judged)) {
      const cells: string[] = [];
      for (const r of [base, current]) {
        const source = root(section, r),
          manifest = await json<Manifest>(path.join(source, "manifest.json"));
        const record = manifest.captures.find(
          (c) =>
            c.screen === screen &&
            c.device === d.id &&
            c.state === "default" &&
            !c.error,
        );
        if (!record?.files.length)
          throw new Error(`Missing ${screen} ${d.id} default in ${source}`);
        cells.push(
          `<figure><figcaption>${r === base ? "Baseline" : "Current"} · ${escape(d.id)} · r${escape(r)}</figcaption><img src="${await imageData(path.join(source, record.files[0]))}"></figure>`,
        );
      }
      columns.push(`<section>${cells.join("")}</section>`);
    }
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({
        viewport: { width: 2000, height: 1600 },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<!doctype html><style>body{margin:24px;background:#eef0f3;font:18px system-ui}h1{font-size:24px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}figure{margin:0 0 24px}figcaption{padding:12px;background:white}img{width:100%;height:660px;object-fit:contain;object-position:top;background:#ddd}</style><h1>${escape(screen)}</h1><main>${columns.join("")}</main>`,
      );
      await page.evaluate(() =>
        Promise.all(Array.from(document.images).map((i) => i.decode())),
      );
      await page.screenshot({
        path: path.join(dir, `${screen}-r${base}-vs-r${current}.png`),
      });
    } finally {
      await browser.close();
    }
  } else if (positionals[0] === "callouts") {
    const d = DEVICES.find((d) => d.id === str(v.device, "ipad-l")),
      s = SCREENS.find((s) => s.id === screen);
    if (!d || !s) throw new Error("Unknown screen/device");
    const notes = await json<
      { selector: string; label: string; text: string }[]
    >(str(v.notes));
    if (!Array.isArray(notes) || !notes.length)
      throw new Error("Notes must be a nonempty JSON array");
    const state = s.states.find((st) => st.id === str(v.state, "default"));
    if (!state || (state.applies && !state.applies(d)))
      throw new Error("State does not apply to device");
    const active = await session();
    try {
      const { context } = await active.context(
        d,
        state.id === "dark" ? "dark" : "light",
      );
      try {
        const { page } = await preparePage(context, d);
        const route =
          typeof s.path === "string" ? s.path : await s.path(page, active.base);
        await page.goto(active.base + route);
        await settle(page);
        await state.recipe(page, d);
        await settle(page);
        const boxes = [];
        for (const n of notes) {
          const box = await page.locator(n.selector).first().boundingBox();
          if (!box)
            throw new Error(`Selector has no visible box: ${n.selector}`);
          boxes.push({ ...n, box });
        }
        await page.evaluate((boxes) => {
          boxes.forEach((n, i) => {
            const el = document.createElement("div");
            Object.assign(el.style, {
              position: "fixed",
              left: n.box.x + "px",
              top: n.box.y + "px",
              width: n.box.width + "px",
              height: n.box.height + "px",
              outline: "3px solid #e11d48",
              zIndex: "2147483646",
              pointerEvents: "none",
            });
            const label = document.createElement("span");
            label.textContent = String(i + 1);
            Object.assign(label.style, {
              position: "absolute",
              top: "0",
              left: "0",
              background: "#e11d48",
              color: "white",
              font: "bold 16px system-ui",
              padding: "2px 6px",
            });
            el.append(label);
            document.body.append(el);
          });
        }, boxes);
        const screenshot = await page.screenshot();
        const compose = await active.browser.newPage({
          viewport: {
            width: d.width,
            height: d.height + Math.max(140, notes.length * 75),
          },
          deviceScaleFactor: d.deviceScaleFactor,
        });
        try {
          await compose.setContent(
            `<!doctype html><style>body{margin:0;background:#fff;color:#172033;font:14px system-ui}img{display:block;width:100%}ol{padding:16px 16px 16px 36px}li{margin-bottom:12px;overflow-wrap:anywhere}</style><img src="data:image/png;base64,${screenshot.toString("base64")}"><ol>${notes.map((n) => `<li><b>${escape(n.label)}</b> ${escape(n.text)}</li>`).join("")}</ol>`,
          );
          await compose.evaluate(() =>
            Promise.all(Array.from(document.images).map((i) => i.decode())),
          );
          const dir = path.join(root(section, str(v.round, "0")), "annotated");
          await mkdir(dir, { recursive: true });
          await compose.screenshot({
            path: path.join(dir, `${screen}-${d.id}.png`),
          });
        } finally {
          await compose.close();
        }
      } finally {
        await context.close();
      }
    } finally {
      await active.close();
    }
  } else throw new Error("Use annotate.ts strip or callouts");
}
