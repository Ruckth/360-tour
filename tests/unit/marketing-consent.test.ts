// @vitest-environment happy-dom
import { act, createElement, Fragment, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import messages from "../../messages/en.json";

/*
 * M1: one measurement choice, kept in step across open tabs. The banner, the privacy-page control and the
 * visit-session capture are rendered with React; PostHog is a stateful stand-in that behaves like the real
 * SDK where it matters (reset() clears an opt-out). Another tab is simulated the way a browser does it:
 * it writes localStorage, and this tab hears one storage event per write, in order, afterwards.
 */

const nav = vi.hoisted(() => ({ pathname: "/" }));
const convex = vi.hoisted(() => ({ client: null as null | { mutation: (...args: unknown[]) => Promise<unknown> } }));
const sdk = vi.hoisted(() => {
  const log: string[] = [];
  const state = { optedOut: false, gate: Promise.resolve() as Promise<unknown> };
  const posthog = {
    __loaded: false,
    init: () => {
      posthog.__loaded = true;
      log.push("init");
    },
    capture: (event: string) => void log.push(state.optedOut ? `dropped ${event}` : `capture ${event}`),
    // As in posthog-js: reset() also clears the consent flag.
    reset: () => {
      state.optedOut = false;
      log.push("reset");
    },
    opt_out_capturing: () => {
      state.optedOut = true;
      log.push("opt_out");
    },
    opt_in_capturing: (options?: { captureEventName?: unknown }) => {
      state.optedOut = false;
      const silent = options?.captureEventName === false || options?.captureEventName === null;
      log.push(silent ? "opt_in" : "opt_in + capture $opt_in");
    },
    has_opted_out_capturing: () => state.optedOut,
    has_opted_in_capturing: () => !state.optedOut,
    is_capturing: () => !state.optedOut,
  };
  return { log, state, posthog };
});
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return { default: ({ children, href }: { children: ReactNode; href: string }) => createElement("a", { href }, children) };
});
vi.mock('convex/react', async (importOriginal) => ({ ...await importOriginal<typeof import('convex/react')>(), useConvex: () => convex.client }));

const CONSENT = "analytics-consent-v2";
const VISITOR = "marketing-visitor";
const OLD = `mv_${"a".repeat(32)}`;
const NEW = `mv_${"b".repeat(32)}`;
const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;

type Capture = typeof import("@/lib/marketing/capture");
let capture: Capture;
let tree: () => ReactNode;
let root: Root | null = null;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
type Session = { visitorKey: string; sessionId: string | null };
/** startSession calls, each answered by the test. */
function sessions() {
  const calls: { args: unknown; answer: ReturnType<typeof deferred<Session>> }[] = [];
  convex.client = {
    mutation: (_ref: unknown, args: unknown) => {
      const answer = deferred<Session>();
      calls.push({ args, answer });
      return answer.promise;
    },
  };
  return calls;
}

const settle = () => act(async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); });
const pageviews = () => sdk.log.filter((line) => line === "capture $pageview").length;
const visitor = () => JSON.parse(window.localStorage.getItem(VISITOR) ?? "null");
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label) as HTMLButtonElement;
const banner = () => document.querySelector('[role="dialog"]');

async function mount(path: string, { choice = false } = {}) {
  await load();
  nav.pathname = path;
  window.history.replaceState(null, "", path);
  const [{ AnalyticsConsent }, { MarketingCapture }, { AnalyticsChoice }] = await Promise.all([
    import("@/components/global/AnalyticsConsent"),
    import("@/components/global/MarketingCapture"),
    import("@/components/legal/AnalyticsChoice"),
  ]);
  // Fresh elements on every render, so a navigation re-renders the components as Next's router would.
  tree = () => createElement(NextIntlClientProvider, intl, createElement(Fragment, null, choice ? createElement(AnalyticsChoice) : null, createElement(AnalyticsConsent), createElement(MarketingCapture)));
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(tree()));
  await settle();
}
/** A client-side navigation: same tab, same module state. */
async function navigate(path: string) {
  nav.pathname = path;
  window.history.replaceState(null, "", path);
  await act(async () => root!.render(tree()));
  await settle();
}
/** Another tab writes these keys (null removes one), then this tab hears each write. */
async function otherTab(...writes: [key: string, value: string | null][]) {
  const events = writes.map(([key, value]) => {
    const oldValue = window.localStorage.getItem(key);
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return new StorageEvent("storage", { key, oldValue, newValue: value, storageArea: window.localStorage });
  });
  await act(async () => events.forEach((event) => window.dispatchEvent(event)));
  await settle();
}
async function otherTabClearsSiteData() {
  window.localStorage.clear();
  await act(async () => void window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: window.localStorage })));
  await settle();
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  nav.pathname = "/";
  convex.client = null;
  sdk.log.length = 0;
  sdk.state.optedOut = false;
  sdk.state.gate = Promise.resolve();
  sdk.posthog.__loaded = false;
  Object.defineProperty(document, "referrer", { value: "", configurable: true });
  // Loading PostHog waits on sdk.state.gate, so a test can change the choice while it loads. Registered
  // per test: a vi.mock factory's module would be reused by every later test.
  vi.doMock("posthog-js", async () => {
    await sdk.state.gate;
    return { default: sdk.posthog };
  });
});

