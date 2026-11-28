export const THEME_STORAGE_KEY = "theme";
export const THEME_CHANGE_EVENT = "auralis-theme-preference-change";

export type ThemePreference = "system" | "light" | "dark";

export function readThemePreference(storageValue: string | null): ThemePreference {
  if (storageValue === "dark") return "dark";
  if (storageValue === "light") return "light";
  return "system";
}

export function resolveStoredTheme(storageValue: string | null, prefersDark: boolean) {
  if (storageValue === "dark") return true;
  if (storageValue === "light") return false;
  return prefersDark;
}

export function applyThemePreference(
  preference: ThemePreference,
  options?: {
    storage?: Pick<Storage, "setItem" | "removeItem">;
    prefersDark?: boolean;
    root?: HTMLElement;
    dispatch?: boolean;
  },
) {
  const storage = options?.storage ?? (typeof window !== "undefined" ? window.localStorage : undefined);
  const prefersDark =
    options?.prefersDark ??
    (typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false);
  const root = options?.root ?? (typeof document !== "undefined" ? document.documentElement : undefined);

  try {
    if (preference === "system") {
      storage?.removeItem(THEME_STORAGE_KEY);
    } else {
      storage?.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // Ignore storage errors in private browsing or restricted contexts.
  }

  const dark = resolveStoredTheme(preference === "system" ? null : preference, prefersDark);
  root?.classList.toggle("dark", dark);

  if (options?.dispatch !== false && typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }
  return dark;
}

export const themeInitScript = `
(() => {
  try {
    const saved = window.localStorage.getItem("${THEME_STORAGE_KEY}");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved === "dark" || (saved !== "light" && prefersDark);
    document.documentElement.classList.toggle("dark", dark);
  } catch {
  }
})();
`;
