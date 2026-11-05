import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { env } from "./common.ts";
import type { Device } from "./config.ts";
import type { Blocked } from "./types.ts";

export const NOW = process.env.UI_LOOP_NOW ?? "2026-11-05T10:00:00+07:00";
export type Guard = {
  blocked: Blocked[];
  websocketUrls: string[];
  active: boolean;
};
export async function readOnly(context: BrowserContext): Promise<Guard> {
  const guard: Guard = { blocked: [], websocketUrls: [], active: true };
  const configured =
    process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.PUBLIC_CONVEX_URL;
  const host = configured ? new URL(configured).hostname : null;
  const isConvex = (url: string) => {
    const u = new URL(url);
    return u.hostname === host || /\.convex\.(cloud|site)$/.test(u.hostname);
  };
  // Match Convex's actual /api/<client-version>/sync websocket; the hostname is also checked.
  await context.routeWebSocket(/convex|\/api\/[^/]+\/sync/, (socket) => {
    if (!isConvex(socket.url())) {
      socket.connectToServer();
      return;
    }
    if (!/\/api\/[^/]+\/sync/.test(new URL(socket.url()).pathname))
      throw new Error("Unrecognized Convex websocket sync URL");
    guard.websocketUrls.push(socket.url());
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      try {
        const parsed = JSON.parse(
          typeof message === "string" ? message : message.toString(),
        ) as { type?: string; udfPath?: string };
        if (parsed.type === "Mutation" || parsed.type === "Action") {
          guard.blocked.push({
            transport: "websocket",
            type: parsed.type,
            udfPath: parsed.udfPath ?? "unknown",
          });
          return;
        }
      } catch {
        // Non-JSON websocket control payloads pass through unchanged.
      }
      server.send(message);
    });
    server.onMessage((message) => socket.send(message));
  });
  await context.route("**/*", async (route) => {
    const req = route.request();
    if (
      req.method() === "POST" &&
      isConvex(req.url()) &&
      /^\/api\/(mutation|action|run)(?:\/|$)/.test(new URL(req.url()).pathname)
    ) {
      let udfPath = "unknown";
      try {
        udfPath = (req.postDataJSON() as { path?: string }).path ?? "unknown";
      } catch {}
      guard.blocked.push({
        transport: "http",
        type: new URL(req.url()).pathname,
        udfPath,
      });
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  return guard;
}
export async function initialize(context: BrowserContext, theme = "light") {
  await context.addInitScript(
    ({ theme }) => {
      sessionStorage.setItem("seaview-demo-disclaimer-dismissed", "true");
      localStorage.setItem("theme", theme);
      const state = window as typeof window & { __cls: number };
      state.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          const entry = e as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          if (!entry.hadRecentInput) state.__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      const hide = () => {
        if (!document.documentElement) return;
        let style = document.getElementById("ui-loop-devtools");
        if (!style) {
          style = document.createElement("style");
          style.id = "ui-loop-devtools";
          style.textContent = "nextjs-portal{display:none!important}";
          document.documentElement.append(style);
        }
      };
      new MutationObserver(hide).observe(document, {
        childList: true,
        subtree: true,
      });
      hide();
    },
    { theme },
  );
}
export async function settle(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForFunction(
    () =>
      !Array.from(
        document.querySelectorAll(
          '[aria-busy="true"],.animate-pulse,[role="status"],.animate-spin',
        ),
      ).some((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.top < innerHeight &&
          style.visibility !== "hidden" &&
          (el.matches('[aria-busy="true"],.animate-pulse,.animate-spin') ||
            /loading/i.test(
              el.getAttribute("aria-label") ?? el.textContent ?? "",
            ))
        );
      }),
    undefined,
    { timeout: 10000 },
  );
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForTimeout(800);
}
export type Session = {
  browser: Browser;
  base: string;
  context: (
    device: Device,
    theme?: string,
  ) => Promise<{ context: BrowserContext; guard: Guard }>;
  close: () => Promise<void>;
};
export async function session(): Promise<Session> {
  env();
  process.env.CLERK_PUBLISHABLE_KEY =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const base = process.env.UI_LOOP_BASE_URL ?? "http://localhost:3410";
  if (!process.env.UI_LOOP_ADMIN_EMAIL)
    throw new Error("UI_LOOP_ADMIN_EMAIL is required");
  await clerkSetup();
  const browser = await chromium.launch({ headless: true });
  try {
    const auth = await browser.newContext({ serviceWorkers: "block" });
    await readOnly(auth);
    await initialize(auth);
    const page = await auth.newPage();
    await page.goto(base + "/admin/chats");
    await clerk.signIn({ page, emailAddress: process.env.UI_LOOP_ADMIN_EMAIL });
    await page.goto(base + "/admin/chats");
    await settle(page);
    const state = await auth.storageState();
    await auth.close();
    return {
      browser,
      base,
      context: async (d, theme = "light") => {
        const context = await browser.newContext({
          storageState: state,
          viewport: { width: d.width, height: d.height },
          deviceScaleFactor: d.deviceScaleFactor,
          hasTouch: d.hasTouch,
          isMobile: d.isMobile,
          timezoneId: "Asia/Bangkok",
          locale: "en-US",
          serviceWorkers: "block",
        });
        const guard = await readOnly(context);
        await initialize(context, theme);
        return { context, guard };
      },
      close: () => browser.close(),
    };
  } catch (e) {
    await browser.close();
    throw e;
  }
}
export async function preparePage(context: BrowserContext, d: Device) {
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(60000);
  await page.clock.setFixedTime(new Date(process.env.UI_LOOP_NOW ?? NOW));
  const pointerCoarse = await page.evaluate(
    () => matchMedia("(pointer: coarse)").matches,
  );
  if (pointerCoarse !== d.hasTouch)
    throw new Error(`Pointer emulation failed for ${d.id}`);
  return { page, pointerCoarse };
}
