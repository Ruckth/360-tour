export const THEME_STORAGE_KEY = "theme";

export function resolveStoredTheme(storageValue: string | null, prefersDark: boolean) {
  if (storageValue === "dark") return true;
  if (storageValue === "light") return false;
  return prefersDark;
}

export const themeInitScript = `
(() => {
  try {
    const saved = window.localStorage.getItem("${THEME_STORAGE_KEY}");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const dark = saved === "dark" || (!saved && prefersDark);
    document.documentElement.classList.toggle("dark", dark);
  } catch {
  }
})();
`;
