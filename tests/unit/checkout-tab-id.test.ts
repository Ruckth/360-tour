import { describe, expect, it } from "vitest";
import { claimTabId } from "@/components/admin/checkout-tab-id";

/** Web Locks for one origin: `ifAvailable` locks go to one holder at a time, released when its page goes away. */
function lockManager() {
  const held = new Set<string>();
  return {
    held,
    request: ((name: string, _options: { ifAvailable: boolean }, callback: (lock: { name: string } | null) => unknown) => {
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      callback({ name });
      return new Promise(() => {});
    }) as unknown as LockManager["request"],
    /** The tab holding `id` was closed or reloaded. */
    release: (id: string) => held.delete(`checkout-tab:${id}`),
  };
}
/** A tab's sessionStorage. */
const store = (initial?: string) => {
  const values = new Map(initial ? [["checkout-tab-id", initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
};
let counter = 0;
const newId = () => `tab-${++counter}`;

describe("checkout tab id", () => {
  it("gives a new tab a new id, stored and locked", async () => {
    const locks = lockManager();
    const tab = store();
    const id = await claimTabId({ store: tab, locks, newId });
    expect(tab.values.get("checkout-tab-id")).toBe(id);
    expect(locks.held.has(`checkout-tab:${id}`)).toBe(true);
  });

  it("keeps a reloaded tab's id, so it stays the driver", async () => {
    const locks = lockManager();
    const tab = store();
    const id = await claimTabId({ store: tab, locks, newId });
    locks.release(id);
    expect(await claimTabId({ store: tab, locks, newId })).toBe(id);
  });

  it("gives a duplicated tab, which copied the id while the original is open, a new one", async () => {
    const locks = lockManager();
    const original = await claimTabId({ store: store(), locks, newId });
    const copy = store(original);
    const duplicate = await claimTabId({ store: copy, locks, newId });
    expect(duplicate).not.toBe(original);
    expect(copy.values.get("checkout-tab-id")).toBe(duplicate);
    expect(locks.held.has(`checkout-tab:${duplicate}`)).toBe(true);
  });

  it("lets only one of two tabs starting at once keep a shared id", async () => {
    const locks = lockManager();
    const ids = await Promise.all([claimTabId({ store: store("tab-shared"), locks, newId }), claimTabId({ store: store("tab-shared"), locks, newId })]);
    expect(ids.filter((id) => id === "tab-shared")).toHaveLength(1);
    expect(new Set(ids).size).toBe(2);
  });

  it("uses a new id on every load without Web Locks or sessionStorage", async () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const first = await claimTabId({ store: store("tab-stored"), locks: null, newId });
    const second = await claimTabId({ store: null, locks: lockManager(), newId });
    expect(first).not.toBe("tab-stored");
    expect(second).not.toBe(first);
    // Storage that throws still gets a locked id of its own.
    expect(await claimTabId({ store: blocked, locks: lockManager(), newId })).toMatch(/^tab-/);
  });

  it("takes a new id if the lock request fails", async () => {
    const failing = { request: (() => Promise.reject(new Error("SecurityError"))) as unknown as LockManager["request"] };
    expect(await claimTabId({ store: store("tab-stored"), locks: failing, newId })).not.toBe("tab-stored");
  });
});