/** Loads the page's modules, as a page load would: after the test has put what a returning guest has in storage. */
async function load() {
  capture = await import("@/lib/marketing/capture");
  return capture;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PostHog follows the choice in every tab", () => {
  it("stops page views here when another tab opts out, resetting PostHog before opting it out", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    await mount("/");
    expect(pageviews()).toBe(1);

    await otherTab([CONSENT, "no"], [VISITOR, null]);
    // reset() clears the SDK's opt-out, so it has to come first.
    expect(sdk.log.slice(-2)).toEqual(["reset", "opt_out"]);
    expect(sdk.state.optedOut).toBe(true);

    await navigate("/rooms/mossbell");
    expect(pageviews()).toBe(1);
    expect(sdk.log.filter((line) => line.startsWith("dropped"))).toEqual([]);
  });

  it("turns off on the privacy page without a reload, then back on with a fresh start and one page view", async () => {
    const calls = sessions();
    const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
    window.localStorage.setItem(CONSENT, "yes");
    window.localStorage.setItem(VISITOR, JSON.stringify({ visitorKey: OLD, sessionId: "s1", lastActiveAt: Date.now() }));
    await mount("/privacy", { choice: true });
    expect(pageviews()).toBe(1);

    await act(async () => button("Turn off measurement").click());
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Measurement is off in this browser.");
    expect(window.localStorage.getItem(CONSENT)).toBe("no");
    expect(visitor()).toBeNull();
    expect(sdk.log.slice(-2)).toEqual(["reset", "opt_out"]);

    await navigate("/rooms");
    expect(pageviews()).toBe(1);

    sdk.log.length = 0;
    await act(async () => button("Turn on measurement").click());
    await settle();
    // Explicitly opted back in, without PostHog's own $opt_in event, then this page's view.
    expect(sdk.log).toEqual(["reset", "opt_in", "capture $pageview"]);
    expect(document.body.textContent).toContain("Measurement is on in this browser.");
    // The visit session starts over without the forgotten key.
    expect(calls.at(-1)?.args).toEqual({ landingPath: "/rooms" });

    await navigate("/booking");
    expect(pageviews()).toBe(2);
  });

  it("never starts or captures when the choice is withdrawn while PostHog is still loading", async () => {
    const gate = deferred<void>();
    sdk.state.gate = gate.promise;
    window.localStorage.setItem(CONSENT, "yes");
    await mount("/");
    await otherTab([CONSENT, "no"]);
    gate.resolve();
    await settle();
    await navigate("/rooms");
    expect(sdk.log).toEqual([]);
  });

  it("sends one page view for the current page after a quick Allow, No, Allow while PostHog loads", async () => {
    const gate = deferred<void>();
    sdk.state.gate = gate.promise;
    await mount("/rooms");
    await act(async () => button("Allow").click());
    await act(async () => capture.setConsent("no"));
    await act(async () => capture.setConsent("yes"));
    gate.resolve();
    await settle();
    expect(pageviews()).toBe(1);
    expect(sdk.log.filter((line) => line === "init")).toHaveLength(1);
    expect(sdk.log.filter((line) => line.startsWith("dropped") || line.includes("$opt_in"))).toEqual([]);
  });

  it("lifts an opt-out PostHog saved earlier explicitly, instead of relying on start-up", async () => {
    sdk.state.optedOut = true; // saved by PostHog when the guest last turned measurement off
    window.localStorage.setItem(CONSENT, "yes");
    await mount("/");
    expect(sdk.log).toEqual(["init", "reset", "opt_in", "capture $pageview"]);
  });

  it("keeps listening on staff screens: a choice changed elsewhere still reaches the loaded SDK", async () => {
    const calls = sessions();
    window.localStorage.setItem(CONSENT, "yes");
    await mount("/");
    calls[0].answer.resolve({ visitorKey: OLD, sessionId: "s1" });
    await settle();
    expect(visitor()).toMatchObject({ visitorKey: OLD });
    expect(pageviews()).toBe(1);

    await navigate("/admin/bookings");
    expect(pageviews()).toBe(1);
    await otherTab([CONSENT, "no"], [VISITOR, null]);
    expect(sdk.log.slice(-2)).toEqual(["reset", "opt_out"]);
    expect(banner()).toBeNull();

    // Measurement turned back on in another tab: this tab opts in, but sends nothing until the guest moves on.
    await otherTab([CONSENT, "yes"]);
    expect(sdk.log.slice(-2)).toEqual(["reset", "opt_in"]);
    expect(pageviews()).toBe(1);

    await navigate("/rooms");
    expect(pageviews()).toBe(2);
    expect(calls.at(-1)?.args).toEqual({ landingPath: "/rooms" });
    calls.at(-1)!.answer.resolve({ visitorKey: NEW, sessionId: "s2" });
    await settle();
    expect(capture.captureForBooking()).toEqual({ visitorKey: NEW });
  });

  it("treats clearing site data in another tab as withdrawing the choice", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    await mount("/");
    expect(pageviews()).toBe(1);
    await otherTabClearsSiteData();
    expect(sdk.log.slice(-2)).toEqual(["reset", "opt_out"]);
    expect(banner()).not.toBeNull();
    await navigate("/rooms");
    expect(pageviews()).toBe(1);
  });

  it("loads nothing without a PostHog key, while visit sessions still follow the choice", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const calls = sessions();
    await mount("/");
    await act(async () => button("Allow").click());
    await settle();
    expect(calls).toHaveLength(1);
    await otherTab([CONSENT, "no"], [VISITOR, null]);
    await navigate("/rooms");
    expect(calls).toHaveLength(1);
    expect(sdk.log).toEqual([]);
  });
});

