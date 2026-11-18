"use client";

import { useCallback, useSyncExternalStore } from "react";

// Values written while storage is blocked (private mode, policies) stay usable for this page's lifetime.
const unsaved = new Map<string, string>();
const listeners = new Set<() => void>();

function read(key: string): string | null {
  if (unsaved.has(key)) return unsaved.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * A string preference remembered in localStorage. The server render and hydration use `fallback`, so
 * markup matches; the stored value takes over right after.
 */
export function useStoredState(key: string, fallback: string): [string, (value: string) => void] {
  const stored = useSyncExternalStore(subscribe, () => read(key), () => null);

  const update = useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
        unsaved.delete(key);
      } catch {
        unsaved.set(key, next);
      }
      listeners.forEach((listener) => listener());
    },
    [key],
  );

  return [stored ?? fallback, update];
}
