// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { resort } from "@/lib/data/resort-config";
import en from "../../messages/en.json";
import th from "../../messages/th.json";

vi.mock("next/navigation", () => ({ usePathname: () => "/privacy" }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return { default: ({ children, href, className }: { children: ReactNode; href: string; className?: string }) => createElement("a", { href, className }, children) };
});

type Capture = typeof import("@/lib/marketing/capture");
type Messages = typeof en;
let capture: Capture;
let root: Root | null = null;

// Product and service names stay in Latin script in every translation, as do "QR" and the contact address.
const NAMES = ["Stripe Checkout", "Stripe", "PostHog", "Convex", "Clerk", "Resend", "Sentry", "AI", "QR", resort.contactEmail];
const NON_LATIN = ["th", "ja", "ko", "zh-CN", "ru", "hi"] as const;
const readMessages = (locale: string) => JSON.parse(readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Messages;
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === label) as HTMLButtonElement | undefined;
/** Latin words left on the page once the allowed names are taken out. */
const latinWords = () => NAMES.reduce((rest, name) => rest.split(name).join(" "), text()).match(/[A-Za-z]{2,}/g) ?? [];

async function render(locale: string, messages: Messages, node: ReactNode) {
  const intl = { locale, messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(createElement(NextIntlClientProvider, intl, node)));
}
async function legalPage(locale: string, messages: Messages, kind: "privacy" | "terms") {
  const { LegalPage } = await import("@/components/legal/LegalPage");
  await render(locale, messages, createElement(LegalPage, { kind }));
}
async function choice(locale: string, messages: Messages) {
  const { AnalyticsChoice } = await import("@/components/legal/AnalyticsChoice");
  await render(locale, messages, createElement(AnalyticsChoice));
}
function blockStorage() {
  const blocked = { get: () => { throw new DOMException("blocked", "SecurityError"); }, configurable: true };
  const saved = ["localStorage", "sessionStorage"].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)] as const);
  Object.defineProperty(window, "localStorage", blocked);
  Object.defineProperty(window, "sessionStorage", blocked);
  onTestFinished(() => saved.forEach(([name, d]) => void (d ? Object.defineProperty(window, name, d) : Reflect.deleteProperty(window, name))));
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  capture = await import("@/lib/marketing/capture");
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("privacy page", () => {
  it("shows the English policy, with the 90-day retention next to the 30-day attribution", async () => {
    capture.setConsent("no");
    await legalPage("en", en, "privacy");
    expect(document.querySelector("h1")?.textContent).toBe("Privacy policy");
    expect([...document.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "Information we collect", "How we use it", "Visit measurement", "Who receives it", "Your choices", "Contact",
    ]);
    const measurement = [...document.querySelectorAll("p")].find((p) => p.textContent?.includes("in the 30 days before it"));
    expect(measurement?.textContent).toContain("Raw visit records and link-open records are kept for 90 days and then deleted; daily totals without personal identifiers are kept.");
    expect(measurement?.textContent).toContain("Measurement stays off until you allow it.");
    expect(text()).toContain("Measurement is off in this browser.");
    const mail = document.querySelector('a[href^="mailto:"]');
    expect(mail?.getAttribute("href")).toBe(`mailto:${resort.contactEmail}`);
    expect(mail?.parentElement?.textContent).toBe(`Email ${resort.contactEmail} with privacy questions.`);
    expect(document.querySelector('a[href="/"]')?.textContent).toBe("Return home");
  });

  it("shows the Thai policy, retention sentence included, with no English left", async () => {
    capture.setConsent("no");
    await legalPage("th", th, "privacy");
    expect(document.querySelector("h1")?.textContent).toBe(th.Legal.privacy.title);
    expect(text()).toContain(th.Legal.lastUpdated);
    expect(text()).toContain(th.Legal.privacy.measurementConsent);
    expect(th.Legal.privacy.measurementConsent).toContain("90 วัน");
    expect(th.Legal.privacy.measurementConsent).toContain("30 วัน");
    expect(text()).toContain(th.Legal.choice.off);
    expect(button(th.Legal.choice.turnOn)).toBeDefined();
    const mail = document.querySelector('a[href^="mailto:"]');
    expect(mail?.textContent).toBe(resort.contactEmail);
    expect(document.querySelector('a[href="/th"]')?.textContent).toBe(th.Legal.returnHome);
    expect(latinWords()).toEqual([]);
  });

  it.each(NON_LATIN)("leaves no English on the %s privacy and terms pages", async (locale) => {
    capture.setConsent("yes");
    const messages = readMessages(locale);
    await legalPage(locale, messages, "privacy");
    expect(text()).toContain(messages.Legal.choice.on);
    expect(latinWords()).toEqual([]);
    await act(async () => root!.unmount());
    document.body.innerHTML = "";
    await legalPage(locale, messages, "terms");
    expect(latinWords()).toEqual([]);
  });
});

