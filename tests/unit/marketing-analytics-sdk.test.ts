// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

/*
 * M1 with the real posthog-js (not a stand-in), offline: fetch, XMLHttpRequest and sendBeacon are
 * replaced so nothing leaves the test, and every request is checked to go only to the fake host.
 * Checks the SDK's own final state, not just which methods were called.
 */

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return { default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) };
});
vi.mock('convex/react', async (importOriginal) => ({ ...await importOriginal<typeof import('convex/react')>(), useConvex: () => null }));

const HOST = "https://ph.invalid";
const OPT_KEY = "__ph_opt_in_out_phc_test";
const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
const requests: string[] = [];
let root: Root | null = null;

class OfflineXhr {
  readyState = 0;
  status = 200;
  responseText = "{}";
  onreadystatechange: (() => void) | null = null;
  open(_method: string, url: string) {
    requests.push(url);
  }
  setRequestHeader() {}
  send() {}
  abort() {}
  addEventListener() {}
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", HOST);
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    requests.push(String(url));
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }));
  vi.stubGlobal("XMLHttpRequest", OfflineXhr);
  Object.defineProperty(navigator, "sendBeacon", { value: (url: string) => (requests.push(url), true), configurable: true });
  // A desktop browser: PostHog drops events from what it takes for bots, and happy-dom says it is automated.
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", configurable: true });
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
  requests.length = 0;
  window.localStorage.clear();
  window.sessionStorage.clear();
  document.cookie.split(";").forEach((cookie) => (document.cookie = `${cookie.split("=")[0].trim()}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`));
  window.history.replaceState(null, "", "/");
  nav.pathname = "/";
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  // Every request went to the fake host: no live analytics.
  expect(requests.filter((url) => !url.startsWith(HOST))).toEqual([]);
});

const settle = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); });

/** The page's modules and the very SDK instance they use, with the events it really captured. */
async function page(path: string) {
  const { default: posthog } = await import("posthog-js");
  const captured: string[] = [];
  // Listens from start-up on: the SDK's event emitter is set up by init().
  const init = posthog.init.bind(posthog);
  vi.spyOn(posthog, "init").mockImplementation((...args: Parameters<typeof posthog.init>) => {
    const instance = init(args[0], { ...args[1], disable_external_dependency_loading: true });
    posthog.on("eventCaptured", (event: { event: string }) => void captured.push(event.event));
    return instance;
  });
  const capture = await import("@/lib/marketing/capture");
  const { AnalyticsConsent } = await import("@/components/global/AnalyticsConsent");
  const render = async (to: string) => {
    nav.pathname = to;
    window.history.replaceState(null, "", to);
    await act(async () => root!.render(createElement(NextIntlClientProvider, intl, createElement(AnalyticsConsent))));
    await settle();
  };
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await render(path);
  return { posthog, captured, capture, navigate: render };
}

async function otherTab(...writes: [key: string, value: string | null][]) {
  const events = writes.map(([key, value]) => {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return new StorageEvent("storage", { key, newValue: value, storageArea: window.localStorage });
  });
  await act(async () => events.forEach((event) => window.dispatchEvent(event)));
  await settle();
}

// One page's life with the one real SDK instance (posthog-js is loaded once per test file).
it("lifts an opt-out the SDK saved earlier, ends opted out when another tab withdraws, and opts in afresh without an $opt_in event", async () => {
  // A returning guest: their last No left PostHog's saved opt-out, and they said Yes again where PostHog never loaded.
  window.localStorage.setItem(OPT_KEY, "0");
  window.localStorage.setItem("analytics-consent-v2", "yes");
  const { posthog, captured, capture, navigate } = await page("/");
  // Starting up alone would leave it opted out; it was opted in explicitly.
  expect(posthog.has_opted_in_capturing()).toBe(true);
  expect(captured).toEqual(["$pageview"]);
  expect(posthog.is_capturing()).toBe(true);
  const before = posthog.get_distinct_id();

  const requestsBeforeWithdrawal = requests.length;
  await otherTab(["analytics-consent-v2", "no"], ["marketing-visitor", null]);
  expect(requests.slice(requestsBeforeWithdrawal)).toEqual([]);
  expect(posthog.has_opted_out_capturing()).toBe(true);
  expect(posthog.is_capturing()).toBe(false);
  // The opt-out is saved by the SDK, so a later start-up stays out too.
  expect(window.localStorage.getItem(OPT_KEY)).toBe("0");
  // The identity used before the withdrawal is gone.
  expect(posthog.get_distinct_id()).not.toBe(before);

  await navigate("/rooms/mossbell");
  posthog.capture("$pageview"); // even a direct call is refused now
  expect(captured).toEqual(["$pageview"]);

  await act(async () => capture.setConsent("yes"));
  await settle();
  expect(posthog.has_opted_in_capturing()).toBe(true);
  expect(posthog.is_capturing()).toBe(true);
  expect(posthog.get_distinct_id()).not.toBe(before);
  // One view of the page the guest is on, and no $opt_in event.
  expect(captured).toEqual(["$pageview", "$pageview"]);
});
