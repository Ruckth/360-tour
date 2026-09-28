"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A string preference remembered in localStorage. Starts at `fallback` (so server and first client render
 * match) and switches to the stored value after mount.
 */
export function useStoredState(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(stored);
    } catch {
      // Storage can be blocked (private mode, policies); keep the fallback.
    }
  }, [key]);

  const update = useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Ignore: the preference just isn't remembered.
      }
    },
    [key],
  );

  return [value, update];
}
