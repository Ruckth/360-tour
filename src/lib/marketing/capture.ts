import { SESSION_IDLE_MS, type MarketingCapture } from "convex/lib/marketingAttribution";
import { validateMarketingSlug } from "convex/lib/marketingSlugs";

/**
 * Release 3a: which of our links brought this visitor (client only), and the one measurement choice.
 *
 * - Before consent: the link slug from `?mk=` (with its `?coupon=`) is kept in sessionStorage for this tab.
 *   Nothing else is stored and no identifier exists.
 * - After consent: a server-minted visitor key and the current session sit in localStorage. A new session
 *   starts when there is none, after SESSION_IDLE_MS idle, or when the URL carries a different link.
 *
 * The choice is shared by every tab through localStorage. Each change of the effective answer (in this
 * tab, or heard from another through a storage event) starts a new consent generation. Withdrawing it,
 * removing the saved answer or clearing the site's storage closes the capture gate at once, forgets the
 * visitor in memory and detaches work still running, which checks its generation before storing or
 * restarting anything. Listeners (the PostHog controller) hear each change through onConsentTransition.
 *
 * Every storage access is guarded and every failure is swallowed: capture must never break browsing or booking.
 */

export const CONSENT_KEY = "analytics-consent-v2";
/** Fired on window after this tab changes the consent choice. */
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
/** `local`: this tab made the change; otherwise another tab did, or the saved answer disappeared. */
export type ConsentTransition = { granted: boolean; local: boolean };

/** Staff and in-store screens are never measured and never asked. */
export function isUntrackedPath(pathname: string): boolean {
  return /^\/(?:admin|display|dev)(?:\/|$)/.test(pathname);
}

// ---------------------------------------------------------------- storage

type Stored = { readable: true; raw: string | null } | { readable: false };

