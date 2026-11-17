"use client";

import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { resolveStoredTheme, THEME_STORAGE_KEY } from "@/lib/theme";
import { cn } from "@/lib/utils";

// The `dark` class on <html> is the source of truth (set before paint by themeInitScript).
function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDarkClass = () => document.documentElement.classList.contains("dark");

export function ThemeToggle({ solid = true }: { solid?: boolean }) {
  const a11y = useTranslations("A11y");
  const dark = useSyncExternalStore(subscribeToThemeClass, isDarkClass, () => false);

  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", resolveStoredTheme(saved, prefersDark));
  }, []);

  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label={a11y("toggleTheme")}
      className={cn(
        "h-9 w-9 rounded-full",
        solid
          ? "text-foreground hover:bg-muted"
          : "text-white hover:bg-white/10",
      )}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
