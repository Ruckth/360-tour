import { randomKey, session, stored, validKey } from "./pay-desk";

/*
 * This tab's key, sent with every attempt command so another tab of the same browser is another
 * operator. Only the attempt flow needs it, so it loads with pay-desk-attempts.
 */

const TAB_KEY = "checkout.tabKey";

// This tab: kept across reloads (sessionStorage), distinct across tabs, including a duplicated tab,
// which copies sessionStorage: the first page to hold the key's lock keeps it, any other draws a new one.
let tab: string | null = null;
let claiming: Promise<string> | null = null;
const tabListeners = new Set<() => void>();

function holdTabLock(key: string): Promise<boolean> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks?.request) return Promise.resolve(true);
  return new Promise((resolve) => {
    // A reload waits briefly for the page it replaces to let go; a duplicated tab's original never does.
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(800) : undefined;
    locks.request(`checkout-tab:${key}`, signal ? { signal } : { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise<void>(() => {});
    }).catch(() => resolve(false));
  });
}

/** Claims this tab's key once per page; resolves when it is held. */
export function claimTabKey(): Promise<string> {
  claiming ??= (async () => {
    let key = stored(session, TAB_KEY);
    if (!validKey(key) || !(await holdTabLock(key))) {
      key = randomKey();
      try { window.sessionStorage.setItem(TAB_KEY, key); } catch { /* memory only */ }
      await holdTabLock(key);
    }
    tab = key;
    for (const fn of tabListeners) fn();
    return key;
  })();
  return claiming;
}

/** For useSyncExternalStore: subscribing claims the key; the snapshot is null until it is held. */
export function subscribeTab(fn: () => void) {
  tabListeners.add(fn);
  void claimTabKey();
  return () => { tabListeners.delete(fn); };
}
export const currentTab = () => tab;

/** Tests only: forget the claimed key, as a new page does (sessionStorage decides whether it is the same tab). */
export function resetTabKey() {
  tab = null;
  claiming = null;
}