describe("visit identity across a changing choice", () => {
  it("never brings back the visitor of an answer withdrawn while its session call ran (Allow, No, Allow)", async () => {
    const calls = sessions();
    await mount("/");
    await act(async () => button("Allow").click());
    expect(calls).toHaveLength(1);
    await act(async () => capture.setConsent("no"));
    await act(async () => capture.setConsent("yes"));
    // The new answer gets its own call instead of waiting for the old one.
    expect(calls).toHaveLength(2);

    calls[0].answer.resolve({ visitorKey: OLD, sessionId: "s1" });
    await settle();
    expect(visitor()).toBeNull();
    // The old call finishing must not free the slot the newer call holds.
    await navigate("/rooms");
    expect(calls).toHaveLength(2);

    calls[1].answer.resolve({ visitorKey: NEW, sessionId: "s2" });
    await settle();
    expect(visitor()).toMatchObject({ visitorKey: NEW, sessionId: "s2" });
    expect(capture.captureForBooking()).toEqual({ visitorKey: NEW });
  });

  it("drops a session answer that arrives after another tab opted out and back in", async () => {
    const calls = sessions();
    window.localStorage.setItem(CONSENT, "yes");
    await mount("/");
    expect(calls).toHaveLength(1);
    await otherTab([CONSENT, "no"], [VISITOR, null], [CONSENT, "yes"]);
    calls[0].answer.resolve({ visitorKey: OLD, sessionId: "s1" });
    await settle();
    expect(visitor()).toBeNull();
    expect(capture.captureForBooking()).toBeUndefined();
    await navigate("/rooms");
    expect(calls.at(-1)?.args).toEqual({ landingPath: "/rooms" });
  });

  it("forgets this page's visitor when another tab opts out, so re-consent mints a new one", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    await load();
    await capture.capturePageView(vi.fn().mockResolvedValue({ visitorKey: OLD, sessionId: "s1" }), 1000);
    await otherTab([CONSENT, "no"], [VISITOR, null]);
    capture.setConsent("yes");
    const start = vi.fn().mockResolvedValue({ visitorKey: NEW, sessionId: "s2" });
    await capture.capturePageView(start, 2000);
    expect(start).toHaveBeenCalledWith({ landingPath: "/" });
    expect(capture.captureForBooking()).toEqual({ visitorKey: NEW });
  });

  it("gives an old call's link restart no say once the choice has changed", async () => {
    await load();
    capture.setConsent("yes");
    window.history.replaceState(null, "", "/?mk=f1");
    const first = deferred<Session>();
    const start = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({ visitorKey: NEW, sessionId: "s2" });
    const pending = capture.capturePageView(start, 1000);
    capture.setConsent("no");
    capture.setConsent("yes");
    window.history.replaceState(null, "", "/ja?mk=q1");
    await capture.capturePageView(start, 2000);
    expect(start).toHaveBeenCalledTimes(2);
    first.resolve({ visitorKey: OLD, sessionId: "s1" });
    await pending;
    await settle();
    // The old call saw a different link arrive, but it belongs to the withdrawn answer: no third call.
    expect(start).toHaveBeenCalledTimes(2);
    expect(visitor()).toMatchObject({ visitorKey: NEW, slug: "q1" });
  });

  it("revokes a Yes this page gave once the saved answer is removed", async () => {
    await mount("/");
    await act(async () => button("Allow").click());
    window.localStorage.removeItem(CONSENT);
    expect(capture.readConsent()).toBeNull();
    expect(capture.captureForBooking()).toBeUndefined();
  });
});

