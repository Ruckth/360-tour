import { act as reactAct } from "react";
const pending = new Set<Promise<unknown>>();
export function track<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  void promise.finally(() => pending.delete(promise)).catch(() => undefined);
  return promise;
}
/** Await real backend reads after React commits effects, without advancing business time. */
export async function act(callback: () => unknown | Promise<unknown>) {
  await reactAct(async () => {
    await callback();
  });
  while (pending.size)
    await reactAct(async () => {
      await Promise.allSettled([...pending]);
    });
}

export function gateResponse<A extends unknown[], T>(
  write: (...args: A) => Promise<T>,
) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    write: async (...args: A) => {
      await wait;
      return write(...args);
    },
  };
}
