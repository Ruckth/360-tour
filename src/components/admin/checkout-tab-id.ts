import { newAttemptKey } from "@/components/checkout/backend";

/**
 * Each checkout tab has its own id, the identity convex/displays.ts uses to decide which tab drives
 * the customer display. It lives in sessionStorage, so a reload of that tab keeps it (and stays the
 * driver) while a new tab gets a new one. A duplicated tab copies sessionStorage, so each tab also
 * holds a Web Lock named after its id for its lifetime: the lock is granted to one live tab only
 * (atomically, across same-origin tabs), and a tab refused it takes a new id. A reload releases
 * the old page's lock first. Without Web Locks or sessionStorage, the id is new on every page load.
 */

const KEY = "checkout-tab-id";

type Store = Pick<Storage, "getItem" | "setItem">;
type Locks = Pick<LockManager, "request">;
type Deps = { store: Store | null; locks: Locks | null; newId: () => string };

function read(store: Store) {
  try {
    return store.getItem(KEY);
  } catch {
    return null;
  }
}

function write(store: Store, id: string) {
  try {
    store.setItem(KEY, id);
  } catch {
    // The lock still makes the id this tab's own; only a reload would lose it.
  }
}

/** Takes the lock for `id` if no other live tab holds it, and keeps it until the page goes away. */
function lockFor(locks: Locks, id: string) {
  return new Promise<boolean>((resolve) => {
    locks
      .request(`checkout-tab:${id}`, { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        // Never settles: the lock is released when this document is unloaded.
        return lock ? new Promise<never>(() => {}) : undefined;
      })
      .catch(() => resolve(false));
  });
}

/** This tab's id: the stored one if this tab can lock it, else a new one (stored and locked). */
export async function claimTabId({ store, locks, newId }: Deps): Promise<string> {
  if (!store || !locks) return newId();
  const stored = read(store);
  if (stored && (await lockFor(locks, stored))) return stored;
  const fresh = newId();
  write(store, fresh);
  await lockFor(locks, fresh);
  return fresh;
}

function sessionStore(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

let tabId: Promise<string> | null = null;

/** This tab's id, settled once per page load. Browser only. */
export function checkoutTabId() {
  tabId ??= claimTabId({ store: sessionStore(), locks: typeof navigator !== "undefined" ? (navigator.locks ?? null) : null, newId: newAttemptKey });
  return tabId;
}