describe("storage the browser won't let us use", () => {
  function replaceLocalStorage(store: Storage) {
    const saved = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { get: () => store, configurable: true });
    onTestFinished(() => {
      if (saved) Object.defineProperty(window, "localStorage", saved);
      else Reflect.deleteProperty(window, "localStorage");
    });
  }
  const full = (store: Storage) =>
    new Proxy(store, {
      get: (target, key) => {
        if (key === "setItem") return () => { throw new DOMException("full", "QuotaExceededError"); };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  function blockStorage() {
    const blocked = { get: () => { throw new DOMException("blocked", "SecurityError"); }, configurable: true };
    const saved = ["localStorage", "sessionStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)] as const);
    Object.defineProperty(window, "localStorage", blocked);
    Object.defineProperty(window, "sessionStorage", blocked);
    onTestFinished(() => saved.forEach(([name, d]) => void (d ? Object.defineProperty(window, name, d) : Reflect.deleteProperty(window, name))));
  }

  it("keeps one visitor for the page when storage is full", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    replaceLocalStorage(full(window.localStorage));
    const start = vi.fn().mockResolvedValue({ visitorKey: NEW, sessionId: "s1" });
    await load();
    await capture.capturePageView(start, 1000);
    await capture.capturePageView(start, 2000);
    expect(start).toHaveBeenCalledTimes(1);
    expect(capture.captureForBooking()).toEqual({ visitorKey: NEW });
  });

  it("does not revive a visitor from memory once readable storage no longer has it", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    await load();
    await capture.capturePageView(vi.fn().mockResolvedValue({ visitorKey: OLD, sessionId: "s1" }), 1000);
    // Removed with no event this tab hears (the browser's own site-data control, say).
    window.localStorage.removeItem(VISITOR);
    expect(capture.captureForBooking()).toBeUndefined();
    const start = vi.fn().mockResolvedValue({ visitorKey: NEW, sessionId: "s2" });
    await capture.capturePageView(start, 2000);
    expect(start).toHaveBeenCalledWith({ landingPath: "/" });
  });

  it("does not swap a damaged stored visitor for the one in memory", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    await load();
    await capture.capturePageView(vi.fn().mockResolvedValue({ visitorKey: OLD, sessionId: "s1" }), 1000);
    window.localStorage.setItem(VISITOR, "{not json");
    expect(capture.captureForBooking()).toBeUndefined();
  });

  it("carries the link's coupon to the booking page without measurement, even with storage blocked", async () => {
    blockStorage();
    window.history.replaceState(null, "", "/?mk=f1&coupon=DCNT-F1-20");
    await load();
    await capture.capturePageView(null);
    window.history.replaceState(null, "", "/booking");
    expect(capture.arrivalCoupon()).toBe("DCNT-F1-20");
    expect(capture.captureForBooking()).toEqual({ slug: "f1" });
  });

  it("keeps the link's coupon when another tab opts out", async () => {
    window.localStorage.setItem(CONSENT, "yes");
    window.history.replaceState(null, "", "/?mk=f1&coupon=DCNT-F1-20");
    await load();
    await capture.capturePageView(vi.fn().mockResolvedValue({ visitorKey: OLD, sessionId: "s1" }), 1000);
    await otherTab([CONSENT, "no"], [VISITOR, null]);
    window.history.replaceState(null, "", "/booking");
    expect(capture.arrivalCoupon()).toBe("DCNT-F1-20");
    expect(capture.captureForBooking()).toEqual({ slug: "f1" });
  });

  it("says the choice holds for this page only when the browser won't save it", async () => {
    blockStorage();
    await mount("/privacy", { choice: true });
    expect(document.body.textContent).toContain("Measurement is off in this browser.");
    await act(async () => button("Turn on measurement").click());
    await settle();
    expect(document.body.textContent).toContain("Measurement is on for this page only");
    expect(document.body.textContent).not.toContain("in this browser");
    expect(pageviews()).toBe(1);
  });
});
