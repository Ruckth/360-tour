"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "@/platform/intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  applyThemePreference,
  readThemePreference,
  resolveStoredTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

// The `dark` class on <html> is the source of truth (set before paint by themeInitScript).
function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isDarkClass = () => document.documentElement.classList.contains("dark");

function subscribeToPreference(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      onChange();
    }
  }
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  };
}

function getStoredPreference(): ThemePreference {
  try {
    return readThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

const themeOptions: { value: ThemePreference; labelKey: "themeSystem" | "themeLight" | "themeDark"; Icon: typeof Monitor }[] = [
  { value: "system", labelKey: "themeSystem", Icon: Monitor },
  { value: "light", labelKey: "themeLight", Icon: Sun },
  { value: "dark", labelKey: "themeDark", Icon: Moon },
];

export function ThemeToggle({ solid = true }: { solid?: boolean }) {
  const a11y = useTranslations("A11y");
  const [open, setOpen] = useState(false);
  const dark = useSyncExternalStore(subscribeToThemeClass, isDarkClass, () => false);
  const preference = useSyncExternalStore(subscribeToPreference, getStoredPreference, () => "system" as ThemePreference);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const saved = (() => {
        try {
          return window.localStorage.getItem(THEME_STORAGE_KEY);
        } catch {
          return null;
        }
      })();
      document.documentElement.classList.toggle("dark", resolveStoredTheme(saved, media.matches));
    };

    sync();
    if (preference !== "system") return;

    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [preference]);

  function selectPreference(next: ThemePreference) {
    applyThemePreference(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        data-testid="theme-toggle"
        aria-label={a11y("toggleTheme")}
        className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full transition focus:outline-none focus:ring-3 focus:ring-ring/40",
          solid
            ? "text-foreground hover:bg-muted"
            : "text-white hover:bg-white/10",
        )}
      >
        {preference === "system" ? (
          <Monitor className="h-4 w-4" aria-hidden="true" />
        ) : dark ? (
          <Sun className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Moon className="h-4 w-4" aria-hidden="true" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" data-testid="theme-menu" className="w-40 p-1">
        <div role="radiogroup" aria-label={a11y("appearance")} className="grid gap-0.5">
          {themeOptions.map(({ value, labelKey, Icon }) => {
            const selected = preference === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => selectPreference(value)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
                  selected && "bg-muted font-medium",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 truncate">{a11y(labelKey)}</span>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {selected ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
