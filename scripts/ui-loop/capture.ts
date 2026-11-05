import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  args,
  env,
  errorText,
  list,
  pool,
  root,
  save,
  str,
  json,
} from "./common.ts";
import { DEVICES, FLAWS, SCREENS } from "./config.ts";
import type { Device, Screen, State } from "./config.ts";
import { checks } from "./checks.ts";
import { NOW, preparePage, session, settle } from "./session.ts";
import { lintFlow, flowLine } from "./scoring.ts";
import type { CaptureRecord, Manifest } from "./types.ts";

export async function injectFlaw(
  page: import("@playwright/test").Page,
  id: string,
) {
  const flaw = FLAWS[id];
  if (!flaw) throw new Error(`Unknown flaw: ${id}`);
  if (id === "cramped")
    await page.evaluate(() => {
      for (const el of document.querySelectorAll<HTMLElement>("main *")) {
        const s = getComputedStyle(el);
        for (const key of [
          "paddingTop",
          "paddingRight",
          "paddingBottom",
          "paddingLeft",
          "rowGap",
          "columnGap",
        ] as const) {
          const px = parseFloat(s[key]);
          if (Number.isFinite(px)) el.style[key] = `${px / 2}px`;
        }
      }
    });
  else await page.addStyleTag({ content: flaw.css });
}
async function segments(
  page: import("@playwright/test").Page,
  file: string,
): Promise<string[]> {
  const files: string[] = [];
  const scroller = await page.evaluate(() => {
    const root = document.scrollingElement as HTMLElement;
    const dialog = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"]'),
    ).find((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    });
    const candidates = [
      ...(dialog
        ? [dialog, ...dialog.querySelectorAll<HTMLElement>("*")]
        : [
            root,
            ...document.querySelectorAll<HTMLElement>(
              'main,[role="main"],main *,[role="main"] *',
            ),
          ]),
    ].filter(
      (el, i, all) =>
        all.indexOf(el) === i &&
        el.clientHeight > 100 &&
        el.scrollHeight > el.clientHeight + 5 &&
        (el === root || /auto|scroll/.test(getComputedStyle(el).overflowY)) &&
        el.getBoundingClientRect().width > 150 &&
        el.getBoundingClientRect().bottom > 0 &&
        el.getBoundingClientRect().top < innerHeight,
    );
    candidates.sort(
      (a, b) =>
        b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
    );
    const chosen = candidates[0];
    if (!chosen) return null;
    chosen.setAttribute("data-ui-loop-segments", "true");
    chosen.scrollTop = 0;
    return {
      height: chosen.clientHeight,
      max: chosen.scrollHeight - chosen.clientHeight,
    };
  });
  let position = 0;
  for (let i = 0; i < 4; i++) {
    const name = file + (i ? `-seg${i}` : "") + ".png";
    await page.screenshot({ path: name, fullPage: false });
    files.push(path.basename(name));
    if (!scroller || position >= scroller.max) break;
    position = Math.min(scroller.max, position + scroller.height * 0.85);
    await page
      .locator("[data-ui-loop-segments]")
      .evaluate((el, y) => el.scrollTo(0, y), position);
    await page.waitForTimeout(200);
  }
  return files;
}
export type CaptureOptions = {
  section: string;
  round: string;
  resume?: boolean;
  screens?: string[];
  devices?: string[];
  states?: string[];
  checkOnly?: boolean;
  debugShots?: boolean;
  concurrency?: number;
  inject?: string;
  out?: string;
};
export async function capture(options: CaptureOptions) {
  env();
  const screens = SCREENS.filter(
    (s) =>
      (options.section === "all" || s.section === options.section) &&
      (!options.screens?.length || options.screens.includes(s.id)),
  );
  if (!screens.length) throw new Error("No matching screens");
  const devices = DEVICES.filter(
    (d) =>
      (d.judged || options.checkOnly) &&
      (!options.devices?.length || options.devices.includes(d.id)),
  );
  if (!devices.length) throw new Error("No matching devices");
  const outputs = new Map<string, { dir: string; manifest: Manifest }>();
  for (const s of screens)
    if (!outputs.has(s.section)) {
      const dir = options.out
        ? path.resolve(options.out, options.section === "all" ? s.section : "")
        : root(s.section, options.round);
      await mkdir(path.join(dir, "checks"), { recursive: true });
      outputs.set(s.section, {
        dir,
        manifest: existsSync(path.join(dir, "manifest.json"))
          ? await json<Manifest>(path.join(dir, "manifest.json"))
          : {
              version: 1,
              now: process.env.UI_LOOP_NOW ?? NOW,
              capturedAt: new Date().toISOString(),
              guard:
                "Convex websocket Mutation/Action dropped; Convex HTTP mutation/action/run POST aborted; service workers blocked",
              captures: [],
            },
      });
    }
  const active = await session();
  const tasks = screens.flatMap((screen) =>
    devices.flatMap((device) =>
      screen.states
        .filter(
          (state) =>
            (!options.states?.length || options.states.includes(state.id)) &&
            (device.judged || state.id === "default") &&
            (!state.applies || state.applies(device)),
        )
        .filter(
          (state) =>
            !options.resume ||
            !outputs
              .get(screen.section)!
              .manifest.captures.some(
                (c) =>
                  c.screen === screen.id &&
                  c.device === device.id &&
                  c.state === state.id &&
                  !c.error &&
                  c.checks?.length &&
                  (device.judged ? c.files.length > 0 : true),
              ),
        )
        .map((state) => ({ screen, device, state })),
    ),
  );
  let failures = 0;
  try {
    await pool(
      tasks,
      options.concurrency ?? 3,
      async ({
        screen,
        device,
        state,
      }: {
        screen: Screen;
        device: Device;
        state: State;
      }) => {
        const output = outputs.get(screen.section)!;
        const record: CaptureRecord = {
          screen: screen.id,
          section: screen.section,
          device: device.id,
          state: state.id,
          description: state.description,
          pendingStates: screen.pendingStates,
          files: [],
          blocked: [],
          websocketUrls: [],
          guard: false,
        };
        let context: import("@playwright/test").BrowserContext | undefined;
        let page: import("@playwright/test").Page | undefined;
        try {
          const created = await active.context(
            device,
            state.id === "dark" ? "dark" : "light",
          );
          context = created.context;
          record.blocked = created.guard.blocked;
          record.websocketUrls = created.guard.websocketUrls;
          record.guard = created.guard.active;
          const prepared = await preparePage(context, device);
          page = prepared.page;
          record.pointerCoarse = prepared.pointerCoarse;
          const route =
            typeof screen.path === "string"
              ? screen.path
              : await screen.path(page, active.base);
          await page.goto(active.base + route);
          await settle(page);
          if (/sign-in/.test(page.url()))
            throw new Error("Capture reached sign-in instead of admin");
          if (
            await page
              .getByText("This view could not load", { exact: true })
              .count()
          ) {
            if (device.judged || options.debugShots) {
              const file = `${screen.id}-${device.id}-${state.id}.png`;
              await page.screenshot({ path: path.join(output.dir, file) });
              record.files = [file];
            }
            record.description =
              "The navigation route displays an error and the requested state is unavailable.";
            throw new Error(
              "Live UI could not load: " +
                (await page.locator("main").innerText()),
            );
          }
          await state.recipe(page, device);
          await settle(page);
          if (options.inject) await injectFlaw(page, options.inject);
          record.url =
            new URL(page.url()).pathname + new URL(page.url()).search;
          // Keep the capture state stable while desktop focus checks walk the page.
          record.checks = await checks(page, device);
          const stem = `${screen.id}-${device.id}-${state.id}`;
          record.checksFile = `checks/${stem}.json`;
          await save(path.join(output.dir, record.checksFile), {
            screen: screen.id,
            device: device.id,
            state: state.id,
            reportOnly: !device.judged,
            checks: record.checks,
          });
          if (device.judged || options.debugShots)
            record.files = await segments(page, path.join(output.dir, stem));
          if (!record.websocketUrls.length)
            throw new Error("No guarded Convex sync websocket observed");
          console.log(
            `Captured ${screen.id} ${device.id} ${state.id}: ${record.checks.filter((c) => !c.pass).length} failing checks`,
          );
        } catch (e) {
          failures++;
          record.error = errorText(e);
          record.description =
            "The requested state is unavailable while opening this navigation route.";
          if (
            page &&
            (device.judged || options.debugShots) &&
            !record.files.length
          ) {
            try {
              const file = `${screen.id}-${device.id}-${state.id}.png`;
              await page.screenshot({
                path: path.join(output.dir, file),
                timeout: 10000,
              });
              record.files = [file];
            } catch {}
          }

          console.error(
            `Capture failed: ${screen.id} ${device.id} ${state.id}: ${record.error}`,
          );
        } finally {
          await context?.close();
          output.manifest.captures = output.manifest.captures.filter(
            (c) =>
              !(
                c.screen === record.screen &&
                c.device === record.device &&
                c.state === record.state
              ),
          );
          output.manifest.captures.push(record);
          await save(path.join(output.dir, "manifest.json"), output.manifest);
        }
      },
    );
  } finally {
    await active.close();
  }
  for (const { dir, manifest } of outputs.values()) {
    manifest.captures.sort((a, b) =>
      `${a.screen}-${a.device}-${a.state}`.localeCompare(
        `${b.screen}-${b.device}-${b.state}`,
      ),
    );
    const flow =
      manifest.captures
        .flatMap((c) => c.files.map((file) => flowLine(file, c.description)))
        .join("\n") + "\n";
    lintFlow(flow);
    await writeFile(path.join(dir, "flow.md"), flow);
    await save(path.join(dir, "manifest.json"), manifest);
  }
  return failures;
}
if (import.meta.main) {
  const { values: v } = args({ states: "string", resume: "boolean" });
  const failures = await capture({
    resume: !!v.resume,
    section: str(v.section, "1-daily"),
    round: str(v.round, "0"),
    screens: list(v.screens),
    devices: list(v.devices),
    states: list(v.states),
    checkOnly: !!v["check-only-devices"],
    debugShots: !!v["debug-shots"],
    concurrency: Number(v.concurrency ?? 3),
    inject: str(v.inject) || undefined,
    out: str(v.out) || undefined,
  });
  if (failures) process.exitCode = 1;
}