describe("terms page", () => {
  it("shows the English terms", async () => {
    await legalPage("en", en, "terms");
    expect(document.querySelector("h1")?.textContent).toBe("Terms of use and booking");
    expect([...document.querySelectorAll("h2")].map((h) => h.textContent)).toEqual([
      "Current site status", "Bookings and payment", "Changes and cancellation", "Contact",
    ]);
    expect(text()).toContain("Unpaid pending requests expire after 24 hours.");
    expect(document.querySelector('a[href^="mailto:"]')?.parentElement?.textContent).toBe(`Email ${resort.contactEmail} with booking questions.`);
    // The measurement choice belongs to the privacy page only.
    expect(document.querySelector("button")).toBeNull();
  });

  it("shows the Thai terms", async () => {
    await legalPage("th", th, "terms");
    expect(document.querySelector("h1")?.textContent).toBe(th.Legal.terms.title);
    expect(text()).toContain(th.Legal.terms.bookingBody);
    expect(document.querySelector('a[href^="mailto:"]')?.textContent).toBe(resort.contactEmail);
    expect(document.querySelector('a[href="/th"]')?.textContent).toBe(th.Legal.returnHome);
    expect(latinWords()).toEqual([]);
  });
});

describe("measurement choice", () => {
  it("switches measurement on and off in Thai", async () => {
    capture.setConsent("no");
    await choice("th", th);
    expect(text()).toContain(th.Legal.choice.off);
    await act(async () => button(th.Legal.choice.turnOn)!.click());
    expect(window.localStorage.getItem(capture.CONSENT_KEY)).toBe("yes");
    expect(text()).toContain(th.Legal.choice.on);
    await act(async () => button(th.Legal.choice.turnOff)!.click());
    expect(window.localStorage.getItem(capture.CONSENT_KEY)).toBe("no");
    expect(text()).toContain(th.Legal.choice.off);
    expect(latinWords()).toEqual([]);
  });

  it("says in Thai that the choice holds for this page only when the browser won't save it", async () => {
    blockStorage();
    await choice("th", th);
    await act(async () => button(th.Legal.choice.turnOn)!.click());
    expect(text()).toContain(th.Legal.choice.pageOnlyOn);
    await act(async () => button(th.Legal.choice.turnOff)!.click());
    expect(text()).toContain(th.Legal.choice.pageOnlyOff);
    expect(latinWords()).toEqual([]);
  });

  it("keeps the English wording", async () => {
    blockStorage();
    await choice("en", en);
    expect(text()).toContain("Measurement is off in this browser.");
    await act(async () => button("Turn on measurement")!.click());
    expect(text()).toContain("Measurement is on for this page only: this browser isn’t letting the site save the choice, so other tabs and later visits won’t know it.");
    expect(button("Turn off measurement")).toBeDefined();
  });
});

describe("legal component source", () => {
  it.each(["LegalPage.tsx", "AnalyticsChoice.tsx"])("%s has no hard-coded English copy", (file) => {
    const source = readFileSync(join(process.cwd(), "src/components/legal", file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // JSX text between tags, and string literals with a space in them (sentences, not class names or keys).
    // JSX text holds no code punctuation; that rules out code that merely sits between `=>` and a tag.
    const jsxText = [...source.matchAll(/>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)].map((m) => m[1].trim()).filter((value) => value && !/[;=()]/.test(value));
    const sentences = [...source.matchAll(/(['"`])((?:(?!\1).)*)\1/g)]
      .map((m) => m[2])
      .filter((value) => /[A-Z][a-z]+ [a-z]+/.test(value));
    expect(jsxText).toEqual([]);
    expect(sentences).toEqual([]);
  });
});
