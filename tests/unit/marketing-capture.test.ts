// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { SESSION_IDLE_MS } from 'convex/shared/marketingAttribution';
import messages from "../../messages/en.json";

const nav = vi.hoisted(() => ({ pathname: "/" }));
const convex = vi.hoisted(() => ({ client: null as null | { mutation: ReturnType<typeof vi.fn> } }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return { default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) };
});
vi.mock("@/lib/react/convex", () => ({ useOptionalConvex: () => convex.client }));

type Capture = typeof import("@/lib/marketing/capture");
let capture: Capture;
const KEY = `mv_${"a".repeat(32)}`;
const NOW = Date.UTC(2026, 10, 8, 3);
const visit = (url: string) => window.history.replaceState(null, "", url);
const visitor = () => JSON.parse(window.localStorage.getItem("marketing-visitor") ?? "null");
const startSession = (sessionId: string | null = "s1") => vi.fn().mockResolvedValue({ visitorKey: KEY, sessionId });

beforeEach(async () => {
  // Fresh module state (in-flight call, in-memory consent) for every test.
  vi.resetModules();
  window.localStorage.clear();
  window.sessionStorage.clear();
  visit("/");
  nav.pathname = "/";
  convex.client = null;
  Object.defineProperty(document, "referrer", { value: "", configurable: true });
  capture = await import("@/lib/marketing/capture");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("capture before consent", () => {
  it("keeps only this tab's link and coupon, and never calls the server", async () => {
    visit("/th/rooms/mossbell?mk=f1&coupon=DCNT-F1-20");
    const start = startSession();
    await capture.capturePageView(start, NOW);
    expect(start).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    visit("/booking");
    expect(capture.captureForBooking()).toEqual({ slug: "f1" });
    expect(capture.arrivalCoupon()).toBe("DCNT-F1-20");
  });

  it("ignores reserved and malformed slugs", async () => {
    for (const slug of ["admin", "F1", "f1!", "x".repeat(40)]) {
      visit(`/?mk=${encodeURIComponent(slug)}&coupon=X`);
      await capture.capturePageView(startSession(), NOW);
    }
    expect(window.sessionStorage.length).toBe(0);
    expect(capture.captureForBooking()).toBeUndefined();
    expect(capture.arrivalCoupon()).toBe("");
  });

  it("takes the coupon only from the link's own URL, so a paused link's offer doesn't come back", () => {
    visit("/?mk=f1&coupon=DCNT-F1-20");
    expect(capture.arrivalCoupon()).toBe("DCNT-F1-20");
    visit("/rooms/mossbell");
    expect(capture.arrivalCoupon()).toBe("DCNT-F1-20");
    // The short link once its offer is paused: same slug, no coupon.
    visit("/?mk=f1");
    expect(capture.arrivalCoupon()).toBe("");
    visit("/?mk=q1");
    expect(capture.captureForBooking()).toEqual({ slug: "q1" });
  });
});

describe("capture after consent", () => {
  beforeEach(() => capture.setConsent("yes"));

  it("starts a session with the link, landing path and referrer host, then sends the key with bookings", async () => {
    Object.defineProperty(document, "referrer", { value: "https://www.facebook.com/ads?x=1", configurable: true });
    visit("/th/rooms/mossbell?mk=f1&coupon=DCNT-F1-20");
    const start = startSession();
    await capture.capturePageView(start, NOW);
    expect(start).toHaveBeenCalledWith({ slug: "f1", landingPath: "/th/rooms/mossbell", referrerHost: "www.facebook.com" });
    expect(visitor()).toEqual({ visitorKey: KEY, sessionId: "s1", lastActiveAt: NOW, slug: "f1" });
    expect(capture.captureForBooking()).toEqual({ visitorKey: KEY, slug: "f1" });
  });

  it("sends our own site as no referrer", async () => {
    Object.defineProperty(document, "referrer", { value: `${window.location.origin}/rooms`, configurable: true });
    const start = startSession();
    await capture.capturePageView(start, NOW);
    expect(start).toHaveBeenCalledWith({ landingPath: "/" });
  });

  it("reuses the session on a refresh and only bumps the last activity", async () => {
    visit("/?mk=f1");
    const start = startSession();
    await capture.capturePageView(start, NOW);
    await capture.capturePageView(start, NOW + 60_000);
    visit("/booking");
    await capture.capturePageView(start, NOW + 120_000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(visitor()).toMatchObject({ sessionId: "s1", lastActiveAt: NOW + 120_000, slug: "f1" });
  });

  it("starts a new session after the idle limit, keeping the key", async () => {
    visit("/?mk=f1");
    const start = startSession();
    await capture.capturePageView(start, NOW);
    visit("/booking");
    start.mockResolvedValueOnce({ visitorKey: KEY, sessionId: "s2" });
    await capture.capturePageView(start, NOW + SESSION_IDLE_MS + 1);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith({ visitorKey: KEY, landingPath: "/booking" });
    expect(visitor()).toEqual({ visitorKey: KEY, sessionId: "s2", lastActiveAt: NOW + SESSION_IDLE_MS + 1 });
  });

  it("starts a new session when a different link arrives", async () => {
    visit("/?mk=f1");
    const start = startSession();
    await capture.capturePageView(start, NOW);
    visit("/ja?mk=q1");
    start.mockResolvedValueOnce({ visitorKey: KEY, sessionId: "s2" });
    await capture.capturePageView(start, NOW + 60_000);
    expect(start).toHaveBeenLastCalledWith({ visitorKey: KEY, slug: "q1", landingPath: "/ja" });
    expect(visitor()).toMatchObject({ sessionId: "s2", slug: "q1" });
  });

  it("starts the first session with the tab's link when consent comes on a later page", async () => {
    capture.setConsent("no");
    visit("/?mk=f1");
    await capture.capturePageView(startSession(), NOW);
    visit("/rooms");
    capture.setConsent("yes");
    const start = startSession();
    await capture.capturePageView(start, NOW + 1000);
    expect(start).toHaveBeenCalledWith({ slug: "f1", landingPath: "/rooms" });
  });

  it("keeps the key and tries again next page view when the server returns no session", async () => {
    visit("/?mk=f1");
    const start = startSession(null);
    await capture.capturePageView(start, NOW);
    expect(visitor()).toEqual({ visitorKey: KEY, sessionId: null, lastActiveAt: NOW, slug: "f1" });
    visit("/booking");
    start.mockResolvedValueOnce({ visitorKey: KEY, sessionId: "s1" });
    await capture.capturePageView(start, NOW + 1000);
    expect(start).toHaveBeenLastCalledWith({ visitorKey: KEY, slug: "f1", landingPath: "/booking" });
    expect(visitor()).toMatchObject({ sessionId: "s1" });
  });

  it("swallows a failing startSession and tries again later", async () => {
    const start = vi.fn().mockRejectedValue(new Error("marketing.startSession is implemented in package B8."));
    await expect(capture.capturePageView(start, NOW)).resolves.toBeUndefined();
    expect(visitor()).toBeNull();
    await capture.capturePageView(start, NOW + 1000);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("makes one call at a time", async () => {
    let finish!: (value: { visitorKey: string; sessionId: string }) => void;
    const start = vi.fn(() => new Promise<{ visitorKey: string; sessionId: string }>((resolve) => { finish = resolve; }));
    const first = capture.capturePageView(start, NOW);
    const second = capture.capturePageView(start, NOW);
    finish({ visitorKey: KEY, sessionId: "s1" });
    await Promise.all([first, second]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("gives a link that arrives while a call is running its own session", async () => {
    visit("/?mk=f1");
    let finish!: (value: { visitorKey: string; sessionId: string }) => void;
    const start = vi.fn()
      .mockImplementationOnce(() => new Promise<{ visitorKey: string; sessionId: string }>((resolve) => { finish = resolve; }))
      .mockResolvedValue({ visitorKey: KEY, sessionId: "s2" });
    const first = capture.capturePageView(start, NOW);
    visit("/ja?mk=q1");
    void capture.capturePageView(start, NOW);
    expect(start).toHaveBeenCalledTimes(1);
    finish({ visitorKey: KEY, sessionId: "s1" });
    await first;
    await vi.waitFor(() => expect(visitor()).toMatchObject({ sessionId: "s2", slug: "q1" }));
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith({ visitorKey: KEY, slug: "q1", landingPath: "/ja" });
  });

  it("stores nothing when the visitor opts out while the call runs", async () => {
    let finish!: (value: { visitorKey: string; sessionId: string }) => void;
    const pending = capture.capturePageView(() => new Promise((resolve) => { finish = resolve; }), NOW);
    capture.setConsent("no");
    capture.clearMarketingStorage();
    finish({ visitorKey: KEY, sessionId: "s1" });
    await pending;
    expect(visitor()).toBeNull();
  });

  it("ignores a damaged visitor record instead of sending it", async () => {
    window.localStorage.setItem("marketing-visitor", JSON.stringify({ visitorKey: 42, sessionId: { x: 1 }, slug: ["f1"] }));
    expect(capture.captureForBooking()).toBeUndefined();
    const start = startSession();
    await capture.capturePageView(start, NOW);
    expect(start).toHaveBeenCalledWith({ landingPath: "/" });
  });

  it("opting out forgets the visitor but keeps the tab's link", async () => {
    visit("/?mk=f1");
    await capture.capturePageView(startSession(), NOW);
    capture.setConsent("no");
    capture.clearMarketingStorage();
    expect(visitor()).toBeNull();
    expect(capture.captureForBooking()).toEqual({ slug: "f1" });
  });
});

describe("blocked storage", () => {
  it("never throws and still reads the link from the URL", async () => {
    // As in a browser with site data blocked: touching either store throws.
    const blocked = { get: () => { throw new DOMException("blocked", "SecurityError"); }, configurable: true };
    const saved = ["localStorage", "sessionStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)] as const);
    Object.defineProperty(window, "localStorage", blocked);
    Object.defineProperty(window, "sessionStorage", blocked);
    onTestFinished(() => saved.forEach(([name, descriptor]) => (descriptor ? Object.defineProperty(window, name, descriptor) : Reflect.deleteProperty(window, name))));
    visit("/?mk=f1&coupon=DCNT-F1-20");
    capture.setConsent("yes");
    expect(capture.readConsent()).toBe("yes");
    const start = startSession();
    await expect(capture.capturePageView(start, NOW)).resolves.toBeUndefined();
    // The visitor is kept in memory, so moving around the site doesn't mint a new one each page.
    await capture.capturePageView(start, NOW + 1000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(capture.captureForBooking()).toEqual({ visitorKey: KEY, slug: "f1" });
    expect(capture.arrivalCoupon()).toBe("DCNT-F1-20");
    expect(() => capture.clearMarketingStorage()).not.toThrow();
  });
});

describe("an answer that can't be saved", () => {
  it("keeps the newer No over the Yes still in storage, and drops that Yes", () => {
    capture.setConsent("yes");
    // Reads work, writes don't (a full store).
    const store = window.localStorage;
    const full = new Proxy(store, { get: (target, key) => (key === "setItem" ? () => { throw new DOMException("full", "QuotaExceededError"); } : typeof Reflect.get(target, key) === "function" ? Reflect.get(target, key).bind(target) : Reflect.get(target, key)) });
    const saved = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { get: () => full, configurable: true });
    onTestFinished(() => {
      if (saved) Object.defineProperty(window, "localStorage", saved);
      else Reflect.deleteProperty(window, "localStorage");
    });
    capture.setConsent("no");
    expect(capture.readConsent()).toBe("no");
    // The next page asks again instead of measuring on the old answer.
    expect(store.getItem("analytics-consent-v2")).toBeNull();
    // An answer another tab saves afterwards is the newest.
    store.setItem("analytics-consent-v2", "yes");
    expect(capture.readConsent()).toBe("yes");
  });

  it("keeps the newer No in memory when the old Yes can't even be removed, until another tab saves", () => {
    capture.setConsent("yes");
    const store = window.localStorage;
    const stuck = new Proxy(store, { get: (target, key) => (key === "setItem" || key === "removeItem" ? () => { throw new DOMException("full", "QuotaExceededError"); } : typeof Reflect.get(target, key) === "function" ? Reflect.get(target, key).bind(target) : Reflect.get(target, key)) });
    const saved = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { get: () => stuck, configurable: true });
    onTestFinished(() => {
      if (saved) Object.defineProperty(window, "localStorage", saved);
      else Reflect.deleteProperty(window, "localStorage");
    });
    capture.setConsent("no");
    expect(capture.readConsent()).toBe("no");
    const stop = capture.onConsentChange(() => {});
    store.setItem("analytics-consent-v2", "yes");
    window.dispatchEvent(new StorageEvent("storage", { key: "analytics-consent-v2", newValue: "yes" }));
    expect(capture.readConsent()).toBe("yes");
    stop();
  });
});

describe("untracked paths", () => {
  it.each([
    ["/admin", true], ["/admin/bookings", true], ["/display", true], ["/display/pair", true], ["/dev/marketing", true],
    ["/", false], ["/th/rooms/mossbell", false], ["/administrator", false], ["/developers", false],
  ])("%s → %s", (path, expected) => {
    expect(capture.isUntrackedPath(path)).toBe(expected);
  });
});

const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
let root: Root;
async function mount(node: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root.render(createElement(NextIntlClientProvider, intl, node)));
}
async function unmount() {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
}
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label) as HTMLButtonElement;

describe("MarketingCapture", () => {
  it("captures on page views and right after consent", async () => {
    const mutation = vi.fn().mockResolvedValue({ visitorKey: KEY, sessionId: "s1" });
    convex.client = { mutation };
    visit("/?mk=f1");
    const { MarketingCapture } = await import("@/components/global/MarketingCapture");
    await mount(createElement(MarketingCapture));
    expect(mutation).not.toHaveBeenCalled();
    expect(capture.captureForBooking()).toEqual({ slug: "f1" });
    await act(async () => capture.setConsent("yes"));
    expect(mutation).toHaveBeenCalledWith(expect.anything(), { slug: "f1", landingPath: "/" });
    await unmount();
  });

  it("does nothing on staff screens", async () => {
    nav.pathname = "/admin/bookings";
    visit("/admin/bookings?mk=f1");
    const { MarketingCapture } = await import("@/components/global/MarketingCapture");
    await mount(createElement(MarketingCapture));
    expect(window.sessionStorage.length).toBe(0);
    await unmount();
  });
});

describe("consent banner", () => {
  async function banner() {
    const { AnalyticsConsent } = await import("@/components/global/AnalyticsConsent");
    await mount(createElement(AnalyticsConsent));
    return document.querySelector('[role="dialog"]');
  }

  it("asks even without a PostHog key, with the new wording", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const dialog = await banner();
    expect(dialog?.getAttribute("aria-label")).toBe("Measurement choice");
    expect(dialog?.textContent).toContain("remember your visits for 30 days");
    expect(dialog?.textContent).toContain("Nothing is shared with advertisers");
    expect(dialog?.querySelector("a")?.getAttribute("href")).toBe("/privacy");
    await unmount();
    vi.unstubAllEnvs();
  });

  it("asks again when only the old analytics-consent was answered", async () => {
    window.localStorage.setItem("analytics-consent", "yes");
    expect(await banner()).not.toBeNull();
    await unmount();
  });

  it("stays hidden once answered and on staff screens", async () => {
    window.localStorage.setItem("analytics-consent-v2", "no");
    expect(await banner()).toBeNull();
    await unmount();
    window.localStorage.clear();
    nav.pathname = "/admin";
    expect(await banner()).toBeNull();
    await unmount();
    nav.pathname = "/display";
    expect(await banner()).toBeNull();
    await unmount();
  });

  it("saves the answer as v2 and closes", async () => {
    await banner();
    await act(async () => button("Allow").click());
    expect(window.localStorage.getItem("analytics-consent-v2")).toBe("yes");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await unmount();
  });
});

describe("turning measurement off", () => {
  it("saves no and forgets the visitor key without reloading", async () => {
    capture.setConsent("yes");
    window.localStorage.setItem("marketing-visitor", JSON.stringify({ visitorKey: KEY, sessionId: "s1", lastActiveAt: NOW }));
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    const { AnalyticsChoice } = await import("@/components/legal/AnalyticsChoice");
    await mount(createElement(AnalyticsChoice));
    await act(async () => button("Turn off measurement").click());
    expect(window.localStorage.getItem("analytics-consent-v2")).toBe("no");
    expect(visitor()).toBeNull();
    expect(capture.captureForBooking()).toBeUndefined();
    expect(document.body.textContent).toContain("Measurement is off in this browser.");
    expect(reload).not.toHaveBeenCalled();
    await unmount();
  });

  it("says it is off after a No and turns it back on", async () => {
    capture.setConsent("no");
    const { AnalyticsChoice } = await import("@/components/legal/AnalyticsChoice");
    await mount(createElement(AnalyticsChoice));
    expect(document.body.textContent).toContain("Measurement is off in this browser.");
    await act(async () => button("Turn on measurement").click());
    expect(window.localStorage.getItem("analytics-consent-v2")).toBe("yes");
    expect(document.body.textContent).toContain("Measurement is on in this browser.");
    await unmount();
  });
});
