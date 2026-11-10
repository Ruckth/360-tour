import { SESSION_IDLE_MS, type MarketingCapture } from "convex/lib/marketingAttribution";
import { validateMarketingSlug } from "convex/lib/marketingSlugs";

/**
 * Release 3a: which of our links brought this visitor (client only).
 *
 * - Before consent: the link slug from `?mk=` (with its `?coupon=`) is kept in sessionStorage for this tab.
 *   Nothing else is stored and no identifier exists.
 * - After consent: a server-minted visitor key and the current session sit in localStorage. A new session
 *   starts when there is none, after SESSION_IDLE_MS idle, or when the URL carries a different link.
 *
 * Every storage access is guarded and every failure is swallowed: capture must never break browsing or booking.
 */

export const CONSENT_KEY = "analytics-consent-v2";
/** Fired on window after the consent choice changes. */
export const CONSENT_EVENT = "analytics-consent-change";
const ARRIVAL_KEY = "marketing-arrival";
const VISITOR_KEY = "marketing-visitor";

export type ConsentChoice = "yes" | "no";
type Arrival = { slug: string; coupon?: string };
type Visitor = { visitorKey: string; sessionId: string | null; lastActiveAt: number; slug?: string };
export type StartSession = (args: {
  visitorKey?: string;
  slug?: string;
  landingPath: string;
  referrerHost?: string;
}) => Promise<{ visitorKey: string; sessionId: string | null }>;

/** Staff and in-store screens are never measured and never asked. */
export function isUntrackedPath(pathname: string): boolean {
  return /^\/(?:admin|display|dev)(?:\/|$)/.test(pathname);
}

function read<T>(store: () => Storage, key: string): T | null {
  try {
    const raw = store().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: () => Storage, key: string, value: unknown) {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, JSON.stringify(value));
  } catch {
    // Blocked or full storage: capture just doesn't happen.
  }
}

const tab = () => window.sessionStorage;
const device = () => window.localStorage;

// Kept in memory too, so a browser that blocks storage still gets an answer for this page.
let memoryConsent: ConsentChoice | null = null;

export function readConsent(): ConsentChoice | null {
  try {
    const value = window.localStorage.getItem(CONSENT_KEY);
    return value === "yes" || value === "no" ? value : memoryConsent;
  } catch {
    return memoryConsent;
  }
}

export function setConsent(choice: ConsentChoice) {
  memoryConsent = choice;
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Remembered for this page only.
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

/** Calls back when the choice changes, in this tab or another. For useSyncExternalStore with readConsent. */
export function onConsentChange(onChange: () => void) {
  window.addEventListener(CONSENT_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CONSENT_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const validSlug = (slug: unknown): slug is string => typeof slug === "string" && !validateMarketingSlug(slug).reason;

function slugFrom(search: string): string | undefined {
  const slug = new URLSearchParams(search).get("mk");
  return validSlug(slug) ? slug : undefined;
}

/** Notes a link arrival from the URL (a new link replaces the old one) and returns this tab's link. */
function tabArrival(): Arrival | null {
  const search = window.location.search;
  const slug = slugFrom(search);
  const saved = read<Arrival>(tab, ARRIVAL_KEY);
  if (!slug) return validSlug(saved?.slug) ? saved : null;
  // The coupon comes only from the link's own URL: the short link drops it once the offer is paused or removed.
  const coupon = new URLSearchParams(search).get("coupon")?.trim().slice(0, 64);
  const arrival: Arrival = coupon ? { slug, coupon } : { slug };
  write(tab, ARRIVAL_KEY, arrival);
  return arrival;
}

// Kept in memory too, so a browser that blocks storage keeps one visitor while the page is open.
let memoryVisitor: Visitor | null = null;

/** The stored visitor, reshaped so a damaged record can never fail a booking's argument check. */
function readVisitor(): Visitor | null {
  const saved = read<Partial<Visitor>>(device, VISITOR_KEY) ?? memoryVisitor;
  if (typeof saved?.visitorKey !== "string") return null;
  return {
    visitorKey: saved.visitorKey,
    sessionId: typeof saved.sessionId === "string" ? saved.sessionId : null,
    lastActiveAt: Number(saved.lastActiveAt) || 0,
    ...(validSlug(saved.slug) ? { slug: saved.slug } : {}),
  };
}

function referrerHost(): string | undefined {
  try {
    const host = document.referrer ? new URL(document.referrer).host : "";
    return host && host !== window.location.host ? host : undefined;
  } catch {
    return undefined;
  }
}

let inFlight: Promise<void> | null = null;

/** Runs on every page view. Never throws. */
export function capturePageView(startSession: StartSession | null, now = Date.now()): Promise<void> {
  try {
    const arrival = tabArrival();
    if (readConsent() !== "yes" || !startSession || inFlight) return inFlight ?? Promise.resolve();
    const visitor = readVisitor();
    const urlSlug = slugFrom(window.location.search);

    let slug: string | undefined;
    if (!visitor) slug = urlSlug ?? arrival?.slug;
    else if (visitor.sessionId === null) slug = urlSlug ?? visitor.slug;
    else if ((urlSlug && urlSlug !== visitor.slug) || now - visitor.lastActiveAt > SESSION_IDLE_MS) slug = urlSlug;
    else {
      memoryVisitor = { ...visitor, lastActiveAt: now };
      write(device, VISITOR_KEY, memoryVisitor);
      return Promise.resolve();
    }

    const referrer = referrerHost();
    inFlight = startSession({
      ...(visitor?.visitorKey ? { visitorKey: visitor.visitorKey } : {}),
      ...(slug ? { slug } : {}),
      landingPath: window.location.pathname,
      ...(referrer ? { referrerHost: referrer } : {}),
    })
      .then((result) => {
        // Opted out while the call was running: store nothing.
        if (readConsent() !== "yes") return;
        const next: Visitor = { visitorKey: result.visitorKey, sessionId: result.sessionId, lastActiveAt: now, ...(slug ? { slug } : {}) };
        memoryVisitor = next;
        write(device, VISITOR_KEY, next);
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  } catch {
    return Promise.resolve();
  }
}

/** Sent with a web booking or a web chat: this tab's link, plus the visitor key after consent. */
export function captureForBooking(): MarketingCapture | undefined {
  try {
    const slug = tabArrival()?.slug;
    const visitorKey = readConsent() === "yes" ? readVisitor()?.visitorKey : undefined;
    if (!slug && !visitorKey) return undefined;
    return { ...(visitorKey ? { visitorKey } : {}), ...(slug ? { slug } : {}) };
  } catch {
    return undefined;
  }
}

/** The coupon of the link this tab arrived through, or "". */
export function arrivalCoupon(): string {
  try {
    const coupon = tabArrival()?.coupon;
    return typeof coupon === "string" ? coupon : "";
  } catch {
    return "";
  }
}

/** Opt-out: forgets the visitor key and session. The tab's link stays, as it does before consent. */
export function clearMarketingStorage() {
  memoryVisitor = null;
  write(device, VISITOR_KEY, null);
}
