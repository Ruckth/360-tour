import { createBoundedMemoryCache, type VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";

/**
 * Mirrors `@vercel/functions` BuildCache (cache/build-client.js): HTTP and transport failures
 * are reported through `onError` only, so `get` resolves `null` and `set`/`expireTag` resolve
 * as if they succeeded. Toggle `state.down` to simulate an outage of the shared cache, or
 * `state.dropData` to lose only data writes (generations still work).
 */
export function sdkCache(down = false, shared: VillaRuntimeCache = createBoundedMemoryCache()) {
  const state = { down, dropData: false, gets: 0, sets: 0 };
  const cache: VillaRuntimeCache = {
    async get(key) {
      state.gets++;
      return state.down ? null : shared.get(key);
    },
    async set(key, value, options) {
      state.sets++;
      if (!state.down && !(state.dropData && !key.includes(":gen:"))) await shared.set(key, value, options);
    },
    async delete(key) {
      if (!state.down) await shared.delete(key);
    },
    async expireTag(tag) {
      if (!state.down) await shared.expireTag(tag);
    },
  };
  return { cache, state };
}

/** One worker's view of a shared cache whose data writes (not generations) wait until released. */
export function delayedWrites(shared: VillaRuntimeCache) {
  const held: (() => void)[] = [];
  const cache: VillaRuntimeCache = {
    ...shared,
    async set(key, value, options) {
      if (!key.includes(":gen:")) {
        const gate = Promise.withResolvers<void>();
        held.push(gate.resolve);
        await gate.promise;
      }
      await shared.set(key, value, options);
    },
  };
  const release = async () => {
    for (const resume of held.splice(0)) resume();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { cache, held, release };
}