function readRaw(store: () => Storage, key: string): Stored {
  try {
    return { readable: true, raw: store().getItem(key) };
  } catch {
    return { readable: false };
  }
}

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** False when the browser refused (blocked or full storage). */
function save(store: () => Storage, key: string, value: string | null): boolean {
  try {
    if (value === null) store().removeItem(key);
    else store().setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const tab = () => window.sessionStorage;
const device = () => window.localStorage;

// ---------------------------------------------------------------- the choice

// This page's answer, used only when storage can't hold it.
let memoryConsent: ConsentChoice | null = null;
/**
 * none: storage holds the answer (an empty or damaged key means there is none).
 * unsaved: this page's answer couldn't be saved and no older one is stored. An answer that appears in
 *   storage later is another tab's, and newer.
 * stale: this page's answer couldn't be saved and an older saved one couldn't be removed either. Memory
 *   wins over it until another tab saves an answer.
 */
let consentFallback: "none" | "unsaved" | "stale" = "none";

export function readConsent(): ConsentChoice | null {
  if (consentFallback === "stale") return memoryConsent;
  const stored = readRaw(device, CONSENT_KEY);
  // Blocked storage: only this page's answer exists.
  if (!stored.readable) return memoryConsent;
  if (stored.raw === "yes" || stored.raw === "no") return stored.raw;
  // Readable, and empty or damaged: a removed or cleared answer is gone, even if this page gave it.
  return consentFallback === "unsaved" ? memoryConsent : null;
}

/** True when the browser keeps this page's answer from being saved: it holds for this page only, not other tabs or visits. */
export function isConsentPageOnly(): boolean {
  if (consentFallback !== "none") return true;
  return memoryConsent !== null && !readRaw(device, CONSENT_KEY).readable;
}

let generation = 0;
// The answer this tab last acted on; undefined until the browser was first read.
let effective: ConsentChoice | null | undefined;
const transitionListeners = new Set<(transition: ConsentTransition) => void>();
const changeListeners = new Set<() => void>();

/** The consent generation work starts under; compare with mayCapture before storing or sending. */
export function consentGeneration(): number {
  syncConsent();
  return generation;
}

/** Work started under `startedIn` may still capture: nothing changed since and the answer is Yes. */
export function mayCapture(startedIn: number): boolean {
  syncConsent();
  return startedIn === generation && readConsent() === "yes";
}

/** Hears each grant and withdrawal, synchronously, before the change listeners. */
export function onConsentTransition(listener: (transition: ConsentTransition) => void) {
  transitionListeners.add(listener);
  return () => void transitionListeners.delete(listener);
}

/** Calls back when the choice changes, in this tab or another. For useSyncExternalStore with readConsent. */
export function onConsentChange(onChange: () => void) {
  changeListeners.add(onChange);
  return () => void changeListeners.delete(onChange);
}

function notifyChange() {
  for (const listener of [...changeListeners]) listener();
}

/** Forgets this page's visitor and detaches a session call still running, so nothing it returns is kept. */
function forgetIdentity() {
  generation += 1;
  inFlight = null;
  memoryVisitor = null;
  visitorUnsaved = false;
}

/** Acts on a change of the answer. Idempotent: hearing the same answer again does nothing. */
function settle(next: ConsentChoice | null, local: boolean) {
  const was = effective === "yes";
  effective = next;
  const granted = next === "yes";
  if (was === granted) return;
  forgetIdentity();
  // A visitor left in storage from before (a removed answer leaves it) never comes back. Only the tab that
  // made the change touches storage: another tab may already have saved a newer visitor.
  if (local) save(device, VISITOR_KEY, null);
  for (const listener of [...transitionListeners]) {
    try {
      listener({ granted, local });
    } catch {
      // A listener's failure never stops the others.
    }
  }
}

/** Catches a change no event announced (the saved answer removed in this tab, or an event not yet delivered). */
function syncConsent() {
  if (typeof window === "undefined") return;
  if (effective === undefined) {
    effective = readConsent();
    return;
  }
  settle(readConsent(), false);
}

export function setConsent(choice: ConsentChoice) {
  syncConsent();
  memoryConsent = choice;
  if (save(device, CONSENT_KEY, choice)) consentFallback = "none";
  // Remembered for this page only. Drop the older saved answer so it can't come back.
  else consentFallback = save(device, CONSENT_KEY, null) ? "unsaved" : "stale";
  if (choice === "no") clearMarketingStorage();
  settle(choice, true);
  window.dispatchEvent(new Event(CONSENT_EVENT));
  notifyChange();
}

function onStorage(event: StorageEvent) {
  if (window.__marketingConsentOwner !== owner) return;
  if (event.storageArea && event.storageArea === readArea(tab)) return;
  if (event.key === null || event.key === CONSENT_KEY) {
    // Another tab saved, removed or cleared the answer: it is newer than anything this page kept.
    consentFallback = "none";
    memoryConsent = null;
    if (event.key === null) forgetIdentity();
    const next = event.key === CONSENT_KEY && (event.newValue === "yes" || event.newValue === "no") ? event.newValue : null;
    // Acts on the answer the event carries, not the one stored now: a quick No then Yes in another tab
    // arrives as two events after both writes, and the No must still withdraw.
    settle(next, false);
    notifyChange();
  } else if (event.key === VISITOR_KEY) {
    // Another tab forgot the visitor (it opted out): never bring it back. A visitor it saved is newer than ours.
    if (event.newValue === null) forgetIdentity();
    else visitorUnsaved = false;
  }
}

function readArea(store: () => Storage): Storage | null {
  try {
    return store();
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    /** The capture module listening on this window; an older copy (hot reload) stays quiet. */
    __marketingConsentOwner?: object;
  }
}
const owner = {};

// ---------------------------------------------------------------- the link and the visitor

const validSlug = (slug: unknown): slug is string => typeof slug === "string" && !validateMarketingSlug(slug).reason;

function slugFrom(search: string): string | undefined {
  const slug = new URLSearchParams(search).get("mk");
  return validSlug(slug) ? slug : undefined;
}

// This tab's link in memory too, for a browser that won't keep it in sessionStorage.
let memoryArrival: Arrival | null = null;
let arrivalUnsaved = false;

/** Notes a link arrival from the URL (a new link replaces the old one) and returns this tab's link. */
function tabArrival(): Arrival | null {
  const search = window.location.search;
  const slug = slugFrom(search);
  if (!slug) {
    const stored = arrivalUnsaved ? null : readRaw(tab, ARRIVAL_KEY);
    const saved = stored?.readable ? parse<Arrival>(stored.raw) : memoryArrival;
    return validSlug(saved?.slug) ? saved : null;
  }
  // The coupon comes only from the link's own URL: the short link drops it once the offer is paused or removed.
  const coupon = new URLSearchParams(search).get("coupon")?.trim().slice(0, 64);
  const arrival: Arrival = coupon ? { slug, coupon } : { slug };
  memoryArrival = arrival;
  arrivalUnsaved = !save(tab, ARRIVAL_KEY, JSON.stringify(arrival));
  return arrival;
}

// The visitor in memory too, so a browser that blocks or fills storage keeps one visitor while the page is open.
let memoryVisitor: Visitor | null = null;
/** This page's latest visitor couldn't be saved (full or blocked storage): memory is the newest. */
let visitorUnsaved = false;

/** The stored visitor, reshaped so a damaged record can never fail a booking's argument check. */
function readVisitor(): Visitor | null {
  let saved: Partial<Visitor> | null;
  if (visitorUnsaved) saved = memoryVisitor;
  else {
    const stored = readRaw(device, VISITOR_KEY);
    // Readable storage decides: an empty or damaged key is no visitor, never the one in memory.
    saved = stored.readable ? parse<Partial<Visitor>>(stored.raw) : memoryVisitor;
  }
  if (typeof saved?.visitorKey !== "string") return null;
  return {
    visitorKey: saved.visitorKey,
    sessionId: typeof saved.sessionId === "string" ? saved.sessionId : null,
    lastActiveAt: Number(saved.lastActiveAt) || 0,
    ...(validSlug(saved.slug) ? { slug: saved.slug } : {}),
  };
}

function keepVisitor(next: Visitor) {
  memoryVisitor = next;
  visitorUnsaved = !save(device, VISITOR_KEY, JSON.stringify(next));
}

function referrerHost(): string | undefined {
  try {
    const host = document.referrer ? new URL(document.referrer).host : "";
    return host && host !== window.location.host ? host : undefined;
  } catch {
    return undefined;
  }
}

type Job = { promise: Promise<void> };
// The session call running for the current generation; detached (set to null) when the choice changes.
let inFlight: Job | null = null;

/** Runs on every page view. Never throws. */
export function capturePageView(startSession: StartSession | null, now = Date.now()): Promise<void> {
  try {
    syncConsent();
    const arrival = tabArrival();
    if (readConsent() !== "yes" || !startSession) return Promise.resolve();
    if (inFlight) return inFlight.promise;
    const visitor = readVisitor();
    const urlSlug = slugFrom(window.location.search);

    let slug: string | undefined;
    if (!visitor) slug = urlSlug ?? arrival?.slug;
    else if (visitor.sessionId === null) slug = urlSlug ?? visitor.slug;
    else if ((urlSlug && urlSlug !== visitor.slug) || now - visitor.lastActiveAt > SESSION_IDLE_MS) slug = urlSlug;
    else {
      keepVisitor({ ...visitor, lastActiveAt: now });
      return Promise.resolve();
    }

    const startedIn = generation;
    const referrer = referrerHost();
    const job: Job = { promise: Promise.resolve() };
    job.promise = startSession({
      ...(visitor?.visitorKey ? { visitorKey: visitor.visitorKey } : {}),
      ...(slug ? { slug } : {}),
      landingPath: window.location.pathname,
      ...(referrer ? { referrerHost: referrer } : {}),
    })
      .then((result) => {
        // The choice changed while the call ran (opted out, or out and back in): keep nothing it returned.
        if (!mayCapture(startedIn)) return;
        keepVisitor({ visitorKey: result.visitorKey, sessionId: result.sessionId, lastActiveAt: now, ...(slug ? { slug } : {}) });
      })
      .catch(() => undefined)
      .finally(() => {
        // A newer call may hold the slot now: leave it alone.
        if (inFlight === job) inFlight = null;
        if (startedIn !== generation) return;
        // A different link arrived while this call ran (its page view was folded into this one): give it its own session.
        const latest = slugFrom(window.location.search);
        if (latest && latest !== slug) void capturePageView(startSession);
      });
    inFlight = job;
    return job.promise;
  } catch {
    return Promise.resolve();
  }
}

/** Sent with a web booking or a web chat: this tab's link, plus the visitor key after consent. */
export function captureForBooking(): MarketingCapture | undefined {
  try {
    syncConsent();
    const slug = tabArrival()?.slug;
    const visitorKey = readConsent() === "yes" ? readVisitor()?.visitorKey : undefined;
    if (!slug && !visitorKey) return undefined;
    return { ...(visitorKey ? { visitorKey } : {}), ...(slug ? { slug } : {}) };
  } catch {
    return undefined;
  }
}

/** The coupon of the link this tab arrived through, or "". Works whatever the measurement choice. */
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
  forgetIdentity();
  save(device, VISITOR_KEY, null);
}

if (typeof window !== "undefined") {
  // Listens from the first import, on every route: the banner unmounts on staff screens, this doesn't.
  window.__marketingConsentOwner = owner;
  window.addEventListener("storage", onStorage);
  effective = readConsent();
}
