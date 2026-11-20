"use client";

import { useSyncExternalStore } from "react";
import type { Id } from "convex/_generated/dataModel";
import type { CommerceAccess, ExternalMethod, PaymentsMode } from "./backend";

/*
 * What every checkout needs from the pay desk, whatever the payments mode: which panel this page
 * loaded with, this device, tab and till, and the connection. The attempt flow's own rules are in
 * pay-desk-rules, loaded with the attempt panel.
 */

/** What the pay panel can do on this till right now. */
export type PayMode = PaymentsMode | "paused" | "reload" | "loading";

// Pinned per commerce backend: one per page load in the app, one per fixture in tests.
let loaded = new WeakMap<object, PaymentsMode>();

/**
 * The payments mode this page loaded with stays pinned: a till that loaded the direct panel and
 * then sees the cutover must reload before it can take payments again (v27 Rollout gate).
 */
export function payMode(access: CommerceAccess | undefined, page: object = loaded): PayMode {
  if (!access) return "loading";
  if (!loaded.has(page)) loaded.set(page, access.paymentsMode);
  if (loaded.get(page) !== access.paymentsMode || !access.tillReady) return "reload";
  if (access.paused) return "paused";
  return access.paymentsMode;
}

/** Tests only: forget the mode each page loaded with. */
export function resetLoadedPayMode() {
  loaded = new WeakMap();
}

const DEVICE_KEY = "checkout.deviceKey";
const TILL_KEY = "checkout.tillId";
const memory = new Map<string, string>();

/** A random opaque key: 32 URL-safe characters (the server accepts 20–128). */
export function randomKey() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const validKey = (key: string | null | undefined): key is string => typeof key === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(key);

export function stored(store: () => Storage, key: string, create?: () => string) {
  try {
    const value = store().getItem(key);
    if (validKey(value) || !create) return value;
    const made = memory.get(key) ?? create();
    store().setItem(key, made);
    return made;
  } catch {
    if (!memory.has(key) && create) memory.set(key, create());
    return memory.get(key) ?? null;
  }
}
const local = () => window.localStorage;
export const session = () => window.sessionStorage;

/** This browser, kept across reloads and shared by its tabs: the server's till for it is found by this key. */
export const deviceKey = () => stored(local, DEVICE_KEY, randomKey)!;

/** The server's till for this device (tills, from the cutover's admission), once it has one. */
export const serverTillId = () => stored(local, TILL_KEY) as Id<"tills"> | null;
const tillListeners = new Set<() => void>();
export function rememberTill(id: Id<"tills">) {
  if (serverTillId() === id) return;
  try { window.localStorage.setItem(TILL_KEY, id); } catch { memory.set(TILL_KEY, id); }
  for (const fn of tillListeners) fn();
}
/** The server's till for this device, re-rendering when the cutover's acknowledgement names it. */
export function useServerTillId() {
  return useSyncExternalStore((fn) => { tillListeners.add(fn); return () => { tillListeners.delete(fn); }; }, serverTillId, () => null);
}

/**
 * The till a payment attempt belongs to: the server's till once this device has one. Before the
 * device is admitted the server refuses with a reload, so the placeholder is never stored.
 */
export const tillId = (): string => serverTillId() ?? "unadmitted";

/** A new key per direct panel, kept by the panel for its retries. */
export const newPanelKey = () => randomKey();


function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/** Whether the browser believes it is online. A failed call is the other signal. */
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** The pay mode to reopen for an attempt that is already running: its single method, or split. */
export function resumeMode(legs: readonly { method: ExternalMethod; state: string }[]): ExternalMethod | "split" | "none" {
  const live = legs.filter((leg) => leg.state !== "declined");
  if (!live.length) return legs.length ? legs[legs.length - 1].method : "none";
  return live.length === 1 ? live[0].method : "split";
}
